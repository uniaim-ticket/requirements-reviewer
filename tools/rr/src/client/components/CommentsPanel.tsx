import React from "react";
import type { Comment } from "../types.js";

interface Props {
  comments: Comment[];
  onEnqueue: (ids: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onScrollTo: (rrId: string | null) => void;
}

// A comment is "resolved" once it has been applied (or archived).
function isResolved(c: Comment): boolean {
  return c.status === "applied" || c.status === "archived";
}

export function CommentsPanel({
  comments,
  onEnqueue,
  onDelete,
  onScrollTo,
}: Props) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = React.useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enqueueSelected = async () => {
    if (selected.size === 0) return;
    await onEnqueue([...selected]);
    setSelected(new Set());
  };

  const resolvedCount = comments.filter(isResolved).length;
  const visible = showResolved ? comments : comments.filter((c) => !isResolved(c));
  const drafts = comments.filter((c) => c.status === "draft");

  return (
    <section className="panel comments-panel">
      <div className="panel-head">
        <h3>コメント一覧 ({visible.length})</h3>
        <button
          disabled={selected.size === 0}
          onClick={enqueueSelected}
          title="選択したコメントをQueueに追加"
        >
          選択をQueueへ ({selected.size})
        </button>
      </div>

      {resolvedCount > 0 && (
        <label className="show-resolved">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          解決済みも表示 ({resolvedCount})
        </label>
      )}

      {comments.length === 0 && <p className="muted">まだコメントはありません。</p>}
      <ul className="comment-list">
        {visible.map((c) => (
          <li
            key={c.id}
            className={`comment-item status-${c.status} ${
              c.rrId ? "clickable" : ""
            } ${isResolved(c) ? "resolved" : ""}`}
            onClick={() => onScrollTo(c.rrId)}
            title={c.rrId ? "クリックで該当箇所へスクロール" : undefined}
          >
            <div className="comment-row">
              {c.status === "draft" && (
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(c.id)}
                />
              )}
              <span className={`badge badge-${c.targetType}`}>{c.targetType}</span>
              {c.rrId && <span className="rr-id">{c.rrId}</span>}
              <span className={`status-tag status-${c.status}`}>{c.status}</span>
            </div>
            {c.selectedText && (
              <div className="comment-selected">“{c.selectedText}”</div>
            )}
            <div className="comment-body">{c.comment}</div>
            <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
              {c.status === "draft" && (
                <button onClick={() => onEnqueue([c.id])}>Queueに追加</button>
              )}
              <button className="danger" onClick={() => onDelete(c.id)}>
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
      {drafts.length === 0 && comments.length > 0 && (
        <p className="muted">未Queueのドラフトはありません。</p>
      )}
    </section>
  );
}
