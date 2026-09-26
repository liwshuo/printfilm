/**
 * Image assets routes — Stage F 首帧图 + 资产参考图链路。
 *
 * Episode 首帧（综合方案 §7 · P0）：
 *  - POST /api/episodes/:id/generate-first-frame
 *  - GET  /api/episodes/:id/image-assets
 *  - GET  /api/image-assets/:id
 *
 * Shot 首帧（P1）：
 *  - POST /api/shots/:id/generate-first-frame
 *  - GET  /api/shots/:id/image-assets
 *
 * 资产参考图（P1）：
 *  - POST /api/characters/:id/generate-reference-image
 *  - POST /api/locations/:id/generate-reference-image
 *  - POST /api/props/:id/generate-reference-image
 *  - GET  /api/characters/:id/image-assets      （历史列表；返回最新一张 + list）
 *  - GET  /api/locations/:id/image-assets
 *  - GET  /api/props/:id/image-assets
 *
 * 图数据以 base64 落 `image_assets` 表；接口返回 `dataUrl` 便于前端 <img> 直接展示。
 */

import { Hono } from "hono";
import { AppEnv } from "../env.js";
import { publish } from "../events.js";
import type { ImageAsset } from "@dramaflow/domain";

/** 统一给图片带上 dataUrl，前端 <img src> 直接可用。 */
function withDataUrl(a: ImageAsset): ImageAsset & { dataUrl: string } {
  return { ...a, dataUrl: `data:${a.mimeType};base64,${a.base64}` };
}

export function imageAssetsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ===== Episode 首帧 =====

  r.get("/episodes/:id/image-assets", (c) => {
    const items = c.get("services").imageAsset.list(c.req.param("id"));
    return c.json({ items: items.map(withDataUrl) });
  });

  r.post("/episodes/:id/generate-first-frame", async (c) => {
    const episodeId = c.req.param("id");
    const result = await c.get("services").imageAsset.generateFirstFrame(episodeId);
    publish(
      "image_asset.first_frame.created",
      { id: result.asset.id, episodeId },
      undefined,
    );
    return c.json(result, 201);
  });

  r.get("/image-assets/:id", (c) => {
    const a = c.get("services").imageAsset.get(c.req.param("id"));
    return c.json(withDataUrl(a));
  });

  // ===== Shot 首帧（P1） =====

  r.get("/shots/:id/image-assets", (c) => {
    const shotId = c.req.param("id");
    const repos = c.get("services").ctx.repos;
    const items = repos.imageAssets.listByShot(shotId);
    return c.json({ items: items.map(withDataUrl) });
  });

  r.post("/shots/:id/generate-first-frame", async (c) => {
    const shotId = c.req.param("id");
    const result = await c
      .get("services")
      .imageAsset.generateShotFirstFrame(shotId);
    publish(
      "image_asset.shot_first_frame.created",
      { id: result.asset.id, shotId },
      undefined,
    );
    return c.json(result, 201);
  });

  // ===== 资产参考图（角色 / 场景 / 道具） =====

  r.get("/characters/:id/image-assets", (c) => {
    const characterId = c.req.param("id");
    const repos = c.get("services").ctx.repos;
    const items = repos.imageAssets.listByCharacter(characterId);
    return c.json({ items: items.map(withDataUrl) });
  });

  r.get("/locations/:id/image-assets", (c) => {
    const locationId = c.req.param("id");
    const repos = c.get("services").ctx.repos;
    const items = repos.imageAssets.listByLocation(locationId);
    return c.json({ items: items.map(withDataUrl) });
  });

  r.get("/props/:id/image-assets", (c) => {
    const propId = c.req.param("id");
    const repos = c.get("services").ctx.repos;
    const items = repos.imageAssets.listByProp(propId);
    return c.json({ items: items.map(withDataUrl) });
  });

  r.post("/characters/:id/generate-reference-image", async (c) => {
    const characterId = c.req.param("id");
    const result = await c
      .get("services")
      .imageAsset.generateCharacterReference(characterId);
    publish(
      "image_asset.character_reference.created",
      { id: result.asset.id, characterId },
      undefined,
    );
    return c.json(result, 201);
  });

  r.post("/locations/:id/generate-reference-image", async (c) => {
    const locationId = c.req.param("id");
    const result = await c
      .get("services")
      .imageAsset.generateLocationReference(locationId);
    publish(
      "image_asset.location_reference.created",
      { id: result.asset.id, locationId },
      undefined,
    );
    return c.json(result, 201);
  });

  r.post("/props/:id/generate-reference-image", async (c) => {
    const propId = c.req.param("id");
    const result = await c
      .get("services")
      .imageAsset.generatePropReference(propId);
    publish(
      "image_asset.prop_reference.created",
      { id: result.asset.id, propId },
      undefined,
    );
    return c.json(result, 201);
  });

  // ===== 单张图片重试（Round-3 P0） =====
  //
  // 场景：前一张失败 / 用户不满意想再抽一张。
  // 语义：复用 previous.promptPositive + sizePreset 直接调 seedream；
  //       compile 阶段失败的记录会自动分派回完整 generateXxx 重跑。
  r.post("/image-assets/:id/retry", async (c) => {
    const imageAssetId = c.req.param("id");
    const result = await c.get("services").imageAsset.retryImageAsset(imageAssetId);
    publish(
      "image_asset.retry.succeeded",
      { id: result.asset.id, previousId: imageAssetId },
      undefined,
    );
    return c.json(result, 201);
  });

  return r;
}
