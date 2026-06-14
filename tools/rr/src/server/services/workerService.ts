import fs from "node:fs";
import path from "node:path";
import type { RrConfig } from "../config.js";
import type { DocumentService } from "./documentService.js";
import type { QueueService } from "./queueService.js";
import type { Job } from "../../shared/types.js";
import { buildApplyPrompt, runClaude } from "./claudeService.js";
import { computeDiff } from "./diffService.js";
import { eventBus } from "./eventBus.js";

/**
 * Serial worker for a single document (RFP §10: 直列処理). Only one job runs
 * at a time. Comments are processed automatically in order: enqueuing triggers
 * autoDrain(), so the queue is "send in order", not "hold then send".
 */
export class WorkerService {
  private running = false;
  private currentAbort: AbortController | null = null;
  /** Live progress lines for the currently/most-recently running job. */
  private progress: { jobId: string; startedAt: number; log: string[] } | null =
    null;

  constructor(
    private config: RrConfig,
    private root: string,
    private docs: DocumentService,
    private queue: QueueService,
  ) {}

  isBusy(): boolean {
    return this.running;
  }

  /** Live progress snapshot for the active job (for polling). */
  getProgress(): { jobId: string; startedAt: number; log: string[] } | null {
    return this.progress ? { ...this.progress, log: [...this.progress.log] } : null;
  }

  private pushProgress(jobId: string, line: string): void {
    if (!this.progress || this.progress.jobId !== jobId) return;
    this.progress.log.push(line);
    if (this.progress.log.length > 300) {
      this.progress.log = this.progress.log.slice(-300);
    }
    const elapsed = Math.round((Date.now() - this.progress.startedAt) / 1000);
    eventBus.emitEvent({
      type: "job_progress",
      payload: { jobId, elapsed, line },
    });
  }

  cancelCurrent(): void {
    this.currentAbort?.abort();
  }

  private backupDir(): string {
    return path.join(this.root, ".rr", "backups");
  }

  /** Copy the current document to a timestamped backup, return its path. */
  private backup(): string {
    const dir = this.backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(dir, `index-${stamp}.html`);
    if (this.docs.exists()) {
      fs.copyFileSync(this.docs.absPath(), dest);
    }
    return dest;
  }

  /** Process a single job end-to-end. */
  async runJob(job: Job): Promise<void> {
    const abort = new AbortController();
    this.currentAbort = abort;
    this.progress = { jobId: job.id, startedAt: Date.now(), log: [] };
    const backupPath = this.backup();
    try {
      this.queue.markStarted(job.id, null);
      const html = this.docs.readHtml();
      // MVP: one comment per job.
      const comment = job.comments[0];
      if (!comment) {
        this.queue.markFailed(job.id, "ジョブに紐づくコメントがありません");
        return;
      }
      const continuing = Boolean(job.sessionId);
      this.pushProgress(
        job.id,
        continuing
          ? `前回の続きから再開します（試行 ${job.attempt}）: 「${comment.comment.slice(0, 40)}」`
          : `コメントを反映します: 「${comment.comment.slice(0, 40)}」`,
      );
      // When continuing, ask Claude to finish the unfinished work via --resume;
      // otherwise build the normal apply prompt from the comment.
      const prompt = continuing
        ? "前回の作業が途中で終わった可能性があります。これまでの変更を確認し、" +
          "まだ反映されていない指摘や未完了の編集を完了させてください。" +
          "完了したら、これまでと同じJSON形式（status/summary/changedRrIds/commentForReviewer/needsFollowUp）で結果を返してください。"
        : buildApplyPrompt(this.root, this.config, html, comment);
      const result = await runClaude(this.config, this.root, prompt, {
        signal: abort.signal,
        onPid: (pid) => this.queue.markStarted(job.id, pid),
        onProgress: (line) => this.pushProgress(job.id, line),
        resumeSessionId: continuing ? job.sessionId ?? undefined : undefined,
      });
      this.pushProgress(job.id, "差分を確認しています...");

      // Detect on-disk change and compute diff.
      const changed = this.docs.syncFromDisk();
      const diff = computeDiff(this.root, this.docs.absPath(), backupPath);

      if (result.incompleteReason) {
        this.pushProgress(
          job.id,
          `⚠️ 処理が途中で終わった可能性があります（${result.incompleteReason}）。`,
        );
      }
      this.queue.markCompleted(job.id, {
        claudeStatus: result.status,
        summary: result.summary || (changed ? "HTMLが更新されました" : "変更なし"),
        rawOutput: result.rawOutput,
        commentForReviewer: result.commentForReviewer,
        diffText: diff,
        needsFollowUp: result.needsFollowUp,
        incompleteReason: result.incompleteReason,
        sessionId: result.sessionId,
      });
    } catch (err) {
      this.queue.markFailed(
        job.id,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.currentAbort = null;
    }
  }

  /** Process the next queued job, if any and if not busy. */
  async runNext(): Promise<Job | null> {
    if (this.running) throw new Error("既にジョブを処理中です");
    const job = this.queue.nextQueued();
    if (!job) return null;
    this.running = true;
    try {
      await this.runJob(job);
      return this.queue.get(job.id);
    } finally {
      this.running = false;
    }
  }

  /**
   * Drain the queue. Sets queue state to running, then processes jobs one by
   * one until empty, paused, or stop-after-current is set.
   */
  async runAll(): Promise<void> {
    if (this.running) throw new Error("既にジョブを処理中です");
    this.queue.resume();
    await this.drain();
  }

  /**
   * Core drain loop. Processes queued jobs serially while the queue is running
   * and stop-after-current isn't set. Safe to call repeatedly; if already
   * running it returns immediately (the in-flight loop will pick up new jobs).
   */
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        if (this.queue.getQueueState().state !== "running") break;
        const job = this.queue.nextQueued();
        if (!job) break;
        await this.runJob(job);
        if (this.queue.getQueueState().stopAfterCurrent) {
          this.queue.pause();
          this.queue.clearStopAfterCurrent();
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Trigger automatic processing after comments are enqueued. Unless the queue
   * is explicitly paused, this drains in order — comments are "sent in order",
   * not "held until a manual Run". Fire-and-forget; errors are logged per job.
   */
  autoDrain(): void {
    if (this.running) return; // already draining; it will pick up new jobs
    if (this.queue.getQueueState().state !== "running") return; // respect pause
    void this.drain().catch(() => {
      /* per-job failures are recorded on the job; nothing to throw here */
    });
  }
}
