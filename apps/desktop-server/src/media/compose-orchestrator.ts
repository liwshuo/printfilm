/**
 * Compose orchestration route helper（在 desktop-server 里粘接
 * VideoAssetService manifest ⇢ ffmpeg-composer 拼接 ⇢ composition-store）。
 *
 * 拆到独立文件是为了让 routes/video-assets.ts 保持薄，且方便单测。
 */

import fs from "node:fs";
import path from "node:path";
import type { EpisodeCompositionManifest } from "@dramaflow/core-services";

import {
  composeEpisodeVideo,
  type ComposeOptions,
  type ComposeProgress,
} from "./ffmpeg-composer.js";
import {
  allocateCompositionSlot,
  saveCompositionMeta,
  type CompositionMeta,
} from "./composition-store.js";

export interface RunComposeInput {
  manifest: EpisodeCompositionManifest;
  /** 用户覆盖参数（可选）。 */
  opts?: ComposeOptions;
  /** 是否允许中间存在未生成的 shot。默认 false（严格校验）。 */
  allowMissing?: boolean;
  onProgress?: (p: ComposeProgress) => void;
}

export async function runEpisodeCompose(
  input: RunComposeInput,
): Promise<CompositionMeta> {
  const { manifest } = input;
  if (manifest.totalShotCount === 0) {
    throw new Error(`剧集没有任何 shot：${manifest.episodeId}`);
  }
  const readyItems = manifest.items.filter((it) => it.video !== null);
  if (!input.allowMissing && readyItems.length !== manifest.totalShotCount) {
    const missing = manifest.items
      .filter((it) => it.video === null)
      .map((it) => `S${it.sceneNo}-Sh${it.shotNo}`);
    throw new Error(
      `仍有 shot 未生成视频，无法拼接：${missing.join(", ")}（如需忽略请传 allowMissing=true）`,
    );
  }
  if (readyItems.length === 0) {
    throw new Error(`没有任何已就绪的 shot 视频可拼接：${manifest.episodeId}`);
  }

  // 基于第一条 clip 推断目标分辨率；由 opts 覆盖优先。
  const first = readyItems[0]!.video!;
  const inferred = pixelsFor(first.resolution, first.ratio);
  const opts: ComposeOptions = {
    width: input.opts?.width ?? inferred.width,
    height: input.opts?.height ?? inferred.height,
    fps: input.opts?.fps ?? 30,
    crf: input.opts?.crf ?? 20,
    preset: input.opts?.preset ?? "veryfast",
    audioBitrate: input.opts?.audioBitrate ?? "128k",
    audioSampleRate: input.opts?.audioSampleRate ?? 48000,
    audioChannels: input.opts?.audioChannels ?? 2,
  };

  const slot = allocateCompositionSlot(manifest.episodeId);
  const result = await composeEpisodeVideo({
    outputPath: slot.outputPath,
    workDir: slot.workDir,
    clips: readyItems.map((it) => ({
      id: `${it.sceneNo}-${it.shotNo}`,
      sourceUrl: it.video!.videoUrl,
      expectedDurationSec: it.video!.durationSec,
    })),
    opts,
    onProgress: input.onProgress,
    logTag: manifest.episodeId,
  });

  const meta: CompositionMeta = {
    id: slot.id,
    episodeId: manifest.episodeId,
    createdAt: new Date().toISOString(),
    outputPath: slot.outputPath,
    filename: slot.filename,
    sizeBytes: result.sizeBytes,
    durationSec: result.durationSec,
    width: result.width,
    height: result.height,
    fps: result.fps,
    hasAudio: result.hasAudio,
    clipCount: result.clipCount,
    opts: { ...opts },
    clips: result.clipStats.map((s) => ({
      id: s.id,
      sourceUrl: s.sourceUrl,
      durationSec: s.durationSec,
      width: s.width,
      height: s.height,
    })),
  };
  await saveCompositionMeta(meta);
  return meta;
}

/** resolution × ratio → 目标像素。用于推断拼接输出分辨率。 */
function pixelsFor(
  resolution: string,
  ratio: string,
): { width: number; height: number } {
  const shortSide =
    resolution === "1080p" ? 1080 : resolution === "720p" ? 720 : 480;
  const longSide =
    resolution === "1080p" ? 1920 : resolution === "720p" ? 1280 : 854;
  switch (ratio) {
    case "9:16":
      return { width: shortSide, height: longSide };
    case "3:4":
      return { width: shortSide, height: Math.round((shortSide * 4) / 3) };
    case "1:1":
      return { width: shortSide, height: shortSide };
    case "4:3":
      return {
        width: Math.round((shortSide * 4) / 3),
        height: shortSide,
      };
    case "16:9":
    default:
      return { width: longSide, height: shortSide };
  }
}

/** Stream mp4 (Range 支持) — 供路由调用。 */
export function buildFileRangeResponse(
  absPath: string,
  rangeHeader: string | null,
): Response {
  const stat = fs.statSync(absPath);
  const total = stat.size;
  const contentType = "video/mp4";

  if (!rangeHeader) {
    const stream = fs.createReadStream(absPath);
    const body = nodeStreamToWebStream(stream);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) {
    return new Response("Invalid Range", {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }
  const startStr = m[1] ?? "";
  const endStr = m[2] ?? "";
  let start = startStr === "" ? undefined : Number(startStr);
  let end = endStr === "" ? undefined : Number(endStr);

  if (start === undefined && end !== undefined) {
    // suffix range: bytes=-N
    start = Math.max(0, total - end);
    end = total - 1;
  } else if (start !== undefined && end === undefined) {
    end = total - 1;
  }
  if (
    start === undefined ||
    end === undefined ||
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start > end ||
    end >= total
  ) {
    return new Response("Requested range not satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  const chunkSize = end - start + 1;
  const stream = fs.createReadStream(absPath, { start, end });
  const body = nodeStreamToWebStream(stream);
  return new Response(body, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}

function nodeStreamToWebStream(
  nodeStream: NodeJS.ReadableStream,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        const buf =
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk as Buffer);
        controller.enqueue(buf);
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      (nodeStream as { destroy?: () => void }).destroy?.();
    },
  });
}

// 复用 path 以避免 lint 抱怨（保留给未来 extension）
void path;
