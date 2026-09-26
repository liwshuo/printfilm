/**
 * Episode Outline schema (Stage B) — P0-B 内容饱满化升级。
 *
 * 综合方案 §4.B：一批 1..N 集大纲。参考项目共识：
 *   - 0xsline 四段节奏 (起势 15% / 攀升 30% / 风暴 35% / 决战 20%)
 *   - huobao 段落 8-15s、~500字/分钟 → sceneCountEstimate 由 AI 倒推
 *   - zenstory episode outline 必含 arc_beats / hook_type
 *
 * episodeNo 不由 LLM 决定（服务层 startNo + idx 覆盖），schema 里允许缺失。
 * 数组长度由 pack runner 层校验。
 */

import { z } from "zod";

export const ARC_BEAT_PHASES = [
  "opening", // 起势 ~15%
  "rising", // 攀升 ~30%
  "storm", // 风暴 ~35%
  "climax", // 决战 ~20%
] as const;

export const ArcBeatSchema = z.object({
  phase: z.enum(ARC_BEAT_PHASES),
  description: z.string().min(1).max(200),
  weight: z.number().min(0).max(1).optional(),
});

export const EpisodeOutlineItemSchema = z.object({
  episodeNo: z.number().int().optional(),
  title: z.string().min(1).max(80),
  summary: z.string().max(500).default(""),
  episodeGoal: z.string().max(300).default(""),
  episodeConflict: z.string().max(300).default(""),
  episodeTurn: z.string().max(300).default(""),
  episodeEndingHook: z.string().max(300).default(""),
  /** 五种钩子之一：cliffhanger / mystery / conflict / emotion / reveal（LLM 可自由取名，接收任意字符串）。 */
  hookType: z.string().max(40).default(""),
  /** 起势/攀升/风暴/决战 四段节奏。允许 LLM 缺省，服务层不强绑 */
  arcBeats: z.array(ArcBeatSchema).max(6).optional(),
  /** educational_story 专属：本集要传递的核心成语/寓意/学科锚点。 */
  learningAnchor: z.string().max(120).default(""),
  /** AI 自动估算的场次数（4~12 之间较健康）。 */
  sceneCountEstimate: z.number().int().min(1).max(30).optional(),
  /** 建议受众年龄段，e.g. "6-9 岁" / "12+"。 */
  ageHint: z.string().max(40).default(""),
});

export const EpisodeOutlineListSchema = z.array(EpisodeOutlineItemSchema).min(1).max(20);

export type EpisodeOutlineItemParsed = z.infer<typeof EpisodeOutlineItemSchema>;
export type EpisodeOutlineListParsed = z.infer<typeof EpisodeOutlineListSchema>;
export type ArcBeatParsed = z.infer<typeof ArcBeatSchema>;
