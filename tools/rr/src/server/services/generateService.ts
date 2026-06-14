import type { RrConfig } from "../config.js";
import type { DocumentService } from "./documentService.js";
import { buildGeneratePrompt, preflight, runClaude } from "./claudeService.js";
import type { PreflightResult } from "./claudeService.js";
import { eventBus } from "./eventBus.js";
import type { DocumentInfo } from "../../shared/types.js";

export interface GenerateInput {
  /** Free-form theme/instruction from the human (RFP §7). */
  prompt?: string;
  /** Title for a newly-created requirement document. */
  title?: string;
  /** If true (default for UI), create a new document; else regenerate current. */
  asNew?: boolean;
}

export interface GenerateOutput {
  document: DocumentInfo;
  status: string;
  summary: string;
}

export type GeneratePhase =
  | "idle"
  | "preflight"
  | "running"
  | "finalizing"
  | "completed"
  | "failed";

/**
 * Pollable snapshot of the current/last generation. This is the source of
 * truth the UI can GET at any time — it does NOT depend on SSE delivery, which
 * some reverse proxies (e.g. code-server's /proxy/) buffer or drop.
 */
export interface GenerateStatus {
  phase: GeneratePhase;
  documentId: string | null;
  /** Epoch ms when generation started; lets the client compute elapsed locally. */
  startedAt: number | null;
  /** Epoch ms when it ended (completed/failed), else null. */
  endedAt: number | null;
  log: string[];
  error: string | null;
  preflight: PreflightResult | null;
}

/**
 * Run an initial-generation pass with Claude Code. Maintains a pollable status
 * (this.getStatus()) AND emits SSE events; the UI prefers polling so progress
 * works behind SSE-buffering proxies.
 */
export class GenerateService {
  private inFlight = false;
  private status: GenerateStatus = {
    phase: "idle",
    documentId: null,
    startedAt: null,
    endedAt: null,
    log: [],
    error: null,
    preflight: null,
  };

  constructor(
    private config: RrConfig,
    private root: string,
    private docs: DocumentService,
  ) {}

  isBusy(): boolean {
    return this.inFlight;
  }

  getStatus(): GenerateStatus {
    return { ...this.status, log: [...this.status.log] };
  }

  /** Expose preflight so the UI can show auth/login state up front. */
  preflight(): Promise<PreflightResult> {
    return preflight(this.config, this.root);
  }

  private push(line: string): void {
    this.status.log.push(line);
    if (this.status.log.length > 300) {
      this.status.log = this.status.log.slice(-300);
    }
    const elapsed = this.status.startedAt
      ? Math.round((Date.now() - this.status.startedAt) / 1000)
      : 0;
    eventBus.emitEvent({
      type: "generate_progress",
      payload: { id: this.status.documentId, elapsed, line },
    });
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    if (this.inFlight) throw new Error("生成処理が既に実行中です");
    this.inFlight = true;

    // Reset the status snapshot for this run.
    this.status = {
      phase: "preflight",
      documentId: null,
      startedAt: Date.now(),
      endedAt: null,
      log: [],
      error: null,
      preflight: null,
    };

    let doc: DocumentInfo | null = null;
    try {
      // --- Preflight: detect missing command / not-logged-in BEFORE the long run.
      this.push("実行前チェック: エージェントの状態を確認しています...");
      const pf = await preflight(this.config, this.root);
      this.status.preflight = pf;
      this.push(
        pf.commandFound
          ? `エージェント: ${pf.version ?? "?"} / ${pf.message}`
          : pf.message,
      );
      if (!pf.ok) {
        this.status.phase = "failed";
        this.status.error = pf.message;
        this.status.endedAt = Date.now();
        eventBus.emitEvent({
          type: "generate_failed",
          payload: { document: null, error: pf.message, preflight: pf },
        });
        throw new Error(pf.message);
      }

      // --- Create (or reuse) the target document.
      let createdNew = false;
      if (input.asNew ?? true) {
        const title = (input.title || input.prompt || "新しい要件").slice(0, 80);
        doc = this.docs.create({ title });
        createdNew = true;
      } else {
        doc = this.docs.getInfo()!;
        this.docs.setCurrent(doc.id);
      }
      this.status.documentId = doc.id;
      this.status.phase = "running";
      eventBus.emitEvent({ type: "generate_started", payload: doc });

      const outputPath = this.docs.relPathForSlug(doc.slug);
      const prompt = buildGeneratePrompt(
        this.root,
        this.config,
        input.prompt,
        outputPath,
      );

      this.push("Claude Code を起動しました。応答を待っています...");
      // Quiet heartbeat: only nudge if Claude has been silent for a while.
      let lastProgressAt = Date.now();
      const heartbeat = setInterval(() => {
        if (Date.now() - lastProgressAt >= 15000) {
          this.push("…まだ生成中です（Claude が思考・作業しています）");
          lastProgressAt = Date.now();
        }
      }, 5000);

      try {
        const result = await runClaude(this.config, this.root, prompt, {
          onProgress: (line) => {
            lastProgressAt = Date.now();
            this.push(line);
          },
          onOutput: (chunk, stream) => {
            if (stream === "stderr") {
              const text = chunk.trim();
              if (text && !text.includes("no stdin data")) this.push(`[stderr] ${text}`);
            }
          },
        });
        clearInterval(heartbeat);
        this.status.phase = "finalizing";
        this.push("出力を整形し、レビューIDを付与しています...");
        if (this.config.review.auto_inject_ids) this.docs.injectIdsOnDisk();
        this.docs.syncFromDisk();
        // Remember the generation session so the FIRST review comment can
        // --resume it (Claude already understands the doc it just produced).
        if (result.sessionId) this.docs.setDocSession(doc.id, result.sessionId);
        const updated = this.docs.getInfo()!;
        this.status.phase = "completed";
        this.status.endedAt = Date.now();
        this.push("✅ 生成が完了しました");
        eventBus.emitEvent({ type: "generate_completed", payload: updated });
        return { document: updated, status: result.status, summary: result.summary };
      } catch (err) {
        clearInterval(heartbeat);
        const message = err instanceof Error ? err.message : String(err);
        this.status.phase = "failed";
        this.status.error = message;
        this.status.endedAt = Date.now();
        // Don't leave an empty, never-generated document behind on failure.
        if (createdNew && doc) {
          const after = this.docs.get(doc.id);
          if (after && !after.hasHtml) {
            try {
              this.docs.delete(doc.id, { removeFile: true });
              this.push("（生成されなかった空の要件を削除しました）");
            } catch {
              /* ignore */
            }
          }
        }
        this.push(`❌ 生成に失敗しました: ${message}`);
        eventBus.emitEvent({
          type: "generate_failed",
          payload: { document: doc, error: message },
        });
        throw err;
      }
    } finally {
      this.inFlight = false;
    }
  }
}
