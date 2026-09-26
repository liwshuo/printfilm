/**
 * Shared service context + base class.
 *
 * Services depend on the `RepositoryRegistry` port only (never on SQLite), and
 * use `registry.transaction` to wrap multi-write operations atomically
 * (repo-structure §6, data-and-api-v1.md §10).
 */

import type {
  RepositoryRegistry,
  ActivityTargetRef,
  ActivityPayload,
  Id,
} from "@dramaflow/domain";

export interface ServiceContext {
  readonly repos: RepositoryRegistry;
  /** Actor attribution for activity events (optional in local single-user V1). */
  readonly actor?: string;
}

export abstract class BaseService {
  protected readonly repos: RepositoryRegistry;
  protected readonly actor: string | undefined;

  constructor(ctx: ServiceContext) {
    this.repos = ctx.repos;
    this.actor = ctx.actor;
  }

  /** Append an activity feed entry (append-only; not optimistic-locked, adr-003 §6). */
  protected logActivity(input: {
    projectId: Id;
    eventType: string;
    summary: string;
    targetRef: ActivityTargetRef;
    payload?: ActivityPayload;
  }): void {
    this.repos.activityEvents.append({
      projectId: input.projectId,
      eventType: input.eventType,
      summary: input.summary,
      actor: this.actor,
      targetRef: input.targetRef,
      payload: input.payload ?? {},
    });
  }
}
