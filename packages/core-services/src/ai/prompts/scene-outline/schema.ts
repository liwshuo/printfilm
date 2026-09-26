/**
 * Scene Outline schema (Stage D).
 *
 * 综合方案 §4.D：一集下的 N 个 scene/段落/跨页骨架。
 */

import { z } from "zod";

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
});

export const SceneOutlineListSchema = z.array(SceneOutlineItemSchema).min(1).max(20);

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
