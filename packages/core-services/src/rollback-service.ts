/**
 * Round-3 P1-① 版本回滚服务。
 *
 * 负责暴露 `entity_snapshots` 快照给上层，并把 payload 写回具体实体。
 *
 * 支持的实体（key = mapping.table）：
 *   - `scenes` / `shots` / `keyframe_specs`
 *   - `episodes` / `projects` / `project_story_bibles`
 *   - `characters` / `character_looks` / `locations` / `props` / `style_guides`
 *   - `prompt_specs`
 *
 * 语义：
 *   - `listSnapshots` 只返回 metadata（不 parse payload），默认按创建时间倒序；
 *   - `rollback` 走 `VersionedRepositoryBase.update`，因此会自动把"当前版本"再度快照
 *     成一条 `reason=update` 的记录，天然形成可逆链；
 *   - payload 里的 `id / createdAt / updatedAt / version` 字段会被 repo.update 忽略
 *     （mapping.columns 里不包含它们），所以只有业务字段被回滚，不会破坏时间戳。
 */
import { missingResource, validationFailed } from "@dramaflow/domain";
import type {
  EntitySnapshot,
  Id,
  RepositoryRegistry,
} from "@dramaflow/domain";
import { BaseService, type ServiceContext } from "./context.js";

/** 快照元信息（不带 payload）。 */
export interface SnapshotDigest {
  id: Id;
  entityType: string;
  entityId: Id;
  version: number;
  reason: string | undefined;
  summary: string | undefined;
  createdAt: string;
}

/** 支持回滚的实体白名单。key = mapping.table。 */
const ROLLBACK_TABLES: Record<
  string,
  (repos: RepositoryRegistry) => {
    // 目前 repo update 都是同步的；此处保持同步签名。
    update: (id: Id, patch: Record<string, unknown>, expectedVersion: number) => unknown;
  }
> = {
  scenes: (r) => r.scenes,
  shots: (r) => r.shots,
  keyframe_specs: (r) => r.keyframeSpecs,
  episodes: (r) => r.episodes,
  projects: (r) => r.projects,
  project_story_bibles: (r) => r.storyBibles,
  characters: (r) => r.characters,
  character_looks: (r) => r.characterLooks,
  locations: (r) => r.locations,
  props: (r) => r.props,
  style_guides: (r) => r.styleGuides,
  prompt_specs: (r) => r.promptSpecs,
};

/**
 * 从 payload 中提取业务字段，去掉 managed 字段（id/createdAt/updatedAt/version）。
 * 具体哪些字段会真正写回，由 VersionedRepositoryBase.mappedUpdateParts 决定；
 * 这里只做一次浅层清洗，避免把 id 误传成 patch 后触发意外语义。
 */
function stripManagedFields(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    version: _v,
    ...rest
  } = payload;
  return rest;
}

export class RollbackService extends BaseService {
  constructor(ctx: ServiceContext) {
    super(ctx);
  }

  /**
   * 列某个实体的历史快照（最近 N 条）。
   */
  listSnapshots(entityType: string, entityId: Id, limit = 20): SnapshotDigest[] {
    const rows = this.repos.entitySnapshots.listByEntity(entityType, entityId, limit);
    return rows.map((r) => this.toDigest(r));
  }

  private toDigest(r: EntitySnapshot): SnapshotDigest {
    return {
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      version: r.version,
      reason: r.reason,
      summary: r.summary,
      createdAt: r.createdAt,
    };
  }

  /**
   * 回滚到指定快照。
   *
   * @param snapshotId 目标快照 id。
   * @param expectedVersion 当前实体版本（乐观锁）。
   */
  rollback(snapshotId: Id, expectedVersion: number): {
    entityType: string;
    entityId: Id;
    restoredFromVersion: number;
  } {
    const snap = this.repos.entitySnapshots.getById(snapshotId);
    if (!snap) throw missingResource(`快照不存在：${snapshotId}`, { snapshotId });

    const repoFactory = ROLLBACK_TABLES[snap.entityType];
    if (!repoFactory) {
      throw validationFailed(`不支持回滚该实体类型：${snap.entityType}`, {
        entityType: snap.entityType,
      });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(snap.payloadJson) as Record<string, unknown>;
    } catch (err) {
      throw validationFailed(`快照 payload 无法解析：${(err as Error).message}`, {
        snapshotId,
      });
    }

    const patch = stripManagedFields(payload);
    return this.repos.transaction(() => {
      const repo = repoFactory(this.repos);
      repo.update(snap.entityId, patch, expectedVersion);
      // Round-3 P2-⑤：如果回滚的是 scene，把该场名下所有 succeeded 图片打成 stale。
      // 与 regenerateScene 保持一致的下游语义：剧情/字段变了，下游图可能已不对齐。
      if (snap.entityType === "scenes") {
        for (const img of this.repos.imageAssets.listByScene(snap.entityId)) {
          if (img.status === "succeeded") {
            this.repos.imageAssets.update(img.id, {
              status: "stale",
              staleReason: "scene_rolled_back",
            });
          }
        }
      }
      // 这里不额外写 EntitySnapshot，因为 base sink 已经把"回滚前当前值"
      // 追加为一条 reason=update 的快照，天然可以再次回滚。
      // 但业务层需要一条可读的 activity 记录：
      // 目前 rollback service 无法定位 projectId（跨实体），
      // 因此暂不写 activity，UI 侧可通过 snapshot 列表 + 时间线直接展示。
      return {
        entityType: snap.entityType,
        entityId: snap.entityId,
        restoredFromVersion: snap.version,
      };
    });
  }
}
