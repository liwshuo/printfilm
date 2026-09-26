/**
 * Shared enums / string-literal unions.
 * Authority: data-and-api-v1.md §6 (verbatim). Do not fork these unions in module specs.
 */

export type ProjectStatus = "draft" | "active" | "archived";
export type ConfirmStatus = "draft" | "confirmed";

/**
 * A1 project model.
 * - `drama` 连续剧：项目级共享故事圣经/资产/连续性，跨集经 handoff_state 继承。
 * - `series` 选集/单元剧：每集默认独立故事/资产，允许经 episode_asset_refs 显式跨集复用。
 */
export type ProjectType = "series" | "drama";

/** 出海/国内双模式，驱动合规审查规则集与导出 gate。 */
export type ComplianceMode = "domestic" | "overseas";

/**
 * 三态参考图（asset/artifact 一致性锚点）：
 * unverified 仅提示词/计划引用；planned 已指定为计划参考；verified 已核实真实参考图。
 */
export type ArtifactReferenceState = "unverified" | "planned" | "verified";

/**
 * 审查规则分级（drama-skills）：决定 issue 是否 block 确认。
 * structural_invariant 硬阻断；reviewed_invariant 需证据；craft_default 可覆盖建议；taste_option 不阻断。
 */
export type ReviewRuleTier =
  | "structural_invariant"
  | "reviewed_invariant"
  | "craft_default"
  | "taste_option";

/**
 * Object-level review conclusion (Episode.reviewStatus etc).
 * pending = no finished conclusion yet; passed = latest finished run covering it has no blocker;
 * failed = has blocking issue.
 */
export type ReviewStatus = "pending" | "passed" | "failed";

/**
 * review_runs.status — run execution lifecycle.
 * failed = the run itself aborted abnormally (unrelated to "has blocker").
 */
export type ReviewRunStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * review_runs.verdict — review conclusion, only meaningful when status = succeeded.
 * passed = no high/critical open issue; blocked = has blocker.
 */
export type ReviewRunVerdict = "passed" | "blocked";

export type ProductionStatus =
  | "idle"
  | "queued"
  | "running"
  | "partial"
  | "done"
  | "failed";

export type PromptStatus = "draft" | "confirmed" | "superseded";

export type ReviewIssueStatus = "open" | "resolved" | "ignored" | "reopened";

export type TaskType =
  | "story_generate"
  | "storyboard_generate"
  | "keyframe_generate"
  | "prompt_compile"
  | "image_generate"
  | "video_generate"
  | "tts_generate"
  | "compose_export";

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ModelType = "llm" | "image" | "video" | "tts";

/**
 * Prompt target type; `text` covers LLM text-generation tasks
 * (story_generate / prompt_compile produced prompt). See data-api §8.6.
 */
export type PromptTargetType = "text" | "image" | "video" | "tts";

export type ArtifactType = "image" | "video" | "audio" | "subtitle" | "bundle";

/** Simple entity active/disabled lifecycle (characters/locations/props/looks/continuity). */
export type ActiveStatus = "active" | "disabled";

/** Artifact file lifecycle. */
export type ArtifactStatus = "ready" | "deleted" | "broken";

/** Export bundle lifecycle, driven by its compose task (adr-006 §5). */
export type ExportBundleStatus = "queued" | "running" | "ready" | "failed";

export type ReviewIssueType =
  | "story"
  | "asset"
  | "continuity"
  | "prompt"
  | "compliance";

export type Severity = "low" | "medium" | "high" | "critical";

export type KeyframeType = "start" | "end" | "key";

export type AnchorStrength = "low" | "medium" | "high";

export type PromptSourceEntityType =
  | "character"
  | "location"
  | "scene"
  | "shot"
  | "episode"
  | "keyframe";

export type ReviewIssueEventAction = "resolve" | "ignore" | "reopen";

/** Aspect ratios supported by V1 Project Setup. */
export type AspectRatio = "9:16" | "16:9" | "1:1";
