import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import type { Job, JobProgress, QueueState } from "../types.js";

export function useQueue(onJobDone?: () => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [state, setState] = useState<QueueState>({
    state: "running",
    stopAfterCurrent: false,
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<number | null>(null);
  const wasBusyRef = useRef(false);
  const onDoneRef = useRef(onJobDone);
  onDoneRef.current = onJobDone;

  const refresh = useCallback(async () => {
    const res = await api.getQueue();
    setJobs(res.jobs);
    setState(res.state);
    setBusy(res.busy);
    setProgress(res.progress);
    if (res.progress?.startedAt) {
      setElapsed(Math.round((Date.now() - res.progress.startedAt) / 1000));
    }
    // Detect busy -> idle transition so the UI can refresh doc/diff.
    if (wasBusyRef.current && !res.busy) onDoneRef.current?.();
    wasBusyRef.current = res.busy;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Always poll the queue: fast (1.5s) while busy for live progress, slow (4s)
  // while idle. Polling even when idle is essential behind SSE-buffering
  // proxies — it's how the client reliably observes a job's busy→idle
  // transition and can auto-reload the HTML afterwards.
  useEffect(() => {
    const interval = busy ? 1500 : 4000;
    pollRef.current = window.setInterval(() => void refresh(), interval);
    return () => {
      if (pollRef.current != null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [busy, refresh]);

  useEffect(() => {
    if (!busy || !progress?.startedAt) return;
    const t = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - progress.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [busy, progress?.startedAt]);

  const runNext = useCallback(async () => {
    await api.runNext();
    await refresh();
  }, [refresh]);
  const runAll = useCallback(async () => {
    await api.runAll();
    await refresh();
  }, [refresh]);
  const pause = useCallback(async () => {
    await api.pause();
    await refresh();
  }, [refresh]);
  const resume = useCallback(async () => {
    await api.resume();
    await refresh();
  }, [refresh]);
  const stopAfterCurrent = useCallback(async () => {
    await api.stopAfterCurrent();
    await refresh();
  }, [refresh]);
  const remove = useCallback(
    async (jobId: string) => {
      await api.removeJob(jobId);
      await refresh();
    },
    [refresh],
  );
  const reorder = useCallback(
    async (jobId: string, position: number) => {
      await api.reorderJob(jobId, position);
      await refresh();
    },
    [refresh],
  );

  return {
    jobs,
    state,
    busy,
    progress,
    elapsed,
    refresh,
    runNext,
    runAll,
    pause,
    resume,
    stopAfterCurrent,
    remove,
    reorder,
  };
}
