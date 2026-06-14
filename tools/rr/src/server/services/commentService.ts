import crypto from "node:crypto";
import type { DB } from "../db.js";
import { eventBus } from "./eventBus.js";
import type {
  Comment,
  CreateCommentInput,
  CommentStatus,
} from "../../shared/types.js";

function now(): string {
  return new Date().toISOString();
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

interface CommentRow {
  id: string;
  document_id: string;
  document_version: number;
  target_type: string;
  rr_id: string | null;
  table_rr_id: string | null;
  row_index: number | null;
  col_index: number | null;
  selected_text: string | null;
  prefix: string | null;
  suffix: string | null;
  comment: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToComment(r: CommentRow): Comment {
  return {
    id: r.id,
    documentId: r.document_id,
    documentVersion: r.document_version,
    targetType: r.target_type as Comment["targetType"],
    rrId: r.rr_id,
    tableRrId: r.table_rr_id,
    rowIndex: r.row_index,
    colIndex: r.col_index,
    selectedText: r.selected_text,
    prefix: r.prefix,
    suffix: r.suffix,
    comment: r.comment,
    status: r.status as CommentStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class CommentService {
  private getDocId: () => string;

  constructor(
    private db: DB,
    documentId: string | (() => string),
    private documentVersion: () => number,
  ) {
    this.getDocId = typeof documentId === "function" ? documentId : () => documentId;
  }

  list(): Comment[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM comments WHERE document_id = ? ORDER BY created_at ASC",
      )
      .all(this.getDocId()) as CommentRow[];
    return rows.map(rowToComment);
  }

  get(id: string): Comment | null {
    const row = this.db
      .prepare("SELECT * FROM comments WHERE id = ?")
      .get(id) as CommentRow | undefined;
    return row ? rowToComment(row) : null;
  }

  create(input: CreateCommentInput): Comment {
    const id = genId("c");
    const ts = now();
    const status: CommentStatus = input.queue ? "queued" : "draft";
    this.db
      .prepare(
        `INSERT INTO comments (
          id, document_id, document_version, target_type, rr_id, table_rr_id,
          row_index, col_index, selected_text, prefix, suffix, comment, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.getDocId(),
        this.documentVersion(),
        input.targetType,
        input.rrId ?? null,
        input.tableRrId ?? null,
        input.rowIndex ?? null,
        input.colIndex ?? null,
        input.selectedText ?? null,
        input.prefix ?? null,
        input.suffix ?? null,
        input.comment,
        status,
        ts,
        ts,
      );
    const created = this.get(id)!;
    eventBus.emitEvent({ type: "comment_created", payload: created });
    return created;
  }

  update(id: string, patch: Partial<CreateCommentInput & { status: CommentStatus }>): Comment | null {
    const existing = this.get(id);
    if (!existing) return null;
    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      comment: "comment",
      status: "status",
      targetType: "target_type",
      selectedText: "selected_text",
    };
    for (const [key, col] of Object.entries(map)) {
      if (key in patch && (patch as Record<string, unknown>)[key] !== undefined) {
        fields.push(`${col} = ?`);
        values.push((patch as Record<string, unknown>)[key]);
      }
    }
    if (fields.length === 0) return existing;
    fields.push("updated_at = ?");
    values.push(now(), id);
    this.db
      .prepare(`UPDATE comments SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);
    const updated = this.get(id)!;
    eventBus.emitEvent({ type: "comment_updated", payload: updated });
    return updated;
  }

  setStatus(id: string, status: CommentStatus): void {
    this.db
      .prepare("UPDATE comments SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now(), id);
  }

  delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM comments WHERE id = ?").run(id);
    if (res.changes > 0) {
      eventBus.emitEvent({ type: "comment_deleted", payload: { id } });
      return true;
    }
    return false;
  }
}
