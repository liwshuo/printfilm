/**
 * AI Provider module — 抄自 /Users/bytedance/Documents/trae_projects/printfilm 的
 * 火山方舟 Ark 接入模式（chatAdapter / imageAdapter / videoAdapter）。
 *
 * 关键设计：
 *  - 单一 provider（Volcengine Ark）+ 三种模态（chat / image / video）。
 *  - Bearer 鉴权，凭证从 `ARK_API_KEY` env 读取。
 *  - Node 环境直连 Ark，不走 `/api-proxy`（那是 trae 前端 CORS 方案）。
 *  - 无 KEY 时 `isProviderReady()` = false，调用方按 stub 回退。
 */

export * from "./types.js";
export * from "./ark-config.js";
export * from "./ark-chat.js";
export * from "./ark-image.js";
export * from "./ark-video.js";
export * from "./prompts/index.js";
