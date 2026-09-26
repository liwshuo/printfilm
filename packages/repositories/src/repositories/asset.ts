import type {
  Character,
  CharacterLook,
  Location,
  Prop,
  StyleGuide,
  CharacterRepository,
  CharacterLookRepository,
  LocationRepository,
  PropRepository,
  StyleGuideRepository,
  Id,
} from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { VersionedRepositoryBase } from "./base.js";
import {
  characterMapping,
  characterLookMapping,
  locationMapping,
  propMapping,
  styleGuideMapping,
} from "../mappers/mappings.js";

type Row = Record<string, unknown>;

export class SqliteCharacterRepository
  extends VersionedRepositoryBase<Character>
  implements CharacterRepository
{
  constructor(db: SqliteDatabase) {
    super(db, characterMapping);
  }

  listByProject(projectId: Id): Character[] {
    const rows = this.db
      .prepare(`SELECT * FROM characters WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByEpisode(episodeId: Id): Character[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM characters WHERE episode_id = ? ORDER BY created_at ASC`,
      )
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  reassignProjectLevelToEpisode(projectId: Id, episodeId: Id): number {
    const info = this.db
      .prepare(
        `UPDATE characters SET episode_id = ? WHERE project_id = ? AND episode_id IS NULL`,
      )
      .run(episodeId, projectId);
    return Number(info.changes ?? 0);
  }
}

export class SqliteCharacterLookRepository
  extends VersionedRepositoryBase<CharacterLook>
  implements CharacterLookRepository
{
  constructor(db: SqliteDatabase) {
    super(db, characterLookMapping);
  }

  listByCharacter(characterId: Id): CharacterLook[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM character_looks WHERE character_id = ? ORDER BY look_group_id ASC, version_no ASC`,
      )
      .all(characterId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  getCurrentDefault(characterId: Id): CharacterLook | null {
    const row = this.db
      .prepare(
        `SELECT * FROM character_looks WHERE character_id = ? AND is_default = 1 AND is_current = 1 LIMIT 1`,
      )
      .get(characterId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  listByGroup(lookGroupId: Id): CharacterLook[] {
    const rows = this.db
      .prepare(`SELECT * FROM character_looks WHERE look_group_id = ? ORDER BY version_no ASC`)
      .all(lookGroupId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteLocationRepository
  extends VersionedRepositoryBase<Location>
  implements LocationRepository
{
  constructor(db: SqliteDatabase) {
    super(db, locationMapping);
  }

  listByProject(projectId: Id): Location[] {
    const rows = this.db
      .prepare(`SELECT * FROM locations WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByEpisode(episodeId: Id): Location[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM locations WHERE episode_id = ? ORDER BY created_at ASC`,
      )
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  reassignProjectLevelToEpisode(projectId: Id, episodeId: Id): number {
    const info = this.db
      .prepare(
        `UPDATE locations SET episode_id = ? WHERE project_id = ? AND episode_id IS NULL`,
      )
      .run(episodeId, projectId);
    return Number(info.changes ?? 0);
  }
}

export class SqlitePropRepository
  extends VersionedRepositoryBase<Prop>
  implements PropRepository
{
  constructor(db: SqliteDatabase) {
    super(db, propMapping);
  }

  listByProject(projectId: Id): Prop[] {
    const rows = this.db
      .prepare(`SELECT * FROM props WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  listByEpisode(episodeId: Id): Prop[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM props WHERE episode_id = ? ORDER BY created_at ASC`,
      )
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  reassignProjectLevelToEpisode(projectId: Id, episodeId: Id): number {
    const info = this.db
      .prepare(
        `UPDATE props SET episode_id = ? WHERE project_id = ? AND episode_id IS NULL`,
      )
      .run(episodeId, projectId);
    return Number(info.changes ?? 0);
  }
}

export class SqliteStyleGuideRepository
  extends VersionedRepositoryBase<StyleGuide>
  implements StyleGuideRepository
{
  constructor(db: SqliteDatabase) {
    super(db, styleGuideMapping);
  }

  getByProjectId(projectId: Id): StyleGuide | null {
    const row = this.db
      .prepare(`SELECT * FROM style_guides WHERE project_id = ? LIMIT 1`)
      .get(projectId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }
}
