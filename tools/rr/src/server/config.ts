import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface RrConfig {
  document: {
    path: string;
    title: string;
  };
  agent: {
    type: string;
    command: string;
    cwd: string;
    timeout_seconds: number;
    /**
     * Permission mode passed to `claude --permission-mode`. In headless (-p)
     * mode, the default "default" mode ABORTS when a tool needs approval, so
     * file edits never happen. "acceptEdits" auto-approves file writes in the
     * working directory, which is what rr needs to edit the HTML autonomously.
     */
    permission_mode: string;
    /** Extra args appended verbatim to the claude invocation. */
    extra_args: string[];
    /**
     * Use --output-format stream-json --verbose to surface realtime,
     * structured progress (assistant text / tool use) in the UI. Default true.
     */
    stream_progress: boolean;
    /**
     * Reuse the previous Claude session per document by default (--resume), so
     * later comments are processed with the deepened understanding from earlier
     * ones. Default true. When a session can't be resumed, rr falls back to
     * injecting a context digest into the prompt instead.
     */
    resume_session: boolean;
  };
  queue: {
    auto_run: boolean;
    mode: string;
    state: "paused" | "running";
  };
  server: {
    host: string;
    port: number;
  };
  review: {
    id_attribute: string;
    auto_inject_ids: boolean;
  };
}

export const DEFAULT_CONFIG: RrConfig = {
  document: {
    path: "docs/requirements/index.html",
    title: "要件定義レビュー",
  },
  agent: {
    type: "claude-code",
    command: "claude",
    cwd: ".",
    timeout_seconds: 600,
    permission_mode: "acceptEdits",
    extra_args: [],
    stream_progress: true,
    resume_session: true,
  },
  queue: {
    auto_run: false,
    mode: "sequential",
    state: "paused",
  },
  server: {
    host: "127.0.0.1",
    port: 5177,
  },
  review: {
    id_attribute: "data-rr-id",
    auto_inject_ids: true,
  },
};

export const RR_DIR = ".rr";
export const CONFIG_FILE = "config.yml";
export const DB_FILE = "rr.db";

/** Resolve the project root by looking for an .rr directory upward from cwd. */
export function findProjectRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, RR_DIR, CONFIG_FILE))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireProjectRoot(start?: string): string {
  const root = findProjectRoot(start);
  if (!root) {
    throw new Error(
      "rr プロジェクトが見つかりません。先に `rr init` を実行してください。",
    );
  }
  return root;
}

export function configPath(root: string): string {
  return path.join(root, RR_DIR, CONFIG_FILE);
}

export function dbPath(root: string): string {
  return path.join(root, RR_DIR, DB_FILE);
}

export function loadConfig(root: string): RrConfig {
  const file = configPath(root);
  if (!fs.existsSync(file)) {
    throw new Error(`設定ファイルが見つかりません: ${file}`);
  }
  const raw = YAML.parse(fs.readFileSync(file, "utf8")) ?? {};
  // Shallow-merge with defaults so older/partial config files still work.
  return {
    document: { ...DEFAULT_CONFIG.document, ...raw.document },
    agent: { ...DEFAULT_CONFIG.agent, ...raw.agent },
    queue: { ...DEFAULT_CONFIG.queue, ...raw.queue },
    server: { ...DEFAULT_CONFIG.server, ...raw.server },
    review: { ...DEFAULT_CONFIG.review, ...raw.review },
  };
}

export function documentAbsPath(root: string, config: RrConfig): string {
  return path.resolve(root, config.document.path);
}
