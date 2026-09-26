/**
 * ContinuityService — 连续性锁管理（drama 优先场景）。
 *
 * 单表 CRUD + list 查询。「机械核对」逻辑放在 ReviewService.runContinuityPack，
 * 由此服务只负责锁面的生命周期。上线前的进阶（automatic anchor 抽取、
 * 应用范围可视化冲突检测）作为后续 provider 接入的一部分。
 */

import type {
  ContinuityLock,
  Id,
} from "@dramaflow/domain";
import {
  createContinuityLockSchema,
  updateContinuityLockSchema,
  missingResource,
} from "@dramaflow/domain";
import { BaseService } from "./context.js";
import { parseInput } from "./validate.js";

export interface CreateContinuityLockInput {
  projectId: Id;
  episodeId?: Id;
  scope: "project" | "episode" | "scene";
  lockPhrase: string;
  appliesTo?: Record<string, unknown>;
  status?: "active" | "disabled";
}

export interface UpdateContinuityLockInput {
  lockPhrase?: string;
  appliesTo?: Record<string, unknown>;
  status?: "active" | "disabled";
}

export class ContinuityService extends BaseService {
  create(raw: unknown): ContinuityLock {
    const input = parseInput(createContinuityLockSchema, raw);
    return this.repos.transaction(() => {
      const project = this.repos.projects.getById(input.projectId);
      if (!project) {
        throw missingResource(`项目不存在：${input.projectId}`, { projectId: input.projectId });
      }
      if (input.episodeId) {
        const ep = this.repos.episodes.getById(input.episodeId);
        if (!ep) {
          throw missingResource(`剧集不存在：${input.episodeId}`, { id: input.episodeId });
        }
      }
      const lock = this.repos.continuityLocks.create({
        projectId: input.projectId,
        episodeId: input.episodeId,
        scope: input.scope,
        lockPhrase: input.lockPhrase,
        appliesTo: input.appliesTo,
        status: input.status,
      });
      this.logActivity({
        projectId: lock.projectId,
        eventType: "continuity.lock.created",
        summary: `新增连续性锁「${lock.lockPhrase}」`,
        targetRef: { entityType: "project", entityId: lock.projectId },
        payload: { extra: { scope: lock.scope, episodeId: lock.episodeId } },
      });
      return lock;
    });
  }

  update(id: Id, raw: unknown): ContinuityLock {
    const input = parseInput(updateContinuityLockSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.continuityLocks.getById(id);
      if (!existing) throw missingResource(`连续性锁不存在：${id}`, { id });
      const updated = this.repos.continuityLocks.update(id, input);
      this.logActivity({
        projectId: updated.projectId,
        eventType: "continuity.lock.updated",
        summary: `更新连续性锁「${updated.lockPhrase}」`,
        targetRef: { entityType: "project", entityId: updated.projectId },
      });
      return updated;
    });
  }

  disable(id: Id): ContinuityLock {
    return this.update(id, { status: "disabled" });
  }

  delete(id: Id): void {
    const existing = this.repos.continuityLocks.getById(id);
    if (!existing) throw missingResource(`连续性锁不存在：${id}`, { id });
    this.repos.continuityLocks.delete(id);
    this.logActivity({
      projectId: existing.projectId,
      eventType: "continuity.lock.deleted",
      summary: `删除连续性锁「${existing.lockPhrase}」`,
      targetRef: { entityType: "project", entityId: existing.projectId },
    });
  }

  listByProject(projectId: Id): ContinuityLock[] {
    return this.repos.continuityLocks.listByProject(projectId);
  }

  listActive(projectId: Id, episodeId?: Id): ContinuityLock[] {
    return this.repos.continuityLocks.listActive(projectId, episodeId);
  }

  get(id: Id): ContinuityLock | null {
    return this.repos.continuityLocks.getById(id);
  }
}
