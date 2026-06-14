import { useEffect, useRef } from "react";
import { apiUrl } from "../api.js";
import type { RrEventType } from "../types.js";

type Handler = (payload: unknown) => void;

const EVENT_TYPES: RrEventType[] = [
  "document_updated",
  "comment_created",
  "comment_updated",
  "comment_deleted",
  "job_queued",
  "job_started",
  "job_completed",
  "job_failed",
  "queue_paused",
  "queue_resumed",
];

/** Subscribe to the server SSE stream. handlers is keyed by event type. */
export function useEvents(handlers: Partial<Record<RrEventType, Handler>>): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const es = new EventSource(apiUrl("events"));
    const listeners: Array<[string, (e: MessageEvent) => void]> = [];
    for (const type of EVENT_TYPES) {
      const listener = (e: MessageEvent) => {
        let payload: unknown = {};
        try {
          payload = JSON.parse(e.data);
        } catch {
          /* ignore */
        }
        ref.current[type]?.(payload);
      };
      es.addEventListener(type, listener as EventListener);
      listeners.push([type, listener]);
    }
    return () => {
      for (const [type, listener] of listeners) {
        es.removeEventListener(type, listener as EventListener);
      }
      es.close();
    };
  }, []);
}
