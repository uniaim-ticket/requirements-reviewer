// Re-export shared types for client use.
export type {
  TargetType,
  CommentStatus,
  JobStatus,
  ClaudeStatus,
  Comment,
  Job,
  DocumentInfo,
  QueueState,
  RrEvent,
  RrEventType,
  CreateCommentInput,
  PreflightResult,
  GeneratePhase,
  GenerateStatus,
  JobProgress,
} from "../shared/types.js";

export interface DocumentResponse {
  document: import("../shared/types.js").DocumentInfo | null;
  html: string;
  exists: boolean;
  idAttribute: string;
}

// A pending inline-comment target chosen in the iframe.
export interface InlineTarget {
  rrId: string;
  tagName: string;
  targetType: import("../shared/types.js").TargetType;
  selectedText: string;
  tableRrId?: string | null;
  rowIndex?: number | null;
  colIndex?: number | null;
}
