import { requireProjectRoot } from "../../server/config.js";
import { createContext } from "../../server/context.js";

export function runResume(): void {
  const ctx = createContext(requireProjectRoot());
  ctx.queue.resume();
  // eslint-disable-next-line no-console
  console.log("Queue: running");
}
