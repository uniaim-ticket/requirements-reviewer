import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RrConfig } from "../config.js";
import type { ClaudeStatus, Comment, TargetType } from "../../shared/types.js";
import { extractTarget } from "./rrIdService.js";

export interface PreflightResult {
  ok: boolean;
  /** Whether the configured agent command was found and runnable. */
  commandFound: boolean;
  version: string | null;
  loggedIn: boolean | null;
  authMethod: string | null;
  apiProvider: string | null;
  /** Human-readable problem to surface to the reviewer, if any. */
  message: string;
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, env: process.env, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ code: null, stdout, stderr, spawnError: err });
          return;
        }
        const code = err && typeof (err as { code?: number }).code === "number"
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/**
 * Verify the agent is runnable and authenticated BEFORE a long generation, so
 * a "no login" / missing-command situation surfaces immediately instead of
 * looking like a stuck 0s generation. Uses `claude auth status --json` which
 * returns {loggedIn, authMethod, apiProvider} non-interactively.
 */
export async function preflight(
  config: RrConfig,
  root: string,
): Promise<PreflightResult> {
  const cwd = path.resolve(root, config.agent.cwd || ".");
  const cmd = config.agent.command;

  const ver = await run(cmd, ["--version"], cwd, 10000);
  if (ver.spawnError) {
    return {
      ok: false,
      commandFound: false,
      version: null,
      loggedIn: null,
      authMethod: null,
      apiProvider: null,
      message: `エージェントコマンド "${cmd}" が見つかりません。PATH を確認するか、.rr/config.yml の agent.command を設定してください。`,
    };
  }
  const version = ver.stdout.trim() || null;

  // auth status is claude-code specific; tolerate other agents gracefully.
  const auth = await run(cmd, ["auth", "status", "--json"], cwd, 10000);
  let loggedIn: boolean | null = null;
  let authMethod: string | null = null;
  let apiProvider: string | null = null;
  try {
    const j = JSON.parse(auth.stdout);
    loggedIn = typeof j.loggedIn === "boolean" ? j.loggedIn : null;
    authMethod = j.authMethod ?? null;
    apiProvider = j.apiProvider ?? null;
  } catch {
    // auth status unavailable/unparseable: don't block, just can't confirm.
  }

  if (loggedIn === false) {
    return {
      ok: false,
      commandFound: true,
      version,
      loggedIn,
      authMethod,
      apiProvider,
      message:
        "Claude が未ログインです。`claude auth login`（または ANTHROPIC_API_KEY の設定）を行ってから再実行してください。",
    };
  }

  return {
    ok: true,
    commandFound: true,
    version,
    loggedIn,
    authMethod,
    apiProvider,
    message:
      loggedIn === null
        ? "ログイン状態を確認できませんでした（auth status 非対応の可能性）。実行は試みます。"
        : `ログイン済み（${authMethod ?? "?"} / ${apiProvider ?? "?"}）`,
  };
}

export interface ClaudeResult {
  status: ClaudeStatus;
  summary: string;
  changedRrIds: string[];
  commentForReviewer: string;
  needsFollowUp: boolean;
  rawOutput: string;
  pid: number | null;
  /** Claude Code session id (for --resume continuation), if available. */
  sessionId: string | null;
  /**
   * Non-null when the run looks incomplete and likely needs another pass:
   * "max_tokens" (output truncated), "error" (agent reported failure),
   * "needs_follow_up" (model flagged follow-up), or "status:<claudeStatus>"
   * for partially_applied / needs_human_review / conflicted.
   */
  incompleteReason: string | null;
}

function readPrompt(root: string, name: string): string {
  const p = path.join(root, ".rr", "prompts", name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function describeTarget(c: Comment): string {
  switch (c.targetType) {
    case "global":
      return "成果物全体";
    case "table_row":
      return `表 ${c.tableRrId ?? ""} の行 ${c.rrId ?? c.rowIndex ?? ""}`;
    case "table_cell":
      return `表セル ${c.rrId ?? ""}`;
    default:
      return `要素 ${c.rrId ?? ""}（選択テキスト: ${c.selectedText ?? "—"}）`;
  }
}

/**
 * Build the apply-comment prompt by filling the template in
 * .rr/prompts/apply_comment.md with the comment's context.
 */
export function buildApplyPrompt(
  root: string,
  config: RrConfig,
  documentHtml: string,
  comment: Comment,
): string {
  const template = readPrompt(root, "apply_comment.md");
  let targetHtml = "";
  let contextHtml = "";
  if (comment.targetType === "global") {
    contextHtml = "（成果物全体が対象です。下記の対象HTMLを参照してください。）";
    targetHtml = documentHtml.slice(0, 20000);
  } else if (comment.rrId) {
    const ex = extractTarget(
      documentHtml,
      comment.rrId,
      config.review.id_attribute,
    );
    targetHtml = ex.targetHtml ?? "(対象要素が見つかりませんでした)";
    contextHtml = ex.contextHtml ?? "";
  }

  const replacements: Record<string, string> = {
    document_path: config.document.path,
    target_type: comment.targetType,
    target_description: describeTarget(comment),
    comment: comment.comment,
    target_html: targetHtml,
    context_html: contextHtml,
  };

  let out = template;
  for (const [key, val] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${key}}}`, val);
  }
  return out;
}

/** Build the initial-generation prompt (RFP §7). outputPath defaults to config. */
export function buildGeneratePrompt(
  root: string,
  config: RrConfig,
  userPrompt?: string,
  outputPath?: string,
): string {
  const target = outputPath ?? config.document.path;
  const base = readPrompt(root, "initial.md");
  if (!userPrompt) {
    // Keep the template but ensure the output path matches the target file.
    return base.replace(config.document.path, target);
  }
  return [
    "[人間の指示]",
    userPrompt,
    "",
    "[出力形式]",
    `- ${target} に単一HTMLとして出力してください`,
    "- 日本語で書いてください",
    "- 見出し、本文、表、補足枠、比較案を使って読みやすく整理してください",
    `- レビュー可能な主要要素に ${config.review.id_attribute} を付与してください`,
    "- 確定事項、推測、未確認事項をできるだけ分けてください",
  ].join("\n");
}

const JSON_BLOCK = /\{[\s\S]*\}/;

function parseResult(
  raw: string,
): Omit<ClaudeResult, "rawOutput" | "pid" | "sessionId" | "incompleteReason"> {
  const match = raw.match(JSON_BLOCK);
  if (match) {
    try {
      const j = JSON.parse(match[0]);
      return {
        status: (j.status as ClaudeStatus) ?? "applied",
        summary: j.summary ?? "",
        changedRrIds: Array.isArray(j.changedRrIds) ? j.changedRrIds : [],
        commentForReviewer: j.commentForReviewer ?? "",
        needsFollowUp: Boolean(j.needsFollowUp),
      };
    } catch {
      // fall through
    }
  }
  // No parseable JSON: treat as applied but surface raw text to the reviewer.
  return {
    status: "applied",
    summary: "",
    changedRrIds: [],
    commentForReviewer: raw.slice(0, 2000),
    needsFollowUp: false,
  };
}

export interface RunOptions {
  signal?: AbortSignal;
  onPid?: (pid: number) => void;
  /** Called incrementally with the agent's stdout/stderr as it streams. */
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  /** Called with human-readable progress lines derived from stream-json. */
  onProgress?: (line: string) => void;
  /** Resume a prior Claude Code session (--resume) to continue where it left off. */
  resumeSessionId?: string;
}

/** Format a single stream-json event into a human-readable progress line. */
function formatStreamEvent(j: Record<string, unknown>): string | null {
  const type = j.type as string;
  if (type === "system") return null; // init noise
  if (type === "assistant") {
    const msg = j.message as { content?: Array<Record<string, unknown>> };
    const lines: string[] = [];
    for (const c of msg?.content ?? []) {
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
        lines.push(`💬 ${(c.text as string).trim()}`);
      } else if (c.type === "tool_use") {
        lines.push(formatToolUse(c.name as string, c.input as Record<string, unknown>));
      }
    }
    return lines.length ? lines.join("\n") : null;
  }
  if (type === "user") {
    // Tool results are mostly verbose; show a concise confirmation only.
    const msg = j.message as { content?: Array<Record<string, unknown>> };
    for (const c of msg?.content ?? []) {
      if (c.type === "tool_result" && c.is_error) return "⚠️ ツール実行でエラーが発生しました";
    }
    return null;
  }
  if (type === "result") {
    const dur = typeof j.duration_ms === "number" ? Math.round(j.duration_ms / 1000) : null;
    if (j.is_error) return `❌ エージェントがエラーを返しました${dur ? `（${dur}s）` : ""}`;
    return null; // success handled by caller
  }
  return null;
}

function shorten(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatToolUse(name: string, input: Record<string, unknown>): string {
  const file = (input?.file_path ?? input?.path) as string | undefined;
  const base = file ? file.split("/").slice(-2).join("/") : "";
  switch (name) {
    case "Write":
      return `📝 ファイルを作成/書き込み: ${base}`;
    case "Edit":
    case "NotebookEdit":
      return `✏️ ファイルを編集: ${base}`;
    case "Read":
      return `📖 ファイルを読み込み: ${base}`;
    case "Bash": {
      const cmd = (input?.command as string) ?? "";
      return `⚙️ コマンド実行: ${shorten(cmd, 70)}`;
    }
    case "Grep":
      return `🔎 検索: ${shorten((input?.pattern as string) ?? "", 50)}`;
    case "Glob":
      return `🗂️ ファイル探索: ${shorten((input?.pattern as string) ?? "", 50)}`;
    case "Task":
      return `🤖 サブエージェント実行`;
    case "WebFetch":
    case "WebSearch":
      return `🌐 Web参照`;
    default:
      return `🔧 ${name}`;
  }
}

/**
 * Run the configured agent command with `-p <prompt>`. Returns the parsed
 * result. Rejects on non-zero exit or timeout.
 */
export function runClaude(
  config: RrConfig,
  root: string,
  prompt: string,
  opts: RunOptions = {},
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const cwd = path.resolve(root, config.agent.cwd || ".");
    // Build the argv. The permission mode is essential: without it, headless
    // `claude -p` aborts when a tool (Edit/Write) needs approval, so the HTML
    // is never modified. "acceptEdits" auto-approves edits in the cwd.
    // stream-json + verbose gives realtime, structured progress (assistant
    // text, tool_use, result) which we turn into a readable progress log.
    const streamJson = config.agent.stream_progress !== false;
    const args = ["-p", prompt];
    if (config.agent.permission_mode) {
      args.push("--permission-mode", config.agent.permission_mode);
    }
    if (opts.resumeSessionId) {
      // Continue the previous session instead of starting fresh.
      args.push("--resume", opts.resumeSessionId);
    }
    if (streamJson) {
      args.push("--output-format", "stream-json", "--verbose");
    }
    if (Array.isArray(config.agent.extra_args)) {
      args.push(...config.agent.extra_args);
    }
    const child = spawn(config.agent.command, args, {
      cwd,
      env: process.env,
      // Close stdin so claude doesn't wait ~3s for piped input before starting
      // (it warns "no stdin data received in 3s" otherwise). stdout/stderr piped.
      stdio: ["ignore", "pipe", "pipe"],
    });
    opts.onPid?.(child.pid ?? -1);

    let stdout = "";
    let stderr = "";
    let lineBuf = "";
    // Captured from the stream-json "result" event (final answer text).
    let resultText: string | null = null;
    let sessionId: string | null = null;
    let stopReason: string | null = null;
    let resultIsError = false;
    const timeoutMs = config.agent.timeout_seconds * 1000;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Claude 実行がタイムアウトしました (${config.agent.timeout_seconds}s)`));
    }, timeoutMs);

    const onAbort = () => {
      child.kill("SIGTERM");
      reject(new Error("ジョブがキャンセルされました"));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const handleJsonLine = (line: string) => {
      if (!line.trim()) return;
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof j.session_id === "string") sessionId = j.session_id as string;
      if (j.type === "assistant") {
        const m = j.message as { stop_reason?: string | null } | undefined;
        if (m && typeof m.stop_reason === "string") stopReason = m.stop_reason;
      }
      if (j.type === "result") {
        if (typeof j.result === "string") resultText = j.result as string;
        if (j.is_error) resultIsError = true;
        if (typeof j.stop_reason === "string") stopReason = j.stop_reason as string;
      }
      const progress = formatStreamEvent(j);
      if (progress) opts.onProgress?.(progress);
    };

    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (streamJson) {
        lineBuf += s;
        let idx: number;
        while ((idx = lineBuf.indexOf("\n")) >= 0) {
          const line = lineBuf.slice(0, idx);
          lineBuf = lineBuf.slice(idx + 1);
          handleJsonLine(line);
        }
      } else {
        opts.onOutput?.(s, "stdout");
      }
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      opts.onOutput?.(s, "stderr");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(
        new Error(
          `Claude コマンドの起動に失敗しました (${config.agent.command}): ${err.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (streamJson && lineBuf.trim()) handleJsonLine(lineBuf);
      const raw = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
      if (code !== 0) {
        reject(new Error(`Claude が異常終了しました (exit ${code}): ${stderr.slice(0, 500)}`));
        return;
      }
      // The apply-comment prompt asks for a JSON result object; it appears in
      // the final result text (stream-json) or directly in stdout (text mode).
      const parsed = parseResult(resultText ?? stdout);

      // Decide whether the run looks incomplete (=> offer continue / retry).
      let incompleteReason: string | null = null;
      if (resultIsError) incompleteReason = "error";
      else if (stopReason === "max_tokens") incompleteReason = "max_tokens";
      else if (parsed.needsFollowUp) incompleteReason = "needs_follow_up";
      else if (
        parsed.status === "partially_applied" ||
        parsed.status === "needs_human_review" ||
        parsed.status === "conflicted"
      ) {
        incompleteReason = `status:${parsed.status}`;
      }

      resolve({
        ...parsed,
        rawOutput: raw,
        pid: child.pid ?? null,
        sessionId,
        incompleteReason,
      });
    });
  });
}

export type { TargetType };
