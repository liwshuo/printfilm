/**
 * ArtifactService — artifact lifecycle & lookup (data-and-api-v1.md §8, §10 step 8).
 *
 * `artifacts` is a timestamped entity (no version, adr-003 §6). Writes here come
 * from two places:
 *  - JobOrchestratorService.completeJob(): initial ready-state artifact writeback
 *  - This service: soft-delete (`deleted`) / mark-broken (`broken`) lifecycle ops
 *
 * It never generates content — it only owns metadata / status transitions.
 */

import type {
  Artifact,
  ArtifactType,
  ArtifactStatus,
  Id,
} from "@dramaflow/domain";
import { missingResource, invalidState } from "@dramaflow/domain";
import { BaseService } from "./context.js";

export interface ArtifactListFilter {
  artifactType?: ArtifactType;
  status?: ArtifactStatus;
  sourceEntityType?: string;
  sourceEntityId?: Id;
  sourceTaskId?: Id;
}

export class ArtifactService extends BaseService {
  getArtifact(id: Id): Artifact | null {
    return this.repos.artifacts.getById(id);
  }

  listByProject(projectId: Id, filter: ArtifactListFilter = {}): Artifact[] {
    const all = this.repos.artifacts.listByProject(projectId);
    return all.filter((a) => this.matches(a, filter));
  }

  listBySource(
    projectId: Id,
    sourceEntityType: string,
    sourceEntityId: Id,
  ): Artifact[] {
    return this.listByProject(projectId, { sourceEntityType, sourceEntityId });
  }

  /** Soft-delete: status `ready|broken -> deleted`. Idempotent on already-deleted. */
  markDeleted(id: Id): Artifact {
    const existing = this.getOrThrow(id);
    if (existing.status === "deleted") return existing;
    const updated = this.repos.artifacts.update(id, { status: "deleted" });
    this.logActivity({
      projectId: existing.projectId,
      eventType: "artifact.deleted",
      summary: `产物已删除：${existing.artifactType}`,
      targetRef: { entityType: "task", entityId: existing.sourceTaskId ?? existing.id },
      payload: {
        fromStatus: existing.status,
        toStatus: "deleted",
        extra: { artifactId: id, artifactType: existing.artifactType },
      },
    });
    return updated;
  }

  /** Mark broken (file missing / hash mismatch). Only meaningful from `ready`. */
  markBroken(id: Id, reason?: string): Artifact {
    const existing = this.getOrThrow(id);
    if (existing.status === "deleted") {
      throw invalidState("已删除的产物不可标记为 broken", { id, status: existing.status });
    }
    if (existing.status === "broken") return existing;
    const updated = this.repos.artifacts.update(id, { status: "broken" });
    this.logActivity({
      projectId: existing.projectId,
      eventType: "artifact.broken",
      summary: `产物标记为损坏：${existing.artifactType}`,
      targetRef: { entityType: "task", entityId: existing.sourceTaskId ?? existing.id },
      payload: {
        fromStatus: existing.status,
        toStatus: "broken",
        extra: { artifactId: id, reason },
      },
    });
    return updated;
  }

  private getOrThrow(id: Id): Artifact {
    const a = this.repos.artifacts.getById(id);
    if (!a) throw missingResource(`产物不存在：${id}`, { id });
    return a;
  }

  private matches(a: Artifact, f: ArtifactListFilter): boolean {
    if (f.artifactType && a.artifactType !== f.artifactType) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.sourceEntityType && a.sourceEntityType !== f.sourceEntityType) return false;
    if (f.sourceEntityId && a.sourceEntityId !== f.sourceEntityId) return false;
    if (f.sourceTaskId && a.sourceTaskId !== f.sourceTaskId) return false;
    return true;
  }
}
