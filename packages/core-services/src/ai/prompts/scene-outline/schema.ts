/**
 * Scene Outline schema (Stage D).
 *
 * 综合方案 §4.D：一集下的 N 个 scene/段落/跨页骨架。
 *
 * 方案 A（2026-09-26）：每个 scene 额外产出 `shots` 数组，
 *   每个 shot 挂 `dialogue` + `action` 字符串，直接落 shots 表。
 *   参考项目 sd3 / CineGen-ShortDrama 的做法：shot 上带
 *   `actionSummary + dialogue`，由 LLM 一次性产出，无需再手工填。
 */

import { z } from "zod";

/**
 * 方案 A：LLM 输出的 shot 骨架。字段极简、全部文本：
 *   - dialogue    该 shot 完整台词（可为空，纯动作镜头就留空）
 *   - action      该 shot 动作/画面描述
 *   - shotType    景别（Wide/Medium/Close-up …），可选
 *   - intent      该 shot 想传达的情绪/信息，可选
 *
 * 落库时会补 shotNo / sortOrder。
 */
export const SceneOutlineShotSchema = z.object({
  dialogue: z.string().max(400).default(""),
  action: z.string().max(400).default(""),
  shotType: z.string().max(40).optional(),
  intent: z.string().max(200).optional(),
});

export const SceneOutlineItemSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().max(500).default(""),
  dramaticGoal: z.string().max(300).default(""),
  conflict: z.string().max(300).default(""),
  // Ark 有时会用 "afternoon" / "evening" 之类不属于枚举的值 → coerce 到 4 档
  timeOfDay: z
    .string()
    .default("day")
    .transform((raw) => normaliseTimeOfDay(raw)),
  /**
   * 方案 A：LLM 分场时同步产出的 shot 列表。允许缺省（老版本 pack / 旧模型不输出）；
   * 若产出，storyboard-service 会用它一次性建 shots + dialogue + action。
   *
   * 上限 `.max(4)`：短剧竖屏场景，prompt 明确要求"默认 1 shot / 必要时 2 / 最多 3"，
   * schema 硬拦到 4 兜底，防 LLM 越界输出（此前 .max(8) 与 prompt 意图不一致）。
   */
  shots: z.array(SceneOutlineShotSchema).max(4).default([]),
});

export const SceneOutlineListSchema = z.array(SceneOutlineItemSchema).min(1).max(20);

export type SceneOutlineShotParsed = z.infer<typeof SceneOutlineShotSchema>;
export type SceneOutlineItemParsed = z.infer<typeof SceneOutlineItemSchema>;
export type SceneOutlineListParsed = z.infer<typeof SceneOutlineListSchema>;

/** 允许 4 档 timeOfDay；其他值兜底为 `day`。 */
function normaliseTimeOfDay(raw: string): "day" | "night" | "dusk" | "dawn" {
  const v = raw.trim().toLowerCase();
  if (v === "night" || v === "夜" || v === "夜晚") return "night";
  if (v === "dusk" || v === "傍晚" || v === "黄昏") return "dusk";
  if (v === "dawn" || v === "凌晨" || v === "清晨") return "dawn";
  return "day";
}
