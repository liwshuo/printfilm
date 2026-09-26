/**
 * Job (GenerationTask) routes (job-orchestrator-contract-v1.md, §10 step 7).
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";
import {
  CreateJobInput,
  CompleteJobResult,
  FailJobInput,
} from "@dramaflow/core-services";

export function jobsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post("/jobs", async (c) => {
    const body = await readJsonBody<CreateJobInput>(c.req.raw);
    const t = c.get("services").jobs.createJob(body);
    publish("task.created", { id: t.id, taskType: t.taskType, status: t.status }, t.projectId);
    return c.json(t, 201);
  });
  r.get("/projects/:id/jobs", (c) =>
    c.json({ items: c.get("services").jobs.listJobs(c.req.param("id")) }),
  );
  /**
   * 按来源实体查询任务，前端页面 mount / 刷新时 resume 用：
   *   GET /jobs?entityType=episode&entityId=<id>&status=queued,running
   */
  r.get("/jobs", (c) => {
    const entityType = c.req.query("entityType");
    const entityId = c.req.query("entityId");
    if (!entityType || !entityId) {
      return c.json(
        {
          code: "invalid_input",
          message: "缺少参数：entityType / entityId 均必填",
          retryable: false,
        },
        400,
      );
    }
    const statusParam = c.req.query("status");
    const statusIn = statusParam
      ? (statusParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean) as ("queued" | "running" | "succeeded" | "failed" | "cancelled")[])
      : undefined;
    const items = c
      .get("services")
      .jobs.listJobsBySource(entityType, entityId, statusIn);
    return c.json({ items });
  });
  r.get("/jobs/:id", (c) => {
    const t = c.get("services").jobs.getJob(c.req.param("id"));
    if (!t) return c.json({ code: "missing_resource", message: "任务不存在", retryable: false }, 404);
    return c.json(t);
  });
  r.get("/jobs/:id/logs", (c) =>
    c.json({ items: c.get("services").jobs.listLogs(c.req.param("id")) }),
  );

  r.post("/jobs/:id/start", (c) => {
    const t = c.get("services").jobs.startJob(c.req.param("id"));
    publish("task.status.changed", { id: t.id, status: t.status }, t.projectId);
    return c.json(t);
  });
  r.post("/jobs/:id/complete", async (c) => {
    const body = await readJsonBody<CompleteJobResult>(c.req.raw);
    const t = c.get("services").jobs.completeJob(c.req.param("id"), body);
    publish("task.status.changed", { id: t.id, status: t.status }, t.projectId);
    return c.json(t);
  });
  r.post("/jobs/:id/fail", async (c) => {
    const body = await readJsonBody<FailJobInput>(c.req.raw);
    const t = c.get("services").jobs.failJob(c.req.param("id"), body);
    publish("task.status.changed", { id: t.id, status: t.status, errorCode: t.errorCode }, t.projectId);
    return c.json(t);
  });
  r.post("/jobs/:id/cancel", (c) => {
    const t = c.get("services").jobs.cancelJob(c.req.param("id"));
    publish("task.status.changed", { id: t.id, status: t.status }, t.projectId);
    return c.json(t);
  });
  r.post("/jobs/:id/retry", (c) => {
    const t = c.get("services").jobs.retryJob(c.req.param("id"));
    publish("task.retried", { id: t.id, retryOfTaskId: t.retryOfTaskId }, t.projectId);
    return c.json(t, 201);
  });

  return r;
}
