/**
 * Prompt packs registry (综合方案 §4)。
 *
 * Stage A · Story Bible          → `story-bible/`
 * Stage A' · Episode Asset Seeds → `episode-asset-seeds/`（series 分集资产 seeds）
 * Stage B · Episode Outline      → `episode-outline/`
 * Stage D · Scene Outline        → `scene-outline/`
 *
 * Stage C/E/F/G/H 在 P1/P2 阶段接入。
 */

export * from "./pack.js";
export * from "./story-bible/index.js";
export * from "./episode-asset-seeds/index.js";
export * from "./episode-outline/index.js";
export * from "./scene-outline/index.js";
