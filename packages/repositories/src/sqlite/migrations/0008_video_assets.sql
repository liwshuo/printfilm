-- 0008_video_assets — Shot 级视频素材落库（Round-4 Phase-C：视频生成 + 视频拼接链路）。
--
-- 背景：
--   * ImageAssetService.generateShotFirstFrame 已能给每个 shot 落一张首帧图；
--     下一步是把首帧图 + shot 描述交给 Seedance 2.0-mini（火山方舟视频模型），
--     生成 5–15s 的 9:16 竖屏 mp4 clip。多个 shot 的 clip 后续再由 Export /
--     compose_export 链路拼成一集完整 mp4（走 ExportBundle，不落这张表）。
--
--   * 火山方舟视频接口返回的是 24h 过期的临时 URL，而非 base64；因此本表存
--     `video_url` 字段（后续可增加 `local_path` 列做本地缓存/持久化），不像
--     image_assets 那样直接把 base64 落库。
--
-- 表结构说明：
--   provider                — 供应商标识（`volcengine-ark`）
--   model_id                — Ark 模型 endpoint id（如 `doubao-seedance-2-0-mini-...`）
--   prompt                  — 实际下发的英文 prompt
--   prompt_zh               — 可选：原始中文思路（人工复盘用）
--   resolution              — 分辨率档位（`480p` / `720p` / `1080p`）
--   ratio                   — 画幅（`9:16` / `16:9` / `1:1` / `4:3` / `3:4`）
--   duration_sec            — 时长（秒），Seedance 2.0-mini 上限 15
--   first_frame_image_id    — 首帧图 image_assets.id（视频接力的起点）
--   video_url               — 上游 24h 临时 URL；到期需重生
--   last_frame_url          — 末帧图 URL（Seedance 2.0 支持 return_last_frame，
--                             可作为下一 shot 视频的接力锚点）
--   task_id                 — Ark 视频异步任务 id（observability）
--   raw_response_json       — 上游完整响应元数据
--   status                  — 生成状态：queued / running / succeeded / failed / stale
--   error_message           — 失败原因摘要
--   attempt_count           — 累计尝试次数，默认 1
--   retry_of_id             — 若为重试记录，指向被重试的原 video_assets.id
--   stale_reason            — 上游 shot / 首帧图 / 剧情变更触发的过期原因
--
-- 索引：按 episode / scene / shot / status 三维便于列表查询。

CREATE TABLE IF NOT EXISTS video_assets (
  id TEXT PRIMARY KEY,
  episode_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  first_frame_image_id TEXT,
  provider TEXT NOT NULL DEFAULT 'volcengine-ark',
  model_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  prompt_zh TEXT,
  resolution TEXT NOT NULL DEFAULT '1080p',
  ratio TEXT NOT NULL DEFAULT '9:16',
  duration_sec INTEGER NOT NULL DEFAULT 5,
  video_url TEXT NOT NULL DEFAULT '',
  last_frame_url TEXT,
  task_id TEXT,
  raw_response_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'succeeded',
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  retry_of_id TEXT,
  stale_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
  FOREIGN KEY (first_frame_image_id) REFERENCES image_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_video_assets_episode ON video_assets(episode_id);
CREATE INDEX IF NOT EXISTS idx_video_assets_scene ON video_assets(scene_id);
CREATE INDEX IF NOT EXISTS idx_video_assets_shot ON video_assets(shot_id);
CREATE INDEX IF NOT EXISTS idx_video_assets_status ON video_assets(status);
CREATE INDEX IF NOT EXISTS idx_video_assets_created_at ON video_assets(created_at);
CREATE INDEX IF NOT EXISTS idx_video_assets_retry_of ON video_assets(retry_of_id);
