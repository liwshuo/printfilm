import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SqliteDatabase } from "./connection.js";

/**
 * File-based SQL migration runner (adr-005).
 * - migrations are versioned files `NNNN_name.sql`, applied in ascending order
 * - each migration runs inside a transaction (adr-005 §4.3)
 * - applied versions + checksums are recorded in `schema_migrations`
 * - a changed checksum on an already-applied version aborts startup (tamper guard, adr-005 §4.2)
 */

export interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Resolve the directory holding *.sql migrations. Works both when running from
 * compiled `dist/` (if .sql are copied there) and directly from `src/`.
 */
export function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "migrations"),
    join(here, "..", "..", "src", "sqlite", "migrations"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]!;
}

/** Read and hash all migration files from a directory, sorted by filename. */
export function loadMigrations(dir: string = defaultMigrationsDir()): Migration[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const version = file.replace(/\.sql$/, "");
      const sql = readFileSync(join(dir, file), "utf8");
      return { version, sql, checksum: sha256(sql) };
    });
}

function ensureMigrationsTable(db: SqliteDatabase): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL,
       checksum TEXT NOT NULL
     );`,
  );
}

/**
 * Apply all pending migrations in order. Idempotent: already-applied versions are
 * skipped; a checksum mismatch on an applied version throws (never silently reapplies).
 */
export function runMigrations(
  db: SqliteDatabase,
  migrations: Migration[] = loadMigrations(),
): MigrationResult {
  ensureMigrationsTable(db);

  const appliedRows = db
    .prepare("SELECT version, checksum FROM schema_migrations")
    .all() as Array<{ version: string; checksum: string }>;
  const appliedMap = new Map(appliedRows.map((r) => [r.version, r.checksum]));

  const result: MigrationResult = { applied: [], skipped: [] };
  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)",
  );

  for (const migration of migrations) {
    const existing = appliedMap.get(migration.version);
    if (existing !== undefined) {
      if (existing !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch for '${migration.version}': ` +
            `an applied migration file was modified (adr-005 forbids editing applied migrations).`,
        );
      }
      result.skipped.push(migration.version);
      continue;
    }

    const applyOne = db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.version, new Date().toISOString(), migration.checksum);
    });
    applyOne();
    result.applied.push(migration.version);
  }

  return result;
}
