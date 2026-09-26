/**
 * Episode 视频拼接编排（download → normalize → concat）。
 *
 * 设计要点：
 *   - 输入是「按顺序的 shot 视频 URL 列表」（一般来自
 *     `VideoAssetService.getEpisodeCompositionManifest`）。URL 都是 Ark 24h 过期
 *     的临时链接，所以每次拼接前都会先下到本地临时目录。
 *   - Ark seedance 输出的每条视频规格未必完全一致（分辨率/fps/编码），直接
 *     `concat` demuxer 会失败或音画不齐；因此逐条 **normalize**（re-encode 到
 *     统一 codec/分辨率/fps/采样率）后再走 concat demuxer + `-c copy`。
 *   - 拼接完毕后 ffprobe 一次得到最终元信息（时长/宽高/是否含音轨），返给
 *     调用方（会被 composition-store 写进 meta.json）。
 *   - 每一步都通过 `onProgress` 回调把状态推给上层（用于 SSE / server.log）。
 *
 * 输出：final mp4 落到 `output.filePath`，临时目录清理后返回统计信息。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { ffmpegBin, probe, run, type ProbeResult } from "./ffmpeg.js";

export type ComposeStage =
  | "prepare"
  | "download"
  | "normalize"
  | "concat"
  | "probe"
  | "cleanup"
  | "done";

export interface ComposeProgress {
  stage: ComposeStage;
  /** 当前处理到第几个 clip（1-based）；对 concat/probe/done 阶段可为 undefined。 */
  index?: number;
  /** clip 总数。 */
  total?: number;
  /** 附加说明。 */
  message?: string;
}

export interface ComposeClipInput {
  /** 稳定 id，用于日志和临时文件命名。 */
  id: string;
  /** Ark 24h URL 或本地 file:// / 绝对路径。 */
  sourceUrl: string;
  /** 可选：期望时长（秒），仅用于对比 probe 结果的兜底校验。 */
  expectedDurationSec?: number;
}

export interface ComposeOptions {
  /** 目标宽度（像素）。默认 1080。 */
  width?: number;
  /** 目标高度（像素）。默认 1920（竖屏 9:16）。 */
  height?: number;
  /** 目标帧率。默认 30。 */
  fps?: number;
  /** 视频 CRF（0-51，越小越清晰）。默认 20。 */
  crf?: number;
  /** libx264 preset。默认 veryfast。 */
  preset?: string;
  /** 音频码率。默认 128k。 */
  audioBitrate?: string;
  /** 音频采样率。默认 48000。 */
  audioSampleRate?: number;
  /** 音频声道。默认 2。 */
  audioChannels?: number;
}

export interface ComposeInput {
  /** 拼接后 mp4 的最终落地路径（绝对路径）。 */
  outputPath: string;
  /** 临时工作目录（相对/绝对均可）。函数会创建；结束时会清理。 */
  workDir: string;
  clips: ComposeClipInput[];
  opts?: ComposeOptions;
  onProgress?: (p: ComposeProgress) => void;
  /** 用于日志 tag。 */
  logTag?: string;
}

export interface ComposeResult {
  outputPath: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  clipCount: number;
  /** 每个 clip 的 probe 结果（normalize 后的）。 */
  clipStats: Array<
    ProbeResult & { id: string; sourceUrl: string; normalizedPath: string }
  >;
  /** ffmpeg 二进制的绝对路径 / 命令名（用于排障）。 */
  ffmpegBin: string;
}

const DEFAULTS: Required<ComposeOptions> = {
  width: 1080,
  height: 1920,
  fps: 30,
  crf: 20,
  preset: "veryfast",
  audioBitrate: "128k",
  audioSampleRate: 48000,
  audioChannels: 2,
};

export async function composeEpisodeVideo(
  input: ComposeInput,
): Promise<ComposeResult> {
  const opts: Required<ComposeOptions> = { ...DEFAULTS, ...(input.opts ?? {}) };
  const emit = (p: ComposeProgress): void => {
    input.onProgress?.(p);
  };

  if (input.clips.length === 0) {
    throw new Error("composeEpisodeVideo: clips 不能为空");
  }

  emit({ stage: "prepare", total: input.clips.length });
  await fs.mkdir(input.workDir, { recursive: true });
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });

  const total = input.clips.length;
  const rawPaths: string[] = [];
  const normalizedPaths: string[] = [];
  const clipStats: ComposeResult["clipStats"] = [];

  try {
    // -------- 1) 下载 --------
    for (let i = 0; i < input.clips.length; i++) {
      const clip = input.clips[i]!;
      emit({ stage: "download", index: i + 1, total, message: clip.id });
      const rawPath = path.join(input.workDir, `raw-${pad(i)}.mp4`);
      await downloadToFile(clip.sourceUrl, rawPath);
      rawPaths.push(rawPath);
    }

    // -------- 2) 逐条 normalize --------
    for (let i = 0; i < rawPaths.length; i++) {
      const src = rawPaths[i]!;
      const clip = input.clips[i]!;
      const dst = path.join(input.workDir, `norm-${pad(i)}.mp4`);
      emit({ stage: "normalize", index: i + 1, total, message: clip.id });
      await normalizeClip(src, dst, opts);
      normalizedPaths.push(dst);
      const stat = await probe(dst);
      clipStats.push({
        ...stat,
        id: clip.id,
        sourceUrl: clip.sourceUrl,
        normalizedPath: dst,
      });
    }

    // -------- 3) concat --------
    emit({ stage: "concat", total });
    const listFile = path.join(input.workDir, "concat.txt");
    await fs.writeFile(
      listFile,
      normalizedPaths
        .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
        .join("\n") + "\n",
      "utf8",
    );
    await run(ffmpegBin(), [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      input.outputPath,
    ]);

    // -------- 4) probe 输出 --------
    emit({ stage: "probe" });
    const finalProbe = await probe(input.outputPath);
    const size = (await fs.stat(input.outputPath)).size;

    return {
      outputPath: input.outputPath,
      sizeBytes: size,
      durationSec: finalProbe.durationSec,
      width: finalProbe.width || opts.width,
      height: finalProbe.height || opts.height,
      fps: finalProbe.fps || opts.fps,
      hasAudio: finalProbe.hasAudio,
      clipCount: input.clips.length,
      clipStats,
      ffmpegBin: ffmpegBin(),
    };
  } finally {
    emit({ stage: "cleanup" });
    // 清理临时目录（best effort）
    try {
      await fs.rm(input.workDir, { recursive: true, force: true });
    } catch {
      // 保留错误主线，清理失败不阻断
    }
    emit({ stage: "done", total });
  }
}

async function normalizeClip(
  src: string,
  dst: string,
  opts: Required<ComposeOptions>,
): Promise<void> {
  // 视频滤镜：等比缩放到目标画幅内 → 补黑边 → 强制统一 fps / SAR。
  const vf =
    `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,` +
    `pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    `fps=${opts.fps},setsar=1`;

  // 先探针决定音频来源：源有音轨走 0:a；无音轨用 lavfi anullsrc 补一条静音，
  // 保证所有片段的音频参数一致，concat demuxer + `-c copy` 才能正确工作。
  const srcProbe = await probe(src);

  const args: string[] = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    src,
  ];
  if (!srcProbe.hasAudio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=${opts.audioSampleRate}`,
    );
  }
  args.push(
    "-filter_complex",
    `[0:v]${vf}[v]`,
    "-map",
    "[v]",
    "-map",
    srcProbe.hasAudio ? "0:a:0" : "1:a:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-preset",
    opts.preset,
    "-crf",
    String(opts.crf),
    "-r",
    String(opts.fps),
    "-c:a",
    "aac",
    "-ar",
    String(opts.audioSampleRate),
    "-ac",
    String(opts.audioChannels),
    "-b:a",
    opts.audioBitrate,
    "-shortest",
    "-movflags",
    "+faststart",
    dst,
  );
  await run(ffmpegBin(), args);
}

async function downloadToFile(url: string, dst: string): Promise<void> {
  // 支持本地路径直传（file:// 或绝对路径），便于 e2e 测试。
  if (url.startsWith("/") || url.startsWith("file://")) {
    const src = url.startsWith("file://") ? url.replace(/^file:\/\//, "") : url;
    await fs.copyFile(src, dst);
    return;
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`下载视频失败 HTTP ${resp.status}: ${url}`);
  }
  if (!resp.body) {
    throw new Error(`下载视频响应无 body: ${url}`);
  }
  const fh = await fs.open(dst, "w");
  try {
    // Web Stream → Node Readable → 写文件
    const nodeStream = Readable.fromWeb(
      resp.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    await pipeline(nodeStream, fh.createWriteStream());
  } finally {
    // 若 pipeline 已关闭 fd，close 会静默；否则关闭。
    try {
      await fh.close();
    } catch {
      /* ignore */
    }
  }
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}
