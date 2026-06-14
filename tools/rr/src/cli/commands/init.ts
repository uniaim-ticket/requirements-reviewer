import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_YML,
  INITIAL_PROMPT_MD,
  APPLY_COMMENT_MD,
  STARTER_HTML,
  RR_GITIGNORE,
} from "../templates.js";
import { openDb } from "../../server/db.js";

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
  track(path.join(root, "docs", "requirements", "index.html"), STARTER_HTML);

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
