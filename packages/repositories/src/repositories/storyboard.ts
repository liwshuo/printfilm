import type {
  Scene,
  Shot,
  KeyframeSpec,
  ContinuityAnchor,
  SceneDialogueBlock,
  SceneActionBlock,
  SceneCharacter,
  ShotCharacter,
  ShotProp,
  SceneRepository,
  ShotRepository,
  KeyframeSpecRepository,
  ContinuityAnchorRepository,
  SceneDialogueBlockRepository,
  SceneActionBlockRepository,
  SceneCharacterRepository,
  ShotCharacterRepository,
  ShotPropRepository,
  Id,
} from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { VersionedRepositoryBase, TimestampedRepositoryBase } from "./base.js";
import {
  sceneMapping,
  shotMapping,
  keyframeSpecMapping,
  continuityAnchorMapping,
  dialogueBlockMapping,
  actionBlockMapping,
} from "../mappers/mappings.js";
import { orUndefined } from "../util/json.js";

type Row = Record<string, unknown>;

export class SqliteSceneRepository
  extends VersionedRepositoryBase<Scene>
  implements SceneRepository
{
  constructor(db: SqliteDatabase) {
    super(db, sceneMapping);
  }

  listByEpisode(episodeId: Id): Scene[] {
    const rows = this.db
      .prepare(`SELECT * FROM scenes WHERE episode_id = ? ORDER BY sort_order ASC, scene_no ASC`)
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  countByEpisodeAndStatus(episodeId: Id): {
    total: number;
    confirmed: number;
    draft: number;
  } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN storyboard_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
           SUM(CASE WHEN storyboard_status = 'draft' THEN 1 ELSE 0 END) AS draft
         FROM scenes WHERE episode_id = ?`,
      )
      .get(episodeId) as { total: number; confirmed: number | null; draft: number | null };
    return {
      total: row.total ?? 0,
      confirmed: row.confirmed ?? 0,
      draft: row.draft ?? 0,
    };
  }
}

export class SqliteShotRepository
  extends VersionedRepositoryBase<Shot>
  implements ShotRepository
{
  constructor(db: SqliteDatabase) {
    super(db, shotMapping);
  }

  listByScene(sceneId: Id): Shot[] {
    const rows = this.db
      .prepare(`SELECT * FROM shots WHERE scene_id = ? ORDER BY sort_order ASC, shot_no ASC`)
      .all(sceneId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteKeyframeSpecRepository
  extends VersionedRepositoryBase<KeyframeSpec>
  implements KeyframeSpecRepository
{
  constructor(db: SqliteDatabase) {
    super(db, keyframeSpecMapping);
  }

  listByShot(shotId: Id): KeyframeSpec[] {
    const rows = this.db
      .prepare(`SELECT * FROM keyframe_specs WHERE shot_id = ? ORDER BY created_at ASC`)
      .all(shotId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteContinuityAnchorRepository
  extends TimestampedRepositoryBase<ContinuityAnchor>
  implements ContinuityAnchorRepository
{
  constructor(db: SqliteDatabase) {
    super(db, continuityAnchorMapping);
  }

  listByShot(shotId: Id): ContinuityAnchor[] {
    const rows = this.db
      .prepare(`SELECT * FROM continuity_anchors WHERE shot_id = ? ORDER BY created_at ASC`)
      .all(shotId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteSceneDialogueBlockRepository
  extends TimestampedRepositoryBase<SceneDialogueBlock>
  implements SceneDialogueBlockRepository
{
  constructor(db: SqliteDatabase) {
    super(db, dialogueBlockMapping);
  }

  listByScene(sceneId: Id): SceneDialogueBlock[] {
    const rows = this.db
      .prepare(`SELECT * FROM scene_dialogue_blocks WHERE scene_id = ? ORDER BY sort_order ASC`)
      .all(sceneId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteSceneActionBlockRepository
  extends TimestampedRepositoryBase<SceneActionBlock>
  implements SceneActionBlockRepository
{
  constructor(db: SqliteDatabase) {
    super(db, actionBlockMapping);
  }

  listByScene(sceneId: Id): SceneActionBlock[] {
    const rows = this.db
      .prepare(`SELECT * FROM scene_action_blocks WHERE scene_id = ? ORDER BY sort_order ASC`)
      .all(sceneId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

// ===== link tables (composite PK; hand-written, no base) =====

export class SqliteSceneCharacterRepository implements SceneCharacterRepository {
  constructor(private readonly db: SqliteDatabase) {}

  private toEntity(row: Row): SceneCharacter {
    return {
      sceneId: row["scene_id"] as string,
      characterId: row["character_id"] as string,
      lookId: orUndefined(row["look_id"] as string | null),
      presenceType: row["presence_type"] as string,
    };
  }

  listByScene(sceneId: Id): SceneCharacter[] {
    const rows = this.db
      .prepare(`SELECT * FROM scene_characters WHERE scene_id = ?`)
      .all(sceneId) as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  upsert(link: SceneCharacter): SceneCharacter {
    this.db
      .prepare(
        `INSERT INTO scene_characters (scene_id, character_id, look_id, presence_type)
         VALUES (@sceneId, @characterId, @lookId, @presenceType)
         ON CONFLICT(scene_id, character_id)
         DO UPDATE SET look_id = excluded.look_id, presence_type = excluded.presence_type`,
      )
      .run({
        sceneId: link.sceneId,
        characterId: link.characterId,
        lookId: link.lookId ?? null,
        presenceType: link.presenceType,
      });
    return link;
  }

  remove(sceneId: Id, characterId: Id): void {
    this.db
      .prepare(`DELETE FROM scene_characters WHERE scene_id = ? AND character_id = ?`)
      .run(sceneId, characterId);
  }
}

export class SqliteShotCharacterRepository implements ShotCharacterRepository {
  constructor(private readonly db: SqliteDatabase) {}

  private toEntity(row: Row): ShotCharacter {
    return {
      shotId: row["shot_id"] as string,
      characterId: row["character_id"] as string,
      lookId: orUndefined(row["look_id"] as string | null),
      blockingNote: orUndefined(row["blocking_note"] as string | null),
    };
  }

  listByShot(shotId: Id): ShotCharacter[] {
    const rows = this.db
      .prepare(`SELECT * FROM shot_characters WHERE shot_id = ?`)
      .all(shotId) as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  upsert(link: ShotCharacter): ShotCharacter {
    this.db
      .prepare(
        `INSERT INTO shot_characters (shot_id, character_id, look_id, blocking_note)
         VALUES (@shotId, @characterId, @lookId, @blockingNote)
         ON CONFLICT(shot_id, character_id)
         DO UPDATE SET look_id = excluded.look_id, blocking_note = excluded.blocking_note`,
      )
      .run({
        shotId: link.shotId,
        characterId: link.characterId,
        lookId: link.lookId ?? null,
        blockingNote: link.blockingNote ?? null,
      });
    return link;
  }

  remove(shotId: Id, characterId: Id): void {
    this.db
      .prepare(`DELETE FROM shot_characters WHERE shot_id = ? AND character_id = ?`)
      .run(shotId, characterId);
  }
}

export class SqliteShotPropRepository implements ShotPropRepository {
  constructor(private readonly db: SqliteDatabase) {}

  private toEntity(row: Row): ShotProp {
    return {
      shotId: row["shot_id"] as string,
      propId: row["prop_id"] as string,
      stateNote: orUndefined(row["state_note"] as string | null),
    };
  }

  listByShot(shotId: Id): ShotProp[] {
    const rows = this.db
      .prepare(`SELECT * FROM shot_props WHERE shot_id = ?`)
      .all(shotId) as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  upsert(link: ShotProp): ShotProp {
    this.db
      .prepare(
        `INSERT INTO shot_props (shot_id, prop_id, state_note)
         VALUES (@shotId, @propId, @stateNote)
         ON CONFLICT(shot_id, prop_id)
         DO UPDATE SET state_note = excluded.state_note`,
      )
      .run({ shotId: link.shotId, propId: link.propId, stateNote: link.stateNote ?? null });
    return link;
  }

  remove(shotId: Id, propId: Id): void {
    this.db
      .prepare(`DELETE FROM shot_props WHERE shot_id = ? AND prop_id = ?`)
      .run(shotId, propId);
  }
}
