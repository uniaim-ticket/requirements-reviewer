import { spawn } from "node:child_process";
import { findProjectRoot } from "../../server/config.js";
import { startServer } from "../../server/index.js";
import { runInit } from "./init.js";

export interface ServeOptions {
  /** Initialize the project first if it isn't already (default true). */
  autoInit?: boolean;
  /** Open the UI in the default browser once listening (default true). */
  open?: boolean;
  /** Override the configured port. */
  port?: number;
}

/** Best-effort cross-platform "open this URL in a browser". */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* no browser available (headless); ignore */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  const autoInit = opts.autoInit ?? true;
  const open = opts.open ?? true;

  // Auto-initialize if there's no .rr project in the current tree.
  if (autoInit && !findProjectRoot()) {
    // eslint-disable-next-line no-console
    console.log("rr プロジェクトが見つからないため初期化します...\n");
    runInit();
    // eslint-disable-next-line no-console
    console.log("");
  }

  // Start the server first so we know the actual (possibly auto-selected) port,
  // then open the browser at that real URL.
  const server = await startServer({ port: opts.port });
  if (open) {
    setTimeout(() => openBrowser(server.url), 500);
  }
}
