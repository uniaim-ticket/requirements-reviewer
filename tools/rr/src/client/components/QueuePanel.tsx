import React from "react";
import type { Job, JobProgress, QueueState } from "../types.js";

interface Props {
  jobs: Job[];
  state: QueueState;
  busy: boolean;
  progress: JobProgress | null;
  elapsed: number;
  onRunNext: () => void;
  onRunAll: () => void;
  onPause: () => void;
  onResume: () => void;
  onStopAfterCurrent: () => void;
  onRemove: (jobId: string) => void;
  onReorder: (jobId: string, position: number) => void;
  onSelectJob: (jobId: string) => void;
  selectedJobId: string | null;
}

export function QueuePanel({
  jobs,
  state,
  busy,
  progress,
  elapsed,
  onRunNext,
  onRunAll,
  onPause,
  onResume,
  onStopAfterCurrent,
  onRemove,
  onReorder,
  onSelectJob,
  selectedJobId,
}: Props) {
  const queued = jobs.filter((j) => j.status === "queued");

  return (
    <section className="panel queue-panel">
      <div className="panel-head">
        <h3>Queue</h3>
        <span className={`queue-state ${state.state}`}>
          {state.state}
          {state.stopAfterCurrent ? " (stop after current)" : ""}
        </span>
      </div>
      <div className="btn-row queue-controls">
        <button disabled={busy || queued.length === 0} onClick={onRunNext}>
          Run next
        </button>
        <button disabled={busy || queued.length === 0} onClick={onRunAll}>
          Run all
        </button>
        {state.state === "running" ? (
          <button onClick={onPause}>Pause</button>
        ) : (
          <button onClick={onResume}>Resume</button>
        )}
        <button disabled={!busy} onClick={onStopAfterCurrent}>
          Stop after current
        </button>
      </div>
      <ol className="job-list">
        {jobs.map((job, idx) => (
          <li
            key={job.id}
            className={`job-item status-${job.status} ${
              selectedJobId === job.id ? "selected" : ""
            }`}
            onClick={() => onSelectJob(job.id)}
          >
            <div className="job-row">
              <span className={`status-tag status-${job.status}`}>
                {job.status === "running" ? <span className="spinner sm" /> : null}
                {job.status}
              </span>
              <span className="job-comment">
                {job.comments[0]?.comment ?? "(コメントなし)"}
              </span>
              {job.status === "running" && (
                <span className="job-elapsed">{elapsed}s</span>
              )}
            </div>
            {job.status === "running" &&
              progress?.jobId === job.id &&
              progress.log.length > 0 && (
                <pre className="job-progress">
                  {progress.log.slice(-6).join("\n")}
                </pre>
              )}
            <div className="job-actions" onClick={(e) => e.stopPropagation()}>
              {job.status === "queued" && (
                <>
                  <button
                    disabled={idx === 0}
                    onClick={() => onReorder(job.id, idx)}
                    title="上へ"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => onReorder(job.id, idx + 2)}
                    title="下へ"
                  >
                    ↓
                  </button>
                  <button className="danger" onClick={() => onRemove(job.id)}>
                    Remove
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {jobs.length === 0 && <p className="muted">Queueは空です。</p>}
    </section>
  );
}
