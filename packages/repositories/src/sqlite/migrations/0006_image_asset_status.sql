-- 0006_image_asset_status — image_assets 加入生成状态、失败原因、重试链路、过期原因。
--
-- 背景：
--   * Round-3 反馈：AI 图像生成偶尔失败（Ark 超时 / 400 / provider unavailable），
--     此前失败直接抛错不落库，前端刷新后失去线索，也没法「单张重试」。
--   * P0 目标：失败也落一条 image_assets 记录 —— status='failed' + error_message，
--     UI 上给一个 🔁 重试按钮，走 retryImageAsset(id) 复用同一份 prompt / 挂载点重新出图。
--   * P2 铺垫：下游联动会给 stale 图打 stale_reason，同一列复用。
--
-- 变更：
--   * status         —— 生成状态：succeeded / failed / stale，默认 succeeded 兼容历史行。
--   * error_message  —— 失败或 stale 时的原因摘要，成功时保持 NULL。
--   * attempt_count  —— 累计尝试次数，方便识别「一直失败」的资产。默认 1。
--   * retry_of_id    —— 若本行是重试记录，指向被重试的原 image_asset.id；否则 NULL。
--   * stale_reason   —— 上游依赖更新触发的过期原因（P2-⑤ 使用）。
--
-- 兼容性：所有列默认值合理；历史行读出来 status='succeeded'、attempt_count=1、
--   其他 NULL，业务语义不变。
--
-- 注意：SQLite 的 ALTER TABLE ADD COLUMN 不支持在同一语句里加 CHECK 约束，
--   status / attempt_count 的合法性由应用层保证。

ALTER TABLE image_assets ADD COLUMN status TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE image_assets ADD COLUMN error_message TEXT;
ALTER TABLE image_assets ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE image_assets ADD COLUMN retry_of_id TEXT;
ALTER TABLE image_assets ADD COLUMN stale_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_image_assets_status ON image_assets(status);
CREATE INDEX IF NOT EXISTS idx_image_assets_retry_of ON image_assets(retry_of_id);
