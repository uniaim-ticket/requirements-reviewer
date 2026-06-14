import React from "react";
import type { Job } from "../types.js";
import { DiffPanel } from "./DiffPanel.js";

interface Props {
  job: Job | null;
  onRerun: (jobId: string, mode: "fresh" | "continue") => void;
}

// Human-readable explanation for why a run looks incomplete.
const REASON_LABEL: Record<string, string> = {
  max_tokens: "出力が長さ上限で打ち切られました（途中で止まった可能性）",
  needs_follow_up: "Claude が「追加の作業が必要」と報告しました",
  error: "エージェントがエラーを返しました",
  "status:partially_applied": "一部のみ反映されました（partially_applied）",
  "status:needs_human_review": "人の確認が必要と判断されました（needs_human_review）",
  "status:conflicted": "競合が発生しました（conflicted）",
};

export function ResultPanel({ job, onRerun }: Props) {
  if (!job) {
    return (
      <section className="panel result-panel">
        <h3>実行結果</h3>
        <p className="muted">ジョブを選択すると結果が表示されます。</p>
      </section>
    );
  }

  // A run is "incomplete" if the server flagged a reason, or it outright failed.
  const incomplete = job.incompleteReason || job.status === "failed";
  const reasonText = job.incompleteReason
    ? REASON_LABEL[job.incompleteReason] ?? job.incompleteReason
    : job.status === "failed"
      ? "ジョブが失敗しました"
      : "";

  return (
    <section className="panel result-panel">
      <h3>実行結果</h3>
      <div className="result-meta">
        <span className={`status-tag status-${job.status}`}>{job.status}</span>
        {job.claudeStatus && (
          <span className={`claude-status ${job.claudeStatus}`}>
            {job.claudeStatus}
          </span>
        )}
        {job.attempt > 1 && (
          <span className="claude-status">試行 {job.attempt}</span>
        )}
      </div>

      {incomplete && (
        <div className="result-block incomplete">
          <h4>⚠️ 処理が途中で終わった可能性があります</h4>
          <p>{reasonText}</p>
          <div className="btn-row">
            <button
              className="primary"
              onClick={() => onRerun(job.id, "continue")}
              disabled={!job.sessionId}
              title={
                job.sessionId
                  ? "前回のセッションを再開して続きを実行します"
                  : "続行用のセッション情報がありません（もう一度実行をお使いください）"
              }
            >
              続きを実行
            </button>
            <button onClick={() => onRerun(job.id, "fresh")}>
              もう一度実行（最初から）
            </button>
          </div>
        </div>
      )}

      {job.status === "completed" && !incomplete && (
        <p className="badge-updated">更新あり</p>
      )}

      {job.claudeSummary && (
        <div className="result-block">
          <h4>要約</h4>
          <p>{job.claudeSummary}</p>
        </div>
      )}

      {job.claudeCommentForReviewer && (
        <div className="result-block">
          <h4>Claudeコメント</h4>
          <p>{job.claudeCommentForReviewer}</p>
        </div>
      )}

      {job.errorMessage && (
        <div className="result-block error">
          <h4>エラー</h4>
          <p>{job.errorMessage}</p>
        </div>
      )}

      <DiffPanel diff={job.diffText} />

      {job.claudeRawOutput && (
        <details className="result-block">
          <summary>raw output</summary>
          <pre className="raw-output">{job.claudeRawOutput}</pre>
        </details>
      )}
    </section>
  );
}
