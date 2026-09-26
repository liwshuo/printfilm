-- 0001_init — initial schema for DramaFlow Studio (printfilm-next).
-- Source of truth: docs/product/data-and-api-v1.md §5 (reproduced verbatim).
-- Migration policy: adr-005 (file-based SQL migrations; never edit an applied file, add a new version).
--
-- PRE-RELEASE NOTE (2026-09): the A1 project model (project_type / compliance_mode / episode
-- scope + m2m reuse + continuity locks + review tiers / quality scores) is folded into 0001
-- directly because the product has not shipped and there is no persisted user data. Local dev
-- DBs must be reset (delete the sqlite file) so 0001 re-applies with the new checksum; in-memory
-- smoke tests are always fresh. Once shipped, revert to strict append-only migrations (0002+).

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
  -- A1 project model: 'drama' = 连续剧（项目级共享故事圣经/资产/连续性）；
  -- 'series' = 选集/单元剧（每集默认独立故事/资产，允许经 episode_asset_refs 跨集复用）。
  project_type TEXT NOT NULL DEFAULT 'drama',
  -- A1 content type: 项目一级内容形态（short_drama / motion_comic / animation /
  -- comic / picture_book / documentary / educational_story）。与 project_type 正交，
  -- 决定分镜/资产/prompt 的模板与视觉风格预设集。SSOT 见 packages/domain content-types.ts。
  content_type TEXT NOT NULL DEFAULT 'short_drama',
  -- A1 视觉风格：JSON { presetKey?, customPrompt?, resolvedPrompt } —— resolvedPrompt
  -- 是最终注入 image/video prompt 的英文 suffix，冗余落库以避免 registry 演进导致的
  -- 历史项目 prompt 漂移。
  visual_style_json TEXT NOT NULL DEFAULT '{"resolvedPrompt":""}',
  -- 出海/国内双模式：驱动合规审查规则集与导出 gate（domestic | overseas）。
  compliance_mode TEXT NOT NULL DEFAULT 'domestic',
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

CREATE TABLE IF NOT EXISTS project_story_bibles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  -- A1 scope: NULL = 项目级故事圣经（drama 共享 / series 的共享底座）；
  -- 非空 = 该集专属故事圣经（series 每集独立）。唯一性由分部索引保证。
  episode_id TEXT,
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
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
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
  storyboard_status TEXT NOT NULL DEFAULT 'draft',
  production_status TEXT NOT NULL DEFAULT 'idle',
  review_status TEXT NOT NULL DEFAULT 'pending',
  -- drama 跨集连续性交接胶囊（最小 delta 摘要：结束状态 / 未兑现 setup-payoff /
  -- 下一集 entry-state），非全量快照，以正文为准。参考 drama-skills scene-handoff-capsule。
  handoff_state_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, episode_no),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  -- A1 scope: NULL = 项目级资产（drama 共享）；非空 = 该集专属资产（series 独立）。
  episode_id TEXT,
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
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT,
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
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
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
  episode_id TEXT,
  name TEXT NOT NULL,
  prop_type TEXT,
  visual_spec_json TEXT NOT NULL DEFAULT '{}',
  ownership_json TEXT NOT NULL DEFAULT '{}',
  continuity_rules_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
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
  -- 三态参考图（参考 drama-skills / CineGen）：
  -- 'unverified' = 仅提示词/计划引用，未核实；'planned' = 已指定为某镜/角色计划参考；
  -- 'verified' = 已核实真实参考图，可强注入 Prompt context 做一致性锚定。
  reference_state TEXT DEFAULT 'unverified',
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
  status TEXT NOT NULL DEFAULT 'queued',
  verdict TEXT,
  -- 五维质量评分（节奏 / 爽点 / 台词 / 格式 / 连贯性），参考 short-drama references。
  quality_scores_json TEXT NOT NULL DEFAULT '{}',
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
  -- 规则分级（参考 drama-skills）：structural_invariant(硬阻断) / reviewed_invariant(需证据) /
  -- craft_default(可覆盖建议) / taste_option(不阻断)。决定 issue 是否 block 确认。
  rule_tier TEXT,
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

-- A1 跨集资产复用引用表：series 每集默认独立资产，但可显式引用其它集/项目级资产复用。
-- asset_type ∈ character | location | prop；(episode_id, asset_type, asset_id) 唯一。
CREATE TABLE IF NOT EXISTS episode_asset_refs (
  episode_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (episode_id, asset_type, asset_id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

-- 连续性锁（参考 drama-skills continuity-lock）：把跨镜/跨集不变的最小名词短语
-- （"颜色+材质+物体"）设为逐字锁面，Prompt 编译时逐字注入并在产物正文机械核对。
-- scope ∈ project | episode | scene；applies_to_json 记录锁面适用的镜头/角色范围。
CREATE TABLE IF NOT EXISTS continuity_locks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT,
  scope TEXT NOT NULL DEFAULT 'project',
  lock_phrase TEXT NOT NULL,
  applies_to_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
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

-- A1 scope 唯一性（替代原 inline UNIQUE(project_id, name)）：
-- 项目级资产（episode_id IS NULL）在项目内 name 唯一；剧集级资产在 (project, episode) 内 name 唯一。
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_project_name_unique
ON characters(project_id, name) WHERE episode_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_episode_name_unique
ON characters(project_id, episode_id, name) WHERE episode_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_project_name_unique
ON locations(project_id, name) WHERE episode_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_episode_name_unique
ON locations(project_id, episode_id, name) WHERE episode_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_props_project_name_unique
ON props(project_id, name) WHERE episode_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_props_episode_name_unique
ON props(project_id, episode_id, name) WHERE episode_id IS NOT NULL;

-- Story bible 作用域唯一性：一个项目最多一个项目级圣经；每集最多一个剧集级圣经。
CREATE UNIQUE INDEX IF NOT EXISTS idx_story_bibles_project_unique
ON project_story_bibles(project_id) WHERE episode_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_story_bibles_episode_unique
ON project_story_bibles(project_id, episode_id) WHERE episode_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_characters_episode_id ON characters(episode_id);
CREATE INDEX IF NOT EXISTS idx_locations_episode_id ON locations(episode_id);
CREATE INDEX IF NOT EXISTS idx_props_episode_id ON props(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_asset_refs_asset ON episode_asset_refs(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_continuity_locks_project_id ON continuity_locks(project_id);
