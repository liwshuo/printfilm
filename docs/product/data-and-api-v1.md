# DramaFlow Studio Data and API v1.0

## 1. 文档目标

本文档定义：

- V1 的核心数据模型
- SQLite 表结构草案
- TypeScript 领域类型草案
- HTTP API 路由清单

目标是为后续实现以下模块提供统一 contract：

- domain schema
- repository
- prompt compiler
- job orchestrator
- review service

## 2. 数据设计原则

- `单一真相源`
  - 故事、设定、分镜分别只有一套 canonical 数据
- `事实层与执行层分离`
  - prompt、任务、产物、日志不允许污染故事事实
- `局部可重跑`
  - 任务与产物必须能挂到 shot / scene / episode 上
- `未来可迁移`
  - SQLite 结构尽量兼容后续切换到 Postgres

### 2.1 参考来源边界

- 本文档中的数据模型和 API 不是直接从任何单一外部项目复制而来。
- 它们分别吸收了以下来源的抽象：
  - `drama-skills`
    - 真相源分层与 creator-first 阶段结构
  - `short-drama`
    - 故事规则与审查挂载点
  - `CineGen-ShortDrama`
    - scene / shot / keyframe / continuity 的主链路
  - `huobao-drama`
    - adapter、任务、产物、导出的执行链思路
  - `trae_projects`
    - model profile 与 adapter 风格的调用组织方式
- 采用策略是：
  - 借 contract
  - 借边界
  - 借命名语义
  - 不复制其历史数据结构和兼容包袱

## 3. 数据模型总览

### 3.1 项目与故事层

- `projects`
- `project_story_bibles`
- `episodes`

### 3.2 资产与设定层

- `characters`
- `character_looks`
- `locations`
- `props`
- `style_guides`

### 3.3 分镜与关键帧层

- `scenes`
- `shots`
- `scene_characters`
- `shot_characters`
- `shot_props`
- `scene_dialogue_blocks`
- `scene_action_blocks`
- `keyframe_specs`
- `continuity_anchors`

### 3.4 执行层

- `model_profiles`
- `prompt_specs`
- `generation_tasks`
- `task_logs`
- `artifacts`

### 3.5 审查与导出层

- `review_runs`
- `review_issues`
- `review_issue_events`
- `export_bundles`
- `script_snapshots`
- `activity_events`

### 3.6 系统 / 元数据层

- `schema_migrations`（迁移版本记录，见 adr-005 §4.2）

## 4. 关键关系

```text
projects
  -> episodes
    -> scenes
      -> shots
        -> keyframe_specs
        -> prompt_specs
        -> generation_tasks
        -> artifacts

projects
  -> characters
    -> character_looks

projects
  -> locations
  -> props

review_issues
  -> project / episode / scene / shot
```

## 5. SQLite 表结构

```sql
PRAGMA foreign_keys = ON;

-- 迁移元数据表（adr-005 §4.2）：记录已应用的 migration 版本，启动时按序执行未应用项
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,           -- 递增版本号，如 '0001_init'
  applied_at TEXT NOT NULL,           -- 应用时间（ISO8601）
  checksum TEXT NOT NULL              -- migration 文件校验和，防止历史文件被篡改
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  genre TEXT,
  audience TEXT,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  target_duration_sec INTEGER,
  episode_count INTEGER DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'zh-CN',
  output_spec_json TEXT NOT NULL DEFAULT '{}',
  model_policy_json TEXT NOT NULL DEFAULT '{}',
  creative_constraints_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- output_spec_json：Project Setup 输出规格落库（分辨率 / 帧率 / 目标时长 / 字幕与配音策略）
-- model_policy_json：默认模型策略落库（image / video / tts 的默认 provider 与档位偏好）
-- creative_constraints_json：创作约束落库（题材红线 / 风格禁忌 / 内容边界）
CREATE TABLE IF NOT EXISTS project_story_bibles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  logline TEXT,
  theme TEXT,
  tone TEXT,
  world_rules_json TEXT NOT NULL DEFAULT '{}',
  hook_system_json TEXT NOT NULL DEFAULT '{}',
  pacing_plan_json TEXT NOT NULL DEFAULT '{}',
  villain_system_json TEXT NOT NULL DEFAULT '{}',
  character_relations_json TEXT NOT NULL DEFAULT '{}',
  source_ref_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_no INTEGER NOT NULL,
  title TEXT,
  summary TEXT,
  hook_type TEXT,
  episode_goal TEXT,
  episode_conflict TEXT,
  episode_turn TEXT,
  episode_ending_hook TEXT,
  story_status TEXT NOT NULL DEFAULT 'draft',
  script_status TEXT NOT NULL DEFAULT 'draft',
  -- Rollup summary only. Canonical storyboard confirmation is scene-level.
  storyboard_status TEXT NOT NULL DEFAULT 'draft',
  production_status TEXT NOT NULL DEFAULT 'idle',
  review_status TEXT NOT NULL DEFAULT 'pending',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, episode_no),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  location_type TEXT,
  visual_spec_json TEXT NOT NULL DEFAULT '{}',
  space_rules_json TEXT NOT NULL DEFAULT '{}',
  lighting_rules_json TEXT NOT NULL DEFAULT '{}',
  continuity_rules_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role_type TEXT,
  gender_presentation TEXT,
  age_range TEXT,
  identity_summary TEXT,
  personality TEXT,
  motivation TEXT,
  taboos TEXT,
  speech_style TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_looks (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  look_group_id TEXT NOT NULL,
  previous_look_id TEXT,
  version_no INTEGER NOT NULL DEFAULT 1,
  look_name TEXT NOT NULL,
  look_type TEXT,
  appearance_spec_json TEXT NOT NULL DEFAULT '{}',
  hair_spec_json TEXT NOT NULL DEFAULT '{}',
  makeup_spec_json TEXT NOT NULL DEFAULT '{}',
  wardrobe_spec_json TEXT NOT NULL DEFAULT '{}',
  props_spec_json TEXT NOT NULL DEFAULT '{}',
  continuity_rules_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  is_current INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  change_summary TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_look_id) REFERENCES character_looks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS props (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prop_type TEXT,
  visual_spec_json TEXT NOT NULL DEFAULT '{}',
  ownership_json TEXT NOT NULL DEFAULT '{}',
  continuity_rules_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS style_guides (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  visual_style TEXT,
  camera_style TEXT,
  color_script_json TEXT NOT NULL DEFAULT '{}',
  forbidden_patterns_json TEXT NOT NULL DEFAULT '{}',
  reference_notes_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  scene_no INTEGER NOT NULL,
  title TEXT,
  location_id TEXT,
  time_of_day TEXT,
  summary TEXT,
  dramatic_goal TEXT,
  scene_conflict TEXT,
  scene_tags_json TEXT NOT NULL DEFAULT '[]',
  entry_state_json TEXT NOT NULL DEFAULT '{}',
  exit_state_json TEXT NOT NULL DEFAULT '{}',
  storyboard_status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(episode_id, scene_no),
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  shot_no INTEGER NOT NULL,
  shot_type TEXT,
  intent TEXT,
  camera_plan_json TEXT NOT NULL DEFAULT '{}',
  performance_notes TEXT,
  start_state_json TEXT NOT NULL DEFAULT '{}',
  end_state_json TEXT NOT NULL DEFAULT '{}',
  handoff_anchor_json TEXT NOT NULL DEFAULT '{}',
  is_key_shot INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL,
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scene_id, shot_no),
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_characters (
  scene_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  look_id TEXT,
  presence_type TEXT NOT NULL DEFAULT 'present',
  PRIMARY KEY (scene_id, character_id),
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (look_id) REFERENCES character_looks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shot_characters (
  shot_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  look_id TEXT,
  blocking_note TEXT,
  PRIMARY KEY (shot_id, character_id),
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (look_id) REFERENCES character_looks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shot_props (
  shot_id TEXT NOT NULL,
  prop_id TEXT NOT NULL,
  state_note TEXT,
  PRIMARY KEY (shot_id, prop_id),
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
  FOREIGN KEY (prop_id) REFERENCES props(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_dialogue_blocks (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  speaker_character_id TEXT,
  text TEXT NOT NULL,
  emotion TEXT,
  delivery_note TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
  FOREIGN KEY (speaker_character_id) REFERENCES characters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scene_action_blocks (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  action_text TEXT NOT NULL,
  actor_refs_json TEXT NOT NULL DEFAULT '[]',
  prop_refs_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS keyframe_specs (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL,
  frame_type TEXT NOT NULL,
  composition_json TEXT NOT NULL DEFAULT '{}',
  subject_layout_json TEXT NOT NULL DEFAULT '{}',
  expression_pose_json TEXT NOT NULL DEFAULT '{}',
  background_requirement_json TEXT NOT NULL DEFAULT '{}',
  continuity_anchor_json TEXT NOT NULL DEFAULT '{}',
  prompt_summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS continuity_anchors (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL,
  anchor_type TEXT NOT NULL,
  source_shot_id TEXT,
  anchor_payload_json TEXT NOT NULL DEFAULT '{}',
  strength TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
  FOREIGN KEY (source_shot_id) REFERENCES shots(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_type TEXT NOT NULL,
  model_name TEXT NOT NULL,
  -- Stores credential reference key only. Raw secrets are stored in OS keychain.
  endpoint_key TEXT,
  default_params_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_specs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  keyframe_id TEXT,
  target_type TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  compiled_prompt TEXT NOT NULL,
  sections_json TEXT NOT NULL DEFAULT '[]',
  negative_prompt TEXT,
  model_profile_id TEXT,
  compiler_version TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source_version_snapshot_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  superseded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL,
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE SET NULL,
  FOREIGN KEY (keyframe_id) REFERENCES keyframe_specs(id) ON DELETE SET NULL,
  FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (superseded_by) REFERENCES prompt_specs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  prompt_spec_id TEXT,
  model_profile_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 100,
  retry_count INTEGER NOT NULL DEFAULT 0,
  retry_of_task_id TEXT,
  input_payload_json TEXT NOT NULL DEFAULT '{}',
  output_payload_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{}',
  cost_estimate REAL,
  error_message TEXT,
  error_code TEXT,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (prompt_spec_id) REFERENCES prompt_specs(id) ON DELETE SET NULL,
  FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (retry_of_task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  source_task_id TEXT,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  preview_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (source_task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS review_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_ref_id TEXT NOT NULL,
  review_types_json TEXT NOT NULL DEFAULT '[]',
  run_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- run 执行生命周期：queued|running|succeeded|failed（failed=运行自身异常终止）
  verdict TEXT,                            -- run 审查结论，仅 status=succeeded 时有效：passed|blocked（blocked=存在 high/critical open issue）
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  review_run_id TEXT,
  episode_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  prompt_spec_id TEXT,
  artifact_id TEXT,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  rule_code TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  source_version TEXT,
  title TEXT NOT NULL,
  description TEXT,
  suggestion TEXT,
  resolution_note TEXT,
  ignore_reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (review_run_id) REFERENCES review_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL,
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE SET NULL,
  FOREIGN KEY (prompt_spec_id) REFERENCES prompt_specs(id) ON DELETE SET NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS export_bundles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  bundle_type TEXT NOT NULL,
  version TEXT NOT NULL,
  version_label TEXT,
  scope_type TEXT,
  scope_ref_id TEXT,
  output_path TEXT NOT NULL,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  bundle_size_bytes INTEGER,
  compose_task_id TEXT,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (compose_task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL
);

-- compose_task_id：关联的 compose_export 任务（见 adr-006 §5）；export_bundle.status 由该任务状态驱动：
--   task queued/running → queued/running；succeeded → ready；failed/cancelled → failed
CREATE TABLE IF NOT EXISTS review_issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  changed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES review_issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS script_snapshots (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  version_label TEXT NOT NULL,
  created_by TEXT,
  change_summary TEXT,
  snapshot_payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor TEXT,
  target_ref_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_episodes_project_id ON episodes(project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_episode_id ON scenes(episode_id);
CREATE INDEX IF NOT EXISTS idx_shots_scene_id ON shots(scene_id);
CREATE INDEX IF NOT EXISTS idx_character_looks_character_id ON character_looks(character_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_looks_group_version_unique
ON character_looks(look_group_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_looks_default_current_unique
ON character_looks(character_id)
WHERE is_default = 1 AND is_current = 1;
CREATE INDEX IF NOT EXISTS idx_prompt_specs_source ON prompt_specs(source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_generation_tasks_project_status ON generation_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_generation_tasks_prompt_spec_id ON generation_tasks(prompt_spec_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_source_task_id ON artifacts(source_task_id);
CREATE INDEX IF NOT EXISTS idx_keyframe_specs_shot_id ON keyframe_specs(shot_id);
CREATE INDEX IF NOT EXISTS idx_continuity_anchors_shot_id ON continuity_anchors(shot_id);
CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_review_runs_project_id ON review_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_review_issues_project_id ON review_issues(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_project_id ON activity_events(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_specs_confirmed_unique
ON prompt_specs(source_entity_type, source_entity_id, target_type)
WHERE status = 'confirmed';
```

## 6. TypeScript 核心类型

```ts
export type Id = string;
export type IsoTime = string;

export type ProjectStatus = "draft" | "active" | "archived";
export type ConfirmStatus = "draft" | "confirmed";
// 对象级审查结论（用于 Episode.reviewStatus / episodes.review_status 等被审查对象）
// pending=尚无已完成结论；passed=最近覆盖它的已完成 run 无阻塞项；failed=存在阻塞项
export type ReviewStatus = "pending" | "passed" | "failed";
// review run 执行生命周期（review_runs.status）；failed=运行自身异常终止，与"有阻塞项"无关
export type ReviewRunStatus = "queued" | "running" | "succeeded" | "failed";
// review run 审查结论（review_runs.verdict），仅当 status=succeeded 时有意义
// passed=无 high/critical open issue；blocked=存在阻塞项
export type ReviewRunVerdict = "passed" | "blocked";
export type ProductionStatus = "idle" | "queued" | "running" | "partial" | "done" | "failed";
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
// prompt 目标类型；text 覆盖 LLM 文本生成任务（story_generate / prompt_compile 的产物 prompt）
export type PromptTargetType = "text" | "image" | "video" | "tts";
export type ArtifactType = "image" | "video" | "audio" | "subtitle" | "bundle";

export interface BaseEntity {
  id: Id;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}

export interface AppendOnlyEntity {
  id: Id;
  createdAt: IsoTime;
}

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

// ===== ProjectStoryBible JSON 字段的规范类型（消除黑盒）=====
// 字段语义与页面落库映射见 story-workspace-spec-v1.md §8.1~§8.4；此处为唯一权威 TS 结构。
export interface WorldRulesJson {         // → project_story_bibles.world_rules_json
  setting?: string;                        // 世界观/时代背景一句话
  rules?: Array<{ label: string; detail?: string }>;  // 世界规则/设定条目
  taboos?: string[];                       // 世界内禁忌/红线
  keyLocationRefs?: Id[];                   // 关联 locations.id
}

export interface CharacterRelationsJson { // → project_story_bibles.character_relations_json
  mainCharacter?: {
    characterRef?: Id; name?: string;
    goal?: string; want?: string; need?: string;
  };
  mainConflict?: {
    axis: string; protagonistSide?: string; antagonistSide?: string; stake?: string;
  };
  relationshipMap?: Array<{
    fromRef?: Id; toRef?: Id; fromName?: string; toName?: string;
    relationType: string; note?: string;
  }>;
  motivationChain?: Array<{
    characterRef?: Id; trigger: string; motivation: string; action: string; order: number;
  }>;
  characterRelations?: string;             // 自由补充说明
}

export interface VillainSystemJson {      // → project_story_bibles.villain_system_json
  villains?: Array<{
    characterRef?: Id; name?: string; goal?: string; method?: string; pressureCurve?: string;
  }>;
}

export interface PacingPlanJson {         // → project_story_bibles.pacing_plan_json
  overallCurve?: string;
  beatsPerEpisode?: number;
  segments?: Array<{ label: string; targetPaceSec?: number; note?: string }>;
}

export interface HookSystemJson {         // → project_story_bibles.hook_system_json（含 cliffhangerPlan 子字段）
  hooks?: Array<{
    episodeRef?: Id; hookType: string;
    placement: "cold_open" | "mid" | "ending"; description: string;
  }>;
  cliffhangerPlan?: Array<{
    episodeRef?: Id; setup: string; payoffEpisodeRef?: Id;
    intensity?: "low" | "medium" | "high";
  }>;
}

export interface StoryBibleSourceRef {    // → project_story_bibles.source_ref（bible 来源溯源）
  origin: "manual" | "generated" | "imported";
  sourceTaskId?: Id;                        // origin=generated 时关联的 story_generate 任务
  importedFrom?: string;                    // origin=imported 时的来源标识
  generatedAt?: IsoTime;
}

export interface Project extends BaseEntity {
  name: string;
  slug: string;
  status: ProjectStatus;
  genre?: string;
  audience?: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetDurationSec?: number;
  episodeCount: number;
  language: string;
  // Project Setup 落库字段（见 data 表 projects.*_json），落库为 JSON，读出为结构化对象
  outputSpec: ProjectOutputSpec;
  modelPolicy: ProjectModelPolicy;
  creativeConstraints: ProjectCreativeConstraints;
  version: number;
}

export interface ProjectStoryBible extends BaseEntity {
  projectId: Id;
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
  storyStatus: ConfirmStatus;
  scriptStatus: ConfirmStatus;
  storyboardStatus: ConfirmStatus | "partial";
  productionStatus: ProductionStatus;
  reviewStatus: ReviewStatus;
  version: number;
}

export interface Character extends BaseEntity {
  projectId: Id;
  name: string;
  roleType?: string;
  genderPresentation?: string;
  ageRange?: string;
  identitySummary?: string;
  personality?: string;
  motivation?: string;
  taboos?: string;
  speechStyle?: string;
  status: "active" | "disabled";
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
  status: "active" | "disabled";
  isCurrent: boolean;
  isDefault: boolean;
  createdBy?: string;
  changeSummary?: string;
  version: number;
}

export interface Location extends BaseEntity {
  projectId: Id;
  name: string;
  locationType?: string;
  visualSpec: Record<string, unknown>;
  spaceRules: Record<string, unknown>;
  lightingRules: Record<string, unknown>;
  continuityRules: Record<string, unknown>;
  status: "active" | "disabled";
  version: number;
}

export interface Prop extends BaseEntity {
  projectId: Id;
  name: string;
  propType?: string;
  visualSpec: Record<string, unknown>;
  ownership: Record<string, unknown>;
  continuityRules: Record<string, unknown>;
  status: "active" | "disabled";
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
  version: number;
  sortOrder: number;
}

export interface KeyframeSpec extends BaseEntity {
  shotId: Id;
  frameType: "start" | "end" | "key";
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
  strength: "low" | "medium" | "high";
  status: "active" | "disabled";
}

export interface PromptSection {
  key: string;           // 段落标识，如 subject / style / camera / negative / continuity
  label: string;         // 面向用户的段落标题
  content: string;       // 该段落编译后的文本
  sourceRefs: Array<{ entityType: string; entityId: Id; version?: number }>;
}

export interface PromptSpec extends BaseEntity {
  projectId: Id;
  episodeId?: Id;
  sceneId?: Id;
  shotId?: Id;
  keyframeId?: Id;
  targetType: PromptTargetType;
  sourceEntityType: "character" | "location" | "scene" | "shot" | "episode" | "keyframe";
  sourceEntityId: Id;
  compiledPrompt: string;
  // 结构化编译输出：用于 Prompt Center 分段预览；compiledPrompt 是 sections 的拼接快照
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
  // Reference key only, not the raw secret.
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
  errorCode?: string;  // 失败时的标准错误码，取值对齐 adr-004 §4 必备错误码
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
  status: "ready" | "deleted" | "broken";
}

// review issue 的证据结构（消除黑盒）；由 review 引擎产出，Review Center §9.3 只读展示
export interface ReviewEvidence {
  locationLabel?: string;                  // 人类可读定位，如「第2集·场3·镜5」
  quote?: string;                          // 命中的原文/字段片段
  expected?: string;                       // 期望值/规则要求
  actual?: string;                         // 实际值
  refs?: Array<{ entityType: string; entityId: Id }>;  // 关联实体
  metrics?: Record<string, number>;        // 量化指标（如相似度、时长差）
}

export interface ReviewIssue extends BaseEntity {
  projectId: Id;
  reviewRunId?: Id;
  episodeId?: Id;
  sceneId?: Id;
  shotId?: Id;
  promptSpecId?: Id;
  artifactId?: Id;
  issueType: "story" | "asset" | "continuity" | "prompt" | "compliance";
  severity: "low" | "medium" | "high" | "critical";
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
  status: ReviewRunStatus;            // 执行生命周期
  verdict?: ReviewRunVerdict;         // 审查结论，仅 status=succeeded 时有值
  startedAt?: IsoTime;
  finishedAt?: IsoTime;
}

export interface ReviewIssueEvent extends BaseEntity {
  issueId: Id;
  action: "resolve" | "ignore" | "reopen";
  fromStatus?: ReviewIssueStatus;
  toStatus: ReviewIssueStatus;
  note?: string;
  changedBy?: string;
}

// 剧本快照 payload（集级全量结构，消除黑盒）；script-editor §10.2/§10.3 恢复语义按此覆盖
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

// 活动流事件的目标定位与附加载荷（消除黑盒）；Dashboard 活动流按此渲染并生成跳转
export interface ActivityTargetRef {
  entityType: "project" | "episode" | "scene" | "shot" | "asset" | "prompt" | "task" | "review_run" | "export_bundle";
  entityId: Id;
  label?: string;                          // 人类可读标题
}

export interface ActivityPayload {
  fromStatus?: string;                     // 状态变更类事件的前后态
  toStatus?: string;
  count?: number;                          // 批量事件的数量（如批量确认 N 集）
  extra?: Record<string, unknown>;         // eventType 私有扩展字段
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
  manifest: ExportManifest;  // 命名结构，权威见下方 ExportManifest（不再用 Record<string, unknown> 黑盒）
  bundleSizeBytes?: number;
  composeTaskId?: Id;  // 关联的 compose_export 任务；status 由该任务状态驱动（见 adr-006 §5）
  errorMessage?: string;
  status: "queued" | "running" | "ready" | "failed";
  finishedAt?: IsoTime;
}

// export_bundles.manifest 落库结构（export-center §15.3 的字段均为该结构投影，此处为唯一权威）
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
```

### 6.1 文件路径 Contract

- `Artifact.filePath` 与 `ExportBundle.outputPath` 一律存储为项目数据根目录下的相对路径，不存绝对路径
- 相对路径基准为本地工作目录下的项目数据区，例如 `data/projects/<projectId>/...`
- 本地服务在打开文件、生成下载流或返回预览地址时负责解析为绝对路径
- 读取 artifact / export 详情时必须先做文件存在性检查：
  - 文件存在：返回正常详情
  - 文件缺失：返回 `path_missing` 语义，并提示回到生产或导出流程重建

### 6.2 持久状态与派生状态约束

为避免页面状态和数据状态漂移，V1 统一采用以下规则：

- `持久状态`
  - 进入数据库与 TypeScript 核心类型
  - 必须可追溯、可重放
- `派生状态`
  - 在 UI 或 selector 层计算
  - 不直接落库

#### 持久状态

- `storyStatus`
  - `draft | confirmed`
- `scriptStatus`
  - `draft | confirmed`
- `Scene.storyboardStatus`
  - `draft | confirmed`
- `Episode.storyboardStatus`
  - `draft | partial | confirmed`
  - 仅作为场级确认状态的聚合展示字段，不作为主门禁来源
  - 聚合规则：
    - 全部场次 `draft` 时为 `draft`
    - 全部场次 `confirmed` 时为 `confirmed`
    - 其余混合情况为 `partial`
  - 更新时机：
    - `Scene.storyboardStatus` 确认或回退时，同事务重算
    - scene 新建、删除、复制后，同事务重算
- `PromptSpec.status`
  - `draft | confirmed | superseded`
- `ReviewIssue.status`
  - `open | resolved | ignored | reopened`

#### 派生状态

- `ready_for_script`
  - 由 `storyStatus=draft` 且故事完整性检查通过派生
- `ready_for_storyboard`
  - 由 `scriptStatus=draft` 且剧本结构检查通过派生
- `ready_for_review`
  - 由 `Scene.storyboardStatus=draft` 且分镜校验通过派生
- `blocked`
  - 由高优先级 review issue 或 continuity error 派生
- `not_compiled`
  - 由 source entity + target type 尚不存在 PromptSpec 派生

- `projectStoryStatus`（项目级故事状态，rollup，见 adr-006 §3）
  - `confirmed`：项目下存在 ≥1 集且全部集 `Episode.storyStatus=confirmed`
  - `partial`：部分集 `confirmed`
  - `draft`：无任何集 `confirmed`
  - 权威持久态在集级 `Episode.storyStatus`，本派生态不落库

- `shotProducible`（可生产 shot 门禁，见 adr-006 §4）
  - 某 shot 同时存在 `frameType=start` 与 `frameType=end` 的 `KeyframeSpec` 且均 `status=confirmed` 时为 `true`
  - `Scene.storyboardStatus=confirmed` 的前置校验之一 = 该场全部 shot 的 `shotProducible=true`

#### 派生规则：Dashboard 9 阶段

Dashboard 的 9 个阶段卡状态由 `GET /api/projects/:projectId/stage-status` 返回，每个阶段 `stageStatus ∈ { locked | in_progress | done | blocked }`，派生规则统一如下（不落库）：

| # | 阶段 | done 判定 | in_progress 判定 | blocked 判定 |
|---|------|-----------|------------------|--------------|
| 1 | Setup | `validate-setup` 通过且 Story Bible 已生成 | 项目已建但校验未过 | 校验失败 |
| 2 | Story Bible | Story Bible 全部必填段落完成 | 部分段落已填 | — |
| 3 | Episodes | `projectStoryStatus=confirmed` | `partial` | — |
| 4 | Script | 全部集 `scriptStatus=confirmed` | 部分集 `confirmed` | 存在阻塞 issue |
| 5 | Assets | 主要角色均有 `is_current` look 且校验通过 | 部分资产就绪 | continuity 高优 issue |
| 6 | Storyboard | 全部场 `Scene.storyboardStatus=confirmed` | 部分场 `confirmed` | 存在可生产 shot 未过 keyframe 门禁 |
| 7 | Prompt | 目标范围内 shot/scene 均有 `confirmed` PromptSpec | 部分已编译 | source 版本过期需重编译 |
| 8 | Production | 目标范围产物任务 `succeeded` 覆盖率=100% | 存在 `running/queued` | 存在 `failed` 且未重试 |
| 9 | Export | 存在 `status=ready` 的 export bundle | 存在 `queued/running` bundle | 最近一次 bundle `failed` |

- 上游阶段未 `done` 时，下游阶段展示为 `locked`。
- `blocked` 优先级高于 `in_progress`：任一阻塞条件命中即置 `blocked`。

页面规格若出现上述派生状态，必须明确标注为 `UI 派生态`，不得新增同名持久字段。

### 6.3 API 响应契约类型（消除"同一端点两套 schema"）

以下端点的响应结构以本节为唯一权威，模块 spec 不得另立不同字段的同名结构；模块 spec 只描述展示/交互，结构一律引用此处。

```ts
// POST /api/projects/:projectId/validate-setup —— 与 project-setup-spec §16.2 同构（此处为权威）
export interface ProjectSetupValidationResult {
  status: "ok" | "warning" | "error";     // 任一 level=error 时为 error
  items: Array<{
    field: string;                          // 出错/告警字段路径，如 "outputSpec.fps"
    level: "warning" | "error";
    code: string;                           // 复用 adr-004 code，主要为 validation_failed
    message: string;
  }>;
}

// POST /api/projects/:projectId/preview-impact —— 与 project-setup-spec §16.3 同构（此处为权威）
export interface ProjectSetupImpactResult {
  affectedModules: string[];
  affectedCounts: Record<string, number>;
  suggestedActions: string[];
}

// POST /api/projects/:projectId/story/completeness-check —— story-workspace §9 只读展示
export interface StoryCompletenessResult {
  ready: boolean;                           // = 无 missing 且无 error，等价 ready_for_script 门禁
  projectSummary: {
    totalEpisodes: number;
    confirmedEpisodes: number;
    blockingCount: number;                  // error 级缺口总数
  };
  episodeDetails: Array<{
    episodeId: Id;
    ready: boolean;
    gaps: Array<{
      field: string;                        // 缺失段落/字段路径
      level: "warning" | "error";
      message: string;
    }>;
  }>;
}

// POST /api/scenes/:sceneId/storyboard/validate —— 场级分镜校验（storyboard-studio §12.2 硬校验）
// 是 keyframe 门禁（adr-006 §4）的超集：门禁只是其中 keyframeGate 一项
export interface StoryboardValidateResult {
  passable: boolean;                        // 是否可 confirm（= 无 error 级项）
  shots: Array<{
    shotId: Id;
    keyframeGate: {                         // adr-006 §4 keyframe 门禁结果
      producible: boolean;                  // 是否为可生产 shot
      hasStartKeyframe: boolean;
      hasEndKeyframe: boolean;
      keyframesConfirmed: boolean;
      blocked: boolean;                     // 可生产但缺 start/end 或未 confirmed
    };
    fieldGaps: Array<{ field: string; message: string }>;  // shot 基础字段缺口
    continuityStatus: "ok" | "warning" | "error";          // continuity 判级
  }>;
}

// GET /api/model-profiles 的读模型 —— 绝不含原始密钥（adr-001 §5.3）
export interface ModelProfileView {
  id: Id;
  provider: string;
  modelType: ModelType;
  modelName: string;
  isActive: boolean;
  credentialBound: boolean;                 // 是否已绑定密钥（endpoint_key 是否存在且 Keychain 命中）
  credentialHint?: string;                  // 仅尾号/摘要，如 "sk-***a1b2"
  lastVerifiedAt?: IsoTime;                 // 最后一次连通性测试成功时间
  defaultParams: Record<string, unknown>;
}

// POST /api/model-profiles/:id/credential/test 的响应
export interface ModelCredentialTestResult {
  ok: boolean;
  verifiedAt?: IsoTime;                     // ok=true 时刷新
  latencyMs?: number;
  errorCode?: string;                       // ok=false 时对齐 adr-004
  errorMessage?: string;
}

// POST /api/scenes/:sceneId/validate —— 剧本结构校验（script-editor §9.1，此处为权威）
export interface SceneValidateResult {
  status: "ok" | "warning" | "error";       // 任一 item level=error 时为 error
  items: Array<{
    check: string;                          // 检查项标识，如 "conflict" / "entry_exit_state" / "has_block" / "character_ref"
    level: "warning" | "error";
    code: string;                           // 复用 adr-004 code，主要为 validation_failed
    message: string;
    ref?: {                                 // 定位到具体对象，供 UI「定位错误字段」
      targetType: "scene" | "dialogue_block" | "action_block" | "character";
      targetId: string;
    };
  }>;
}

// GET /api/projects/:projectId/dashboard-metrics —— 项目总览核心指标卡（project-dashboard §8.3，此处为权威）
export interface DashboardMetrics {
  // 部分统计不可用时对应子对象/字段可为 null，触发 Dashboard 空态
  tasks: { queued: number; running: number; failed: number; succeeded: number; cancelled: number };
  cost: { todayEstimate: number; totalEstimate: number; anomalies: Array<{ provider: string; amount: number }> };
  quality: { openIssues: number; criticalIssues: number };
  progress: { sceneConfirmedRatio: number; shotProducibleRatio: number; promptConfirmedRatio: number };
}
```

## 7. API 路由

所有业务请求统一走本地 HTTP API。

### 7.0 列表查询约定

所有列表端点统一支持以下 query 参数 contract：

- `page`
  - 从 `1` 开始，默认 `1`
- `pageSize`
  - 默认 `20`，最大 `100`
- `sortBy`
  - 由各列表声明允许字段
- `sortOrder`
  - `asc | desc`，默认 `desc`
- `search`
  - 关键字搜索，按各模块定义的主检索字段生效
- `filters`
  - 结构化筛选对象；枚举、范围、关联对象筛选统一放在该对象内
- `createdFrom` / `createdTo`
  - 时间区间筛选，采用 ISO 时间

### 7.1 项目

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `POST /api/projects/:projectId/validate-setup`
  - 响应 `ProjectSetupValidationResult`（§6.3，权威结构）
- `POST /api/projects/:projectId/preview-impact`
  - 响应 `ProjectSetupImpactResult`（§6.3，权威结构）
- `GET /api/projects/:projectId/stage-status`
- `GET /api/projects/:projectId/dashboard-metrics`
  - 响应 `DashboardMetrics`（§6.3，权威结构）
- `GET /api/projects/:projectId/recent-activities`
- `GET /api/projects/:projectId/blocking-issues`

### 7.2 故事开发

- `POST /api/projects/:projectId/story-bible/generate`
- `GET /api/projects/:projectId/story-bible`
- `PATCH /api/projects/:projectId/story-bible`
- `POST /api/projects/:projectId/story/completeness-check`
  - 返回故事完整性检查结果，响应结构 `StoryCompletenessResult`（§6.3，权威）：缺失必填段落、集大纲缺口、关系/动机链缺口，供 `ready_for_script` 派生与批量确认门禁使用
- `POST /api/episodes/:episodeId/story/confirm`
  - 单集确认，权威写入 `Episode.storyStatus=confirmed`（见 adr-006 §3，为故事确认权威端点）
- `POST /api/projects/:projectId/story/confirm`
  - 批量便捷操作：对通过完整性检查的全部集执行单集确认，等价于遍历调用上一端点
- `POST /api/projects/:projectId/episodes/generate-outline`
- `POST /api/projects/:projectId/episodes/reorder`
  - 批量调整集顺序，请求体为有序 `episodeId` 列表

### 7.3 集 / 场 / 镜

- `POST /api/projects/:projectId/episodes`
- `GET /api/projects/:projectId/episodes`
- `PATCH /api/episodes/:episodeId`
- `POST /api/episodes/:episodeId/script/confirm`
- `POST /api/episodes/:episodeId/script/push-to-storyboard`
- `POST /api/episodes/:episodeId/snapshots`
- `GET /api/episodes/:episodeId/snapshots`
  - 返回该集剧本快照列表（`version_label` / `change_summary` / 时间）
- `GET /api/episodes/:episodeId/snapshots/:snapshotId`
  - 返回单个快照的完整 `snapshot_payload`
- `POST /api/episodes/:episodeId/snapshots/:snapshotId/restore`
  - 以指定快照覆盖当前剧本内容；恢复前自动创建一次当前状态快照
- `POST /api/episodes/:episodeId/scenes`
- `GET /api/episodes/:episodeId/scenes`
- `POST /api/episodes/:episodeId/scenes/reorder`
- `PATCH /api/scenes/:sceneId`
- `DELETE /api/scenes/:sceneId`
- `GET /api/scenes/:sceneId/dialogue-blocks`
- `POST /api/scenes/:sceneId/dialogue-blocks`
- `PATCH /api/dialogue-blocks/:blockId`
- `DELETE /api/dialogue-blocks/:blockId`
- `POST /api/scenes/:sceneId/dialogue-blocks/reorder`
- `GET /api/scenes/:sceneId/action-blocks`
- `POST /api/scenes/:sceneId/action-blocks`
- `PATCH /api/action-blocks/:blockId`
- `DELETE /api/action-blocks/:blockId`
- `POST /api/scenes/:sceneId/action-blocks/reorder`
- `POST /api/scenes/:sceneId/validate`
  - 响应 `SceneValidateResult`（§6.3，权威结构）：逐检查项 `ok/warning/error` 与定位 `ref`
- `POST /api/scenes/:sceneId/storyboard/validate`
  - 响应 `StoryboardValidateResult`（§6.3，权威）：keyframe 门禁（adr-006 §4）+ 基础字段缺口 + continuity 判级
- `POST /api/scenes/:sceneId/storyboard/confirm`
- `POST /api/scenes/:sceneId/duplicate`
- `POST /api/scenes/:sceneId/shots`
- `GET /api/scenes/:sceneId/shots`
- `PATCH /api/shots/:shotId`
- `DELETE /api/shots/:shotId`
- `POST /api/scenes/:sceneId/shots/reorder`
- `POST /api/shots/:shotId/duplicate`

### 7.4 资产台账

- `POST /api/projects/:projectId/characters`
- `GET /api/projects/:projectId/characters`
- `PATCH /api/characters/:characterId`
- `POST /api/characters/:characterId/looks`
- `GET /api/characters/:characterId/looks`
- `PATCH /api/character-looks/:lookId`
- `POST /api/projects/:projectId/locations`
- `GET /api/projects/:projectId/locations`
- `PATCH /api/locations/:locationId`
- `POST /api/projects/:projectId/props`
- `GET /api/projects/:projectId/props`
- `PATCH /api/props/:propId`
- `GET /api/projects/:projectId/style-guides`
- `POST /api/projects/:projectId/style-guides`
- `PATCH /api/style-guides/:styleGuideId`
- `GET /api/assets/:assetType/:assetId/usage`
- V1 不暴露 `characters / locations / props` 的硬删除路由，统一通过 `PATCH status=disabled` 执行停用
- 版本策略（见 adr-006 / adr-003）：`character_looks` 走造型版本化（`look_group_id` / `version_no` / `is_current`）；`characters / locations / props / style_guides` V1 仅用 `version` 乐观锁，不做历史版本快照表

### 7.5 分镜与关键帧

- `POST /api/episodes/:episodeId/storyboard/generate`
- `GET /api/shots/:shotId/continuity-anchors`
- `POST /api/shots/:shotId/continuity-anchors`
- `PATCH /api/continuity-anchors/:anchorId`
- `DELETE /api/continuity-anchors/:anchorId`
- `POST /api/shots/:shotId/continuity-anchors/suggest`
- `POST /api/shots/:shotId/keyframes/generate`
- `GET /api/shots/:shotId/keyframes`
- `PATCH /api/keyframes/:keyframeId`

### 7.6 Prompt 编译

- `POST /api/prompts/compile`
- `GET /api/prompts/:promptId`
- `GET /api/source-entities/:type/:id/prompts`
- `POST /api/shots/:shotId/prompts/compile-image`
- `POST /api/shots/:shotId/prompts/compile-video`
- `POST /api/scenes/:sceneId/prompts/compile-tts`
- `POST /api/prompts/:promptId/confirm`
- `POST /api/prompts/:promptId/bind-model-profile`
- `POST /api/prompts/:promptId/send-to-production-check`

### 7.7 模型配置

由 `model-settings-spec-v1.md` 独立承接 UI；密钥存储策略见 adr-001。

- `GET /api/model-profiles`
  - 返回 `ModelProfileView[]`（§6.3，不含原始密钥；含 `credentialBound` / `credentialHint` / `lastVerifiedAt`）
- `POST /api/model-profiles`
- `PATCH /api/model-profiles/:modelProfileId`
- `DELETE /api/model-profiles/:modelProfileId`
  - 存在被 PromptSpec / GenerationTask 引用时按 adr-004 返回 `blocked_by_reference`，`details` 列出引用来源（对齐 FK `ON DELETE SET NULL` 前的软校验）
- `POST /api/model-profiles/:modelProfileId/is-active`
  - 启用/停用；请求体 `{ isActive: boolean }`
- `POST /api/model-profiles/:modelProfileId/credential`
  - 绑定/更新密钥：原始密钥写入 OS Keychain，SQLite 仅存 `endpoint_key` 引用键（adr-001 §4/§5.1），响应只回 `credentialHint`（尾号/摘要），不回显完整 key
- `POST /api/model-profiles/:modelProfileId/credential/test`
  - 测试连通性：用绑定密钥对 provider 发一次探活，成功则刷新 `lastVerifiedAt`；响应 `ModelCredentialTestResult`（§6.3）
- `DELETE /api/model-profiles/:modelProfileId/credential`
  - 解绑密钥：清除 Keychain 条目与 `endpoint_key` 引用

### 7.8 任务系统

- `POST /api/tasks`
- `GET /api/tasks`
- `GET /api/tasks/:taskId`
- `POST /api/tasks/:taskId/retry`
- `POST /api/tasks/:taskId/cancel`
- `GET /api/tasks/:taskId/logs`
- `GET /api/tasks/:taskId/artifacts`

### 7.9 产物

- `GET /api/projects/:projectId/artifacts`
- `GET /api/artifacts/:artifactId`
- `DELETE /api/artifacts/:artifactId`

### 7.10 审查

- `POST /api/reviews/run`
  - 创建一次 review run（异步），返回 `runId` 与初始 `status=queued`
- `GET /api/review-runs/:runId`
  - 查询 review run 执行状态（`ReviewRunStatus`：`queued | running | succeeded | failed`）、审查结论（`ReviewRunVerdict`：`succeeded` 时为 `passed | blocked`）、进度与结果摘要；SSE 不可用时用于轮询兜底
- `GET /api/projects/:projectId/review-runs`
  - 返回 review run 历史列表
- `GET /api/projects/:projectId/review-issues`
- `GET /api/review-issues/:issueId`
- `PATCH /api/review-issues/:issueId`
- `POST /api/review-issues/:issueId/resolve`
- `POST /api/review-issues/:issueId/ignore`
- `POST /api/review-issues/:issueId/reopen`
- `GET /api/review-issues/:issueId/events`

### 7.11 导出

- `POST /api/exports`
  - 写入 `export_bundles` 记录并经 Job Orchestrator 创建一个 `compose_export` 任务，返回 `exportId` 与 `composeTaskId`（见 adr-006 §5）
- `GET /api/projects/:projectId/exports`
- `GET /api/exports/:exportId`
  - `status` 由关联 `compose_export` 任务驱动；进度事件复用 `task.status.changed`
- `POST /api/exports/:exportId/retry`
  - 重新创建一个 `compose_export` 任务并刷新 bundle 状态
- `GET /api/exports/:exportId/manifest`
- `GET /api/exports/:exportId/download`
  - bundle 未 `ready` 时返回 `export_not_ready` 错误信封

### 7.12 横切契约（乐观锁 / 错误信封 / 实时更新）

以下三条横切约束对所有相关端点统一生效，各页面 spec 只引用不另立：

- 乐观锁（adr-003）：`### 7` 中所有写核心事实层的 `PATCH` 与确认类端点，请求体必须携带当前 `version`；版本不匹配时返回 `version_conflict` 错误信封（含 `currentVersion` 与对象摘要）。适用对象见 adr-003 §5。任务状态 / 日志 / 审查事件 / activity 等 append-only 写入不走乐观锁。
- 错误信封（adr-004）：所有 `POST/PATCH/DELETE` 端点的业务错误统一按 `ApiErrorEnvelope` 返回，`code` 取值限定于 adr-004 §4 必备错误码；`generation_tasks.error_code` 与 `export_bundles` 失败态复用同一套 `code`。
- 实时更新（adr-002）：需要近实时的页面（Dashboard / Production Hub / Review Center / Export Center）统一「先拉快照 + SSE 订阅 + 轮询兜底」；事件主题限定于 adr-002 §5。轮询兜底端点：Dashboard 用 `stage-status` / `dashboard-metrics`，Production 用 `GET /api/tasks/:taskId`，Review 用 `GET /api/review-runs/:runId`，Export 用 `GET /api/exports/:exportId`。

## 8. Contract 约束

### 8.1 Story Contract

- 输出统一故事结构
- 不直接创建媒体任务
- 故事确认权威在集级 `Episode.storyStatus`，项目级为派生 rollup（见 adr-006 §3）

### 8.2 Prompt Contract

- 只接受事实层输入
- 只输出标准化 prompt spec（含 `sections` 结构化分段与 `compiledPrompt` 拼接快照）
- video 编译前置 = 对应 shot 已过 keyframe 门禁（见 adr-006 §4）

### 8.3 Job Contract

- 只接受 prompt spec 与 model profile
- 只输出 task state 与 artifacts

### 8.4 Export Contract

- 创建导出 = 经 Job Orchestrator 创建 `compose_export` 任务（见 adr-006 §5）
- `export_bundle.status` 由该任务状态驱动，1:1 关联 `compose_task_id`
- `compose_export` 任务仅由 Export Center 触发，Production Hub 只读展示

### 8.5 Adapter Contract 来源说明

- Adapter 的存在形式参考 `huobao-drama` 与 `trae_projects`。
- 但当前平台的 adapter contract 是重新定义的：
  - 不允许 adapter 回写故事事实
  - 不允许 adapter 注入业务 prompt
  - 不允许 adapter 内含项目级默认业务逻辑
- adapter 只负责：
  - 请求翻译
  - provider 调用
  - 标准化返回

### 8.6 文本 / LLM 任务 Contract（口径收口）

统一"文本生成类任务（`story_generate` / `prompt_compile` 等 LLM 任务）走不走 Prompt Compiler、prompt 从哪来、任务从哪创建"的口径：

- **仍走 Prompt Compiler（唯一出口不破例）**：文本任务的执行 prompt 由 Prompt Compiler 按 `PromptTargetType=text` 编译，输出与 image/video/tts 同构的 `PromptSpec`（含 `sections` + `compiledPrompt`），保证"最终执行 prompt 的唯一出口"约束（见 `prompt-compiler-contract-v1.md` §2）。
- **prompt 来源 = 系统模板自动编译，不在 Prompt Center 手工编辑**：`text` 类 `PromptSpec` 由系统按模板 + 事实层自动生成，Prompt Center V1 的可视化编辑/确认流程只覆盖 shot 级 `image/video/tts` prompt，不暴露 `text` prompt 的手工编辑。
- **任务创建入口 = 来源页专有端点**：`story_generate` 由 Story Workspace 的 `POST /api/projects/:projectId/episodes/generate-outline` 与 `POST /api/projects/:projectId/story-bible/generate` 创建；`prompt_compile` 由 Prompt Center 编译动作创建。二者均经 Job Orchestrator 异步调度。
- **Production Hub 对文本任务只读展示**：与 `compose_export` 同类处理——Production Hub 的"创建任务" `taskType` 仅可选 `image_generate / video_generate / tts_generate`；`story_generate / prompt_compile / compose_export` 由来源页/系统创建，Production Hub 仅在任务列表只读展示与查看日志/产物。

## 9. V1 页面映射

### 9.1 Project Dashboard

- 读取：
  - `projects`
  - `episodes`
  - `generation_tasks`
  - `review_issues`

### 9.2 Story Workspace

- 读取和写入：
  - `project_story_bibles`
  - `episodes`

### 9.3 Asset Ledger

- 读取和写入：
  - `characters`
  - `character_looks`
  - `locations`
  - `props`

### 9.4 Storyboard Studio

- 读取和写入：
  - `scenes`
  - `shots`
  - `keyframe_specs`
  - `continuity_anchors`

### 9.5 Prompt Center

- 读取和写入：
  - `prompt_specs`
  - `model_profiles`

### 9.6 Production Hub

- 读取和写入：
  - `generation_tasks`
  - `artifacts`

### 9.7 Review Center

- 读取和写入：
  - `review_issues`

### 9.8 Export Center

- 读取和写入：
  - `export_bundles`

## 10. 实现顺序建议

1. SQLite migration
2. domain types
3. repository
4. Story / Asset / Storyboard core service
5. Prompt Compiler contract
6. Model Profile contract
7. Job Orchestrator contract
8. Artifact / Review / Export service

## 11. 一句话结论

- V1 的开发起点不是 UI，而是 `schema + types + contracts`；只要这三层先稳，后面的页面和执行链就不容易滑回旧项目那种补丁式结构。
