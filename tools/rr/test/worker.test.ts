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

// Build a temp project with a fake `claude` command that rewrites the HTML
// and prints the result JSON (RFP §13: CLI実行, §7: 最終報告 Claude実行mock).
function makeProject(): { root: string; config: RrConfig } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rr-test-"));
  fs.mkdirSync(path.join(root, ".rr", "prompts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".rr", "prompts", "apply_comment.md"),
    APPLY_COMMENT_MD,
  );
  fs.mkdirSync(path.join(root, "docs", "requirements"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "requirements", "index.html"),
    '<body><p data-rr-id="p-001">old</p></body>',
  );

  // Fake claude: ignores prompt, edits the doc, emits result JSON.
  const fakeClaude = path.join(root, "fake-claude.sh");
  fs.writeFileSync(
    fakeClaude,
    `#!/usr/bin/env bash
DOC="${path.join(root, "docs", "requirements", "index.html")}"
printf '%s' '<body><p data-rr-id="p-001">NEW CONTENT</p></body>' > "$DOC"
echo '{"status":"applied","summary":"updated p-001","changedRrIds":["p-001"],"commentForReviewer":"反映しました","needsFollowUp":false}'
`,
    { mode: 0o755 },
  );

  const config: RrConfig = {
    ...DEFAULT_CONFIG,
    agent: { ...DEFAULT_CONFIG.agent, command: fakeClaude, timeout_seconds: 30 },
  };
  return { root, config };
}

describe("WorkerService (mocked claude)", () => {
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
    for (const dir of cleanup) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    cleanup = [];
  });

  it("runs a job: backup, claude edit, diff, completion", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const docs = new DocumentService(db, root, config);
    docs.ensureRecord();
    const comments = new CommentService(db, "main", () => docs.getInfo()!.currentVersion);
    const queue = new QueueService(db, "main", () => docs.getInfo()!.currentVersion, comments);
    const worker = new WorkerService(config, root, docs, queue);

    const c = comments.create({
      targetType: "line",
      rrId: "p-001",
      selectedText: "old",
      comment: "本文を更新して",
    });
    const [job] = queue.enqueueComments([c.id]);

    const result = await worker.runNext();
    expect(result?.status).toBe("completed");
    expect(result?.claudeStatus).toBe("applied");
    expect(result?.claudeSummary).toContain("updated p-001");

    // Document was rewritten.
    expect(docs.readHtml()).toContain("NEW CONTENT");

    // Diff captured the change.
    expect(result?.diffText ?? "").toContain("NEW CONTENT");

    // Backup created.
    const backups = fs.readdirSync(path.join(root, ".rr", "backups"));
    expect(backups.length).toBeGreaterThan(0);

    // Comment marked applied.
    expect(comments.get(c.id)?.status).toBe("applied");
    void job;
  });

  it("marks job failed when claude command does not exist", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const badConfig: RrConfig = {
      ...config,
      agent: { ...config.agent, command: "/nonexistent/claude-binary" },
    };
    const docs = new DocumentService(db, root, badConfig);
    docs.ensureRecord();
    const comments = new CommentService(db, "main", () => 1);
    const queue = new QueueService(db, "main", () => 1, comments);
    const worker = new WorkerService(badConfig, root, docs, queue);

    const c = comments.create({ targetType: "global", comment: "x" });
    queue.enqueueComments([c.id]);
    const result = await worker.runNext();
    expect(result?.status).toBe("failed");
    expect(result?.errorMessage).toBeTruthy();
  });
});
