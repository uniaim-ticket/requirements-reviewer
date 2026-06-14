import { requireProjectRoot } from "../../server/config.js";
import { createContext } from "../../server/context.js";

export function runStopAfterCurrent(): void {
  const ctx = createContext(requireProjectRoot());
  ctx.queue.stopAfterCurrent();
  // eslint-disable-next-line no-console
  console.log("現在のジョブ完了後に停止します。");
}
