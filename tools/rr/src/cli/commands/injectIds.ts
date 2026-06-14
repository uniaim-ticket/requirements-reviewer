import { requireProjectRoot } from "../../server/config.js";
import { createContext } from "../../server/context.js";

export function runInjectIds(): void {
  const root = requireProjectRoot();
  const ctx = createContext(root);
  const added = ctx.docs.injectIdsOnDisk();
  // eslint-disable-next-line no-console
  console.log(`data-rr-id を ${added} 件付与しました（既存IDは変更していません）。`);
}
