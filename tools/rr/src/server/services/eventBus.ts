import { EventEmitter } from "node:events";
import type { RrEvent } from "../../shared/types.js";

// A tiny process-wide event bus. SSE clients subscribe; services emit.
class EventBus extends EventEmitter {
  emitEvent(event: RrEvent): void {
    this.emit("event", event);
  }

  onEvent(listener: (event: RrEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(100);
