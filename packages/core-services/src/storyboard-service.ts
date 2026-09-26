/**
 * StoryboardService — Scene / Shot / Keyframe / block / link orchestration
 * (data-and-api-v1.md §10 step 4c, storyboard-studio §12).
 *
 * Key behaviours:
 * - Optimistic-lock pass-through on all versioned updates (adr-003).
 * - Scene confirm is gated by the storyboard hard-check (keyframe gate, adr-006 §4);
 *   failing it raises `blocked_by_issue`.
 * - Confirming/unconfirming a scene recomputes the episode's persisted
 *   storyboardStatus rollup inside the same transaction (§6.2).
 */

import {
  createSceneSchema,
  updateSceneSchema,
  createShotSchema,
  updateShotSchema,
  createKeyframeSchema,
  updateKeyframeSchema,
  createDialogueBlockSchema,
  createActionBlockSchema,
  computeEpisodeStoryboardRollup,
  computeKeyframeGate,
  missingResource,
  blockedByIssue,
  providerUnavailable,
  CONTENT_TYPE_REGISTRY,
  type Scene,
  type Shot,
  type KeyframeSpec,
  type SceneDialogueBlock,
  type SceneActionBlock,
  type SceneCharacter,
  type ShotCharacter,
  type ShotProp,
  type Episode,
  type StoryboardValidateResult,
  type Id,
} from "@dramaflow/domain";
import { BaseService } from "./context.js";
import { parseInput } from "./validate.js";
import {
  isProviderReady,
  AiUpstreamError,
  runPack,
  sceneOutlinePack,
} from "./ai/index.js";

/** Draft shape yielded by scene-outline LLM (post-normalization). */
interface SceneOutlineDraft {
  title: string;
  summary: string;
  dramaticGoal: string;
  conflict: string;
  timeOfDay: string;
}

/** Asset context ({@link collectAssetContext} return) shared by scene-outline prompt. */
interface SceneOutlineAssetContext {
  characters: Array<{ name: string; roleType?: string; visualLock?: string }>;
  locations: Array<{ name: string; locationType?: string; visualLock?: string }>;
  props: Array<{ name: string; visualLock?: string }>;
}

export class StoryboardService extends BaseService {
  // ===== Scene =====
  createScene(raw: unknown): Scene {
    const input = parseInput(createSceneSchema, raw);
    return this.repos.transaction(() => {
      const episode = this.repos.episodes.getById(input.episodeId);
      if (!episode) {
        throw missingResource(`剧集不存在：${input.episodeId}`, {
          episodeId: input.episodeId,
        });
      }
      if (input.locationId && !this.repos.locations.getById(input.locationId)) {
        throw missingResource(`场景地点不存在：${input.locationId}`, {
          locationId: input.locationId,
        });
      }
      const scene = this.repos.scenes.create({
        episodeId: input.episodeId,
        sceneNo: input.sceneNo,
        title: input.title,
        locationId: input.locationId,
        timeOfDay: input.timeOfDay,
        summary: input.summary,
        dramaticGoal: input.dramaticGoal,
        conflict: input.conflict,
        sceneTags: input.sceneTags,
        entryState: input.entryState,
        exitState: input.exitState,
        storyboardStatus: "draft",
        sortOrder: input.sortOrder,
      });
      this.recomputeEpisodeStoryboardRollup(episode.id);
      this.logActivity({
        projectId: episode.projectId,
        eventType: "storyboard.scene.created",
        summary: `新增分镜场 #${scene.sceneNo}`,
        targetRef: { entityType: "scene", entityId: scene.id },
      });
      return scene;
    });
  }

  updateScene(id: Id, raw: unknown): Scene {
    const { version, ...rest } = parseInput(updateSceneSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.scenes.getById(id);
      if (!existing) throw missingResource(`分镜场不存在：${id}`, { id });
      return this.repos.scenes.update(id, rest, version);
    });
  }

  listScenes(episodeId: Id): Scene[] {
    return this.repos.scenes.listByEpisode(episodeId);
  }

  /**
   * Generate a scene skeleton for an episode via Ark chat.
   *
   * A1: 硬依赖 provider —— 没配 `ARK_API_KEY` / runtime key 就直接抛
   * `provider_unavailable`；LLM 上游失败也向外抛，不再走 stub。
   */
  async generateScenes(episodeId: Id, count?: number): Promise<Scene[]> {
    // A1: 若前端未指定 count，则优先用 episode.sceneCountEstimate（AI 自动估算）；
    //     仍拿不到则按内容形态兜底（educational_story 4；其他 6）。参考项目共识：
    //     场次数量应由 AI 根据 episode_duration 和内容形态倒推，用户不用手填。
    const episodeRow = this.repos.episodes.getById(episodeId);
    if (!episodeRow)
      throw missingResource(`剧集不存在：${episodeId}`, { episodeId });
    const projectRow = this.repos.projects.getById(episodeRow.projectId);
    const inferredCount =
      count ??
      episodeRow.sceneCountEstimate ??
      (projectRow?.contentType === "educational_story" ? 4 : 6);
    const finalCount = Math.min(Math.max(inferredCount, 1), 20);

    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 拆解分场骨架。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "scene_outline", episodeId, count: finalCount },
      );
    }

    // 1) 预读
    const episode = episodeRow;
    const project = projectRow;
    const existing = this.repos.scenes.listByEpisode(episodeId);
    const baseNo = existing.reduce((max, s) => Math.max(max, s.sceneNo), 0);

    // 2) 调 LLM，失败直接向外抛
    let drafts: SceneOutlineDraft[];
    try {
      drafts = await this.buildScenesFromLlm(
        episode,
        project?.contentType,
        finalCount,
        this.collectAssetContext(episode.projectId, episodeId),
      );
    } catch (err) {
      const detail =
        err instanceof AiUpstreamError
          ? `${err.status} ${err.message}`
          : (err as Error).message;
      throw providerUnavailable(`AI 拆解分场失败：${detail}`, {
        stage: "scene_outline",
        episodeId,
        count: finalCount,
        upstream: detail,
      });
    }
    if (!Array.isArray(drafts) || drafts.length !== finalCount) {
      throw providerUnavailable(
        `AI 返回的分场数量不符（期望 ${finalCount}，得到 ${Array.isArray(drafts) ? drafts.length : "?"}），请重试`,
        {
          stage: "scene_outline",
          episodeId,
          count: finalCount,
          got: (drafts as SceneOutlineDraft[] | undefined)?.length,
        },
      );
    }

    // 3) 事务写入
    return this.repos.transaction(() => {
      const created: Scene[] = [];
      for (let i = 0; i < finalCount; i += 1) {
        const sceneNo = baseNo + i + 1;
        const d = drafts[i]!;
        const scene = this.repos.scenes.create({
          episodeId,
          sceneNo,
          title: d.title,
          locationId: undefined,
          timeOfDay: d.timeOfDay,
          summary: d.summary,
          dramaticGoal: d.dramaticGoal,
          conflict: d.conflict,
          sceneTags: [],
          entryState: {},
          exitState: {},
          storyboardStatus: "draft",
          sortOrder: sceneNo * 10,
        });
        created.push(scene);
      }
      this.recomputeEpisodeStoryboardRollup(episodeId);
      this.logActivity({
        projectId: episode.projectId,
        eventType: "storyboard.scenes.generated",
        summary: `EP${episode.episodeNo} 生成 ${created.length} 个场景（llm）`,
        targetRef: { entityType: "episode", entityId: episodeId },
        payload: { count: created.length, extra: { source: "llm" } },
      });
      return created;
    });
  }

  /**
   * Round-3 P1-④：只重生某一场，保留其他场次不变。
   *
   * 使用场景：胖哥对某个场次不满意（title/summary/goal/conflict 不合适），
   * 单独让 LLM 重新出一个版本，无需推倒整集重来。
   *
   * 语义：
   *   1) 校验 provider ready + scene / episode / project 存在；
   *   2) 收集前后场简要 + episode / 资产上下文，拼一段"单场重写指令"注入到 episodeSummary 里；
   *   3) 复用 sceneOutlinePack，count=1 拿一条 outline draft；
   *   4) 覆盖回目标 scene（title / summary / dramaticGoal / conflict / timeOfDay），
   *      同时把 storyboardStatus 打回 draft（此前若已 confirmed，需要用户复审）；
   *   5) 触发下游 stale 联动（P2-⑤ 上线后自动生效）。
   *
   * 注意：调用方必须传 expectedVersion（乐观锁），避免并发覆盖用户的手改。
   */
  async regenerateScene(sceneId: Id, expectedVersion: number): Promise<Scene> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 重生场次。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "scene_regenerate", sceneId },
      );
    }
    const existing = this.repos.scenes.getById(sceneId);
    if (!existing)
      throw missingResource(`分镜场不存在：${sceneId}`, { id: sceneId });

    const episode = this.repos.episodes.getById(existing.episodeId);
    if (!episode)
      throw missingResource(`剧集不存在：${existing.episodeId}`, {
        episodeId: existing.episodeId,
      });
    const project = this.repos.projects.getById(episode.projectId);

    // 前后场简要 + 资产上下文
    const allSiblings = this.repos.scenes.listByEpisode(existing.episodeId);
    const siblings = allSiblings.filter((s) => s.id !== sceneId);
    const assets = this.collectAssetContext(episode.projectId, existing.episodeId);

    // 调 LLM 拿单场 draft
    let draft: SceneOutlineDraft;
    try {
      draft = await this.buildSingleSceneRegenerateFromLlm(
        existing,
        siblings,
        episode,
        project?.contentType,
        assets,
      );
    } catch (err) {
      const detail =
        err instanceof AiUpstreamError
          ? `${err.status} ${err.message}`
          : (err as Error).message;
      throw providerUnavailable(`AI 单场重生失败：${detail}`, {
        stage: "scene_regenerate.llm",
        sceneId,
        upstream: detail,
      });
    }

    return this.repos.transaction(() => {
      // 直接走 repo.update（绕开 external updateSceneSchema，允许一并重置 storyboardStatus）。
      const updated = this.repos.scenes.update(
        sceneId,
        {
          title: draft.title || existing.title,
          summary: draft.summary,
          dramaticGoal: draft.dramaticGoal,
          conflict: draft.conflict,
          timeOfDay: draft.timeOfDay,
          storyboardStatus: "draft",
        },
        expectedVersion,
      );

      // Round-3 P2-⑤：把本场名下的所有 succeeded 图片打上 stale 标签。
      // 前端会以 "⚠️ 已过期" 标识展示，胖哥可以按需重生。
      // 这里内联实现（不引 ImageAssetService 依赖）以保持 storyboard-service 的边界。
      let stalePhotos = 0;
      for (const img of this.repos.imageAssets.listByScene(sceneId)) {
        if (img.status === "succeeded") {
          this.repos.imageAssets.update(img.id, {
            status: "stale",
            staleReason: "scene_regenerated",
          });
          stalePhotos += 1;
        }
      }

      this.recomputeEpisodeStoryboardRollup(existing.episodeId);
      this.logActivity({
        projectId: episode.projectId,
        eventType: "storyboard.scene.regenerated",
        summary: `重新生成场次 EP${episode.episodeNo} · S${existing.sceneNo}`,
        targetRef: { entityType: "scene", entityId: sceneId },
        payload: {
          fromStatus: existing.storyboardStatus,
          toStatus: "draft",
          extra: {
            previousTitle: existing.title ?? null,
            previousSummary: existing.summary ?? null,
            stalePhotos,
          },
        },
      });
      return updated;
    });
  }

  /**
   * 收集资产上下文，用于 Scene Outline prompt。
   *
   * A1: 仅返回 `status === "active"` 的资产；
   * A2: 传入 episodeId 时，同时纳入「项目级共用（episodeId 为空）」+「该集专属」两档，
   *     其他集专属资产（episodeId != 该集）会被排除，避免污染本集的场次上下文。
   *     这是 series 分集绑定的核心过滤器 —— drama 场景下所有资产都是项目级，也满足该条件。
   */
  private collectAssetContext(
    projectId: Id,
    episodeId?: Id,
  ): SceneOutlineAssetContext {
    const inScope = (x: { status: string; episodeId?: Id | null }): boolean =>
      x.status === "active" && (!x.episodeId || x.episodeId === episodeId);
    const characters = this.repos.characters
      .listByProject(projectId)
      .filter(inScope)
      .map((c) => ({
        name: c.name,
        roleType: c.roleType,
        visualLock: c.visualLock,
      }));
    const locations = this.repos.locations
      .listByProject(projectId)
      .filter(inScope)
      .map((l) => ({
        name: l.name,
        locationType: l.locationType,
        visualLock: l.visualLock,
      }));
    const props = this.repos.props
      .listByProject(projectId)
      .filter(inScope)
      .map((p) => ({
        name: p.name,
        visualLock: p.visualLock,
      }));
    return { characters, locations, props };
  }

  /**
   * 拆解 Scene 骨架 —— 走综合方案 §4.D 的 scene-outline prompt pack。
   */
  private async buildScenesFromLlm(
    episode: Episode,
    contentType: string | undefined,
    count: number,
    assets?: SceneOutlineAssetContext,
  ): Promise<SceneOutlineDraft[]> {
    const contentKey =
      (contentType as keyof typeof CONTENT_TYPE_REGISTRY | undefined) ??
      "short_drama";
    // 若传入的 contentType 不在 registry 里（历史脏数据），兜底 short_drama
    const safeContentKey = CONTENT_TYPE_REGISTRY[contentKey]
      ? contentKey
      : ("short_drama" as const);

    const list = await runPack(sceneOutlinePack, {
      contentType: safeContentKey,
      count,
      episodeNo: episode.episodeNo,
      episodeTitle: episode.title ?? undefined,
      episodeSummary: episode.summary ?? undefined,
      episodeGoal: episode.episodeGoal ?? undefined,
      episodeConflict: episode.episodeConflict ?? undefined,
      episodeTurn: episode.episodeTurn ?? undefined,
      episodeEndingHook: episode.episodeEndingHook ?? undefined,
      assets,
    });

    if (list.length !== count) {
      throw new AiUpstreamError(
        `LLM 返回 scene 数量不符（期望 ${count}，得到 ${list.length}）`,
        200,
      );
    }

    return list.map((it, idx) => ({
      title: it.title || `场 ${idx + 1}`,
      summary: it.summary,
      dramaticGoal: it.dramaticGoal,
      conflict: it.conflict,
      timeOfDay: it.timeOfDay,
    }));
  }

  /**
   * P1-④ 辅助：为"重生单场"构造 LLM 上下文并调 scene-outline pack 拿 1 条。
   *
   * 由于 sceneOutlinePack 是"整集拆解"prompt，这里把上下文塞进 episodeSummary：
   *   - 目标场当前信息 + 需要重写的意图；
   *   - 前后场（sceneNo 排序）的简要摘要，帮 LLM 保持衔接不跑偏；
   *   - 明确要求"仅重写目标场，不要重复相邻场的核心事件"。
   */
  private async buildSingleSceneRegenerateFromLlm(
    target: Scene,
    siblings: Scene[],
    episode: Episode,
    contentType: string | undefined,
    assets: SceneOutlineAssetContext,
  ): Promise<SceneOutlineDraft> {
    const orderedSiblings = [...siblings].sort((a, b) => a.sceneNo - b.sceneNo);
    const siblingLines = orderedSiblings
      .map((s) => {
        const t = s.title ? `《${s.title}》` : "";
        const sm = s.summary ? ` — ${s.summary}` : "";
        return `- S${s.sceneNo}${t}${sm}`;
      })
      .join("\n");

    const targetLines = [
      `【需要重写的目标场】S${target.sceneNo}`,
      target.title ? `- 原标题：${target.title}` : null,
      target.summary ? `- 原摘要：${target.summary}` : null,
      target.dramaticGoal ? `- 原戏剧目标：${target.dramaticGoal}` : null,
      target.conflict ? `- 原冲突：${target.conflict}` : null,
      target.timeOfDay ? `- 原时段：${target.timeOfDay}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const instruction = [
      "【单场重生指令】",
      "上一版胖哥不满意目标场，请只重写目标场，不改变本集的整体走向。",
      "重写要求：",
      "1) 与前后场情节自然衔接，不重复相邻场已发生的核心事件；",
      "2) 提出新的戏剧目标 / 冲突 / 关键动作，避免与原摘要重复；",
      "3) 保持角色/地点/道具与已有资产一致；",
      "4) 输出格式与整集 scene outline 保持一致：**必须**返回长度为 1 的 JSON 数组（例如 `[{\"title\": ..., \"summary\": ..., ...}]`）。不要返回裸对象、不要外层再包 `{\"scenes\": [...]}` 之类的 wrapper 键。",
      "",
      targetLines,
      "",
      "【本集其他场（保持不变，仅供衔接参考）】",
      siblingLines || "（本集只有这一场）",
    ].join("\n");

    const augmentedSummary = [episode.summary ?? "", instruction]
      .filter(Boolean)
      .join("\n\n");

    const synthesized: Episode = {
      ...episode,
      summary: augmentedSummary,
    };

    const list = await this.buildScenesFromLlm(synthesized, contentType, 1, assets);
    // buildScenesFromLlm 已保证 length === count(1)
    const draft = list[0];
    if (!draft) {
      throw new AiUpstreamError("LLM 未返回任何 scene，请重试", 200);
    }
    return draft;
  }

  /**
   * Confirm a scene's storyboard; gated by the hard-check, then recompute rollup.
   *
   * 分两级语义（Round-3 UX 修正）：
   *   - **场次骨架阶段**：本场尚无任何 shot（尚未进入 storyboard studio），
   *     视为"骨架确认"（title / summary / dramaticGoal / conflict / timeOfDay
   *     已敲定），直接放行。此时若强行执行分镜硬校验，会导致 shots.length === 0
   *     → passable=false → blockedShots=[] 的诡异错误，UX 灾难。
   *   - **分镜阶段**：本场已有 shot，才做原硬校验（keyframe 齐全 + shotType /
   *     intent 齐全），保持 adr-006 §4 的产出闸门。
   */
  confirmScene(sceneId: Id, expectedVersion: number): Scene {
    return this.repos.transaction(() => {
      const scene = this.repos.scenes.getById(sceneId);
      if (!scene) throw missingResource(`分镜场不存在：${sceneId}`, { id: sceneId });
      // 有 shot 时才走分镜硬校验；纯骨架阶段直接放行。
      const shotsInScene = this.repos.shots.listByScene(sceneId);
      if (shotsInScene.length > 0) {
        const validation = this.buildValidateResult(sceneId);
        if (!validation.passable) {
          throw blockedByIssue("分镜未通过硬校验，无法确认", {
            sceneId,
            blockedShots: validation.shots
              .filter((s) => !s.keyframeGate.producible || s.fieldGaps.length > 0)
              .map((s) => s.shotId),
          });
        }
      }
      const updated = this.repos.scenes.update(
        sceneId,
        { storyboardStatus: "confirmed" },
        expectedVersion,
      );
      this.recomputeEpisodeStoryboardRollup(scene.episodeId);
      const episode = this.repos.episodes.getById(scene.episodeId);
      if (episode) {
        this.logActivity({
          projectId: episode.projectId,
          eventType: "storyboard.scene.confirmed",
          summary: `确认分镜场 #${scene.sceneNo}`,
          targetRef: { entityType: "scene", entityId: scene.id },
          payload: {
            fromStatus: scene.storyboardStatus,
            toStatus: "confirmed",
          },
        });
      }
      return updated;
    });
  }

  /** Revert a scene's storyboard to draft, then recompute rollup. */
  unconfirmScene(sceneId: Id, expectedVersion: number): Scene {
    return this.repos.transaction(() => {
      const scene = this.repos.scenes.getById(sceneId);
      if (!scene) throw missingResource(`分镜场不存在：${sceneId}`, { id: sceneId });
      const updated = this.repos.scenes.update(
        sceneId,
        { storyboardStatus: "draft" },
        expectedVersion,
      );
      this.recomputeEpisodeStoryboardRollup(scene.episodeId);
      return updated;
    });
  }

  /** Storyboard hard-check for a scene (storyboard-studio §12.2). */
  validateStoryboard(sceneId: Id): StoryboardValidateResult {
    if (!this.repos.scenes.getById(sceneId)) {
      throw missingResource(`分镜场不存在：${sceneId}`, { id: sceneId });
    }
    return this.buildValidateResult(sceneId);
  }

  /**
   * Recompute and persist the episode-level storyboard rollup (§6.2).
   * No-op write when the rollup is unchanged.
   *
   * Round-3 P1-①（补丁）：这是"业务噪音"级 update —— 用户根本不知道也不关心
   * rollup 何时被回写，也没有回滚意义。用 `runWithoutSnapshot` 包一层，避免
   * 稀释 Episode 卡历史抽屉里"真正 AI/人工改动"的版本。
   */
  recomputeEpisodeStoryboardRollup(episodeId: Id): Episode {
    const episode = this.repos.episodes.getById(episodeId);
    if (!episode)
      throw missingResource(`剧集不存在：${episodeId}`, { id: episodeId });
    const scenes = this.repos.scenes.listByEpisode(episodeId);
    const rollup = computeEpisodeStoryboardRollup(
      scenes.map((s) => s.storyboardStatus),
    );
    if (rollup === episode.storyboardStatus) return episode;
    return this.repos.runWithoutSnapshot(() =>
      this.repos.episodes.update(
        episodeId,
        { storyboardStatus: rollup },
        episode.version,
      ),
    );
  }

  // ===== Shot =====
  createShot(raw: unknown): Shot {
    const input = parseInput(createShotSchema, raw);
    return this.repos.transaction(() => {
      if (!this.repos.scenes.getById(input.sceneId)) {
        throw missingResource(`分镜场不存在：${input.sceneId}`, {
          sceneId: input.sceneId,
        });
      }
      return this.repos.shots.create({
        sceneId: input.sceneId,
        shotNo: input.shotNo,
        shotType: input.shotType,
        intent: input.intent,
        cameraPlan: input.cameraPlan,
        performanceNotes: input.performanceNotes,
        startState: input.startState,
        endState: input.endState,
        handoffAnchor: input.handoffAnchor,
        isKeyShot: input.isKeyShot,
        durationSec: input.durationSec,
        sortOrder: input.sortOrder,
      });
    });
  }

  updateShot(id: Id, raw: unknown): Shot {
    const { version, ...rest } = parseInput(updateShotSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.shots.getById(id);
      if (!existing) throw missingResource(`镜头不存在：${id}`, { id });
      return this.repos.shots.update(id, rest, version);
    });
  }

  listShots(sceneId: Id): Shot[] {
    return this.repos.shots.listByScene(sceneId);
  }

  // ===== Keyframe =====
  createKeyframe(raw: unknown): KeyframeSpec {
    const input = parseInput(createKeyframeSchema, raw);
    return this.repos.transaction(() => {
      if (!this.repos.shots.getById(input.shotId)) {
        throw missingResource(`镜头不存在：${input.shotId}`, {
          shotId: input.shotId,
        });
      }
      return this.repos.keyframeSpecs.create({
        shotId: input.shotId,
        frameType: input.frameType,
        composition: input.composition,
        subjectLayout: input.subjectLayout,
        expressionPose: input.expressionPose,
        backgroundRequirement: input.backgroundRequirement,
        continuityAnchor: input.continuityAnchor,
        promptSummary: input.promptSummary,
        status: "draft",
      });
    });
  }

  updateKeyframe(id: Id, raw: unknown): KeyframeSpec {
    const { version, ...rest } = parseInput(updateKeyframeSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.keyframeSpecs.getById(id);
      if (!existing) throw missingResource(`关键帧不存在：${id}`, { id });
      return this.repos.keyframeSpecs.update(id, rest, version);
    });
  }

  /** Confirm a keyframe (draft -> confirmed); part of the producibility gate. */
  confirmKeyframe(id: Id, expectedVersion: number): KeyframeSpec {
    return this.repos.transaction(() => {
      const existing = this.repos.keyframeSpecs.getById(id);
      if (!existing) throw missingResource(`关键帧不存在：${id}`, { id });
      return this.repos.keyframeSpecs.update(
        id,
        { status: "confirmed" },
        expectedVersion,
      );
    });
  }

  listKeyframes(shotId: Id): KeyframeSpec[] {
    return this.repos.keyframeSpecs.listByShot(shotId);
  }

  // ===== Script blocks (timestamped, no version) =====
  createDialogueBlock(raw: unknown): SceneDialogueBlock {
    const input = parseInput(createDialogueBlockSchema, raw);
    return this.repos.transaction(() => {
      if (!this.repos.scenes.getById(input.sceneId)) {
        throw missingResource(`分镜场不存在：${input.sceneId}`, {
          sceneId: input.sceneId,
        });
      }
      return this.repos.sceneDialogueBlocks.create({
        sceneId: input.sceneId,
        speakerCharacterId: input.speakerCharacterId,
        text: input.text,
        emotion: input.emotion,
        deliveryNote: input.deliveryNote,
        sortOrder: input.sortOrder,
      });
    });
  }

  createActionBlock(raw: unknown): SceneActionBlock {
    const input = parseInput(createActionBlockSchema, raw);
    return this.repos.transaction(() => {
      if (!this.repos.scenes.getById(input.sceneId)) {
        throw missingResource(`分镜场不存在：${input.sceneId}`, {
          sceneId: input.sceneId,
        });
      }
      return this.repos.sceneActionBlocks.create({
        sceneId: input.sceneId,
        actionText: input.actionText,
        actorRefs: input.actorRefs,
        propRefs: input.propRefs,
        sortOrder: input.sortOrder,
      });
    });
  }

  // ===== Link tables (composite PK; upsert / remove) =====
  addSceneCharacter(link: {
    sceneId: Id;
    characterId: Id;
    lookId?: Id;
    presenceType?: string;
  }): SceneCharacter {
    return this.repos.transaction(() => {
      if (!this.repos.scenes.getById(link.sceneId)) {
        throw missingResource(`分镜场不存在：${link.sceneId}`, {
          sceneId: link.sceneId,
        });
      }
      if (!this.repos.characters.getById(link.characterId)) {
        throw missingResource(`角色不存在：${link.characterId}`, {
          characterId: link.characterId,
        });
      }
      return this.repos.sceneCharacters.upsert({
        sceneId: link.sceneId,
        characterId: link.characterId,
        lookId: link.lookId,
        presenceType: link.presenceType ?? "present",
      });
    });
  }

  removeSceneCharacter(sceneId: Id, characterId: Id): void {
    this.repos.sceneCharacters.remove(sceneId, characterId);
  }

  addShotCharacter(link: {
    shotId: Id;
    characterId: Id;
    lookId?: Id;
    blockingNote?: string;
  }): ShotCharacter {
    return this.repos.transaction(() => {
      if (!this.repos.shots.getById(link.shotId)) {
        throw missingResource(`镜头不存在：${link.shotId}`, {
          shotId: link.shotId,
        });
      }
      if (!this.repos.characters.getById(link.characterId)) {
        throw missingResource(`角色不存在：${link.characterId}`, {
          characterId: link.characterId,
        });
      }
      return this.repos.shotCharacters.upsert({
        shotId: link.shotId,
        characterId: link.characterId,
        lookId: link.lookId,
        blockingNote: link.blockingNote,
      });
    });
  }

  removeShotCharacter(shotId: Id, characterId: Id): void {
    this.repos.shotCharacters.remove(shotId, characterId);
  }

  addShotProp(link: { shotId: Id; propId: Id; stateNote?: string }): ShotProp {
    return this.repos.transaction(() => {
      if (!this.repos.shots.getById(link.shotId)) {
        throw missingResource(`镜头不存在：${link.shotId}`, {
          shotId: link.shotId,
        });
      }
      if (!this.repos.props.getById(link.propId)) {
        throw missingResource(`道具不存在：${link.propId}`, { propId: link.propId });
      }
      return this.repos.shotProps.upsert({
        shotId: link.shotId,
        propId: link.propId,
        stateNote: link.stateNote,
      });
    });
  }

  removeShotProp(shotId: Id, propId: Id): void {
    this.repos.shotProps.remove(shotId, propId);
  }

  // ===== internal =====
  private buildValidateResult(sceneId: Id): StoryboardValidateResult {
    const shots = this.repos.shots.listByScene(sceneId);
    const shotResults = shots.map((shot) => {
      const gate = computeKeyframeGate(this.repos.keyframeSpecs.listByShot(shot.id));
      const fieldGaps: Array<{ field: string; message: string }> = [];
      if (!shot.shotType)
        fieldGaps.push({ field: "shotType", message: "镜头缺少景别/机位类型" });
      if (!shot.intent)
        fieldGaps.push({ field: "intent", message: "镜头缺少叙事意图" });
      return {
        shotId: shot.id,
        keyframeGate: gate,
        fieldGaps,
        continuityStatus: "ok" as const,
      };
    });
    const passable =
      shots.length > 0 &&
      shotResults.every(
        (s) => s.keyframeGate.producible && s.fieldGaps.length === 0,
      );
    return { passable, shots: shotResults };
  }
}
