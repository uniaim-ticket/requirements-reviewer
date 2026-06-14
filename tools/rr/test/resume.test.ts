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

// Fake claude that: records its argv to args.log, emits a session_id + usage,
// and edits the doc. Lets us assert --resume is passed on the 2nd run.
function makeProject(): { root: string; config: RrConfig; argsLog: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rr-resume-"));
  fs.mkdirSync(path.join(root, ".rr", "prompts"), { recursive: true });
  fs.writeFileSync(path.join(root, ".rr", "prompts", "apply_comment.md"), APPLY_COMMENT_MD);
  fs.mkdirSync(path.join(root, "docs", "requirements"), { recursive: true });
  const doc = path.join(root, "docs", "requirements", "index.html");
  fs.writeFileSync(doc, '<body><p data-rr-id="p-001">old</p></body>');
  const argsLog = path.join(root, "args.log");

  const fake = path.join(root, "fake-claude.sh");
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash
# Record argv as one delimited record per invocation (prompt may be multiline).
printf '<<<ARGS>>>%s<<<END>>>\\n' "$*" >> "${argsLog}"
DOC="${doc}"
printf '%s' '<body><p data-rr-id="p-001">new</p></body>' > "$DOC"
echo '{"type":"system","subtype":"init","session_id":"sess-abc"}'
RESULT='{"status":"applied","summary":"反映しました","changedRrIds":["p-001"],"commentForReviewer":"ok","needsFollowUp":false}'
echo '{"type":"result","subtype":"success","is_error":false,"session_id":"sess-abc","duration_ms":10,"result":"'"$(printf '%s' "$RESULT" | sed 's/"/\\\\"/g')"'","usage":{"input_tokens":1000,"cache_read_input_tokens":4000,"cache_creation_input_tokens":500,"output_tokens":200},"modelUsage":{"claude-x":{"contextWindow":200000,"maxOutputTokens":64000}}}'
`,
    { mode: 0o755 },
  );

  const config: RrConfig = {
    ...DEFAULT_CONFIG,
    agent: { ...DEFAULT_CONFIG.agent, command: fake, timeout_seconds: 30 },
  };
  return { root, config, argsLog };
}

describe("resume-by-default + token usage + digest", () => {
  let root: string;
  let config: RrConfig;
  let argsLog: string;
  let cleanup: string[] = [];

  beforeEach(() => {
    const p = makeProject();
    root = p.root;
    config = p.config;
    argsLog = p.argsLog;
    cleanup.push(root);
  });
  afterEach(() => {
    for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
    cleanup = [];
  });

  function wire(cfg = config) {
    const db = new Database(":memory:");
    runMigrations(db);
    const docs = new DocumentService(db, root, cfg);
    docs.ensureRecord();
    const ver = () => docs.getInfo()!.currentVersion;
    const comments = new CommentService(db, "index", ver);
    const queue = new QueueService(db, "index", ver, comments);
    const worker = new WorkerService(cfg, root, docs, queue);
    return { docs, comments, queue, worker };
  }

  it("first job runs new; captures usage + session", async () => {
    const { comments, queue, worker } = wire();
    const c = comments.create({ targetType: "line", rrId: "p-001", comment: "x" });
    queue.enqueueComments([c.id]);
    const job = await worker.runNext();

    expect(job?.usedResume).toBe(false);
    expect(job?.sessionId).toBe("sess-abc");
    expect(job?.usage?.totalInputTokens).toBe(5500); // 1000 + 4000 + 500
    expect(job?.usage?.contextWindow).toBe(200000);
    expect(job?.usage?.maxOutputTokens).toBe(64000);

    const runs = readRuns(argsLog);
    expect(runs[0]).not.toContain("--resume");
  });

  it("second job resumes the document session by default", async () => {
    const { docs, comments, queue, worker } = wire();
    const c1 = comments.create({ targetType: "line", rrId: "p-001", comment: "one" });
    queue.enqueueComments([c1.id]);
    await worker.runNext();
    expect(docs.getDocSession("index")).toBe("sess-abc");

    const c2 = comments.create({ targetType: "line", rrId: "p-001", comment: "two" });
    queue.enqueueComments([c2.id]);
    const job2 = await worker.runNext();

    expect(job2?.usedResume).toBe(true);
    const runs = readRuns(argsLog);
    expect(runs[1]).toContain("--resume sess-abc");
    // A digest of prior work accumulates for fallback recall.
    expect(docs.getDigest("index")).toContain("反映");
  });

  it("with resume_session disabled, injects digest instead of --resume", async () => {
    const cfg: RrConfig = {
      ...config,
      agent: { ...config.agent, resume_session: false },
    };
    const { comments, queue, worker } = wire(cfg);
    const c1 = comments.create({ targetType: "line", rrId: "p-001", comment: "one" });
    queue.enqueueComments([c1.id]);
    await worker.runNext();
    const c2 = comments.create({ targetType: "line", rrId: "p-001", comment: "two" });
    queue.enqueueComments([c2.id]);
    const job2 = await worker.runNext();

    expect(job2?.usedResume).toBe(false);
    const runs = readRuns(argsLog);
    expect(runs.join("\n")).not.toContain("--resume");
  });

  it("explicit 'fresh' rerun bypasses the doc-session resume", async () => {
    const { comments, queue, worker } = wire();
    const c = comments.create({ targetType: "line", rrId: "p-001", comment: "x" });
    queue.enqueueComments([c.id]);
    const job1 = await worker.runNext();

    // Re-run fresh: even though a doc session now exists, it must NOT resume.
    queue.requeue(job1!.id, "fresh");
    const job2 = await worker.runNext();
    expect(job2?.forceFresh).toBe(true);
    expect(job2?.usedResume).toBe(false);

    // The "continue" rerun, by contrast, resumes the job's own session.
    queue.requeue(job1!.id, "continue");
    const job3 = await worker.runNext();
    expect(job3?.usedResume).toBe(true);
  });
});

/** Split the args log into one string per claude invocation. */
function readRuns(argsLog: string): string[] {
  const raw = fs.existsSync(argsLog) ? fs.readFileSync(argsLog, "utf8") : "";
  return raw
    .split("<<<ARGS>>>")
    .slice(1)
    .map((s) => s.split("<<<END>>>")[0]);
}
