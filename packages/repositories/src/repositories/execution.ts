import type {
  ModelProfile,
  PromptSpec,
  GenerationTask,
  TaskLog,
  Artifact,
  ModelProfileRepository,
  PromptSpecRepository,
  GenerationTaskRepository,
  TaskLogRepository,
  ArtifactRepository,
  EntityPatch,
  NewEntity,
  Id,
} from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { VersionedRepositoryBase, TimestampedRepositoryBase } from "./base.js";
import {
  modelProfileMapping,
  promptSpecMapping,
  generationTaskMapping,
  artifactMapping,
} from "../mappers/mappings.js";
import { newId, nowIso } from "../util/id.js";
import { toJson, fromJsonObject } from "../util/json.js";

type Row = Record<string, unknown>;

export class SqliteModelProfileRepository
  extends TimestampedRepositoryBase<ModelProfile>
  implements ModelProfileRepository
{
  constructor(db: SqliteDatabase) {
    super(db, modelProfileMapping);
  }

  list(): ModelProfile[] {
    const rows = this.db
      .prepare(`SELECT * FROM model_profiles ORDER BY created_at ASC`)
      .all() as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqlitePromptSpecRepository
  extends VersionedRepositoryBase<PromptSpec>
  implements PromptSpecRepository
{
  constructor(db: SqliteDatabase) {
    super(db, promptSpecMapping);
  }

  listBySource(sourceEntityType: string, sourceEntityId: Id): PromptSpec[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_specs WHERE source_entity_type = ? AND source_entity_id = ? ORDER BY version DESC`,
      )
      .all(sourceEntityType, sourceEntityId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  countByModelProfile(modelProfileId: Id): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM prompt_specs WHERE model_profile_id = ?`)
      .get(modelProfileId) as { n: number };
    return row.n ?? 0;
  }
}

export class SqliteGenerationTaskRepository
  extends TimestampedRepositoryBase<GenerationTask>
  implements GenerationTaskRepository
{
  constructor(db: SqliteDatabase) {
    super(db, generationTaskMapping);
  }

  override create(input: NewEntity<GenerationTask>): GenerationTask {
    return super.create(input as Record<string, unknown>);
  }

  /** Status transitions are not optimistic-locked (adr-003 §6). */
  updateStatus(id: Id, patch: EntityPatch<GenerationTask>): GenerationTask {
    return this.update(id, patch as Record<string, unknown>);
  }

  listByProject(projectId: Id): GenerationTask[] {
    const rows = this.db
      .prepare(`SELECT * FROM generation_tasks WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  /**
   * 供 Web 在页面 mount / 刷新时 resume 在跑的 job。
   * 若 `statusIn` 提供则用 SQL `IN (...)` 过滤，否则不过滤状态。
   */
  listBySource(
    sourceEntityType: string,
    sourceEntityId: Id,
    statusIn?: readonly string[],
  ): GenerationTask[] {
    if (statusIn && statusIn.length > 0) {
      const placeholders = statusIn.map(() => "?").join(",");
      const rows = this.db
        .prepare(
          `SELECT * FROM generation_tasks
             WHERE source_entity_type = ? AND source_entity_id = ?
               AND status IN (${placeholders})
             ORDER BY created_at DESC`,
        )
        .all(sourceEntityType, sourceEntityId, ...statusIn) as Row[];
      return rows.map((r) => this.rowToEntity(r));
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM generation_tasks
           WHERE source_entity_type = ? AND source_entity_id = ?
           ORDER BY created_at DESC`,
      )
      .all(sourceEntityType, sourceEntityId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  countByModelProfile(modelProfileId: Id): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM generation_tasks WHERE model_profile_id = ?`)
      .get(modelProfileId) as { n: number };
    return row.n ?? 0;
  }
}

export class SqliteTaskLogRepository implements TaskLogRepository {
  constructor(private readonly db: SqliteDatabase) {}

  append(input: Omit<TaskLog, "id" | "createdAt"> & { id?: Id }): TaskLog {
    const id = input.id ?? newId();
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO task_logs (id, task_id, event_type, message, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.taskId, input.eventType, input.message, toJson(input.payload ?? {}), createdAt);
    return { id, createdAt, taskId: input.taskId, eventType: input.eventType, message: input.message, payload: input.payload ?? {} };
  }

  listByTask(taskId: Id): TaskLog[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Row[];
    return rows.map((r) => ({
      id: r["id"] as string,
      createdAt: r["created_at"] as string,
      taskId: r["task_id"] as string,
      eventType: r["event_type"] as string,
      message: r["message"] as string,
      payload: fromJsonObject(r["payload_json"]),
    }));
  }
}

export class SqliteArtifactRepository
  extends TimestampedRepositoryBase<Artifact>
  implements ArtifactRepository
{
  constructor(db: SqliteDatabase) {
    super(db, artifactMapping);
  }

  listByProject(projectId: Id): Artifact[] {
    const rows = this.db
      .prepare(`SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}
