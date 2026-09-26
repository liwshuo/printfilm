-- 0002_image_assets — Stage F 图像素材落库（综合方案 §4.F、M4#2）。
--
-- P0 目标：seedream 出的图 b64_json 直接落库，避免默认 URL 24h 过期。
-- 关联：episodeId（必填，方便按集聚合）+ keyframeId / shotId / sceneId（可空，P0 阶段
-- 大概率只挂 episode，P1 接入 keyframe plan 后再逐级关联）。
--
-- 表结构说明：
--   provider          — 供应商标识（`volcengine-ark`）
--   model_id          — Ark 模型 endpoint id（如 `doubao-seedream-5-0-260128`）
--   prompt_positive   — 实际下发的英文 prompt（含 visual_lock 拼接后的最终版）
--   prompt_positive_zh — 可选：原始中文思路（便于人肉复盘）
--   size_preset       — Seedream 档位（IMAGE_SIZE_PRESETS 之一），如 `1024x1792`
--   seed              — 可选，用于 A/B 重出
--   base64            — b64_json 原文；单张 8-bit PNG 约 2–5MB
--   mime_type         — 默认 `image/png`
--   raw_response_json — 上游完整响应（除 base64 之外的元数据，如 request_id）

CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  episode_id TEXT,                            -- 允许为空（未来给 world/character seed 出图也走同表）
  scene_id TEXT,
  shot_id TEXT,
  keyframe_id TEXT,
  provider TEXT NOT NULL DEFAULT 'volcengine-ark',
  model_id TEXT NOT NULL,
  prompt_positive TEXT NOT NULL,
  prompt_positive_zh TEXT,
  size_preset TEXT NOT NULL,
  seed INTEGER,
  base64 TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  raw_response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
  FOREIGN KEY (keyframe_id) REFERENCES keyframe_specs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_image_assets_episode ON image_assets(episode_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_scene ON image_assets(scene_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_keyframe ON image_assets(keyframe_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_created_at ON image_assets(created_at);
