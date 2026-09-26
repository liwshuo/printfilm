/**
 * Core domain entities.
 * Authority: data-and-api-v1.md §6 (verbatim). These are read-model shapes:
 * JSON columns are surfaced as structured objects; persistence mapping lives in @dramaflow/repositories.
 */

import type { BaseEntity, AppendOnlyEntity, Id, IsoTime } from "./primitives.js";
import type {
  ProjectStatus,
  ConfirmStatus,
  ReviewStatus,
  ProductionStatus,
  PromptStatus,
  ReviewIssueStatus,
  ReviewRunStatus,
  ReviewRunVerdict,
  TaskType,
  TaskStatus,
  ModelType,
  PromptTargetType,
  ArtifactType,
  ArtifactStatus,
  ActiveStatus,
  ExportBundleStatus,
  ReviewIssueType,
  Severity,
  KeyframeType,
  AnchorStrength,
  PromptSourceEntityType,
  ReviewIssueEventAction,
  AspectRatio,
  ProjectType,
  ComplianceMode,
  ArtifactReferenceState,
  ReviewRuleTier,
} from "./enums.js";
import type {
  ProjectOutputSpec,
  ProjectModelPolicy,
  ProjectCreativeConstraints,
  WorldRulesJson,
  HookSystemJson,
  PacingPlanJson,
  VillainSystemJson,
  CharacterRelationsJson,
  StoryBibleSourceRef,
  PromptSection,
  ReviewEvidence,
  ActivityTargetRef,
  ActivityPayload,
  ExportManifest,
  HandoffStateJson,
  ArcBeatsJson,
  QualityScoresJson,
  ContinuityLockAppliesTo,
} from "./json-fields.js";
import type { ContentType, ProjectVisualStyle } from "./content-types.js";

// ===== 3.1 项目与故事层 =====

export interface Project extends BaseEntity {
  name: string;
  slug: string;
  status: ProjectStatus;
  /** A1: 连续剧(drama) / 选集剧(series)，决定故事圣经与资产的默认作用域。 */
  projectType: ProjectType;
  /** A1: 内容形态（短剧/动画/漫画/绘本/纪录/教育故事…），与 projectType 正交。 */
  contentType: ContentType;
  /** A1: 视觉风格（预设 key + 可选 customPrompt + 解析后 promptSuffix）。 */
  visualStyle: ProjectVisualStyle;
  /** 国内/出海模式，驱动合规审查与导出 gate。 */
  complianceMode: ComplianceMode;
  genre?: string;
  audience?: string;
  aspectRatio: AspectRatio;
  targetDurationSec?: number;
  episodeCount: number;
  language: string;
  outputSpec: ProjectOutputSpec;
  modelPolicy: ProjectModelPolicy;
  creativeConstraints: ProjectCreativeConstraints;
  version: number;
}

export interface ProjectStoryBible extends BaseEntity {
  projectId: Id;
  /** A1 scope: 空 = 项目级圣经（drama/series 共享底座）；非空 = 该集专属圣经（series）。 */
  episodeId?: Id;
  logline?: string;
  theme?: string;
  tone?: string;
  worldRules: WorldRulesJson;
  hookSystem: HookSystemJson;
  pacingPlan: PacingPlanJson;
  villainSystem: VillainSystemJson;
  characterRelations: CharacterRelationsJson;
  sourceRef: StoryBibleSourceRef;
  version: number;
}

export interface Episode extends BaseEntity {
  projectId: Id;
  episodeNo: number;
  title?: string;
  summary?: string;
  hookType?: string;
  episodeGoal?: string;
  episodeConflict?: string;
  episodeTurn?: string;
  episodeEndingHook?: string;
  /** 起势/攀升/风暴/决战 四段节奏曲线（P0-B 参考 0xsline / zenstory arc_beats）。 */
  arcBeats?: ArcBeatsJson;
  /** educational_story 专属：本集要传递的核心成语 / 寓意 / 学科锚点。 */
  learningAnchor?: string;
  /** AI 自动估算的场次数量；用户不用填。 */
  sceneCountEstimate?: number;
  /** 建议受众（e.g. "6-9 岁"、"12+"）。 */
  ageHint?: string;
  storyStatus: ConfirmStatus;
  scriptStatus: ConfirmStatus;
  /** Rollup summary only; canonical storyboard confirmation is scene-level. */
  storyboardStatus: ConfirmStatus | "partial";
  productionStatus: ProductionStatus;
  reviewStatus: ReviewStatus;
  /** drama 跨集连续性交接胶囊（最小 delta），series 通常留空。 */
  handoffState: HandoffStateJson;
  version: number;
}

// ===== 3.2 资产与设定层 =====

export interface Character extends BaseEntity {
  projectId: Id;
  /** A1 scope: 空 = 项目级资产（drama 共享）；非空 = 该集专属资产（series）。 */
  episodeId?: Id;
  name: string;
  roleType?: string;
  genderPresentation?: string;
  ageRange?: string;
  identitySummary?: string;
  personality?: string;
  motivation?: string;
  taboos?: string;
  speechStyle?: string;
  /** 视觉锁：跨镜头保持一致的关键视觉描述（story-bible / seeds 生成）。 */
  visualLock?: string;
  status: ActiveStatus;
  version: number;
}

export interface CharacterLook extends BaseEntity {
  characterId: Id;
  lookGroupId: Id;
  previousLookId?: Id;
  versionNo: number;
  lookName: string;
  lookType?: string;
  appearanceSpec: Record<string, unknown>;
  hairSpec: Record<string, unknown>;
  makeupSpec: Record<string, unknown>;
  wardrobeSpec: Record<string, unknown>;
  propsSpec: Record<string, unknown>;
  continuityRules: Record<string, unknown>;
  status: ActiveStatus;
  isCurrent: boolean;
  isDefault: boolean;
  createdBy?: string;
  changeSummary?: string;
  version: number;
}

export interface Location extends BaseEntity {
  projectId: Id;
  /** A1 scope: 空 = 项目级资产；非空 = 该集专属资产（series）。 */
  episodeId?: Id;
  name: string;
  locationType?: string;
  visualSpec: Record<string, unknown>;
  spaceRules: Record<string, unknown>;
  lightingRules: Record<string, unknown>;
  continuityRules: Record<string, unknown>;
  /** 视觉锁：地点跨镜头保持视觉一致的描述。 */
  visualLock?: string;
  status: ActiveStatus;
  version: number;
}

export interface Prop extends BaseEntity {
  projectId: Id;
  /** A1 scope: 空 = 项目级资产；非空 = 该集专属资产（series）。 */
  episodeId?: Id;
  name: string;
  propType?: string;
  visualSpec: Record<string, unknown>;
  ownership: Record<string, unknown>;
  continuityRules: Record<string, unknown>;
  /** 视觉锁：道具跨镜头保持视觉一致的描述。 */
  visualLock?: string;
  status: ActiveStatus;
  version: number;
}

export interface StyleGuide extends BaseEntity {
  projectId: Id;
  visualStyle?: string;
  cameraStyle?: string;
  colorScript: Record<string, unknown>;
  forbiddenPatterns: Record<string, unknown>;
  referenceNotes: Record<string, unknown>;
  version: number;
}

// ===== 3.3 分镜与关键帧层 =====

export interface Scene extends BaseEntity {
  episodeId: Id;
  sceneNo: number;
  title?: string;
  locationId?: Id;
  timeOfDay?: string;
  summary?: string;
  dramaticGoal?: string;
  conflict?: string;
  sceneTags: string[];
  entryState: Record<string, unknown>;
  exitState: Record<string, unknown>;
  storyboardStatus: ConfirmStatus;
  version: number;
  sortOrder: number;
}

export interface SceneDialogueBlock extends BaseEntity {
  sceneId: Id;
  speakerCharacterId?: Id;
  text: string;
  emotion?: string;
  deliveryNote?: string;
  sortOrder: number;
}

export interface SceneActionBlock extends BaseEntity {
  sceneId: Id;
  actionText: string;
  actorRefs: Id[];
  propRefs: Id[];
  sortOrder: number;
}

export interface Shot extends BaseEntity {
  sceneId: Id;
  shotNo: number;
  shotType?: string;
  intent?: string;
  cameraPlan: Record<string, unknown>;
  performanceNotes?: string;
  startState: Record<string, unknown>;
  endState: Record<string, unknown>;
  handoffAnchor: Record<string, unknown>;
  isKeyShot: boolean;
  durationSec?: number;
  /**
   * 方案 A：shot 粒度台词文本，由 LLM 在 scene_outline 阶段一次性产出。
   * 空表示该 shot 无台词（纯动作/氛围镜头）。
   */
  dialogue?: string;
  /**
   * 方案 A：shot 粒度动作/画面描述，由 LLM 一次性产出。
   * 与 `scene_action_blocks`（结构化 actor/prop refs）互补，普通短剧场景优先用它。
   */
  action?: string;
  version: number;
  sortOrder: number;
}

export interface KeyframeSpec extends BaseEntity {
  shotId: Id;
  frameType: KeyframeType;
  composition: Record<string, unknown>;
  subjectLayout: Record<string, unknown>;
  expressionPose: Record<string, unknown>;
  backgroundRequirement: Record<string, unknown>;
  continuityAnchor: Record<string, unknown>;
  promptSummary?: string;
  status: ConfirmStatus;
  version: number;
}

export interface ContinuityAnchor extends BaseEntity {
  shotId: Id;
  anchorType: string;
  sourceShotId?: Id;
  anchorPayload: Record<string, unknown>;
  strength: AnchorStrength;
  status: ActiveStatus;
}

// ===== relation / link tables (composite PK, no version) =====

export interface SceneCharacter {
  sceneId: Id;
  characterId: Id;
  lookId?: Id;
  presenceType: string; // default 'present'
}

export interface ShotCharacter {
  shotId: Id;
  characterId: Id;
  lookId?: Id;
  blockingNote?: string;
}

export interface ShotProp {
  shotId: Id;
  propId: Id;
  stateNote?: string;
}

// ===== 3.4 执行层 =====

export interface PromptSpec extends BaseEntity {
  projectId: Id;
  episodeId?: Id;
  sceneId?: Id;
  shotId?: Id;
  keyframeId?: Id;
  targetType: PromptTargetType;
  sourceEntityType: PromptSourceEntityType;
  sourceEntityId: Id;
  compiledPrompt: string;
  sections: PromptSection[];
  negativePrompt?: string;
  modelProfileId?: Id;
  compilerVersion: string;
  version: number;
  sourceVersionSnapshot: Record<string, unknown>;
  status: PromptStatus;
  supersededBy?: Id;
}

export interface ModelProfile extends BaseEntity {
  provider: string;
  modelType: ModelType;
  modelName: string;
  /** Reference key only, not the raw secret (adr-001). */
  endpointKey?: string;
  defaultParams: Record<string, unknown>;
  isActive: boolean;
}

export interface GenerationTask extends BaseEntity {
  projectId: Id;
  taskType: TaskType;
  sourceEntityType: string;
  sourceEntityId: Id;
  promptSpecId?: Id;
  modelProfileId?: Id;
  status: TaskStatus;
  priority: number;
  retryCount: number;
  retryOfTaskId?: Id;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  usage: Record<string, unknown>;
  costEstimate?: number;
  errorMessage?: string;
  /** Standard error code on failure; aligns with adr-004 §4. */
  errorCode?: string;
  startedAt?: IsoTime;
  finishedAt?: IsoTime;
  durationMs?: number;
}

export interface TaskLog extends AppendOnlyEntity {
  taskId: Id;
  eventType: string;
  message: string;
  payload: Record<string, unknown>;
}

export interface Artifact extends BaseEntity {
  projectId: Id;
  artifactType: ArtifactType;
  sourceTaskId?: Id;
  sourceEntityType: string;
  sourceEntityId: Id;
  filePath: string;
  previewPath?: string;
  metadata: Record<string, unknown>;
  status: ArtifactStatus;
  /** 三态参考图：unverified / planned / verified，供一致性上下文注入决策。 */
  referenceState?: ArtifactReferenceState;
}

// ===== 3.5 审查与导出层 =====

export interface ReviewIssue extends BaseEntity {
  projectId: Id;
  reviewRunId?: Id;
  episodeId?: Id;
  sceneId?: Id;
  shotId?: Id;
  promptSpecId?: Id;
  artifactId?: Id;
  issueType: ReviewIssueType;
  severity: Severity;
  /** 规则分级：决定该 issue 是否 block 确认（structural_invariant 硬阻断等）。 */
  ruleTier?: ReviewRuleTier;
  ruleCode?: string;
  evidence: ReviewEvidence;
  sourceVersion?: string;
  title: string;
  description?: string;
  suggestion?: string;
  resolutionNote?: string;
  ignoreReason?: string;
  status: ReviewIssueStatus;
}

export interface ReviewRun extends BaseEntity {
  projectId: Id;
  scopeType: string;
  scopeRefId: Id;
  reviewTypes: string[];
  runMode: string;
  status: ReviewRunStatus;
  verdict?: ReviewRunVerdict;
  /** 五维质量评分（节奏/爽点/台词/格式/连贯性），run 完成时填充。 */
  qualityScores?: QualityScoresJson;
  startedAt?: IsoTime;
  finishedAt?: IsoTime;
}

export interface ReviewIssueEvent extends BaseEntity {
  issueId: Id;
  action: ReviewIssueEventAction;
  fromStatus?: ReviewIssueStatus;
  toStatus: ReviewIssueStatus;
  note?: string;
  changedBy?: string;
}

/** Episode-level full script snapshot payload (script-editor §10.2/§10.3). */
export interface ScriptSnapshotPayload {
  episodeId: Id;
  scenes: Array<{
    scene: Scene;
    dialogueBlocks: SceneDialogueBlock[];
    actionBlocks: SceneActionBlock[];
  }>;
  capturedAt: IsoTime;
}

export interface ScriptSnapshot extends BaseEntity {
  episodeId: Id;
  versionLabel: string;
  createdBy?: string;
  changeSummary?: string;
  snapshotPayload: ScriptSnapshotPayload;
}

/**
 * Round-3 P1-① 通用实体快照。
 *
 * 每个 versioned 实体在 update 前生成一条，用于任意场景下的 rollback / 历史查看。
 *
 * - `entityType`：`mapping.table`（如 `scenes` / `episodes` / `characters` / `locations` /
 *   `props` / `project_story_bibles`），无需引入 kind enum。
 * - `payloadJson`：改动前那一版的完整实体（camelCase JSON）。
 * - `version`：被覆盖前的 `version` 值；rollback 时以此判断链路。
 * - `reason`：`update` / `regenerate` / `rollback` / `manual` 等。
 * - `summary`：给 UI 直接展示的中文标题（可选）。
 */
export interface EntitySnapshot extends BaseEntity {
  entityType: string;
  entityId: Id;
  version: number;
  payloadJson: string;
  reason?: string;
  summary?: string;
}

export interface ActivityEvent extends AppendOnlyEntity {
  projectId: Id;
  eventType: string;
  summary: string;
  actor?: string;
  targetRef: ActivityTargetRef;
  payload: ActivityPayload;
}

export interface ExportBundle extends BaseEntity {
  projectId: Id;
  bundleType: string;
  version: string;
  versionLabel?: string;
  scopeType?: string;
  scopeRefId?: Id;
  outputPath: string;
  manifest: ExportManifest;
  bundleSizeBytes?: number;
  composeTaskId?: Id;
  errorMessage?: string;
  status: ExportBundleStatus;
  finishedAt?: IsoTime;
}

// ===== A1 scope 扩展：连续性锁 / 跨集资产引用 =====

/**
 * 连续性锁面（参考 drama-skills continuity-lock）：把跨镜/跨集不变的最小名词短语
 * （颜色+材质+物体）设为逐字锁面，Prompt 编译时逐字注入并在产物正文机械核对。
 * scope=project 时 episodeId 为 null；scope=episode 时 episodeId 为对应集。
 * appliesTo 记录锁面适用的镜头/角色范围（如 { characterIds: [...], shotIds: [...] }）。
 */
export interface ContinuityLock extends BaseEntity {
  projectId: Id;
  episodeId?: Id;
  scope: "project" | "episode" | "scene";
  lockPhrase: string;
  appliesTo: ContinuityLockAppliesTo;
  status: ActiveStatus;
}

/**
 * 跨集资产复用引用（series 优先场景，drama 亦可用）。
 * episode 显式引用某个项目/其它集下的角色/场地/道具。
 */
export interface EpisodeAssetRef {
  episodeId: Id;
  assetType: "character" | "location" | "prop";
  assetId: Id;
  note?: string;
  createdAt: IsoTime;
}

// ===== 3.6 系统 / 元数据层 =====

export interface SchemaMigration {
  version: string;
  appliedAt: IsoTime;
  checksum: string;
}

// ===== 3.7 AI 图像素材（综合方案 §4.F、M4#2） =====
//
// image_assets 表：seedream 出的图 base64 落库。P0 阶段单集首帧图先用这条链路。
// P1/P2 接入 keyframe / scene 时可以填 keyframe_id / scene_id / shot_id。

export interface ImageAsset extends BaseEntity {
  /** 关联剧集（P0 必填；未来 world/character seed 图可以为空）。 */
  episodeId?: Id;
  sceneId?: Id;
  shotId?: Id;
  keyframeId?: Id;
  /** 资产图挂载点（P1）：角色 portrait / 场景 concept / 道具 concept 各占一列。 */
  characterId?: Id;
  locationId?: Id;
  propId?: Id;
  /** 供应商（P0：`volcengine-ark`）。 */
  provider: string;
  /** 模型 endpoint id（如 `doubao-seedream-5-0-260128`）。 */
  modelId: string;
  /** 实际下发的英文 prompt（含 visual_lock 拼接后的最终版）。 */
  promptPositive: string;
  /** 可选：原始中文思路（便于人肉复盘）。 */
  promptPositiveZh?: string;
  /** Seedream 档位（IMAGE_SIZE_PRESETS 之一），如 `1024x1792`。 */
  sizePreset: string;
  /** 可选：A/B 重出用。 */
  seed?: number;
  /** b64_json 原文（不含 `data:image/png;base64,` 前缀）；`status='failed'` 时为空串。 */
  base64: string;
  /** MIME 类型，默认 `image/png`。 */
  mimeType: string;
  /** 上游完整响应元数据（去掉 base64）。 */
  rawResponse: Record<string, unknown>;
  /** 生成状态（0006 migration）：succeeded / failed / stale，默认 succeeded。 */
  status: "succeeded" | "failed" | "stale";
  /** 失败原因摘要，成功时为空。 */
  errorMessage?: string;
  /** 累计尝试次数，默认 1；每次重试 +1。 */
  attemptCount: number;
  /** 若本行是重试记录，指向被重试的原 image_asset.id。 */
  retryOfId?: Id;
  /** 上游依赖变更触发的过期原因（P2-⑤ 使用）。 */
  staleReason?: string;
}

// ===== 3.8 AI 视频素材（Round-4 Phase-C）=====
//
// video_assets 表：Seedance 2.0-mini 视频生成结果落库。
// 与 ImageAsset 的关键差异：
//   * 上游返回的是 24h 过期的临时 URL，而非 base64 → 落 `videoUrl`；
//   * 生成任务是 shot 级 append-only，需要接力时基于 `lastFrameUrl` 拼下一条。
// 一集完整 mp4 由 ExportBundle / compose_export 链路负责拼接，不落这张表。

export type VideoAssetStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "stale";

export interface VideoAsset extends BaseEntity {
  episodeId?: Id;
  sceneId?: Id;
  shotId?: Id;
  /** 首帧参考图（image_assets.id），视频接力的起点；可空表示纯文生视频。 */
  firstFrameImageId?: Id;
  provider: string;
  modelId: string;
  /** 实际下发的英文 prompt。 */
  prompt: string;
  /** 可选：原始中文思路（人工复盘用）。 */
  promptZh?: string;
  /** 分辨率档位（`480p` / `720p` / `1080p`）。 */
  resolution: string;
  /** 画幅（`9:16` / `16:9` / `1:1` / `4:3` / `3:4`）。 */
  ratio: string;
  /** 时长（秒），Seedance 2.0-mini 上限 15。 */
  durationSec: number;
  /**
   * 时长来源（0009 migration）：
   *   - `explicit`       — 上游/shot 显式指定
   *   - `text_estimate`  — 由 dialogue/action 块字数精确估算
   *   - `scene_summary`  — 块表空，退回 scene.summary + shot.intent 等自由文本估算
   *   - `default`        — 无信号，用默认值兜底
   * 历史行为 `undefined`。
   */
  durationSource?:
    | "explicit"
    | "shot_text"
    | "text_estimate"
    | "scene_summary"
    | "default";
  /** 参与估算的场次台词字数；`durationSource !== "text_estimate"` 时为 0。 */
  durationDialogueChars: number;
  /** 参与估算的场次动作字数；`durationSource !== "text_estimate"` 时为 0。 */
  durationActionChars: number;
  /**
   * 是否 image-to-video 生成。
   * 目前只要挂了首帧图（`firstFrameImageId` 有值或首帧来自接力 `lastFrameUrl`）即为 true。
   */
  isI2V: boolean;
  /** 上游 24h 过期临时 URL；到期需重生。 */
  videoUrl: string;
  /** 末帧图 URL；可作为下一 shot 视频接力锚点。 */
  lastFrameUrl?: string;
  /** Ark 视频异步任务 id（observability）。 */
  taskId?: string;
  /** 上游完整响应元数据。 */
  rawResponse: Record<string, unknown>;
  status: VideoAssetStatus;
  errorMessage?: string;
  attemptCount: number;
  retryOfId?: Id;
  staleReason?: string;
}
