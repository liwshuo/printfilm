/**
 * Video assets routes — Round-4 Phase-C：Shot 级视频生成 + Episode 级本地拼接。
 *
 *  - GET  /api/shots/:id/video-assets                       历史视频列表（最新在前）
 *  - POST /api/shots/:id/generate-video                     为该 shot 生成一条新视频
 *  - GET  /api/episodes/:id/video-assets                    本集所有视频（供拼接页用）
 *  - GET  /api/episodes/:id/latest-shot-videos              本集每个 shot 的最新视频
 *  - GET  /api/episodes/:id/composition-manifest            拼接清单（每 shot 最新 succeeded）
 *  - POST /api/episodes/:id/compose-video                   触发本地 ffmpeg 拼接/转码
 *  - GET  /api/episodes/:id/compositions                    列出历史拼接产物
 *  - GET  /api/episodes/:id/compositions/:filename          流式返回拼接产物（支持 Range）
 *
 * 视频体的实际字节流不落库，仅记录 Ark 返回的 24h 过期 URL 与元数据。
 * Episode 级拼接产物落在 `.runtime/composes/{episodeId}/` 下的 mp4 + meta.json，
 * 由 media/composition-store.ts 管理。
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";
import { serverLog } from "../logger.js";
import { runEpisodeCompose, buildFileRangeResponse } from "../media/compose-orchestrator.js";
import {
  listCompositions,
  resolveCompositionFile,
} from "../media/composition-store.js";

export function videoAssetsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/shots/:id/video-assets", (c) => {
    const shotId = c.req.param("id");
    const items = c.get("services").videoAsset.listByShot(shotId);
    return c.json({ items });
  });

  r.post("/shots/:id/generate-video", async (c) => {
    const shotId = c.req.param("id");
    // 允许可选 body：{ durationSec?, resolution?, ratio?, generateAudio?, cameraFixed? }
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const result = await c
      .get("services")
      .videoAsset.generateShotVideo(shotId, {
        durationSec: normNumber(body.durationSec),
        resolution: normString(body.resolution) as
          | "480p"
          | "720p"
          | "1080p"
          | undefined,
        ratio: normString(body.ratio) as
          | "9:16"
          | "16:9"
          | "1:1"
          | "4:3"
          | "3:4"
          | undefined,
        generateAudio:
          typeof body.generateAudio === "boolean" ? body.generateAudio : undefined,
        cameraFixed:
          typeof body.cameraFixed === "boolean" ? body.cameraFixed : undefined,
      });
    publish(
      "video_asset.shot_video.created",
      { id: result.asset.id, shotId },
      undefined,
    );
    return c.json(result, 201);
  });

  r.get("/episodes/:id/video-assets", (c) => {
    const episodeId = c.req.param("id");
    const repos = c.get("services").ctx.repos;
    const items = repos.videoAssets.listByEpisode(episodeId);
    return c.json({ items });
  });

  r.get("/episodes/:id/latest-shot-videos", (c) => {
    const episodeId = c.req.param("id");
    const items = c
      .get("services")
      .videoAsset.latestByEpisodeShots(episodeId);
    return c.json({ items });
  });

  /**
   * Round-4 Phase-C：本集视频拼接清单。
   * 按 (sceneNo, shotNo) 排序返回每个 shot 的最新 succeeded 视频。
   * 前端据此渲染「顺序播放」和「导出 manifest」。
   */
  r.get("/episodes/:id/composition-manifest", (c) => {
    const episodeId = c.req.param("id");
    const manifest = c
      .get("services")
      .videoAsset.getEpisodeCompositionManifest(episodeId);
    return c.json(manifest);
  });

  /**
   * POST /api/episodes/:id/compose-video
   *
   * body（全可选）：
   *   {
   *     "allowMissing": boolean,   // 允许中间 shot 缺视频（默认 false）
   *     "opts": {
   *       "width": number, "height": number, "fps": number,
   *       "crf": number, "preset": string,
   *       "audioBitrate": string, "audioSampleRate": number, "audioChannels": number
   *     }
   *   }
   *
   * 同步返回 201 + CompositionMeta；过程中会向 SSE 推送 `episode.compose.progress`
   * 和最终 `episode.compose.completed` / `episode.compose.failed` 事件。
   */
  r.post("/episodes/:id/compose-video", async (c) => {
    const episodeId = c.req.param("id");
    const body = await readJsonBody<{
      allowMissing?: boolean;
      opts?: Record<string, unknown>;
    }>(c.req.raw);

    const manifest = c
      .get("services")
      .videoAsset.getEpisodeCompositionManifest(episodeId);

    const startedAt = Date.now();
    publish(
      "episode.compose.started",
      {
        episodeId,
        totalShotCount: manifest.totalShotCount,
        readyShotCount: manifest.readyShotCount,
      },
      undefined,
    );
    serverLog.info("episode.compose.started", {
      episodeId,
      totalShotCount: manifest.totalShotCount,
      readyShotCount: manifest.readyShotCount,
    });

    try {
      const meta = await runEpisodeCompose({
        manifest,
        allowMissing: body.allowMissing === true,
        opts: sanitizeOpts(body.opts),
        onProgress: (p) => {
          publish(
            "episode.compose.progress",
            { episodeId, ...p },
            undefined,
          );
        },
      });

      const durationMs = Date.now() - startedAt;
      publish(
        "episode.compose.completed",
        {
          episodeId,
          id: meta.id,
          filename: meta.filename,
          sizeBytes: meta.sizeBytes,
          durationSec: meta.durationSec,
          clipCount: meta.clipCount,
          durationMs,
        },
        undefined,
      );
      serverLog.info("episode.compose.completed", {
        episodeId,
        id: meta.id,
        sizeBytes: meta.sizeBytes,
        durationSec: meta.durationSec,
        clipCount: meta.clipCount,
        durationMs,
      });
      return c.json(meta, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;
      publish(
        "episode.compose.failed",
        { episodeId, message, durationMs },
        undefined,
      );
      serverLog.error("episode.compose.failed", {
        episodeId,
        message,
        durationMs,
        err: err instanceof Error ? err : undefined,
      });
      return c.json(
        {
          code: "compose_failed",
          message: `视频拼接失败：${message}`,
          retryable: true,
        },
        502,
      );
    }
  });

  r.get("/episodes/:id/compositions", async (c) => {
    const episodeId = c.req.param("id");
    const items = await listCompositions(episodeId);
    return c.json({ items });
  });

  r.get("/episodes/:id/compositions/:filename", async (c) => {
    const episodeId = c.req.param("id");
    const filename = c.req.param("filename");
    const abs = await resolveCompositionFile(episodeId, filename);
    if (!abs) {
      return c.json(
        {
          code: "missing_resource",
          message: `拼接产物不存在：${filename}`,
          retryable: false,
        },
        404,
      );
    }
    const range = c.req.header("range") ?? null;
    return buildFileRangeResponse(abs, range);
  });

  return r;
}

function sanitizeOpts(
  raw: Record<string, unknown> | undefined,
): Record<string, number | string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, number | string> = {};
  const numKeys = [
    "width",
    "height",
    "fps",
    "crf",
    "audioSampleRate",
    "audioChannels",
  ] as const;
  for (const k of numKeys) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  const strKeys = ["preset", "audioBitrate"] as const;
  for (const k of strKeys) {
    const v = raw[k];
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function normString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}
