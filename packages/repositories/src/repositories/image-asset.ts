/**
 * ImageAssetRepository — 综合方案 §4.F、M4#2。
 *
 * 无版本、无 update 语义（AI 出的图不可变，需要重生就重新 create 一条）。
 */

import type {
  ImageAsset,
  ImageAssetRepository,
  Id,
} from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { TimestampedRepositoryBase } from "./base.js";
import { imageAssetMapping } from "../mappers/mappings.js";

type Row = Record<string, unknown>;

export class SqliteImageAssetRepository
  extends TimestampedRepositoryBase<ImageAsset>
  implements ImageAssetRepository
{
  constructor(db: SqliteDatabase) {
    super(db, imageAssetMapping);
  }

  listByEpisode(episodeId: Id): ImageAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE episode_id = ? ORDER BY created_at DESC`,
      )
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByScene(sceneId: Id): ImageAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE scene_id = ? ORDER BY created_at DESC`,
      )
      .all(sceneId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByShot(shotId: Id): ImageAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE shot_id = ? ORDER BY created_at DESC`,
      )
      .all(shotId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByKeyframe(keyframeId: Id): ImageAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE keyframe_id = ? ORDER BY created_at DESC`,
      )
      .all(keyframeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  latestByEpisode(episodeId: Id): ImageAsset | null {
    const row = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE episode_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(episodeId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  latestByShot(shotId: Id): ImageAsset | null {
    const row = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE shot_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(shotId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  // === 资产参考图（P1） ===
  // 每张角色 / 场景 / 道具卡片顶多需要"最新一张"作为视觉锁参考，
  // 但仍保留 list 版本给未来 A/B 重出面板用。

  listByCharacter(characterId: Id): ImageAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE character_id = ? ORDER BY created_at DESC`,
      )
      .all(characterId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByLocation(locationId: Id): ImageAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE location_id = ? ORDER BY created_at DESC`,
      )
      .all(locationId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByProp(propId: Id): ImageAsset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE prop_id = ? ORDER BY created_at DESC`,
      )
      .all(propId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  latestByCharacter(characterId: Id): ImageAsset | null {
    const row = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE character_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(characterId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  latestByLocation(locationId: Id): ImageAsset | null {
    const row = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE location_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(locationId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  latestByProp(propId: Id): ImageAsset | null {
    const row = this.db
      .prepare(
        `SELECT * FROM image_assets WHERE prop_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(propId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }
}
