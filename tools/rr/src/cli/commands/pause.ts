import { requireProjectRoot } from "../../server/config.js";
import { createContext } from "../../server/context.js";

export function runPause(): void {
  const ctx = createContext(requireProjectRoot());
  ctx.queue.pause();
  // eslint-disable-next-line no-console
  console.log("Queue: paused");
}
