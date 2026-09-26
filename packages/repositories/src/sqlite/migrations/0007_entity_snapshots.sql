-- 0007_entity_snapshots.sql
--
-- Round-3 P1-① 版本快照底座（rollback）
--
-- 为所有 versioned 实体（scene / episode / character / location / prop / project_story_bible / …）
-- 提供统一的"改动前快照"表，替代 ScriptSnapshot 只覆盖剧本文本的窄型快照。
--
-- 语义：
--   - 每次 VersionedRepositoryBase.update 命中前，捕获旧行的 JSON 序列化到 payload_json；
--   - `entity_type` 使用 mapping.table（如 `scenes` / `episodes` / `characters` / `locations` /
--     `props` / `project_story_bibles`），避免另建 registry；
--   - `version` 是被覆盖那一版的版本号（即 update 前的 `expectedVersion`），用来重放；
--   - `reason` 用于区分场景，如 `update` / `regenerate` / `rollback`（rollback 也保留新旧
--     记录，形成完整链路）；
--   - `summary` 是给 UI 直接展示的中文简述，e.g. "S2 · 学校天台的秘密"。
--
-- 保留策略：
--   - 应用侧默认保留每个实体最近 20 条快照（后续 P1 rollback service 内负责裁剪）；
--   - 迁移只建表 + 索引，不做数据回填。

CREATE TABLE IF NOT EXISTS entity_snapshots (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  version      INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  reason       TEXT,
  summary      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_snapshots_target
  ON entity_snapshots (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_snapshots_entity_id
  ON entity_snapshots (entity_id);
