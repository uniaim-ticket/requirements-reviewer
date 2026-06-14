import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** True if the given file is tracked by git. */
function isGitTracked(root: string, filePath: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", filePath], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Produce a unified diff for the document. If git-tracked, use `git diff`.
 * Otherwise fall back to a string diff between the pre-run backup and the
 * current on-disk file.
 */
export function computeDiff(
  root: string,
  absFilePath: string,
  backupPath: string | null,
): string {
  const rel = path.relative(root, absFilePath);
  if (isGitTracked(root, rel)) {
    try {
      const out = execFileSync("git", ["diff", "--", rel], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      });
      if (out.trim()) return out;
    } catch {
      // fall through to string diff
    }
  }
  if (backupPath && fs.existsSync(backupPath) && fs.existsSync(absFilePath)) {
    const before = fs.readFileSync(backupPath, "utf8");
    const after = fs.readFileSync(absFilePath, "utf8");
    return stringDiff(before, after, rel);
  }
  return "";
}

/** Minimal line-based unified-style diff (no external deps). */
export function stringDiff(before: string, after: string, label: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  if (before === after) return "";

  // LCS-based diff for reasonable output on small HTML files.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) lines.push(`- ${a[i++]}`);
  while (j < m) lines.push(`+ ${b[j++]}`);
  return lines.join("\n");
}
