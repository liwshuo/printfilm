/**
 * Episode Outline pack (Stage B) — P0-B 内容饱满化升级。
 *
 * 综合方案 §4.B。ctx 支持：
 *   - topicHint     用户在追加生成时填写的主题/成语/关键词（HARD REQUIREMENT）
 *   - existingTitles  已有 episode title 列表，避免 LLM 生成同一个主题
 *   - itemDurationSecHint  单集期望时长（秒），用来倒推 sceneCountEstimate
 */

import type { ContentType } from "@dramaflow/domain";
import { definePack } from "../pack.js";
import { EpisodeOutlineListSchema } from "./schema.js";
import { buildEpisodeOutlineSystem } from "./system.js";
import { buildEpisodeOutlineUser } from "./user.js";

export interface EpisodeOutlineCtx {
  contentType: ContentType;
  isDrama: boolean;
  projectName: string;
  genre?: string;
  audience?: string;
  bibleLogline?: string;
  bibleTheme?: string;
  bibleTone?: string;
  bibleSetting?: string;
  startNo: number;
  count: number;
  /** 用户填写的主题 / 成语 / 剧集主题关键词（HARD REQUIREMENT）。 */
  topicHint?: string;
  /** 已存在的分集标题（避免重复；空则不注入）。 */
  existingTitles?: string[];
  /** 单集期望时长（秒），用来倒推 sceneCountEstimate；默认 educational_story=90、short_drama=120。 */
  itemDurationSecHint?: number;
}

export const episodeOutlinePack = definePack({
  stage: "episode_outline",
  buildSystem: buildEpisodeOutlineSystem,
  buildUser: buildEpisodeOutlineUser,
  schema: EpisodeOutlineListSchema,
  // 有些模型会把数组塞进 wrapper 对象，pack runner 自动 unwrap
  envelopeKeys: ["episodes", "items", "data", "list"] as const,
  defaults: {
    temperature: 0.6,
    maxTokens: 8192,
    // 多集大纲上游耗时容易超过 60s 默认，给到 3 分钟。
    timeoutMs: 180_000,
  },
} satisfies import("../pack.js").PromptPack<
  EpisodeOutlineCtx,
  typeof EpisodeOutlineListSchema
>);

export * from "./schema.js";
