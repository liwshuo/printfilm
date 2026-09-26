-- 0010_shot_dialogue_action — 方案 A：shot 粒度台词/动作字段。
--
-- 背景：
--   * `scene_dialogue_blocks` / `scene_action_blocks` 结构化过重，目前只有
--     手动 Storyboard Studio 会写；AI 分场链路（scene_outline）从来没落过，
--     导致 estimateShotDuration 长期兜底到 default 5s。
--   * 参考短剧类项目（sd3 / CineGen）主流做法：shot 上直接挂
--     `actionSummary + dialogue` 字符串，由 LLM 一次性产出。
--
-- 本次新增 2 列（allow NULL，向后兼容）：
--   dialogue — 该 shot 的完整台词文本（可空；多角色可用换行分隔）
--   action   — 该 shot 的动作/画面描述（可空）
--
-- block 表保留为可选高级功能（多说话人 / actor+prop refs 场景），不移除。

ALTER TABLE shots ADD COLUMN dialogue TEXT;
ALTER TABLE shots ADD COLUMN action TEXT;
