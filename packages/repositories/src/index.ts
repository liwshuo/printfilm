/**
 * @dramaflow/repositories — SQLite persistence layer.
 * Implements the repository ports declared in @dramaflow/domain. No business decisions here
 * (repo-structure §6): only mapping, migration, and CRUD/query mechanics.
 */

export { openDatabase } from "./sqlite/connection.js";
export type { SqliteDatabase, OpenDatabaseOptions } from "./sqlite/connection.js";
export {
  runMigrations,
  loadMigrations,
  defaultMigrationsDir,
} from "./sqlite/migrator.js";
export type { Migration, MigrationResult } from "./sqlite/migrator.js";

export {
  SqliteRepositoryRegistry,
  createSqliteRepositoryRegistry,
} from "./registry.js";
export type { CreateRegistryOptions, CreatedRegistry } from "./registry.js";

export {
  VersionedRepositoryBase,
  TimestampedRepositoryBase,
  runWithoutSnapshot,
} from "./repositories/base.js";
export type { TableMapping, ColumnDef, FieldKind } from "./repositories/base.js";
