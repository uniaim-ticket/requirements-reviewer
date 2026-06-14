import React, { useState } from "react";
import { apiUrl } from "../api.js";
import type { DocumentInfo } from "../types.js";

interface Props {
  documents: DocumentInfo[];
  currentId: string | null;
  generating: boolean;
  onSelect: (id: string) => void;
  onGenerate: (input: { title: string; prompt: string }) => Promise<void>;
  onDelete: (id: string, removeFile: boolean) => Promise<void>;
}

/**
 * Top bar: switch between requirement documents (load), create a new one by
 * entering a title + theme (generate → review), and manage/delete documents.
 */
export function DocumentBar({
  documents,
  currentId,
  generating,
  onSelect,
  onGenerate,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");

  const submit = async () => {
    if (!prompt.trim()) return;
    await onGenerate({
      title: title.trim() || prompt.trim().slice(0, 40),
      prompt: prompt.trim(),
    });
    setTitle("");
    setPrompt("");
    setOpen(false);
  };

  // Unrendered = no HTML on disk yet (e.g. failed/aborted generation).
  const unrendered = documents.filter((d) => d.hasHtml === false);
  const current = documents.find((d) => d.id === currentId);
  const canDownload = Boolean(current && current.hasHtml !== false);

  // Download the currently displayed document's HTML via the server endpoint.
  const download = () => {
    const a = document.createElement("a");
    a.href = apiUrl("document/download");
    a.download = `${current?.slug ?? "document"}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const deleteOne = async (d: DocumentInfo) => {
    const hadHtml = d.hasHtml !== false;
    const msg = hadHtml
      ? `「${d.title}」を削除しますか？（HTMLファイルも削除されます）`
      : `「${d.title}」を削除しますか？（未生成）`;
    if (!window.confirm(msg)) return;
    await onDelete(d.id, hadHtml);
  };

  const deleteAllUnrendered = async () => {
    if (unrendered.length === 0) return;
    if (!window.confirm(`未生成の要件 ${unrendered.length} 件を削除しますか？`))
      return;
    for (const d of unrendered) await onDelete(d.id, true);
  };

  return (
    <div className="doc-bar">
      <div className="doc-bar-row">
        <label className="doc-select-label">
          要件:
          <select
            className="doc-select"
            value={currentId ?? ""}
            disabled={generating}
            onChange={(e) => onSelect(e.target.value)}
          >
            {documents.length === 0 && <option value="">(なし)</option>}
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {d.hasHtml === false ? " ⚠️未生成" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={generating}
          onClick={() => setOpen((v) => !v)}
        >
          ＋ 新しい要件
        </button>
        <button
          disabled={!canDownload}
          onClick={download}
          title={
            canDownload
              ? "表示中の要件HTMLをダウンロード"
              : "ダウンロードできるHTMLがありません（未生成）"
          }
        >
          ⬇ ダウンロード
        </button>
        <button disabled={generating} onClick={() => setManage((v) => !v)}>
          管理
        </button>
        {unrendered.length > 0 && (
          <button
            className="danger"
            disabled={generating}
            onClick={deleteAllUnrendered}
            title="HTMLが未生成の要件をまとめて削除"
          >
            🗑 未生成を削除 ({unrendered.length})
          </button>
        )}
        {generating && <span className="generating">生成中...</span>}
      </div>

      {manage && (
        <div className="doc-manage">
          <ul className="doc-manage-list">
            {documents.map((d) => (
              <li key={d.id} className="doc-manage-item">
                <span className="doc-manage-title">{d.title}</span>
                <span className="doc-manage-path">{d.htmlPath}</span>
                {d.hasHtml === false ? (
                  <span className="badge-unrendered">未生成</span>
                ) : (
                  <span className="badge-rendered">生成済み</span>
                )}
                <button
                  className="danger"
                  disabled={generating}
                  onClick={() => deleteOne(d)}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <div className="generate-form">
          <input
            className="gen-title"
            placeholder="タイトル（例: 券種をまたぐ購入制約）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="gen-prompt"
            placeholder="取り扱いたい要件・テーマを入力（例: この既存システムについて、券種をまたぐ購入制約の実装方式を検討してください）"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
          <div className="btn-row">
            <button onClick={() => setOpen(false)}>キャンセル</button>
            <button
              className="primary"
              disabled={generating || !prompt.trim()}
              onClick={submit}
            >
              生成してレビュー開始
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
