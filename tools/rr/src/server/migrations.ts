import type Database from "better-sqlite3";

// All schema lives here. Adding columns beyond the RFP spec (claude_status,
// claude_comment_for_reviewer) keeps the agent-result extensible per §21.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL DEFAULT 'main',
  title TEXT NOT NULL,
  html_path TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_version INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  rr_id TEXT,
  table_rr_id TEXT,
  row_index INTEGER,
  col_index INTEGER,
  selected_text TEXT,
  prefix TEXT,
  suffix TEXT,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  position INTEGER NOT NULL,
  claude_process_id INTEGER,
  claude_status TEXT,
  claude_summary TEXT,
  claude_raw_output TEXT,
  claude_comment_for_reviewer TEXT,
  diff_text TEXT,
  error_message TEXT,
  needs_follow_up INTEGER NOT NULL DEFAULT 0,
  incomplete_reason TEXT,
  session_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  used_resume INTEGER NOT NULL DEFAULT 0,
  usage_json TEXT,
  force_fresh INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS job_comments (
  job_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  PRIMARY KEY(job_id, comment_id)
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_document ON comments(document_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, position);
CREATE INDEX IF NOT EXISTS idx_job_comments_job ON job_comments(job_id);
`;

function hasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return cols.some((c) => c.name === column);
}

export function runMigrations(db: Database.Database): void {
  db.exec(SCHEMA);
  // Additive migration for DBs created before multi-document support.
  if (!hasColumn(db, "documents", "slug")) {
    db.exec("ALTER TABLE documents ADD COLUMN slug TEXT NOT NULL DEFAULT 'main'");
  }
  // Additive migrations for re-run / continue support.
  if (!hasColumn(db, "jobs", "needs_follow_up")) {
    db.exec("ALTER TABLE jobs ADD COLUMN needs_follow_up INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "jobs", "incomplete_reason")) {
    db.exec("ALTER TABLE jobs ADD COLUMN incomplete_reason TEXT");
  }
  if (!hasColumn(db, "jobs", "session_id")) {
    db.exec("ALTER TABLE jobs ADD COLUMN session_id TEXT");
  }
  if (!hasColumn(db, "jobs", "attempt")) {
    db.exec("ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1");
  }
  if (!hasColumn(db, "jobs", "used_resume")) {
    db.exec("ALTER TABLE jobs ADD COLUMN used_resume INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "jobs", "usage_json")) {
    db.exec("ALTER TABLE jobs ADD COLUMN usage_json TEXT");
  }
  if (!hasColumn(db, "jobs", "force_fresh")) {
    db.exec("ALTER TABLE jobs ADD COLUMN force_fresh INTEGER NOT NULL DEFAULT 0");
  }
}
