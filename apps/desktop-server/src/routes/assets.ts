/**
 * Assets routes: characters + character looks + locations + props
 * (data-and-api-v1.md §7 Asset Studio).
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";

export function assetsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ===== Characters =====
  r.get("/projects/:id/characters", (c) =>
    c.json({ items: c.get("services").asset.listCharacters(c.req.param("id")) }),
  );
  r.post("/projects/:id/characters", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.projectId = c.req.param("id");
    const ch = c.get("services").asset.createCharacter(body);
    publish("character.created", { id: ch.id }, ch.projectId);
    return c.json(ch, 201);
  });
  r.get("/characters/:id", (c) => {
    const ch = c.get("services").ctx.repos.characters.getById(c.req.param("id"));
    if (!ch) return c.json({ code: "missing_resource", message: "角色不存在", retryable: false }, 404);
    return c.json(ch);
  });
  r.patch("/characters/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const ch = c.get("services").asset.updateCharacter(c.req.param("id"), body);
    publish("character.updated", { id: ch.id }, ch.projectId);
    return c.json(ch);
  });
  r.post("/characters/:id/disable", async (c) => {
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    const ch = c.get("services").asset.disableCharacter(c.req.param("id"), expectedVersion);
    publish("character.disabled", { id: ch.id }, ch.projectId);
    return c.json(ch);
  });

  // ===== Character Looks =====
  r.get("/characters/:id/looks", (c) =>
    c.json({ items: c.get("services").asset.listCharacterLooks(c.req.param("id")) }),
  );
  r.post("/characters/:id/looks", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.characterId = c.req.param("id");
    const look = c.get("services").asset.createCharacterLook(body);
    return c.json(look, 201);
  });
  r.post("/character-looks/:previousLookId/new-version", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const look = c.get("services").asset.createCharacterLookVersion(
      c.req.param("previousLookId"),
      body,
    );
    return c.json(look, 201);
  });
  r.post("/character-looks/:id/set-default", (c) => {
    const look = c.get("services").asset.setDefaultLook(c.req.param("id"));
    return c.json(look);
  });

  // ===== Locations =====
  r.get("/projects/:id/locations", (c) =>
    c.json({ items: c.get("services").asset.listLocations(c.req.param("id")) }),
  );
  r.post("/projects/:id/locations", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.projectId = c.req.param("id");
    const loc = c.get("services").asset.createLocation(body);
    publish("location.created", { id: loc.id }, loc.projectId);
    return c.json(loc, 201);
  });
  r.get("/locations/:id", (c) => {
    const loc = c.get("services").ctx.repos.locations.getById(c.req.param("id"));
    if (!loc) return c.json({ code: "missing_resource", message: "场景不存在", retryable: false }, 404);
    return c.json(loc);
  });
  r.patch("/locations/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const loc = c.get("services").asset.updateLocation(c.req.param("id"), body);
    return c.json(loc);
  });
  r.post("/locations/:id/disable", async (c) => {
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    return c.json(c.get("services").asset.disableLocation(c.req.param("id"), expectedVersion));
  });

  // ===== Props =====
  r.get("/projects/:id/props", (c) =>
    c.json({ items: c.get("services").asset.listProps(c.req.param("id")) }),
  );
  r.post("/projects/:id/props", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.projectId = c.req.param("id");
    const p = c.get("services").asset.createProp(body);
    return c.json(p, 201);
  });
  r.get("/props/:id", (c) => {
    const p = c.get("services").ctx.repos.props.getById(c.req.param("id"));
    if (!p) return c.json({ code: "missing_resource", message: "道具不存在", retryable: false }, 404);
    return c.json(p);
  });
  r.patch("/props/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    return c.json(c.get("services").asset.updateProp(c.req.param("id"), body));
  });
  r.post("/props/:id/disable", async (c) => {
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    return c.json(c.get("services").asset.disableProp(c.req.param("id"), expectedVersion));
  });

  // ===== A1 跨集资产复用（episode_asset_refs） =====

  r.get("/episodes/:id/asset-refs", (c) => {
    return c.json({
      items: c.get("services").asset.listEpisodeAssetRefs(c.req.param("id")),
    });
  });

  r.get("/episodes/:id/available-assets", (c) => {
    const episodeId = c.req.param("id");
    const ep = c.get("services").ctx.repos.episodes.getById(episodeId);
    if (!ep) {
      return c.json(
        { code: "missing_resource", message: "剧集不存在", retryable: false },
        404,
      );
    }
    const svc = c.get("services").asset;
    return c.json({
      characters: svc.listAvailableCharacters(ep.projectId, episodeId),
      locations: svc.listAvailableLocations(ep.projectId, episodeId),
      props: svc.listAvailableProps(ep.projectId, episodeId),
    });
  });

  r.post("/episodes/:id/asset-refs", async (c) => {
    const body = await readJsonBody<{
      assetType: "character" | "location" | "prop";
      assetId: string;
      note?: string;
    }>(c.req.raw);
    const ref = c
      .get("services")
      .asset.attachAssetToEpisode(
        c.req.param("id"),
        body.assetType,
        body.assetId,
        body.note,
      );
    return c.json(ref, 201);
  });

  r.delete("/episodes/:eid/asset-refs/:type/:aid", (c) => {
    const type = c.req.param("type") as "character" | "location" | "prop";
    c.get("services").asset.detachAssetFromEpisode(
      c.req.param("eid"),
      type,
      c.req.param("aid"),
    );
    return c.body(null, 204);
  });

  // ===== A2 series 分集资产 seeds（每集专属角色/场景/道具） =====

  /**
   * GET /episodes/:id/assets
   *
   * 返回本集页面需要看到的三档资产：
   *   1) 本集专属：episode_id = 该集，AI 每集资产 seeds 产出的角色/场景/道具
   *   2) 项目级共用：episode_id IS NULL，Story Bible 生成的跨集共用资产
   *      - drama 项目下所有资产都在这里
   *      - series 项目下的系列包装级资产（主持人 / mascot / 系列 IP 视觉锁）
   *   3) 上游 projectType / episode 元信息，供前端决定 UI 分组与文案。
   *
   * 前端据此展示"本集专属 + 项目级共用"两个分区；drama 项目会以项目级为主，
   * 本集专属通常为空。
   */
  r.get("/episodes/:id/assets", (c) => {
    const episodeId = c.req.param("id");
    const ep = c.get("services").ctx.repos.episodes.getById(episodeId);
    if (!ep) {
      return c.json(
        { code: "missing_resource", message: "剧集不存在", retryable: false },
        404,
      );
    }
    const repos = c.get("services").ctx.repos;
    const project = repos.projects.getById(ep.projectId);
    // 项目级共用：episode_id IS NULL，仅 active。listByProject 已经覆盖了整个
    // 项目下的资产（包含各集专属），这里用 !episodeId 过滤出真正的项目级共用。
    const projChars = repos.characters
      .listByProject(ep.projectId)
      .filter((x) => x.status === "active" && !x.episodeId);
    const projLocs = repos.locations
      .listByProject(ep.projectId)
      .filter((x) => x.status === "active" && !x.episodeId);
    const projProps = repos.props
      .listByProject(ep.projectId)
      .filter((x) => x.status === "active" && !x.episodeId);
    return c.json({
      projectType: project?.projectType ?? "series",
      episodeId,
      characters: repos.characters
        .listByEpisode(episodeId)
        .filter((x) => x.status === "active"),
      locations: repos.locations
        .listByEpisode(episodeId)
        .filter((x) => x.status === "active"),
      props: repos.props
        .listByEpisode(episodeId)
        .filter((x) => x.status === "active"),
      projectLevelCharacters: projChars,
      projectLevelLocations: projLocs,
      projectLevelProps: projProps,
    });
  });

  /**
   * POST /episodes/:id/asset-seeds/generate
   *
   * 触发 LLM 为本集生成专属的角色 / 场景 / 道具 seeds，落 `episodeId = 该集`。
   * 首版走同步返回（seeds 生成通常 30-90s）；后续可切 async job。
   */
  r.post("/episodes/:id/asset-seeds/generate", async (c) => {
    const episodeId = c.req.param("id");
    const persisted = await c
      .get("services")
      .story.generateEpisodeAssetSeeds(episodeId);
    publish("episode.asset_seeds.generated", { episodeId, ...persisted });
    return c.json({ episodeId, persisted });
  });

  /**
   * POST /projects/:id/assets/migrate-to-episode
   *
   * A2 一次性迁移：把项目下所有「项目级」资产（episode_id IS NULL）批量
   * 改挂到 body.episodeId 指定的分集。用于修复 series preset 收窄之前
   * 落错到项目级的角色 / 场景 / 道具。
   *
   * Body: { episodeId: string }
   * Response: { projectId, episodeId, migrated: { characters, locations, props } }
   */
  r.post("/projects/:id/assets/migrate-to-episode", async (c) => {
    const projectId = c.req.param("id");
    const body = await readJsonBody<{ episodeId?: string }>(c.req.raw);
    if (!body?.episodeId || typeof body.episodeId !== "string") {
      return c.json(
        {
          code: "validation_failed",
          message: "缺少 episodeId",
          retryable: false,
        },
        400,
      );
    }
    const migrated = c
      .get("services")
      .asset.migrateProjectLevelAssetsToEpisode(projectId, body.episodeId);
    publish("asset.project_level.migrated", { projectId, episodeId: body.episodeId, ...migrated }, projectId);
    return c.json({ projectId, episodeId: body.episodeId, migrated });
  });

  return r;
}
