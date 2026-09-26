/**
 * Export Center routes (export-center-spec-v1.md, §10 step 10).
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";
import {
  CreateExportInput,
  CompleteExportInput,
  FailExportInput,
} from "@dramaflow/core-services";

export function exportsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post("/exports", async (c) => {
    const body = await readJsonBody<CreateExportInput>(c.req.raw);
    const b = c.get("services").export.createExport(body);
    publish("export.created", { id: b.id, version: b.version, status: b.status }, b.projectId);
    return c.json(b, 201);
  });
  r.get("/projects/:id/exports", (c) =>
    c.json({ items: c.get("services").export.listBundles(c.req.param("id")) }),
  );
  r.get("/exports/:id", (c) => {
    const b = c.get("services").export.getBundle(c.req.param("id"));
    if (!b) return c.json({ code: "missing_resource", message: "导出包不存在", retryable: false }, 404);
    return c.json(b);
  });
  r.post("/exports/:id/start", (c) => {
    const { bundle } = c.get("services").export.startCompose(c.req.param("id"));
    publish("export.status.changed", { id: bundle.id, status: bundle.status }, bundle.projectId);
    return c.json(bundle);
  });
  r.post("/exports/:id/complete", async (c) => {
    const body = await readJsonBody<CompleteExportInput>(c.req.raw);
    const b = c.get("services").export.completeCompose(c.req.param("id"), body);
    publish("export.status.changed", { id: b.id, status: b.status }, b.projectId);
    return c.json(b);
  });
  r.post("/exports/:id/fail", async (c) => {
    const body = await readJsonBody<FailExportInput>(c.req.raw);
    const b = c.get("services").export.failCompose(c.req.param("id"), body);
    publish(
      "export.status.changed",
      { id: b.id, status: b.status, errorMessage: b.errorMessage },
      b.projectId,
    );
    return c.json(b);
  });
  r.post("/exports/:id/cancel", (c) => {
    const b = c.get("services").export.cancelCompose(c.req.param("id"));
    publish("export.status.changed", { id: b.id, status: b.status }, b.projectId);
    return c.json(b);
  });
  r.post("/exports/:id/retry", (c) => {
    const b = c.get("services").export.retryExport(c.req.param("id"));
    publish("export.retried", { id: b.id, status: b.status }, b.projectId);
    return c.json(b);
  });

  return r;
}
