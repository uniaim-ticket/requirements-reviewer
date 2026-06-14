import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { requireProjectRoot } from "./config.js";
import { createContext, type AppContext } from "./context.js";
import { documentRoutes } from "./routes/documentRoutes.js";
import { commentRoutes } from "./routes/commentRoutes.js";
import { queueRoutes } from "./routes/queueRoutes.js";
import { eventRoutes } from "./routes/eventRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  // forceCloseConnections: drop open sockets (incl. long-lived SSE streams) on
  // app.close() so the process actually exits on Ctrl+C.
  const app = Fastify({ logger: false, forceCloseConnections: true });

  // Tolerate empty JSON bodies on POSTs that carry no payload (e.g. selects,
  // queue controls) so they don't fail with a 400 "Body cannot be empty".
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body: string, done) => {
      if (!body || (body as string).trim() === "") {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  documentRoutes(app, ctx);
  commentRoutes(app, ctx);
  queueRoutes(app, ctx);
  eventRoutes(app, ctx);

  // Serve the built client from dist/client at /app (vite base = /app/).
  const clientDir = path.resolve(__dirname, "../client");
  if (fs.existsSync(clientDir)) {
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: "/app/",
    });
    // Relative redirect so it works behind a path-prefixing proxy.
    app.get("/", async (_req, reply) => reply.redirect("app/"));
  } else {
    app.get("/", async () => ({
      message:
        "クライアントが未ビルドです。`npm run build` を実行するか、`npm run dev:client` を使ってください。",
    }));
  }

  return app;
}

/**
 * Watch the documents directory and, on any *.html change, sync the current
 * document from disk (bump version / emit SSE) and import new files. Watching
 * the whole directory (not a single file) keeps it correct across document
 * switches and picks up files added out-of-band.
 */
function watchDocument(ctx: AppContext): () => void {
  const dir = ctx.docs.baseDir();
  if (!fs.existsSync(dir)) return () => {};
  let timer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(dir, (_event, filename) => {
    if (filename && !/\.html?$/i.test(filename.toString())) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      ctx.docs.scanDisk(); // pick up newly added files
      ctx.docs.syncFromDisk(); // bump version + emit document_updated
    }, 250);
  });
  return () => watcher.close();
}

export interface StartOptions {
  /** Override the configured port. Use 0 to let the OS pick a free port. */
  port?: number;
  /** Fall back to a random free port if the chosen one is busy (default true). */
  autoPort?: boolean;
}

export interface RunningServer {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const root = requireProjectRoot();
  const ctx = createContext(root);
  // forceCloseConnections ensures lingering SSE/keep-alive sockets don't keep
  // the process alive on shutdown (why Ctrl+C sometimes "hung").
  const app = await buildServer(ctx);
  const stopWatch = watchDocument(ctx);

  const { host } = ctx.config.server;
  const preferredPort = opts.port ?? ctx.config.server.port;
  const autoPort = opts.autoPort ?? true;

  let port = preferredPort;
  try {
    await app.listen({ host, port });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && autoPort) {
      // eslint-disable-next-line no-console
      console.log(
        `ポート ${host}:${preferredPort} は使用中のため、空きポートを使用します。`,
      );
      await app.listen({ host, port: 0 }); // 0 => OS assigns a free port
      const addr = app.server.address();
      port = typeof addr === "object" && addr ? addr.port : preferredPort;
    } else if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(
        `ポート ${host}:${preferredPort} は既に使用中です。\n` +
          `  - 既に rr serve が起動している可能性があります。\n` +
          `  - 使用中のプロセス: lsof -i :${preferredPort}\n` +
          `  - 別ポートで起動: rr serve --port <番号>`,
      );
    } else {
      throw err;
    }
  }

  const url = `http://${host}:${port}/app/`;
  // eslint-disable-next-line no-console
  console.log(`
rr - Requirements Review

Document: ${ctx.config.document.path}
Server:   ${url}
Queue:    ${ctx.queue.getQueueState().state}
Agent:    ${ctx.config.agent.command}

停止するには Ctrl+C を押してください。
`);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    stopWatch();
    // Hard backstop: if a connection refuses to drain, exit anyway.
    const hardExit = setTimeout(() => process.exit(0), 3000);
    hardExit.unref();
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  const onSignal = () => {
    // eslint-disable-next-line no-console
    console.log("\n停止しています...");
    void close();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return { url, host, port, close };
}

// When run directly (npm run dev / node dist/server/index.js).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
