/**
 * Episode Asset Seeds prompt pack (Series 分集资产 seeds).
 *
 * 场景：series 项目下，每一集在拆场次之前，基于该集的 title/summary/goal/conflict/turn
 * 生成本集专属的角色 / 场景 / 道具 seeds，落 `episodeId = 该集`。
 *
 * 与 story-bible pack 区别：
 *   - 输入：episode（title/summary/goal/conflict/turn/hookSetup）+ 项目级已有资产（避免重复）
 *   - 输出：仅 `characterSeeds` / `locationSeeds` / `propSeeds`（复用 AssetSeedsSchema）
 *   - 目的：让 Scene Outline 拿到"本集专属"资产，不再把上一集的道具错误复用到本集
 *
 * 参考：drama-skills continuity-lock — 每一 unit story 都要重新盘视觉锁；
 * 因为 series 的每集就是 unit story，seeds 属于本 unit。
 */

import { AiUpstreamError } from "../../types.js";
import { callArkChat } from "../../ark-chat.js";
import { AssetSeedsSchema, type AssetSeeds } from "../story-bible/schema.js";
import { CONTENT_TYPE_REGISTRY, type ContentType } from "@dramaflow/domain";

/**
 * 项目级已有资产快照，注入 prompt 提示 LLM「不要重复起名」。
 */
export interface EpisodeAssetSeedsCtx {
  contentType: ContentType;
  projectName: string;
  episode: {
    episodeNo: number;
    title: string;
    /** 该集 summary / logline —— 决定角色和场地。 */
    summary?: string;
    /** 该集戏剧目标。 */
    dramaticGoal?: string;
    /** 该集冲突（教育故事：错误行为）。 */
    conflict?: string;
    /** 该集转折（教育故事：领悟点）。 */
    turnPoint?: string;
    /** 该集钩子（少数形态才有）。 */
    hookSetup?: string;
  };
  /** 项目级已有资产 —— 传入 name 就够了，用来避免 LLM 重名。 */
  existingProjectAssets: {
    characters: string[];
    locations: string[];
    props: string[];
  };
  /**
   * Round-3 P2-③ 跨集资产复用提示。
   *
   * 传入其它集专属的角色/场景/道具名（附上来自哪集）。
   * LLM 的语义与项目级"避免重名"不同：这里不是禁止使用，而是"如果本集
   * 会出现同样的角色/场景，请复用原名，不要造小同大异的新名字"。
   */
  otherEpisodeAssets?: {
    characters: Array<{ name: string; fromEpisode: number }>;
    locations: Array<{ name: string; fromEpisode: number }>;
    props: Array<{ name: string; fromEpisode: number }>;
  };
}

const SCHEMA_HINT = `{
  "characterSeeds": Array<{
    "name": string,          // 该集角色名（如 "阿墨"、"渔夫甲"）；不得与已有 existingProjectAssets.characters 同名
    "role": string,          // protagonist / antagonist / mentor / supporting / comic / narrator
    "personalityCore": string,
    "visualLock": string,    // 关键帧稳定视觉锁：外观 / 服饰 / 发型 / 主色 / 剪影 / 标志物
    "ageHint": string        // 例："学龄儿童 8-10 岁" / "花甲老人" / ""
  }>,
  "locationSeeds": Array<{
    "name": string,          // 该集场地名（如 "村头老槐树下"）
    "spaceType": string,     // 室内 / 室外 / 交界 / 幻想空间 / 抽象
    "atmosphere": string,    // 一句话氛围
    "visualLock": string     // 主色 / 材质 / 光线 / 标志物
  }>,
  "propSeeds": Array<{
    "name": string,          // 本集关键道具名
    "purpose": string,       // 在本集里的作用：象征 / 推动 / 转折触发
    "visualLock": string
  }>
}`;

function buildSystem(ctx: EpisodeAssetSeedsCtx): string {
  const meta = CONTENT_TYPE_REGISTRY[ctx.contentType];
  return [
    `你是资深${meta.zh}分集责编。任务：根据【本集内容】产出「本集专属」的角色 / 场景 / 关键道具 seeds，供后续拆场次和关键帧生成引用。`,
    "严格输出 JSON 对象，不要 markdown 围栏，不要多余文字。JSON schema：",
    SCHEMA_HINT,
    "",
    "【必须遵守的规则】",
    "1. 只输出「本集」出现的资产 —— 不要为了凑数把其它可能存在的角色/场地也塞进来。",
    "2. 每个 seed 必须带 `visualLock`（跨镜头稳定视觉锁）：外观 / 服饰 / 发型 / 主色 / 剪影 / 标志物，用一到三句名词短语。",
    "3. visualLock 不要写动作、不要写情绪 —— 它是「模型可以逐字复用的画面描述」。",
    "4. name 必须避开项目级已有资产 —— 已有名单会在 user 消息中给出；即使概念相似也要换个具名（避免和项目级共用角色混同）。",
    "5. 若某类资产本集不出现（例如某集没有独立道具），对应数组返回空 `[]`。",
    "6. characterSeeds 通常 1-4 项（本集出场角色），locationSeeds 通常 1-3 项，propSeeds 通常 0-3 项，上限 20。",
    "7. 所有字段用简体中文（visualLock 也用中文名词短语）。",
    "",
    `内容形态：${meta.zh} — ${meta.desc}。每集独立成篇。`,
  ].join("\n");
}

function buildUser(ctx: EpisodeAssetSeedsCtx): string {
  const ep = ctx.episode;
  const existing = ctx.existingProjectAssets;

  const existingLines: string[] = [];
  if (existing.characters.length > 0) {
    existingLines.push(`- 项目级角色：${existing.characters.join(" / ")}`);
  }
  if (existing.locations.length > 0) {
    existingLines.push(`- 项目级场景：${existing.locations.join(" / ")}`);
  }
  if (existing.props.length > 0) {
    existingLines.push(`- 项目级道具：${existing.props.join(" / ")}`);
  }
  const existingBlock =
    existingLines.length > 0
      ? ["【项目级已有资产 —— 请避免同名】", ...existingLines].join("\n")
      : "【项目级已有资产】暂无。";

  // Round-3 P2-③：跨集资产复用提示。
  //   与项目级"避免重名"相反：这里希望 LLM 若本集出现同一角色/场景，直接沿用他集已有名字，
  //   而不是造小同大异（"李阿墨"/"墨墨"/"阿默"）的分身。
  const other = ctx.otherEpisodeAssets;
  const otherLines: string[] = [];
  if (other) {
    const formatList = (
      list: Array<{ name: string; fromEpisode: number }>,
    ): string => list.map((x) => `${x.name}(EP${x.fromEpisode})`).join(" / ");
    if (other.characters.length > 0) {
      otherLines.push(`- 他集角色：${formatList(other.characters)}`);
    }
    if (other.locations.length > 0) {
      otherLines.push(`- 他集场景：${formatList(other.locations)}`);
    }
    if (other.props.length > 0) {
      otherLines.push(`- 他集道具：${formatList(other.props)}`);
    }
  }
  const otherBlock =
    otherLines.length > 0
      ? [
          "【其它集已有资产 —— 若本集会用到同一个人/地/物，请复用原名，避免造出分身】",
          ...otherLines,
        ].join("\n")
      : "";

  const epLines: string[] = [
    `EP${ep.episodeNo}｜${ep.title}`,
    ep.summary ? `- 一句话故事：${ep.summary}` : null,
    ep.dramaticGoal ? `- 戏剧目标：${ep.dramaticGoal}` : null,
    ep.conflict ? `- 冲突/错误：${ep.conflict}` : null,
    ep.turnPoint ? `- 转折/领悟：${ep.turnPoint}` : null,
    ep.hookSetup ? `- 集尾钩子：${ep.hookSetup}` : null,
  ].filter((s): s is string => Boolean(s));

  return [
    `项目：${ctx.projectName}`,
    existingBlock,
    otherBlock,
    "",
    "【本集内容】",
    ...epLines,
    "",
    "请直接输出符合 schema 的 JSON。",
  ]
    .filter((s) => s !== "")
    .join("\n");
}

/**
 * 执行一次 Episode Asset Seeds LLM 调用。
 */
export async function runEpisodeAssetSeedsPack(
  ctx: EpisodeAssetSeedsCtx,
): Promise<AssetSeeds> {
  if (!CONTENT_TYPE_REGISTRY[ctx.contentType]) {
    throw new AiUpstreamError(
      `[episode_asset_seeds] 未知 contentType：${ctx.contentType}`,
      400,
    );
  }

  const systemPrompt = buildSystem(ctx);
  const userPrompt = buildUser(ctx);

  const res = await callArkChat({
    systemPrompt,
    prompt: userPrompt,
    responseFormat: "json",
    temperature: 0.55,
    maxTokens: 2048,
    // 单集 seeds 一般 1-2k tokens 就够，60s 通常够用；对齐 story_bible 给 120s 兜底。
    timeoutMs: 120_000,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.content);
  } catch (err) {
    throw new AiUpstreamError(
      `[episode_asset_seeds] LLM 返回非 JSON：${(err as Error).message}；原文前 200 字：${res.content.slice(0, 200)}`,
      200,
    );
  }
  const result = AssetSeedsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 6)
      .map((iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`)
      .join("；");
    throw new AiUpstreamError(
      `[episode_asset_seeds] LLM 输出未通过 schema 校验：${issues}`,
      200,
    );
  }
  return result.data;
}
