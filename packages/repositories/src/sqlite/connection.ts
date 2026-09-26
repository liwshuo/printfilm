import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  /** File path, or ":memory:" for an in-memory DB (tests). */
  filename: string;
  /** Enable verbose logging of SQL (dev only). */
  verbose?: (message?: unknown, ...args: unknown[]) => void;
  /** Skip WAL (in-memory DBs do not support WAL meaningfully). */
  readonly?: boolean;
}

/**
 * Open a SQLite database with the pragmas required by the schema:
 * - foreign_keys ON (schema relies on ON DELETE CASCADE / SET NULL)
 * - WAL journalling for local-first concurrent reads
 * - busy_timeout so brief writer locks don't fail immediately
 */
export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  const { filename } = options;
  if (filename !== ":memory:") {
    const dir = dirname(filename);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const db = new Database(filename, {
    ...(options.verbose ? { verbose: options.verbose } : {}),
    ...(options.readonly ? { readonly: true } : {}),
  });

  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("busy_timeout = 5000");
  return db;
}
