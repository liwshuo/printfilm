/**
 * A1 scope 扩展 repositories:
 * - continuity_locks（带 timestamps，无 version，可 disable）
 * - episode_asset_refs（复合主键，无 version，attach/detach/list only）
 */

import type {
  ContinuityLock,
  ContinuityLockRepository,
  EpisodeAssetRef,
  EpisodeAssetRefRepository,
  Id,
} from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { TimestampedRepositoryBase } from "./base.js";
import { continuityLockMapping } from "../mappers/mappings.js";
import { nowIso } from "../util/id.js";

type Row = Record<string, unknown>;

export class SqliteContinuityLockRepository
  extends TimestampedRepositoryBase<ContinuityLock>
  implements ContinuityLockRepository
{
  constructor(db: SqliteDatabase) {
    super(db, continuityLockMapping);
  }

  listByProject(projectId: Id): ContinuityLock[] {
    const rows = this.db
      .prepare("SELECT * FROM continuity_locks WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByEpisode(episodeId: Id): ContinuityLock[] {
    const rows = this.db
      .prepare("SELECT * FROM continuity_locks WHERE episode_id = ? ORDER BY created_at ASC")
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listActive(projectId: Id, episodeId?: Id): ContinuityLock[] {
    const rows = episodeId
      ? (this.db
          .prepare(
            `SELECT * FROM continuity_locks
             WHERE project_id = ? AND status = 'active'
               AND (episode_id IS NULL OR episode_id = ?)
             ORDER BY created_at ASC`,
          )
          .all(projectId, episodeId) as Row[])
      : (this.db
          .prepare(
            `SELECT * FROM continuity_locks
             WHERE project_id = ? AND status = 'active' AND episode_id IS NULL
             ORDER BY created_at ASC`,
          )
          .all(projectId) as Row[]);
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteEpisodeAssetRefRepository implements EpisodeAssetRefRepository {
  constructor(private readonly db: SqliteDatabase) {}

  attach(input: Omit<EpisodeAssetRef, "createdAt">): EpisodeAssetRef {
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO episode_asset_refs
         (episode_id, asset_type, asset_id, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.episodeId, input.assetType, input.assetId, input.note ?? null, createdAt);
    return { ...input, createdAt };
  }

  detach(episodeId: Id, assetType: EpisodeAssetRef["assetType"], assetId: Id): void {
    this.db
      .prepare(
        `DELETE FROM episode_asset_refs
         WHERE episode_id = ? AND asset_type = ? AND asset_id = ?`,
      )
      .run(episodeId, assetType, assetId);
  }

  listByEpisode(episodeId: Id): EpisodeAssetRef[] {
    const rows = this.db
      .prepare(
        `SELECT episode_id, asset_type, asset_id, note, created_at
         FROM episode_asset_refs WHERE episode_id = ?
         ORDER BY created_at ASC`,
      )
      .all(episodeId) as Row[];
    return rows.map(this.toEntity);
  }

  listByAsset(assetType: EpisodeAssetRef["assetType"], assetId: Id): EpisodeAssetRef[] {
    const rows = this.db
      .prepare(
        `SELECT episode_id, asset_type, asset_id, note, created_at
         FROM episode_asset_refs WHERE asset_type = ? AND asset_id = ?
         ORDER BY created_at ASC`,
      )
      .all(assetType, assetId) as Row[];
    return rows.map(this.toEntity);
  }

  private toEntity = (row: Row): EpisodeAssetRef => ({
    episodeId: row.episode_id as Id,
    assetType: row.asset_type as EpisodeAssetRef["assetType"],
    assetId: row.asset_id as Id,
    note: (row.note as string | null) ?? undefined,
    createdAt: row.created_at as string,
  });
}
