/**
 * Model Profile routes (model-settings-spec, data-and-api-v1.md §10 step 6).
 * View endpoints return the masked `ModelProfileView` — never the raw credential.
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";

export function modelsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/model-profiles", (c) => c.json({ items: c.get("services").modelProfile.list() }));
  r.get("/model-profiles/views", (c) => c.json({ items: c.get("services").modelProfile.listViews() }));
  r.post("/model-profiles", async (c) => {
    const body = await readJsonBody(c.req.raw);
    return c.json(c.get("services").modelProfile.create(body), 201);
  });
  r.get("/model-profiles/:id", (c) => {
    const p = c.get("services").modelProfile.get(c.req.param("id"));
    if (!p) return c.json({ code: "missing_resource", message: "模型档案不存在", retryable: false }, 404);
    return c.json(p);
  });
  r.get("/model-profiles/:id/view", (c) => {
    const v = c.get("services").modelProfile.getView(c.req.param("id"));
    if (!v) return c.json({ code: "missing_resource", message: "模型档案不存在", retryable: false }, 404);
    return c.json(v);
  });
  r.patch("/model-profiles/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    return c.json(c.get("services").modelProfile.update(c.req.param("id"), body));
  });
  r.post("/model-profiles/:id/set-active", async (c) => {
    const { isActive } = await readJsonBody<{ isActive: boolean }>(c.req.raw);
    return c.json(c.get("services").modelProfile.setActive(c.req.param("id"), isActive));
  });
  r.post("/model-profiles/:id/test-credential", (c) =>
    c.json(c.get("services").modelProfile.testCredential(c.req.param("id"))),
  );

  return r;
}
