import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { eventBus } from "../services/eventBus.js";

export function eventRoutes(app: FastifyInstance, _ctx: AppContext): void {
  // Server-Sent Events stream (RFP §12.5).
  app.get("/api/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    const unsubscribe = eventBus.onEvent((event) => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event.payload ?? {})}\n\n`);
    });

    // Heartbeat to keep the connection alive through proxies.
    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 25000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
