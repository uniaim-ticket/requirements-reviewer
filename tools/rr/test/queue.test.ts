import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/server/migrations.js";
import { CommentService } from "../src/server/services/commentService.js";
import { QueueService } from "../src/server/services/queueService.js";

function setup() {
  const db = new Database(":memory:");
  runMigrations(db);
  const comments = new CommentService(db, "main", () => 1);
  const queue = new QueueService(db, "main", () => 1, comments);
  return { db, comments, queue };
}

describe("QueueService", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it("enqueues one job per comment and marks comments queued", () => {
    const c1 = env.comments.create({ targetType: "global", comment: "a" });
    const c2 = env.comments.create({ targetType: "global", comment: "b" });
    const jobs = env.queue.enqueueComments([c1.id, c2.id]);
    expect(jobs).toHaveLength(2);
    expect(env.comments.get(c1.id)?.status).toBe("queued");
    expect(env.queue.list()).toHaveLength(2);
  });

  it("returns the next queued job by position", () => {
    const c1 = env.comments.create({ targetType: "global", comment: "first" });
    const c2 = env.comments.create({ targetType: "global", comment: "second" });
    env.queue.enqueueComments([c1.id, c2.id]);
    const next = env.queue.nextQueued();
    expect(next?.comments[0].comment).toBe("first");
  });

  it("manages queue pause/resume/stop state", () => {
    // Default is "running": comments are processed in order automatically.
    expect(env.queue.getQueueState().state).toBe("running");
    env.queue.pause();
    expect(env.queue.getQueueState().state).toBe("paused");
    env.queue.resume();
    expect(env.queue.getQueueState().state).toBe("running");
    env.queue.stopAfterCurrent();
    expect(env.queue.getQueueState().stopAfterCurrent).toBe(true);
    env.queue.pause();
    expect(env.queue.getQueueState().state).toBe("paused");
  });

  it("removes a queued job and restores comment to draft", () => {
    const c = env.comments.create({ targetType: "global", comment: "x" });
    const [job] = env.queue.enqueueComments([c.id]);
    expect(env.queue.remove(job.id)).toBe(true);
    expect(env.queue.list()).toHaveLength(0);
    expect(env.comments.get(c.id)?.status).toBe("draft");
  });

  it("reorders queued jobs", () => {
    const ids = ["a", "b", "c"].map(
      (t) => env.comments.create({ targetType: "global", comment: t }).id,
    );
    const jobs = env.queue.enqueueComments(ids);
    // move last job to front
    env.queue.reorder(jobs[2].id, 1);
    const ordered = env.queue.list().map((j) => j.comments[0].comment);
    expect(ordered[0]).toBe("c");
  });

  it("marks job completed and applies its comments", () => {
    const c = env.comments.create({ targetType: "global", comment: "x" });
    const [job] = env.queue.enqueueComments([c.id]);
    env.queue.markStarted(job.id, 1234);
    env.queue.markCompleted(job.id, {
      claudeStatus: "applied",
      summary: "done",
      rawOutput: "{}",
      commentForReviewer: "ok",
      diffText: "diff",
    });
    const done = env.queue.get(job.id);
    expect(done?.status).toBe("completed");
    expect(done?.diffText).toBe("diff");
    expect(env.comments.get(c.id)?.status).toBe("applied");
  });
});
