/**
 * Story Bible pack (Stage A · World / Series Setting).
 *
 * 综合方案 §4.A：world / series 两个 preset 共享一个 pack；具体走哪个由
 * ctx.presetKey 决定。pack.schema 是 discriminatedUnion —— 但 LLM 不会
 * 主动输出 `_kind` 字段，所以 pack 层用 `runStoryBiblePack` 包一层，
 * 在 zod parse 前手动注入 `_kind`。
 */

import type { z } from "zod";
import { CONTENT_TYPE_REGISTRY, type ContentType } from "@dramaflow/domain";
import { AiUpstreamError } from "../../types.js";
import { callArkChat } from "../../ark-chat.js";
import type { PromptPack } from "../pack.js";
import { definePack } from "../pack.js";
import { buildStoryBibleSystem } from "./system.js";
import { buildStoryBibleUser } from "./user.js";
import {
  StoryBibleSchema,
  StoryBibleWorldSchema,
  StoryBibleSeriesSchema,
  type StoryBibleParsed,
} from "./schema.js";

/**
 * Story Bible pack 的输入上下文。
 *
 * - `presetKey` 决定用 world / series schema，也决定 system prompt 的
 *   人设与 JSON schema 描述。
 */
export interface StoryBibleCtx {
  presetKey: "world" | "series";
  contentType: ContentType;
  projectName: string;
  genre: string;
  audience: string;
  complianceMode: string;
  existingGenreHint?: string;
  isDrama: boolean;
}

/**
 * pack 定义 —— schema 是 union，`runStoryBiblePack` 内部按 preset 选具体分支。
 */
export const storyBiblePack: PromptPack<StoryBibleCtx, typeof StoryBibleSchema> =
  definePack({
    stage: "story_bible",
    buildSystem: buildStoryBibleSystem,
    buildUser: buildStoryBibleUser,
    schema: StoryBibleSchema,
    defaults: {
      temperature: 0.55,
      maxTokens: 4096,
    },
  });

/**
 * 执行一次 Story Bible LLM 调用。返回按 preset 分支的强类型对象。
 *
 * 走定制 runner（不用通用 `runPack`）是因为：LLM 不吐 `_kind`，需要在
 * zod parse 前手动注入。
 */
export async function runStoryBiblePack(
  ctx: StoryBibleCtx,
): Promise<StoryBibleParsed> {
  // 校验 contentType 存在
  if (!CONTENT_TYPE_REGISTRY[ctx.contentType]) {
    throw new AiUpstreamError(
      `[story_bible] 未知 contentType：${ctx.contentType}`,
      400,
    );
  }

  const systemPrompt = storyBiblePack.buildSystem(ctx);
  const userPrompt = storyBiblePack.buildUser(ctx);

  const res = await callArkChat({
    systemPrompt,
    prompt: userPrompt,
    responseFormat: "json",
    temperature: storyBiblePack.defaults.temperature,
    maxTokens: storyBiblePack.defaults.maxTokens,
    // Story Bible + 资产 seeds 一次性 4~6k tokens 输出，60s 常常不够；给到 3 分钟。
    timeoutMs: 180_000,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.content) as Record<string, unknown>;
  } catch (err) {
    throw new AiUpstreamError(
      `[story_bible] LLM 返回非 JSON：${(err as Error).message}；原文前 200 字：${res.content.slice(0, 200)}`,
      200,
    );
  }

  // 按 preset 选具体 schema —— 不注入 `_kind`，直接用具体 schema 校验
  const target: z.ZodTypeAny =
    ctx.presetKey === "series" ? StoryBibleSeriesSchema : StoryBibleWorldSchema;
  const injected = { ...parsed, _kind: ctx.presetKey };
  const result = target.safeParse(injected);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 6)
      .map((iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`)
      .join("；");
    throw new AiUpstreamError(
      `[story_bible] LLM 输出未通过 schema 校验：${issues}`,
      200,
    );
  }
  return result.data as StoryBibleParsed;
}

export * from "./schema.js";
