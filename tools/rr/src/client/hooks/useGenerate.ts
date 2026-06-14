import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import type { GenerateStatus } from "../types.js";

/**
 * Drives document generation. Progress is read by POLLING /api/generate/status
 * (not SSE) so it works behind reverse proxies that buffer event streams
 * (e.g. code-server's /proxy/). Elapsed time is computed client-side from the
 * server-provided startedAt, so it never sticks at "0s".
 */
export function useGenerate(onCompleted: (documentId: string | null) => void) {
  const [status, setStatus] = useState<GenerateStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  const active =
    status != null &&
    ["preflight", "running", "finalizing"].includes(status.phase);

  const stopTimers = useCallback(() => {
    if (pollRef.current != null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (tickRef.current != null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const { status } = await api.generateStatus();
      setStatus(status);
      if (status.startedAt) {
        const end = status.endedAt ?? Date.now();
        setElapsed(Math.max(0, Math.round((end - status.startedAt) / 1000)));
      }
      const done = status.phase === "completed" || status.phase === "failed";
      if (done) {
        stopTimers();
        if (status.phase === "completed") {
          onCompletedRef.current(status.documentId);
        }
      }
    } catch {
      /* transient; keep polling */
    }
  }, [stopTimers]);

  const start = useCallback(
    async (input: { title?: string; prompt?: string; asNew?: boolean }) => {
      setElapsed(0);
      // Local ticking timer for smooth elapsed display even if a poll is slow.
      stopTimers();
      const begin = Date.now();
      tickRef.current = window.setInterval(() => {
        setElapsed((e) => {
          const byClock = Math.round((Date.now() - begin) / 1000);
          return Math.max(e, byClock);
        });
      }, 1000);
      pollRef.current = window.setInterval(() => void poll(), 1500);
      await api.generate(input);
      void poll();
    },
    [poll, stopTimers],
  );

  // On mount, pick up an in-flight generation (e.g. after a reload).
  useEffect(() => {
    void (async () => {
      const { status } = await api.generateStatus();
      if (["preflight", "running", "finalizing"].includes(status.phase)) {
        setStatus(status);
        pollRef.current = window.setInterval(() => void poll(), 1500);
        tickRef.current = window.setInterval(() => {
          if (status.startedAt) {
            setElapsed(Math.round((Date.now() - status.startedAt) / 1000));
          }
        }, 1000);
      }
    })();
    return () => stopTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => setStatus(null), []);

  return { status, elapsed, active, start, dismiss };
}
