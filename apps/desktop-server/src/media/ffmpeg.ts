/**
 * ffmpeg / ffprobe 二进制封装。
 *
 * - 允许通过环境变量 `DRAMAFLOW_FFMPEG_BIN` / `DRAMAFLOW_FFPROBE_BIN` 显式覆盖路径；
 *   默认走 PATH（"ffmpeg" / "ffprobe"）。
 * - 全部 API 都是 async spawn 封装：非零退出码 → 抛错，`stderr` 尾巴带在异常里，便于排查。
 * - 目的是让上层（composer）只关心「一步一步跑什么命令」，不用重复写 spawn 样板。
 */

import { spawn } from "node:child_process";

export function ffmpegBin(): string {
  return process.env.DRAMAFLOW_FFMPEG_BIN?.trim() || "ffmpeg";
}

export function ffprobeBin(): string {
  return process.env.DRAMAFLOW_FFPROBE_BIN?.trim() || "ffprobe";
}

export interface RunOptions {
  /** 逐行接收 stderr（ffmpeg 进度输出走 stderr）。 */
  onStderr?: (line: string) => void;
  /** cwd。 */
  cwd?: string;
}

/** 运行外部进程，失败时抛出（含尾部 stderr）。stdout 以字符串返回。 */
export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = "";
    let stderrTail = ""; // 保留全部，用于排错

    child.stdout.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });

    let carry = "";
    child.stderr.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      stderrTail += chunk;
      if (!opts.onStderr) return;
      const combined = carry + chunk;
      const lines = combined.split(/\r?\n|\r/);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length === 0) continue;
        try {
          opts.onStderr(line);
        } catch {
          // 上层回调异常不影响主流程
        }
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (opts.onStderr && carry.length > 0) {
        try {
          opts.onStderr(carry);
        } catch {
          /* ignore */
        }
      }
      if (code === 0) {
        resolve({ stdout, stderr: stderrTail });
        return;
      }
      const tail = stderrTail.split(/\r?\n/).slice(-20).join("\n");
      reject(
        new Error(
          `${cmd} exited with code ${code}\n--- stderr tail ---\n${tail}`,
        ),
      );
    });
  });
}

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export async function probe(inputPath: string): Promise<ProbeResult> {
  const { stdout } = await run(ffprobeBin(), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }>;
  };

  const streams = parsed.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const durationSec = parseFloat(parsed.format?.duration ?? "0");
  const width = v?.width ?? 0;
  const height = v?.height ?? 0;
  const fps = parseFps(v?.avg_frame_rate) || parseFps(v?.r_frame_rate) || 0;

  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width,
    height,
    fps,
    hasVideo: !!v,
    hasAudio: !!a,
  };
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split("/");
  const num = Number(n);
  const den = Number(d ?? "1");
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

/** 探针：ffmpeg / ffprobe 是否可用。 */
export async function ensureAvailable(): Promise<void> {
  await run(ffmpegBin(), ["-version"]);
  await run(ffprobeBin(), ["-version"]);
}
