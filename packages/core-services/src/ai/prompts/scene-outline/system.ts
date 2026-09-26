/**
 * Scene Outline system prompt builder (Stage D).
 */

import { CONTENT_TYPE_REGISTRY, type ContentType } from "@dramaflow/domain";
import type { SceneOutlineCtx } from "./index.js";

const PERSONA_BY_CONTENT: Record<ContentType, string> = {
  educational_story:
    "你是儿童教育故事的段落规划师。把一篇成语/寓言小故事拆成若干段落骨架，每段完成一个叙事任务（起因/尝试/挫折/领悟/金句）。",
  picture_book:
    "你是绘本跨页规划师。把一册绘本故事拆成若干跨页画面，每页承载一个可视化的情感节拍。",
  documentary:
    "你是纪录片分场编导。把一集纪录内容拆成若干分场，每场对应一段真实素材或访谈单元。",
  comic:
    "你是漫画分镜编剧。把一话漫画拆成若干分镜段落，每段决定一个可视化的关键节拍。",
  animation:
    "你是动画分场编剧。把一集动画拆成若干场次，每场承担一个成长节拍或视觉记忆点。",
  motion_comic:
    "你是动态漫画分镜师。把一集动态漫画拆成若干强冲突场景。",
  short_drama:
    "你是短剧分镜师。基于剧集目标/冲突/结尾钩子，拆解本集的 N 个场次骨架。",
};

const BEAT_HINT_BY_CONTENT: Record<ContentType, string> = {
  educational_story:
    "第 1 段建立情境，中段呈现主角的错误尝试与冲突，收束在领悟金句。语气亲切、寓教于乐。",
  picture_book:
    "第 1 跨页建立情境，中段温柔冲突或想象力段落，收束在温暖落点。语气短句、有画面感、可押韵。",
  documentary:
    "第 1 场建立真实背景，中段推进人物冲突或议题张力，收束在开放式追问。语气克制、纪实感强。",
  comic: "开场建立情境，中段升级冲突，收束推进悬念钩子。语气镜头感强、留白紧凑。",
  animation:
    "开场建立情境，中段升级冲突，收束推进悬念钩子。语气镜头感强、留白紧凑。",
  motion_comic:
    "开场建立情境，中段升级冲突，收束推进悬念钩子。语气镜头感强、留白紧凑。",
  short_drama:
    "开场（第 1 场）建立情境；收束（最后一场）推进集尾钩子；中段升级冲突。语气短剧化：冲突强、爽点密集。",
};

export function buildSceneOutlineSystem(ctx: SceneOutlineCtx): string {
  const meta = CONTENT_TYPE_REGISTRY[ctx.contentType];
  const persona = PERSONA_BY_CONTENT[ctx.contentType];
  const beat = BEAT_HINT_BY_CONTENT[ctx.contentType];
  return [
    persona,
    `内容形态：${meta.zh}（${meta.desc}）。`,
    beat,
    "严格输出 JSON 数组，不要 markdown 围栏，不要多余文字。每项 schema：",
    '{ "title": string, "summary": string, "dramaticGoal": string, "conflict": string, "timeOfDay": "day" | "night" | "dusk" | "dawn", "shots": [{ "dialogue": string, "action": string, "shotType"?: string, "intent"?: string }] }',
    "shots 说明（方案 A · 必填）：",
    "  - 每个 scene 拆 1~4 个 shot，覆盖本场核心动作与台词。短场 1~2 个即可，长场最多 4 个。",
    "  - dialogue：该 shot 的完整台词。多角色对话用换行分隔，格式 `角色名：台词`。纯动作/氛围镜头留空字符串。",
    "  - action：该 shot 的画面/动作/情绪描述，20~120 字，聚焦可视化行为，不写抽象心理描写。",
    "  - shotType：可选，用行业术语（Wide / Medium / Close-up / Over-the-shoulder / Handheld tracking …）。",
    "  - intent：可选，一句话说明本 shot 想传达的情绪或信息点。",
    "  - 严禁把整段剧情堆在一个 shot 里；宁可拆细，也不要合并。",
    "全部字段使用简体中文。",
  ].join("\n");
}
