import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import type { CreateCommentInput, TargetType } from "../../shared/types.js";

const VALID_TYPES: TargetType[] = [
  "global",
  "line",
  "block",
  "table_row",
  "table_cell",
  "diagram",
  "diagram_line",
];

export function commentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/comments", async () => {
    return { comments: ctx.comments.list() };
  });

  app.post<{ Body: CreateCommentInput }>("/api/comments", async (req, reply) => {
    const body = req.body;
    if (!body || typeof body.comment !== "string" || !body.comment.trim()) {
      return reply.status(400).send({ error: "comment は必須です" });
    }
    if (!VALID_TYPES.includes(body.targetType)) {
      return reply.status(400).send({ error: `不正な targetType: ${body.targetType}` });
    }
    const comment = ctx.comments.create(body);
    let job = null;
    if (body.queue) {
      const jobs = ctx.queue.enqueueComments([comment.id]);
      job = jobs[0] ?? null;
      ctx.worker.autoDrain(); // process in order automatically
    }
    return reply.status(201).send({ comment, job });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/comments/:id",
    async (req, reply) => {
      const updated = ctx.comments.update(req.params.id, req.body as never);
      if (!updated) return reply.status(404).send({ error: "見つかりません" });
      return { comment: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/comments/:id",
    async (req, reply) => {
      const ok = ctx.comments.delete(req.params.id);
      if (!ok) return reply.status(404).send({ error: "見つかりません" });
      return { deleted: true };
    },
  );
}
