-- Migration 0003: episode outline 内容丰满化 (综合方案 P0-B 打磨 · 参考 0xsline + huobao + zenstory)
--
-- 新增 4 个字段：
--   arc_beats_json     — 四段节奏曲线（起势/攀升/风暴/决战）；纪录片/绘本按需退化
--   learning_anchor    — educational_story 专属：本集要传递的核心成语/寓意
--   scene_count_estimate — AI 自动估算的场次数，front-end 不再让用户手填
--   age_hint           — 建议受众（e.g. "6-9 岁"）；便于风格锁在图/视频阶段用
--
-- 全部可空，向后兼容存量数据。

ALTER TABLE episodes ADD COLUMN arc_beats_json TEXT;
ALTER TABLE episodes ADD COLUMN learning_anchor TEXT;
ALTER TABLE episodes ADD COLUMN scene_count_estimate INTEGER;
ALTER TABLE episodes ADD COLUMN age_hint TEXT;
