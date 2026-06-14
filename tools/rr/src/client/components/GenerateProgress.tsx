import React, { useEffect, useRef } from "react";
import type { GenerateStatus } from "../types.js";

interface Props {
  status: GenerateStatus | null;
  elapsed: number;
  active: boolean;
  onDismiss: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  preflight: "実行前チェック中…",
  running: "Claude Code が生成中…",
  finalizing: "仕上げ中…",
  completed: "生成完了",
  failed: "生成失敗",
};

/** Live progress overlay shown during/after Claude Code generation. */
export function GenerateProgress({ status, elapsed, active, onDismiss }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [status?.log]);

  if (!status) return null;

  const pf = status.preflight;

  return (
    <div className="gen-overlay">
      <div className="gen-card">
        <div className="gen-head">
          {active && <span className="spinner" />}
          <strong>{PHASE_LABEL[status.phase] ?? "生成"}</strong>
          {active ? (
            <span className="gen-elapsed">{elapsed}s 経過</span>
          ) : (
            <button className="close gen-close" onClick={onDismiss}>
              ×
            </button>
          )}
        </div>

        {/* Auth/agent status banner from preflight. */}
        {pf && (
          <div
            className={`gen-auth ${pf.ok ? "ok" : "bad"}`}
            title={pf.message}
          >
            {pf.commandFound ? (
              <>
                エージェント {pf.version ?? "?"} ・ ログイン:{" "}
                {pf.loggedIn === true
                  ? `✅ (${pf.authMethod ?? "?"} / ${pf.apiProvider ?? "?"})`
                  : pf.loggedIn === false
                    ? "❌ 未ログイン"
                    : "不明"}
              </>
            ) : (
              <>コマンドが見つかりません</>
            )}
          </div>
        )}

        <pre className="gen-log">
          {status.log.length === 0 ? "開始しています…" : status.log.join("\n")}
          <div ref={endRef} />
        </pre>

        {status.error && <p className="gen-error">{status.error}</p>}

        {active && (
          <p className="gen-hint">
            既存システムの調査と初版HTML作成には数十秒〜数分かかることがあります。
            この表示は1.5秒ごとにサーバーへ問い合わせて更新しています。
          </p>
        )}
      </div>
    </div>
  );
}
