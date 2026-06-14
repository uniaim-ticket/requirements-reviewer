import crypto from "node:crypto";
import type { DB } from "../db.js";
import { eventBus } from "./eventBus.js";
import type { CommentService } from "./commentService.js";
import type {
  Comment,
  Job,
  JobStatus,
  QueueState,
  TokenUsage,
} from "../../shared/types.js";

function now(): string {
  return new Date().toISOString();
}
function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}
function safeParseUsage(s: string): TokenUsage | null {
  try {
    return JSON.parse(s) as TokenUsage;
  } catch {
    return null;
  }
}

interface JobRow {
  id: string;
  document_id: string;
  document_version: number;
  status: string;
  position: number;
  claude_process_id: number | null;
  claude_status: string | null;
  claude_summary: string | null;
  claude_raw_output: string | null;
  claude_comment_for_reviewer: string | null;
  diff_text: string | null;
  error_message: string | null;
  needs_follow_up: number;
  incomplete_reason: string | null;
  session_id: string | null;
  attempt: number;
  used_resume: number;
  usage_json: string | null;
  force_fresh: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const STATE_KEY = "queue_state";
const STOP_KEY = "queue_stop_after_current";

export class QueueService {
  private getDocId: () => string;

  constructor(
    private db: DB,
    documentId: string | (() => string),
    private documentVersion: () => number,
    private comments: CommentService,
  ) {
    this.getDocId = typeof documentId === "function" ? documentId : () => documentId;
  }

  // ---- app_state helpers ----
  private getState(key: string, fallback: string): string {
    const row = this.db
      .prepare("SELECT value FROM app_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? fallback;
  }

  private setState(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now());
  }

  getQueueState(): QueueState {
    // Default to "running": comments are processed in order automatically.
    // The user can still pause explicitly.
    return {
      state: this.getState(STATE_KEY, "running") === "paused" ? "paused" : "running",
      stopAfterCurrent: this.getState(STOP_KEY, "false") === "true",
    };
  }

  pause(): void {
    this.setState(STATE_KEY, "paused");
    eventBus.emitEvent({ type: "queue_paused" });
  }

  resume(): void {
    this.setState(STATE_KEY, "running");
    this.setState(STOP_KEY, "false");
    eventBus.emitEvent({ type: "queue_resumed" });
  }

  stopAfterCurrent(): void {
    this.setState(STOP_KEY, "true");
  }

  clearStopAfterCurrent(): void {
    this.setState(STOP_KEY, "false");
  }

  // ---- jobs ----
  private rowToJob(r: JobRow): Job {
    const comments = this.db
      .prepare(
        `SELECT c.* FROM comments c
         JOIN job_comments jc ON jc.comment_id = c.id
         WHERE jc.job_id = ?`,
      )
      .all(r.id) as Array<Record<string, unknown>>;
    return {
      id: r.id,
      documentId: r.document_id,
      documentVersion: r.document_version,
      status: r.status as JobStatus,
      position: r.position,
      claudeProcessId: r.claude_process_id,
      claudeStatus: (r.claude_status as Job["claudeStatus"]) ?? null,
      claudeSummary: r.claude_summary,
      claudeRawOutput: r.claude_raw_output,
      claudeCommentForReviewer: r.claude_comment_for_reviewer,
      diffText: r.diff_text,
      errorMessage: r.error_message,
      needsFollowUp: Boolean(r.needs_follow_up),
      incompleteReason: r.incomplete_reason ?? null,
      sessionId: r.session_id ?? null,
      attempt: r.attempt ?? 1,
      usedResume: Boolean(r.used_resume),
      usage: r.usage_json ? safeParseUsage(r.usage_json) : null,
      forceFresh: Boolean(r.force_fresh),
      createdAt: r.created_at,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      comments: comments.map((cr) => this.mapComment(cr)),
    };
  }

  private mapComment(cr: Record<string, unknown>): Comment {
    return {
      id: cr.id as string,
      documentId: cr.document_id as string,
      documentVersion: cr.document_version as number,
      targetType: cr.target_type as Comment["targetType"],
      rrId: (cr.rr_id as string) ?? null,
      tableRrId: (cr.table_rr_id as string) ?? null,
      rowIndex: (cr.row_index as number) ?? null,
      colIndex: (cr.col_index as number) ?? null,
      selectedText: (cr.selected_text as string) ?? null,
      prefix: (cr.prefix as string) ?? null,
      suffix: (cr.suffix as string) ?? null,
      comment: cr.comment as string,
      status: cr.status as Comment["status"],
      createdAt: cr.created_at as string,
      updatedAt: cr.updated_at as string,
    };
  }

  list(): Job[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM jobs WHERE document_id = ? ORDER BY position ASC, created_at ASC",
      )
      .all(this.getDocId()) as JobRow[];
    return rows.map((r) => this.rowToJob(r));
  }

  get(id: string): Job | null {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? this.rowToJob(row) : null;
  }

  private maxPosition(): number {
    const row = this.db
      .prepare("SELECT MAX(position) AS m FROM jobs WHERE document_id = ?")
      .get(this.getDocId()) as { m: number | null };
    return row.m ?? 0;
  }

  /** Enqueue one job per comment (MVP: 1 comment = 1 job, RFP §10). */
  enqueueComments(commentIds: string[]): Job[] {
    const created: Job[] = [];
    const tx = this.db.transaction((ids: string[]) => {
      for (const cid of ids) {
        const c = this.comments.get(cid);
        if (!c) continue;
        const jobId = genId("j");
        const pos = this.maxPosition() + 1;
        const ts = now();
        this.db
          .prepare(
            `INSERT INTO jobs (id, document_id, document_version, status, position, created_at)
             VALUES (?, ?, ?, 'queued', ?, ?)`,
          )
          .run(jobId, this.getDocId(), this.documentVersion(), pos, ts);
        this.db
          .prepare(
            "INSERT INTO job_comments (job_id, comment_id) VALUES (?, ?)",
          )
          .run(jobId, cid);
        this.comments.setStatus(cid, "queued");
        created.push(this.get(jobId)!);
      }
    });
    tx(commentIds);
    for (const job of created) {
      eventBus.emitEvent({ type: "job_queued", payload: job });
    }
    return created;
  }

  /** The next queued job, by position. */
  nextQueued(): Job | null {
    const row = this.db
      .prepare(
        "SELECT * FROM jobs WHERE document_id = ? AND status = 'queued' ORDER BY position ASC, created_at ASC LIMIT 1",
      )
      .get(this.getDocId()) as JobRow | undefined;
    return row ? this.rowToJob(row) : null;
  }

  hasRunning(): boolean {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE document_id = ? AND status = 'running'",
      )
      .get(this.getDocId()) as { n: number };
    return row.n > 0;
  }

  markStarted(jobId: string, pid: number | null): void {
    this.db
      .prepare(
        "UPDATE jobs SET status = 'running', started_at = ?, claude_process_id = ? WHERE id = ?",
      )
      .run(now(), pid, jobId);
    eventBus.emitEvent({ type: "job_started", payload: this.get(jobId) });
  }

  markCompleted(
    jobId: string,
    data: {
      claudeStatus: string;
      summary: string;
      rawOutput: string;
      commentForReviewer: string;
      diffText: string;
      needsFollowUp?: boolean;
      incompleteReason?: string | null;
      sessionId?: string | null;
      usage?: TokenUsage | null;
      usedResume?: boolean;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'completed', completed_at = ?, claude_status = ?,
         claude_summary = ?, claude_raw_output = ?, claude_comment_for_reviewer = ?, diff_text = ?,
         needs_follow_up = ?, incomplete_reason = ?, session_id = ?,
         used_resume = ?, usage_json = ?
         WHERE id = ?`,
      )
      .run(
        now(),
        data.claudeStatus,
        data.summary,
        data.rawOutput,
        data.commentForReviewer,
        data.diffText,
        data.needsFollowUp ? 1 : 0,
        data.incompleteReason ?? null,
        data.sessionId ?? null,
        data.usedResume ? 1 : 0,
        data.usage ? JSON.stringify(data.usage) : null,
        jobId,
      );
    // Only mark comments applied when the run looks complete; if it stopped
    // mid-way, keep them "queued" so the reviewer can continue / retry.
    if (!data.incompleteReason) {
      const cids = this.db
        .prepare("SELECT comment_id FROM job_comments WHERE job_id = ?")
        .all(jobId) as Array<{ comment_id: string }>;
      for (const { comment_id } of cids) {
        this.comments.setStatus(comment_id, "applied");
      }
    }
    eventBus.emitEvent({ type: "job_completed", payload: this.get(jobId) });
  }

  markFailed(jobId: string, message: string): void {
    this.db
      .prepare(
        "UPDATE jobs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?",
      )
      .run(now(), message, jobId);
    eventBus.emitEvent({ type: "job_failed", payload: this.get(jobId) });
  }

  /**
   * Re-queue a completed/failed job to run again.
   * - mode "fresh": start over (clears the session so Claude re-does the work).
   * - mode "continue": resume the same Claude session (continues where it
   *   stopped). Keeps session_id so the worker passes --resume.
   * Moves the job to the back of the queue and bumps its attempt counter.
   */
  requeue(jobId: string, mode: "fresh" | "continue"): Job | null {
    const job = this.get(jobId);
    if (!job) return null;
    if (job.status === "running" || job.status === "queued") return job;
    const sessionId = mode === "continue" ? job.sessionId : null;
    // "fresh" = explicit start-over: never resume (not even the doc session).
    const forceFresh = mode === "fresh" ? 1 : 0;
    const pos = this.maxPosition() + 1;
    this.db
      .prepare(
        `UPDATE jobs SET status = 'queued', position = ?, attempt = attempt + 1,
         session_id = ?, force_fresh = ?, error_message = NULL, incomplete_reason = NULL,
         started_at = NULL, completed_at = NULL
         WHERE id = ?`,
      )
      .run(pos, sessionId, forceFresh, jobId);
    // Put the comments back into the queued state.
    const cids = this.db
      .prepare("SELECT comment_id FROM job_comments WHERE job_id = ?")
      .all(jobId) as Array<{ comment_id: string }>;
    for (const { comment_id } of cids) {
      this.comments.setStatus(comment_id, "queued");
    }
    const updated = this.get(jobId);
    eventBus.emitEvent({ type: "job_queued", payload: updated });
    return updated;
  }

  remove(jobId: string): boolean {
    const job = this.get(jobId);
    if (!job) return false;
    if (job.status === "running") return false; // don't remove in-flight job
    const tx = this.db.transaction(() => {
      // Return its comments to draft so they can be re-queued.
      const cids = this.db
        .prepare("SELECT comment_id FROM job_comments WHERE job_id = ?")
        .all(jobId) as Array<{ comment_id: string }>;
      for (const { comment_id } of cids) {
        if (job.status === "queued") this.comments.setStatus(comment_id, "draft");
      }
      this.db.prepare("DELETE FROM job_comments WHERE job_id = ?").run(jobId);
      this.db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
    });
    tx();
    return true;
  }

  /** Move a queued job to a new position (1-based) and renumber. */
  reorder(jobId: string, newPosition: number): boolean {
    const jobs = this.list().filter((j) => j.status === "queued");
    const idx = jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;
    const [moved] = jobs.splice(idx, 1);
    const clamped = Math.max(0, Math.min(newPosition - 1, jobs.length));
    jobs.splice(clamped, 0, moved);
    const tx = this.db.transaction(() => {
      jobs.forEach((j, i) => {
        this.db
          .prepare("UPDATE jobs SET position = ? WHERE id = ?")
          .run(i + 1, j.id);
      });
    });
    tx();
    return true;
  }
}
