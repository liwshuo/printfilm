/**
 * Central table mappings (entity field <-> DB column + value kind).
 * Managed columns (id / created_at / updated_at / version) are implicit in the base classes.
 * Column names must match packages/repositories/src/sqlite/migrations/0001_init.sql exactly.
 */

import type { TableMapping } from "../repositories/base.js";

export const projectMapping: TableMapping = {
  table: "projects",
  columns: [
    { column: "name", field: "name", kind: "text" },
    { column: "slug", field: "slug", kind: "text" },
    { column: "status", field: "status", kind: "text" },
    { column: "project_type", field: "projectType", kind: "text" },
    { column: "content_type", field: "contentType", kind: "text" },
    { column: "visual_style_json", field: "visualStyle", kind: "json" },
    { column: "compliance_mode", field: "complianceMode", kind: "text" },
    { column: "genre", field: "genre", kind: "text", nullable: true },
    { column: "audience", field: "audience", kind: "text", nullable: true },
    { column: "aspect_ratio", field: "aspectRatio", kind: "text" },
    { column: "target_duration_sec", field: "targetDurationSec", kind: "int", nullable: true },
    { column: "episode_count", field: "episodeCount", kind: "int" },
    { column: "language", field: "language", kind: "text" },
    { column: "output_spec_json", field: "outputSpec", kind: "json" },
    { column: "model_policy_json", field: "modelPolicy", kind: "json" },
    { column: "creative_constraints_json", field: "creativeConstraints", kind: "json" },
  ],
};

export const storyBibleMapping: TableMapping = {
  table: "project_story_bibles",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "logline", field: "logline", kind: "text", nullable: true },
    { column: "theme", field: "theme", kind: "text", nullable: true },
    { column: "tone", field: "tone", kind: "text", nullable: true },
    { column: "world_rules_json", field: "worldRules", kind: "json" },
    { column: "hook_system_json", field: "hookSystem", kind: "json" },
    { column: "pacing_plan_json", field: "pacingPlan", kind: "json" },
    { column: "villain_system_json", field: "villainSystem", kind: "json" },
    { column: "character_relations_json", field: "characterRelations", kind: "json" },
    { column: "source_ref_json", field: "sourceRef", kind: "json" },
  ],
};

export const episodeMapping: TableMapping = {
  table: "episodes",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "episode_no", field: "episodeNo", kind: "int" },
    { column: "title", field: "title", kind: "text", nullable: true },
    { column: "summary", field: "summary", kind: "text", nullable: true },
    { column: "hook_type", field: "hookType", kind: "text", nullable: true },
    { column: "episode_goal", field: "episodeGoal", kind: "text", nullable: true },
    { column: "episode_conflict", field: "episodeConflict", kind: "text", nullable: true },
    { column: "episode_turn", field: "episodeTurn", kind: "text", nullable: true },
    { column: "episode_ending_hook", field: "episodeEndingHook", kind: "text", nullable: true },
    { column: "arc_beats_json", field: "arcBeats", kind: "json", nullable: true },
    { column: "learning_anchor", field: "learningAnchor", kind: "text", nullable: true },
    { column: "scene_count_estimate", field: "sceneCountEstimate", kind: "int", nullable: true },
    { column: "age_hint", field: "ageHint", kind: "text", nullable: true },
    { column: "story_status", field: "storyStatus", kind: "text" },
    { column: "script_status", field: "scriptStatus", kind: "text" },
    { column: "storyboard_status", field: "storyboardStatus", kind: "text" },
    { column: "production_status", field: "productionStatus", kind: "text" },
    { column: "review_status", field: "reviewStatus", kind: "text" },
    { column: "handoff_state_json", field: "handoffState", kind: "json" },
  ],
};

export const locationMapping: TableMapping = {
  table: "locations",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "name", field: "name", kind: "text" },
    { column: "location_type", field: "locationType", kind: "text", nullable: true },
    { column: "visual_spec_json", field: "visualSpec", kind: "json" },
    { column: "space_rules_json", field: "spaceRules", kind: "json" },
    { column: "lighting_rules_json", field: "lightingRules", kind: "json" },
    { column: "continuity_rules_json", field: "continuityRules", kind: "json" },
    { column: "status", field: "status", kind: "text" },
    // 视觉锁：0004 migration 引入。供关键帧 prompt 保证跨镜头一致性。
    { column: "visual_lock", field: "visualLock", kind: "text", nullable: true },
  ],
};

export const characterMapping: TableMapping = {
  table: "characters",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "name", field: "name", kind: "text" },
    { column: "role_type", field: "roleType", kind: "text", nullable: true },
    { column: "gender_presentation", field: "genderPresentation", kind: "text", nullable: true },
    { column: "age_range", field: "ageRange", kind: "text", nullable: true },
    { column: "identity_summary", field: "identitySummary", kind: "text", nullable: true },
    { column: "personality", field: "personality", kind: "text", nullable: true },
    { column: "motivation", field: "motivation", kind: "text", nullable: true },
    { column: "taboos", field: "taboos", kind: "text", nullable: true },
    { column: "speech_style", field: "speechStyle", kind: "text", nullable: true },
    { column: "status", field: "status", kind: "text" },
    // 视觉锁：0004 migration 引入。
    { column: "visual_lock", field: "visualLock", kind: "text", nullable: true },
  ],
};

export const characterLookMapping: TableMapping = {
  table: "character_looks",
  columns: [
    { column: "character_id", field: "characterId", kind: "text" },
    { column: "look_group_id", field: "lookGroupId", kind: "text" },
    { column: "previous_look_id", field: "previousLookId", kind: "text", nullable: true },
    { column: "version_no", field: "versionNo", kind: "int" },
    { column: "look_name", field: "lookName", kind: "text" },
    { column: "look_type", field: "lookType", kind: "text", nullable: true },
    { column: "appearance_spec_json", field: "appearanceSpec", kind: "json" },
    { column: "hair_spec_json", field: "hairSpec", kind: "json" },
    { column: "makeup_spec_json", field: "makeupSpec", kind: "json" },
    { column: "wardrobe_spec_json", field: "wardrobeSpec", kind: "json" },
    { column: "props_spec_json", field: "propsSpec", kind: "json" },
    { column: "continuity_rules_json", field: "continuityRules", kind: "json" },
    { column: "status", field: "status", kind: "text" },
    { column: "is_current", field: "isCurrent", kind: "bool" },
    { column: "is_default", field: "isDefault", kind: "bool" },
    { column: "created_by", field: "createdBy", kind: "text", nullable: true },
    { column: "change_summary", field: "changeSummary", kind: "text", nullable: true },
  ],
};

export const propMapping: TableMapping = {
  table: "props",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "name", field: "name", kind: "text" },
    { column: "prop_type", field: "propType", kind: "text", nullable: true },
    { column: "visual_spec_json", field: "visualSpec", kind: "json" },
    { column: "ownership_json", field: "ownership", kind: "json" },
    { column: "continuity_rules_json", field: "continuityRules", kind: "json" },
    { column: "status", field: "status", kind: "text" },
    // 视觉锁：0004 migration 引入。
    { column: "visual_lock", field: "visualLock", kind: "text", nullable: true },
  ],
};

export const styleGuideMapping: TableMapping = {
  table: "style_guides",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "visual_style", field: "visualStyle", kind: "text", nullable: true },
    { column: "camera_style", field: "cameraStyle", kind: "text", nullable: true },
    { column: "color_script_json", field: "colorScript", kind: "json" },
    { column: "forbidden_patterns_json", field: "forbiddenPatterns", kind: "json" },
    { column: "reference_notes_json", field: "referenceNotes", kind: "json" },
  ],
};

export const sceneMapping: TableMapping = {
  table: "scenes",
  columns: [
    { column: "episode_id", field: "episodeId", kind: "text" },
    { column: "scene_no", field: "sceneNo", kind: "int" },
    { column: "title", field: "title", kind: "text", nullable: true },
    { column: "location_id", field: "locationId", kind: "text", nullable: true },
    { column: "time_of_day", field: "timeOfDay", kind: "text", nullable: true },
    { column: "summary", field: "summary", kind: "text", nullable: true },
    { column: "dramatic_goal", field: "dramaticGoal", kind: "text", nullable: true },
    { column: "scene_conflict", field: "conflict", kind: "text", nullable: true },
    { column: "scene_tags_json", field: "sceneTags", kind: "stringArray" },
    { column: "entry_state_json", field: "entryState", kind: "json" },
    { column: "exit_state_json", field: "exitState", kind: "json" },
    { column: "storyboard_status", field: "storyboardStatus", kind: "text" },
    { column: "sort_order", field: "sortOrder", kind: "int" },
  ],
};

export const shotMapping: TableMapping = {
  table: "shots",
  columns: [
    { column: "scene_id", field: "sceneId", kind: "text" },
    { column: "shot_no", field: "shotNo", kind: "int" },
    { column: "shot_type", field: "shotType", kind: "text", nullable: true },
    { column: "intent", field: "intent", kind: "text", nullable: true },
    { column: "camera_plan_json", field: "cameraPlan", kind: "json" },
    { column: "performance_notes", field: "performanceNotes", kind: "text", nullable: true },
    { column: "start_state_json", field: "startState", kind: "json" },
    { column: "end_state_json", field: "endState", kind: "json" },
    { column: "handoff_anchor_json", field: "handoffAnchor", kind: "json" },
    { column: "is_key_shot", field: "isKeyShot", kind: "bool" },
    { column: "duration_sec", field: "durationSec", kind: "real", nullable: true },
    { column: "dialogue", field: "dialogue", kind: "text", nullable: true },
    { column: "action", field: "action", kind: "text", nullable: true },
    { column: "sort_order", field: "sortOrder", kind: "int" },
  ],
};

export const keyframeSpecMapping: TableMapping = {
  table: "keyframe_specs",
  columns: [
    { column: "shot_id", field: "shotId", kind: "text" },
    { column: "frame_type", field: "frameType", kind: "text" },
    { column: "composition_json", field: "composition", kind: "json" },
    { column: "subject_layout_json", field: "subjectLayout", kind: "json" },
    { column: "expression_pose_json", field: "expressionPose", kind: "json" },
    { column: "background_requirement_json", field: "backgroundRequirement", kind: "json" },
    { column: "continuity_anchor_json", field: "continuityAnchor", kind: "json" },
    { column: "prompt_summary", field: "promptSummary", kind: "text", nullable: true },
    { column: "status", field: "status", kind: "text" },
  ],
};

export const continuityAnchorMapping: TableMapping = {
  table: "continuity_anchors",
  columns: [
    { column: "shot_id", field: "shotId", kind: "text" },
    { column: "anchor_type", field: "anchorType", kind: "text" },
    { column: "source_shot_id", field: "sourceShotId", kind: "text", nullable: true },
    { column: "anchor_payload_json", field: "anchorPayload", kind: "json" },
    { column: "strength", field: "strength", kind: "text" },
    { column: "status", field: "status", kind: "text" },
  ],
};

export const dialogueBlockMapping: TableMapping = {
  table: "scene_dialogue_blocks",
  columns: [
    { column: "scene_id", field: "sceneId", kind: "text" },
    { column: "speaker_character_id", field: "speakerCharacterId", kind: "text", nullable: true },
    { column: "text", field: "text", kind: "text" },
    { column: "emotion", field: "emotion", kind: "text", nullable: true },
    { column: "delivery_note", field: "deliveryNote", kind: "text", nullable: true },
    { column: "sort_order", field: "sortOrder", kind: "int" },
  ],
};

export const actionBlockMapping: TableMapping = {
  table: "scene_action_blocks",
  columns: [
    { column: "scene_id", field: "sceneId", kind: "text" },
    { column: "action_text", field: "actionText", kind: "text" },
    { column: "actor_refs_json", field: "actorRefs", kind: "stringArray" },
    { column: "prop_refs_json", field: "propRefs", kind: "stringArray" },
    { column: "sort_order", field: "sortOrder", kind: "int" },
  ],
};

export const modelProfileMapping: TableMapping = {
  table: "model_profiles",
  columns: [
    { column: "provider", field: "provider", kind: "text" },
    { column: "model_type", field: "modelType", kind: "text" },
    { column: "model_name", field: "modelName", kind: "text" },
    { column: "endpoint_key", field: "endpointKey", kind: "text", nullable: true },
    { column: "default_params_json", field: "defaultParams", kind: "json" },
    { column: "is_active", field: "isActive", kind: "bool" },
  ],
};

export const promptSpecMapping: TableMapping = {
  table: "prompt_specs",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "scene_id", field: "sceneId", kind: "text", nullable: true },
    { column: "shot_id", field: "shotId", kind: "text", nullable: true },
    { column: "keyframe_id", field: "keyframeId", kind: "text", nullable: true },
    { column: "target_type", field: "targetType", kind: "text" },
    { column: "source_entity_type", field: "sourceEntityType", kind: "text" },
    { column: "source_entity_id", field: "sourceEntityId", kind: "text" },
    { column: "compiled_prompt", field: "compiledPrompt", kind: "text" },
    { column: "sections_json", field: "sections", kind: "jsonArray" },
    { column: "negative_prompt", field: "negativePrompt", kind: "text", nullable: true },
    { column: "model_profile_id", field: "modelProfileId", kind: "text", nullable: true },
    { column: "compiler_version", field: "compilerVersion", kind: "text" },
    { column: "source_version_snapshot_json", field: "sourceVersionSnapshot", kind: "json" },
    { column: "status", field: "status", kind: "text" },
    { column: "superseded_by", field: "supersededBy", kind: "text", nullable: true },
  ],
};

export const generationTaskMapping: TableMapping = {
  table: "generation_tasks",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "task_type", field: "taskType", kind: "text" },
    { column: "source_entity_type", field: "sourceEntityType", kind: "text" },
    { column: "source_entity_id", field: "sourceEntityId", kind: "text" },
    { column: "prompt_spec_id", field: "promptSpecId", kind: "text", nullable: true },
    { column: "model_profile_id", field: "modelProfileId", kind: "text", nullable: true },
    { column: "status", field: "status", kind: "text" },
    { column: "priority", field: "priority", kind: "int" },
    { column: "retry_count", field: "retryCount", kind: "int" },
    { column: "retry_of_task_id", field: "retryOfTaskId", kind: "text", nullable: true },
    { column: "input_payload_json", field: "inputPayload", kind: "json" },
    { column: "output_payload_json", field: "outputPayload", kind: "json" },
    { column: "usage_json", field: "usage", kind: "json" },
    { column: "cost_estimate", field: "costEstimate", kind: "real", nullable: true },
    { column: "error_message", field: "errorMessage", kind: "text", nullable: true },
    { column: "error_code", field: "errorCode", kind: "text", nullable: true },
    { column: "started_at", field: "startedAt", kind: "text", nullable: true },
    { column: "finished_at", field: "finishedAt", kind: "text", nullable: true },
    { column: "duration_ms", field: "durationMs", kind: "int", nullable: true },
  ],
};

export const artifactMapping: TableMapping = {
  table: "artifacts",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "artifact_type", field: "artifactType", kind: "text" },
    { column: "source_task_id", field: "sourceTaskId", kind: "text", nullable: true },
    { column: "source_entity_type", field: "sourceEntityType", kind: "text" },
    { column: "source_entity_id", field: "sourceEntityId", kind: "text" },
    { column: "file_path", field: "filePath", kind: "text" },
    { column: "preview_path", field: "previewPath", kind: "text", nullable: true },
    { column: "metadata_json", field: "metadata", kind: "json" },
    { column: "status", field: "status", kind: "text" },
    { column: "reference_state", field: "referenceState", kind: "text", nullable: true },
  ],
};

export const reviewRunMapping: TableMapping = {
  table: "review_runs",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "scope_type", field: "scopeType", kind: "text" },
    { column: "scope_ref_id", field: "scopeRefId", kind: "text" },
    { column: "review_types_json", field: "reviewTypes", kind: "stringArray" },
    { column: "run_mode", field: "runMode", kind: "text" },
    { column: "status", field: "status", kind: "text" },
    { column: "verdict", field: "verdict", kind: "text", nullable: true },
    { column: "quality_scores_json", field: "qualityScores", kind: "json" },
    { column: "started_at", field: "startedAt", kind: "text", nullable: true },
    { column: "finished_at", field: "finishedAt", kind: "text", nullable: true },
  ],
};

export const reviewIssueMapping: TableMapping = {
  table: "review_issues",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "review_run_id", field: "reviewRunId", kind: "text", nullable: true },
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "scene_id", field: "sceneId", kind: "text", nullable: true },
    { column: "shot_id", field: "shotId", kind: "text", nullable: true },
    { column: "prompt_spec_id", field: "promptSpecId", kind: "text", nullable: true },
    { column: "artifact_id", field: "artifactId", kind: "text", nullable: true },
    { column: "issue_type", field: "issueType", kind: "text" },
    { column: "severity", field: "severity", kind: "text" },
    { column: "rule_tier", field: "ruleTier", kind: "text", nullable: true },
    { column: "rule_code", field: "ruleCode", kind: "text", nullable: true },
    { column: "evidence_json", field: "evidence", kind: "json" },
    { column: "source_version", field: "sourceVersion", kind: "text", nullable: true },
    { column: "title", field: "title", kind: "text" },
    { column: "description", field: "description", kind: "text", nullable: true },
    { column: "suggestion", field: "suggestion", kind: "text", nullable: true },
    { column: "resolution_note", field: "resolutionNote", kind: "text", nullable: true },
    { column: "ignore_reason", field: "ignoreReason", kind: "text", nullable: true },
    { column: "status", field: "status", kind: "text" },
  ],
};

export const exportBundleMapping: TableMapping = {
  table: "export_bundles",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "bundle_type", field: "bundleType", kind: "text" },
    { column: "version", field: "version", kind: "text" },
    { column: "version_label", field: "versionLabel", kind: "text", nullable: true },
    { column: "scope_type", field: "scopeType", kind: "text", nullable: true },
    { column: "scope_ref_id", field: "scopeRefId", kind: "text", nullable: true },
    { column: "output_path", field: "outputPath", kind: "text" },
    { column: "manifest_json", field: "manifest", kind: "json" },
    { column: "bundle_size_bytes", field: "bundleSizeBytes", kind: "int", nullable: true },
    { column: "compose_task_id", field: "composeTaskId", kind: "text", nullable: true },
    { column: "error_message", field: "errorMessage", kind: "text", nullable: true },
    { column: "status", field: "status", kind: "text" },
    { column: "finished_at", field: "finishedAt", kind: "text", nullable: true },
  ],
};

export const scriptSnapshotMapping: TableMapping = {
  table: "script_snapshots",
  columns: [
    { column: "episode_id", field: "episodeId", kind: "text" },
    { column: "version_label", field: "versionLabel", kind: "text" },
    { column: "created_by", field: "createdBy", kind: "text", nullable: true },
    { column: "change_summary", field: "changeSummary", kind: "text", nullable: true },
    { column: "snapshot_payload_json", field: "snapshotPayload", kind: "json" },
  ],
};

// ===== A1 scope 扩展 =====

export const continuityLockMapping: TableMapping = {
  table: "continuity_locks",
  columns: [
    { column: "project_id", field: "projectId", kind: "text" },
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "scope", field: "scope", kind: "text" },
    { column: "lock_phrase", field: "lockPhrase", kind: "text" },
    { column: "applies_to_json", field: "appliesTo", kind: "json" },
    { column: "status", field: "status", kind: "text" },
  ],
};

export const imageAssetMapping: TableMapping = {
  table: "image_assets",
  columns: [
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "scene_id", field: "sceneId", kind: "text", nullable: true },
    { column: "shot_id", field: "shotId", kind: "text", nullable: true },
    { column: "keyframe_id", field: "keyframeId", kind: "text", nullable: true },
    // 资产图挂载点（0005 migration）：角色 portrait / 场景 concept / 道具 concept
    { column: "character_id", field: "characterId", kind: "text", nullable: true },
    { column: "location_id", field: "locationId", kind: "text", nullable: true },
    { column: "prop_id", field: "propId", kind: "text", nullable: true },
    { column: "provider", field: "provider", kind: "text" },
    { column: "model_id", field: "modelId", kind: "text" },
    { column: "prompt_positive", field: "promptPositive", kind: "text" },
    {
      column: "prompt_positive_zh",
      field: "promptPositiveZh",
      kind: "text",
      nullable: true,
    },
    { column: "size_preset", field: "sizePreset", kind: "text" },
    { column: "seed", field: "seed", kind: "int", nullable: true },
    { column: "base64", field: "base64", kind: "text" },
    { column: "mime_type", field: "mimeType", kind: "text" },
    { column: "raw_response_json", field: "rawResponse", kind: "json" },
    // 0006 migration：生成状态 / 失败原因 / 重试链路 / 过期原因
    { column: "status", field: "status", kind: "text" },
    { column: "error_message", field: "errorMessage", kind: "text", nullable: true },
    { column: "attempt_count", field: "attemptCount", kind: "int" },
    { column: "retry_of_id", field: "retryOfId", kind: "text", nullable: true },
    { column: "stale_reason", field: "staleReason", kind: "text", nullable: true },
  ],
};

// ===== Round-4 Phase-C：video_assets (0008 migration) =====
export const videoAssetMapping: TableMapping = {
  table: "video_assets",
  columns: [
    { column: "episode_id", field: "episodeId", kind: "text", nullable: true },
    { column: "scene_id", field: "sceneId", kind: "text", nullable: true },
    { column: "shot_id", field: "shotId", kind: "text", nullable: true },
    {
      column: "first_frame_image_id",
      field: "firstFrameImageId",
      kind: "text",
      nullable: true,
    },
    { column: "provider", field: "provider", kind: "text" },
    { column: "model_id", field: "modelId", kind: "text" },
    { column: "prompt", field: "prompt", kind: "text" },
    { column: "prompt_zh", field: "promptZh", kind: "text", nullable: true },
    { column: "resolution", field: "resolution", kind: "text" },
    { column: "ratio", field: "ratio", kind: "text" },
    { column: "duration_sec", field: "durationSec", kind: "int" },
    { column: "duration_source", field: "durationSource", kind: "text", nullable: true },
    { column: "duration_dialogue_chars", field: "durationDialogueChars", kind: "int" },
    { column: "duration_action_chars", field: "durationActionChars", kind: "int" },
    { column: "is_i2v", field: "isI2V", kind: "bool" },
    { column: "video_url", field: "videoUrl", kind: "text" },
    { column: "last_frame_url", field: "lastFrameUrl", kind: "text", nullable: true },
    { column: "task_id", field: "taskId", kind: "text", nullable: true },
    { column: "raw_response_json", field: "rawResponse", kind: "json" },
    { column: "status", field: "status", kind: "text" },
    { column: "error_message", field: "errorMessage", kind: "text", nullable: true },
    { column: "attempt_count", field: "attemptCount", kind: "int" },
    { column: "retry_of_id", field: "retryOfId", kind: "text", nullable: true },
    { column: "stale_reason", field: "staleReason", kind: "text", nullable: true },
  ],
};
