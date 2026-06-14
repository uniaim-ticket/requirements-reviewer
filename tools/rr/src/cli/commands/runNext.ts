import { requireProjectRoot } from "../../server/config.js";
import { createContext } from "../../server/context.js";

export async function runRunNext(): Promise<void> {
  const root = requireProjectRoot();
  const ctx = createContext(root);
  const next = ctx.queue.nextQueued();
  if (!next) {
    // eslint-disable-next-line no-console
    console.log("Queueに処理待ちのジョブはありません。");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`ジョブ ${next.id} を処理します...`);
  const job = await ctx.worker.runNext();
  // eslint-disable-next-line no-console
  console.log(`完了: ${job?.status} (${job?.claudeStatus ?? "-"})`);
  if (job?.claudeSummary) console.log(job.claudeSummary);
}
