import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function documentRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Return the current document metadata + HTML (rr-ids injected if configured).
  app.get("/api/document", async () => {
    if (ctx.config.review.auto_inject_ids) {
      ctx.docs.injectIdsOnDisk();
    }
    const info = ctx.docs.getInfo();
    const html = ctx.docs.readHtml();
    return {
      document: info,
      html,
      exists: ctx.docs.exists(),
      idAttribute: ctx.config.review.id_attribute,
    };
  });

  // List all requirement documents (importing any new on-disk HTML files).
  app.get("/api/documents", async () => {
    ctx.docs.scanDisk();
    return {
      documents: ctx.docs.list(),
      currentId: ctx.docs.currentId(),
    };
  });

  // Delete a requirement document (and its comments/jobs). HTML file is removed
  // if it was never generated (empty/missing), or when ?removeFile=1.
  app.delete<{ Params: { id: string }; Querystring: { removeFile?: string } }>(
    "/api/documents/:id",
    async (req, reply) => {
      try {
        const removeFile = req.query?.removeFile === "1";
        const ok = ctx.docs.delete(req.params.id, removeFile ? { removeFile } : {});
        if (!ok) return reply.status(404).send({ error: "見つかりません" });
        return { deleted: true, currentId: ctx.docs.currentId() };
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Create a new (empty) requirement document and make it current.
  app.post<{ Body: { title: string } }>(
    "/api/documents",
    async (req, reply) => {
      const title = req.body?.title?.trim();
      if (!title) return reply.status(400).send({ error: "title は必須です" });
      const doc = ctx.docs.create({ title });
      return reply.status(201).send({ document: doc });
    },
  );

  // Switch the current document (load).
  app.post<{ Params: { id: string } }>(
    "/api/documents/:id/select",
    async (req, reply) => {
      const doc = ctx.docs.setCurrent(req.params.id);
      if (!doc) return reply.status(404).send({ error: "見つかりません" });
      return { document: doc };
    },
  );

  // Generate (initial draft) via Claude Code. Default: create a new document.
  app.post<{
    Body: { prompt?: string; title?: string; asNew?: boolean };
  }>("/api/document/generate", async (req, reply) => {
    if (ctx.generator.isBusy() || ctx.worker.isBusy()) {
      return reply.status(409).send({ error: "処理中です" });
    }
    // Run in the background; UI tracks progress via SSE.
    const body = req.body ?? {};
    ctx.generator
      .generate({ prompt: body.prompt, title: body.title, asNew: body.asNew })
      .catch((e) => app.log.error(e));
    return reply.status(202).send({ started: true });
  });

  // Pollable generation status (SSE-independent; works behind buffering proxies).
  app.get("/api/generate/status", async () => {
    return { status: ctx.generator.getStatus() };
  });

  // Agent preflight: is the command present and logged in?
  app.get("/api/preflight", async () => {
    return { preflight: await ctx.generator.preflight() };
  });

  // Force rr-id injection on disk.
  app.post("/api/document/inject-ids", async () => {
    const added = ctx.docs.injectIdsOnDisk();
    return { added };
  });
}
