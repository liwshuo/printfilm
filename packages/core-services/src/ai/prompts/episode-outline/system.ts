/**
 * Episode Outline system prompt builder (Stage B) — P0-B 内容饱满化升级。
 *
 * 参考项目共识：
 *   - 0xsline：四段节奏曲线（起势 15% / 攀升 30% / 风暴 35% / 决战 20%）+ 五种钩子
 *   - huobao：段落 8~15s、~500字/分钟 → sceneCountEstimate 由 AI 倒推
 *   - zenstory：episode outline 必含 arc_beats + hook_type
 *
 * 综合方案 §4.B：按 contentType 分支 persona + styleHint + item noun。
 */

import { CONTENT_TYPE_REGISTRY, type ContentType } from "@dramaflow/domain";
import type { EpisodeOutlineCtx } from "./index.js";

const PERSONA_BY_CONTENT: Record<ContentType, string> = {
  educational_story:
    "你是儿童教育故事编剧，擅长把成语/寓言/生活道理转化为温暖生动的小故事。",
  picture_book:
    "你是绘本故事作者，擅长为亲子共读设计温柔、有想象力、押韵简洁的独立小故事。",
  documentary:
    "你是纪录片脚本策划，擅长把真实人物/事件拆解为可拍摄的分集结构。",
  comic: "你是漫画连载编剧，擅长设计每一话的钩子与人物动线。",
  animation: "你是动画剧集编剧，擅长设计每集独立看点与视觉记忆点。",
  motion_comic: "你是动态漫画编剧，擅长把强冲突场景切分为可分镜的分集节奏。",
  short_drama:
    "你是短剧结构编剧，擅长冲突强、节奏快、爽点密集的分集大纲。",
};

const STYLE_BY_CONTENT: Record<ContentType, string> = {
  educational_story:
    "语气亲切、寓教于乐；每集聚焦一个成语/寓言/生活道理；结尾金句代替'爽点'，不使用悬念钩子；hookType 建议：learning_anchor / moral_reveal / emotion。",
  picture_book:
    "语气温柔、有想象力；每册围绕一个可反复共读的温暖内核；结尾留白，方便亲子对话；hookType 建议：emotion / imagination / reveal。",
  documentary:
    "语气克制、纪实感强；每集聚焦一个真实议题下的人物切面；结尾用开放式追问代替强钩子；hookType 建议：mystery / open_question / reveal。",
  comic:
    "语气紧凑、镜头感强；每话末尾留一个可视化悬念；hookType 建议：cliffhanger / conflict / reveal。",
  animation:
    "语气有画面感、注重角色成长；集尾留成长伏笔；hookType 建议：cliffhanger / emotion / reveal。",
  motion_comic:
    "语气强冲突、场景切换鲜明；集尾抛新悬念；hookType 建议：cliffhanger / conflict / reveal。",
  short_drama:
    "语气短剧化：冲突强、节奏快、爽点密集；集尾强钩子牵引下一集；hookType 建议：cliffhanger / conflict / reveal。",
};

const ITEM_NOUN_BY_CONTENT: Record<ContentType, string> = {
  educational_story: "篇",
  picture_book: "册",
  documentary: "集",
  comic: "话",
  animation: "集",
  motion_comic: "集",
  short_drama: "集",
};

/** 单集期望时长（秒）默认值。 */
const DEFAULT_ITEM_DURATION_SEC: Record<ContentType, number> = {
  educational_story: 90,
  picture_book: 60,
  documentary: 180,
  comic: 90,
  animation: 120,
  motion_comic: 90,
  short_drama: 120,
};

export function buildEpisodeOutlineSystem(ctx: EpisodeOutlineCtx): string {
  const meta = CONTENT_TYPE_REGISTRY[ctx.contentType];
  const persona = PERSONA_BY_CONTENT[ctx.contentType];
  const style = STYLE_BY_CONTENT[ctx.contentType];
  const itemNoun = ITEM_NOUN_BY_CONTENT[ctx.contentType];
  const projectShape = ctx.isDrama
    ? "连续型项目（drama）：跨条目主线连贯，累计设定/人物不可回退。"
    : "系列型项目（series）：每条目相对独立，可复用世界底色但情节自成一集。";

  const durationSec = ctx.itemDurationSecHint ?? DEFAULT_ITEM_DURATION_SEC[ctx.contentType];
  // huobao 段 8~15s → 场次数量粗略估算：durationSec / 12s
  const roughSceneCount = Math.max(3, Math.min(12, Math.round(durationSec / 12)));

  return [
    persona,
    `内容形态：${meta.zh}（${meta.desc}）。`,
    projectShape,
    style,
    "",
    "【严格输出】JSON 数组，不要 markdown 围栏，不要多余文字。每项 schema：",
    `{
  "episodeNo": number,
  "title": string,
  "summary": string,
  "episodeGoal": string,
  "episodeConflict": string,
  "episodeTurn": string,
  "episodeEndingHook": string,
  "hookType": string,
  "arcBeats": [
    { "phase": "opening", "description": string, "weight": 0.15 },
    { "phase": "rising",  "description": string, "weight": 0.30 },
    { "phase": "storm",   "description": string, "weight": 0.35 },
    { "phase": "climax",  "description": string, "weight": 0.20 }
  ],
  "learningAnchor": string,
  "sceneCountEstimate": number,
  "ageHint": string
}`,
    "",
    "所有字段用简体中文。字段释义：",
    `- title：本${itemNoun}标题（简短，可含 "第 N ${itemNoun} · 关键词"）`,
    `- summary：本${itemNoun}一句话故事梗概（≤80 字）`,
    `- episodeGoal：本${itemNoun}的核心目标 / 想让观众收获什么`,
    `- episodeConflict：本${itemNoun}的核心冲突或误区`,
    `- episodeTurn：本${itemNoun}的关键转折 / 领悟点`,
    `- episodeEndingHook：本${itemNoun}的结尾落点（钩子 / 金句 / 追问 / 情感落点，按内容形态而定）`,
    `- hookType：结尾钩子分类，从 [cliffhanger, mystery, conflict, emotion, reveal, learning_anchor, open_question, moral_reveal, imagination] 里选一个最贴切的`,
    `- arcBeats：四段节奏曲线，长度必须是 4，phase 依次是 opening/rising/storm/climax，description 用简体中文短句概括这一段发生了什么（参考 0xsline 15%/30%/35%/20%）`,
    ctx.contentType === "educational_story"
      ? `- learningAnchor：本篇要传递的核心成语 / 寓意 / 学科知识点（必填，尽量精炼到 2~8 字）`
      : `- learningAnchor：可为空。仅当有明确知识/道理锚点时填写`,
    `- sceneCountEstimate：预估本${itemNoun}拆成多少个场次（scene）。参考单${itemNoun}期望时长 ${durationSec} 秒，按 8~15 秒/段规则，建议区间 3~12，本项默认建议 ${roughSceneCount}`,
    `- ageHint：目标受众年龄段（e.g. "6-9 岁" / "12+" / "全年龄"），不确定就填 "全年龄"`,
    "",
    "【硬约束】",
    "1) episodeNo 由服务层覆盖，你可以省略或任意填。",
    "2) 若用户给出 topicHint（下方 user prompt 中的「主题 Hint」），必须严格按照该主题写：如果 topicHint 是一个成语，返回的这条 outline 必须就是这个成语的故事，不能替换成其它相似成语；title 必须直接包含 topicHint 关键词。",
    "3) 若下方给出 existingTitles（已生成过的分集标题列表），你输出的任何一项都不得与其重复或近义，尤其是同类成语不要换个字重复。",
    "4) arcBeats 每一项 description 都必须与该项 phase 的节奏语义一致：opening 建立/引入；rising 尝试与挫折；storm 冲突高点；climax 领悟或结尾金句。",
  ].join("\n");
}
