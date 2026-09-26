/**
 * AI Provider 类型定义（chat / image / video 三模态）。
 *
 * P0（综合方案 M4）：
 *  - image 用 `IMAGE_SIZE_PRESETS` 档位；默认 `b64_json` + `watermark:false`；不再暴露 negative_prompt。
 *  - video 补齐 `resolution / ratio / duration / cameraFixed / generateAudio / returnLastFrame`。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** 系统提示（可选，会作为 role=system 消息插入到最前）。 */
  systemPrompt?: string;
  /** 主提示词。 */
  prompt: string;
  /** 显式指定 model id / apiModel（火山方舟接入点 ID 形如 `ep-xxxx` 也可以）。 */
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** 要求模型返回 JSON（会走 `response_format={type:"json_object"}`）。 */
  responseFormat?: "text" | "json";
  /** 超时毫秒，默认 60_000。 */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  modelId: string;
  raw?: unknown;
}

// ============================================================
// Image (Seedream 5.0)
// ============================================================

/**
 * Seedream 目前接受的 `size` 档位（不是任意 W×H）。
 * 综合方案 §6.2：只暴露档位选择；UI 只在这个集合里选。
 *
 * 兼容注意：Seedream 4.x / SeedEdit 等新模型要求 image size ≥ 3,686,400 pixels
 * （约 2K 画质），老档位如 1024x1024 / 1024x1792 会被 400 拒绝。以下档位排在
 * 前面的即为「2K+ 达标」，可安全用作默认；老档位仅保留兼容旧数据。
 */
export const IMAGE_SIZE_PRESETS = [
  // 2K+ 档位（Seedream 4.x 强制要求；面积 ≥ 3,686,400 px）
  "1440x2560", // 9:16 竖屏（P1 主推）
  "2560x1440", // 16:9 横屏
  "1728x2304", // 3:4 & 4:5 竖屏
  "2304x1728", // 4:3 & 5:4 横屏
  "2048x2048", // 1:1
  // 老档位（Seedream 5.0 及以下兼容；新模型会 400）
  "1024x1024",
  "1024x1792",
  "1792x1024",
  "1152x2048",
  "2048x1152",
] as const;

export type ImageSizePreset = (typeof IMAGE_SIZE_PRESETS)[number];

/** aspect ratio → 档位默认映射（默认走 9:16 2K 竖屏，兼容 Seedream 4.x）。 */
export const ASPECT_TO_SIZE: Record<string, ImageSizePreset> = {
  "1:1": "2048x2048",
  "16:9": "2560x1440",
  "9:16": "1440x2560",
  "4:5": "1728x2304",
  "3:4": "1728x2304",
  "5:4": "2304x1728",
};

export interface ImageOptions {
  /** 主提示（英文）。 */
  prompt: string;
  /** 档位（M4#3）。默认 `1024x1792`（竖屏 9:16，短剧主用）。 */
  size?: ImageSizePreset;
  modelId?: string;
  /** 参考图 URL（image-to-image / 保持角色）。 */
  referenceImageUrls?: string[];
  seed?: number;
  /** 引导强度（默认 5.5）。 */
  guidanceScale?: number;
  /** 是否开启 seedream 组图（M4#5）；默认 false。 */
  sequentialImageGeneration?: {
    enabled: boolean;
    batchSize: number; // ≤ 15
  };
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ImageAssetPayload {
  /** M4#2：base64 落地；不再依赖 URL（默认 24h 过期）。 */
  base64: string;
  /** MIME 类型，默认 `image/png`。 */
  mimeType?: string;
}

export interface ImageResult {
  images: ImageAssetPayload[];
  modelId: string;
  raw?: unknown;
}

// ============================================================
// Video (Seedance 2.0-mini)
// ============================================================

export type VideoResolution = "480p" | "720p" | "1080p";
export type VideoRatio = "9:16" | "16:9" | "1:1" | "4:3" | "3:4";

export interface VideoOptions {
  prompt: string;
  modelId?: string;

  // === M4#4 视频体一等公民字段 ===
  /** 分辨率档位。默认 `1080p`。 */
  resolution?: VideoResolution;
  /** 画幅。默认 `9:16`。 */
  ratio?: VideoRatio;
  /** 时长（秒）。默认 5；seedance 2.0-mini 单次上限 15。 */
  duration?: number;
  /** 相机是否固定；默认 false。 */
  cameraFixed?: boolean;

  // === 首尾帧 & 音频（M4#6 / #7）===
  /** 首帧参考图（base64 或 URL）。 */
  firstFrame?: { base64?: string; url?: string };
  /** 尾帧参考图（Seedance 支持 end-frame anchor）。 */
  lastFrame?: { base64?: string; url?: string };
  /** 是否直出有声视频（默认 true）；有 dialogue/hint 时特别有价值。 */
  generateAudio?: boolean;
  /** 是否返回末帧图（用于下一 clip 接力，默认 true）。 */
  returnLastFrame?: boolean;

  pollingIntervalMs?: number;
  maxPollingMs?: number;
  signal?: AbortSignal;
}

export interface VideoResult {
  videoUrl: string;
  /** 末帧图（M4#7 return_last_frame）—— seedance 完成后返回，供下一 clip 接力使用。 */
  lastFrameUrl?: string;
  taskId: string;
  modelId: string;
  raw?: unknown;
}

// ============================================================
// Errors
// ============================================================

export class AiApiKeyError extends Error {
  constructor(msg = "ARK_API_KEY 未配置") {
    super(msg);
    this.name = "AiApiKeyError";
  }
}

export class AiUpstreamError extends Error {
  status: number;
  requestId?: string;
  constructor(msg: string, status = 0, requestId?: string) {
    super(msg);
    this.name = "AiUpstreamError";
    this.status = status;
    this.requestId = requestId;
  }
}
