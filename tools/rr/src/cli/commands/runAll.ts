import { requireProjectRoot } from "../../server/config.js";
import { createContext } from "../../server/context.js";

export async function runRunAll(): Promise<void> {
  const root = requireProjectRoot();
  const ctx = createContext(root);
  // eslint-disable-next-line no-console
  console.log("Queueを順番に処理します...");
  await ctx.worker.runAll();
  const remaining = ctx.queue.nextQueued();
  // eslint-disable-next-line no-console
  console.log(
    remaining
      ? "停止しました（pause / stop-after-current）。"
      : "Queueを処理し終えました。",
  );
}
