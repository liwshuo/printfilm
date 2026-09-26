/**
 * VideoAssetRepository — Round-4 Phase-C：Seedance 视频落库。
 *
 * 与 ImageAssetRepository 同为 append-only：无版本、无 update；重生就 create 一条。
 */

import type { VideoAsset, VideoAssetRepository, Id } from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { TimestampedRepositoryBase } from "./base.js";
import { videoAssetMapping } from "../mappers/mappings.js";

type Row = Record<string, unknown>;

export class SqliteVideoAssetRepository
  extends TimestampedRepositoryBase<VideoAsset>
  implements VideoAssetRepository
{
  constructor(db: SqliteDatabase) {
    super(db, videoAssetMapping);
  }

  listByEpisode(episodeId: Id): VideoAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM video_assets WHERE episode_id = ? ORDER BY created_at DESC`,
      )
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByScene(sceneId: Id): VideoAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM video_assets WHERE scene_id = ? ORDER BY created_at DESC`,
      )
      .all(sceneId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByShot(shotId: Id): VideoAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM video_assets WHERE shot_id = ? ORDER BY created_at DESC`,
      )
      .all(shotId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  latestByShot(shotId: Id): VideoAsset | null {
    const row = this.db
      .prepare(
        `SELECT * FROM video_assets WHERE shot_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(shotId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  /**
   * Episode 页 CTA 用：一次拿到本集所有 shot 的最新视频，
   * 让「拼接导出」按钮可以判断是否所有 shot 都已就绪。
   */
  latestByEpisodeShots(episodeId: Id): VideoAsset[] {
    const rows = this.db
      .prepare(
        `SELECT v.* FROM video_assets v
         INNER JOIN (
           SELECT shot_id, MAX(created_at) AS max_created_at
           FROM video_assets
           WHERE episode_id = ? AND shot_id IS NOT NULL
           GROUP BY shot_id
         ) latest
           ON latest.shot_id = v.shot_id
          AND latest.max_created_at = v.created_at
         ORDER BY v.created_at ASC`,
      )
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}
