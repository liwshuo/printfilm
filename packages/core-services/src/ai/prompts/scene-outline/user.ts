/**
 * Scene Outline user prompt builder (Stage D).
 */

import type { ContentType } from "@dramaflow/domain";
import type { SceneOutlineCtx } from "./index.js";

const UNIT_NOUN_BY_CONTENT: Record<ContentType, string> = {
  educational_story: "段落",
  picture_book: "跨页",
  documentary: "分场",
  comic: "分镜",
  animation: "分场",
  motion_comic: "分镜",
  short_drama: "场次",
};

export function buildSceneOutlineUser(ctx: SceneOutlineCtx): string {
  const unitNoun = UNIT_NOUN_BY_CONTENT[ctx.contentType];
  const lines = [
    `EP${ctx.episodeNo}${ctx.episodeTitle ? ` · ${ctx.episodeTitle}` : ""}`,
    ctx.episodeSummary ? `本集摘要：${ctx.episodeSummary}` : "",
    ctx.episodeGoal ? `本集目标：${ctx.episodeGoal}` : "",
    ctx.episodeConflict ? `本集冲突：${ctx.episodeConflict}` : "",
    ctx.episodeTurn ? `本集反转：${ctx.episodeTurn}` : "",
    ctx.episodeEndingHook ? `集尾落点：${ctx.episodeEndingHook}` : "",
    formatAssets(ctx.assets),
    `请拆解为 ${ctx.count} 个${unitNoun}骨架。优先复用上面「已有资产」中的角色 / 场景 / 道具（保证跨镜头视觉一致性），不要另起同类新名字。`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** 用简洁的多行结构把资产 seeds 塞进 user prompt。空资产直接返回空串。 */
function formatAssets(assets: SceneOutlineCtx["assets"]): string {
  if (!assets) return "";
  const chars = (assets.characters ?? []).filter((c) => c.name);
  const locs = (assets.locations ?? []).filter((l) => l.name);
  const props = (assets.props ?? []).filter((p) => p.name);
  if (chars.length === 0 && locs.length === 0 && props.length === 0) return "";

  const parts: string[] = ["已有资产（优先复用；visualLock 会用于关键帧生成，保持跨镜头一致）："];
  if (chars.length > 0) {
    parts.push("· 角色：");
    for (const c of chars) {
      const tags = [c.roleType, c.visualLock].filter(Boolean).join(" / ");
      parts.push(`  - ${c.name}${tags ? `（${tags}）` : ""}`);
    }
  }
  if (locs.length > 0) {
    parts.push("· 场景：");
    for (const l of locs) {
      const tags = [l.locationType, l.visualLock].filter(Boolean).join(" / ");
      parts.push(`  - ${l.name}${tags ? `（${tags}）` : ""}`);
    }
  }
  if (props.length > 0) {
    parts.push("· 道具：");
    for (const p of props) {
      const tags = [p.visualLock].filter(Boolean).join(" / ");
      parts.push(`  - ${p.name}${tags ? `（${tags}）` : ""}`);
    }
  }
  return parts.join("\n");
}
