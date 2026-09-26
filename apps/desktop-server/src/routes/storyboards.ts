/**
 * Storyboards routes: scenes / shots / keyframes / dialogue+action blocks /
 * scene-character / shot-character / shot-prop links
 * (data-and-api-v1.md §7 Storyboard Studio).
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";

export function storyboardsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ===== Scenes =====
  r.get("/episodes/:id/scenes", (c) =>
    c.json({ items: c.get("services").storyboard.listScenes(c.req.param("id")) }),
  );
  r.post("/episodes/:id/scenes", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.episodeId = c.req.param("id");
    const s = c.get("services").storyboard.createScene(body);
    publish("scene.created", { id: s.id, episodeId: s.episodeId }, undefined);
    return c.json(s, 201);
  });
  r.post("/episodes/:id/scenes/generate", async (c) => {
    const body = (await readJsonBody<{ count?: number }>(c.req.raw).catch(() => ({}))) as {
      count?: number;
    };
    const episodeId = c.req.param("id");
    const services = c.get("services");
    if (c.req.query("sync") === "1") {
      const items = await services.storyboard.generateScenes(episodeId, body?.count);
      publish("scene.generated", { episodeId, count: items.length }, undefined);
      return c.json({ items }, 201);
    }
    const episode = services.ctx.repos.episodes.getById(episodeId);
    if (!episode)
      return c.json({ code: "missing_resource", message: "剧集不存在", retryable: false }, 404);
    const task = services.jobs.enqueueAndRun(
      {
        projectId: episode.projectId,
        taskType: "storyboard_generate",
        sourceEntityType: "episode",
        sourceEntityId: episodeId,
        inputPayload: {
          kind: "scenes.generate",
          count: body?.count ?? null,
        },
      },
      async () => {
        const items = await services.storyboard.generateScenes(episodeId, body?.count);
        publish("scene.generated", { episodeId, count: items.length }, undefined);
        return { sceneIds: items.map((s) => s.id), count: items.length };
      },
    );
    return c.json({ taskId: task.id, status: task.status }, 202);
  });
  r.get("/scenes/:id", (c) => {
    const s = c.get("services").ctx.repos.scenes.getById(c.req.param("id"));
    if (!s) return c.json({ code: "missing_resource", message: "分镜场不存在", retryable: false }, 404);
    return c.json(s);
  });
  r.patch("/scenes/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    return c.json(c.get("services").storyboard.updateScene(c.req.param("id"), body));
  });
  r.post("/scenes/:id/confirm", async (c) => {
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    const s = c.get("services").storyboard.confirmScene(c.req.param("id"), expectedVersion);
    publish("scene.confirmed", { id: s.id }, undefined);
    return c.json(s);
  });
  r.post("/scenes/:id/unconfirm", async (c) => {
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    const s = c.get("services").storyboard.unconfirmScene(c.req.param("id"), expectedVersion);
    publish("scene.unconfirmed", { id: s.id }, undefined);
    return c.json(s);
  });
  // Round-3 P1-④：单场重生。默认走同步方式，返回新 scene；expectedVersion 必填以避免并发覆盖。
  r.post("/scenes/:id/regenerate", async (c) => {
    const sceneId = c.req.param("id");
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    const s = await c.get("services").storyboard.regenerateScene(sceneId, expectedVersion);
    publish("scene.regenerated", { id: s.id, episodeId: s.episodeId }, undefined);
    return c.json(s);
  });
  r.get("/scenes/:id/validate", (c) =>
    c.json(c.get("services").storyboard.validateStoryboard(c.req.param("id"))),
  );

  // ===== Shots =====
  r.get("/scenes/:id/shots", (c) =>
    c.json({ items: c.get("services").storyboard.listShots(c.req.param("id")) }),
  );
  r.post("/scenes/:id/shots", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.sceneId = c.req.param("id");
    return c.json(c.get("services").storyboard.createShot(body), 201);
  });
  r.get("/shots/:id", (c) => {
    const s = c.get("services").ctx.repos.shots.getById(c.req.param("id"));
    if (!s) return c.json({ code: "missing_resource", message: "镜头不存在", retryable: false }, 404);
    return c.json(s);
  });
  r.patch("/shots/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    return c.json(c.get("services").storyboard.updateShot(c.req.param("id"), body));
  });

  // ===== Keyframes =====
  r.get("/shots/:id/keyframes", (c) =>
    c.json({ items: c.get("services").storyboard.listKeyframes(c.req.param("id")) }),
  );
  r.post("/shots/:id/keyframes", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.shotId = c.req.param("id");
    return c.json(c.get("services").storyboard.createKeyframe(body), 201);
  });
  r.patch("/keyframes/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    return c.json(c.get("services").storyboard.updateKeyframe(c.req.param("id"), body));
  });
  r.post("/keyframes/:id/confirm", async (c) => {
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    return c.json(c.get("services").storyboard.confirmKeyframe(c.req.param("id"), expectedVersion));
  });

  // ===== Scene dialogue / action blocks =====
  r.post("/scenes/:id/dialogue-blocks", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.sceneId = c.req.param("id");
    return c.json(c.get("services").storyboard.createDialogueBlock(body), 201);
  });
  r.post("/scenes/:id/action-blocks", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.sceneId = c.req.param("id");
    return c.json(c.get("services").storyboard.createActionBlock(body), 201);
  });
  r.get("/scenes/:id/dialogue-blocks", (c) =>
    c.json({ items: c.get("services").ctx.repos.sceneDialogueBlocks.listByScene(c.req.param("id")) }),
  );
  r.get("/scenes/:id/action-blocks", (c) =>
    c.json({ items: c.get("services").ctx.repos.sceneActionBlocks.listByScene(c.req.param("id")) }),
  );

  // ===== Links: scene-character / shot-character / shot-prop =====
  r.post("/scene-characters", async (c) => {
    const body = await readJsonBody<Record<string, string>>(c.req.raw);
    return c.json(
      c.get("services").storyboard.addSceneCharacter({
        sceneId: body.sceneId!,
        characterId: body.characterId!,
        lookId: body.lookId,
        presenceType: body.presenceType,
      }),
      201,
    );
  });
  r.delete("/scenes/:sceneId/characters/:characterId", (c) => {
    c.get("services").storyboard.removeSceneCharacter(
      c.req.param("sceneId"),
      c.req.param("characterId"),
    );
    return c.body(null, 204);
  });
  r.post("/shot-characters", async (c) => {
    const body = await readJsonBody<Record<string, string>>(c.req.raw);
    return c.json(
      c.get("services").storyboard.addShotCharacter({
        shotId: body.shotId!,
        characterId: body.characterId!,
        lookId: body.lookId,
        blockingNote: body.blockingNote,
      }),
      201,
    );
  });
  r.delete("/shots/:shotId/characters/:characterId", (c) => {
    c.get("services").storyboard.removeShotCharacter(
      c.req.param("shotId"),
      c.req.param("characterId"),
    );
    return c.body(null, 204);
  });
  r.post("/shot-props", async (c) => {
    const body = await readJsonBody<Record<string, string>>(c.req.raw);
    return c.json(
      c.get("services").storyboard.addShotProp({
        shotId: body.shotId!,
        propId: body.propId!,
        stateNote: body.stateNote,
      }),
      201,
    );
  });
  r.delete("/shots/:shotId/props/:propId", (c) => {
    c.get("services").storyboard.removeShotProp(c.req.param("shotId"), c.req.param("propId"));
    return c.body(null, 204);
  });

  return r;
}
