/**
 * Round-3 P1-① 通用实体快照仓储。
 *
 * 表：`entity_snapshots`（migration 0007）。
 *
 * 与 `ScriptSnapshotRepository` 的区别：
 *   - ScriptSnapshotRepository 只覆盖"整集剧本 + 对白 + 动作"这三件套；
 *   - EntitySnapshotRepository 是通用的"任意 versioned 实体改动前"快照，
 *     由 `VersionedRepositoryBase.update` 的 sink 钩子自动写入。
 */
import type {
  EntitySnapshot,
  EntitySnapshotRepository,
  Id,
} from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { newId, nowIso } from "../util/id.js";

type Row = Record<string, unknown>;

function rowToEntity(row: Row): EntitySnapshot {
  const out: EntitySnapshot = {
    id: row["id"] as string,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
    entityType: row["entity_type"] as string,
    entityId: row["entity_id"] as string,
    version: row["version"] as number,
    payloadJson: row["payload_json"] as string,
  };
  const reason = row["reason"] as string | null;
  if (reason !== null && reason !== undefined) out.reason = reason;
  const summary = row["summary"] as string | null;
  if (summary !== null && summary !== undefined) out.summary = summary;
  return out;
}

export class SqliteEntitySnapshotRepository implements EntitySnapshotRepository {
  constructor(private readonly db: SqliteDatabase) {}

  append(
    input: Omit<EntitySnapshot, "id" | "createdAt" | "updatedAt"> & { id?: Id },
  ): EntitySnapshot {
    const id = input.id ?? newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO entity_snapshots
           (id, entity_type, entity_id, version, payload_json, reason, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.entityType,
        input.entityId,
        input.version,
        input.payloadJson,
        input.reason ?? null,
        input.summary ?? null,
        now,
        now,
      );
    const created: EntitySnapshot = {
      id,
      createdAt: now,
      updatedAt: now,
      entityType: input.entityType,
      entityId: input.entityId,
      version: input.version,
      payloadJson: input.payloadJson,
    };
    if (input.reason !== undefined) created.reason = input.reason;
    if (input.summary !== undefined) created.summary = input.summary;
    return created;
  }

  getById(id: Id): EntitySnapshot | null {
    const row = this.db
      .prepare(`SELECT * FROM entity_snapshots WHERE id = ?`)
      .get(id) as Row | undefined;
    return row ? rowToEntity(row) : null;
  }

  listByEntity(entityType: string, entityId: Id, limit = 20): EntitySnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entity_snapshots
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(entityType, entityId, limit) as Row[];
    return rows.map(rowToEntity);
  }

  deleteById(id: Id): void {
    this.db.prepare(`DELETE FROM entity_snapshots WHERE id = ?`).run(id);
  }

  trim(entityType: string, entityId: Id, keep: number): number {
    // 保留最近 keep 条，其余按 created_at ASC 删除。
    const info = this.db
      .prepare(
        `DELETE FROM entity_snapshots
         WHERE entity_type = ? AND entity_id = ?
           AND id NOT IN (
             SELECT id FROM entity_snapshots
             WHERE entity_type = ? AND entity_id = ?
             ORDER BY created_at DESC
             LIMIT ?
           )`,
      )
      .run(entityType, entityId, entityType, entityId, keep);
    return info.changes as number;
  }
}
