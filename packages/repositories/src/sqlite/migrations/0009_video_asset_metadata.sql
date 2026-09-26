-- 0009_video_asset_metadata — 视频生成元数据落库（UI 元数据展示 & observability）。
--
-- 背景：
--   * Round-4 Phase-C 引入了 estimateShotDuration 动态时长估算，其结果
--     （durationSource / dialogueChars / actionChars）此前只写进了 activity
--     log payload，UI 无法直接展示。
--   * i2v (image-to-video) 与 t2v (text-to-video) 走同一张 video_assets 表，
--     但 UI 上无法区分是不是"带首帧图"的 i2v 生成。
--
-- 本次新增 4 列（全部允许 NULL / 有默认，保证向后兼容）：
--   duration_source          — 时长来源，枚举 `explicit` / `text_estimate` / `default`
--   duration_dialogue_chars  — 参与估算的场次台词字数（0 若无 / 未估算）
--   duration_action_chars    — 参与估算的场次动作字数（0 若无 / 未估算）
--   is_i2v                   — 是否 image-to-video（0/1）：first_frame_image_id 有值时为 1
--
-- 说明：
--   * `is_i2v` 冗余于 `first_frame_image_id`，但显式落一列可支持后续多种"首帧
--     来源"（如后续 shot-to-shot 接力用 last_frame_url 时，仍视为 i2v 但不
--     一定有 first_frame_image_id）。
--   * 历史行 duration_source 留 NULL，UI 侧当 `unknown` 展示。

ALTER TABLE video_assets ADD COLUMN duration_source TEXT;
ALTER TABLE video_assets ADD COLUMN duration_dialogue_chars INTEGER NOT NULL DEFAULT 0;
ALTER TABLE video_assets ADD COLUMN duration_action_chars INTEGER NOT NULL DEFAULT 0;
ALTER TABLE video_assets ADD COLUMN is_i2v INTEGER NOT NULL DEFAULT 0;
