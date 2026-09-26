/**
 * Repository interfaces (ports). DB-agnostic — implemented by @dramaflow/repositories over SQLite.
 * Authority for persistence semantics: data-and-api-v1.md §5/§6, adr-003 (optimistic locking).
 *
 * Optimistic locking (adr-003 §5) applies ONLY to entities carrying a `version` column.
 * Those use `VersionedRepository` (update requires `expectedVersion`). Entities that have
 * timestamps but no version (dialogue/action blocks, continuity anchors, model profiles,
 * artifacts, review issues/runs, export bundles, script snapshots) use `TimestampedRepository`.
 * Append-only writes (task logs, activity events, review issue events) are not locked (adr-003 §6).
 *
 * Convention:
 * - `create` accepts entity attributes without managed fields (id/createdAt/updatedAt/version);
 *   the repository assigns `id` (if absent), timestamps, and (for versioned) `version = 1`.
 * - Versioned `update` throws `DomainError(version_conflict)` on version mismatch (adr-003 §4).
 */

import type { BaseEntity, Id } from "./primitives.js";
import type { TaskStatus } from "./enums.js";
import type {
  Project,
  ProjectStoryBible,
  Episode,
  Character,
  CharacterLook,
  Location,
  Prop,
  StyleGuide,
  Scene,
  SceneDialogueBlock,
  SceneActionBlock,
  Shot,
  KeyframeSpec,
  ContinuityAnchor,
  SceneCharacter,
  ShotCharacter,
  ShotProp,
  PromptSpec,
  GenerationTask,
  Artifact,
  ReviewIssue,
  ReviewRun,
  ReviewIssueEvent,
  ScriptSnapshot,
  ActivityEvent,
  ExportBundle,
  ModelProfile,
  TaskLog,
  ContinuityLock,
  EpisodeAssetRef,
  ImageAsset,
  VideoAsset,
  EntitySnapshot,
} from "./entities.js";

/**
 * Entity attributes at creation time: managed fields (id / createdAt / updatedAt)
 * are assigned by the repository. Business fields — including a business
 * `version` string like `ExportBundle.version` — remain required.
 */
export type NewEntity<T extends BaseEntity> = Omit<
  T,
  "id" | "createdAt" | "updatedAt"
> & { id?: Id };

/**
 * Creation input for a versioned (optimistic-locked) entity: the row `version`
 * column is managed by the repository (initialized to 1) and MUST NOT be set
 * by callers, so it is stripped here in addition to the base managed fields.
 */
export type NewVersionedEntity<T extends BaseEntity> = Omit<
  T,
  "id" | "createdAt" | "updatedAt" | "version"
> & { id?: Id };

/** Patch of an entity: any mutable subset (managed fields excluded). */
export type EntityPatch<T extends BaseEntity> = Partial<
  Omit<T, "id" | "createdAt" | "updatedAt" | "version">
>;

/** Read-only lookup surface shared by all repositories. */
export interface ReadRepository<T> {
  getById(id: Id): T | null;
}

/** Versioned, optimistic-locked write surface (entity has a `version` column). */
export interface VersionedRepository<T extends BaseEntity> extends ReadRepository<T> {
  create(input: NewVersionedEntity<T>): T;
  /** @throws DomainError(version_conflict) when expectedVersion !== current. */
  update(id: Id, patch: EntityPatch<T>, expectedVersion: number): T;
  delete(id: Id): void;
}

/** Timestamped write surface without optimistic locking (no `version` column). */
export interface TimestampedRepository<T extends BaseEntity> extends ReadRepository<T> {
  create(input: NewEntity<T>): T;
  update(id: Id, patch: EntityPatch<T>): T;
  delete(id: Id): void;
}

// ===== 项目与故事层 (versioned) =====

export interface ProjectRepository extends VersionedRepository<Project> {
  getBySlug(slug: string): Project | null;
  list(): Project[];
}

export interface ProjectStoryBibleRepository
  extends VersionedRepository<ProjectStoryBible> {
  /** Project-level bible (episodeId IS NULL). A1: drama 唯一 / series 共享底座。 */
  getByProjectId(projectId: Id): ProjectStoryBible | null;
  /** Episode-scoped bible (series). Null when not yet generated. */
  getByProjectAndEpisode(projectId: Id, episodeId: Id): ProjectStoryBible | null;
}

export interface EpisodeRepository extends VersionedRepository<Episode> {
  listByProject(projectId: Id): Episode[];
  getByProjectAndNo(projectId: Id, episodeNo: number): Episode | null;
}

// ===== 资产与设定层 (versioned) =====

export interface CharacterRepository extends VersionedRepository<Character> {
  listByProject(projectId: Id): Character[];
  /** 只返回该集专属（episode_id = episodeId）角色，不含项目级。 */
  listByEpisode(episodeId: Id): Character[];
  /**
   * A2 迁移辅助：把项目下所有 episode_id IS NULL（项目级）角色的 episode_id
   * 批量改为 `episodeId`，不 bump version / 不校验乐观锁（迁移场景独用）。
   * 返回受影响行数。
   */
  reassignProjectLevelToEpisode(projectId: Id, episodeId: Id): number;
}

export interface CharacterLookRepository extends VersionedRepository<CharacterLook> {
  listByCharacter(characterId: Id): CharacterLook[];
  getCurrentDefault(characterId: Id): CharacterLook | null;
  listByGroup(lookGroupId: Id): CharacterLook[];
}

export interface LocationRepository extends VersionedRepository<Location> {
  listByProject(projectId: Id): Location[];
  /** 只返回该集专属场景。 */
  listByEpisode(episodeId: Id): Location[];
  /** 参见 CharacterRepository.reassignProjectLevelToEpisode。 */
  reassignProjectLevelToEpisode(projectId: Id, episodeId: Id): number;
}

export interface PropRepository extends VersionedRepository<Prop> {
  listByProject(projectId: Id): Prop[];
  /** 只返回该集专属道具。 */
  listByEpisode(episodeId: Id): Prop[];
  /** 参见 CharacterRepository.reassignProjectLevelToEpisode。 */
  reassignProjectLevelToEpisode(projectId: Id, episodeId: Id): number;
}

export interface StyleGuideRepository extends VersionedRepository<StyleGuide> {
  getByProjectId(projectId: Id): StyleGuide | null;
}

// ===== 分镜与关键帧层 =====

export interface SceneRepository extends VersionedRepository<Scene> {
  listByEpisode(episodeId: Id): Scene[];
  countByEpisodeAndStatus(episodeId: Id): { total: number; confirmed: number; draft: number };
}

export interface ShotRepository extends VersionedRepository<Shot> {
  listByScene(sceneId: Id): Shot[];
}

export interface KeyframeSpecRepository extends VersionedRepository<KeyframeSpec> {
  listByShot(shotId: Id): KeyframeSpec[];
}

/** Dialogue blocks carry timestamps but no version column. */
export interface SceneDialogueBlockRepository
  extends TimestampedRepository<SceneDialogueBlock> {
  listByScene(sceneId: Id): SceneDialogueBlock[];
}

/** Action blocks carry timestamps but no version column. */
export interface SceneActionBlockRepository
  extends TimestampedRepository<SceneActionBlock> {
  listByScene(sceneId: Id): SceneActionBlock[];
}

/** Continuity anchors carry timestamps but no version column. */
export interface ContinuityAnchorRepository
  extends TimestampedRepository<ContinuityAnchor> {
  listByShot(shotId: Id): ContinuityAnchor[];
}

// ===== link tables (composite PK; not versioned, no timestamps) =====

export interface SceneCharacterRepository {
  listByScene(sceneId: Id): SceneCharacter[];
  upsert(link: SceneCharacter): SceneCharacter;
  remove(sceneId: Id, characterId: Id): void;
}

export interface ShotCharacterRepository {
  listByShot(shotId: Id): ShotCharacter[];
  upsert(link: ShotCharacter): ShotCharacter;
  remove(shotId: Id, characterId: Id): void;
}

export interface ShotPropRepository {
  listByShot(shotId: Id): ShotProp[];
  upsert(link: ShotProp): ShotProp;
  remove(shotId: Id, propId: Id): void;
}

// ===== 执行 / 审查 / 导出层 =====

/** prompt_specs carry a version column (adr-003 §2). */
export interface PromptSpecRepository extends VersionedRepository<PromptSpec> {
  listBySource(sourceEntityType: string, sourceEntityId: Id): PromptSpec[];
  countByModelProfile(modelProfileId: Id): number;
}

/** model_profiles: timestamps only, no version. */
export interface ModelProfileRepository extends TimestampedRepository<ModelProfile> {
  list(): ModelProfile[];
}

/** generation_tasks: status transitions are append-style, not optimistic-locked (adr-003 §6). */
export interface GenerationTaskRepository extends ReadRepository<GenerationTask> {
  create(input: NewEntity<GenerationTask>): GenerationTask;
  updateStatus(id: Id, patch: EntityPatch<GenerationTask>): GenerationTask;
  listByProject(projectId: Id): GenerationTask[];
  /**
   * 按来源实体查询任务；供 Web 在页面挂载 / 刷新时 resume 在跑的 job。
   * `statusIn` 传空 / 省略 = 不过滤；一般前端会传 `["queued","running"]`。
   */
  listBySource(
    sourceEntityType: string,
    sourceEntityId: Id,
    statusIn?: readonly TaskStatus[],
  ): GenerationTask[];
  countByModelProfile(modelProfileId: Id): number;
}

export interface TaskLogRepository {
  append(input: Omit<TaskLog, "id" | "createdAt"> & { id?: Id }): TaskLog;
  listByTask(taskId: Id): TaskLog[];
}

/** artifacts: timestamps only, no version. */
export interface ArtifactRepository extends TimestampedRepository<Artifact> {
  listByProject(projectId: Id): Artifact[];
}

/** review_issues: timestamps only, no version. */
export interface ReviewIssueRepository extends TimestampedRepository<ReviewIssue> {
  listByProject(projectId: Id): ReviewIssue[];
  listOpenBlocking(projectId: Id): ReviewIssue[];
}

/** review_runs: timestamps only, no version. */
export interface ReviewRunRepository extends TimestampedRepository<ReviewRun> {
  listByProject(projectId: Id): ReviewRun[];
}

export interface ReviewIssueEventRepository {
  append(
    input: Omit<ReviewIssueEvent, "id" | "createdAt" | "updatedAt"> & { id?: Id },
  ): ReviewIssueEvent;
  listByIssue(issueId: Id): ReviewIssueEvent[];
}

/** script_snapshots: timestamps only, no version. */
export interface ScriptSnapshotRepository extends TimestampedRepository<ScriptSnapshot> {
  listByEpisode(episodeId: Id): ScriptSnapshot[];
}

/**
 * Round-3 P1-① 通用实体快照仓储。
 *
 * `entity_snapshots` 表：任意 versioned 实体 update 前的镜像；用于 rollback / 历史查看。
 * 只提供 append / list / getById / delete 四个动作；查询按 (entityType, entityId) 维度。
 */
export interface EntitySnapshotRepository {
  append(
    input: Omit<EntitySnapshot, "id" | "createdAt" | "updatedAt"> & { id?: Id },
  ): EntitySnapshot;
  getById(id: Id): EntitySnapshot | null;
  listByEntity(entityType: string, entityId: Id, limit?: number): EntitySnapshot[];
  deleteById(id: Id): void;
  /** 裁剪某实体的历史，保留最近 keep 条。 */
  trim(entityType: string, entityId: Id, keep: number): number;
}

export interface ActivityEventRepository {
  append(input: Omit<ActivityEvent, "id" | "createdAt"> & { id?: Id }): ActivityEvent;
  listByProject(projectId: Id, limit?: number): ActivityEvent[];
}

/** export_bundles: timestamps only, no version. */
export interface ExportBundleRepository extends TimestampedRepository<ExportBundle> {
  listByProject(projectId: Id): ExportBundle[];
}

// ===== A1 scope 扩展 =====

/** continuity_locks: timestamps, no version（可 disable，不做乐观锁）。 */
export interface ContinuityLockRepository extends TimestampedRepository<ContinuityLock> {
  listByProject(projectId: Id): ContinuityLock[];
  listByEpisode(episodeId: Id): ContinuityLock[];
  listActive(projectId: Id, episodeId?: Id): ContinuityLock[];
}

/**
 * episode_asset_refs: 复合主键 (episode_id, asset_type, asset_id)，无版本。
 * 只有 attach/detach/list 三个操作。
 */
export interface EpisodeAssetRefRepository {
  attach(input: Omit<EpisodeAssetRef, "createdAt">): EpisodeAssetRef;
  detach(episodeId: Id, assetType: EpisodeAssetRef["assetType"], assetId: Id): void;
  listByEpisode(episodeId: Id): EpisodeAssetRef[];
  listByAsset(assetType: EpisodeAssetRef["assetType"], assetId: Id): EpisodeAssetRef[];
}

/**
 * image_assets（综合方案 §4.F、M4#2）：AI 生成图 base64 落库。
 * 不做乐观锁；查询按 episode / scene / keyframe 维度。
 */
export interface ImageAssetRepository extends TimestampedRepository<ImageAsset> {
  listByEpisode(episodeId: Id): ImageAsset[];
  listByScene(sceneId: Id): ImageAsset[];
  listByShot(shotId: Id): ImageAsset[];
  listByKeyframe(keyframeId: Id): ImageAsset[];
  /** 常用取回最新一张，用于「首帧图 preview」等场景。 */
  latestByEpisode(episodeId: Id): ImageAsset | null;
  latestByShot(shotId: Id): ImageAsset | null;
  // 资产参考图（P1）：角色 / 场景 / 道具的视觉锁参考图。
  listByCharacter(characterId: Id): ImageAsset[];
  listByLocation(locationId: Id): ImageAsset[];
  listByProp(propId: Id): ImageAsset[];
  latestByCharacter(characterId: Id): ImageAsset | null;
  latestByLocation(locationId: Id): ImageAsset | null;
  latestByProp(propId: Id): ImageAsset | null;
}

/**
 * VideoAssetRepository — Round-4 Phase-C：Seedance 视频落库。
 * 无版本、无 update 语义：Ark 出的视频不可变，重生就 create 一条新记录。
 */
export interface VideoAssetRepository extends TimestampedRepository<VideoAsset> {
  listByEpisode(episodeId: Id): VideoAsset[];
  listByScene(sceneId: Id): VideoAsset[];
  listByShot(shotId: Id): VideoAsset[];
  latestByShot(shotId: Id): VideoAsset | null;
  /** Episode 页 CTA 用：一次拿到本集所有 shot 的最新视频。 */
  latestByEpisodeShots(episodeId: Id): VideoAsset[];
}

/**
 * Aggregate accessor + transaction boundary. Services depend on this, never on SQLite directly.
 * `transaction` runs `fn` inside a single DB transaction (all-or-nothing).
 */
export interface RepositoryRegistry {
  readonly projects: ProjectRepository;
  readonly storyBibles: ProjectStoryBibleRepository;
  readonly episodes: EpisodeRepository;
  readonly characters: CharacterRepository;
  readonly characterLooks: CharacterLookRepository;
  readonly locations: LocationRepository;
  readonly props: PropRepository;
  readonly styleGuides: StyleGuideRepository;
  readonly scenes: SceneRepository;
  readonly sceneDialogueBlocks: SceneDialogueBlockRepository;
  readonly sceneActionBlocks: SceneActionBlockRepository;
  readonly shots: ShotRepository;
  readonly keyframeSpecs: KeyframeSpecRepository;
  readonly continuityAnchors: ContinuityAnchorRepository;
  readonly sceneCharacters: SceneCharacterRepository;
  readonly shotCharacters: ShotCharacterRepository;
  readonly shotProps: ShotPropRepository;
  readonly promptSpecs: PromptSpecRepository;
  readonly modelProfiles: ModelProfileRepository;
  readonly generationTasks: GenerationTaskRepository;
  readonly taskLogs: TaskLogRepository;
  readonly artifacts: ArtifactRepository;
  readonly reviewIssues: ReviewIssueRepository;
  readonly reviewRuns: ReviewRunRepository;
  readonly reviewIssueEvents: ReviewIssueEventRepository;
  readonly scriptSnapshots: ScriptSnapshotRepository;
  readonly entitySnapshots: EntitySnapshotRepository;
  readonly activityEvents: ActivityEventRepository;
  readonly exportBundles: ExportBundleRepository;
  readonly continuityLocks: ContinuityLockRepository;
  readonly episodeAssetRefs: EpisodeAssetRefRepository;
  readonly imageAssets: ImageAssetRepository;
  readonly videoAssets: VideoAssetRepository;

  /** Run `fn` inside a single atomic transaction. */
  transaction<T>(fn: () => T): T;

  /**
   * Round-3 P1-①（补丁）：在 fn 执行期间跳过 snapshot sink 的自动快照。
   *
   * 用于"业务噪音"级 update（例如 rollup 汇总回写）——它们不需要留在
   * 历史抽屉里，避免稀释真正的人工/AI 改动版本。可嵌套。
   */
  runWithoutSnapshot<T>(fn: () => T): T;
}
