import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_YML,
  INITIAL_PROMPT_MD,
  APPLY_COMMENT_MD,
  DIAGRAMS_MD,
  STARTER_HTML,
  RR_GITIGNORE,
} from "../templates.js";
import { DEFAULT_CONFIG } from "../../server/config.js";
import { openDb } from "../../server/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the vendored Mermaid version + its SRI hash from assets/vendor.lock so
 * the generated diagrams.md points at a real, hash-pinned file. Falls back to
 * the default version with an empty integrity (the loader still works; SRI is
 * an added safety net) when the lock file isn't present.
 */
function resolveMermaidVendor(): { version: string; integrity: string } {
  const version = DEFAULT_CONFIG.diagrams.mermaid_version;
  const lock = path.resolve(__dirname, "../../../assets/vendor/vendor.lock");
  try {
    const line = fs
      .readFileSync(lock, "utf8")
      .split("\n")
      .find((l) => l.startsWith("mermaid "));
    if (line) {
      const [, v, integrity] = line.trim().split(/\s+/);
      return { version: v ?? version, integrity: integrity ?? "" };
    }
  } catch {
    /* lock missing: fall through to defaults */
  }
  return { version, integrity: "" };
}

function writeIfMissing(file: string, content: string): boolean {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return true;
}

export function runInit(cwd: string = process.cwd()): void {
  const root = path.resolve(cwd);
  const rrDir = path.join(root, ".rr");
  const promptsDir = path.join(rrDir, "prompts");

  const created: string[] = [];
  const skipped: string[] = [];

  const track = (file: string, content: string) => {
    const rel = path.relative(root, file);
    if (writeIfMissing(file, content)) created.push(rel);
    else skipped.push(rel);
  };

  track(path.join(rrDir, ".gitignore"), RR_GITIGNORE);
  track(path.join(rrDir, "config.yml"), CONFIG_YML);
  track(path.join(promptsDir, "initial.md"), INITIAL_PROMPT_MD);
  track(path.join(promptsDir, "apply_comment.md"), APPLY_COMMENT_MD);
  const mermaid = resolveMermaidVendor();
  const fillMermaid = (s: string) =>
    s
      .replaceAll("{{mermaid_version}}", mermaid.version)
      .replaceAll("{{mermaid_integrity}}", mermaid.integrity);
  track(path.join(promptsDir, "diagrams.md"), fillMermaid(DIAGRAMS_MD));
  track(
    path.join(root, "docs", "requirements", "index.html"),
    fillMermaid(STARTER_HTML),
  );

  // Initialize the SQLite DB (runs migrations).
  const dbFile = path.join(rrDir, "rr.db");
  openDb(dbFile);
  if (!skipped.includes(path.relative(root, dbFile))) {
    created.push(path.relative(root, dbFile));
  }

  // eslint-disable-next-line no-console
  console.log("rr init 完了\n");
  if (created.length) {
    // eslint-disable-next-line no-console
    console.log("作成:");
    created.forEach((f) => console.log(`  + ${f}`));
  }
  if (skipped.length) {
    // eslint-disable-next-line no-console
    console.log("\n既存のためスキップ:");
    skipped.forEach((f) => console.log(`  = ${f}`));
  }
  // eslint-disable-next-line no-console
  console.log("\n次のステップ:\n  rr serve\n  rr generate --prompt \"...\"");
}
