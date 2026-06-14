import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type DB = Database.Database;

let cached: { path: string; db: DB } | null = null;

export function openDb(path: string): DB {
  if (cached && cached.path === path) return cached.db;
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  cached = { path, db };
  return db;
}

export function closeDb(): void {
  if (cached) {
    cached.db.close();
    cached = null;
  }
}
