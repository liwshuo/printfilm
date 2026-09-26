import type {
  ReviewRun,
  ReviewIssue,
  ReviewIssueEvent,
  ScriptSnapshot,
  ActivityEvent,
  ExportBundle,
  ReviewRunRepository,
  ReviewIssueRepository,
  ReviewIssueEventRepository,
  ScriptSnapshotRepository,
  ActivityEventRepository,
  ExportBundleRepository,
  Id,
} from "@dramaflow/domain";
import type { SqliteDatabase } from "../sqlite/connection.js";
import { TimestampedRepositoryBase } from "./base.js";
import {
  reviewRunMapping,
  reviewIssueMapping,
  scriptSnapshotMapping,
  exportBundleMapping,
} from "../mappers/mappings.js";
import { newId, nowIso } from "../util/id.js";
import { toJson, fromJsonObject, orUndefined } from "../util/json.js";

type Row = Record<string, unknown>;

export class SqliteReviewRunRepository
  extends TimestampedRepositoryBase<ReviewRun>
  implements ReviewRunRepository
{
  constructor(db: SqliteDatabase) {
    super(db, reviewRunMapping);
  }

  listByProject(projectId: Id): ReviewRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM review_runs WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteReviewIssueRepository
  extends TimestampedRepositoryBase<ReviewIssue>
  implements ReviewIssueRepository
{
  constructor(db: SqliteDatabase) {
    super(db, reviewIssueMapping);
  }

  listByProject(projectId: Id): ReviewIssue[] {
    const rows = this.db
      .prepare(`SELECT * FROM review_issues WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }

  /** Open issues with high/critical severity block confirmation (adr-004 blocked_by_issue). */
  listOpenBlocking(projectId: Id): ReviewIssue[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM review_issues
         WHERE project_id = ? AND status IN ('open', 'reopened')
           AND severity IN ('high', 'critical')
         ORDER BY created_at DESC`,
      )
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteScriptSnapshotRepository
  extends TimestampedRepositoryBase<ScriptSnapshot>
  implements ScriptSnapshotRepository
{
  constructor(db: SqliteDatabase) {
    super(db, scriptSnapshotMapping);
  }

  listByEpisode(episodeId: Id): ScriptSnapshot[] {
    const rows = this.db
      .prepare(`SELECT * FROM script_snapshots WHERE episode_id = ? ORDER BY created_at DESC`)
      .all(episodeId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteExportBundleRepository
  extends TimestampedRepositoryBase<ExportBundle>
  implements ExportBundleRepository
{
  constructor(db: SqliteDatabase) {
    super(db, exportBundleMapping);
  }

  listByProject(projectId: Id): ExportBundle[] {
    const rows = this.db
      .prepare(`SELECT * FROM export_bundles WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId) as Row[];
    return rows.map((r) => this.rowToEntity(r));
  }
}

export class SqliteReviewIssueEventRepository implements ReviewIssueEventRepository {
  constructor(private readonly db: SqliteDatabase) {}

  append(
    input: Omit<ReviewIssueEvent, "id" | "createdAt" | "updatedAt"> & { id?: Id },
  ): ReviewIssueEvent {
    const id = input.id ?? newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO review_issue_events
           (id, issue_id, action, from_status, to_status, note, changed_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.issueId,
        input.action,
        input.fromStatus ?? null,
        input.toStatus,
        input.note ?? null,
        input.changedBy ?? null,
        now,
        now,
      );
    return {
      id,
      createdAt: now,
      updatedAt: now,
      issueId: input.issueId,
      action: input.action,
      ...(input.fromStatus !== undefined ? { fromStatus: input.fromStatus } : {}),
      toStatus: input.toStatus,
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.changedBy !== undefined ? { changedBy: input.changedBy } : {}),
    };
  }

  listByIssue(issueId: Id): ReviewIssueEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM review_issue_events WHERE issue_id = ? ORDER BY created_at ASC`)
      .all(issueId) as Row[];
    return rows.map((r) => ({
      id: r["id"] as string,
      createdAt: r["created_at"] as string,
      updatedAt: r["updated_at"] as string,
      issueId: r["issue_id"] as string,
      action: r["action"] as ReviewIssueEvent["action"],
      fromStatus: orUndefined(r["from_status"] as ReviewIssueEvent["fromStatus"] | null),
      toStatus: r["to_status"] as ReviewIssueEvent["toStatus"],
      note: orUndefined(r["note"] as string | null),
      changedBy: orUndefined(r["changed_by"] as string | null),
    }));
  }
}

export class SqliteActivityEventRepository implements ActivityEventRepository {
  constructor(private readonly db: SqliteDatabase) {}

  append(input: Omit<ActivityEvent, "id" | "createdAt"> & { id?: Id }): ActivityEvent {
    const id = input.id ?? newId();
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO activity_events
           (id, project_id, event_type, summary, actor, target_ref_json, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.eventType,
        input.summary,
        input.actor ?? null,
        toJson(input.targetRef),
        toJson(input.payload ?? {}),
        createdAt,
      );
    return {
      id,
      createdAt,
      projectId: input.projectId,
      eventType: input.eventType,
      summary: input.summary,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      targetRef: input.targetRef,
      payload: input.payload ?? ({} as ActivityEvent["payload"]),
    };
  }

  listByProject(projectId: Id, limit = 50): ActivityEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM activity_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, limit) as Row[];
    return rows.map((r) => ({
      id: r["id"] as string,
      createdAt: r["created_at"] as string,
      projectId: r["project_id"] as string,
      eventType: r["event_type"] as string,
      summary: r["summary"] as string,
      actor: orUndefined(r["actor"] as string | null),
      targetRef: fromJsonObject(r["target_ref_json"]) as unknown as ActivityEvent["targetRef"],
      payload: fromJsonObject(r["payload_json"]) as ActivityEvent["payload"],
    }));
  }
}
