/**
 * Ark Image Adapter — 火山方舟 Seedream 5.0 图片生成。
 * 接口：POST /api/v3/images/generations（同步返回 base64）。
 *
 * P0（综合方案 M4 修正）：
 *  - `watermark: false` 强制关水印（默认为 true 会带水印）。
 *  - `response_format: "b64_json"` 强制 base64 返回（默认 URL 24h 过期）。
 *  - `size` 用 `IMAGE_SIZE_PRESETS` 档位（不接受任意 W×H）。
 *  - 移除 `negative_prompt`（未来由 pack 层通过 visual_lock_negative 拼进 prompt）。
 */

import {
  ARK_BASE_URL,
  ARK_IMAGE_ENDPOINT,
  DEFAULT_IMAGE_MODEL_ID,
  resolveApiKey,
} from "./ark-config.js";
import {
  AiApiKeyError,
  AiUpstreamError,
  IMAGE_SIZE_PRESETS,
  type ImageOptions,
  type ImageResult,
  type ImageSizePreset,
} from "./types.js";

const DEFAULT_SIZE: ImageSizePreset = "1440x2560"; // 9:16 竖屏（Seedream 4.x 2K+ 达标）

export async function callArkImage(opts: ImageOptions): Promise<ImageResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new AiApiKeyError();

  const modelId = opts.modelId?.trim() || DEFAULT_IMAGE_MODEL_ID;
  const timeout = opts.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (opts.signal) {
    const onAbort = () => controller.abort();
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  // 校验 size 档位（外部误传直接抛，避免 seedream 报 400 后前端难排查）
  const size = opts.size ?? DEFAULT_SIZE;
  if (!IMAGE_SIZE_PRESETS.includes(size)) {
    throw new AiUpstreamError(
      `[image] size 不在档位内：${size}；允许档位：${IMAGE_SIZE_PRESETS.join(", ")}`,
      400,
    );
  }

  const body: Record<string, unknown> = {
    model: modelId,
    prompt: opts.prompt,
    size,
    response_format: "b64_json",
    watermark: false,
    n: 1,
  };
  // `guidance_scale` 在 Seedream 4.x / Seededit 等新模型上已被移除，Ark 会直接
  // 400 报 `InvalidParameter`。只有当调用方显式传值时才下发，兼容 Seedream 5.0
  // 老模型 + Seedream 4.x 新模型。默认不带该字段。
  if (opts.guidanceScale !== undefined) {
    body.guidance_scale = opts.guidanceScale;
  }
  if (opts.seed !== undefined) body.seed = opts.seed;
  if (opts.referenceImageUrls && opts.referenceImageUrls.length > 0) {
    body.reference_image_urls = opts.referenceImageUrls;
  }
  // M4#5 组图（P1 接入 keyframe plan 后再走这条路）
  if (opts.sequentialImageGeneration?.enabled) {
    const batch = Math.max(2, Math.min(15, opts.sequentialImageGeneration.batchSize));
    body.sequential_image_generation = { enabled: true, batch_size: batch };
    body.n = batch;
  }

  try {
    const res = await fetch(`${ARK_BASE_URL}${ARK_IMAGE_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AiUpstreamError(text || `HTTP ${res.status}`, res.status);
    }
    const data = (await res.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };

    const images = (data.data ?? [])
      .map((d): { base64: string; mimeType: string } | null => {
        if (d.b64_json && d.b64_json.length > 0) {
          return { base64: d.b64_json, mimeType: "image/png" };
        }
        // fallback：万一模型忽略 response_format 只返回 URL —— 抛错让上层处置
        return null;
      })
      .filter((x): x is { base64: string; mimeType: string } => x !== null);

    if (images.length === 0) {
      throw new AiUpstreamError(
        "[image] Ark 未返回可用的 b64_json；请检查 response_format 是否被上游忽略",
        200,
      );
    }

    return {
      images,
      modelId,
      raw: data,
    };
  } finally {
    clearTimeout(timer);
  }
}
