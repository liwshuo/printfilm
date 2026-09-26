/**
 * Continuity Lock routes (drama-skills 逐字锁面管理).
 * scope=project / episode / scene；applies_to 记录锁面适用的镜头/角色范围。
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";

export function continuityRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/projects/:id/continuity-locks", (c) => {
    const status = c.req.query("status"); // "active" 可只列启用中
    const list = c.get("services").continuity.listByProject(c.req.param("id"));
    return c.json({
      items: status === "active" ? list.filter((l) => l.status === "active") : list,
    });
  });

  r.post("/projects/:id/continuity-locks", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.projectId = c.req.param("id");
    const lock = c.get("services").continuity.create(body);
    publish("continuity.lock.created", { id: lock.id }, lock.projectId);
    return c.json(lock, 201);
  });

  r.patch("/continuity-locks/:id", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    const lock = c.get("services").continuity.update(c.req.param("id"), body);
    publish("continuity.lock.updated", { id: lock.id }, lock.projectId);
    return c.json(lock);
  });

  r.post("/continuity-locks/:id/disable", (c) => {
    const lock = c.get("services").continuity.disable(c.req.param("id"));
    publish("continuity.lock.disabled", { id: lock.id }, lock.projectId);
    return c.json(lock);
  });

  r.delete("/continuity-locks/:id", (c) => {
    c.get("services").continuity.delete(c.req.param("id"));
    return c.body(null, 204);
  });

  return r;
}
