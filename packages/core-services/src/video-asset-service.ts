/**
 * VideoAssetService — Round-4 Phase-C：Shot 级视频生成编排。
 *
 * 用法：
 *   1) 用户已在某个 shot 上生成过首帧图（`generateShotFirstFrame`）；
 *   2) 前端点「🎥 生成本段视频」→ 调用 `generateShotVideo(shotId)`；
 *   3) 本服务：
 *      - 读 shot + scene + episode + project + 关联角色/道具，拿最近一张成功
 *        首帧图作为 Seedance 视频的 `first_frame` 输入；
 *      - 编排一条视频 prompt（复用 ImageAssetService 的构图信息 + 动作描述）；
 *      - 调 `generateArkVideo(...)`（Seedance 2.0-mini，异步任务 + 轮询）；
 *      - 成功：落一条 `video_assets` 记录（status=succeeded, video_url = 上游
 *        24h 过期 URL, last_frame_url = 接力锚点）。
 *      - 失败：落 status=failed 的记录并抛 provider_unavailable。
 *
 * 一集完整 mp4 拼接由 ExportBundle / compose_export 链路负责，本 service 不管。
 */

import type {
  Id,
  Episode,
  Project,
  Character,
  Location,
  Prop,
  Scene,
  SceneActionBlock,
  SceneDialogueBlock,
  Shot,
  ImageAsset,
  VideoAsset,
} from "@dramaflow/domain";
import { missingResource, providerUnavailable } from "@dramaflow/domain";
import { BaseService } from "./context.js";
import {
  generateArkVideo,
  isProviderReady,
  AiApiKeyError,
  AiUpstreamError,
  DEFAULT_VIDEO_MODEL_ID,
  VIDEO_MODEL_I2V_DEFAULT_RESOLUTION,
  VIDEO_MODEL_DEFAULT_RESOLUTION,
  type VideoOptions,
  type VideoResolution,
  type VideoRatio,
} from "./ai/index.js";

export interface GenerateShotVideoOptions {
  /** 默认 5s；Seedance 2.0-mini 上限 15。 */
  durationSec?: number;
  /** 默认 `1080p`。 */
  resolution?: VideoResolution;
  /** 默认 `9:16`（竖屏短剧）。 */
  ratio?: VideoRatio;
  /** 默认 true：直出有声视频。 */
  generateAudio?: boolean;
  /** 默认 false：允许镜头轻微运动。 */
  cameraFixed?: boolean;
}

export interface ShotVideoPayload {
  asset: VideoAsset;
}

/** Round-4 Phase-C：拼接清单单项。 */
export interface CompositionItem {
  sceneId: Id;
  sceneNo: number;
  shotId: Id;
  shotNo: number;
  shotType: string | null;
  intent: string | null;
  /** 本 shot 最新一条 succeeded 的视频；未生成时为 null。 */
  video: VideoAsset | null;
}

/** Round-4 Phase-C：一集完整视频的拼接清单。 */
export interface EpisodeCompositionManifest {
  episodeId: Id;
  episodeNo: number;
  episodeTitle: string;
  /** 本集所有 shot 总数（不管有没有视频）。 */
  totalShotCount: number;
  /** 已生成视频的 shot 数（用于「x / y 段就绪」进度）。 */
  readyShotCount: number;
  /** 已就绪 shot 的时长累加（秒）。 */
  totalDurationSec: number;
  /** 按 (sceneNo, shotNo) 排序好的清单。 */
  items: CompositionItem[];
}

/**
 * Shot 视频生成的「预生成预览」——在真正调 Ark 之前，把即将下发的参数
 * 全部展示给用户看，避免"点一下才知道时长/分辨率"的黑盒体验。
 *
 * 计算规则与 `generateShotVideo` 完全一致（同一 `estimateShotDuration`
 * 与 `resolveDefault*Resolution`），因此除非人工在 body 里传 `durationSec`
 * / `resolution` / `ratio` 覆盖，实际生成结果就是本 preview 展示的值。
 */
export interface ShotVideoPreview {
  shotId: Id;
  /** 是否可执行生成（false 时前端应禁用生成按钮）。 */
  canGenerate: boolean;
  /** 阻断生成的硬性问题（如无首帧图 / 无 provider）。 */
  blockers: string[];
  /** 非阻断的软提示（如台词/动作块为空、fallback 到默认时长等）。 */
  warnings: string[];
  /** 预估时长（秒）。 */
  durationSec: number;
  durationSource:
    | "explicit"
    | "shot_text"
    | "text_estimate"
    | "scene_summary"
    | "default";
  durationDialogueChars: number;
  durationActionChars: number;
  /** 分辨率（依据 i2v/t2v 模式选默认）。 */
  resolution: VideoResolution;
  ratio: VideoRatio;
  /** 目标模型 id。 */
  modelId: string;
  /** 是否 image-to-video（有可用首帧图即 true）。 */
  isI2V: boolean;
  /** 若已有首帧图，一并回填 id 便于前端预览。 */
  firstFrameImageId?: Id;
}

const DEFAULT_RESOLUTION: VideoResolution = "1080p";
const DEFAULT_RATIO: VideoRatio = "9:16";
const DEFAULT_DURATION_SEC = 5;

/**
 * Seedance 2.0-mini 支持的时长范围（秒）。文档标称 5/10/15；实测传 [3, 12]
 * 之间的整数都能被服务端接受，且更短时长（3-6s）在 i2v 场景稳定性更好。
 */
const MIN_DURATION_SEC = 3;
const MAX_DURATION_SEC = 12;

/**
 * 「有效字符 → 秒」换算率。中文台词按 ~4.5 字/s 折算；这里取整成 5 便于计算，
 * 并给表演留一点自然停顿空间。
 */
const CHARS_PER_SECOND = 5;

export class VideoAssetService extends BaseService {
  /**
   * 列出某 shot 的历史视频（append-only；最新在前）。
   */
  listByShot(shotId: Id): VideoAsset[] {
    return this.repos.videoAssets.listByShot(shotId);
  }

  /** Episode 页 CTA 用：拿本集所有 shot 的最新视频。 */
  latestByEpisodeShots(episodeId: Id): VideoAsset[] {
    return this.repos.videoAssets.latestByEpisodeShots(episodeId);
  }

  /**
   * 「预生成预览」：不调 Ark，仅根据 shot / scene / 首帧图 / 台词动作块
   * 计算出**即将下发**的参数（时长、分辨率、画幅、模型、i2v/t2v）。
   *
   * 使用场景：Shot 卡片渲染时前端主动拉一次，把预估时长等展示在
   *「🎥 生成本段视频」按钮上方，让用户在点击前就能看到即将花什么样的钱、
   * 生成什么规格的视频。
   *
   * 与 `generateShotVideo` 共用同一套 duration / resolution 推导逻辑，
   * 二者结果**保证一致**（除非调用方在 body 里 override）。
   */
  previewShotVideoParams(shotId: Id): ShotVideoPreview {
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!isProviderReady()) {
      blockers.push(
        "尚未配置 Ark API Key（请先到 /models 页面填入 ARK_API_KEY）",
      );
    }

    const shot = this.repos.shots.getById(shotId);
    if (!shot) {
      throw missingResource(`分镜不存在：${shotId}`, { shotId });
    }
    const scene = this.repos.scenes.getById(shot.sceneId);
    if (!scene) {
      throw missingResource(`场次不存在：${shot.sceneId}`, {
        sceneId: shot.sceneId,
      });
    }

    // 首帧图：只有 status='succeeded' 的才算可用
    const shotImages = this.repos.imageAssets.listByShot(shotId);
    const firstFrameAsset: ImageAsset | undefined = shotImages.find(
      (i) => i.status === "succeeded",
    );
    const hasFirstFrame = Boolean(firstFrameAsset);
    if (!hasFirstFrame) {
      blockers.push("本分镜尚无可用首帧图，请先生成首帧再生成视频");
    }

    // 台词 / 动作块 —— 参与时长估算
    const sceneShots = this.repos.shots.listByScene(scene.id);
    const dialogueBlocks = this.repos.sceneDialogueBlocks.listByScene(scene.id);
    const actionBlocks = this.repos.sceneActionBlocks.listByScene(scene.id);
    const durationEstimate = estimateShotDuration({
      shot,
      scene,
      sceneShotCount: sceneShots.length,
      dialogueBlocks,
      actionBlocks,
    });

    if (durationEstimate.source === "default") {
      warnings.push(
        "场次 summary / 台词 / 动作 全部为空，无法据文本估算，将使用默认 5s 兜底",
      );
    } else if (durationEstimate.source === "scene_summary") {
      warnings.push(
        `未录入 dialogue/action 块，改用场次 summary + shot.intent 估算（约 ${durationEstimate.durationSec}s）`,
      );
    } else if (durationEstimate.source === "shot_text") {
      // 方案 A 主路径：shot 自带 dialogue + action，估时最准，不需要 warning。
    }

    // i2v/t2v 判定：与 generateShotVideo 一致，挂了首帧图即为 i2v
    const isI2V = hasFirstFrame;

    // 分辨率默认：i2v 走 I2V_DEFAULT，t2v 走 DEFAULT
    // （与 ark-video.ts / generateShotVideo 保持一致的策略）
    // 注：config map 声明支持 "4k"，但 VideoOptions.resolution 目前只到 1080p，
    // 4k 若出现则收敛回 DEFAULT_RESOLUTION。
    const modelId = DEFAULT_VIDEO_MODEL_ID;
    const rawDefault =
      (isI2V
        ? VIDEO_MODEL_I2V_DEFAULT_RESOLUTION[modelId]
        : VIDEO_MODEL_DEFAULT_RESOLUTION[modelId]) ?? DEFAULT_RESOLUTION;
    const resolution: VideoResolution =
      rawDefault === "4k" ? DEFAULT_RESOLUTION : rawDefault;
    const ratio: VideoRatio = DEFAULT_RATIO;

    return {
      shotId,
      canGenerate: blockers.length === 0,
      blockers,
      warnings,
      durationSec: durationEstimate.durationSec,
      durationSource: durationEstimate.source,
      durationDialogueChars: durationEstimate.dialogueChars,
      durationActionChars: durationEstimate.actionChars,
      resolution,
      ratio,
      modelId,
      isI2V,
      firstFrameImageId: firstFrameAsset?.id,
    };
  }

  /**
   * Round-4 Phase-C：一集完整视频的「拼接清单」——按 (scene.sortOrder, shot.sortOrder)
   * 排好序，逐项挂上本 shot 最新一条 status='succeeded' 的视频。缺项即视为「未生成」。
   *
   * 这是给前端「顺序播放 / 导出 manifest」用的，本 service 不负责真的 ffmpeg 拼接。
   */
  getEpisodeCompositionManifest(episodeId: Id): EpisodeCompositionManifest {
    const episode = this.repos.episodes.getById(episodeId);
    if (!episode) {
      throw missingResource(`剧集不存在：${episodeId}`, { episodeId });
    }
    const scenes = this.repos.scenes
      .listByEpisode(episodeId)
      .slice()
      .sort(
        (a, b) =>
          (a.sceneNo ?? a.sortOrder ?? 0) - (b.sceneNo ?? b.sortOrder ?? 0),
      );

    const items: CompositionItem[] = [];
    let totalShotCount = 0;
    let readyShotCount = 0;

    for (const scene of scenes) {
      const shotsInScene = this.repos.shots
        .listByScene(scene.id)
        .slice()
        .sort(
          (a, b) =>
            (a.shotNo ?? a.sortOrder ?? 0) - (b.shotNo ?? b.sortOrder ?? 0),
        );
      for (const shot of shotsInScene) {
        totalShotCount += 1;
        const videos = this.repos.videoAssets.listByShot(shot.id);
        const latestSucceeded = videos.find((v) => v.status === "succeeded");
        if (latestSucceeded) readyShotCount += 1;
        items.push({
          sceneId: scene.id,
          sceneNo: scene.sceneNo ?? scene.sortOrder ?? 0,
          shotId: shot.id,
          shotNo: shot.shotNo ?? shot.sortOrder ?? 0,
          shotType: shot.shotType ?? null,
          intent: shot.intent ?? null,
          video: latestSucceeded ?? null,
        });
      }
    }

    return {
      episodeId,
      episodeNo: episode.episodeNo,
      episodeTitle: episode.title ?? "",
      totalShotCount,
      readyShotCount,
      totalDurationSec: items.reduce(
        (acc, it) => acc + (it.video?.durationSec ?? 0),
        0,
      ),
      items,
    };
  }

  /**
   * 为指定 shot 生成一条 Seedance 视频。
   *
   * 前置条件：shot 已有一张 status='succeeded' 的首帧 image_asset；
   * 若没有则报 `missing_resource`——UI 侧应先引导「🎬 生成本段首帧」。
   */
  async generateShotVideo(
    shotId: Id,
    opts: GenerateShotVideoOptions = {},
  ): Promise<ShotVideoPayload> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 生成视频。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "shot_video", shotId },
      );
    }

    const shot = this.repos.shots.getById(shotId);
    if (!shot) throw missingResource(`分镜不存在：${shotId}`, { shotId });

    const scene = this.repos.scenes.getById(shot.sceneId);
    if (!scene) {
      throw missingResource(`场次不存在：${shot.sceneId}`, {
        sceneId: shot.sceneId,
      });
    }

    const episode = this.repos.episodes.getById(scene.episodeId);
    if (!episode) {
      throw missingResource(`剧集不存在：${scene.episodeId}`, {
        episodeId: scene.episodeId,
      });
    }
    const project = this.repos.projects.getById(episode.projectId);
    if (!project) {
      throw missingResource(`项目不存在：${episode.projectId}`, {
        projectId: episode.projectId,
      });
    }

    // 首帧图：拿本 shot 最新一张 status='succeeded' 的图
    const shotImages = this.repos.imageAssets.listByShot(shotId);
    const firstFrameAsset: ImageAsset | undefined = shotImages.find(
      (i) => i.status === "succeeded",
    );
    if (!firstFrameAsset) {
      throw missingResource(
        "本分镜尚无可用首帧图，请先在场次里生成首帧再来生成视频。",
        { shotId, stage: "shot_video.no_first_frame" },
      );
    }

    // 拉 shot 上的角色/道具 + scene 的场景，构造视频 prompt 里的动作/场景描述。
    const shotCharLinks = this.repos.shotCharacters.listByShot(shotId);
    const shotPropLinks = this.repos.shotProps.listByShot(shotId);
    const characters: Character[] = shotCharLinks
      .map((l) => this.repos.characters.getById(l.characterId))
      .filter((c): c is Character => c !== null && c !== undefined);
    const props: Prop[] = shotPropLinks
      .map((l) => this.repos.props.getById(l.propId))
      .filter((p): p is Prop => p !== null && p !== undefined);
    const location: Location | null = scene.locationId
      ? this.repos.locations.getById(scene.locationId) ?? null
      : null;

    // 台词 / 动作块 + 场景 shot 总数：用于动态估算 shot 时长（见 estimateShotDuration）。
    // 由于 Shot 层没有直接绑定台词，这里按 scene 级抓取后再按 shot 总数均摊——
    // 是一个简化启发式，比硬编码 5s 好，但不如「LLM 逐 shot 拆分台词」精细。
    const sceneShots = this.repos.shots.listByScene(scene.id);
    const dialogueBlocks = this.repos.sceneDialogueBlocks.listByScene(scene.id);
    const actionBlocks = this.repos.sceneActionBlocks.listByScene(scene.id);
    const durationEstimate = estimateShotDuration({
      shot,
      scene,
      sceneShotCount: sceneShots.length,
      dialogueBlocks,
      actionBlocks,
    });

    const { prompt, promptZh } = this.compileShotVideoPrompt({
      project,
      episode,
      scene,
      shot,
      characters,
      location,
      props,
      dialogueBlocks,
      actionBlocks,
      durationEstimate,
    });

    const resolution = opts.resolution ?? DEFAULT_RESOLUTION;
    const ratio = opts.ratio ?? DEFAULT_RATIO;
    // 显式覆盖 > 动态估算 > 默认 5s。三档兜底保证任何情况下都有值。
    const durationSec =
      opts.durationSec !== undefined
        ? clampDurationSec(Math.round(opts.durationSec))
        : durationEstimate.durationSec;

    // 调 Seedance 2.0-mini（异步任务 + 轮询）
    let videoUrl: string;
    let lastFrameUrl: string | undefined;
    let taskId: string;
    let modelId: string;
    let raw: Record<string, unknown>;
    try {
      const videoOpts: VideoOptions = {
        prompt,
        resolution,
        ratio,
        duration: durationSec,
        cameraFixed: opts.cameraFixed ?? false,
        generateAudio: opts.generateAudio ?? true,
        returnLastFrame: true,
        firstFrame: {
          // Seedance 支持 base64 或 URL；此处走 data URL（大部分 provider 支持）。
          base64: firstFrameAsset.base64,
        },
      };
      const res = await generateArkVideo(videoOpts);
      videoUrl = res.videoUrl;
      lastFrameUrl = res.lastFrameUrl;
      taskId = res.taskId;
      modelId = res.modelId;
      raw = normaliseRaw(res.raw);
    } catch (err) {
      const detail =
        err instanceof AiApiKeyError
          ? err.message
          : err instanceof AiUpstreamError
            ? `${err.status} ${err.message}`
            : (err as Error).message;
      // 落 failed 记录，UI 可以看到并「重试」。
      this.repos.videoAssets.create({
        episodeId: episode.id,
        sceneId: scene.id,
        shotId: shot.id,
        firstFrameImageId: firstFrameAsset.id,
        provider: "volcengine-ark",
        modelId: "unknown",
        prompt,
        promptZh,
        resolution,
        ratio,
        durationSec,
        durationSource: durationEstimate.source,
        durationDialogueChars: durationEstimate.dialogueChars,
        durationActionChars: durationEstimate.actionChars,
        // 有 firstFrameImageId 即视为 i2v；纯文生视频未来单独走另一入口。
        isI2V: true,
        videoUrl: "",
        rawResponse: {},
        status: "failed",
        errorMessage: detail,
        attemptCount: 1,
      });
      throw providerUnavailable(`AI 视频生成失败：${detail}`, {
        stage: "shot_video.generate",
        shotId,
        upstream: detail,
      });
    }

    const asset = this.repos.videoAssets.create({
      episodeId: episode.id,
      sceneId: scene.id,
      shotId: shot.id,
      firstFrameImageId: firstFrameAsset.id,
      provider: "volcengine-ark",
      modelId,
      prompt,
      promptZh,
      resolution,
      ratio,
      durationSec,
      durationSource: durationEstimate.source,
      durationDialogueChars: durationEstimate.dialogueChars,
      durationActionChars: durationEstimate.actionChars,
      // 当前入口一定挂首帧图（generateShotFirstFrame 前置），因此固定为 i2v。
      isI2V: true,
      videoUrl,
      lastFrameUrl,
      taskId,
      rawResponse: raw,
      status: "succeeded",
      attemptCount: 1,
    });

    this.logActivity({
      projectId: project.id,
      eventType: "video_asset.shot_video.created",
      summary: `EP${episode.episodeNo} · S${scene.sceneNo} · Shot#${shot.shotNo} 生成视频 (${durationSec}s, ${resolution})`,
      targetRef: { entityType: "shot", entityId: shot.id },
      payload: {
        extra: {
          videoAssetId: asset.id,
          modelId,
          taskId,
          durationSec,
          durationSource: durationEstimate.source,
          durationDialogueChars: durationEstimate.dialogueChars,
          durationActionChars: durationEstimate.actionChars,
          resolution,
          ratio,
          episodeId: episode.id,
          sceneId: scene.id,
          shotId: shot.id,
        },
      },
    });

    return { asset };
  }

  /**
   * 视频 prompt 拼接（确定性，无 LLM）——首帧图 + 场景/道具硬锁 + 动作描述。
   *
   * 结构（按顺序）：
   *   1. 风格锚（cinematic short-form vertical）
   *   2. 场景锁（HARD LOCK）：indoor/outdoor + timeOfDay + location.visualLock/visualSpec/lightingRules
   *   3. Scene 摘要（叙事上下文）
   *   4. Shot 动作（本条 shot 要演什么）
   *   5. 台词摘录（限制字数，供演员口型 / TTS 对齐）
   *   6. 角色锁 + 道具锁（HARD LOCK）
   *   7. 相机 / 运动锚
   *   8. 顶层负向指令（不换场景 / 不换道具 / 不加字幕）
   *
   * 关键改动（vs. old version）：
   *   - 增加 "STRICTLY maintain ..." 硬约束句式，明确禁止场景/道具漂移；
   *   - 场景块补齐 timeOfDay + location.visualSpec + spaceRules + lightingRules；
   *   - 道具块补齐 propType + visualSpec + continuityRules；
   *   - 台词块摘录当前 scene 的对白（避免 LLM 自由发挥导致口型对不上）。
   *   - i2v 首帧图已经作为 Ark first_frame 传上去，是最强的锁；prompt 层强化是二级保险。
   */
  private compileShotVideoPrompt(opts: {
    project: Project;
    episode: Episode;
    scene: Scene;
    shot: Shot;
    characters: Character[];
    location: Location | null;
    props: Prop[];
    dialogueBlocks: SceneDialogueBlock[];
    actionBlocks: SceneActionBlock[];
    durationEstimate: DurationEstimate;
  }): { prompt: string; promptZh: string } {
    const {
      project,
      episode,
      scene,
      shot,
      characters,
      location,
      props,
      dialogueBlocks,
      durationEstimate,
    } = opts;

    // -------- 1) 风格锚 --------
    const styleAnchor =
      "cinematic short-form vertical video clip, 9:16, smooth camera motion, natural performance, storybook cinematography, no watermark, no logo, no text overlay";

    // -------- 2) 场景锁（HARD LOCK） --------
    // indoor/outdoor 是短剧最容易漂的维度；把它作为硬约束句式明写在最前。
    const locationTypeLock = buildLocationTypeLock(location);
    const locLine = location
      ? `Location: ${[
          location.name,
          location.locationType,
          location.visualLock,
        ]
          .filter(Boolean)
          .join(" — ")}`
      : "";
    const locSpecLine = location
      ? buildLocationSpecLine(location)
      : "";
    const timeLine = scene.timeOfDay ? `Time of day: ${scene.timeOfDay}` : "";

    // -------- 3) Scene 摘要 --------
    const sceneDesc = scene.summary
      ? `Scene ${scene.sceneNo ?? scene.sortOrder ?? "?"}: ${scene.summary}`
      : "";

    // -------- 4) Shot 动作 --------
    const shotDesc = shot.intent
      ? `Shot action: ${shot.intent}`
      : shot.shotType
        ? `Shot type: ${shot.shotType}`
        : "";
    const performanceLine = shot.performanceNotes
      ? `Performance notes: ${shot.performanceNotes}`
      : "";

    // -------- 5) 台词摘录 --------
    // 只取 scene 级别的前若干条对白（避免 prompt 过长），并把说话人对齐上。
    const dialogueExcerpt = buildDialogueExcerpt(
      dialogueBlocks,
      characters,
      durationEstimate.durationSec,
    );

    // -------- 6) 角色锁 --------
    const charLine = characters.length
      ? "Characters in frame: " +
        characters
          .map((c) => [c.name, c.visualLock].filter(Boolean).join(" — "))
          .join("; ")
      : "";

    // -------- 6') 道具锁（HARD LOCK） --------
    const propLine = props.length
      ? "Props in frame: " +
        props
          .map((p) =>
            [p.name, p.propType, p.visualLock].filter(Boolean).join(" — "),
          )
          .join("; ")
      : "";
    const propSpecLine = props.length ? buildPropSpecLine(props) : "";
    const propHardLock = props.length
      ? "STRICTLY maintain the exact same props as shown in the reference frame — identical shape, color, material, and quantity; do not add, remove, or replace any prop."
      : "";

    // -------- 7) 相机 / 运动锚 --------
    const motionAnchor =
      "the character performs the described action with natural movement, subtle micro-expressions, hair/cloth/prop physics; camera follows the character with a gentle handheld feel unless a specific camera move is described";

    // -------- 8) 顶层负向指令 --------
    // 明确禁止「换场景 / 从室外切室内 / 换道具」——ffmpeg 拼接顺序无法修复漂移，
    // 只能在生成阶段守住。
    const globalHardLock =
      "STRICTLY maintain the exact scene, location, and environment shown in the reference first frame. Do not change indoor/outdoor context, do not switch rooms, do not alter lighting or background. Continue directly from the first frame.";

    const parts = [
      styleAnchor,
      globalHardLock,
      locationTypeLock,
      locLine,
      locSpecLine,
      timeLine,
      sceneDesc,
      shotDesc,
      performanceLine,
      dialogueExcerpt,
      charLine,
      propLine,
      propSpecLine,
      propHardLock,
      motionAnchor,
      "vertical 9:16 composition, natural lighting",
    ].filter((p) => p && p.trim().length > 0);

    const prompt = parts.join(". ");
    const promptZh =
      `EP${episode.episodeNo} · S${scene.sceneNo} · Shot#${shot.shotNo}：` +
      (scene.summary ?? "") +
      (shot.intent ? ` · 动作：${shot.intent}` : "") +
      ` · 时长：${durationEstimate.durationSec}s (${durationEstimate.source})` +
      ` · 项目：${project.name}`;
    return { prompt, promptZh };
  }
}

function normaliseRaw(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return { raw };
}

// ============================================================================
// 时长估算 / prompt lock 辅助（module-private，纯函数，方便未来抽单测）
// ============================================================================

/** estimateShotDuration 的返回结构，同时用于 promptZh + activity 日志。 */
interface DurationEstimate {
  durationSec: number;
  /**
   * 估算来源：
   *   - `explicit`           — shot.durationSec 显式指定
   *   - `shot_text`          — 方案 A：由 shot 自带的 dialogue + action 字数精确估算
   *   - `text_estimate`      — 由 scene_dialogue_blocks / scene_action_blocks 精确估算
   *   - `scene_summary`      — dialogue/action 块空，退回 scene.summary + dramaticGoal
   *                            + conflict + shot.intent 等自由文本估算（AI 当前主流路径）
   *   - `default`            — 前几者都无内容，走默认时长兜底
   */
  source:
    | "explicit"
    | "shot_text"
    | "text_estimate"
    | "scene_summary"
    | "default";
  /**
   * ⚠️ 字段语义随 source 变化，UI/落库端务必配合 source 一起解读：
   *   - `shot_text` / `text_estimate` / `explicit`：字面语义 —— 真正的 dialogue / action 字数
   *   - `scene_summary`：语义偏移承载 ——
   *       `dialogueChars` 承载 shot 独有文本字符数（intent + performanceNotes）
   *       `actionChars`   承载 scene 自由文本按 shot 数均摊后的字符数（scene.summary + goal + conflict）
   *     命名保留只为兼容前端 tooltip 与 video_assets 已落库列；未来若引入
   *     `otherChars` 三字段方案，可通过新 migration 严格解耦。
   *   - `default`：均为 0。
   */
  dialogueChars: number;
  actionChars: number;
}

/**
 * 估算 shot 的目标时长（秒）。优先级：
 *   1. shot.durationSec（人工/上游显式设定）→ 只做 clamp
 *   2. 台词字数 + 动作字数按 scene shot 数均摊 → 换算秒数
 *   3. **scene_summary 兜底**：AI 分场流程只写 scene.summary / dramaticGoal /
 *      conflict，并不会自动 populate scene_dialogue_blocks / scene_action_blocks，
 *      所以块表几乎恒空。这里把 scene 自由文本 + shot.intent / performanceNotes
 *      按 shot 数均摊，避免所有 shot 全都掉进 `default`。
 *   4. 前三者都无信号 → 兜底 DEFAULT_DURATION_SEC
 * 最终 clamp 到 [MIN_DURATION_SEC, MAX_DURATION_SEC]，避免超出 Ark 支持范围。
 */
function estimateShotDuration(input: {
  shot: Shot;
  scene: Scene;
  sceneShotCount: number;
  dialogueBlocks: SceneDialogueBlock[];
  actionBlocks: SceneActionBlock[];
}): DurationEstimate {
  const explicit = input.shot.durationSec;
  if (typeof explicit === "number" && explicit > 0) {
    return {
      durationSec: clampDurationSec(Math.round(explicit)),
      source: "explicit",
      dialogueChars: 0,
      actionChars: 0,
    };
  }

  // -------- 方案 A：shot 自带 dialogue / action 优先 --------
  // 参考 sd3 / CineGen 的做法：LLM 已在 scene_outline 阶段把 shot 粒度的台词与
  // 动作直接落在 shots 表，这里字数最贴合本 shot 实际内容，估时最准。
  const shotDialogueChars = sumEffectiveChars([input.shot.dialogue]);
  const shotActionChars = sumEffectiveChars([input.shot.action]);
  const shotTextChars = shotDialogueChars + shotActionChars;
  if (shotTextChars > 0) {
    // 1s 起手 + 台词/动作播放 + 1s 收尾。
    const raw = 1 + shotTextChars / CHARS_PER_SECOND + 1;
    return {
      durationSec: clampDurationSec(Math.round(raw)),
      source: "shot_text",
      dialogueChars: shotDialogueChars,
      actionChars: shotActionChars,
    };
  }

  const totalShots = Math.max(1, input.sceneShotCount);
  const dialogueChars = sumEffectiveChars(
    input.dialogueBlocks.map((b) => b.text),
  );
  const actionChars = sumEffectiveChars(
    input.actionBlocks.map((b) => b.actionText),
  );
  const totalChars = dialogueChars + actionChars;

  if (totalChars > 0) {
    const perShotChars = totalChars / totalShots;
    // 1s 起手镜头 + 台词/动作播放 + 1s 收尾停顿。
    const raw = 1 + perShotChars / CHARS_PER_SECOND + 1;
    return {
      durationSec: clampDurationSec(Math.round(raw)),
      source: "text_estimate",
      dialogueChars,
      actionChars,
    };
  }

  // -------- scene_summary 兜底 --------
  // 汇总 scene 自由文本 + 本 shot 的 intent / performanceNotes（shot 独有内容
  // 不参与均摊，直接加在本 shot 头上）。
  const sceneSummaryChars = sumEffectiveChars([
    input.scene.summary,
    input.scene.dramaticGoal,
    input.scene.conflict,
  ]);
  const shotSpecificChars = sumEffectiveChars([
    input.shot.intent,
    input.shot.performanceNotes,
  ]);
  const summaryPerShot = sceneSummaryChars / totalShots + shotSpecificChars;

  if (summaryPerShot > 0) {
    const raw = 1 + summaryPerShot / CHARS_PER_SECOND + 1;
    return {
      durationSec: clampDurationSec(Math.round(raw)),
      source: "scene_summary",
      // 复用两个字段承载"参与估算的字数"，让 UI 也能看到；
      // dialogue 位记 shot-specific（intent+performanceNotes），
      // action 位记 shot 均摊的 scene 自由文本 —— 语义近似即可。
      dialogueChars: shotSpecificChars,
      actionChars: Math.round(sceneSummaryChars / totalShots),
    };
  }

  return {
    durationSec: clampDurationSec(DEFAULT_DURATION_SEC),
    source: "default",
    dialogueChars: 0,
    actionChars: 0,
  };
}

function clampDurationSec(n: number): number {
  return Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, n));
}

function sumEffectiveChars(
  strs: Array<string | undefined | null>,
): number {
  let total = 0;
  for (const s of strs) {
    if (!s) continue;
    // 中英文都按 1 字算；忽略空白。
    for (const ch of s) {
      if (/\S/.test(ch)) total += 1;
    }
  }
  return total;
}

/**
 * 生成 "STRICTLY indoor / STRICTLY outdoor" 硬约束句。
 * 依据 `location.locationType`（典型值：indoor / outdoor / studio / street / room ...）粗判。
 * 无法判断时返回空串——不做假设，避免误导模型。
 */
function buildLocationTypeLock(location: Location | null): string {
  const type = location?.locationType?.toLowerCase() ?? "";
  const inferOutdoor = /outdoor|exterior|street|park|garden|field|forest|beach|rooftop/i.test(
    type,
  );
  const inferIndoor = /indoor|interior|room|kitchen|bedroom|studio|office|hall|shop|store/i.test(
    type,
  );
  if (inferOutdoor) {
    return "LOCATION HARD LOCK: outdoor scene. STRICTLY keep the shot outdoors; do not switch to any indoor space, corridor, or vehicle interior.";
  }
  if (inferIndoor) {
    return "LOCATION HARD LOCK: indoor scene. STRICTLY keep the shot inside the same room; do not switch to outdoor, street, or a different room.";
  }
  return "";
}

/**
 * 把 location 的 JSON 字段（visualSpec / spaceRules / lightingRules）
 * 压成一行文本描述，供 prompt 使用。跳过空对象；单条超长时截断。
 */
function buildLocationSpecLine(location: Location): string {
  const chunks: string[] = [];
  const visual = jsonSummary(location.visualSpec);
  if (visual) chunks.push(`visual: ${visual}`);
  const space = jsonSummary(location.spaceRules);
  if (space) chunks.push(`space: ${space}`);
  const lighting = jsonSummary(location.lightingRules);
  if (lighting) chunks.push(`lighting: ${lighting}`);
  const continuity = jsonSummary(location.continuityRules);
  if (continuity) chunks.push(`continuity: ${continuity}`);
  return chunks.length > 0 ? `Location spec — ${chunks.join("; ")}` : "";
}

function buildPropSpecLine(props: Prop[]): string {
  const bits = props
    .map((p) => {
      const v = jsonSummary(p.visualSpec);
      const c = jsonSummary(p.continuityRules);
      const detail = [v ? `visual: ${v}` : "", c ? `continuity: ${c}` : ""]
        .filter(Boolean)
        .join("; ");
      return detail ? `${p.name} — ${detail}` : "";
    })
    .filter((s) => s.length > 0);
  return bits.length > 0 ? `Prop spec — ${bits.join(" | ")}` : "";
}

/** 把 shallow JSON 压成 `k=v, k=v` 简短串；深/长值截断。 */
function jsonSummary(obj: Record<string, unknown> | undefined): string {
  if (!obj || typeof obj !== "object") return "";
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    let s: string;
    if (typeof v === "string") s = v;
    else if (typeof v === "number" || typeof v === "boolean") s = String(v);
    else s = JSON.stringify(v);
    if (s.length > 80) s = s.slice(0, 77) + "...";
    pairs.push(`${k}=${s}`);
  }
  return pairs.join(", ");
}

/**
 * 从 scene 的对白块中挑选前 N 条摘录，拼成 prompt 段。
 * 目的：给 i2v 一点「本 shot 大概在说什么」的语义线索，让口型 / 表情 / 节奏更贴近。
 * 上限：目标视频时长 × 12 字（大致对应 Seedance TTS 的口型窗口）。
 */
function buildDialogueExcerpt(
  blocks: SceneDialogueBlock[],
  characters: Character[],
  durationSec: number,
): string {
  if (blocks.length === 0) return "";
  const nameById = new Map(characters.map((c) => [c.id, c.name]));
  const budget = Math.max(20, durationSec * 12);
  const picked: string[] = [];
  let used = 0;
  const sorted = [...blocks].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const b of sorted) {
    const text = b.text?.trim();
    if (!text) continue;
    const speaker = b.speakerCharacterId
      ? nameById.get(b.speakerCharacterId) ?? "?"
      : "narrator";
    const line = `${speaker}: ${text}`;
    if (used + line.length > budget) break;
    picked.push(line);
    used += line.length;
    if (picked.length >= 4) break;
  }
  return picked.length > 0 ? `Dialogue excerpt — ${picked.join(" | ")}` : "";
}
