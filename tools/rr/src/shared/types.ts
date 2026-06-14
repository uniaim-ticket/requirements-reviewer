// Shared types used by both the server and the client.

export type TargetType =
  | "global"
  | "line"
  | "block"
  | "table_row"
  | "table_cell"
  | "diagram"
  | "diagram_line";

export type CommentStatus = "draft" | "queued" | "applied" | "archived";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ClaudeStatus =
  | "applied"
  | "partially_applied"
  | "needs_human_review"
  | "conflicted"
  | "failed";

export interface Comment {
  id: string;
  documentId: string;
  documentVersion: number;
  targetType: TargetType;
  rrId: string | null;
  tableRrId: string | null;
  rowIndex: number | null;
  colIndex: number | null;
  selectedText: string | null;
  prefix: string | null;
  suffix: string | null;
  comment: string;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalInputTokens: number;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface Job {
  id: string;
  documentId: string;
  documentVersion: number;
  status: JobStatus;
  position: number;
  claudeProcessId: number | null;
  claudeStatus: ClaudeStatus | null;
  claudeSummary: string | null;
  claudeRawOutput: string | null;
  claudeCommentForReviewer: string | null;
  diffText: string | null;
  errorMessage: string | null;
  /** True when the agent flagged that follow-up work is needed. */
  needsFollowUp: boolean;
  /**
   * Set when the run looks incomplete (truncated / errored / partial). Drives
   * the "もう一度実行" vs "続きを実行" choice in the UI. Null when it looks done.
   */
  incompleteReason: string | null;
  /** Claude Code session id, for continuing (--resume) the same conversation. */
  sessionId: string | null;
  /** 1 for the first run; incremented on each re-run/continue. */
  attempt: number;
  /** Whether this run resumed a prior Claude session (--resume). */
  usedResume: boolean;
  /** Token usage from the run, if available. */
  usage: TokenUsage | null;
  /** When true, this run must NOT resume any session (explicit "start over"). */
  forceFresh: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  comments: Comment[];
}

export interface DocumentInfo {
  id: string;
  slug: string;
  title: string;
  htmlPath: string;
  currentVersion: number;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
  /** Whether the HTML file exists on disk with content (i.e. generated). */
  hasHtml?: boolean;
}

export interface QueueState {
  state: "paused" | "running";
  stopAfterCurrent: boolean;
}

export interface JobProgress {
  jobId: string;
  startedAt: number;
  log: string[];
}

export type RrEventType =
  | "document_updated"
  | "document_created"
  | "document_selected"
  | "document_deleted"
  | "generate_started"
  | "generate_progress"
  | "generate_completed"
  | "generate_failed"
  | "job_progress"
  | "comment_created"
  | "comment_updated"
  | "comment_deleted"
  | "job_queued"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "queue_paused"
  | "queue_resumed";

export interface RrEvent {
  type: RrEventType;
  payload?: unknown;
}

export interface PreflightResult {
  ok: boolean;
  commandFound: boolean;
  version: string | null;
  loggedIn: boolean | null;
  authMethod: string | null;
  apiProvider: string | null;
  message: string;
}

export type GeneratePhase =
  | "idle"
  | "preflight"
  | "running"
  | "finalizing"
  | "completed"
  | "failed";

export interface GenerateStatus {
  phase: GeneratePhase;
  documentId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  log: string[];
  error: string | null;
  preflight: PreflightResult | null;
}

export interface CreateCommentInput {
  targetType: TargetType;
  rrId?: string | null;
  tableRrId?: string | null;
  rowIndex?: number | null;
  colIndex?: number | null;
  selectedText?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  comment: string;
  queue?: boolean;
}
