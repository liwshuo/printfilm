/**
 * Generic SQLite repository bases.
 *
 * A `TableMapping` declares how entity (camelCase) fields map to DB (snake_case) columns and
 * how each value is (de)serialized. Managed columns (id / created_at / updated_at / version)
 * are handled by the base classes, not the mapping.
 *
 * - `VersionedRepositoryBase` enforces optimistic locking (adr-003): update requires
 *   `expectedVersion` and throws DomainError(version_conflict) on mismatch.
 * - `TimestampedRepositoryBase` is for entities with created/updated timestamps but no version.
 */

import type { BaseEntity, Id } from "@dramaflow/domain";
import { versionConflict, missingResource } from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { newId, nowIso } from "../util/id.js";
import {
  toJson,
  fromJsonObject,
  fromJsonArray,
  toDbBool,
  fromDbBool,
  orUndefined,
} from "../util/json.js";

export type FieldKind =
  | "text"
  | "int"
  | "real"
  | "bool"
  | "json"
  | "jsonArray"
  | "stringArray";

export interface ColumnDef {
  /** DB column name (snake_case). */
  column: string;
  /** Entity field name (camelCase). */
  field: string;
  kind: FieldKind;
  /** Entity field is optional / column is nullable. */
  nullable?: boolean;
}

export interface TableMapping {
  table: string;
  /** Non-managed columns. id / created_at / updated_at / version are implicit. */
  columns: ColumnDef[];
}

type Row = Record<string, unknown>;

function toDbValue(kind: FieldKind, value: unknown): unknown {
  switch (kind) {
    case "text":
    case "int":
    case "real":
      return value ?? null;
    case "bool":
      return toDbBool(value as boolean | undefined);
    case "json":
      return toJson(value ?? {});
    case "jsonArray":
    case "stringArray":
      return toJson(value ?? []);
  }
}

function fromDbValue(def: ColumnDef, raw: unknown): unknown {
  switch (def.kind) {
    case "text":
    case "int":
    case "real":
      return def.nullable ? orUndefined(raw) : raw;
    case "bool":
      return fromDbBool(raw);
    case "json":
      return fromJsonObject(raw);
    case "jsonArray":
      return fromJsonArray(raw);
    case "stringArray":
      return fromJsonArray<string>(raw);
  }
}

abstract class SqliteRepositoryBase<T extends BaseEntity> {
  protected constructor(
    protected readonly db: SqliteDatabase,
    protected readonly mapping: TableMapping,
    /** whether this table carries a `version` column. */
    protected readonly versioned: boolean,
  ) {}

  /** Build an entity from a DB row. */
  protected rowToEntity(row: Row): T {
    const out: Record<string, unknown> = {
      id: row["id"],
      createdAt: row["created_at"],
      updatedAt: row["updated_at"],
    };
    if (this.versioned) out["version"] = row["version"];
    for (const def of this.mapping.columns) {
      out[def.field] = fromDbValue(def, row[def.column]);
    }
    return out as T;
  }

  getById(id: Id): T | null {
    const row = this.db
      .prepare(`SELECT * FROM ${this.mapping.table} WHERE id = ?`)
      .get(id) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  protected getByIdOrThrow(id: Id): T {
    const found = this.getById(id);
    if (!found) {
      throw missingResource(`对象不存在或已被删除。`, { table: this.mapping.table, id });
    }
    return found;
  }

  delete(id: Id): void {
    this.db.prepare(`DELETE FROM ${this.mapping.table} WHERE id = ?`).run(id);
  }

  /** Column list + value list for the mapped (non-managed) columns given an input object. */
  protected mappedInsertParts(input: Record<string, unknown>): {
    columns: string[];
    values: unknown[];
  } {
    const columns: string[] = [];
    const values: unknown[] = [];
    for (const def of this.mapping.columns) {
      columns.push(def.column);
      values.push(toDbValue(def.kind, input[def.field]));
    }
    return { columns, values };
  }

  /** SET assignments + values for the fields present in a patch. */
  protected mappedUpdateParts(patch: Record<string, unknown>): {
    assignments: string[];
    values: unknown[];
  } {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const def of this.mapping.columns) {
      if (Object.prototype.hasOwnProperty.call(patch, def.field)) {
        assignments.push(`${def.column} = ?`);
        values.push(toDbValue(def.kind, patch[def.field]));
      }
    }
    return { assignments, values };
  }
}

/** Base for versioned (optimistic-locked) entities. */
export abstract class VersionedRepositoryBase<
  T extends BaseEntity & { version: number },
> extends SqliteRepositoryBase<T> {
  protected constructor(db: SqliteDatabase, mapping: TableMapping) {
    super(db, mapping, true);
  }

  create(input: Record<string, unknown> & { id?: Id }): T {
    const id = (input.id as Id | undefined) ?? newId();
    const now = nowIso();
    const { columns, values } = this.mappedInsertParts(input);
    const allColumns = ["id", ...columns, "version", "created_at", "updated_at"];
    const allValues = [id, ...values, 1, now, now];
    const placeholders = allColumns.map(() => "?").join(", ");
    this.db
      .prepare(
        `INSERT INTO ${this.mapping.table} (${allColumns.join(", ")}) VALUES (${placeholders})`,
      )
      .run(...allValues);
    return this.getByIdOrThrow(id);
  }

  update(id: Id, patch: Record<string, unknown>, expectedVersion: number): T {
    // Round-3 P1-①：在写入前捕获旧版本快照。sink 由 registry bootstrap 注入，
    // 未注入时（例如老单测）行为完全不变。
    // 若被 `runWithoutSnapshot` 包裹（例如 rollup 汇总这类"业务噪音"），跳过快照。
    const sink = getSnapshotSink();
    if (sink && snapshotSuppressCount === 0) {
      const current = this.getById(id);
      if (current && current.version === expectedVersion) {
        try {
          sink({
            entityType: this.mapping.table,
            entityId: id,
            version: current.version,
            payload: current as unknown as Record<string, unknown>,
            reason: "update",
          });
        } catch {
          // 快照失败不阻塞主流程；具体错误由 sink 实现自己记录。
        }
      }
    }

    const { assignments, values } = this.mappedUpdateParts(patch);
    const now = nowIso();
    const sql =
      `UPDATE ${this.mapping.table} SET ` +
      [...assignments, "updated_at = ?", "version = version + 1"].join(", ") +
      ` WHERE id = ? AND version = ?`;
    const info = this.db.prepare(sql).run(...values, now, id, expectedVersion);
    if (info.changes === 0) {
      const current = this.getById(id);
      if (!current) {
        throw missingResource(`对象不存在或已被删除。`, { table: this.mapping.table, id });
      }
      throw versionConflict({
        currentVersion: current.version,
        updatedAt: current.updatedAt,
        summary: { id, table: this.mapping.table },
      });
    }
    return this.getByIdOrThrow(id);
  }
}

/**
 * Round-3 P1-① snapshot sink 全局钩子。
 *
 * VersionedRepositoryBase.update 会在写入前调用 sink（若已注入），把旧记录快照到
 * `entity_snapshots`。sink 由 registry bootstrap 注入，避免 repositories 层直接依赖
 * 另一个 repo 类。
 *
 * 设计要点：
 *   - sink 抛错不能影响主流程，业务级失败在 sink 内部消化；
 *   - sink 可以判断 `reason` 决定是否要写（例如 rollback 就跳过再写快照）；
 *   - payload 已是 camelCase 的实体 JS 对象，sink 自己 stringify。
 */
export interface SnapshotSinkInput {
  entityType: string;
  entityId: Id;
  version: number;
  payload: Record<string, unknown>;
  reason: "update" | "regenerate" | "rollback" | "manual";
}

export type SnapshotSink = (input: SnapshotSinkInput) => void;

let snapshotSink: SnapshotSink | undefined;

export function installSnapshotSink(sink: SnapshotSink | undefined): void {
  snapshotSink = sink;
}

export function getSnapshotSink(): SnapshotSink | undefined {
  return snapshotSink;
}

/**
 * Round-3 P1-①（补丁）：允许业务代码在一段调用栈里跳过快照 sink。
 *
 * 场景：某些 update 是"业务噪音"，比如 `recomputeEpisodeStoryboardRollup`
 * 会把 rollup 状态回写到 episode，这类 update 用户根本不感知，也没有
 * 回滚意义。留在历史抽屉里会稀释真正的"人工/AI 改过"版本。
 *
 * 用法：
 * ```ts
 * runWithoutSnapshot(() => this.repos.episodes.update(...));
 * ```
 *
 * 注意：使用 counter 而非 boolean，允许嵌套调用。
 */
let snapshotSuppressCount = 0;

export function runWithoutSnapshot<T>(fn: () => T): T {
  snapshotSuppressCount++;
  try {
    return fn();
  } finally {
    snapshotSuppressCount--;
  }
}

/** Base for timestamped entities without optimistic locking. */
export abstract class TimestampedRepositoryBase<
  T extends BaseEntity,
> extends SqliteRepositoryBase<T> {
  protected constructor(db: SqliteDatabase, mapping: TableMapping) {
    super(db, mapping, false);
  }

  create(input: Record<string, unknown> & { id?: Id }): T {
    const id = (input.id as Id | undefined) ?? newId();
    const now = nowIso();
    const { columns, values } = this.mappedInsertParts(input);
    const allColumns = ["id", ...columns, "created_at", "updated_at"];
    const allValues = [id, ...values, now, now];
    const placeholders = allColumns.map(() => "?").join(", ");
    this.db
      .prepare(
        `INSERT INTO ${this.mapping.table} (${allColumns.join(", ")}) VALUES (${placeholders})`,
      )
      .run(...allValues);
    return this.getByIdOrThrow(id);
  }

  update(id: Id, patch: Record<string, unknown>): T {
    const { assignments, values } = this.mappedUpdateParts(patch);
    const now = nowIso();
    if (assignments.length === 0) {
      // still bump updated_at
      this.db
        .prepare(`UPDATE ${this.mapping.table} SET updated_at = ? WHERE id = ?`)
        .run(now, id);
      return this.getByIdOrThrow(id);
    }
    const sql =
      `UPDATE ${this.mapping.table} SET ` +
      [...assignments, "updated_at = ?"].join(", ") +
      ` WHERE id = ?`;
    this.db.prepare(sql).run(...values, now, id);
    return this.getByIdOrThrow(id);
  }
}
