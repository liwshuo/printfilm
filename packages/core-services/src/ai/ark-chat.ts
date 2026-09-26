/**
 * Ark Chat Adapter。抄自 trae_projects/printfilm/services/adapters/chatAdapter.ts。
 *
 * 关键行为：
 *  - Bearer 鉴权，OpenAI 兼容 chat/completions schema。
 *  - 3 次退避重试（1s / 2s / 3s），但 400/401/403 不重试。
 *  - `responseFormat=json` → 走 `response_format={type:"json_object"}`，返回时剥离 ```json 围栏。
 *  - 显式识别火山方舟「未开通接入点」错误，转为可读中文。
 *  - 默认超时 60_000ms。
 */

import {
  ARK_BASE_URL,
  ARK_CHAT_ENDPOINT,
  DEFAULT_CHAT_MODEL_ID,
  resolveApiKey,
} from "./ark-config.js";
import { AiApiKeyError, AiUpstreamError, ChatOptions, ChatResult } from "./types.js";

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function cleanJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "");
  s = s.replace(/```\s*$/, "");
  return s.trim();
}

/**
 * Node undici 抛出的 `TypeError: fetch failed` 会把真实 socket / DNS / TLS 错误
 * 藏在 `err.cause`（可能是普通 Error，也可能是 AggregateError）。这里做一次
 * 递归展开，返回一条对排障友好的字符串：
 *   `fetch failed | ENOTFOUND ark.cn-beijing.volces.com`
 *   `fetch failed | UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error`
 *   `fetch failed | AggregateError: ETIMEDOUT ...; ECONNREFUSED ...`
 * 不改变异常语义，只强化诊断信息。
 */
function describeFetchError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const parts: string[] = [msg];
  const seen = new Set<unknown>();
  let cur: unknown = (err as { cause?: unknown })?.cause;
  while (cur !== undefined && cur !== null && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof AggregateError) {
      const inner = cur.errors
        .map((e) =>
          [
            (e as { code?: string })?.code,
            (e as Error)?.message,
          ]
            .filter(Boolean)
            .join(": "),
        )
        .join("; ");
      parts.push(`AggregateError: ${inner}`);
      break;
    }
    const code = (cur as { code?: string })?.code;
    const cm = (cur as Error)?.message;
    parts.push([code, cm].filter(Boolean).join(": "));
    cur = (cur as { cause?: unknown })?.cause;
  }
  return parts.filter((p) => p && p.length > 0).join(" | ");
}

export async function callArkChat(opts: ChatOptions): Promise<ChatResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new AiApiKeyError();

  const modelId = opts.modelId?.trim() || DEFAULT_CHAT_MODEL_ID;
  const messages: { role: string; content: string }[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: opts.prompt });

  const requestBody: Record<string, unknown> = {
    model: modelId,
    messages,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.maxTokens !== undefined) requestBody.max_tokens = opts.maxTokens;
  if (opts.topP !== undefined) requestBody.top_p = opts.topP;
  if (opts.responseFormat === "json") {
    requestBody.response_format = { type: "json_object" };
  }

  const timeout = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const detach: Array<() => void> = [];
  if (opts.signal) {
    const onAbort = () => controller.abort();
    if (opts.signal.aborted) onAbort();
    else {
      opts.signal.addEventListener("abort", onAbort);
      detach.push(() => opts.signal!.removeEventListener("abort", onAbort));
    }
  }

  const doFetch = async (): Promise<Response> => {
    return fetch(`${ARK_BASE_URL}${ARK_CHAT_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  };

  const maxAttempts = 3;
  let lastError: unknown;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await doFetch();
        if (res.ok) {
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          let content = data.choices?.[0]?.message?.content ?? "";
          if (opts.responseFormat === "json") content = cleanJson(content);
          return { content, modelId, raw: data };
        }
        const errText = await res.text().catch(() => "");
        let errMsg = errText || `HTTP ${res.status}`;
        try {
          const j = JSON.parse(errText) as { error?: { message?: string } };
          if (j?.error?.message) errMsg = j.error.message;
        } catch {
          /* not JSON */
        }
        const normalized = errMsg.toLowerCase();
        const requestIdMatch = errMsg.match(/request id:\s*([a-z0-9]+)/i);
        const requestId = requestIdMatch?.[1];
        if (
          normalized.includes("model or endpoint") &&
          normalized.includes("does not exist")
        ) {
          throw new AiUpstreamError(
            `当前对话模型不可用：${modelId}。请到火山方舟控制台开通并创建「推理接入点」（ep-xxxx），然后把 ChatOptions.modelId 改成你的 ep-xxxx。原始错误：${errMsg}`,
            res.status,
            requestId,
          );
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          throw new AiUpstreamError(errMsg, res.status, requestId);
        }
        // 5xx / 429 / 网络抖动 → 可重试
        lastError = new AiUpstreamError(errMsg, res.status, requestId);
        if (attempt < maxAttempts) {
          await sleep(1000 * attempt, opts.signal);
          continue;
        }
        throw lastError;
      } catch (err) {
        if (err instanceof AiUpstreamError && (err.status === 400 || err.status === 401 || err.status === 403)) {
          throw err;
        }
        // 网络/socket/TLS 层错误：把 err.cause 展开到 message，方便排障。
        // 不影响错误类型判断——AbortError 依旧按名字识别。
        if ((err as Error)?.name === "AbortError") {
          lastError = err;
          throw err;
        }
        if (
          err instanceof TypeError &&
          (err as Error).message === "fetch failed"
        ) {
          const detailed = new Error(describeFetchError(err));
          (detailed as Error & { cause?: unknown }).cause = err;
          lastError = detailed;
        } else {
          lastError = err;
        }
        if (attempt < maxAttempts) {
          await sleep(1000 * attempt, opts.signal);
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } finally {
    clearTimeout(timer);
    detach.forEach((f) => f());
  }
}

/** 用最小成本探活：发一次 5-token 的请求，返回结构化结果。 */
export interface ChatVerifyResult {
  ok: boolean;
  modelId?: string;
  finishReason?: string;
  status?: number;
  error?: string;
  message?: string;
}

export async function verifyChatReady(): Promise<ChatVerifyResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) return { ok: false, error: "ARK_API_KEY 未配置" };
  try {
    const res = await fetch(`${ARK_BASE_URL}${ARK_CHAT_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_CHAT_MODEL_ID,
        messages: [{ role: "user", content: "仅返回1" }],
        temperature: 0.1,
        max_tokens: 5,
      }),
    });
    if (res.ok) {
      let modelId: string | undefined;
      let finishReason: string | undefined;
      try {
        const body = (await res.json()) as {
          model?: string;
          choices?: Array<{ finish_reason?: string }>;
        };
        modelId = body.model;
        finishReason = body.choices?.[0]?.finish_reason;
      } catch {
        /* ignore body parse */
      }
      return {
        ok: true,
        modelId: modelId ?? DEFAULT_CHAT_MODEL_ID,
        finishReason,
        message: "ok",
      };
    }
    const text = await res.text();
    return {
      ok: false,
      status: res.status,
      error: text.slice(0, 300),
      message: `${res.status} ${text.slice(0, 200)}`,
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, error: msg, message: msg };
  }
}
