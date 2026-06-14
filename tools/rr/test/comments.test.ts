import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/server/migrations.js";
import { CommentService } from "../src/server/services/commentService.js";

function makeService() {
  const db = new Database(":memory:");
  runMigrations(db);
  // documents row required for version lookups in real usage; not needed here.
  return new CommentService(db, "main", () => 1);
}

describe("CommentService", () => {
  let svc: CommentService;
  beforeEach(() => {
    svc = makeService();
  });

  it("creates a global comment as draft", () => {
    const c = svc.create({ targetType: "global", comment: "全体指摘" });
    expect(c.targetType).toBe("global");
    expect(c.status).toBe("draft");
    expect(svc.list()).toHaveLength(1);
  });

  it("creates a queued comment when queue=true", () => {
    const c = svc.create({
      targetType: "line",
      rrId: "p-001",
      selectedText: "本文",
      comment: "ここを直して",
      queue: true,
    });
    expect(c.status).toBe("queued");
    expect(c.rrId).toBe("p-001");
  });

  it("stores table_row metadata", () => {
    const c = svc.create({
      targetType: "table_row",
      rrId: "tbl-001-r003",
      tableRrId: "tbl-001",
      comment: "行に追記",
    });
    expect(c.tableRrId).toBe("tbl-001");
    expect(c.targetType).toBe("table_row");
  });

  it("updates and deletes comments", () => {
    const c = svc.create({ targetType: "global", comment: "x" });
    const updated = svc.update(c.id, { comment: "y" });
    expect(updated?.comment).toBe("y");
    expect(svc.delete(c.id)).toBe(true);
    expect(svc.list()).toHaveLength(0);
  });
});
