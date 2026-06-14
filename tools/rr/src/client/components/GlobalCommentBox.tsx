import React, { useState } from "react";
import type { CreateCommentInput } from "../types.js";

interface Props {
  onSubmit: (input: CreateCommentInput) => Promise<void>;
}

export function GlobalCommentBox({ onSubmit }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (queue: boolean) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ targetType: "global", comment: text.trim(), queue });
      setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel global-comment">
      <h3>全体指摘</h3>
      <textarea
        placeholder="この成果物全体への指摘を書く"
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
