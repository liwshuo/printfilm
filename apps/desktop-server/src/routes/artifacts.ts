/**
 * Artifact routes (data-and-api-v1.md §8, §10 step 8).
 * ArtifactService only owns lifecycle transitions; generation writeback happens
 * inside JobOrchestrator.completeJob / ExportService.completeCompose.
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";
import { ArtifactType, ArtifactStatus } from "@dramaflow/domain";

export function artifactsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/projects/:id/artifacts", (c) => {
    const q = c.req.query();
    const filter = {
      artifactType: q.artifactType as ArtifactType | undefined,
      status: q.status as ArtifactStatus | undefined,
      sourceEntityType: q.sourceEntityType,
      sourceEntityId: q.sourceEntityId,
      sourceTaskId: q.sourceTaskId,
    };
    return c.json({
      items: c.get("services").artifact.listByProject(c.req.param("id"), filter),
    });
  });
  r.get("/artifacts/:id", (c) => {
    const a = c.get("services").artifact.getArtifact(c.req.param("id"));
    if (!a) return c.json({ code: "missing_resource", message: "产物不存在", retryable: false }, 404);
    return c.json(a);
  });
  r.post("/artifacts/:id/mark-deleted", (c) => {
    const a = c.get("services").artifact.markDeleted(c.req.param("id"));
    publish("artifact.deleted", { id: a.id }, a.projectId);
    return c.json(a);
  });
  r.post("/artifacts/:id/mark-broken", async (c) => {
    const { reason } = await readJsonBody<{ reason?: string }>(c.req.raw);
    const a = c.get("services").artifact.markBroken(c.req.param("id"), reason);
    publish("artifact.broken", { id: a.id, reason }, a.projectId);
    return c.json(a);
  });

  return r;
}
