import React, { useEffect } from "react";
import type { Comment, InlineTarget } from "../types.js";
import { useDocumentFrame } from "../hooks/useDocumentFrame.js";

export interface DocumentFrameApi {
  reload: () => void;
  scrollToRrId: (rrId: string) => boolean;
}

interface Props {
  comments: Comment[];
  onPickTarget: (t: InlineTarget) => void;
  reloadSignal: number;
  frameApiRef?: React.MutableRefObject<DocumentFrameApi | null>;
}

export function DocumentFrame({
  comments,
  onPickTarget,
  reloadSignal,
  frameApiRef,
}: Props) {
  const { frameRef, html, exists, reload, instrument, applyMarkers, scrollToRrId } =
    useDocumentFrame({ comments, onPickTarget });

  // Expose reload + scroll to parent (SSE refresh, comment-click scroll).
  useEffect(() => {
    if (frameApiRef) frameApiRef.current = { reload, scrollToRrId };
  }, [frameApiRef, reload, scrollToRrId]);

  useEffect(() => {
    if (reloadSignal > 0) void reload();
  }, [reloadSignal, reload]);

  // Write HTML into the iframe via srcdoc, then instrument once loaded.
  const handleLoad = () => {
    instrument();
    applyMarkers();
  };

  if (!exists) {
    return (
      <div className="doc-empty">
        <p>成果物がまだありません。</p>
        <p>
          <code>rr generate --prompt "..."</code> を実行して初版を生成してください。
        </p>
      </div>
    );
  }

  return (
    <iframe
      ref={frameRef}
      className="doc-frame"
      title="document"
      srcDoc={html}
      onLoad={handleLoad}
    />
  );
}
