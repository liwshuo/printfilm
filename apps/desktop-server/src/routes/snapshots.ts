/**
 * Round-3 P1-① 版本回滚 routes。
 *
 *  - GET  /api/snapshots?entityType=scenes&entityId=xxx&limit=20
 *  - POST /api/snapshots/:id/rollback  body: { expectedVersion: number }
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";

export function snapshotsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/snapshots", (c) => {
    const entityType = c.req.query("entityType");
    const entityId = c.req.query("entityId");
    const limitRaw = c.req.query("limit");
    if (!entityType || !entityId) {
      return c.json(
        {
          error: {
            code: "validation_failed",
            message: "entityType 与 entityId 必填",
            retryable: false,
          },
        },
        400,
      );
    }
    const limit = limitRaw ? Math.max(1, Math.min(100, Number(limitRaw) || 20)) : 20;
    const items = c
      .get("services")
      .rollback.listSnapshots(entityType, entityId, limit);
    return c.json({ items });
  });

  r.post("/snapshots/:id/rollback", async (c) => {
    const snapshotId = c.req.param("id");
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(
      c.req.raw,
    );
    const result = c.get("services").rollback.rollback(snapshotId, expectedVersion);
    publish(
      "entity.rolled_back",
      { entityType: result.entityType, entityId: result.entityId },
      undefined,
    );
    return c.json(result);
  });

  return r;
}
