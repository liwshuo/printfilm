/**
 * @dramaflow/web — REST client for the desktop-server Hono API.
 *
 * NOTE: This file was reconstructed after an accidental truncation. It
 * mirrors the earlier surface as recovered from every caller
 * (`apps/web/src/**`) and the backend routes (`apps/desktop-server/src/routes`).
 *
 * Design:
 *   - Base `api` client wraps fetch with typed JSON I/O + ApiError.
 *   - Domain re-exports from `@dramaflow/domain` keep SSOT for
 *     ContentType / VisualStyle / StorySettingPreset registries.
 *   - Resource collections (`projects`, `storyboards`, `prompts`, ...) are
 *     thin wrappers that keep call sites terse.
 *
 * Auth: none — local single-user desktop app.
 */

import { report } from "./logger";

// =====================================================================
// Base client + error handling
// =====================================================================

/**
 * 直连 desktop-server 而非走 Next.js dev rewrite。
 *
 * 原因：图片生成同步接口耗时 30~50s，Next.js 14 dev 的 rewrite 代理层
 * （内部使用 undici）对慢响应会中途切断连接，前端会收到"HTTP 500"（body
 * 为空、code 为 http_error），但服务端其实成功处理并返回 201。这会让 UX
 * 出现"图片生成好像失败了，但刷新之后又都在"的诡异现象。
 *
 * 解决：让浏览器直连 5174，绕过 Next dev proxy。desktop-server 已开
 * `Access-Control-Allow-Origin: *`（apps/desktop-server/src/server.ts），
 * 直连不会有 CORS 问题。
 *
 * SSR 侧仍可通过 next.config.mjs 的 rewrite 兜底（虽然此前端目前是纯 CSR）。
 * 生产/打包时可以通过 `NEXT_PUBLIC_DRAMAFLOW_API_BASE` 环境变量指向部署后
 * 的后端域名，或者留空使用相对路径（此时会走同源反代）。
 */
const API_BASE = (() => {
  const explicit =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_DRAMAFLOW_API_BASE
      : undefined;
  if (explicit && explicit.length > 0) return explicit.replace(/\/+$/, "");
  // 浏览器环境默认直连本地 desktop-server；SSR 环境退回相对路径（保持原行为）。
  if (typeof window !== "undefined") return "http://127.0.0.1:5174";
  return "";
})();

/** 拼接 API 请求 URL：绝对 URL 直通，`/api/...` 补前缀。 */
function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE) return path;
  return API_BASE + path;
}

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details: unknown;

  constructor(status: number, env: ApiErrorEnvelope | null) {
    const code = env?.code ?? "http_error";
    const message = env?.message ?? `HTTP ${status}`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = env?.retryable ?? false;
    this.details = env?.details;
  }
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  let res: Response;
  try {
    res = await fetch(resolveUrl(path), init);
  } catch (netErr) {
    // 网络层失败（比如 desktop-server 未启动 / 5174 端口不通 / rewrite 找不到目标）
    // 显式抛 ApiError，方便页面统一展示。
    // eslint-disable-next-line no-console
    console.error("[api] network error", method, path, netErr);
    void report("error", "api.network_error", {
      message: netErr instanceof Error ? netErr.message : String(netErr),
      stack: netErr instanceof Error ? netErr.stack : undefined,
      extra: { method, path },
    });
    throw new ApiError(0, {
      code: "network_error",
      message: `无法连接后端 (${method} ${path})：${netErr instanceof Error ? netErr.message : String(netErr)}`,
    });
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.error("[api] http error", method, path, res.status, parsed ?? text);
    const env = (parsed as ApiErrorEnvelope) ?? null;
    // Report >=5xx and 0 (network) as error; expected 4xx (domain rules) as warn.
    void report(res.status >= 500 || res.status === 0 ? "error" : "warn", "api.http_error", {
      message: env?.message ?? `HTTP ${res.status}`,
      extra: {
        method,
        path,
        status: res.status,
        code: env?.code,
        details: env?.details,
      },
    });
    throw new ApiError(res.status, env);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  /** `del` (not `delete`) since `delete` is a reserved word for object methods. */
  del: <T>(path: string) => request<T>("DELETE", path),
};

// =====================================================================
// Domain re-exports — SSOT for ContentType / VisualStyle / StorySettingPreset
// =====================================================================

export {
  CONTENT_TYPES,
  CONTENT_TYPE_REGISTRY,
  VISUAL_STYLE_PRESETS,
  STORY_SETTING_PRESETS,
  contentTypesForProjectType,
  isContentTypeSupported,
  getStorySettingPreset,
} from "@dramaflow/domain";

export type {
  ContentType,
  ContentTypeMeta,
  VisualStylePreset,
  ProjectVisualStyle,
  StorySettingPresetKey,
  StorySettingPresetMeta,
  StorySettingFieldMeta,
} from "@dramaflow/domain";

// =====================================================================
// Shared client types (loose but caller-safe)
// =====================================================================

export type ProjectType = "series" | "drama";
export type ComplianceMode = "domestic" | "overseas";
export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "archived";
  projectType: ProjectType;
  contentType: import("@dramaflow/domain").ContentType;
  visualStyle: import("@dramaflow/domain").ProjectVisualStyle;
  complianceMode: ComplianceMode;
  genre?: string;
  audience?: string;
  aspectRatio: AspectRatio;
  targetDurationSec?: number;
  episodeCount: number;
  language: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ArcBeatPhase = "opening" | "rising" | "storm" | "climax";

export interface ArcBeat {
  phase: ArcBeatPhase;
  description: string;
  weight?: number;
}

export interface Episode {
  id: string;
  projectId: string;
  episodeNo: number;
  title?: string;
  summary?: string;
  hookType?: string;
  episodeGoal?: string;
  episodeConflict?: string;
  episodeTurn?: string;
  episodeEndingHook?: string;
  /** 四段节奏 opening/rising/storm/climax（可选，参考 0xsline/short-drama） */
  arcBeats?: ArcBeat[];
  /** 教学/寓意锚点，成语故事/教育向内容会填充 */
  learningAnchor?: string;
  /** AI 估算的场次数（1..20），前端不再手动输入 */
  sceneCountEstimate?: number;
  /** 目标观众提示，例如 3–6 岁 / 8–12 岁 / 泛用 */
  ageHint?: string;
  storyStatus: "draft" | "confirmed";
  scriptStatus: "draft" | "confirmed";
  storyboardStatus: "draft" | "confirmed" | "partial";
  productionStatus: "idle" | "queued" | "running" | "partial" | "done" | "failed";
  reviewStatus: "pending" | "passed" | "failed";
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoryBible {
  id: string;
  projectId: string;
  episodeId?: string;
  logline?: string;
  theme?: string;
  tone?: string;
  worldRules?: Record<string, unknown>;
  hookSystem?: Record<string, unknown>;
  pacingPlan?: Record<string, unknown>;
  villainSystem?: Record<string, unknown>;
  characterRelations?: Record<string, unknown>;
  sourceRef?: { origin?: string; generatedAt?: string };
  version: number;
}

export type AssetKind = "character" | "location" | "prop";

export interface EpisodeAssetRef {
  episodeId: string;
  assetType: AssetKind;
  assetId: string;
  note?: string;
  createdAt?: string;
}

export interface AssetSummary {
  id: string;
  name?: string;
  [k: string]: unknown;
}

export interface AvailableAssets {
  characters: AssetSummary[];
  locations: AssetSummary[];
  props: AssetSummary[];
}

export interface Scene {
  id: string;
  episodeId: string;
  sceneNo?: number;
  sortOrder?: number;
  title?: string;
  summary?: string;
  description?: string;
  dramaticGoal?: string;
  hook?: string;
  pacing?: string;
  notes?: string;
  entryState?: Record<string, unknown>;
  exitState?: Record<string, unknown>;
  storyboardStatus: "draft" | "confirmed";
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Shot {
  id: string;
  sceneId: string;
  shotNo: number;
  shotType?: string;
  intent?: string;
  dialogue?: string;
  action?: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface PromptSpec {
  id: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  targetType?: string;
  status: "draft" | "confirmed" | "superseded";
  positivePrompt?: string;
  negativePrompt?: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface ContinuityLock {
  id: string;
  projectId: string;
  episodeId?: string;
  scope?: string;
  status?: string;
  lockPhrase?: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
}

export type ReviewIssueSeverity = "critical" | "high" | "medium" | "low";
export type ReviewIssueTier =
  | "structural_invariant"
  | "reviewed_invariant"
  | "craft_default"
  | "taste_option";

export interface ReviewIssue {
  id: string;
  projectId: string;
  episodeId?: string;
  runId?: string;
  severity: ReviewIssueSeverity;
  ruleId?: string;
  ruleCode?: string;
  ruleTier?: ReviewIssueTier;
  issueType?: string;
  status: "open" | "resolved" | "ignored" | "reopened";
  title?: string;
  detail?: string;
  description?: string;
  suggestion?: string;
  scope?: string;
  createdAt?: string;
  updatedAt?: string;
  // Loose escape hatch — extra fields returned by the server can be rendered directly.
  [k: string]: any;
}

export interface QualityScores {
  overall?: number;
  coherence?: number;
  pacing?: number;
  hook?: number;
  format?: number;
  dialogue?: number;
  [k: string]: number | undefined;
}

export interface ReviewRun {
  id: string;
  projectId: string;
  episodeId?: string;
  scopeType?: string;
  scopeRefId?: string;
  reviewTypes: string[];
  status: string; // "queued" | "running" | "succeeded" | "failed" (looser to match legacy callers)
  verdict?: string;
  qualityScores?: QualityScores;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  [k: string]: unknown;
}

export interface RunRulePacksResult {
  runId: string;
  verdict: string; // "passed" | "blocked" — loosened to accept legacy variants
  createdIssueIds: string[];
  qualityScores: QualityScores;
  blockingCount: number;
  advisoryCount: number;
}

export interface ExportBundle {
  id: string;
  projectId: string;
  scopeType?: string;
  scopeRefId?: string;
  bundleType?: string;
  status: string; // domain 里为 "queued"|"running"|"ready"|"failed"，caller 还兼容 "pending"|"composing" 老状态
  outputPath?: string;
  errorMessage?: string;
  version: number;
  versionLabel?: string;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

// -- AI provider (ark) --

export interface AiProviderStatus {
  ready: boolean;
  provider: "volcengine-ark";
  baseUrl: string;
  defaultModels: {
    chat: string;
    image: string;
    video: string;
  };
  keySource?: "runtime" | "ARK_API_KEY" | "ANTSK_API_KEY" | "API_KEY";
  keyPreview?: string;
  hint?: string;
  /** Only present in verify() / after saveKey() */
  persisted?: boolean;
  /** Populated by verify() after a 5-token ping */
  ping?: {
    ok?: boolean;
    status?: string;
    latencyMs?: number;
    model?: string;
    modelId?: string;
    finishReason?: string;
    errorCode?: string;
    errorMessage?: string;
    error?: string;
    [k: string]: unknown;
  };
}

/** Kept as an alias so `AiVerifyResult["ping"]` still works in callers. */
export type AiVerifyResult = AiProviderStatus;

// =====================================================================
// Resource collections
// =====================================================================

export const projects = {
  list: () => api.get<{ items: Project[] }>("/api/projects"),
  get: (id: string) => api.get<Project>(`/api/projects/${id}`),
  create: (body: Record<string, unknown>) => api.post<Project>("/api/projects", body),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<Project>(`/api/projects/${id}`, body),
  delete: (id: string) => api.del<{ ok: boolean; id: string }>(`/api/projects/${id}`),
  storyStatus: (id: string) =>
    api.get<{ status: string; blocking: number }>(`/api/projects/${id}/story-status`),
  episodes: (id: string) => api.get<{ items: Episode[] }>(`/api/projects/${id}/episodes`),
  storyBible: (id: string) => api.get<StoryBible>(`/api/projects/${id}/story-bible`),
  patchStoryBible: (id: string, patch: Partial<StoryBible> & { version: number }) =>
    api.patch<StoryBible>(`/api/projects/${id}/story-bible`, patch),
  generateStoryBible: (id: string) =>
    api.post<StoryBible>(`/api/projects/${id}/story-bible/generate`, {}),
  generateEpisodeOutline: (id: string, count = 3, topicHint?: string) =>
    api.post<AsyncJobTicket>(`/api/projects/${id}/episodes/generate-outline`, {
      count,
      ...(topicHint && topicHint.trim() ? { topicHint: topicHint.trim() } : {}),
    }),
  regenerateEpisodeOutline: (episodeId: string, topicHint?: string) =>
    api.post<AsyncJobTicket>(`/api/episodes/${episodeId}/regenerate-outline`, {
      ...(topicHint && topicHint.trim() ? { topicHint: topicHint.trim() } : {}),
    }),
  deleteEpisode: (episodeId: string) =>
    api.del<{ ok: boolean; id: string }>(`/api/episodes/${episodeId}`),
  getEpisode: (episodeId: string) => api.get<Episode>(`/api/episodes/${episodeId}`),
  updateEpisode: (episodeId: string, patch: Partial<Episode> & { version: number }) =>
    api.patch<Episode>(`/api/episodes/${episodeId}`, patch),
  confirmEpisodeStory: (episodeId: string, expectedVersion?: number) =>
    api.post<Episode>(`/api/episodes/${episodeId}/confirm-story`, { expectedVersion }),
};

// -- storyboards --

export const storyboards = {
  listScenes: (episodeId: string) =>
    api.get<{ items: Scene[] }>(`/api/episodes/${episodeId}/scenes`),
  generateScenes: (episodeId: string, count?: number) =>
    api.post<AsyncJobTicket>(
      `/api/episodes/${episodeId}/scenes/generate`,
      count && count > 0 ? { count } : {},
    ),
  listShots: (sceneId: string) =>
    api.get<{ items: Shot[] }>(`/api/scenes/${sceneId}/shots`),
  createShot: (
    sceneId: string,
    body: Partial<Shot> & { shotNo: number; sortOrder: number },
  ) => api.post<Shot>(`/api/scenes/${sceneId}/shots`, body),
  confirmScene: (id: string, expectedVersion?: number) =>
    api.post<Scene>(`/api/scenes/${id}/confirm`, { expectedVersion }),
  unconfirmScene: (id: string, expectedVersion?: number) =>
    api.post<Scene>(`/api/scenes/${id}/unconfirm`, { expectedVersion }),
  regenerateScene: (id: string, expectedVersion: number) =>
    api.post<Scene>(`/api/scenes/${id}/regenerate`, { expectedVersion }),
};

// -- assets (P1 story-bible seeds; characters / locations / props) --

export interface CharacterAsset {
  id: string;
  projectId: string;
  /** A2 scope: 空 = 项目级；非空 = 该集专属（series 分集绑定）。 */
  episodeId?: string;
  name: string;
  roleType?: string;
  genderPresentation?: string;
  ageRange?: string;
  identitySummary?: string;
  personality?: string;
  motivation?: string;
  taboos?: string;
  speechStyle?: string;
  visualLock?: string;
  status: "active" | "disabled";
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LocationAsset {
  id: string;
  projectId: string;
  /** A2 scope: 空 = 项目级；非空 = 该集专属。 */
  episodeId?: string;
  name: string;
  locationType?: string;
  visualSpec?: Record<string, unknown>;
  spaceRules?: Record<string, unknown>;
  lightingRules?: Record<string, unknown>;
  continuityRules?: Record<string, unknown>;
  visualLock?: string;
  status: "active" | "disabled";
  version: number;
}

export interface PropAsset {
  id: string;
  projectId: string;
  /** A2 scope: 空 = 项目级；非空 = 该集专属。 */
  episodeId?: string;
  name: string;
  propType?: string;
  visualSpec?: Record<string, unknown>;
  ownership?: Record<string, unknown>;
  continuityRules?: Record<string, unknown>;
  visualLock?: string;
  status: "active" | "disabled";
  version: number;
}

/**
 * GET /episodes/:id/assets 返回结构。
 *   - `characters/locations/props`：本集专属（episode_id = 该集）
 *   - `projectLevel*`：项目级共用（episode_id IS NULL）
 *     - drama 项目下所有资产都在这里
 *     - series 项目下的系列包装级资产（主持人 / mascot 等）
 *   - `projectType`：让前端根据项目型决定分区可见性与文案。
 */
export interface EpisodeAssetsBundle {
  projectType?: "drama" | "series";
  episodeId?: string;
  characters: CharacterAsset[];
  locations: LocationAsset[];
  props: PropAsset[];
  projectLevelCharacters?: CharacterAsset[];
  projectLevelLocations?: LocationAsset[];
  projectLevelProps?: PropAsset[];
}

/** POST /episodes/:id/asset-seeds/generate 返回结构。 */
export interface EpisodeAssetSeedsGenerated {
  episodeId: string;
  persisted: { characters: number; locations: number; props: number };
}

export const assets = {
  listCharacters: (projectId: string) =>
    api.get<{ items: CharacterAsset[] }>(`/api/projects/${projectId}/characters`),
  listLocations: (projectId: string) =>
    api.get<{ items: LocationAsset[] }>(`/api/projects/${projectId}/locations`),
  listProps: (projectId: string) =>
    api.get<{ items: PropAsset[] }>(`/api/projects/${projectId}/props`),
  updateCharacter: (id: string, patch: Partial<CharacterAsset> & { version: number }) =>
    api.patch<CharacterAsset>(`/api/characters/${id}`, patch),
  updateLocation: (id: string, patch: Partial<LocationAsset> & { version: number }) =>
    api.patch<LocationAsset>(`/api/locations/${id}`, patch),
  updateProp: (id: string, patch: Partial<PropAsset> & { version: number }) =>
    api.patch<PropAsset>(`/api/props/${id}`, patch),
  /**
   * 拉取该集专属（episode_id = 该集）的资产 —— 供分集详情页"本集资产"面板。
   * 不含项目级共用资产（drama 主流用 listCharacters/Locations/Props）。
   */
  listEpisodeAssets: (episodeId: string) =>
    api.get<EpisodeAssetsBundle>(`/api/episodes/${episodeId}/assets`),
  /**
   * 触发 LLM 为本集生成角色 / 场景 / 道具 seeds。同步返回落库计数。
   * series 场景在拆场次之前调用；drama 通常不需要（Story Bible 已经产出项目级 seeds）。
   */
  generateEpisodeAssetSeeds: (episodeId: string) =>
    api.post<EpisodeAssetSeedsGenerated>(
      `/api/episodes/${episodeId}/asset-seeds/generate`,
      {},
    ),

  /**
   * A2 一次性迁移：把项目下所有 episode_id IS NULL 的项目级资产批量改挂到
   * 指定分集，用于修复 series preset 收窄之前生成的错版 seeds。
   */
  migrateProjectLevelToEpisode: (projectId: string, episodeId: string) =>
    api.post<{
      projectId: string;
      episodeId: string;
      migrated: { characters: number; locations: number; props: number };
    }>(`/api/projects/${projectId}/assets/migrate-to-episode`, { episodeId }),
};

// -- image assets (综合方案 §7 P0 · Stage F) --

export interface ImageAssetRecord {
  id: string;
  episodeId?: string;
  sceneId?: string;
  shotId?: string;
  keyframeId?: string;
  /** 资产图挂载点（P1）—— 角色 / 场景 / 道具参考图各占一列。 */
  characterId?: string;
  locationId?: string;
  propId?: string;
  provider: string;
  modelId: string;
  promptPositive: string;
  promptPositiveZh?: string;
  sizePreset: string;
  base64: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  /** 服务端 join 的 `data:*;base64,...`，可直接放到 <img src>。列表接口会补上；单条 asset 里没有。 */
  dataUrl?: string;
  /** Round-3 P0：生成状态。默认 'succeeded'，'failed' 表示这张图出图失败仅保留 prompt/错误信息用于重试。 */
  status?: "succeeded" | "failed" | "stale";
  /** 失败原因或 stale 原因摘要。 */
  errorMessage?: string;
  /** 累计尝试次数，1 = 首次；>1 = 重试。 */
  attemptCount?: number;
  /** 若本记录是「重试出图」的产物，指向被重试的原 image_asset.id。 */
  retryOfId?: string;
  /** P2-⑤：下游依赖变更触发的过期原因。 */
  staleReason?: string;
}

export const imageAssets = {
  listByEpisode: (episodeId: string) =>
    api.get<{ items: ImageAssetRecord[] }>(
      `/api/episodes/${episodeId}/image-assets`,
    ),
  generateFirstFrame: (episodeId: string) =>
    api.post<{ asset: ImageAssetRecord; dataUrl: string }>(
      `/api/episodes/${episodeId}/generate-first-frame`,
      {},
    ),

  // Shot 首帧（P1）：分镜粒度的 9:16 首帧图。
  //   list*: 拉某个 shot 历史所有首帧图（最新在前）。
  //   generate*: 触发一次 seedream 出图，落库并返回 { asset, dataUrl }。
  listByShot: (shotId: string) =>
    api.get<{ items: ImageAssetRecord[] }>(
      `/api/shots/${shotId}/image-assets`,
    ),
  generateShotFirstFrame: (shotId: string) =>
    api.post<{ asset: ImageAssetRecord; dataUrl: string }>(
      `/api/shots/${shotId}/generate-first-frame`,
      {},
    ),

  // 资产参考图（P1）：角色 / 场景 / 道具的视觉锁参考图。
  //   list*: 拉该资产历史所有参考图（最新在前）。
  //   generate*: 触发一次 seedream 出图，落库并返回 { asset, dataUrl }。
  //   单张耗时约 20-40s，前端应展示 loading。
  listByCharacter: (characterId: string) =>
    api.get<{ items: ImageAssetRecord[] }>(
      `/api/characters/${characterId}/image-assets`,
    ),
  listByLocation: (locationId: string) =>
    api.get<{ items: ImageAssetRecord[] }>(
      `/api/locations/${locationId}/image-assets`,
    ),
  listByProp: (propId: string) =>
    api.get<{ items: ImageAssetRecord[] }>(
      `/api/props/${propId}/image-assets`,
    ),
  generateCharacterReference: (characterId: string) =>
    api.post<{ asset: ImageAssetRecord; dataUrl: string }>(
      `/api/characters/${characterId}/generate-reference-image`,
      {},
    ),
  generateLocationReference: (locationId: string) =>
    api.post<{ asset: ImageAssetRecord; dataUrl: string }>(
      `/api/locations/${locationId}/generate-reference-image`,
      {},
    ),
  generatePropReference: (propId: string) =>
    api.post<{ asset: ImageAssetRecord; dataUrl: string }>(
      `/api/props/${propId}/generate-reference-image`,
      {},
    ),

  /**
   * Round-3 P0：单张图片重试出图。
   * - 若原记录 status=failed 或 status=succeeded 但用户想再抽一张：复用 prompt/size 直调 seedream；
   * - 若原记录是编排 prompt 阶段失败（"[compile_failed]"）：后端会分派回完整 generateXxx 重跑；
   * - 返回值同 generate*：{ asset, dataUrl }。
   * 前端拿到后可直接刷新对应列表，把新 asset 追加/替换到 UI。
   */
  retry: (imageAssetId: string) =>
    api.post<{ asset: ImageAssetRecord; dataUrl: string }>(
      `/api/image-assets/${imageAssetId}/retry`,
      {},
    ),
};

// -- video assets (Round-4 Phase-C) --

/**
 * VideoAsset 前端视图：与 image_assets 不同，视频体不带 base64；
 * 直接把 `videoUrl` 交给 <video src>。上游 URL 有 24h 过期风险。
 */
export interface VideoAssetRecord {
  id: string;
  episodeId?: string;
  sceneId?: string;
  shotId?: string;
  firstFrameImageId?: string;
  provider: string;
  modelId: string;
  prompt: string;
  promptZh?: string;
  resolution: string;
  ratio: string;
  durationSec: number;
  /**
   * 时长来源（0009 migration）：
   *   - `explicit`       — 显式传入 / shot 上有 durationSec
   *   - `text_estimate`  — 由 dialogue/action 块字数精确估算
   *   - `scene_summary`  — 块表空，退回 scene.summary + shot.intent 自由文本估算
   *   - `default`        — 无信号，使用默认值兜底
   * 老数据 undefined。
   */
  durationSource?:
    | "explicit"
    | "shot_text"
    | "text_estimate"
    | "scene_summary"
    | "default";
  durationDialogueChars: number;
  durationActionChars: number;
  /** 是否 image-to-video（当前 shot 视频生成入口始终为 true）。 */
  isI2V: boolean;
  videoUrl: string;
  lastFrameUrl?: string;
  taskId?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "stale";
  errorMessage?: string;
  attemptCount: number;
  retryOfId?: string;
  staleReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateShotVideoBody {
  durationSec?: number;
  resolution?: "480p" | "720p" | "1080p";
  ratio?: "9:16" | "16:9" | "1:1" | "4:3" | "3:4";
  generateAudio?: boolean;
  cameraFixed?: boolean;
}

/**
 * Round-4 Phase-C 补丁：视频生成预览。
 *
 * 由 `GET /api/shots/:id/video-preview` 返回。前端在渲染 Shot 卡片时主动拉一次，
 * 让用户在点击"生成本段视频"前就能看到即将下发的参数（时长、分辨率、模式等）。
 */
export interface ShotVideoPreview {
  shotId: string;
  canGenerate: boolean;
  blockers: string[];
  warnings: string[];
  durationSec: number;
  durationSource: "explicit" | "shot_text" | "text_estimate" | "scene_summary" | "default";
  durationDialogueChars: number;
  durationActionChars: number;
  resolution: "480p" | "720p" | "1080p";
  ratio: "9:16" | "16:9" | "1:1" | "4:3" | "3:4";
  modelId: string;
  isI2V: boolean;
  firstFrameImageId?: string;
}

export const videoAssets = {
  listByShot: (shotId: string) =>
    api.get<{ items: VideoAssetRecord[] }>(
      `/api/shots/${shotId}/video-assets`,
    ),
  previewShotVideo: (shotId: string) =>
    api.get<ShotVideoPreview>(`/api/shots/${shotId}/video-preview`),
  generateShotVideo: (shotId: string, body: GenerateShotVideoBody = {}) =>
    api.post<{ asset: VideoAssetRecord }>(
      `/api/shots/${shotId}/generate-video`,
      body,
    ),
  listByEpisode: (episodeId: string) =>
    api.get<{ items: VideoAssetRecord[] }>(
      `/api/episodes/${episodeId}/video-assets`,
    ),
  latestByEpisodeShots: (episodeId: string) =>
    api.get<{ items: VideoAssetRecord[] }>(
      `/api/episodes/${episodeId}/latest-shot-videos`,
    ),
  compositionManifest: (episodeId: string) =>
    api.get<EpisodeCompositionManifest>(
      `/api/episodes/${episodeId}/composition-manifest`,
    ),
};

// -- composition (Round-4 Phase-C：视频拼接清单) --

export interface CompositionItem {
  sceneId: string;
  sceneNo: number;
  shotId: string;
  shotNo: number;
  shotType: string | null;
  intent: string | null;
  /** null 表示该 shot 尚未生成视频。 */
  video: VideoAssetRecord | null;
}

export interface EpisodeCompositionManifest {
  episodeId: string;
  episodeNo: number;
  episodeTitle: string;
  totalShotCount: number;
  readyShotCount: number;
  totalDurationSec: number;
  items: CompositionItem[];
}

// -- episode-level ffmpeg 拼接产物（.runtime/composes/{episodeId}/*.mp4） --

export interface EpisodeCompositionMeta {
  id: string;
  episodeId: string;
  createdAt: string;
  outputPath: string;
  filename: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  clipCount: number;
  opts: Record<string, unknown>;
  clips: Array<{
    id: string;
    sourceUrl: string;
    durationSec: number;
    width: number;
    height: number;
  }>;
}

export interface ComposeEpisodeVideoBody {
  /** 允许中间 shot 缺视频（默认 false 会报错终止）。 */
  allowMissing?: boolean;
  /** ffmpeg 编码参数覆盖；不传则依据首个 clip 自动推断。 */
  opts?: {
    width?: number;
    height?: number;
    fps?: number;
    crf?: number;
    preset?: string;
    audioBitrate?: string;
    audioSampleRate?: number;
    audioChannels?: number;
  };
}

export const episodeComposeVideo = {
  compose: (episodeId: string, body: ComposeEpisodeVideoBody = {}) =>
    api.post<EpisodeCompositionMeta>(
      `/api/episodes/${episodeId}/compose-video`,
      body,
    ),
  list: (episodeId: string) =>
    api.get<{ items: EpisodeCompositionMeta[] }>(
      `/api/episodes/${episodeId}/compositions`,
    ),
  /** 直接返回可放进 <video src> 的 URL。 */
  fileUrl: (episodeId: string, filename: string): string =>
    `/api/episodes/${episodeId}/compositions/${encodeURIComponent(filename)}`,
};

// -- prompts --

export const prompts = {
  listBySource: (sourceEntityType: string, sourceEntityId: string) =>
    api.get<{ items: PromptSpec[] }>(
      `/api/prompts?sourceEntityType=${encodeURIComponent(sourceEntityType)}&sourceEntityId=${encodeURIComponent(sourceEntityId)}`,
    ),
  compileShot: (shotId: string, targetType: "image" | "video") =>
    api.post<PromptSpec>(`/api/prompts/compile-shot`, { shotId, targetType }),
  compileSceneTts: (sceneId: string) =>
    api.post<PromptSpec>(`/api/prompts/compile-scene-tts`, { sceneId }),
  confirm: (promptId: string, version: number) =>
    api.post<PromptSpec>(`/api/prompts/${promptId}/confirm`, { version }),
};

// -- reviews --

export const reviews = {
  listRuns: (projectId: string) =>
    api.get<{ items: ReviewRun[] }>(`/api/projects/${projectId}/review-runs`),
  listIssues: (projectId: string) =>
    api.get<{ items: ReviewIssue[] }>(`/api/projects/${projectId}/review-issues`),
  runRulePacks: (projectId: string, opts?: { episodeId?: string }) =>
    api.post<RunRulePacksResult>(
      `/api/projects/${projectId}/reviews/run-rule-packs`,
      opts ?? {},
    ),
  resolve: (issueId: string) =>
    api.post<ReviewIssue>(`/api/review-issues/${issueId}/resolve`, {}),
  ignore: (issueId: string, reason: string) =>
    api.post<ReviewIssue>(`/api/review-issues/${issueId}/ignore`, { reason }),
  reopen: (issueId: string) =>
    api.post<ReviewIssue>(`/api/review-issues/${issueId}/reopen`, {}),
};

// -- continuity locks --

export const continuity = {
  list: (projectId: string) =>
    api.get<{ items: ContinuityLock[] }>(`/api/projects/${projectId}/continuity-locks`),
  create: (projectId: string, body: Record<string, unknown>) =>
    api.post<ContinuityLock>(`/api/projects/${projectId}/continuity-locks`, body),
  disable: (id: string) =>
    api.post<ContinuityLock>(`/api/continuity-locks/${id}/disable`, {}),
  delete: (id: string) =>
    api.del<{ ok: boolean; id: string }>(`/api/continuity-locks/${id}`),
};

// -- episode asset refs (series only) --

export const episodeAssets = {
  listRefs: (episodeId: string) =>
    api.get<{ items: EpisodeAssetRef[] }>(`/api/episodes/${episodeId}/asset-refs`),
  listAvailable: (episodeId: string) =>
    api.get<AvailableAssets>(`/api/episodes/${episodeId}/available-assets`),
  attach: (
    episodeId: string,
    body: { assetType: AssetKind; assetId: string; note?: string },
  ) => api.post<EpisodeAssetRef>(`/api/episodes/${episodeId}/asset-refs`, body),
  detach: (episodeId: string, assetType: AssetKind, assetId: string) =>
    api.del<{ ok: boolean }>(
      `/api/episodes/${episodeId}/asset-refs/${assetType}/${assetId}`,
    ),
};

// -- exports --

export const exportsApi = {
  list: (projectId: string) =>
    api.get<{ items: ExportBundle[] }>(`/api/projects/${projectId}/exports`),
  create: (body: Record<string, unknown>) =>
    api.post<ExportBundle>(`/api/exports`, body),
  start: (id: string) => api.post<ExportBundle>(`/api/exports/${id}/start`, {}),
  cancel: (id: string) => api.post<ExportBundle>(`/api/exports/${id}/cancel`, {}),
  retry: (id: string) => api.post<ExportBundle>(`/api/exports/${id}/retry`, {}),
};

// -- ai provider (ark) --

export const ai = {
  status: () => api.get<AiProviderStatus>("/api/ai/status"),
  verify: () => api.post<AiProviderStatus>("/api/ai/verify", {}),
  saveKey: (apiKey: string, persist: boolean) =>
    api.post<AiProviderStatus>("/api/ai/config", { apiKey, persist }),
  clearKey: () => api.post<AiProviderStatus>("/api/ai/config/clear", {}),
  env: () => api.get<AiProviderStatus>("/api/ai/env"),
};


// ==================================================================
// -- async jobs (generation_tasks 复用)
//
// 后台 LLM job 的前端入口：
//   1. UI 触发时后端返回 202 + { taskId, status }
//   2. 前端用 `jobs.get(taskId)` 轮询直到终态（succeeded/failed/cancelled）
//   3. 页面 mount / focus 时用 `jobs.listBySource` 查询该实体是否还有 running / queued 的 job，有就无缝 resume
// ==================================================================

export type AsyncJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface AsyncJobTicket {
  taskId: string;
  status: AsyncJobStatus;
}

export interface AsyncJob {
  id: string;
  projectId: string;
  taskType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  status: AsyncJobStatus;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  errorMessage?: string;
  errorCode?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export const jobs = {
  get: (id: string) => api.get<AsyncJob>(`/api/jobs/${id}`),
  listBySource: (
    entityType: string,
    entityId: string,
    statusIn?: readonly AsyncJobStatus[],
  ) => {
    const qs = new URLSearchParams({ entityType, entityId });
    if (statusIn && statusIn.length > 0) qs.set("status", statusIn.join(","));
    return api.get<{ items: AsyncJob[] }>(`/api/jobs?${qs.toString()}`);
  },
  cancel: (id: string) => api.post<AsyncJob>(`/api/jobs/${id}/cancel`, {}),
};

/**
 * `pollJob` 反复调 GET /jobs/:id 直到终态。
 * - `signal` 支持外部取消（页面 unmount 时中断轮询）
 * - `onTick` 每次拉到最新状态时回调，用于更新 UI 进度
 * - 轮询间隔 1500ms（LLM 生成通常 5–30s，1.5s 够用又不过分）
 */
export async function pollJob(
  taskId: string,
  opts?: {
    signal?: AbortSignal;
    onTick?: (job: AsyncJob) => void;
    intervalMs?: number;
  },
): Promise<AsyncJob> {
  const interval = opts?.intervalMs ?? 1500;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const job = await jobs.get(taskId);
    opts?.onTick?.(job);
    if (
      job.status === "succeeded" ||
      job.status === "failed" ||
      job.status === "cancelled"
    ) {
      return job;
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, interval);
      opts?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}

// -- rollback / entity snapshots (Round-3 P1-①) --

export interface SnapshotDigest {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  reason?: string;
  summary?: string;
  createdAt: string;
}

export const snapshots = {
  list: (entityType: string, entityId: string, limit = 20) =>
    api.get<{ items: SnapshotDigest[] }>(
      `/api/snapshots?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(
        entityId,
      )}&limit=${limit}`,
    ),
  rollback: (snapshotId: string, expectedVersion: number) =>
    api.post<{ entityType: string; entityId: string; restoredFromVersion: number }>(
      `/api/snapshots/${snapshotId}/rollback`,
      { expectedVersion },
    ),
};
