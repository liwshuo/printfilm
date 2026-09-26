/**
 * Named structures for JSON-blob columns and composite value objects.
 * Authority: data-and-api-v1.md §6 (verbatim). These replace `Record<string, unknown>`
 * black boxes where the spec has committed to a named shape.
 */

import type { Id, IsoTime } from "./primitives.js";

// ===== projects.*_json =====

export interface ProjectOutputSpec {
  resolution: "720p" | "1080p" | "4k";
  fps: 24 | 25 | 30;
  targetDurationSec?: number;
  subtitle: "burned" | "sidecar" | "none";
  voiceover: "tts" | "none";
}

export interface ProjectModelPolicy {
  imageProvider?: string;
  videoProvider?: string;
  ttsProvider?: string;
  quality?: "draft" | "standard" | "high";
}

export interface ProjectCreativeConstraints {
  forbiddenGenres: string[];
  styleTaboos: string[];
  contentBoundaries: string[];
}

// ===== project_story_bibles.*_json =====

/** → project_story_bibles.world_rules_json */
export interface WorldRulesJson {
  setting?: string;
  rules?: Array<{ label: string; detail?: string }>;
  taboos?: string[];
  keyLocationRefs?: Id[];
}

/** → project_story_bibles.character_relations_json */
export interface CharacterRelationsJson {
  mainCharacter?: {
    characterRef?: Id;
    name?: string;
    goal?: string;
    want?: string;
    need?: string;
  };
  mainConflict?: {
    axis: string;
    protagonistSide?: string;
    antagonistSide?: string;
    stake?: string;
  };
  relationshipMap?: Array<{
    fromRef?: Id;
    toRef?: Id;
    fromName?: string;
    toName?: string;
    relationType: string;
    note?: string;
  }>;
  motivationChain?: Array<{
    characterRef?: Id;
    trigger: string;
    motivation: string;
    action: string;
    order: number;
  }>;
  characterRelations?: string;
}

/** → project_story_bibles.villain_system_json */
export interface VillainSystemJson {
  villains?: Array<{
    characterRef?: Id;
    name?: string;
    goal?: string;
    method?: string;
    pressureCurve?: string;
  }>;
}

/** → project_story_bibles.pacing_plan_json */
export interface PacingPlanJson {
  overallCurve?: string;
  beatsPerEpisode?: number;
  segments?: Array<{ label: string; targetPaceSec?: number; note?: string }>;
}

/** → project_story_bibles.hook_system_json (incl. cliffhangerPlan) */
export interface HookSystemJson {
  hooks?: Array<{
    episodeRef?: Id;
    hookType: string;
    placement: "cold_open" | "mid" | "ending";
    description: string;
  }>;
  cliffhangerPlan?: Array<{
    episodeRef?: Id;
    setup: string;
    payoffEpisodeRef?: Id;
    intensity?: "low" | "medium" | "high";
  }>;
}

/** → project_story_bibles.source_ref_json */
export interface StoryBibleSourceRef {
  origin: "manual" | "generated" | "imported";
  sourceTaskId?: Id;
  importedFrom?: string;
  generatedAt?: IsoTime;
}

// ===== prompt_specs.sections_json entry =====

export interface PromptSection {
  key: string;
  label: string;
  content: string;
  sourceRefs: Array<{ entityType: string; entityId: Id; version?: number }>;
}

// ===== review_issues.evidence_json =====

/** Review issue evidence (produced by review engine; Review Center §9.3 read-only). */
export interface ReviewEvidence {
  locationLabel?: string;
  quote?: string;
  expected?: string;
  actual?: string;
  refs?: Array<{ entityType: string; entityId: Id }>;
  metrics?: Record<string, number>;
}

// ===== script_snapshots.snapshot_payload_json =====
// NOTE: uses Scene / SceneDialogueBlock / SceneActionBlock — imported lazily to avoid a cycle.
// The full payload interface lives in entities.ts alongside those types.

// ===== activity_events.target_ref_json / payload_json =====

export interface ActivityTargetRef {
  entityType:
    | "project"
    | "episode"
    | "scene"
    | "shot"
    | "asset"
    | "prompt"
    | "task"
    | "review_run"
    | "export_bundle"
    | "image_asset";
  entityId: Id;
  label?: string;
}

export interface ActivityPayload {
  fromStatus?: string;
  toStatus?: string;
  count?: number;
  extra?: Record<string, unknown>;
}

// ===== export_bundles.manifest_json =====

/** export_bundles.manifest — sole authority (export-center §15.3 fields project from this). */
export interface ExportManifest {
  bundleType: string;
  version: string;
  createdAt: IsoTime;
  scope: { scopeType: string; scopeRefId?: Id; scopeLabel?: string };
  includedFiles: Array<{ path: string; sizeBytes?: number; artifactId?: Id }>;
  sourceRefs: Array<{ entityType: string; entityId: Id; version?: number }>;
  artifactRefs: Id[];
  promptRefs: Id[];
  reviewRefs: Id[];
  counts: {
    includedArtifactsCount: number;
    includedPromptCount: number;
    includedReviewIssueCount: number;
  };
}


// ===== episodes.handoff_state_json (A1 drama 跨集连续性交接) =====

/**
 * drama 跨集连续性「交接胶囊」：仅记录跨集必须继承的最小 delta，非全量快照。
 * 参考 drama-skills scene-handoff-capsule / handoff_state。
 */
export interface HandoffStateJson {
  /** 本集结束时的关键世界/人物状态（entry-state for next episode）。 */
  endingState?: Array<{ subject: string; state: string }>;
  /** 已埋下但尚未兑现的 setup → payoff 债务。 */
  openSetups?: Array<{ setup: string; expectedPayoff?: string; episodeNo?: number }>;
  /** 权力/关系/物理状态等跨集不可回退的既成事实。 */
  invariants?: string[];
  /** 生成来源与时间戳。 */
  generatedAt?: IsoTime;
}

// ===== episodes.arc_beats_json (P0-B 内容饱满化) =====

/**
 * 分集内四段节奏曲线（借鉴 0xsline 15/30/35/20 分布，zenstory arc_beats）。
 * 长度固定 4：起势 → 攀升 → 风暴 → 决战。绘本 / 纪录片形态可退化为轻量描述。
 */
export type ArcBeatPhase = "opening" | "rising" | "storm" | "climax";

export interface ArcBeat {
  phase: ArcBeatPhase;
  /** 中文短句，一句概括这一段做什么。 */
  description: string;
  /** 本段建议时长占比（0~1）。 */
  weight?: number;
}

export type ArcBeatsJson = ArcBeat[];

// ===== review_runs.quality_scores_json (五维质量评分) =====

/** 五维质量评分（0–100），参考 short-drama references 的评分维度。 */
export interface QualityScoresJson {
  pacing?: number;
  hook?: number;
  dialogue?: number;
  format?: number;
  coherence?: number;
  /** 加权总分，便于列表排序。 */
  overall?: number;
  notes?: string;
}

// ===== continuity_locks.applies_to_json (A1 逐字锁面适用范围) =====

/**
 * 连续性锁面适用范围（applies_to）。空对象等价于「全项目/全集」。
 * 参考 drama-skills continuity-lock：把跨镜/跨集不变的最小名词短语锁死。
 */
export interface ContinuityLockAppliesTo {
  characterIds?: Id[];
  locationIds?: Id[];
  propIds?: Id[];
  shotIds?: Id[];
  /** 附加自由文本，用于机械核对时的语义解释。 */
  note?: string;
}

// ===== JobOrchestrator 类型化轮询档案（POLL_PROFILES） =====

/**
 * 每个 task type 的轮询/退避档案（参考 huobao-drama POLL_PROFILES）。
 * intervalMs：轮询上游生成状态的固定间隔；maxAttempts：达到即视为过期终态。
 * retryableCodes：failJob 时若 errorCode 命中则允许自动重试（可重试错误）；
 * terminalCodes：命中即立即终态、不再重试；其他错误默认按 terminal 处理但允许人工重试。
 * 与 adr-003 §6 保持一致：generation_tasks 状态转移不做乐观锁。
 */
export interface TaskPollProfile {
  intervalMs: number;
  maxAttempts: number;
  retryableCodes: string[];
  terminalCodes: string[];
  /** 备注：档案的适用说明。 */
  note?: string;
}
