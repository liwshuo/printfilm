-- 0004_asset_visual_lock.sql
-- 综合方案 P1 · Stage A 资产 seeds：
-- 把 characters / locations / props 加上 visual_lock（视觉锁）列。
-- 视觉锁供后续关键帧 prompt 引用，保证跨镜头一致性（zenstory / 0xsline 参考模型）。

ALTER TABLE characters ADD COLUMN visual_lock TEXT;
ALTER TABLE locations ADD COLUMN visual_lock TEXT;
ALTER TABLE props ADD COLUMN visual_lock TEXT;
