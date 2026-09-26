/**
 * ImageAssetService — Stage F 图像素材编排（综合方案 §4.F、M4）。
 *
 * P0 能力：
 *   1) `generateFirstFrame(episodeId)` —— 基于 episode 的核心字段编排一条英文
 *      prompt，走 seedream 出一张竖屏首帧图，落 `image_assets`。
 *   2) `list(episodeId)` —— 按 episode 列图。
 *   3) `get(id)` —— 拿单张图（包含 base64）。
 *
 * 硬依赖 provider：无 key / Ark 上游失败 → `provider_unavailable`。
 */

import type {
  ImageAsset,
  Id,
  Episode,
  Project,
  Character,
  Location,
  Prop,
  Scene,
  Shot,
} from "@dramaflow/domain";
import {
  missingResource,
  providerUnavailable,
  CONTENT_TYPE_REGISTRY,
} from "@dramaflow/domain";
import { BaseService } from "./context.js";
import {
  callArkChat,
  callArkImage,
  isProviderReady,
  AiApiKeyError,
  AiUpstreamError,
  DEFAULT_IMAGE_MODEL_ID,
  IMAGE_SIZE_PRESETS,
  type ImageSizePreset,
} from "./ai/index.js";

const DEFAULT_SIZE: ImageSizePreset = "1440x2560"; // 9:16 竖屏（Seedream 4.x 2K+ 达标）

export interface FirstFramePayload {
  asset: ImageAsset;
  /** 供前端直接放到 <img src> 用（`data:image/png;base64,...`）。 */
  dataUrl: string;
}

export class ImageAssetService extends BaseService {
  list(episodeId: Id): ImageAsset[] {
    return this.repos.imageAssets.listByEpisode(episodeId);
  }

  get(id: Id): ImageAsset {
    const found = this.repos.imageAssets.getById(id);
    if (!found) throw missingResource(`图像不存在：${id}`, { id });
    return found;
  }

  /**
   * Round-3 P2-⑤：把某场次名下的所有 succeeded 图片打上 stale 标签。
   *
   * 触发点：`StoryboardService.regenerateScene` 或 `RollbackService.rollback` scenes。
   * 只处理 succeeded 记录：failed 本身就在等胖哥重试，stale 再叠加没意义。
   * 返回被标记的数量，用于活动日志或 UI toast。
   */
  markStaleForScene(sceneId: Id, reason: string): number {
    const rows = this.repos.imageAssets.listByScene(sceneId);
    let count = 0;
    for (const r of rows) {
      if (r.status === "succeeded") {
        this.repos.imageAssets.update(r.id, {
          status: "stale",
          staleReason: reason,
        });
        count += 1;
      }
    }
    return count;
  }

  /**
   * 单张图片「重试出图」入口（Round-3 P0）。
   *
   * 使用场景：
   *   1) 前一张失败（status=failed）—— 复用 promptPositive / sizePreset 再冲一次；
   *   2) 前一张成功但用户想再抽一张 —— 复用 prompt，attempt+1、retryOfId 指回原图。
   *   3) 前一张是编排 prompt 阶段失败（promptPositive="[compile_failed]"）—— 无法
   *      复用 prompt，回落到「按 fk 分派到完整 generateXxx」重跑；attemptCount 会重置。
   *
   * 注意：无论成败，返回的都是新落库的 image_asset 记录；失败时同时 throw providerUnavailable。
   */
  async retryImageAsset(id: Id): Promise<FirstFramePayload> {
    const prev = this.repos.imageAssets.getById(id);
    if (!prev) throw missingResource(`图像不存在：${id}`, { id });

    // Case 3：prompt 阶段失败，回落分派
    if (prev.promptPositive === "[compile_failed]") {
      if (prev.shotId) return this.generateShotFirstFrame(prev.shotId);
      if (prev.characterId) return this.generateCharacterReference(prev.characterId);
      if (prev.locationId) return this.generateLocationReference(prev.locationId);
      if (prev.propId) return this.generatePropReference(prev.propId);
      if (prev.episodeId) return this.generateFirstFrame(prev.episodeId);
      throw missingResource("失败记录缺少下游关联，无法确定重试目标", { id });
    }

    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 生成图像。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "retry", imageAssetId: id },
      );
    }

    // 项目 id：从任一关联实体反查
    const projectId = this.resolveProjectIdOfImageAsset(prev);
    const attemptCount = (prev.attemptCount ?? 1) + 1;

    // Case 1/2：复用 prompt+size 直调 callArkImage
    let image: { base64: string; mimeType: string };
    let modelId: string;
    let raw: Record<string, unknown>;
    try {
      const res = await callArkImage({
        prompt: prev.promptPositive,
        // prev.sizePreset 是 string；callArkImage 会用 IMAGE_SIZE_PRESETS.includes 做运行时校验，
        // 这里作类型收窄即可（若历史数据里的 size 不在档位内，会被上游 throw AiUpstreamError 兜住）。
        size: prev.sizePreset as ImageSizePreset,
      });
      const first = res.images[0];
      if (!first) throw new AiUpstreamError("Ark 未返回任何图像", 200);
      image = { base64: first.base64, mimeType: first.mimeType ?? "image/png" };
      modelId = res.modelId;
      raw = normaliseRawResponse(res.raw);
    } catch (err) {
      const detail =
        err instanceof AiApiKeyError
          ? err.message
          : err instanceof AiUpstreamError
            ? `${err.status} ${err.message}`
            : (err as Error).message;
      // 重试再失败：继续落一条 failed 记录，attemptCount 累加、retryOfId 链回原图。
      this.recordFailedImageAsset({
        projectId,
        episodeId: prev.episodeId,
        sceneId: prev.sceneId,
        shotId: prev.shotId,
        characterId: prev.characterId,
        locationId: prev.locationId,
        propId: prev.propId,
        promptPositive: prev.promptPositive,
        promptPositiveZh: prev.promptPositiveZh,
        errorMessage: detail,
        stage: "retry.image",
        retryOfId: prev.id,
        attemptCount,
      });
      throw providerUnavailable(`AI 图像生成失败：${detail}`, {
        stage: "retry.image",
        imageAssetId: id,
        upstream: detail,
      });
    }

    const asset = this.repos.imageAssets.create({
      episodeId: prev.episodeId,
      sceneId: prev.sceneId,
      shotId: prev.shotId,
      keyframeId: prev.keyframeId,
      characterId: prev.characterId,
      locationId: prev.locationId,
      propId: prev.propId,
      provider: "volcengine-ark",
      modelId,
      promptPositive: prev.promptPositive,
      promptPositiveZh: prev.promptPositiveZh,
      sizePreset: prev.sizePreset,
      base64: image.base64,
      mimeType: image.mimeType,
      rawResponse: raw,
      status: "succeeded",
      attemptCount,
      retryOfId: prev.id,
    });

    this.logActivity({
      projectId,
      eventType: "image_asset.retry.succeeded",
      summary: `重试图片成功（第 ${attemptCount} 次）`,
      targetRef: { entityType: "image_asset", entityId: asset.id },
      payload: {
        extra: {
          previousImageAssetId: prev.id,
          previousStatus: prev.status,
          modelId,
        },
      },
    });

    return {
      asset,
      dataUrl: `data:${asset.mimeType};base64,${asset.base64}`,
    };
  }

  /**
   * 为 episode 生成一张首帧参考图。
   *
   * 流程：
   *   1) 校验 provider ready；episode / project 存在。
   *   2) 走 chat 让 LLM 把 episode 字段翻译成一条英文 prompt（含 negative 元素、
   *      风格锁短语）。P0 尚无 visual_lock DB 支持，直接根据 contentType 拼一段
   *      默认锁短语兜底。
   *   3) callArkImage 出图（size = 1024x1792 竖屏，watermark=false, b64_json）。
   *   4) 落 image_assets 表。
   */
  async generateFirstFrame(episodeId: Id): Promise<FirstFramePayload> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 生成图像。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "first_frame", episodeId },
      );
    }
    const episode = this.repos.episodes.getById(episodeId);
    if (!episode) throw missingResource(`剧集不存在：${episodeId}`, { episodeId });
    const project = this.repos.projects.getById(episode.projectId);
    if (!project)
      throw missingResource(`项目不存在：${episode.projectId}`, {
        projectId: episode.projectId,
      });

    // Step 1 · 走 chat 把 episode 字段编排成一条英文 image prompt
    let imagePrompt: string;
    let promptRefZh: string;
    try {
      ({ prompt: imagePrompt, refZh: promptRefZh } =
        await this.compileFirstFramePrompt(project, episode));
    } catch (err) {
      // 编排 prompt 失败：也落一条 failed 记录，方便 UI 展示失败态 + 一键重试。
      const failReason = `AI 编排 image prompt 失败：${(err as Error).message}`;
      this.recordFailedImageAsset({
        projectId: project.id,
        episodeId,
        promptPositive: "[compile_failed]",
        errorMessage: failReason,
        stage: "first_frame.compile",
      });
      throw providerUnavailable(failReason, {
        stage: "first_frame.compile",
        episodeId,
      });
    }

    // Step 2 · 出图
    let image: { base64: string; mimeType: string };
    let modelId: string;
    let raw: Record<string, unknown>;
    try {
      const res = await callArkImage({
        prompt: imagePrompt,
        size: DEFAULT_SIZE,
      });
      const first = res.images[0];
      if (!first) throw new AiUpstreamError("Ark 未返回任何图像", 200);
      image = { base64: first.base64, mimeType: first.mimeType ?? "image/png" };
      modelId = res.modelId;
      raw = normaliseRawResponse(res.raw);
    } catch (err) {
      const detail =
        err instanceof AiApiKeyError
          ? err.message
          : err instanceof AiUpstreamError
            ? `${err.status} ${err.message}`
            : (err as Error).message;
      // 出图失败：落一条 failed 记录，保留 prompt 供重试；然后抛出上游错。
      this.recordFailedImageAsset({
        projectId: project.id,
        episodeId,
        promptPositive: imagePrompt,
        promptPositiveZh: promptRefZh,
        errorMessage: detail,
        stage: "first_frame.image",
      });
      throw providerUnavailable(`AI 图像生成失败：${detail}`, {
        stage: "first_frame.image",
        episodeId,
        upstream: detail,
      });
    }

    // Step 3 · 落库（成功记录）
    const asset = this.repos.imageAssets.create({
      episodeId,
      provider: "volcengine-ark",
      modelId,
      promptPositive: imagePrompt,
      promptPositiveZh: promptRefZh,
      sizePreset: DEFAULT_SIZE,
      base64: image.base64,
      mimeType: image.mimeType,
      rawResponse: raw,
      status: "succeeded",
      attemptCount: 1,
    });

    this.logActivity({
      projectId: project.id,
      eventType: "image_asset.first_frame.created",
      summary: `EP${episode.episodeNo} 生成首帧参考图`,
      targetRef: { entityType: "episode", entityId: episodeId },
      payload: {
        extra: {
          modelId,
          sizePreset: DEFAULT_SIZE,
          imageAssetId: asset.id,
        },
      },
    });

    return {
      asset,
      dataUrl: `data:${asset.mimeType};base64,${asset.base64}`,
    };
  }

  // ============================================================
  // 资产参考图（P1）：角色 / 场景 / 道具的视觉锁参考图
  // ============================================================
  //
  // 与 episode 首帧图的关键区别：不走 LLM 编排 prompt，直接用 asset.visualLock
  // 作为核心描述 + 项目 style anchor 拼接。理由：
  //   1) visualLock 已经是精心编排的视觉规格（可能是中文），LLM 二次改写反而丢信息
  //   2) 少一次 LLM 调用 → 快 3-8s、省一次上游失败点
  //   3) Seedream 4.x/5.x 中英混合 prompt 效果稳定，无需强制翻译
  //
  // 三个 kind 共享 `generateAssetReference` 私有实现，各自 wrapper 只负责取实体 + 编 prompt。

  async generateCharacterReference(characterId: Id): Promise<FirstFramePayload> {
    return this.generateAssetReference("character", characterId);
  }

  async generateLocationReference(locationId: Id): Promise<FirstFramePayload> {
    return this.generateAssetReference("location", locationId);
  }

  async generatePropReference(propId: Id): Promise<FirstFramePayload> {
    return this.generateAssetReference("prop", propId);
  }

  // ============================================================
  // Shot 首帧图（P1）：按 shot 出一张 9:16 竖屏首帧
  // ============================================================
  //
  // 与 episode 首帧图的区别：
  //   1) 粒度更细，取 shot.sceneId → scene，shot 关联的角色 / 道具 / 场景 look
  //      共同拼一条 prompt。
  //   2) 不走 LLM 编排（确定性 + 快 + 便于复现）：直接用 project style anchor +
  //      shot intent + scene summary + 角色 visualLock + 场景 visualLock +
  //      道具 visualLock 拼接。
  //   3) 落 image_assets 时同时写 episode_id / scene_id / shot_id，方便按任意
  //      粒度回查。
  //
  // 备注：Seedream 支持 `reference_image_urls` 做图生图，但当前资产参考图
  // 以 base64 存 sqlite，没有可访问 URL；暂不接入 image-to-image。后续如果
  // 引入本地静态服务或 CDN 上传，可在这里追加 referenceImageUrls，进一步锁
  // 定跨镜一致性。
  async generateShotFirstFrame(shotId: Id): Promise<FirstFramePayload> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 生成图像。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "shot_first_frame", shotId },
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

    // 拉 shot 关联的角色 / 道具（用于往 prompt 灌 visual lock）
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

    // 编排 prompt（确定性拼接，无 LLM）
    const { prompt, refZh } = this.compileShotFirstFramePrompt({
      project,
      episode,
      scene,
      shot,
      characters,
      location,
      props,
    });

    // 出图
    let image: { base64: string; mimeType: string };
    let modelId: string;
    let raw: Record<string, unknown>;
    try {
      const res = await callArkImage({
        prompt,
        size: DEFAULT_SIZE,
      });
      const first = res.images[0];
      if (!first) throw new AiUpstreamError("Ark 未返回任何图像", 200);
      image = { base64: first.base64, mimeType: first.mimeType ?? "image/png" };
      modelId = res.modelId;
      raw = normaliseRawResponse(res.raw);
    } catch (err) {
      const detail =
        err instanceof AiApiKeyError
          ? err.message
          : err instanceof AiUpstreamError
            ? `${err.status} ${err.message}`
            : (err as Error).message;
      // 出图失败也落 failed 记录，保留 prompt / 挂载点供 UI 重试。
      this.recordFailedImageAsset({
        projectId: project.id,
        episodeId: episode.id,
        sceneId: scene.id,
        shotId: shot.id,
        promptPositive: prompt,
        promptPositiveZh: refZh,
        errorMessage: detail,
        stage: "shot_first_frame.image",
      });
      throw providerUnavailable(`AI 图像生成失败：${detail}`, {
        stage: "shot_first_frame.image",
        shotId,
        upstream: detail,
      });
    }

    // 落库（同时打上 episode / scene / shot fk，方便任意粒度回查）
    const asset = this.repos.imageAssets.create({
      episodeId: episode.id,
      sceneId: scene.id,
      shotId: shot.id,
      provider: "volcengine-ark",
      modelId,
      promptPositive: prompt,
      promptPositiveZh: refZh,
      sizePreset: DEFAULT_SIZE,
      base64: image.base64,
      mimeType: image.mimeType,
      rawResponse: raw,
      status: "succeeded",
      attemptCount: 1,
    });

    this.logActivity({
      projectId: project.id,
      eventType: "image_asset.shot_first_frame.created",
      summary: `EP${episode.episodeNo} · S${scene.sceneNo} · Shot#${shot.shotNo} 生成首帧图`,
      targetRef: { entityType: "shot", entityId: shot.id },
      payload: {
        extra: {
          modelId,
          sizePreset: DEFAULT_SIZE,
          imageAssetId: asset.id,
          episodeId: episode.id,
          sceneId: scene.id,
          shotId: shot.id,
        },
      },
    });

    return {
      asset,
      dataUrl: `data:${asset.mimeType};base64,${asset.base64}`,
    };
  }

  /**
   * Shot 首帧 prompt 拼接（确定性，无 LLM）。
   *
   * 结构：
   *   <风格锚> . <shot type / intent 描述> .
   *   Scene <sceneNo>: <scene.summary or dramaticGoal> .
   *   Characters in frame: <name1 visualLock1; name2 visualLock2> .
   *   Location: <location.name> — <location.visualLock> (timeOfDay) .
   *   Props: <prop1 visualLock1; ...> .
   *   Shot action: <shot.intent / performanceNotes> .
   *   vertical 9:16 composition, first frame keyframe... .
   */
  private compileShotFirstFramePrompt(opts: {
    project: Project;
    episode: Episode;
    scene: Scene;
    shot: Shot;
    characters: Character[];
    location: Location | null;
    props: Prop[];
  }): { prompt: string; refZh: string } {
    const { project, episode, scene, shot, characters, location, props } = opts;
    const styleAnchor =
      project.visualStyle?.resolvedPrompt || buildStyleAnchor(project);

    const shotDesc = [
      shot.shotType ? `Shot type: ${shot.shotType}` : "",
      shot.intent ? `Shot intent: ${shot.intent}` : "",
      shot.performanceNotes ? `Performance: ${shot.performanceNotes}` : "",
    ]
      .filter(Boolean)
      .join(". ");

    const sceneDesc = [
      `Scene ${scene.sceneNo}${scene.title ? " · " + scene.title : ""}`,
      scene.summary || scene.dramaticGoal || "",
    ]
      .filter(Boolean)
      .join(": ");

    const charLine =
      characters.length > 0
        ? "Characters in frame: " +
          characters
            .map((c) =>
              c.visualLock
                ? `${c.name} (${c.visualLock})`
                : c.name,
            )
            .join("; ")
        : "";

    const locLine = location
      ? `Location: ${location.name}${location.visualLock ? " — " + location.visualLock : ""}${scene.timeOfDay ? ` (${scene.timeOfDay})` : ""}`
      : scene.timeOfDay
        ? `Time of day: ${scene.timeOfDay}`
        : "";

    const propLine =
      props.length > 0
        ? "Props: " +
          props
            .map((p) =>
              p.visualLock ? `${p.name} (${p.visualLock})` : p.name,
            )
            .join("; ")
        : "";

    // 背景/构图锚：解决实测中「chinese_ink_child 水墨童趣 preset 容易生成
    // 大片白色宣纸底」的问题。这里显式要求「饱满、场景化」背景，避免留白
    // 底或纯白色 studio 底，并给出画幅内的画面丰富度提示。
    const backgroundAnchor =
      "immersive full-frame scene background, do NOT leave large empty white paper / studio white background; " +
      "instead render the described location as an environmental setting that fills the whole 9:16 frame, " +
      "with atmospheric depth, foreground/mid-ground/background layers, natural props and set dressing consistent with the story";

    const promptParts = [
      styleAnchor,
      "first frame keyframe of a shot, cinematic still, high detail",
      sceneDesc,
      shotDesc,
      charLine,
      locLine,
      propLine,
      backgroundAnchor,
      "vertical 9:16 composition, natural lighting, no watermark, no text overlay, no logo, no blank rice-paper background",
    ].filter((p) => p && p.trim().length > 0);

    const prompt = promptParts.join(". ");
    const refZh = [
      `EP${episode.episodeNo}${episode.title ? " · " + episode.title : ""}`,
      `场次 ${scene.sceneNo}${scene.title ? " · " + scene.title : ""}`,
      `Shot#${shot.shotNo}${shot.shotType ? " · " + shot.shotType : ""}`,
      shot.intent ? `意图：${shot.intent}` : "",
      characters.length > 0
        ? "角色：" + characters.map((c) => c.name).join("、")
        : "",
      location ? `场景：${location.name}` : "",
      props.length > 0 ? "道具：" + props.map((p) => p.name).join("、") : "",
      `风格：${styleAnchor}`,
    ]
      .filter(Boolean)
      .join("\n");

    return { prompt, refZh };
  }

  /** 私有：三类资产参考图的统一实现。 */
  private async generateAssetReference(
    kind: "character" | "location" | "prop",
    assetId: Id,
  ): Promise<FirstFramePayload> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 生成图像。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: `${kind}_reference`, assetId },
      );
    }

    // 取资产 + 校验存在
    let character: Character | null = null;
    let location: Location | null = null;
    let prop: Prop | null = null;
    let projectId: Id;
    let episodeId: Id | undefined;
    let assetName: string;
    let visualLock: string;

    if (kind === "character") {
      character = this.repos.characters.getById(assetId);
      if (!character) throw missingResource(`角色不存在：${assetId}`, { id: assetId });
      if (character.status !== "active") {
        throw missingResource(`角色已停用：${assetId}`, { id: assetId, status: character.status });
      }
      projectId = character.projectId;
      episodeId = character.episodeId;
      assetName = character.name;
      visualLock = character.visualLock ?? "";
    } else if (kind === "location") {
      location = this.repos.locations.getById(assetId);
      if (!location) throw missingResource(`场景不存在：${assetId}`, { id: assetId });
      if (location.status !== "active") {
        throw missingResource(`场景已停用：${assetId}`, { id: assetId, status: location.status });
      }
      projectId = location.projectId;
      episodeId = location.episodeId;
      assetName = location.name;
      visualLock = location.visualLock ?? "";
    } else {
      prop = this.repos.props.getById(assetId);
      if (!prop) throw missingResource(`道具不存在：${assetId}`, { id: assetId });
      if (prop.status !== "active") {
        throw missingResource(`道具已停用：${assetId}`, { id: assetId, status: prop.status });
      }
      projectId = prop.projectId;
      episodeId = prop.episodeId;
      assetName = prop.name;
      visualLock = prop.visualLock ?? "";
    }

    const project = this.repos.projects.getById(projectId);
    if (!project) {
      throw missingResource(`项目不存在：${projectId}`, { projectId });
    }

    // 编排 prompt（确定性拼接，无 LLM）
    const { prompt, refZh } = this.compileAssetReferencePrompt(kind, {
      project,
      assetName,
      visualLock,
      extra: this.assetExtraHint(kind, character, location, prop),
    });

    // 出图
    let image: { base64: string; mimeType: string };
    let modelId: string;
    let raw: Record<string, unknown>;
    try {
      const res = await callArkImage({
        prompt,
        size: DEFAULT_SIZE,
      });
      const first = res.images[0];
      if (!first) throw new AiUpstreamError("Ark 未返回任何图像", 200);
      image = { base64: first.base64, mimeType: first.mimeType ?? "image/png" };
      modelId = res.modelId;
      raw = normaliseRawResponse(res.raw);
    } catch (err) {
      const detail =
        err instanceof AiApiKeyError
          ? err.message
          : err instanceof AiUpstreamError
            ? `${err.status} ${err.message}`
            : (err as Error).message;
      // 出图失败也落 failed 记录，方便 UI 展示失败态 + 一键重试。
      this.recordFailedImageAsset({
        projectId: project.id,
        episodeId,
        characterId: kind === "character" ? assetId : undefined,
        locationId: kind === "location" ? assetId : undefined,
        propId: kind === "prop" ? assetId : undefined,
        promptPositive: prompt,
        promptPositiveZh: refZh,
        errorMessage: detail,
        stage: `${kind}_reference.image`,
      });
      throw providerUnavailable(`AI 图像生成失败：${detail}`, {
        stage: `${kind}_reference.image`,
        assetId,
        upstream: detail,
      });
    }

    // 落库（同时打上资产 fk 和 episode fk，方便双向查询）
    const asset = this.repos.imageAssets.create({
      episodeId,
      characterId: kind === "character" ? assetId : undefined,
      locationId: kind === "location" ? assetId : undefined,
      propId: kind === "prop" ? assetId : undefined,
      provider: "volcengine-ark",
      modelId,
      promptPositive: prompt,
      promptPositiveZh: refZh,
      sizePreset: DEFAULT_SIZE,
      base64: image.base64,
      mimeType: image.mimeType,
      rawResponse: raw,
      status: "succeeded",
      attemptCount: 1,
    });

    this.logActivity({
      projectId: project.id,
      eventType: `image_asset.${kind}_reference.created`,
      summary: `生成${kind === "character" ? "角色" : kind === "location" ? "场景" : "道具"}参考图：${assetName}`,
      targetRef: {
        entityType: "asset",
        entityId: assetId,
        label: `${kind}:${assetName}`,
      },
      payload: {
        extra: {
          kind,
          modelId,
          sizePreset: DEFAULT_SIZE,
          imageAssetId: asset.id,
        },
      },
    });

    return {
      asset,
      dataUrl: `data:${asset.mimeType};base64,${asset.base64}`,
    };
  }

  // ===== internal =====

  private async compileFirstFramePrompt(
    project: Project,
    episode: Episode,
  ): Promise<{ prompt: string; refZh: string }> {
    const meta = CONTENT_TYPE_REGISTRY[project.contentType];
    const styleAnchor = buildStyleAnchor(project);
    const refZh = [
      `内容形态：${meta?.zh ?? project.contentType} — ${meta?.desc ?? ""}`,
      `EP${episode.episodeNo}${episode.title ? " · " + episode.title : ""}`,
      episode.summary ? `摘要：${episode.summary}` : "",
      episode.episodeGoal ? `目标：${episode.episodeGoal}` : "",
      episode.episodeConflict ? `冲突：${episode.episodeConflict}` : "",
      episode.episodeTurn ? `转折：${episode.episodeTurn}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const systemPrompt = [
      "You are an art director translating a Chinese short-form story episode into ONE English image prompt for Seedream 5.0.",
      "Output MUST be a JSON object exactly: { \"prompt\": string }. No markdown, no commentary.",
      "The prompt must be:",
      "  - 60 to 140 English words",
      "  - comma-separated tags plus one descriptive sentence",
      "  - focused on the KEY VISUAL of this episode's opening moment",
      `  - carry this visual style anchor verbatim at the START: "${styleAnchor}"`,
      "  - end with: portrait 9:16 composition, cinematic lighting, high detail, no watermark, no text overlay",
      "Do not include Chinese, do not include camera setting jargon like ISO/aperture unless directly relevant.",
    ].join("\n");

    const userPrompt = [
      `Project: ${project.name}`,
      `Content form: ${meta?.zh ?? project.contentType} (${project.projectType})`,
      `Genre: ${project.genre ?? "(unspecified)"}`,
      `Audience: ${project.audience ?? "(unspecified)"}`,
      "",
      "Episode fields:",
      `- No.: EP${episode.episodeNo}`,
      episode.title ? `- Title: ${episode.title}` : "",
      episode.summary ? `- Summary: ${episode.summary}` : "",
      episode.episodeGoal ? `- Goal: ${episode.episodeGoal}` : "",
      episode.episodeConflict ? `- Conflict: ${episode.episodeConflict}` : "",
      episode.episodeTurn ? `- Turn: ${episode.episodeTurn}` : "",
      episode.episodeEndingHook ? `- Ending hook: ${episode.episodeEndingHook}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await callArkChat({
      systemPrompt,
      prompt: userPrompt,
      responseFormat: "json",
      temperature: 0.5,
      maxTokens: 512,
    });
    let parsed: { prompt?: unknown };
    try {
      parsed = JSON.parse(res.content) as { prompt?: unknown };
    } catch (err) {
      throw new AiUpstreamError(
        `image prompt 返回非 JSON：${(err as Error).message}`,
        200,
      );
    }
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    if (prompt.length === 0) {
      throw new AiUpstreamError("image prompt 返回为空", 200);
    }
    return { prompt, refZh };
  }

  /**
   * 资产参考图 prompt 编排（确定性拼接，无 LLM）。
   *
   * 结构：<英文风格锚> + <资产类型固定构图指令> + Subject: <name>. Visual: <visualLock>.
   * <extraHint>. 结尾统一加 9:16 竖屏 / 干净背景 / 无水印字。
   *
   * 中英混合：visualLock 一般是中文精描，直接保留；构图 / 品控词用英文，
   * Seedream 4.x/5.x 对混合语言 prompt 支持成熟。
   */
  private compileAssetReferencePrompt(
    kind: "character" | "location" | "prop",
    opts: {
      project: Project;
      assetName: string;
      visualLock: string;
      extra: string;
    },
  ): { prompt: string; refZh: string } {
    const { project, assetName, visualLock, extra } = opts;
    const styleAnchor =
      project.visualStyle?.resolvedPrompt || buildStyleAnchor(project);

    // 每类资产用不同的 shot type，确保出图形态一致
    const shotType =
      kind === "character"
        ? "character reference sheet, full-body portrait, neutral T-pose feel but relaxed, clean isolated background"
        : kind === "location"
          ? "location concept art, wide establishing shot, no characters, atmospheric perspective"
          : "prop concept art, isolated on clean neutral background, three-quarter view, subtle shadow";

    const kindLabelEn =
      kind === "character" ? "Character" : kind === "location" ? "Location" : "Prop";
    const kindLabelZh =
      kind === "character" ? "角色" : kind === "location" ? "场景" : "道具";

    const promptParts = [
      styleAnchor,
      shotType,
      `${kindLabelEn}: ${assetName}`,
      visualLock ? `Visual lock: ${visualLock}` : "",
      extra,
      "vertical 9:16 composition, high detail, natural lighting",
      "no watermark, no text overlay, no logo",
    ].filter((p) => p && p.trim().length > 0);

    const prompt = promptParts.join(". ");
    const refZh = [
      `${kindLabelZh}参考图：${assetName}`,
      visualLock ? `视觉锁：${visualLock}` : "",
      extra ? `补充：${extra}` : "",
      `风格：${styleAnchor}`,
    ]
      .filter(Boolean)
      .join("\n");
    return { prompt, refZh };
  }

  /** 从资产实体中抽出适合注入 prompt 的可选字段（角色年龄 / 场景类型 / 道具类型等）。 */
  private assetExtraHint(
    kind: "character" | "location" | "prop",
    character: Character | null,
    location: Location | null,
    prop: Prop | null,
  ): string {
    if (kind === "character" && character) {
      const bits = [
        character.ageRange ? `Age range: ${character.ageRange}` : "",
        character.roleType ? `Role: ${character.roleType}` : "",
      ].filter(Boolean);
      return bits.join(", ");
    }
    if (kind === "location" && location) {
      const bits = [
        location.locationType ? `Type: ${location.locationType}` : "",
      ].filter(Boolean);
      return bits.join(", ");
    }
    if (kind === "prop" && prop) {
      const bits = [prop.propType ? `Type: ${prop.propType}` : ""].filter(Boolean);
      return bits.join(", ");
    }
    return "";
  }

  /**
   * 落一条 status='failed' 的 image_assets 记录 + 一条 activity_log。
   *
   * 用途：三个 generate 路径的 catch 分支统一走这里，UI 就能像看成功图一样
   * 看到失败卡片 + 错误消息 + 「🔁 重试」按钮，不再有"图片消失、只弹个 toast"
   * 的黑箱感（Round-3 反馈）。
   */
  private recordFailedImageAsset(input: {
    projectId: Id;
    episodeId?: Id;
    sceneId?: Id;
    shotId?: Id;
    characterId?: Id;
    locationId?: Id;
    propId?: Id;
    promptPositive: string;
    promptPositiveZh?: string;
    errorMessage: string;
    stage: string;
    retryOfId?: Id;
    attemptCount?: number;
  }): void {
    try {
      const failed = this.repos.imageAssets.create({
        episodeId: input.episodeId,
        sceneId: input.sceneId,
        shotId: input.shotId,
        characterId: input.characterId,
        locationId: input.locationId,
        propId: input.propId,
        provider: "volcengine-ark",
        // 编排阶段失败时 modelId 未知，用一个占位；不影响 UI 展示。
        modelId: "unknown",
        promptPositive: input.promptPositive,
        promptPositiveZh: input.promptPositiveZh,
        sizePreset: DEFAULT_SIZE,
        // 失败无图；base64 存空串以满足 NOT NULL；前端按 status='failed' 走占位。
        base64: "",
        mimeType: "image/png",
        rawResponse: { stage: input.stage },
        status: "failed",
        errorMessage: input.errorMessage,
        attemptCount: input.attemptCount ?? 1,
        retryOfId: input.retryOfId,
      });
      this.logActivity({
        projectId: input.projectId,
        eventType: "image_asset.generation.failed",
        summary: `图片生成失败（${input.stage}）：${input.errorMessage}`,
        targetRef: { entityType: "image_asset", entityId: failed.id },
        payload: {
          extra: {
            stage: input.stage,
            attemptCount: input.attemptCount ?? 1,
            retryOfId: input.retryOfId,
          },
        },
      });
    } catch (dbErr) {
      // 兜底：即便落 failed 记录本身报错，也不要吞掉原始错误（原始错误由外层 throw）
      // 只在 logger 打一条尾巴。
      // eslint-disable-next-line no-console
      console.error("[ImageAssetService] recordFailedImageAsset persist error:", dbErr);
    }
  }

  /** 反查 image_asset 属于哪个 project。用于活动日志 / 重试路径。 */
  private resolveProjectIdOfImageAsset(asset: ImageAsset): Id {
    if (asset.episodeId) {
      const ep = this.repos.episodes.getById(asset.episodeId);
      if (ep) return ep.projectId;
    }
    if (asset.characterId) {
      const ch = this.repos.characters.getById(asset.characterId);
      if (ch) return ch.projectId;
    }
    if (asset.locationId) {
      const loc = this.repos.locations.getById(asset.locationId);
      if (loc) return loc.projectId;
    }
    if (asset.propId) {
      const p = this.repos.props.getById(asset.propId);
      if (p) return p.projectId;
    }
    if (asset.shotId) {
      const shot = this.repos.shots.getById(asset.shotId);
      if (shot) {
        const scene = this.repos.scenes.getById(shot.sceneId);
        if (scene) {
          const ep = this.repos.episodes.getById(scene.episodeId);
          if (ep) return ep.projectId;
        }
      }
    }
    throw missingResource("无法定位 image_asset 所属项目", { imageAssetId: asset.id });
  }
}

// ===== helpers =====

/** 按内容形态给一条默认的英文 style anchor（P0 兜底；P1 后由 visual_lock 表覆盖）。 */
function buildStyleAnchor(project: Project): string {
  switch (project.contentType) {
    case "educational_story":
      return "ink-wash Chinese story-book illustration style, warm palette";
    case "picture_book":
      return "gentle picture-book illustration, soft pastel palette, hand-drawn feel";
    case "documentary":
      return "photorealistic documentary still, natural lighting, filmic grain";
    case "comic":
      return "manhua comic panel illustration, bold linework, dynamic composition";
    case "animation":
      return "modern 2D animation still, clean cel shading, vivid palette";
    case "motion_comic":
      return "motion-comic key frame, dramatic backlighting, cinematic panel composition";
    default:
      return "cinematic short-drama still, moody color grade, shallow depth of field";
  }
}

/** raw 里可能含 base64 副本，落库前剥掉，避免行超大。 */
function normaliseRawResponse(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  try {
    const clone = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    const data = (clone as { data?: Array<Record<string, unknown>> }).data;
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item.b64_json === "string") item.b64_json = "<omitted>";
      }
    }
    return clone;
  } catch {
    return {};
  }
}
