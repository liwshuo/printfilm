/**
 * PromptPack — 阶段化 prompt 组织的统一契约（综合方案 §4 §7）。
 *
 * 每个阶段都是一个包（目录 `prompts/<stage>/`）：
 *   - `system.ts`  → `buildSystem(ctx): string`
 *   - `user.ts`    → `buildUser(ctx): string`
 *   - `schema.ts`  → 一个 zod schema（输出契约）
 *   - `index.ts`   → 用 `definePack` 拼装成 PromptPack 导出
 *
 * 调用方 `runPack(pack, ctx)`：
 *   1. build system+user prompt
 *   2. callArkChat（response_format=json_object）
 *   3. JSON.parse + envelope unwrap（{episodes:[...]}/{items:[...]} 之类兜底）
 *   4. zod parse
 *   5. 全过程失败统一抛 `AiUpstreamError` —— 外层 Service 会转成 `provider_unavailable`
 */

import { z, type ZodTypeAny } from "zod";
import { callArkChat } from "../ark-chat.js";
import { AiUpstreamError } from "../types.js";

/** 单个阶段的 LLM 调用参数。可以按 stage 定制。 */
export interface PackCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  modelId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * PromptPack 契约。
 *
 * @template Ctx    构建 prompt 所需的输入（由具体阶段自己定义）。
 * @template Schema zod schema 类型（`.parse` 后是最终输出）。
 */
export interface PromptPack<Ctx, Schema extends ZodTypeAny> {
  /** 阶段名，用于日志与错误提示（例：`story_bible`）。 */
  readonly stage: string;
  /** 输出 zod schema（会在 `runPack` 内 `parse`）。 */
  readonly schema: Schema;
  /** 构建 system prompt。 */
  buildSystem(ctx: Ctx): string;
  /** 构建 user prompt。 */
  buildUser(ctx: Ctx): string;
  /** 该阶段的默认 LLM 参数（temperature / max_tokens 等）。 */
  readonly defaults: PackCallOptions;
  /**
   * 可选：LLM 有时会把数组塞进 wrapper 对象，如 `{episodes:[...]}`。
   * 声明可能的 wrapper key，`runPack` 先在 wrapper 里找数组再喂给 schema。
   *
   * 只对期望输出为数组的阶段有意义；对象类阶段留空。
   */
  readonly envelopeKeys?: readonly string[];
}

export function definePack<Ctx, Schema extends ZodTypeAny>(
  spec: PromptPack<Ctx, Schema>,
): PromptPack<Ctx, Schema> {
  return spec;
}

/**
 * 执行一次 pack 调用，返回 zod parse 后的强类型结果。
 *
 * 失败时抛 {@link AiUpstreamError}（外层 Service 会转成
 * `provider_unavailable` domain error）。
 */
export async function runPack<Ctx, Schema extends ZodTypeAny>(
  pack: PromptPack<Ctx, Schema>,
  ctx: Ctx,
  overrides: PackCallOptions = {},
): Promise<z.infer<Schema>> {
  const systemPrompt = pack.buildSystem(ctx);
  const userPrompt = pack.buildUser(ctx);

  const res = await callArkChat({
    systemPrompt,
    prompt: userPrompt,
    responseFormat: "json",
    temperature: overrides.temperature ?? pack.defaults.temperature,
    maxTokens: overrides.maxTokens ?? pack.defaults.maxTokens,
    topP: overrides.topP ?? pack.defaults.topP,
    modelId: overrides.modelId ?? pack.defaults.modelId,
    timeoutMs: overrides.timeoutMs ?? pack.defaults.timeoutMs,
    signal: overrides.signal ?? pack.defaults.signal,
  });

  // 1) JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.content);
  } catch (err) {
    throw new AiUpstreamError(
      `[${pack.stage}] LLM 返回非 JSON：${(err as Error).message}；原文前 200 字：${res.content.slice(0, 200)}`,
      200,
    );
  }

  // 2) envelope unwrap —— 有些模型会把数组塞进 wrapper key
  if (
    pack.envelopeKeys &&
    pack.envelopeKeys.length > 0 &&
    !Array.isArray(parsed) &&
    parsed !== null &&
    typeof parsed === "object"
  ) {
    const bag = parsed as Record<string, unknown>;
    for (const key of pack.envelopeKeys) {
      const v = bag[key];
      if (Array.isArray(v)) {
        parsed = v;
        break;
      }
    }
  }

  // 2.5) 单条兜底 —— 当 schema 期望数组、但 LLM 返回单个对象（常见于 count=1
  // 的"单场重生"场景，LLM 只回一条时容易把外层数组吃掉），自动包一层 `[obj]`。
  // 只在展开后仍是"非空对象且不像 wrapper"时兜底，避免把 wrapper 误当 item。
  if (
    pack.schema instanceof z.ZodArray &&
    !Array.isArray(parsed) &&
    parsed !== null &&
    typeof parsed === "object"
  ) {
    // 若 parsed 仍是 wrapper（键集合几乎全是 envelopeKeys 里的），不要包裹，
    // 让 zod 报出真实错误，方便定位。
    const bag = parsed as Record<string, unknown>;
    const envelopeSet = new Set(pack.envelopeKeys ?? []);
    const keys = Object.keys(bag);
    const isPureWrapper =
      keys.length > 0 && keys.every((k) => envelopeSet.has(k));
    if (!isPureWrapper) {
      parsed = [parsed];
    }
  }

  // 3) zod parse
  const result = pack.schema.safeParse(parsed);
  if (!result.success) {
    // zod 错误摘要（限制体量，避免 200KB 长错误串爆前端）
    const issues = result.error.issues
      .slice(0, 6)
      .map((iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`)
      .join("；");
    throw new AiUpstreamError(
      `[${pack.stage}] LLM 输出未通过 schema 校验：${issues}`,
      200,
    );
  }
  return result.data;
}
