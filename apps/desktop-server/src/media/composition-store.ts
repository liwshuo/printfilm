/**
 * Episode 拼接产物本地仓库（fs-based）。
 *
 * 布局：
 *   .runtime/composes/{episodeId}/
 *     - episode-{ts}-{shortId}.mp4        实际视频体
 *     - episode-{ts}-{shortId}.meta.json  拼接元信息（时长、宽高、每段 clip、生成参数）
 *
 * 之所以走 fs 而非 SQLite：
 *   - Episode-level 成品视频体量大（几十 MB - 几百 MB），不适合塞进业务表；
 *   - 拼接是「派生结果」，可随时基于最新 shot 视频再产一次，弱持久化即可；
 *   - 后续要接 ExportBundle / compose_export，可以以本目录为「产物存放地」，
 *     只需要在 export_bundle 里记录 outputPath 即可，不影响本模块的存储契约。
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const COMPOSE_ROOT =
  process.env.DRAMAFLOW_COMPOSE_DIR ?? path.join(".runtime", "composes");

export interface CompositionMeta {
  /** 稳定 id：`{ts}-{shortId}`。 */
  id: string;
  episodeId: string;
  /** 生成时刻 ISO。 */
  createdAt: string;
  outputPath: string; // 相对 CWD
  filename: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  clipCount: number;
  /** 生成参数快照（分辨率/CRF/preset 等）。 */
  opts: Record<string, unknown>;
  /** 每段 clip 的 sourceUrl / shotId / 时长快照，用于回溯。 */
  clips: Array<{
    id: string;
    sourceUrl: string;
    durationSec: number;
    width: number;
    height: number;
  }>;
}

export interface CompositionSlot {
  id: string;
  episodeId: string;
  workDir: string;
  outputPath: string;
  filename: string;
}

/** 创建一个新的输出槽位（未落盘），返回目标路径与临时工作目录。 */
export function allocateCompositionSlot(episodeId: string): CompositionSlot {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "");
  const shortId = crypto.randomBytes(3).toString("hex");
  const id = `${ts}-${shortId}`;
  const dir = path.join(COMPOSE_ROOT, episodeId);
  const filename = `episode-${id}.mp4`;
  return {
    id,
    episodeId,
    workDir: path.join(dir, `.work-${id}`),
    outputPath: path.join(dir, filename),
    filename,
  };
}

export async function saveCompositionMeta(meta: CompositionMeta): Promise<void> {
  const metaPath = path.join(
    COMPOSE_ROOT,
    meta.episodeId,
    `episode-${meta.id}.meta.json`,
  );
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

/** 列出该 episode 已有的拼接产物（最新在前）。 */
export async function listCompositions(
  episodeId: string,
): Promise<CompositionMeta[]> {
  const dir = path.join(COMPOSE_ROOT, episodeId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const metaFiles = entries.filter((f) => f.endsWith(".meta.json"));
  const items: CompositionMeta[] = [];
  for (const f of metaFiles) {
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf8");
      items.push(JSON.parse(raw) as CompositionMeta);
    } catch {
      // 单个 meta 损坏不影响其他项
    }
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items;
}

/** 定位 mp4 绝对路径；文件不存在返回 null。 */
export async function resolveCompositionFile(
  episodeId: string,
  filename: string,
): Promise<string | null> {
  // 只允许我们生成的命名格式，防越权。
  if (!/^episode-[A-Za-z0-9\-]+\.mp4$/.test(filename)) return null;
  const abs = path.resolve(COMPOSE_ROOT, episodeId, filename);
  const root = path.resolve(COMPOSE_ROOT);
  if (!abs.startsWith(root)) return null;
  try {
    await fs.access(abs);
    return abs;
  } catch {
    return null;
  }
}

export function composeRoot(): string {
  return COMPOSE_ROOT;
}
