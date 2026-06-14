import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../src/server/migrations.js";
import { CommentService } from "../src/server/services/commentService.js";
import { QueueService } from "../src/server/services/queueService.js";
import { DocumentService } from "../src/server/services/documentService.js";
import { WorkerService } from "../src/server/services/workerService.js";
import { DEFAULT_CONFIG, type RrConfig } from "../src/server/config.js";
import { APPLY_COMMENT_MD } from "../src/cli/templates.js";

// Fake claude that emits a session_id and reports needsFollowUp:true via the
// stream-json result event — i.e. an "incomplete" run.
function makeProject(): { root: string; config: RrConfig } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rr-rerun-"));
  fs.mkdirSync(path.join(root, ".rr", "prompts"), { recursive: true });
  fs.writeFileSync(path.join(root, ".rr", "prompts", "apply_comment.md"), APPLY_COMMENT_MD);
  fs.mkdirSync(path.join(root, "docs", "requirements"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "requirements", "index.html"),
    '<body><p data-rr-id="p-001">old</p></body>',
  );

  const doc = path.join(root, "docs", "requirements", "index.html");
  const fake = path.join(root, "fake-claude.sh");
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash
DOC="${doc}"
echo '{"type":"system","subtype":"init","session_id":"sess-123"}'
printf '%s' '<body><p data-rr-id="p-001">partial</p></body>' > "$DOC"
RESULT='{"status":"partially_applied","summary":"一部のみ","changedRrIds":["p-001"],"commentForReviewer":"続きが必要","needsFollowUp":true}'
echo '{"type":"result","subtype":"success","is_error":false,"session_id":"sess-123","duration_ms":10,"result":"'"$(printf '%s' "$RESULT" | sed 's/"/\\\\"/g')"'"}'
`,
    { mode: 0o755 },
  );

  const config: RrConfig = {
    ...DEFAULT_CONFIG,
    agent: { ...DEFAULT_CONFIG.agent, command: fake, timeout_seconds: 30 },
  };
  return { root, config };
}

describe("incomplete detection + rerun/continue", () => {
  let root: string;
  let config: RrConfig;
  let cleanup: string[] = [];

  beforeEach(() => {
    const p = makeProject();
    root = p.root;
    config = p.config;
    cleanup.push(root);
  });
  afterEach(() => {
    for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
    cleanup = [];
  });

  function wire() {
    const db = new Database(":memory:");
    runMigrations(db);
    const docs = new DocumentService(db, root, config);
    docs.ensureRecord();
    const ver = () => docs.getInfo()!.currentVersion;
    const comments = new CommentService(db, "index", ver);
    const queue = new QueueService(db, "index", ver, comments);
    const worker = new WorkerService(config, root, docs, queue);
    return { docs, comments, queue, worker };
  }

  it("flags an incomplete run and keeps the comment unfinished", async () => {
    const { comments, queue, worker } = wire();
    const c = comments.create({ targetType: "line", rrId: "p-001", comment: "x" });
    queue.enqueueComments([c.id]);
    const job = await worker.runNext();

    expect(job?.status).toBe("completed");
    expect(job?.incompleteReason).toBeTruthy(); // needs_follow_up / status:partially_applied
    expect(job?.sessionId).toBe("sess-123");
    expect(job?.needsFollowUp).toBe(true);
    // Comment is NOT marked applied since the run looked incomplete.
    expect(comments.get(c.id)?.status).toBe("queued");
  });

  it("requeue 'continue' keeps the session; 'fresh' clears it", async () => {
    const { comments, queue, worker } = wire();
    const c = comments.create({ targetType: "line", rrId: "p-001", comment: "x" });
    queue.enqueueComments([c.id]);
    const job = (await worker.runNext())!;

    const cont = queue.requeue(job.id, "continue");
    expect(cont?.status).toBe("queued");
    expect(cont?.sessionId).toBe("sess-123");
    expect(cont?.attempt).toBe(2);

    // Run it again, then re-queue fresh: session should be cleared.
    await worker.runNext();
    const fresh = queue.requeue(job.id, "fresh");
    expect(fresh?.sessionId).toBeNull();
    expect(fresh?.attempt).toBe(3);
  });
});
