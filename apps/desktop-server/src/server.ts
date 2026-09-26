/**
 * Hono app factory: mounts every route module under `/api`, wires the
 * services middleware, and installs the global DomainError → response handler.
 * Kept side-effect free so tests can instantiate their own app + registry.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { AppEnv } from "./env.js";
import { ServiceBundle } from "./services.js";
import { toErrorResponse } from "./errors.js";
import { serverLog } from "./logger.js";
import { projectsRouter } from "./routes/projects.js";
import { assetsRouter } from "./routes/assets.js";
import { storyboardsRouter } from "./routes/storyboards.js";
import { modelsRouter } from "./routes/models.js";
import { promptsRouter } from "./routes/prompts.js";
import { jobsRouter } from "./routes/jobs.js";
import { artifactsRouter } from "./routes/artifacts.js";
import { reviewsRouter } from "./routes/reviews.js";
import { exportsRouter } from "./routes/exports.js";
import { eventsRouter } from "./routes/events.js";
import { continuityRouter } from "./routes/continuity.js";
import { aiRouter } from "./routes/ai.js";
import { imageAssetsRouter } from "./routes/image-assets.js";
import { videoAssetsRouter } from "./routes/video-assets.js";
import { snapshotsRouter } from "./routes/snapshots.js";
import { logsRouter } from "./routes/logs.js";

export interface CreateAppOptions {
  services: ServiceBundle;
  /** Enable request logging (default true when not in test). */
  logging?: boolean;
}

export function createApp(opts: CreateAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  if (opts.logging !== false) app.use("*", logger());
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE"] }));

  // Attach services to every request.
  app.use("*", async (c, next) => {
    c.set("services", opts.services);
    await next();
  });

  // 请求生命周期结构化日志：只记录 /api/*，避开 health 和 logs 自身，避免循环。
  //   entry: 收到请求时打点，包含 method / path / query
  //   exit : 处理结束时打点，包含 status / durationMs
  //   若 status >= 500，写 error 级；>= 400 写 warn；其他 debug
  // 这样即使 toErrorResponse 因某种原因没触发，我们也能在 server.log 里看到"请求进来、
  // 500 出去"的痕迹，配合 web.log 就能定位到具体调用。
  app.use("/api/*", async (c, next) => {
    // 排除 health（噪声）和 logs（避免前端上报 → 服务端 log → 再触发 log 的死循环）
    const p = c.req.path;
    if (p === "/api/health" || p === "/api/logs") {
      await next();
      return;
    }
    const t0 = Date.now();
    serverLog.debug("http.request", {
      method: c.req.method,
      path: p,
      query: c.req.query(),
    });
    await next();
    const status = c.res.status;
    const durationMs = Date.now() - t0;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "debug";
    serverLog[level]("http.response", {
      method: c.req.method,
      path: p,
      status,
      durationMs,
    });
  });

  // Health probe.
  app.get("/api/health", (c) => c.json({ status: "ok", now: new Date().toISOString() }));

  // Mount all API routers under /api.
  app.route("/api", projectsRouter());
  app.route("/api", assetsRouter());
  app.route("/api", storyboardsRouter());
  app.route("/api", modelsRouter());
  app.route("/api", promptsRouter());
  app.route("/api", jobsRouter());
  app.route("/api", artifactsRouter());
  app.route("/api", reviewsRouter());
  app.route("/api", exportsRouter());
  app.route("/api", eventsRouter());
  app.route("/api", continuityRouter());
  app.route("/api", aiRouter());
  app.route("/api", imageAssetsRouter());
  app.route("/api", videoAssetsRouter());
  app.route("/api", snapshotsRouter());
  app.route("/api", logsRouter());

  // Central error mapping.
  app.onError((err, c) => toErrorResponse(err, c));

  // 404 fallback in envelope shape.
  app.notFound((c) =>
    c.json({ code: "missing_resource", message: `路由不存在：${c.req.path}`, retryable: false }, 404),
  );

  return app;
}
