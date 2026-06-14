import type {
  Comment,
  CreateCommentInput,
  Job,
  JobProgress,
  QueueState,
} from "./types.js";
import type { DocumentResponse } from "./types.js";

/**
 * Resolve an API path against the page's base URI so the app works behind a
 * path-prefixing proxy. The client is served under `.../app/`; the API lives
 * one level up under `.../api/`. e.g. baseURI `http://h/proxy/5177/app/`
 * + path `api/document` -> `http://h/proxy/5177/api/document`.
 */
export function apiUrl(path: string): string {
  const clean = path.replace(/^\/?(api\/)?/, ""); // strip leading slash / api/
  // `../api/` is relative to the app directory (one level above app/).
  return new URL(`../api/${clean}`, document.baseURI).toString();
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  // Only send a JSON content-type when there's actually a body; Fastify rejects
  // an empty body that declares application/json with a 400.
  const headers = init?.body
    ? { "Content-Type": "application/json", ...init?.headers }
    : init?.headers;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getDocument: () => req<DocumentResponse>("/api/document"),
  listDocuments: () =>
    req<{ documents: import("./types.js").DocumentInfo[]; currentId: string }>(
      "/api/documents",
    ),
  createDocument: (title: string) =>
    req<{ document: import("./types.js").DocumentInfo }>("/api/documents", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  selectDocument: (id: string) =>
    req<{ document: import("./types.js").DocumentInfo }>(
      `/api/documents/${id}/select`,
      { method: "POST" },
    ),
  deleteDocument: (id: string, removeFile = false) =>
    req<{ deleted: boolean; currentId: string }>(
      `/api/documents/${encodeURIComponent(id)}${removeFile ? "?removeFile=1" : ""}`,
      { method: "DELETE" },
    ),
  generate: (input: { prompt?: string; title?: string; asNew?: boolean }) =>
    req<{ started: boolean }>("/api/document/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  generateStatus: () =>
    req<{ status: import("./types.js").GenerateStatus }>(
      "/api/generate/status",
    ),
  preflight: () =>
    req<{ preflight: import("./types.js").PreflightResult }>("/api/preflight"),
  injectIds: () =>
    req<{ added: number }>("/api/document/inject-ids", { method: "POST" }),

  listComments: () => req<{ comments: Comment[] }>("/api/comments"),
  createComment: (input: CreateCommentInput) =>
    req<{ comment: Comment; job: Job | null }>("/api/comments", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteComment: (id: string) =>
    req<{ deleted: boolean }>(`/api/comments/${id}`, { method: "DELETE" }),

  getQueue: () =>
    req<{
      jobs: Job[];
      state: QueueState;
      busy: boolean;
      progress: JobProgress | null;
    }>("/api/queue"),
  queueProgress: () =>
    req<{ progress: JobProgress | null; busy: boolean }>(
      "/api/queue/progress",
    ),
  enqueue: (commentIds: string[]) =>
    req<{ jobs: Job[] }>("/api/queue", {
      method: "POST",
      body: JSON.stringify({ commentIds }),
    }),
  runNext: () => req<{ started: boolean }>("/api/queue/run-next", { method: "POST" }),
  runAll: () => req<{ started: boolean }>("/api/queue/run-all", { method: "POST" }),
  pause: () => req<{ state: QueueState }>("/api/queue/pause", { method: "POST" }),
  resume: () => req<{ state: QueueState }>("/api/queue/resume", { method: "POST" }),
  stopAfterCurrent: () =>
    req<{ state: QueueState }>("/api/queue/stop-after-current", {
      method: "POST",
    }),
  removeJob: (jobId: string) =>
    req<{ removed: boolean }>(`/api/queue/jobs/${jobId}/remove`, {
      method: "POST",
    }),
  reorderJob: (jobId: string, position: number) =>
    req<{ reordered: boolean }>(`/api/queue/jobs/${jobId}/reorder`, {
      method: "POST",
      body: JSON.stringify({ position }),
    }),

  getJob: (jobId: string) => req<{ job: Job }>(`/api/jobs/${jobId}`),
  rerunJob: (jobId: string, mode: "fresh" | "continue") =>
    req<{ job: Job }>(`/api/queue/jobs/${jobId}/rerun`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
};
