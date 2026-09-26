import type {
  Project,
  ProjectStoryBible,
  Episode,
  ProjectRepository,
  ProjectStoryBibleRepository,
  EpisodeRepository,
  Id,
} from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { VersionedRepositoryBase } from "./base.js";
import { projectMapping, storyBibleMapping, episodeMapping } from "../mappers/mappings.js";

type Row = Record<string, unknown>;

export class SqliteProjectRepository
  extends VersionedRepositoryBase<Project>
  implements ProjectRepository
{
  constructor(db: SqliteDatabase) {
    super(db, projectMapping);
  }

  getBySlug(slug: string): Project | null {
    const row = this.db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) as
      | Row
      | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  list(): Project[] {
    const rows = this.db
      .prepare(`SELECT * FROM projects ORDER BY created_at DESC`)
      .all() as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteProjectStoryBibleRepository
  extends VersionedRepositoryBase<ProjectStoryBible>
  implements ProjectStoryBibleRepository
{
  constructor(db: SqliteDatabase) {
    super(db, storyBibleMapping);
  }

  getByProjectId(projectId: Id): ProjectStoryBible | null {
    // A1: project-level bible = episode_id IS NULL. Per-episode bibles (series)
    // are fetched via getByProjectAndEpisode.
    const row = this.db
      .prepare(
        `SELECT * FROM project_story_bibles WHERE project_id = ? AND episode_id IS NULL`,
      )
      .get(projectId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  /** A1: fetch the episode-scoped bible (series). Returns null if none. */
  getByProjectAndEpisode(projectId: Id, episodeId: Id): ProjectStoryBible | null {
    const row = this.db
      .prepare(
        `SELECT * FROM project_story_bibles WHERE project_id = ? AND episode_id = ?`,
      )
      .get(projectId, episodeId) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }
}

export class SqliteEpisodeRepository
  extends VersionedRepositoryBase<Episode>
  implements EpisodeRepository
{
  constructor(db: SqliteDatabase) {
    super(db, episodeMapping);
  }

  listByProject(projectId: Id): Episode[] {
    const rows = this.db
      .prepare(`SELECT * FROM episodes WHERE project_id = ? ORDER BY episode_no ASC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  getByProjectAndNo(projectId: Id, episodeNo: number): Episode | null {
    const row = this.db
      .prepare(`SELECT * FROM episodes WHERE project_id = ? AND episode_no = ?`)
      .get(projectId, episodeNo) as Row | undefined;
    return row ? this.rowToEntity(row) : null;
  }
}
