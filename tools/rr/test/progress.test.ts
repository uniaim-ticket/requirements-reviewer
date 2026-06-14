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

// Fake claude that emits stream-json events (system/assistant tool_use/result)
// just like the real CLI with --output-format stream-json --verbose.
function makeStreamProject(): { root: string; config: RrConfig } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rr-prog-"));
  fs.mkdirSync(path.join(root, ".rr", "prompts"), { recursive: true });
  fs.writeFileSync(path.join(root, ".rr", "prompts", "apply_comment.md"), APPLY_COMMENT_MD);
  fs.mkdirSync(path.join(root, "docs", "requirements"), { recursive: true });
  const doc = path.join(root, "docs", "requirements", "index.html");
  fs.writeFileSync(doc, '<body><p data-rr-id="p-001">old</p></body>');

  const fake = path.join(root, "fake-claude.sh");
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash
DOC="${doc}"
echo '{"type":"system","subtype":"init","session_id":"x"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"対象を修正します"}]}}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"'"$DOC"'"}}]}}'
printf '%s' '<body><p data-rr-id="p-001">NEW</p></body>' > "$DOC"
RESULT='{"status":"applied","summary":"updated","changedRrIds":["p-001"],"commentForReviewer":"ok","needsFollowUp":false}'
echo '{"type":"result","subtype":"success","is_error":false,"duration_ms":1234,"result":"'"$(printf '%s' "$RESULT" | sed 's/"/\\\\"/g')"'"}'
`,
    { mode: 0o755 },
  );

  const config: RrConfig = {
    ...DEFAULT_CONFIG,
    agent: {
      ...DEFAULT_CONFIG.agent,
      command: fake,
      timeout_seconds: 30,
      stream_progress: true,
    },
  };
  return { root, config };
}

describe("stream-json progress + autoDrain", () => {
  let root: string;
  let config: RrConfig;
  let cleanup: string[] = [];

  beforeEach(() => {
    const p = makeStreamProject();
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

  it("captures human-readable progress lines from stream-json", async () => {
    const { comments, queue, worker } = wire();
    const c = comments.create({
      targetType: "line",
      rrId: "p-001",
      comment: "更新して",
    });
    queue.enqueueComments([c.id]);
    const job = await worker.runNext();

    expect(job?.status).toBe("completed");
    expect(job?.claudeStatus).toBe("applied");
    // The progress log should contain the assistant text and a tool action.
    const progress = worker.getProgress();
    const joined = (progress?.log ?? []).join("\n");
    expect(joined).toContain("対象を修正します");
    expect(joined).toMatch(/編集|Edit/);
  });

  it("autoDrain processes queued comments in order without manual run", async () => {
    const { comments, queue, worker } = wire();
    const a = comments.create({ targetType: "global", comment: "A" });
    const b = comments.create({ targetType: "global", comment: "B" });
    queue.enqueueComments([a.id, b.id]);

    // Simulate what the route does after enqueue.
    worker.autoDrain();
    // Wait for the drain to finish (both jobs).
    for (let i = 0; i < 100 && (worker.isBusy() || queue.nextQueued()); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const jobs = queue.list();
    expect(jobs.every((j) => j.status === "completed")).toBe(true);
    expect(jobs).toHaveLength(2);
  });
});
