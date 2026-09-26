/**
 * 火山方舟 Ark Provider 配置（内置模型清单）。
 *
 * 来源：/Users/bytedance/Documents/trae_projects/printfilm/types/model.ts
 *  - BUILTIN_PROVIDERS -> volcengine-ark
 *  - BUILTIN_CHAT_MODELS -> doubao-seed-2-0-lite-260428（默认）+ pro / thinking
 *  - BUILTIN_IMAGE_MODELS -> doubao-seedream-5-0-260128
 *  - BUILTIN_VIDEO_MODELS -> doubao-seedance-2-0-mini-260615
 */

export const ARK_BASE_URL = "https://ark.cn-beijing.volces.com";

export const ARK_CHAT_ENDPOINT = "/api/v3/chat/completions";
export const ARK_IMAGE_ENDPOINT = "/api/v3/images/generations";
export const ARK_VIDEO_TASK_ENDPOINT = "/api/v3/contents/generations/tasks";

export const DEFAULT_CHAT_MODEL_ID = "doubao-seed-2-0-lite-260428";
export const DEFAULT_IMAGE_MODEL_ID = "doubao-seedream-5-0-260128";
export const DEFAULT_VIDEO_MODEL_ID = "doubao-seedance-2-0-mini-260615";

export const BUILTIN_CHAT_MODELS = [
  {
    id: "doubao-seed-2-0-lite-260428",
    name: "Doubao Seed 2.0 Lite",
    apiModel: "doubao-seed-2-0-lite-260428",
    description: "结构化分场/分镜、事件抽取（默认）",
  },
  {
    id: "doubao-seed-2-1-pro-260628",
    name: "Doubao Seed 2.1 Pro",
    apiModel: "doubao-seed-2-1-pro-260628",
    description: "长文本结构化解析、分镜规划、复杂推理",
  },
  {
    id: "doubao-seed-1-6-thinking-agent-preview",
    name: "Doubao Seed 1.6 Thinking",
    apiModel: "doubao-seed-1-6-thinking-agent-preview",
    description: "思维链模型，适合规则推理",
  },
] as const;

export const BUILTIN_IMAGE_MODELS = [
  {
    id: "doubao-seedream-5-0-260128",
    name: "Seedream 5.0",
    apiModel: "doubao-seedream-5-0-260128",
    description: "火山方舟图片生成",
  },
] as const;

export const BUILTIN_VIDEO_MODELS = [
  {
    id: "doubao-seedance-2-0-mini-260615",
    name: "Seedance 2.0 Mini",
    apiModel: "doubao-seedance-2-0-mini-260615",
    description: "文/图生视频（异步任务 + 轮询）",
  },
] as const;

/**
 * 各视频模型支持的 resolution 白名单（依据 Ark 官方文档 `Doubao-Seedance-2.0`）：
 *  - Seedance 2.0 mini：仅支持 480p / 720p（1080p、4k 不支持）
 *  - Seedance 2.0 fast：仅支持 480p / 720p
 *  - Seedance 2.0：支持 480p / 720p / 1080p / 4k
 *  - Seedance 1.0 pro：支持 480p / 720p / 1080p
 *
 * 说明：如果调用方传了不在白名单里的 resolution，`ark-video.ts` 会在提交前
 * clamp 到该模型允许的最高档，避免 Ark 直接返回 400 InvalidParameter。
 */
export const VIDEO_MODEL_RESOLUTION_CAPS: Record<string, ReadonlyArray<"480p" | "720p" | "1080p" | "4k">> = {
  "doubao-seedance-2-0-mini-260615": ["480p", "720p"],
};

/**
 * i2v（图生视频）场景下的 resolution 白名单。
 *
 * 官方（AtlasCloud / Berry API 的 `doubao-seedance-2-0-mini-260615`
 * reference-to-video 文档）：i2v 场景支持 480p / 720p 两档，与 t2v 一致。
 *
 * 历史踩坑：2026-09-25 曾观测到 Ark 400
 *   `InvalidParameter: the parameter resolution specified in the request is
 *    not valid for model doubao-seedance-2-0-mini in i2v`
 * 当时把 i2v 收窄到仅 480p，后经与官方文档核对——mini 在 i2v 场景确实
 * 支持 720p，那次 400 更可能是请求里其它字段（image_url.role / ratio）
 * 触发。此处保持与 t2v 相同能力集，如再复现 400 InvalidParameter，
 * 应从 image_url 结构（去 role 字段）、ratio（尝试 "adaptive"）等方向排查，
 * 而不是继续收窄 resolution。
 */
export const VIDEO_MODEL_I2V_RESOLUTION_CAPS: Record<string, ReadonlyArray<"480p" | "720p" | "1080p" | "4k">> = {
  "doubao-seedance-2-0-mini-260615": ["480p", "720p"],
};

/** 各模型默认分辨率（未显式指定时使用）。 */
export const VIDEO_MODEL_DEFAULT_RESOLUTION: Record<string, "480p" | "720p" | "1080p" | "4k"> = {
  "doubao-seedance-2-0-mini-260615": "720p",
};

/** i2v 场景下各模型的默认分辨率（未显式指定时使用）。 */
export const VIDEO_MODEL_I2V_DEFAULT_RESOLUTION: Record<string, "480p" | "720p" | "1080p" | "4k"> = {
  "doubao-seedance-2-0-mini-260615": "720p",
};

/**
 * 运行时（Web UI 保存）Key 覆盖层。
 *
 * 优先级：runtime override > ARK_API_KEY > ANTSK_API_KEY > API_KEY。
 * 运行时 Key 由 desktop-server 的 POST /api/ai/config 写入；持久化由
 * desktop-server 侧负责（写入 .runtime/ai.env），core-services 不做磁盘 IO。
 */
let runtimeApiKey: string | undefined;

export function setRuntimeApiKey(key: string | undefined): void {
  const trimmed = key?.trim();
  runtimeApiKey = trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function getRuntimeApiKey(): string | undefined {
  return runtimeApiKey;
}

/**
 * 从 runtime override + 环境变量解析 API Key。Node 服务端专用。
 * 前端浏览器场景由 web 侧负责传入 header（本项目暂不涉及）。
 */
export function resolveApiKey(): string | undefined {
  if (runtimeApiKey) return runtimeApiKey;
  const key =
    process.env.ARK_API_KEY ||
    process.env.ANTSK_API_KEY ||
    process.env.API_KEY;
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

export function isProviderReady(): boolean {
  return !!resolveApiKey();
}

export type KeySource = "runtime" | "ARK_API_KEY" | "ANTSK_API_KEY" | "API_KEY";

export interface ProviderStatus {
  ready: boolean;
  provider: "volcengine-ark";
  baseUrl: string;
  defaultModels: {
    chat: string;
    image: string;
    video: string;
  };
  keySource?: KeySource;
  /** 遮罩后的 Key 预览，形如 `sk-****abcd`，仅用于 UI 显示。 */
  keyPreview?: string;
  hint?: string;
}

/** 只显示末 4 位，其余用 `*` 遮罩。 */
export function maskKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const tail = key.slice(-4);
  const head = key.startsWith("sk-") ? "sk-" : key.slice(0, 2);
  return `${head}****${tail}`;
}

export function getProviderStatus(): ProviderStatus {
  const key = resolveApiKey();
  const keySource: KeySource | undefined = runtimeApiKey
    ? "runtime"
    : process.env.ARK_API_KEY
      ? "ARK_API_KEY"
      : process.env.ANTSK_API_KEY
        ? "ANTSK_API_KEY"
        : process.env.API_KEY
          ? "API_KEY"
          : undefined;
  return {
    ready: !!key,
    provider: "volcengine-ark",
    baseUrl: ARK_BASE_URL,
    defaultModels: {
      chat: DEFAULT_CHAT_MODEL_ID,
      image: DEFAULT_IMAGE_MODEL_ID,
      video: DEFAULT_VIDEO_MODEL_ID,
    },
    keySource,
    keyPreview: maskKey(key),
    hint: key
      ? undefined
      : "在 /models 页填入 ARK_API_KEY，或 export ARK_API_KEY=<your_ark_key>（复用 trae_projects/printfilm 的 KEY 即可）",
  };
}
