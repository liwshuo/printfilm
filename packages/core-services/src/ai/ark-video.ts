/**
 * Ark Video Adapter — 火山方舟 Seedance 视频（异步任务 + 轮询）。
 * POST /api/v3/contents/generations/tasks   → 拿 task_id
 * GET  /api/v3/contents/generations/tasks/{id} → 轮询到 status=succeeded 取 output URL
 *
 * P0（综合方案 M4 修正）：
 *  - body 补齐 `resolution / ratio / duration / camera_fixed / generate_audio / return_last_frame`（M4#4/#6/#7）。
 *  - `watermark: false` 显式关水印（M4#1）。
 *  - 首尾帧接受 base64 或 URL；`content[]` 里按 role 传。
 */

import {
  ARK_BASE_URL,
  ARK_VIDEO_TASK_ENDPOINT,
  DEFAULT_VIDEO_MODEL_ID,
  VIDEO_MODEL_RESOLUTION_CAPS,
  VIDEO_MODEL_DEFAULT_RESOLUTION,
  VIDEO_MODEL_I2V_RESOLUTION_CAPS,
  VIDEO_MODEL_I2V_DEFAULT_RESOLUTION,
  resolveApiKey,
} from "./ark-config.js";
import {
  AiApiKeyError,
  AiUpstreamError,
  type VideoOptions,
  type VideoResult,
  type VideoResolution,
  type VideoRatio,
} from "./types.js";

/**
 * 全局兜底默认分辨率。历史上写死为 "1080p"，但 Seedance 2.0 mini 只支持
 * 480p/720p，会导致 Ark 直接返回 400 InvalidParameter。改为 "720p" 与 Ark
 * 文档一致，同时保留按模型能力再次 clamp（见 resolveResolution）。
 */
const DEFAULT_RESOLUTION: VideoResolution = "720p";
const DEFAULT_RATIO: VideoRatio = "9:16";
const DEFAULT_DURATION = 5;

/** 分辨率档位从高到低，用于 clamp 到模型能力范围内的最高档。 */
const RESOLUTION_RANK: ReadonlyArray<VideoResolution> = [
  "1080p",
  "720p",
  "480p",
];

function resolveResolution(
  modelId: string,
  requested: VideoResolution | undefined,
  isI2V: boolean,
): VideoResolution {
  const caps = isI2V
    ? (VIDEO_MODEL_I2V_RESOLUTION_CAPS[modelId] ?? VIDEO_MODEL_RESOLUTION_CAPS[modelId])
    : VIDEO_MODEL_RESOLUTION_CAPS[modelId];
  const modelDefault = ((isI2V
    ? VIDEO_MODEL_I2V_DEFAULT_RESOLUTION[modelId]
    : undefined) ??
    VIDEO_MODEL_DEFAULT_RESOLUTION[modelId] ??
    DEFAULT_RESOLUTION) as VideoResolution;
  const target: VideoResolution = requested ?? modelDefault;
  if (!caps || caps.length === 0) return target;
  if ((caps as ReadonlyArray<string>).includes(target)) return target;
  // 从高到低找一个模型支持的最高档；找不到再回退 caps[0]
  const highest = RESOLUTION_RANK.find((r) =>
    (caps as ReadonlyArray<string>).includes(r),
  );
  return (highest ?? (caps[0] as VideoResolution)) as VideoResolution;
}

/** 解析 Ark 返回的 error body，提取 code/message，便于日志一眼定位。 */
function formatArkError(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: string; message?: string; type?: string };
    };
    const e = parsed.error;
    if (e?.code || e?.message) {
      return `HTTP ${status} ${e.code ?? ""} ${e.message ?? ""}`.trim();
    }
  } catch {
    // 非 JSON，透传原文
  }
  return text ? `HTTP ${status} ${text}` : `HTTP ${status}`;
}

export async function submitArkVideoTask(opts: VideoOptions): Promise<{
  taskId: string;
  modelId: string;
  raw: unknown;
}> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new AiApiKeyError();

  const modelId = opts.modelId?.trim() || DEFAULT_VIDEO_MODEL_ID;
  const isI2V = Boolean(opts.firstFrame || opts.lastFrame);
  const resolution = resolveResolution(modelId, opts.resolution, isI2V);
  const ratio = opts.ratio ?? DEFAULT_RATIO;
  const duration = clampDuration(opts.duration ?? DEFAULT_DURATION);
  const cameraFixed = opts.cameraFixed ?? false;
  const generateAudio = opts.generateAudio ?? true;
  const returnLastFrame = opts.returnLastFrame ?? true;

  const body: Record<string, unknown> = {
    model: modelId,
    content: buildContent(opts),
    resolution,
    ratio,
    duration,
    camera_fixed: cameraFixed,
    generate_audio: generateAudio,
    return_last_frame: returnLastFrame,
    watermark: false,
  };

  const res = await fetch(`${ARK_BASE_URL}${ARK_VIDEO_TASK_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AiUpstreamError(formatArkError(res.status, text), res.status);
  }
  const data = (await res.json()) as { id?: string; task_id?: string };
  const taskId = data.id || data.task_id;
  if (!taskId) throw new AiUpstreamError("视频任务创建失败：未返回 task_id", res.status);
  return { taskId, modelId, raw: data };
}

export async function pollArkVideoTask(
  taskId: string,
  opts: {
    intervalMs?: number;
    maxWaitMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<VideoResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new AiApiKeyError();
  const interval = opts.intervalMs ?? 5_000;
  const maxWait = opts.maxWaitMs ?? 20 * 60_000;
  const started = Date.now();
  const url = `${ARK_BASE_URL}${ARK_VIDEO_TASK_ENDPOINT}/${encodeURIComponent(taskId)}`;

  while (Date.now() - started < maxWait) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: opts.signal,
    });
    if (!res.ok) {
      // 网络抖动 / 5xx，间隔再试
      await sleep(interval);
      continue;
    }
    const data = (await res.json()) as {
      status?: string;
      content?: { video_url?: string; last_frame_url?: string };
      outputs?: Array<{ url?: string }>;
      last_frame_url?: string;
      error?: { message?: string };
    };
    const status = String(data.status ?? "").toLowerCase();
    if (status === "succeeded" || status === "completed") {
      const videoUrl = data.content?.video_url || data.outputs?.[0]?.url || "";
      if (!videoUrl) {
        throw new AiUpstreamError("视频任务成功但未返回 video_url", 200);
      }
      const lastFrameUrl = data.content?.last_frame_url || data.last_frame_url;
      return {
        videoUrl,
        lastFrameUrl,
        taskId,
        modelId: DEFAULT_VIDEO_MODEL_ID,
        raw: data,
      };
    }
    if (status === "failed" || status === "error") {
      throw new AiUpstreamError(data.error?.message || "视频任务失败", 500);
    }
    await sleep(interval);
  }
  throw new AiUpstreamError(`视频任务超时（${maxWait / 1000}s）`, 408);
}

export async function generateArkVideo(opts: VideoOptions): Promise<VideoResult> {
  const { taskId } = await submitArkVideoTask(opts);
  return pollArkVideoTask(taskId, {
    intervalMs: opts.pollingIntervalMs,
    maxWaitMs: opts.maxPollingMs,
    signal: opts.signal,
  });
}

function clampDuration(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_DURATION;
  return Math.max(3, Math.min(15, Math.round(v)));
}

function buildContent(opts: VideoOptions): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [{ type: "text", text: opts.prompt }];
  const first = opts.firstFrame;
  if (first) {
    items.push({
      type: "image_url",
      image_url: first.base64
        ? { url: `data:image/png;base64,${first.base64}` }
        : { url: first.url ?? "" },
      role: "first_frame",
    });
  }
  const last = opts.lastFrame;
  if (last) {
    items.push({
      type: "image_url",
      image_url: last.base64
        ? { url: `data:image/png;base64,${last.base64}` }
        : { url: last.url ?? "" },
      role: "last_frame",
    });
  }
  return items;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
