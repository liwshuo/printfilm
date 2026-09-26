/**
 * Story Bible system prompt builder (Stage A).
 *
 * 综合方案 §4.A：world preset 保留完整戏剧字段；series preset 精简到
 * tone / theme / setting / targetAudience。
 */

import { CONTENT_TYPE_REGISTRY } from "@dramaflow/domain";
import type { StoryBibleCtx } from "./index.js";

const WORLD_SCHEMA_HINT = `{
  "logline": string,
  "theme": string,
  "tone": string,
  "worldRules": { "setting": string, "rules": string[] },
  "hookSystem": { "openingHook": string, "perEpisodeHook": string },
  "pacingPlan": { "structure": string, "beatsPerEpisode": number },
  "villainSystem": { "mainAntagonist": string, "pressureModel": string },
  "characterRelations": { "protagonist": string, "relations": Array<{ "from": string, "to": string, "type": string }> }
}`;

const SERIES_SCHEMA_HINT = `{
  "tone": string,
  "theme": string,
  "worldRules": {
    "targetAudience": string,
    "setting": string
  }
}`;

const ASSET_SEEDS_SCHEMA_HINT = `{
  "characterSeeds": Array<{
    "name": string,
    "role": string,
    "personalityCore": string,
    "visualLock": string,
    "ageHint": string
  }>,
  "locationSeeds": Array<{
    "name": string,
    "spaceType": string,
    "atmosphere": string,
    "visualLock": string
  }>,
  "propSeeds": Array<{
    "name": string,
    "purpose": string,
    "visualLock": string
  }>
}`;

const ASSET_SEEDS_RULES = [
  "",
  "【必须一并产出的资产 seeds】",
  "参考 zenstory / 0xsline —— 世界设定阶段必须一次性给出角色 / 地点 / 关键道具的骨架，",
  "供后续 Scene Outline 与关键帧生成保持一致性。每个 seed 都必须包含 `visualLock`：",
  "  - visualLock 是「关键帧和图片生成的稳定视觉描述」：外观 / 服饰 / 发型 / 剪影 /",
  "    主色 / 材质 / 光线 / 标志性物件。用一到三句名词短语即可，不要写动作、不要写情绪。",
  "  - visualLock 一旦定下，跨镜头必须保持一致 —— 请写得足够具体，能被 image prompt 直接引用。",
  "  - 若某类资产在本主题下不涉及（例如成语故事没有反派 NPC），该数组允许为空。",
  "  - 单个数组最多 20 项，实际按故事需要控制在 2–6 项通常最健康。",
  "  - characterSeeds.role 常见取值：protagonist / antagonist / mentor / supporting / comic / narrator。",
  "  - locationSeeds.spaceType 常见取值：室内 / 室外 / 交界 / 幻想空间 / 抽象。",
].join("\n");

/**
 * series preset 专用的资产 seeds 规则 —— 只允许"跨集共用"级别的资产。
 *
 * 原因：series（成语故事 / 绘本合集 / 单元剧）每一集是独立故事，主角、场地、道具
 * 各不相同。项目级 Story Bible 阶段还不知道具体每集是什么内容，如果一口气生成大量
 * seeds 会把「画蛇添足」的角色误当成「守株待兔」的资产反复复用，造成语义污染。
 *
 * 因此项目级 seeds 只保留：
 *   - 主持人 / 旁白 / 系列 mascot（若形态确实有）
 *   - 系列 IP 品牌视觉锁（若适用）
 * 每集专属的角色 / 地点 / 道具，改由 `generateEpisodeAssetSeeds` 在拿到该集
 * summary / goal / conflict / turn 之后再生成，落到 `episodeId = 该集`。
 */
const SERIES_ASSET_SEEDS_RULES = [
  "",
  "【资产 seeds — series 专用约束（重要）】",
  "本项目是「选集剧 / 单元合集」（如成语故事、绘本合集），每集独立成篇，主角、场地、",
  "关键道具往往逐集不同。项目级设定阶段还不知道每一集具体讲什么，所以此处的 seeds",
  "必须严格收窄到「跨集共用」级别，禁止提前生成任何具体某一集才会用到的角色/场景/道具。",
  "",
  "允许输出（且通常仅 0–2 项，甚至可以全部为空数组）：",
  "  - characterSeeds: 仅限系列共用角色 —— 主持人 / 旁白讲述人 / 系列 mascot / IP 吉祥物。",
  "    若本形态没有共用角色（大部分成语故事、绘本单元剧都是），characterSeeds 必须为空数组。",
  "  - locationSeeds: 仅限系列共用场地 —— 例如「每集片头的绘本封面场」「主持人演播室」。",
  "    每集自己的场地（村头小巷 / 森林 / 集市 …）严禁在此产出，必须留空。",
  "  - propSeeds: 仅限系列共用道具 —— 例如「片头翻开的故事书」「串场的沙漏」。",
  "    每集专属道具（钓竿 / 兔子 / 长矛 …）严禁在此产出，必须留空。",
  "",
  "判断标准：若一个资产只在某一集出现、下一集就不会再用，就一定属于「每集专属」，",
  "不要放进 characterSeeds / locationSeeds / propSeeds。宁可留空，也不要塞。",
  "",
  "所有输出的 seed 仍需带 `visualLock`（跨镜头稳定视觉锁）。",
].join("\n");

export function buildStoryBibleSystem(ctx: StoryBibleCtx): string {
  const meta = CONTENT_TYPE_REGISTRY[ctx.contentType];
  if (ctx.presetKey === "series") {
    return [
      `你是资深${meta.zh}内容顾问。根据用户给出的项目基础信息，生成一份精简的「系列设定」+ 仅系列共用级别的资产 seeds。`,
      "严格输出 JSON 对象，不要 markdown 围栏，不要多余文字。JSON schema：",
      SERIES_SCHEMA_HINT.replace(/}$/, "").trim() +
        ",\n  " +
        ASSET_SEEDS_SCHEMA_HINT.replace(/^{|}$/g, "").trim() +
        "\n}",
      `内容形态：${meta.zh} — ${meta.desc}。每集独立成篇，无长弧钩子/反派体系/节奏曲线等戏剧密度字段。`,
      "所有字段用简体中文。",
      SERIES_ASSET_SEEDS_RULES,
    ].join("\n");
  }

  // world preset
  return [
    `你是资深${meta.zh}编剧顾问。根据用户给出的项目基础信息，生成一份完整的「世界设定」+ 全量的资产 seeds。`,
    "严格输出 JSON 对象，不要 markdown 围栏，不要多余文字。JSON schema：",
    WORLD_SCHEMA_HINT.replace(/}$/, "").trim() +
      ",\n  " +
      ASSET_SEEDS_SCHEMA_HINT.replace(/^{|}$/g, "").trim() +
      "\n}",
    ctx.isDrama
      ? "项目是连续剧（drama），主线跨集连续、集尾钩子强，主角单一。"
      : "项目是选集剧（series），每集独立主角/主题，共享世界观。",
    `内容形态：${meta.zh} — ${meta.desc}。设定要贴合该形态的叙事节奏与画面语言。`,
    "所有字段用简体中文。pacingPlan.beatsPerEpisode 建议 3–6。",
    ASSET_SEEDS_RULES,
  ].join("\n");
}
