import { openDb, type DB } from "./db.js";
import { dbPath, loadConfig, type RrConfig } from "./config.js";
import { DocumentService } from "./services/documentService.js";
import { CommentService } from "./services/commentService.js";
import { QueueService } from "./services/queueService.js";
import { WorkerService } from "./services/workerService.js";
import { GenerateService } from "./services/generateService.js";

export interface AppContext {
  root: string;
  config: RrConfig;
  db: DB;
  docs: DocumentService;
  comments: CommentService;
  queue: QueueService;
  worker: WorkerService;
  generator: GenerateService;
}

/** Build the fully-wired service context for a project root. */
export function createContext(root: string): AppContext {
  const config = loadConfig(root);
  const db = openDb(dbPath(root));

  const docs = new DocumentService(db, root, config);
  docs.ensureRecord();
  // Import any HTML files on disk that have no document record yet.
  docs.scanDisk();
  // Pick up any out-of-band edits to the HTML on startup.
  docs.syncFromDisk(false);

  // Comments and jobs are scoped to whichever document is currently selected.
  const currentDocId = () => docs.currentId();
  const version = () => docs.getInfo()?.currentVersion ?? 1;
  const comments = new CommentService(db, currentDocId, version);
  const queue = new QueueService(db, currentDocId, version, comments);
  const worker = new WorkerService(config, root, docs, queue);
  const generator = new GenerateService(config, root, docs);

  // Resume any jobs left queued from a previous run (unless paused).
  worker.autoDrain();

  return { root, config, db, docs, comments, queue, worker, generator };
}
