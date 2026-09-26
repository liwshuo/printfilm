/**
 * Scene Outline pack (Stage D).
 *
 * 综合方案 §4.D：按 contentType 分支 persona + beatHint。
 */

import type { ContentType } from "@dramaflow/domain";
import { definePack } from "../pack.js";
import { SceneOutlineListSchema } from "./schema.js";
import { buildSceneOutlineSystem } from "./system.js";
import { buildSceneOutlineUser } from "./user.js";

export interface SceneOutlineCtx {
  contentType: ContentType;
  count: number;
  episodeNo: number;
  episodeTitle?: string;
  episodeSummary?: string;
  episodeGoal?: string;
  episodeConflict?: string;
  episodeTurn?: string;
  episodeEndingHook?: string;
  /**
   * P1 资产上下文：Story Bible seeds 落库后的 characters / locations / props。
   * 用于在拆场次时优先复用既有资产（visualLock 保证跨镜头视觉一致性）。
   */
  assets?: {
    characters?: Array<{ name: string; roleType?: string; visualLock?: string }>;
    locations?: Array<{ name: string; locationType?: string; visualLock?: string }>;
    props?: Array<{ name: string; visualLock?: string }>;
  };
}

export const sceneOutlinePack = definePack({
  stage: "scene_outline",
  buildSystem: buildSceneOutlineSystem,
  buildUser: buildSceneOutlineUser,
  schema: SceneOutlineListSchema,
  envelopeKeys: ["scenes", "items", "data", "list"] as const,
  defaults: {
    temperature: 0.4,
    maxTokens: 4096,
    // 8 场次 + 资产上下文时上游耗时容易逼近 60s 默认；给到 3 分钟。
    timeoutMs: 180_000,
  },
} satisfies import("../pack.js").PromptPack<
  SceneOutlineCtx,
  typeof SceneOutlineListSchema
>);

export * from "./schema.js";
