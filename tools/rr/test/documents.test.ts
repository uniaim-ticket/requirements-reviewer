import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../src/server/migrations.js";
import { DocumentService, slugify } from "../src/server/services/documentService.js";
import { CommentService } from "../src/server/services/commentService.js";
import { DEFAULT_CONFIG, type RrConfig } from "../src/server/config.js";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rr-docs-"));
  fs.mkdirSync(path.join(root, "docs", "requirements"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "requirements", "index.html"),
    "<body><p>initial</p></body>",
  );
  const db = new Database(":memory:");
  runMigrations(db);
  const config: RrConfig = { ...DEFAULT_CONFIG };
  const docs = new DocumentService(db, root, config);
  docs.ensureRecord();
  return { root, db, docs };
}

describe("slugify", () => {
  it("produces url-safe slugs and keeps Japanese", () => {
    expect(slugify("券種をまたぐ購入制約")).toBe("券種をまたぐ購入制約");
    expect(slugify("Ticket Purchase!! (v2)")).toBe("ticket-purchase-v2");
    expect(slugify("   ")).toBe("doc");
  });
});

describe("DocumentService multi-document", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });
  afterEach(() => {
    fs.rmSync(env.root, { recursive: true, force: true });
  });

  it("seeds a default document from index.html", () => {
    const list = env.docs.list();
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe("index");
    expect(env.docs.currentId()).toBe("index");
  });

  it("creates additional documents with unique slugs", () => {
    const a = env.docs.create({ title: "券種をまたぐ購入制約", html: "<p>a</p>" });
    const b = env.docs.create({ title: "券種をまたぐ購入制約", html: "<p>b</p>" });
    expect(a.slug).toBe("券種をまたぐ購入制約");
    expect(b.slug).toBe("券種をまたぐ購入制約-2");
    // creating makes it current
    expect(env.docs.currentId()).toBe(b.id);
    // file written under docs/requirements/<slug>.html
    expect(fs.existsSync(env.docs.absPathForSlug(a.slug))).toBe(true);
  });

  it("switches the current document and scopes content", () => {
    const a = env.docs.create({ title: "doc-a", html: "<p>AAA</p>" });
    const b = env.docs.create({ title: "doc-b", html: "<p>BBB</p>" });
    env.docs.setCurrent(a.id);
    expect(env.docs.readHtml()).toContain("AAA");
    env.docs.setCurrent(b.id);
    expect(env.docs.readHtml()).toContain("BBB");
  });

  it("scopes comments per current document", () => {
    const comments = new CommentService(
      env.db,
      () => env.docs.currentId(),
      () => 1,
    );
    const a = env.docs.create({ title: "doc-a", html: "<p>a</p>" });
    env.docs.setCurrent(a.id);
    comments.create({ targetType: "global", comment: "a-comment" });

    const b = env.docs.create({ title: "doc-b", html: "<p>b</p>" });
    env.docs.setCurrent(b.id);
    comments.create({ targetType: "global", comment: "b-comment" });

    env.docs.setCurrent(a.id);
    expect(comments.list().map((c) => c.comment)).toEqual(["a-comment"]);
    env.docs.setCurrent(b.id);
    expect(comments.list().map((c) => c.comment)).toEqual(["b-comment"]);
  });

  it("flags hasHtml: false for documents without on-disk HTML", () => {
    const empty = env.docs.create({ title: "empty" }); // no html written
    const filled = env.docs.create({ title: "filled", html: "<p>x</p>" });
    expect(env.docs.get(empty.id)?.hasHtml).toBe(false);
    expect(env.docs.get(filled.id)?.hasHtml).toBe(true);
  });

  it("imports orphan on-disk HTML files via scanDisk", () => {
    const dir = env.docs.baseDir();
    fs.writeFileSync(path.join(dir, "外部要件.html"), "<p>外部</p>");
    const imported = env.docs.scanDisk();
    expect(imported.map((d) => d.slug)).toContain("外部要件");
    const found = env.docs.getBySlug("外部要件");
    expect(found?.hasHtml).toBe(true);
    // running again imports nothing new
    expect(env.docs.scanDisk()).toHaveLength(0);
  });

  it("deletes a document (and removes empty/unrendered file)", () => {
    const empty = env.docs.create({ title: "捨てる要件" });
    expect(env.docs.get(empty.id)).not.toBeNull();
    const ok = env.docs.delete(empty.id);
    expect(ok).toBe(true);
    expect(env.docs.get(empty.id)).toBeNull();
  });

  it("refuses to delete the very last remaining document", () => {
    // Only the seeded "index" exists -> can't delete it (nothing left to show).
    expect(env.docs.list()).toHaveLength(1);
    expect(() => env.docs.delete("index")).toThrow();
  });

  it("allows deleting the seeded default once another document exists", () => {
    const dir = env.docs.baseDir();
    env.docs.create({ title: "本物の要件", html: "<p>real</p>" });
    expect(env.docs.delete("index")).toBe(true);
    expect(env.docs.get("index")).toBeNull();
    // The default HTML file is removed so scanDisk won't re-import it.
    expect(fs.existsSync(path.join(dir, "index.html"))).toBe(false);
    expect(env.docs.scanDisk()).toHaveLength(0);
  });

  it("switches current away from a deleted current document", () => {
    const a = env.docs.create({ title: "a", html: "<p>a</p>" });
    env.docs.setCurrent(a.id);
    expect(env.docs.currentId()).toBe(a.id);
    env.docs.delete(a.id, { removeFile: true });
    expect(env.docs.currentId()).not.toBe(a.id);
  });
});
