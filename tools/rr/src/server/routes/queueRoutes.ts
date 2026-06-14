import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function queueRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/queue", async () => {
    return {
      jobs: ctx.queue.list(),
      state: ctx.queue.getQueueState(),
      busy: ctx.worker.isBusy(),
      progress: ctx.worker.getProgress(),
    };
  });

  // Live progress of the running job (poll-friendly, SSE-independent).
  app.get("/api/queue/progress", async () => {
    return { progress: ctx.worker.getProgress(), busy: ctx.worker.isBusy() };
  });

  // Enqueue comment(s). Body: { commentIds: string[] }.
  app.post<{ Body: { commentIds: string[] } }>(
    "/api/queue",
    async (req, reply) => {
      const ids = req.body?.commentIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: "commentIds が必要です" });
      }
      const jobs = ctx.queue.enqueueComments(ids);
      ctx.worker.autoDrain(); // process in order automatically
      return reply.status(201).send({ jobs });
    },
  );

  app.post("/api/queue/run-next", async (_req, reply) => {
    if (ctx.worker.isBusy() || ctx.generator.isBusy()) {
      return reply.status(409).send({ error: "処理中です" });
    }
    // Run in the background; UI tracks progress via SSE.
    const promise = ctx.worker.runNext();
    promise.catch((e) => app.log.error(e));
    return { started: true };
  });

  app.post("/api/queue/run-all", async (_req, reply) => {
    if (ctx.worker.isBusy() || ctx.generator.isBusy()) {
      return reply.status(409).send({ error: "処理中です" });
    }
    const promise = ctx.worker.runAll();
    promise.catch((e) => app.log.error(e));
    return { started: true };
  });

  app.post("/api/queue/pause", async () => {
    ctx.queue.pause();
    return { state: ctx.queue.getQueueState() };
  });

  app.post("/api/queue/resume", async () => {
    ctx.queue.resume();
    ctx.worker.autoDrain(); // resume processing any pending jobs
    return { state: ctx.queue.getQueueState() };
  });

  app.post("/api/queue/stop-after-current", async () => {
    ctx.queue.stopAfterCurrent();
    return { state: ctx.queue.getQueueState() };
  });

  app.post<{ Params: { jobId: string } }>(
    "/api/queue/jobs/:jobId/remove",
    async (req, reply) => {
      const ok = ctx.queue.remove(req.params.jobId);
      if (!ok) {
        return reply
          .status(409)
          .send({ error: "削除できません（実行中、または存在しません）" });
      }
      return { removed: true };
    },
  );

  app.post<{ Params: { jobId: string }; Body: { position: number } }>(
    "/api/queue/jobs/:jobId/reorder",
    async (req, reply) => {
      const pos = Number(req.body?.position);
      if (!Number.isFinite(pos)) {
        return reply.status(400).send({ error: "position が必要です" });
      }
      const ok = ctx.queue.reorder(req.params.jobId, pos);
      if (!ok) return reply.status(404).send({ error: "見つかりません" });
      return { reordered: true };
    },
  );

  // Re-run a finished job: mode "fresh" (start over) or "continue" (resume the
  // same Claude session to finish where it stopped).
  app.post<{ Params: { jobId: string }; Body: { mode?: "fresh" | "continue" } }>(
    "/api/queue/jobs/:jobId/rerun",
    async (req, reply) => {
      const mode = req.body?.mode === "continue" ? "continue" : "fresh";
      if (mode === "continue") {
        const job = ctx.queue.get(req.params.jobId);
        if (job && !job.sessionId) {
          return reply.status(400).send({
            error:
              "このジョブにはセッション情報がないため『続きを実行』できません。『もう一度実行』を使ってください。",
          });
        }
      }
      const job = ctx.queue.requeue(req.params.jobId, mode);
      if (!job) return reply.status(404).send({ error: "見つかりません" });
      ctx.worker.autoDrain();
      return { job };
    },
  );

  // Job results (RFP §12.4).
  app.get<{ Params: { jobId: string } }>(
    "/api/jobs/:jobId",
    async (req, reply) => {
      const job = ctx.queue.get(req.params.jobId);
      if (!job) return reply.status(404).send({ error: "見つかりません" });
      return { job };
    },
  );

  app.get<{ Params: { jobId: string } }>(
    "/api/jobs/:jobId/diff",
    async (req, reply) => {
      const job = ctx.queue.get(req.params.jobId);
      if (!job) return reply.status(404).send({ error: "見つかりません" });
      return { diff: job.diffText ?? "" };
    },
  );
}
