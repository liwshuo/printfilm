/**
 * StoryService — Project / Episode / StoryBible orchestration (data-and-api-v1.md §10 step 4a).
 *
 * Responsibilities:
 * - Create/update projects & episodes with optimistic-lock pass-through (adr-003).
 * - Seed and patch the project story bible.
 * - Confirm episode story with a completeness gate.
 * - Derive project-level story rollup + completeness report (adr-006 §3, story-workspace §9).
 *
 * All multi-write operations run inside `registry.transaction` for atomicity.
 */

import type {
  Project,
  Episode,
  ProjectStoryBible,
  EntityPatch,
  ProjectStoryStatus,
  StoryCompletenessResult,
  Id,
} from "@dramaflow/domain";
import {
  createProjectSchema,
  updateProjectSchema,
  createEpisodeSchema,
  updateEpisodeSchema,
  updateStoryBibleSchema,
  computeProjectStoryStatus,
  missingResource,
  validationFailed,
  invalidState,
  providerUnavailable,
  resolveVisualStyle,
  VISUAL_STYLE_PRESETS,
  getStorySettingPreset,
  CONTENT_TYPE_REGISTRY,
} from "@dramaflow/domain";
import { BaseService } from "./context.js";
import { parseInput } from "./validate.js";
import {
  isProviderReady,
  AiUpstreamError,
  runStoryBiblePack,
  runEpisodeAssetSeedsPack,
  episodeOutlinePack,
  runPack,
} from "./ai/index.js";
import type {
  CharacterSeed,
  LocationSeed,
  PropSeed,
} from "./ai/prompts/story-bible/schema.js";

interface StoryGap {
  field: string;
  level: "warning" | "error";
  message: string;
}

/** Story completeness gaps for one episode (story-workspace §9 semantics). */
function computeEpisodeStoryGaps(ep: Episode): StoryGap[] {
  const gaps: StoryGap[] = [];
  const blank = (v?: string): boolean => v === undefined || v.trim() === "";
  if (blank(ep.summary)) {
    gaps.push({ field: "summary", level: "error", message: "剧集缺少剧情梗概" });
  }
  if (blank(ep.episodeGoal)) {
    gaps.push({ field: "episodeGoal", level: "warning", message: "建议补充剧集目标" });
  }
  if (blank(ep.episodeConflict)) {
    gaps.push({ field: "episodeConflict", level: "warning", message: "建议补充核心冲突" });
  }
  if (blank(ep.episodeEndingHook)) {
    gaps.push({ field: "episodeEndingHook", level: "warning", message: "建议补充结尾钩子" });
  }
  return gaps;
}

export class StoryService extends BaseService {
  // ===== Project =====

  createProject(raw: unknown): Project {
    const input = parseInput(createProjectSchema, raw);
    return this.repos.transaction(() => {
      if (this.repos.projects.getBySlug(input.slug)) {
        throw validationFailed(`项目 ID 已被占用：${input.slug}`, {
          field: "slug",
          slug: input.slug,
        });
      }
      const project = this.repos.projects.create({
        name: input.name,
        slug: input.slug,
        status: input.status,
        projectType: input.projectType,
        contentType: input.contentType,
        // A1: Zod 已校验 presetKey∈preset 集合，此处只做 default fallback + resolve。
        visualStyle: resolveVisualStyle(input.contentType, input.visualStyle),
        complianceMode: input.complianceMode,
        genre: input.genre,
        audience: input.audience,
        aspectRatio: input.aspectRatio,
        targetDurationSec: input.targetDurationSec,
        episodeCount: 0,
        language: input.language,
        outputSpec: input.outputSpec,
        modelPolicy: input.modelPolicy,
        creativeConstraints: input.creativeConstraints,
      });
      // A1: 项目级 empty story bible（episodeId 为空）。
      // - drama：作为唯一的项目级共享圣经，后续 generate/patch 都落在这一行。
      // - series：作为共享底座（可存放跨集不变的世界观），每集另建 episode-scoped 圣经。
      this.repos.storyBibles.create({
        projectId: project.id,
        worldRules: {},
        hookSystem: {},
        pacingPlan: {},
        villainSystem: {},
        characterRelations: {},
        sourceRef: { origin: "manual" },
      });
      this.logActivity({
        projectId: project.id,
        eventType: "project.created",
        summary: `创建项目「${project.name}」(${project.projectType === "drama" ? "连续剧" : "选集剧"})`,
        targetRef: { entityType: "project", entityId: project.id, label: project.name },
      });
      return project;
    });
  }

  updateProject(id: Id, raw: unknown): Project {
    const { version, ...rest } = parseInput(updateProjectSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.projects.getById(id);
      if (!existing) throw missingResource(`项目不存在：${id}`, { id });

      // A1: 如果本次 patch 涉及 contentType 或 visualStyle，需要重新 resolve。
      // 语义：contentType 未变时保留原 visualStyle；contentType 变了且未显式 visualStyle
      // 输入时，用旧 customPrompt + 新 contentType default preset 重新拼接。
      const patch: Record<string, unknown> = { ...rest };
      const nextContentType = rest.contentType ?? existing.contentType;
      const visualStyleInputProvided = Object.prototype.hasOwnProperty.call(
        rest,
        "visualStyle",
      );
      const contentTypeChanged =
        rest.contentType !== undefined && rest.contentType !== existing.contentType;
      if (visualStyleInputProvided || contentTypeChanged) {
        const rawStyleInput = visualStyleInputProvided
          ? rest.visualStyle
          : {
              // contentType 变了但用户没给 visualStyle：保留原 customPrompt，丢弃 presetKey
              customPrompt: existing.visualStyle?.customPrompt,
            };
        // 校验 presetKey ∈ 新 contentType 预设集
        const presetKey = rawStyleInput?.presetKey;
        if (presetKey && contentTypeChanged) {
          // updateProjectSchema 的 superRefine 只在有 contentType+visualStyle 一起校验时兜住，
          // 这里对 contentTypeChanged 场景再兜一次；正常路径已在 Zod 层拒绝。
          const presets = VISUAL_STYLE_PRESETS[nextContentType] ?? [];
          if (!presets.some((p) => p.key === presetKey)) {
            throw validationFailed(
              `visual style preset "${presetKey}" not available for content type "${nextContentType}"`,
              { field: "visualStyle.presetKey" },
            );
          }
        }
        patch.visualStyle = resolveVisualStyle(nextContentType, rawStyleInput);
      }

      const updated = this.repos.projects.update(
        id,
        patch as unknown as EntityPatch<Project>,
        version,
      );
      this.logActivity({
        projectId: updated.id,
        eventType: "project.updated",
        summary: `更新项目「${updated.name}」`,
        targetRef: { entityType: "project", entityId: updated.id, label: updated.name },
      });
      return updated;
    });
  }

  getProject(id: Id): Project | null {
    return this.repos.projects.getById(id);
  }

  listProjects(): Project[] {
    return this.repos.projects.list();
  }

  /**
   * 删除项目。由 SQLite `ON DELETE CASCADE` 级联删除所有关联资源：
   * episodes / scenes / shots / project_story_bibles / continuity_locks
   * / assets(characters/locations/props) / prompts / exports / activities 等。
   *
   * 幂等：不存在时安静返回 false；成功删除时返回 true。
   */
  deleteProject(id: Id): boolean {
    return this.repos.transaction(() => {
      const existing = this.repos.projects.getById(id);
      if (!existing) return false;
      this.repos.projects.delete(id);
      return true;
    });
  }

  // ===== Episode =====

  createEpisode(raw: unknown): Episode {
    const input = parseInput(createEpisodeSchema, raw);
    return this.repos.transaction(() => {
      const project = this.repos.projects.getById(input.projectId);
      if (!project) {
        throw missingResource(`项目不存在：${input.projectId}`, { projectId: input.projectId });
      }
      if (this.repos.episodes.getByProjectAndNo(input.projectId, input.episodeNo)) {
        throw validationFailed(`剧集序号已存在：EP${input.episodeNo}`, {
          field: "episodeNo",
          episodeNo: input.episodeNo,
        });
      }
      const episode = this.repos.episodes.create({
        projectId: input.projectId,
        episodeNo: input.episodeNo,
        title: input.title,
        summary: input.summary,
        hookType: input.hookType,
        episodeGoal: input.episodeGoal,
        episodeConflict: input.episodeConflict,
        episodeTurn: input.episodeTurn,
        episodeEndingHook: input.episodeEndingHook,
        storyStatus: "draft",
        scriptStatus: "draft",
        storyboardStatus: "draft",
        productionStatus: "idle",
        reviewStatus: "pending",
        handoffState: {},
      });
      this.logActivity({
        projectId: episode.projectId,
        eventType: "episode.created",
        summary: `新增剧集 EP${episode.episodeNo}`,
        targetRef: { entityType: "episode", entityId: episode.id },
      });
      return episode;
    });
  }

  /**
   * 删除单集。幂等：不存在时返回 false。级联依赖 SQLite `ON DELETE CASCADE`
   * 删除 scenes / shots / dialogue+action blocks / keyframe_specs / prompts
   * / continuity_locks / image_assets 等下游资源；已确认（storyStatus=confirmed）
   * 也允许删除，业务上由前端做二次确认。
   */
  deleteEpisode(id: Id): boolean {
    return this.repos.transaction(() => {
      const existing = this.repos.episodes.getById(id);
      if (!existing) return false;
      this.repos.episodes.delete(id);
      this.logActivity({
        projectId: existing.projectId,
        eventType: "episode.deleted",
        summary: `删除剧集 EP${existing.episodeNo}${existing.title ? " · " + existing.title : ""}`,
        targetRef: { entityType: "episode", entityId: existing.id },
        payload: {
          fromStatus: existing.storyStatus,
          extra: {
            episodeNo: existing.episodeNo,
            title: existing.title ?? null,
          },
        },
      });
      return true;
    });
  }

  updateEpisode(id: Id, raw: unknown): Episode {
    const { version, ...rest } = parseInput(updateEpisodeSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.episodes.getById(id);
      if (!existing) throw missingResource(`剧集不存在：${id}`, { id });

      // A1: 允许对已确认的故事直接编辑；一旦故事字段发生变化，就在同一次
      // 保存中把 storyStatus 从 "confirmed" 悄悄降回 "draft"。避免用户被迫
      // 先跳去 Storyboard Studio 取消确认再改。story-workspace §9 保持不变：
      // scriptStatus / storyboardStatus 仍然由各自的下游阶段管理。
      const patch: Record<string, unknown> = { ...rest };
      if (existing.storyStatus === "confirmed") {
        const storyFieldTouched =
          (rest.title !== undefined && rest.title !== (existing.title ?? "")) ||
          (rest.summary !== undefined && rest.summary !== (existing.summary ?? "")) ||
          (rest.hookType !== undefined && rest.hookType !== (existing.hookType ?? "")) ||
          (rest.episodeGoal !== undefined &&
            rest.episodeGoal !== (existing.episodeGoal ?? "")) ||
          (rest.episodeConflict !== undefined &&
            rest.episodeConflict !== (existing.episodeConflict ?? "")) ||
          (rest.episodeTurn !== undefined &&
            rest.episodeTurn !== (existing.episodeTurn ?? "")) ||
          (rest.episodeEndingHook !== undefined &&
            rest.episodeEndingHook !== (existing.episodeEndingHook ?? ""));
        if (storyFieldTouched) {
          patch.storyStatus = "draft";
        }
      }

      const updated = this.repos.episodes.update(
        id,
        patch as unknown as EntityPatch<Episode>,
        version,
      );
      if (
        existing.storyStatus === "confirmed" &&
        updated.storyStatus === "draft"
      ) {
        this.logActivity({
          projectId: updated.projectId,
          eventType: "episode.story.unconfirmed",
          summary: `EP${updated.episodeNo} 故事字段被修改，自动取消确认`,
          targetRef: { entityType: "episode", entityId: updated.id },
          payload: { fromStatus: "confirmed", toStatus: "draft" },
        });
      }
      return updated;
    });
  }

  listEpisodes(projectId: Id): Episode[] {
    return this.repos.episodes.listByProject(projectId);
  }

  /** Confirm episode story; gated on no error-level completeness gaps. */
  confirmEpisodeStory(episodeId: Id, expectedVersion: number): Episode {
    return this.repos.transaction(() => {
      const episode = this.repos.episodes.getById(episodeId);
      if (!episode) throw missingResource(`剧集不存在：${episodeId}`, { id: episodeId });
      const errors = computeEpisodeStoryGaps(episode).filter((g) => g.level === "error");
      if (errors.length > 0) {
        throw invalidState("剧集故事信息不完整，无法确认", { gaps: errors });
      }
      const updated = this.repos.episodes.update(
        episodeId,
        { storyStatus: "confirmed" },
        expectedVersion,
      );
      this.logActivity({
        projectId: episode.projectId,
        eventType: "episode.story.confirmed",
        summary: `确认剧集 EP${episode.episodeNo} 故事`,
        targetRef: { entityType: "episode", entityId: episode.id },
        payload: { fromStatus: episode.storyStatus, toStatus: "confirmed" },
      });
      return updated;
    });
  }

  /**
   * Regenerate a single episode's story outline via LLM.
   *
   * `regenerateEpisodeOutline` 复用 `episodeOutlinePack`（count=1）重新为当前
   * episode 生成 title / summary / episodeGoal / episodeConflict / episodeTurn /
   * episodeEndingHook / hookType / arcBeats / learningAnchor / sceneCountEstimate /
   * ageHint，覆盖当前字段并把 storyStatus 强制降为 draft。版本走乐观锁 +1。
   *
   * 支持 `opts.topicHint`：若用户想指定新主题（比如 "画蛇添足"），会作为 HARD
   * REQUIREMENT 注入 prompt，避免 LLM 随手换个成语。
   */
  async regenerateEpisodeOutline(
    episodeId: Id,
    opts?: { topicHint?: string },
  ): Promise<Episode> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 重新生成本篇故事。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "episode_outline.regenerate", episodeId },
      );
    }
    const episode = this.repos.episodes.getById(episodeId);
    if (!episode) throw missingResource(`剧集不存在：${episodeId}`, { id: episodeId });
    const project = this.repos.projects.getById(episode.projectId);
    if (!project)
      throw missingResource(`项目不存在：${episode.projectId}`, {
        projectId: episode.projectId,
      });
    const isDrama = project.projectType === "drama";
    const bible = this.repos.storyBibles.getByProjectId(project.id);
    // 已存在的其它分集标题（排除自己），避免 LLM 再生成同一个成语
    const existingTitles = this.repos.episodes
      .listByProject(project.id)
      .filter((e) => e.id !== episodeId)
      .map((e) => (e.title ?? "").trim())
      .filter((t) => t.length > 0);

    let drafts: Awaited<ReturnType<StoryService["buildEpisodeOutlineFromLlm"]>>;
    try {
      drafts = await this.buildEpisodeOutlineFromLlm(
        project,
        bible ?? undefined,
        episode.episodeNo,
        1,
        isDrama,
        {
          topicHint: opts?.topicHint,
          existingTitles,
        },
      );
    } catch (err) {
      const detail =
        err instanceof AiUpstreamError
          ? `${err.status} ${err.message}`
          : (err as Error).message;
      throw providerUnavailable(`AI 重新生成本篇故事失败：${detail}`, {
        stage: "episode_outline.regenerate",
        episodeId,
        upstream: detail,
      });
    }
    const draft = drafts[0];
    if (!draft) {
      throw providerUnavailable("AI 未返回任何本篇故事草稿，请重试", {
        stage: "episode_outline.regenerate",
        episodeId,
      });
    }

    return this.repos.transaction(() => {
      const latest = this.repos.episodes.getById(episodeId);
      if (!latest) throw missingResource(`剧集不存在：${episodeId}`, { id: episodeId });
      const updated = this.repos.episodes.update(
        episodeId,
        {
          title: draft.title,
          summary: draft.summary,
          episodeGoal: draft.episodeGoal,
          episodeConflict: draft.episodeConflict,
          episodeTurn: draft.episodeTurn,
          episodeEndingHook: draft.episodeEndingHook,
          hookType: draft.hookType ?? latest.hookType,
          arcBeats: draft.arcBeats,
          learningAnchor: draft.learningAnchor,
          sceneCountEstimate: draft.sceneCountEstimate,
          ageHint: draft.ageHint,
          storyStatus: "draft",
        } as unknown as EntityPatch<Episode>,
        latest.version,
      );
      this.logActivity({
        projectId: updated.projectId,
        eventType: "episode.story.regenerated",
        summary: `EP${updated.episodeNo} 本篇故事重新生成（LLM）`,
        targetRef: { entityType: "episode", entityId: updated.id },
        payload: {
          fromStatus: latest.storyStatus,
          toStatus: "draft",
          extra: {
            source: "llm",
            topicHint: opts?.topicHint?.trim() || undefined,
          },
        },
      });
      return updated;
    });
  }

  // ===== Story bible =====

  getStoryBible(projectId: Id): ProjectStoryBible | null {
    return this.repos.storyBibles.getByProjectId(projectId);
  }

  updateStoryBible(projectId: Id, raw: unknown): ProjectStoryBible {
    const { version, ...rest } = parseInput(updateStoryBibleSchema, raw);
    return this.repos.transaction(() => {
      const bible = this.repos.storyBibles.getByProjectId(projectId);
      if (!bible) throw missingResource(`项目故事圣经不存在：${projectId}`, { projectId });
      const patch = rest as unknown as EntityPatch<ProjectStoryBible>;
      return this.repos.storyBibles.update(bible.id, patch, version);
    });
  }

  /**
   * Generate the project story bible via Ark chat (story-workspace-spec §14).
   *
   * A1: 硬依赖 provider —— 没配 `ARK_API_KEY` / runtime key 就直接抛
   * `provider_unavailable`；LLM 上游失败也向外抛，不再走确定性 stub。
   * 前端拿到错误后展示"请先在 /models 配置 Ark API Key"提示。
   */
  async generateStoryBible(projectId: Id): Promise<ProjectStoryBible> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 生成。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "story_bible", projectId },
      );
    }

    // 1) 预读上下文
    const project = this.repos.projects.getById(projectId);
    if (!project) throw missingResource(`项目不存在：${projectId}`, { projectId });
    const bible = this.repos.storyBibles.getByProjectId(projectId);
    if (!bible) throw missingResource(`项目故事圣经不存在：${projectId}`, { projectId });

    // A1: 按 contentType 决定用「世界设定」还是「系列设定」预设。
    // - world  → drama + 短剧/动画/漫剧/漫画：保留完整戏剧字段
    // - series → 教育故事/绘本/纪录短片：精简为 tone/theme + worldRules.{setting,targetAudience}
    const settingPreset = getStorySettingPreset(project.contentType);
    const contentTypeMeta = CONTENT_TYPE_REGISTRY[project.contentType];

    // A1: 按 contentType 智能兜底 —— 避免把「都市情感」污染到成语/绘本/纪录片
    const defaultGenreByContentType: Record<string, string> = {
      short_drama: "都市情感",
      motion_comic: "都市悬疑",
      animation: "奇幻冒险",
      comic: "都市奇幻",
      picture_book: "亲子成长绘本",
      documentary: "人物纪实",
      educational_story: "成语故事",
    };
    const defaultAudienceByContentType: Record<string, string> = {
      short_drama: "泛年轻用户",
      motion_comic: "泛年轻用户",
      animation: "全年龄段家庭观众",
      comic: "青少年 / 泛年轻用户",
      picture_book: "3–8 岁亲子共读家庭",
      documentary: "关注真实故事的成年观众",
      educational_story: "6–12 岁儿童及家长共读",
    };
    const genre =
      project.genre?.trim() ||
      defaultGenreByContentType[project.contentType] ||
      "都市情感";
    const audience =
      project.audience?.trim() ||
      defaultAudienceByContentType[project.contentType] ||
      "泛年轻用户";
    const isDrama = project.projectType === "drama";
    const ctx = { genre, audience, isDrama, contentTypeMeta, settingPreset };

    // 2) 调用 LLM，失败直接向外抛 provider_unavailable
    let patch: EntityPatch<ProjectStoryBible>;
    let seeds: {
      characters: CharacterSeed[];
      locations: LocationSeed[];
      props: PropSeed[];
    };
    try {
      const built =
        settingPreset.key === "series"
          ? await this.buildSeriesSettingFromLlm(project, ctx)
          : await this.buildWorldSettingFromLlm(project, ctx);
      patch = built.patch;
      seeds = built.seeds;
    } catch (err) {
      const detail =
        err instanceof AiUpstreamError
          ? `${err.status} ${err.message}`
          : (err as Error).message;
      throw providerUnavailable(`AI 生成失败：${detail}`, {
        stage: "story_bible",
        projectId,
        upstream: detail,
      });
    }

    // 3) 事务写入：story bible + 资产 seeds（characters / locations / props）
    return this.repos.transaction(() => {
      const updated = this.repos.storyBibles.update(bible.id, patch, bible.version);
      const persisted = this.persistAssetSeeds(projectId, seeds);
      this.logActivity({
        projectId,
        eventType: "story.bible.generated",
        summary: `生成${settingPreset.label}（${contentTypeMeta.zh}，llm）；资产 seeds ${persisted.characters}角/${persisted.locations}景/${persisted.props}道`,
        targetRef: { entityType: "project", entityId: projectId, label: project.name },
        payload: {
          count: persisted.characters + persisted.locations + persisted.props,
          extra: {
            seeds: {
              characters: persisted.characters,
              locations: persisted.locations,
              props: persisted.props,
            },
          },
        },
      });
      return updated;
    });
  }

  /**
   * 为 series 单集生成「本集专属」的角色 / 场景 / 道具 seeds（Stage A'）。
   *
   * 场景：series 项目下每一集是独立故事（成语故事的画蛇添足 vs 守株待兔），
   * 项目级 Story Bible 只保留跨集共用资产，每集自己的资产在这里生成，
   * 落 `episodeId = 该集`，供 Scene Outline 拆场次和后续关键帧生成引用。
   *
   * 硬依赖 provider —— 没配 key 或上游失败直接抛 `provider_unavailable`。
   */
  async generateEpisodeAssetSeeds(episodeId: Id): Promise<{
    characters: number;
    locations: number;
    props: number;
  }> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 生成。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "episode_asset_seeds", episodeId },
      );
    }

    const episode = this.repos.episodes.getById(episodeId);
    if (!episode) {
      throw missingResource(`剧集不存在：${episodeId}`, { id: episodeId });
    }
    const project = this.repos.projects.getById(episode.projectId);
    if (!project) {
      throw missingResource(`项目不存在：${episode.projectId}`, {
        id: episode.projectId,
      });
    }

    // 项目级已有资产名单（作为"避免重名"提示传给 LLM）。
    const projectCharacters = this.repos.characters
      .listByProject(episode.projectId)
      .filter((c) => c.status === "active" && !c.episodeId);
    const projectLocations = this.repos.locations
      .listByProject(episode.projectId)
      .filter((l) => l.status === "active" && !l.episodeId);
    const projectProps = this.repos.props
      .listByProject(episode.projectId)
      .filter((p) => p.status === "active" && !p.episodeId);

    // Round-3 P2-③：其它集专属资产名单（作为"跨集复用"提示传给 LLM）。
    // 用 episodeId -> episodeNo 反向映射，把每条资产附上"来自哪集"。
    const episodesInProject = this.repos.episodes.listByProject(episode.projectId);
    const episodeNoById = new Map<string, number>();
    for (const e of episodesInProject) episodeNoById.set(e.id, e.episodeNo);
    const otherEpCharacters = this.repos.characters
      .listByProject(episode.projectId)
      .filter(
        (c) => c.status === "active" && !!c.episodeId && c.episodeId !== episodeId,
      )
      .map((c) => ({
        name: c.name,
        fromEpisode: episodeNoById.get(c.episodeId as string) ?? 0,
      }));
    const otherEpLocations = this.repos.locations
      .listByProject(episode.projectId)
      .filter(
        (l) => l.status === "active" && !!l.episodeId && l.episodeId !== episodeId,
      )
      .map((l) => ({
        name: l.name,
        fromEpisode: episodeNoById.get(l.episodeId as string) ?? 0,
      }));
    const otherEpProps = this.repos.props
      .listByProject(episode.projectId)
      .filter(
        (p) => p.status === "active" && !!p.episodeId && p.episodeId !== episodeId,
      )
      .map((p) => ({
        name: p.name,
        fromEpisode: episodeNoById.get(p.episodeId as string) ?? 0,
      }));

    let seeds: {
      characterSeeds: CharacterSeed[];
      locationSeeds: LocationSeed[];
      propSeeds: PropSeed[];
    };
    try {
      seeds = await runEpisodeAssetSeedsPack({
        contentType: project.contentType,
        projectName: project.name,
        episode: {
          episodeNo: episode.episodeNo,
          title: episode.title ?? `第 ${episode.episodeNo} 集`,
          summary: episode.summary,
          dramaticGoal: episode.episodeGoal,
          conflict: episode.episodeConflict,
          turnPoint: episode.episodeTurn,
          hookSetup: episode.episodeEndingHook,
        },
        existingProjectAssets: {
          characters: projectCharacters.map((c) => c.name),
          locations: projectLocations.map((l) => l.name),
          props: projectProps.map((p) => p.name),
        },
        otherEpisodeAssets: {
          characters: otherEpCharacters,
          locations: otherEpLocations,
          props: otherEpProps,
        },
      });
    } catch (err) {
      const detail =
        err instanceof AiUpstreamError
          ? `${err.status} ${err.message}`
          : (err as Error).message;
      throw providerUnavailable(`AI 本集资产 seeds 生成失败：${detail}`, {
        stage: "episode_asset_seeds",
        episodeId,
        upstream: detail,
      });
    }

    return this.repos.transaction(() => {
      const persisted = this.persistAssetSeeds(
        episode.projectId,
        {
          characters: seeds.characterSeeds,
          locations: seeds.locationSeeds,
          props: seeds.propSeeds,
        },
        episodeId,
      );
      this.logActivity({
        projectId: episode.projectId,
        eventType: "story.episode.asset_seeds.generated",
        summary: `EP${episode.episodeNo} 生成本集资产 seeds（llm）；${persisted.characters}角/${persisted.locations}景/${persisted.props}道`,
        targetRef: {
          entityType: "episode",
          entityId: episodeId,
          label: episode.title ?? `EP${episode.episodeNo}`,
        },
        payload: {
          count: persisted.characters + persisted.locations + persisted.props,
          extra: {
            source: "llm",
            scope: "episode",
            seeds: persisted,
          },
        },
      });
      return persisted;
    });
  }

  /**
   * 把 Story Bible LLM 输出的 seeds 落到 characters / locations / props 表。
   *
   * A1: 按 name 去重 —— 项目内已有同名资产则跳过（首次 story-bible 生成通常
   * 是空库，所以主要用于「重新生成」场景不重复膨胀）。
   */
  private persistAssetSeeds(
    projectId: Id,
    seeds: {
      characters: CharacterSeed[];
      locations: LocationSeed[];
      props: PropSeed[];
    },
    /**
     * 落点归属：
     *   - undefined ⇒ 项目级资产（drama 主流；series 只用于跨集共用）。
     *   - 传入 episodeId ⇒ 该集专属资产（series 单集 seeds）。
     * 去重时同时避开：项目级同名 + 本 scope 同名，避免重复创建/污染 Scene Outline 上下文。
     */
    episodeId?: Id,
  ): { characters: number; locations: number; props: number } {
    // 项目下所有 name（跨 scope，用于避免"项目级 A" 和 "该集 A" 同名冲突）。
    const projectChars = this.repos.characters.listByProject(projectId);
    const projectLocs = this.repos.locations.listByProject(projectId);
    const projectProps = this.repos.props.listByProject(projectId);
    const existingChars = new Set(projectChars.map((c) => c.name));
    const existingLocs = new Set(projectLocs.map((l) => l.name));
    const existingProps = new Set(projectProps.map((p) => p.name));

    let cCount = 0;
    for (const seed of seeds.characters) {
      const name = seed.name.trim();
      if (!name || existingChars.has(name)) continue;
      this.repos.characters.create({
        projectId,
        episodeId,
        name,
        roleType: seed.role?.trim() || undefined,
        ageRange: seed.ageHint?.trim() || undefined,
        personality: seed.personalityCore?.trim() || undefined,
        visualLock: seed.visualLock?.trim() || undefined,
        status: "active",
      });
      existingChars.add(name);
      cCount += 1;
    }

    let lCount = 0;
    for (const seed of seeds.locations) {
      const name = seed.name.trim();
      if (!name || existingLocs.has(name)) continue;
      const atmosphere = seed.atmosphere?.trim();
      this.repos.locations.create({
        projectId,
        episodeId,
        name,
        locationType: seed.spaceType?.trim() || undefined,
        visualSpec: atmosphere ? { atmosphere } : {},
        spaceRules: {},
        lightingRules: {},
        continuityRules: {},
        visualLock: seed.visualLock?.trim() || undefined,
        status: "active",
      });
      existingLocs.add(name);
      lCount += 1;
    }

    let pCount = 0;
    for (const seed of seeds.props) {
      const name = seed.name.trim();
      if (!name || existingProps.has(name)) continue;
      const purpose = seed.purpose?.trim();
      this.repos.props.create({
        projectId,
        episodeId,
        name,
        visualSpec: {},
        ownership: {},
        continuityRules: purpose ? { purpose } : {},
        visualLock: seed.visualLock?.trim() || undefined,
        status: "active",
      });
      existingProps.add(name);
      pCount += 1;
    }

    return { characters: cCount, locations: lCount, props: pCount };
  }

  // ===== world preset（世界设定）：完整戏剧字段 =====

  private async buildWorldSettingFromLlm(
    project: Project,
    ctx: {
      genre: string;
      audience: string;
      isDrama: boolean;
      contentTypeMeta: (typeof CONTENT_TYPE_REGISTRY)[keyof typeof CONTENT_TYPE_REGISTRY];
    },
  ): Promise<{
    patch: EntityPatch<ProjectStoryBible>;
    seeds: {
      characters: CharacterSeed[];
      locations: LocationSeed[];
      props: PropSeed[];
    };
  }> {
    const parsed = await runStoryBiblePack({
      presetKey: "world",
      contentType: project.contentType,
      projectName: project.name,
      genre: ctx.genre,
      audience: ctx.audience,
      complianceMode: project.complianceMode ?? "domestic",
      existingGenreHint: project.genre ?? undefined,
      isDrama: ctx.isDrama,
    });
    // 剥离 discriminator + seeds —— story bible 表只承载世界/系列设定字段，
    // seeds 单独回传给 generateStoryBible 落资产表。
    const {
      _kind: _drop,
      characterSeeds,
      locationSeeds,
      propSeeds,
      ...rest
    } = parsed;
    void _drop;
    return {
      patch: this.finalizeLlmPatch(rest as Record<string, unknown>),
      seeds: {
        characters: characterSeeds ?? [],
        locations: locationSeeds ?? [],
        props: propSeeds ?? [],
      },
    };
  }

  // ===== series preset（系列设定）：精简 4 字段 =====

  private async buildSeriesSettingFromLlm(
    project: Project,
    ctx: {
      genre: string;
      audience: string;
      contentTypeMeta: (typeof CONTENT_TYPE_REGISTRY)[keyof typeof CONTENT_TYPE_REGISTRY];
    },
  ): Promise<{
    patch: EntityPatch<ProjectStoryBible>;
    seeds: {
      characters: CharacterSeed[];
      locations: LocationSeed[];
      props: PropSeed[];
    };
  }> {
    const parsed = await runStoryBiblePack({
      presetKey: "series",
      contentType: project.contentType,
      projectName: project.name,
      genre: ctx.genre,
      audience: ctx.audience,
      complianceMode: project.complianceMode ?? "domestic",
      isDrama: false,
    });
    if (parsed._kind !== "series") {
      // 保险：TS 已经收口到 union，这里理论走不进来
      throw new AiUpstreamError(
        "[story_bible] series preset 意外拿到 world 数据",
        200,
      );
    }
    // 强制清理戏剧密度重字段，即便 LLM 越权吐出也丢弃
    return {
      patch: this.finalizeLlmPatch({
        logline: `「${project.name}」是一部${ctx.contentTypeMeta.zh}选集`,
        theme: parsed.theme,
        tone: parsed.tone,
        worldRules: parsed.worldRules ?? {},
        hookSystem: {},
        pacingPlan: {},
        villainSystem: {},
        characterRelations: {},
      }),
      seeds: {
        characters: parsed.characterSeeds ?? [],
        locations: parsed.locationSeeds ?? [],
        props: parsed.propSeeds ?? [],
      },
    };
  }

  // ===== 共享 helpers =====

  private finalizeLlmPatch(
    parsed: Record<string, unknown>,
  ): EntityPatch<ProjectStoryBible> {
    return {
      ...parsed,
      sourceRef: {
        origin: "generated" as const,
        generatedAt: new Date().toISOString(),
        provider: "volcengine-ark",
      },
    } as unknown as EntityPatch<ProjectStoryBible>;
  }

  /**
   * Generate a draft episode outline.
   *
   * STUB for the async `story_generate` outline task (story-workspace-spec §7.6
   * / §14). Appends `count` draft episodes after the current max episodeNo,
   * each pre-filled with a plausible summary / goal / conflict / ending hook so
   * the story completeness gate has real content to act on. Returns the full
   * episode list after generation.
   */
  /**
   * Generate the next `count` episodes' outline via Ark chat.
   *
   * A1: 硬依赖 provider —— 没配 `ARK_API_KEY` / runtime key 就直接抛
   * `provider_unavailable`；LLM 上游失败也向外抛，不再走确定性 stub。
   */
  async generateEpisodeOutline(
    projectId: Id,
    count = 3,
    opts?: { topicHint?: string },
  ): Promise<Episode[]> {
    if (!isProviderReady()) {
      throw providerUnavailable(
        "尚未配置 Ark API Key，无法调用 AI 生成分集大纲。请先在 /models 页面填入 ARK_API_KEY。",
        { stage: "episode_outline", projectId, count },
      );
    }

    // 1) 预读
    const project = this.repos.projects.getById(projectId);
    if (!project) throw missingResource(`项目不存在：${projectId}`, { projectId });
    const existing = this.repos.episodes.listByProject(projectId);
    const startNo = (existing.at(-1)?.episodeNo ?? 0) + 1;
    const isDrama = project.projectType === "drama";
    const bible = this.repos.storyBibles.getByProjectId(projectId);
    const existingTitles = existing
      .map((e) => (e.title ?? "").trim())
      .filter((t) => t.length > 0);

    // 2) 调 LLM，失败直接向外抛
    let drafts: Awaited<ReturnType<StoryService["buildEpisodeOutlineFromLlm"]>>;
    try {
      drafts = await this.buildEpisodeOutlineFromLlm(
        project,
        bible ?? undefined,
        startNo,
        count,
        isDrama,
        {
          topicHint: opts?.topicHint,
          existingTitles,
        },
      );
    } catch (err) {
      const detail =
        err instanceof AiUpstreamError
          ? `${err.status} ${err.message}`
          : (err as Error).message;
      throw providerUnavailable(`AI 生成分集大纲失败：${detail}`, {
        stage: "episode_outline",
        projectId,
        count,
        upstream: detail,
      });
    }
    if (!Array.isArray(drafts) || drafts.length !== count) {
      throw providerUnavailable(
        `AI 返回的分集数量不符（期望 ${count}，得到 ${Array.isArray(drafts) ? drafts.length : "?"}），请重试`,
        { stage: "episode_outline", projectId, count, got: drafts?.length },
      );
    }

    // 3) 事务写入
    return this.repos.transaction(() => {
      for (const d of drafts) {
        this.repos.episodes.create({
          projectId,
          episodeNo: d.episodeNo,
          title: d.title,
          summary: d.summary,
          hookType: d.hookType ?? "cliffhanger",
          episodeGoal: d.episodeGoal,
          episodeConflict: d.episodeConflict,
          episodeTurn: d.episodeTurn,
          episodeEndingHook: d.episodeEndingHook,
          arcBeats: d.arcBeats,
          learningAnchor: d.learningAnchor,
          sceneCountEstimate: d.sceneCountEstimate,
          ageHint: d.ageHint,
          storyStatus: "draft",
          scriptStatus: "draft",
          storyboardStatus: "draft",
          productionStatus: "idle",
          reviewStatus: "pending",
          handoffState: isDrama
            ? {
                openSetups: [
                  {
                    setup: `EP${d.episodeNo} 结尾悬念`,
                    expectedPayoff: `EP${d.episodeNo + 1} 开场兑现`,
                  },
                ],
                generatedAt: new Date().toISOString(),
              }
            : {},
        });
      }
      this.logActivity({
        projectId,
        eventType: "story.outline.generated",
        summary: `生成 ${count} 集分集草案（${isDrama ? "连续剧" : "选集剧"}，llm）`,
        targetRef: { entityType: "project", entityId: projectId, label: project.name },
        payload: {
          count,
          extra: {
            source: "llm",
            topicHint: opts?.topicHint?.trim() || undefined,
          },
        },
      });
      return this.repos.episodes.listByProject(projectId);
    });
  }

  private async buildEpisodeOutlineFromLlm(
    project: Project,
    bible: ProjectStoryBible | undefined,
    startNo: number,
    count: number,
    isDrama: boolean,
    opts?: {
      topicHint?: string;
      existingTitles?: string[];
    },
  ): Promise<
    Array<{
      episodeNo: number;
      title: string;
      summary: string;
      episodeGoal: string;
      episodeConflict: string;
      episodeTurn: string;
      episodeEndingHook: string;
      hookType?: string;
      arcBeats?: Array<{
        phase: "opening" | "rising" | "storm" | "climax";
        description: string;
        weight?: number;
      }>;
      learningAnchor?: string;
      sceneCountEstimate?: number;
      ageHint?: string;
    }>
  > {
    const list = await runPack(episodeOutlinePack, {
      contentType: project.contentType,
      isDrama,
      projectName: project.name,
      genre: project.genre ?? undefined,
      audience: project.audience ?? undefined,
      bibleLogline: bible?.logline,
      bibleTheme: bible?.theme,
      bibleTone: bible?.tone,
      bibleSetting:
        typeof bible?.worldRules === "object" && bible?.worldRules !== null
          ? String((bible.worldRules as Record<string, unknown>).setting ?? "") || undefined
          : undefined,
      startNo,
      count,
      topicHint: opts?.topicHint?.trim() || undefined,
      existingTitles: opts?.existingTitles,
    });

    if (list.length !== count) {
      throw new AiUpstreamError(
        `LLM 返回 episode 数量不符（期望 ${count}，得到 ${list.length}）`,
        200,
      );
    }

    const itemNoun =
      project.contentType === "educational_story"
        ? "篇"
        : project.contentType === "picture_book"
          ? "册"
          : project.contentType === "comic"
            ? "话"
            : "集";

    return list.map((it, idx) => ({
      episodeNo: startNo + idx,
      title: it.title || `第 ${startNo + idx} ${itemNoun}`,
      summary: it.summary,
      episodeGoal: it.episodeGoal,
      episodeConflict: it.episodeConflict,
      episodeTurn: it.episodeTurn,
      episodeEndingHook: it.episodeEndingHook,
      hookType: it.hookType || undefined,
      arcBeats:
        it.arcBeats && it.arcBeats.length > 0 ? it.arcBeats : undefined,
      learningAnchor: it.learningAnchor || undefined,
      sceneCountEstimate: it.sceneCountEstimate,
      ageHint: it.ageHint || undefined,
    }));
  }

  // ===== Derived status =====

  /** Project-level story rollup (adr-006 §3), derived from episode story statuses. */
  getProjectStoryStatus(projectId: Id): ProjectStoryStatus {
    const episodes = this.repos.episodes.listByProject(projectId);
    return computeProjectStoryStatus(episodes.map((e) => e.storyStatus));
  }

  /** Story completeness report (story-workspace §9). */
  checkStoryCompleteness(projectId: Id): StoryCompletenessResult {
    const project = this.repos.projects.getById(projectId);
    if (!project) throw missingResource(`项目不存在：${projectId}`, { projectId });
    const episodes = this.repos.episodes.listByProject(projectId);
    const episodeDetails = episodes.map((ep) => {
      const gaps = computeEpisodeStoryGaps(ep);
      return { episodeId: ep.id, ready: gaps.every((g) => g.level !== "error"), gaps };
    });
    const confirmedEpisodes = episodes.filter((e) => e.storyStatus === "confirmed").length;
    const blockingCount = episodeDetails.filter((d) => !d.ready).length;
    return {
      ready: episodes.length > 0 && blockingCount === 0,
      projectSummary: {
        totalEpisodes: episodes.length,
        confirmedEpisodes,
        blockingCount,
      },
      episodeDetails,
    };
  }
}
