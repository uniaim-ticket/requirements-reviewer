import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { DB } from "../db.js";
import type { RrConfig } from "../config.js";
import { injectIds } from "./rrIdService.js";
import { eventBus } from "./eventBus.js";
import type { DocumentInfo } from "../../shared/types.js";

const CURRENT_KEY = "current_document_id";

function now(): string {
  return new Date().toISOString();
}

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Turn a free-form title into a filesystem/url-safe slug. */
export function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "doc";
}

interface DocRow {
  id: string;
  slug: string;
  title: string;
  html_path: string;
  current_version: number;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

function rowToInfo(row: DocRow): DocumentInfo {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    htmlPath: row.html_path,
    currentVersion: row.current_version,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Manages multiple requirement documents under a base directory
 * (docs/requirements). Each document is a flat <slug>.html file. One document
 * is "current" at a time (stored in app_state); read/write/sync operate on it.
 */
export class DocumentService {
  constructor(
    private db: DB,
    private root: string,
    private config: RrConfig,
  ) {}

  /** Base directory that holds every document HTML file. */
  baseDir(): string {
    return path.resolve(this.root, path.dirname(this.config.document.path));
  }

  /** Relative path (from root) for a slug's HTML file. */
  relPathForSlug(slug: string): string {
    return path.join(path.dirname(this.config.document.path), `${slug}.html`);
  }

  absPathForSlug(slug: string): string {
    return path.resolve(this.root, this.relPathForSlug(slug));
  }

  // ---- current-document state ----
  private getState(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM app_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  private setState(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now());
  }

  currentId(): string {
    const id = this.getState(CURRENT_KEY);
    if (id && this.get(id)) return id;
    // Fall back to the first document, or the seeded default.
    const first = this.list()[0];
    if (first) {
      this.setState(CURRENT_KEY, first.id);
      return first.id;
    }
    return this.ensureDefault().id;
  }

  setCurrent(id: string): DocumentInfo | null {
    const doc = this.get(id);
    if (!doc) return null;
    this.setState(CURRENT_KEY, id);
    eventBus.emitEvent({ type: "document_selected", payload: doc });
    return doc;
  }

  // ---- per-document Claude session + context digest (for resume / recall) ----
  /** The latest Claude session id for a document, to --resume by default. */
  getDocSession(docId: string): string | null {
    return this.getState(`session:${docId}`);
  }
  setDocSession(docId: string, sessionId: string | null): void {
    if (sessionId) this.setState(`session:${docId}`, sessionId);
  }
  /** A rolling, human-readable digest of prior decisions for this document. */
  getDigest(docId: string): string {
    return this.getState(`digest:${docId}`) ?? "";
  }
  appendDigest(docId: string, entry: string): void {
    const prev = this.getDigest(docId);
    // Keep the digest bounded so it can't grow unbounded across many comments.
    const merged = (prev ? prev + "\n" : "") + entry;
    const lines = merged.split("\n");
    const trimmed = lines.slice(-40).join("\n");
    this.setState(`digest:${docId}`, trimmed);
  }

  /** True if the document's HTML file exists on disk and is non-empty. */
  private htmlExistsFor(rel: string): boolean {
    const abs = path.resolve(this.root, rel);
    try {
      return fs.existsSync(abs) && fs.statSync(abs).size > 0;
    } catch {
      return false;
    }
  }

  private enrich(info: DocumentInfo): DocumentInfo {
    return { ...info, hasHtml: this.htmlExistsFor(info.htmlPath) };
  }

  // ---- document CRUD ----
  list(): DocumentInfo[] {
    const rows = this.db
      .prepare("SELECT * FROM documents ORDER BY created_at ASC")
      .all() as DocRow[];
    return rows.map((r) => this.enrich(rowToInfo(r)));
  }

  get(id: string): DocumentInfo | null {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE id = ?")
      .get(id) as DocRow | undefined;
    return row ? this.enrich(rowToInfo(row)) : null;
  }

  getBySlug(slug: string): DocumentInfo | null {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE slug = ?")
      .get(slug) as DocRow | undefined;
    return row ? this.enrich(rowToInfo(row)) : null;
  }

  /** Ensure a unique slug by suffixing -2, -3, ... if needed. */
  private uniqueSlug(base: string): string {
    let slug = base;
    let n = 2;
    while (this.getBySlug(slug)) slug = `${base}-${n++}`;
    return slug;
  }

  /**
   * Create a new document record (and an empty HTML file if missing).
   * Returns the created document and makes it current.
   */
  create(opts: {
    title: string;
    slug?: string;
    html?: string;
    makeCurrent?: boolean;
  }): DocumentInfo {
    const slug = this.uniqueSlug(opts.slug ? slugify(opts.slug) : slugify(opts.title));
    const id = slug; // slug doubles as id (unique, stable, url-safe)
    const rel = this.relPathForSlug(slug);
    const abs = this.absPathForSlug(slug);
    const ts = now();
    const html = opts.html ?? "";
    if (html) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, html, "utf8");
    }
    this.db
      .prepare(
        `INSERT INTO documents (id, slug, title, html_path, current_version, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(id, slug, opts.title, rel, html ? hashContent(html) : null, ts, ts);
    const info = this.get(id)!;
    eventBus.emitEvent({ type: "document_created", payload: info });
    if (opts.makeCurrent !== false) this.setCurrent(id);
    return info;
  }

  /**
   * Seed the default document from the on-disk starter HTML created by
   * `rr init` (docs/requirements/index.html), if no documents exist yet.
   */
  ensureDefault(): DocumentInfo {
    const existing = this.list();
    if (existing.length > 0) return existing[0];
    const defaultRel = this.config.document.path; // e.g. docs/requirements/index.html
    const defaultSlug = path.basename(defaultRel).replace(/\.html?$/i, "");
    const abs = path.resolve(this.root, defaultRel);
    const html = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO documents (id, slug, title, html_path, current_version, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        defaultSlug,
        defaultSlug,
        this.config.document.title,
        defaultRel,
        html ? hashContent(html) : null,
        ts,
        ts,
      );
    this.setState(CURRENT_KEY, defaultSlug);
    return this.get(defaultSlug)!;
  }

  /**
   * Scan the base directory for *.html files that have no document record yet
   * and import them (e.g. files added manually, or created out-of-band). Slug
   * = filename without extension. Returns the newly imported documents.
   */
  scanDisk(): DocumentInfo[] {
    const dir = this.baseDir();
    if (!fs.existsSync(dir)) return [];
    const known = new Set(this.list().map((d) => d.slug));
    const imported: DocumentInfo[] = [];
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return [];
    }
    for (const name of entries) {
      if (!/\.html?$/i.test(name)) continue;
      const slug = name.replace(/\.html?$/i, "");
      if (known.has(slug)) continue;
      const abs = path.join(dir, name);
      let html = "";
      try {
        if (!fs.statSync(abs).isFile()) continue;
        html = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const rel = path.join(path.dirname(this.config.document.path), name);
      const ts = now();
      this.db
        .prepare(
          `INSERT INTO documents (id, slug, title, html_path, current_version, content_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(slug, slug, slug, rel, html ? hashContent(html) : null, ts, ts);
      const info = this.get(slug)!;
      imported.push(info);
      eventBus.emitEvent({ type: "document_created", payload: info });
    }
    return imported;
  }

  /**
   * Delete a document: remove its DB record, comments, jobs, and (optionally)
   * its HTML file from disk. The seeded default (e.g. "index") CAN be deleted
   * once other documents exist; we only refuse to delete the very last
   * document so the app always has something to show. The HTML file is removed
   * along with the default doc, otherwise scanDisk() would re-import it.
   */
  delete(id: string, opts: { removeFile?: boolean } = {}): boolean {
    const doc = this.get(id);
    if (!doc) return false;
    if (this.list().length <= 1) {
      throw new Error(
        "最後の1件のため削除できません。先に別の要件を作成してから削除してください。",
      );
    }
    const defaultSlug = path
      .basename(this.config.document.path)
      .replace(/\.html?$/i, "");
    // Deleting the default doc: also remove its file so it isn't re-imported.
    const removeFile = doc.slug === defaultSlug ? true : opts.removeFile;

    const tx = this.db.transaction(() => {
      // Remove jobs + their job_comments links, comments, then the document.
      const jobIds = this.db
        .prepare("SELECT id FROM jobs WHERE document_id = ?")
        .all(id) as Array<{ id: string }>;
      for (const { id: jid } of jobIds) {
        this.db.prepare("DELETE FROM job_comments WHERE job_id = ?").run(jid);
      }
      this.db.prepare("DELETE FROM jobs WHERE document_id = ?").run(id);
      this.db.prepare("DELETE FROM comments WHERE document_id = ?").run(id);
      this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    });
    tx();

    // Remove the HTML file if requested (default: remove only if empty/missing).
    const abs = path.resolve(this.root, doc.htmlPath);
    const shouldRemove = removeFile ?? !doc.hasHtml;
    if (shouldRemove) {
      try {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }

    // If we deleted the current document, switch to another one.
    if (this.getState(CURRENT_KEY) === id) {
      const next = this.list()[0];
      this.setState(CURRENT_KEY, next ? next.id : this.ensureDefault().id);
    }
    eventBus.emitEvent({ type: "document_deleted", payload: { id } });
    return true;
  }

  // ---- operations on the current document ----
  private currentRow(): DocRow {
    const id = this.currentId();
    return this.db
      .prepare("SELECT * FROM documents WHERE id = ?")
      .get(id) as DocRow;
  }

  absPath(): string {
    return path.resolve(this.root, this.currentRow().html_path);
  }

  exists(): boolean {
    return fs.existsSync(this.absPath());
  }

  readHtml(): string {
    return this.exists() ? fs.readFileSync(this.absPath(), "utf8") : "";
  }

  writeHtml(html: string): void {
    const p = this.absPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, html, "utf8");
  }

  getInfo(): DocumentInfo | null {
    return this.get(this.currentId());
  }

  /** Backwards-compatible bootstrap used on startup. */
  ensureRecord(): DocumentInfo {
    return this.ensureDefault();
  }

  /**
   * Detect a change to the current document on disk; bump version, store hash,
   * and emit document_updated. Returns true when a change was detected.
   */
  syncFromDisk(emit = true): boolean {
    const id = this.currentId();
    const row = this.get(id);
    if (!row || !this.exists()) return false;
    const html = this.readHtml();
    const hash = hashContent(html);
    if (hash === row.contentHash) return false;
    this.db
      .prepare(
        `UPDATE documents SET content_hash = ?, current_version = current_version + 1, updated_at = ? WHERE id = ?`,
      )
      .run(hash, now(), id);
    if (emit) {
      eventBus.emitEvent({
        type: "document_updated",
        payload: { id, version: row.currentVersion + 1 },
      });
    }
    return true;
  }

  /** Inject rr-ids into the current document if any are missing. */
  injectIdsOnDisk(): number {
    if (!this.exists()) return 0;
    const html = this.readHtml();
    const { html: out, added } = injectIds(
      html,
      this.config.review.id_attribute,
    );
    if (added > 0) {
      this.writeHtml(out);
      this.syncFromDisk();
    }
    return added;
  }
}
