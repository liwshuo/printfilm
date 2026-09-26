/**
 * Episode Outline user prompt builder (Stage B) — P0-B 内容饱满化升级。
 *
 * 关键修复：把 topicHint / existingTitles 注入 user prompt。此前追加生成
 * 时用户填的 hint 字段没有透传到 LLM，导致模型「随便挑一个成语」。
 */

import type { ContentType } from "@dramaflow/domain";
import type { EpisodeOutlineCtx } from "./index.js";

const ITEM_NOUN_BY_CONTENT: Record<ContentType, string> = {
  educational_story: "篇",
  picture_book: "册",
  documentary: "集",
  comic: "话",
  animation: "集",
  motion_comic: "集",
  short_drama: "集",
};

export function buildEpisodeOutlineUser(ctx: EpisodeOutlineCtx): string {
  const itemNoun = ITEM_NOUN_BY_CONTENT[ctx.contentType];
  const lines: string[] = [
    `项目名：${ctx.projectName}`,
    `题材：${ctx.genre ?? "未指定"}`,
    `目标受众：${ctx.audience ?? "未指定"}`,
  ];
  if (ctx.bibleLogline) lines.push(`Logline：${ctx.bibleLogline}`);
  if (ctx.bibleTheme) lines.push(`Theme：${ctx.bibleTheme}`);
  if (ctx.bibleTone) lines.push(`Tone：${ctx.bibleTone}`);
  if (ctx.bibleSetting) lines.push(`Setting：${ctx.bibleSetting}`);

  const topic = ctx.topicHint?.trim();
  if (topic) {
    lines.push("");
    lines.push(`【主题 Hint（HARD REQUIREMENT）】：${topic}`);
    lines.push(
      `→ 你返回的每一条 outline 都必须严格围绕这个主题。若该 hint 是一个成语/寓言/知识点名称，返回内容必须就是它本身的故事，不允许替换成同类别的其它成语/寓言。title 必须直接含有 "${topic}" 这几个字。`,
    );
  }

  const existing = (ctx.existingTitles ?? [])
    .map((t) => t?.trim())
    .filter((t): t is string => !!t);
  if (existing.length > 0) {
    lines.push("");
    lines.push("【已存在分集标题（禁止重复 / 近义）】：");
    for (const t of existing.slice(0, 30)) lines.push(`  - ${t}`);
  }

  lines.push("");
  lines.push(`从第 ${ctx.startNo} ${itemNoun}起续写 ${ctx.count} ${itemNoun}。`);
  lines.push(
    "请返回 JSON 数组，长度精确等于要求生成的条目数，每一项完整填齐 schema 中列出的字段（arcBeats 必须是 4 项）。",
  );
  return lines.join("\n");
}
