/**
 * Story Bible schema (Stage A · World / Series Setting).
 *
 * 综合方案 §4.A：world preset 保留完整戏剧字段，series preset 精简到
 * tone/theme/setting/targetAudience。用 discriminatedUnion 区分。
 */

import { z } from "zod";

// ---------------------------------------------------------------
// Asset seeds —— Stage A 一次性产出的角色 / 场景 / 道具骨架。
//
// 参考 zenstory & 0xsline：视觉锁（visualLock）是「关键帧生成时的稳定视觉
// 描述」，用来保证跨镜头一致性（outfit / iconic look / silhouette）。
// LLM 输出的 seeds 会被 StoryService.generateStoryBible 落到
// characters / locations / props 表，供后续 Scene Outline / 关键帧 prompt 引用。
// ---------------------------------------------------------------

/** 角色 seed：视觉锁是关键帧生成的一致性抓手。 */
export const CharacterSeedSchema = z.object({
  name: z.string().min(1).max(40),
  /** 剧作角色：protagonist / antagonist / supporting / mentor / comic 等自由文本 */
  role: z.string().max(40).default(""),
  /** 一句话性格核心（推动动机 / 弧光起点） */
  personalityCore: z.string().max(200).default(""),
  /**
   * 视觉锁：外观/服饰/发型/标志性物件/剪影的稳定描述，供关键帧 prompt 复用。
   * 例：「圆脸小男孩，红色斗篷 + 白 T，短碎发翘一撮，脖颈挂磨得发亮的铜锁」
   */
  visualLock: z.string().max(300).default(""),
  /** 出场年龄/年龄段的自由文本描述 */
  ageHint: z.string().max(40).default(""),
});
export type CharacterSeed = z.infer<typeof CharacterSeedSchema>;

/** 场景 / 地点 seed。 */
export const LocationSeedSchema = z.object({
  name: z.string().min(1).max(40),
  /** 室内 / 室外 / 交界 / 幻想空间 等自由文本 */
  spaceType: z.string().max(40).default(""),
  /** 氛围一句话（潮湿旧巷 / 竹林清晨 / 集市喧嚣） */
  atmosphere: z.string().max(200).default(""),
  /** 视觉锁：主色 / 材质 / 光线 / 标志物 */
  visualLock: z.string().max(300).default(""),
});
export type LocationSeed = z.infer<typeof LocationSeedSchema>;

/** 道具 seed —— 通常是与主题强绑定的关键 prop（成语中的「兔子」「剑」）。 */
export const PropSeedSchema = z.object({
  name: z.string().min(1).max(40),
  /** 在故事中的作用（象征 / 推动 / 转折触发） */
  purpose: z.string().max(200).default(""),
  /** 视觉锁：色 / 形 / 材质 / 尺寸 */
  visualLock: z.string().max(300).default(""),
});
export type PropSeed = z.infer<typeof PropSeedSchema>;

/** 复用给两种 preset 的 seeds 联合字段。 */
export const AssetSeedsSchema = z.object({
  characterSeeds: z.array(CharacterSeedSchema).max(20).default([]),
  locationSeeds: z.array(LocationSeedSchema).max(20).default([]),
  propSeeds: z.array(PropSeedSchema).max(20).default([]),
});
export type AssetSeeds = z.infer<typeof AssetSeedsSchema>;

// —— world（drama 系：short_drama / motion_comic / animation / comic）——
export const StoryBibleWorldSchema = z
  .object({
    _kind: z.literal("world"),
    logline: z.string().min(1).max(300),
    theme: z.string().min(1).max(200),
    tone: z.string().min(1).max(200),
    worldRules: z
      .object({
        setting: z.string().max(500).default(""),
        rules: z.array(z.string().max(200)).default([]),
      })
      .partial()
      .transform((v) => ({
        setting: v.setting ?? "",
        rules: v.rules ?? [],
      })),
    hookSystem: z
      .object({
        openingHook: z.string().max(300).default(""),
        perEpisodeHook: z.string().max(300).default(""),
      })
      .partial()
      .transform((v) => ({
        openingHook: v.openingHook ?? "",
        perEpisodeHook: v.perEpisodeHook ?? "",
      })),
    pacingPlan: z
      .object({
        structure: z.string().max(300).default(""),
        beatsPerEpisode: z.number().int().min(2).max(12).default(4),
      })
      .partial()
      .transform((v) => ({
        structure: v.structure ?? "",
        beatsPerEpisode: v.beatsPerEpisode ?? 4,
      })),
    villainSystem: z
      .object({
        mainAntagonist: z.string().max(300).default(""),
        pressureModel: z.string().max(300).default(""),
      })
      .partial()
      .transform((v) => ({
        mainAntagonist: v.mainAntagonist ?? "",
        pressureModel: v.pressureModel ?? "",
      })),
    characterRelations: z
      .object({
        protagonist: z.string().max(300).default(""),
        relations: z
          .array(
            z.object({
              from: z.string().max(60),
              to: z.string().max(60),
              type: z.string().max(60),
            }),
          )
          .default([]),
      })
      .partial()
      .transform((v) => ({
        protagonist: v.protagonist ?? "",
        relations: v.relations ?? [],
      })),
  })
  // seeds 是 world / series 共同字段，用 merge 拼进来避免重复。
  .merge(AssetSeedsSchema);

// —— series（教育故事 / 绘本 / 纪录片：精简 4 字段）——
export const StoryBibleSeriesSchema = z
  .object({
    _kind: z.literal("series"),
    tone: z.string().min(1).max(200),
    theme: z.string().min(1).max(200),
    worldRules: z
      .object({
        targetAudience: z.string().max(200).default(""),
        setting: z.string().max(500).default(""),
      })
      .partial()
      .transform((v) => ({
        targetAudience: v.targetAudience ?? "",
        setting: v.setting ?? "",
      })),
  })
  .merge(AssetSeedsSchema);

/**
 * Story Bible union schema。
 *
 * 注意：LLM 输出通常不带 `_kind`；pack 会在传入 schema 前给 parsed 追加
 * `_kind`（由 ctx.presetKey 决定）。schema 定义在这里方便类型推导。
 */
export const StoryBibleSchema = z.discriminatedUnion("_kind", [
  StoryBibleWorldSchema,
  StoryBibleSeriesSchema,
]);

export type StoryBibleParsed = z.infer<typeof StoryBibleSchema>;
export type StoryBibleWorldParsed = z.infer<typeof StoryBibleWorldSchema>;
export type StoryBibleSeriesParsed = z.infer<typeof StoryBibleSeriesSchema>;
