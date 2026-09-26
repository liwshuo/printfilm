/**
 * AI Provider probe & config routes (data-and-api-v1.md §10 step 5.5).
 *
 * GET  /api/ai/status         — cheap: only reads env + runtime override, no upstream call.
 * POST /api/ai/verify         — expensive: 5-token roundtrip to Ark chat.
 * POST /api/ai/config         — save API key into runtime memory (+ optional persist to .runtime/ai.env).
 * POST /api/ai/config/clear   — remove runtime API key (+ delete .runtime/ai.env if present).
 *
 * 安全约束：
 *  - `apiKey` 只写入 runtime override + 本地 `.runtime/ai.env`（chmod 0600），
 *    绝不回显明文；GET /api/ai/status 只返回遮罩后的 `keyPreview`。
 *  - `.runtime/ai.env` 已在项目 `.gitignore`（.runtime/）保护范围内。
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { AppEnv } from "../env.js";
import {
  getProviderStatus,
  verifyChatReady,
  setRuntimeApiKey,
  getRuntimeApiKey,
} from "@dramaflow/core-services";

const AI_ENV_FILE = path.join(process.cwd(), ".runtime", "ai.env");

/**
 * 从 `.runtime/ai.env` 载入持久化的 API Key 到 runtime override。
 * 文件格式：`ARK_API_KEY=xxx`，一行一个 KV，`#` 开头为注释。
 * 若解析出的值为空则忽略。
 */
export async function loadPersistedAiConfig(): Promise<{ loaded: boolean; keySource?: string }> {
  if (!existsSync(AI_ENV_FILE)) return { loaded: false };
  try {
    const raw = await fs.readFile(AI_ENV_FILE, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key === "ARK_API_KEY" && val) {
        setRuntimeApiKey(val);
        return { loaded: true, keySource: "runtime(persisted)" };
      }
    }
  } catch {
    // ignore — corrupt file shouldn't crash the server.
  }
  return { loaded: false };
}

async function persistKey(apiKey: string): Promise<void> {
  const dir = path.dirname(AI_ENV_FILE);
  await fs.mkdir(dir, { recursive: true });
  const content =
    "# printfilm-next AI provider runtime config\n" +
    "# 由 /models 页保存，仅本地进程读取；请勿提交到 git。\n" +
    `ARK_API_KEY=${apiKey}\n`;
  await fs.writeFile(AI_ENV_FILE, content, { mode: 0o600 });
}

async function removePersistedKey(): Promise<void> {
  if (!existsSync(AI_ENV_FILE)) return;
  await fs.unlink(AI_ENV_FILE);
}

export function aiRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/ai/status", (c) => c.json(getProviderStatus()));

  r.post("/ai/verify", async (c) => {
    const res = await verifyChatReady();
    return c.json({ ...getProviderStatus(), ping: res });
  });

  r.post("/ai/config", async (c) => {
    let body: { apiKey?: unknown; persist?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json(
        { code: "invalid_input", message: "请求体不是合法 JSON", retryable: false },
        400,
      );
    }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      return c.json(
        { code: "invalid_input", message: "apiKey 不能为空", retryable: false },
        400,
      );
    }
    if (apiKey.length < 8) {
      return c.json(
        { code: "invalid_input", message: "apiKey 长度过短（<8）", retryable: false },
        400,
      );
    }
    setRuntimeApiKey(apiKey);
    const persist = body.persist === true;
    if (persist) {
      await persistKey(apiKey);
    }
    return c.json({ ...getProviderStatus(), persisted: persist });
  });

  r.post("/ai/config/clear", async (c) => {
    setRuntimeApiKey(undefined);
    await removePersistedKey();
    return c.json({ ...getProviderStatus(), cleared: true });
  });

  return r;
}

/** For tests / debug only. */
export function _debugCurrentRuntimeKey(): string | undefined {
  return getRuntimeApiKey();
}
