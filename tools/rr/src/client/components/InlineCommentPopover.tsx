import React, { useState } from "react";
import type { CreateCommentInput, InlineTarget } from "../types.js";

interface Props {
  target: InlineTarget;
  onSubmit: (input: CreateCommentInput) => Promise<void>;
  onClose: () => void;
}

export function InlineCommentPopover({ target, onSubmit, onClose }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (queue: boolean) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        targetType: target.targetType,
        rrId: target.rrId,
        tableRrId: target.tableRrId ?? null,
        rowIndex: target.rowIndex ?? null,
        colIndex: target.colIndex ?? null,
        selectedText: target.selectedText,
        comment: text.trim(),
        queue,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel inline-popover">
      <div className="popover-head">
        <h3>選択箇所への指摘</h3>
        <button className="close" onClick={onClose}>
          ×
        </button>
      </div>
      <dl className="target-meta">
        <div>
          <dt>対象</dt>
          <dd>{target.rrId}</dd>
        </div>
        <div>
          <dt>種別</dt>
          <dd>{target.targetType}</dd>
        </div>
        {target.selectedText && (
          <div>
            <dt>選択テキスト</dt>
            <dd className="selected-text">{target.selectedText}</dd>
          </div>
        )}
      </dl>
      <textarea
        autoFocus
        placeholder="コメント"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />
      <div className="btn-row">
        <button disabled={busy || !text.trim()} onClick={() => submit(false)}>
          Save
        </button>
        <button
          className="primary"
          disabled={busy || !text.trim()}
          onClick={() => submit(true)}
        >
          Save and Queue
        </button>
      </div>
    </section>
  );
}
