-- 0005_asset_image_columns — 让 image_assets 表能挂载 character / location / prop 资产插图。
--
-- 背景：
--   * Stage F 的 image_assets 表最初只挂 episode / scene / shot / keyframe。
--   * P1 Story Bible seeds 上线后，角色 / 场景 / 道具也需要出「资产参考图」
--     （portrait / location concept / prop concept），供后续关键帧 prompt 使用。
--   * 沿用现有 image_assets 表而不是新增表，保持"图像素材单表落 base64"的设计。
--
-- 变更：
--   * 新增可空外键列 character_id / location_id / prop_id。
--   * 加索引，便于按资产 id 查询最新一张插图。
--   * SQLite 的 ALTER TABLE ADD COLUMN 不支持 REFERENCES / FK 约束，
--     这里只加列 + 索引；ON DELETE CASCADE 由应用层在删除资产时处理
--     （若后续切到 rebuild-table 方式再补 FK）。
--
-- 兼容性：现有行 character_id / location_id / prop_id 全部 NULL，行为不变。

ALTER TABLE image_assets ADD COLUMN character_id TEXT;
ALTER TABLE image_assets ADD COLUMN location_id TEXT;
ALTER TABLE image_assets ADD COLUMN prop_id TEXT;

CREATE INDEX IF NOT EXISTS idx_image_assets_character ON image_assets(character_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_location ON image_assets(location_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_prop ON image_assets(prop_id);
