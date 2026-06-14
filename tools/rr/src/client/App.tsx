import React, { useCallback, useRef, useState } from "react";
import { DocumentFrame, type DocumentFrameApi } from "./components/DocumentFrame.js";
import { DocumentBar } from "./components/DocumentBar.js";
import { GenerateProgress } from "./components/GenerateProgress.js";
import { GlobalCommentBox } from "./components/GlobalCommentBox.js";
import { InlineCommentPopover } from "./components/InlineCommentPopover.js";
import { CommentsPanel } from "./components/CommentsPanel.js";
import { QueuePanel } from "./components/QueuePanel.js";
import { ResultPanel } from "./components/ResultPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { useComments } from "./hooks/useComments.js";
import { useQueue } from "./hooks/useQueue.js";
import { useEvents } from "./hooks/useEvents.js";
import { useDocuments } from "./hooks/useDocuments.js";
import { useGenerate } from "./hooks/useGenerate.js";
import { api } from "./api.js";
import type { CreateCommentInput, InlineTarget, Job } from "./types.js";

export function App() {
  const docs = useDocuments();
  const comments = useComments();
  const [target, setTarget] = useState<InlineTarget | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [docReloadSignal, setDocReloadSignal] = useState(0);
  const [docUpdated, setDocUpdated] = useState(false);
  const frameApiRef = useRef<DocumentFrameApi | null>(null);

  // Scroll the document iframe to a comment's target element (works for any
  // status, incl. resolved). If the iframe hasn't loaded the element yet,
  // reload first and retry shortly after.
  const scrollToComment = useCallback((rrId: string | null) => {
    if (!rrId) return;
    const api = frameApiRef.current;
    if (!api) return;
    if (!api.scrollToRrId(rrId)) {
      api.reload();
      window.setTimeout(() => frameApiRef.current?.scrollToRrId(rrId), 400);
    }
  }, []);

  // When the worker finishes a job (busy -> idle), refresh doc + comments and
  // show the result + "updated" pill.
  // When a queued comment finishes (busy -> idle), auto-reload the HTML and
  // refresh comments. No manual "更新あり" pill needed — it reloads itself.
  const queue = useQueue(() => {
    void comments.refresh();
    void docs.refresh();
    setDocReloadSignal((n) => n + 1);
  });

  // Switching the active document resets the per-document panels.
  const refreshAllForDoc = useCallback(() => {
    void docs.refresh();
    void comments.refresh();
    void queue.refresh();
    setSelectedJobId(null);
    setSelectedJob(null);
    setTarget(null);
    setDocReloadSignal((n) => n + 1);
  }, [docs, comments, queue]);

  // Generation is driven by POLLING (proxy-safe), not SSE.
  const generate = useGenerate((documentId) => {
    if (documentId) docs.setCurrentId(documentId);
    refreshAllForDoc();
    setDocUpdated(false);
  });

  const loadJob = useCallback(async (jobId: string) => {
    const { job } = await api.getJob(jobId);
    setSelectedJob(job);
  }, []);

  // Re-run a finished job: "fresh" (start over) or "continue" (resume session).
  const rerunJob = useCallback(
    async (jobId: string, mode: "fresh" | "continue") => {
      const { job } = await api.rerunJob(jobId, mode);
      setSelectedJobId(job.id);
      setSelectedJob(job);
      void queue.refresh();
    },
    [queue],
  );

  const selectJob = useCallback(
    (jobId: string) => {
      setSelectedJobId(jobId);
      void loadJob(jobId);
    },
    [loadJob],
  );

  // SSE is a best-effort nudge; the queue/generate hooks also poll so the UI
  // works even when a proxy buffers the event stream.
  useEvents({
    document_updated: () => {
      setDocUpdated(true);
      setDocReloadSignal((n) => n + 1);
    },
    document_created: () => void docs.refresh(),
    document_selected: () => refreshAllForDoc(),
    document_deleted: () => refreshAllForDoc(),
    comment_created: () => void comments.refresh(),
    comment_updated: () => void comments.refresh(),
    comment_deleted: () => void comments.refresh(),
    job_queued: () => void queue.refresh(),
    job_started: () => void queue.refresh(),
    job_completed: (payload) => {
      void queue.refresh();
      void comments.refresh();
      const job = payload as Job;
      if (job?.id) {
        setSelectedJobId(job.id);
        setSelectedJob(job);
      }
      // Auto-reload the HTML to show the applied change.
      setDocReloadSignal((n) => n + 1);
    },
    job_failed: (payload) => {
      void queue.refresh();
      const job = payload as Job;
      if (job?.id) {
        setSelectedJobId(job.id);
        setSelectedJob(job);
      }
    },
    queue_paused: () => void queue.refresh(),
    queue_resumed: () => void queue.refresh(),
  });

  const createComment = useCallback(
    async (input: CreateCommentInput) => {
      await comments.create(input);
      await queue.refresh();
    },
    [comments, queue],
  );

  const currentDoc = docs.documents.find((d) => d.id === docs.currentId);

  return (
    <div className="app">
      <header className="app-header">
        <strong>rr</strong> — Requirements Review
        <span className="header-doc">{currentDoc?.htmlPath ?? ""}</span>
        {docUpdated && (
          <button
            className="updated-pill"
            onClick={() => {
              frameApiRef.current?.reload();
              setDocUpdated(false);
            }}
          >
            更新あり — 再読み込み
          </button>
        )}
      </header>

      <DocumentBar
        documents={docs.documents}
        currentId={docs.currentId}
        generating={generate.active}
        onSelect={docs.select}
        onGenerate={async ({ title, prompt }) => {
          await generate.start({ title, prompt, asNew: true });
        }}
        onDelete={async (id, removeFile) => {
          await docs.remove(id, removeFile);
          refreshAllForDoc();
        }}
      />

      <div className="layout">
        <main className="doc-pane">
          <DocumentFrame
            comments={comments.comments}
            onPickTarget={setTarget}
            reloadSignal={docReloadSignal}
            frameApiRef={frameApiRef}
          />
          <GenerateProgress
            status={generate.status}
            elapsed={generate.elapsed}
            active={generate.active}
            onDismiss={generate.dismiss}
          />
        </main>

        <Sidebar>
          <GlobalCommentBox onSubmit={createComment} />
          {target && (
            <InlineCommentPopover
              target={target}
              onSubmit={createComment}
              onClose={() => setTarget(null)}
            />
          )}
          <CommentsPanel
            comments={comments.comments}
            onEnqueue={comments.enqueue}
            onDelete={comments.remove}
            onScrollTo={scrollToComment}
          />
          <QueuePanel
            jobs={queue.jobs}
            state={queue.state}
            busy={queue.busy}
            progress={queue.progress}
            elapsed={queue.elapsed}
            onRunNext={queue.runNext}
            onRunAll={queue.runAll}
            onPause={queue.pause}
            onResume={queue.resume}
            onStopAfterCurrent={queue.stopAfterCurrent}
            onRemove={queue.remove}
            onReorder={queue.reorder}
            onSelectJob={selectJob}
            selectedJobId={selectedJobId}
          />
          <ResultPanel job={selectedJob} onRerun={rerunJob} />
        </Sidebar>
      </div>
    </div>
  );
}
