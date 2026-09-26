/**
 * Story Bible user prompt builder (Stage A).
 */

import type { StoryBibleCtx } from "./index.js";

export function buildStoryBibleUser(ctx: StoryBibleCtx): string {
  const lines: string[] = [
    `项目名：${ctx.projectName}`,
    `题材：${ctx.genre}`,
    `目标受众：${ctx.audience}`,
    `合规模式：${ctx.complianceMode}`,
  ];
  if (ctx.existingGenreHint) {
    lines.push(`既有题材提示：${ctx.existingGenreHint}`);
  }
  return lines.join("\n");
}
