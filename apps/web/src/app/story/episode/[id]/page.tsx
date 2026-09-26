"use client";

/**
 * Single-Episode Workspace  ——  Stage 4 of the WorkspaceShell.
 *
 * URL: /story/episode/[id]
 *
 * 一集内的完整工作流入口。目前主区域分两块：
 *   A) Episode Script：本集的目标 / 冲突 / 结尾钩子（可编辑 + 确认）
 *   B) Episode Scenes：本集的场次卡片流（未生成时展示 AI 生成入口；
 *      已生成时展示卡片，支持逐场确认；进阶编辑跳到旧 Storyboard Studio）
 *
 * 关键帧 / 视频 / 送审 后续阶段先以入口方式挂载，等对应能力落地再展开。
 *
 * P0 (workflow-refactor v1)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ApiError,
  projects,
  storyboards,
  imageAssets,
  videoAssets,
  assets,
  snapshots,
  type CharacterAsset,
  type EpisodeCompositionManifest,
  type CompositionItem,
  type Episode,
  type EpisodeAssetsBundle,
  type ImageAssetRecord,
  type VideoAssetRecord,
  type ShotVideoPreview,
  type LocationAsset,
  type Project,
  type PropAsset,
  type Scene,
  type Shot,
  type SnapshotDigest,
  type StoryBible,
} from "@/lib/api";
import { useAsyncJob } from "@/lib/use-async-job";
import { WorkspaceShell } from "@/lib/workspace-shell";
import {
  computeWorkspaceStages,
  computeEpisodeLights,
  getOutlineCopy,
} from "@/lib/workspace-stages";

type ScenePanelState = "empty" | "generating" | "preview" | "error";

/** Round-3 P1-①：历史抽屉的通用目标。支持场次和本篇故事两类实体。 */
type HistoryTarget =
  | { type: "scenes"; id: string; label: string; version: number }
  | { type: "episodes"; id: string; label: string; version: number };

interface EpisodeEditState {
  title: string;
  episodeGoal: string;
  episodeConflict: string;
  episodeEndingHook: string;
}

export default function EpisodeWorkspacePage() {
  const params = useParams<{ id: string }>();
  const episodeId = params?.id ?? "";

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [bible, setBible] = useState<StoryBible | null>(null);
  const [siblings, setSiblings] = useState<Episode[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Script editing
  const [edit, setEdit] = useState<EpisodeEditState>({
    title: "",
    episodeGoal: "",
    episodeConflict: "",
    episodeEndingHook: "",
  });
  const [scriptSaving, setScriptSaving] = useState(false);
  const [scriptConfirming, setScriptConfirming] = useState(false);

  // Scenes panel
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [scenesState, setScenesState] = useState<ScenePanelState>("empty");
  /** 场次数由 AI 根据 episode.sceneCountEstimate 自动估算；此处保留一个「手动覆盖」入口，默认 undefined */
  const [genCountOverride, setGenCountOverride] = useState<number | undefined>(undefined);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [confirmingSceneId, setConfirmingSceneId] = useState<string | null>(null);
  // Round-3 P1-④：正在被 AI 单独重生的 scene 集合。
  // 用 Set 保存多个 sceneId → 支持胖哥同时对多个场次点「重生本场」并行处理，
  // 每个场次自己的 loading 状态互不干扰。
  const [regeneratingSceneIds, setRegeneratingSceneIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // Round-3 P1-①：历史版本抽屉。target 为 null 表示关闭。
  // 通用化：支持 scenes（单场）与 episodes（本篇故事）两类实体的历史/回滚。
  const [historyTarget, setHistoryTarget] = useState<HistoryTarget | null>(null);
  const [historyItems, setHistoryItems] = useState<SnapshotDigest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [rollbackBusyId, setRollbackBusyId] = useState<string | null>(null);
  // Per-scene inline error (e.g. blocked_by_issue on confirm). Independent of
  // the global `error` state so a subsequent fetch/refresh doesn't clear it.
  const [sceneErrors, setSceneErrors] = useState<
    Record<string, { code: string; message: string; details?: unknown }>
  >({});

  // 本篇故事重新生成
  const [storyRegenerating, setStoryRegenerating] = useState(false);
  const [storyRegenErr, setStoryRegenErr] = useState<string | null>(null);

  // 说明：Episode 级「首帧参考图」模块已下线。首帧生成统一走 SceneShotFrames
  // （分镜首帧），Episode 视觉预览由本篇故事下方的分镜首帧组件承担。

  // A2: 本集专属资产（series 分集绑定）
  const [epChars, setEpChars] = useState<CharacterAsset[]>([]);
  const [epLocs, setEpLocs] = useState<LocationAsset[]>([]);
  const [epProps, setEpProps] = useState<PropAsset[]>([]);
  // 项目级共用资产（drama = 全量；series = 系列包装级 mascot 等）
  const [projChars, setProjChars] = useState<CharacterAsset[]>([]);
  const [projLocs, setProjLocs] = useState<LocationAsset[]>([]);
  const [projProps, setProjProps] = useState<PropAsset[]>([]);
  const [assetsGenerating, setAssetsGenerating] = useState(false);
  const [assetsErr, setAssetsErr] = useState<string | null>(null);

  const loadEpisode = useCallback(async () => {
    if (!episodeId) return;
    setError(null);
    try {
      const ep = await projects.getEpisode(episodeId);
      setEpisode(ep);
      setEdit({
        title: ep.title ?? "",
        episodeGoal: ep.episodeGoal ?? "",
        episodeConflict: ep.episodeConflict ?? "",
        episodeEndingHook: ep.episodeEndingHook ?? "",
      });
      // 拿到 episode 之后再并行加载 project / bible / siblings
      const [p, b, list] = await Promise.all([
        projects.get(ep.projectId),
        projects.storyBible(ep.projectId).catch(() => null),
        projects.episodes(ep.projectId),
      ]);
      setProject(p);
      setBible(b);
      setSiblings(list.items);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [episodeId]);

  const loadScenes = useCallback(async () => {
    if (!episodeId) return;
    try {
      const res = await storyboards.listScenes(episodeId);
      setScenes(res.items);
      setScenesState(res.items.length > 0 ? "preview" : "empty");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [episodeId]);

  // Episode 级首帧参考图已下线：不再拉取 `imageAssets.listByEpisode`。
  // 分镜首帧图由 SceneShotFrames 组件按 shot 各自加载。

  /**
   * 拉取本集专属（episode_id = 该集）的角色 / 场景 / 道具。
   *
   * A2: series 项目下每集独立故事（成语故事的画蛇添足 vs 守株待兔），
   * Story Bible 阶段不再一次性产出所有集的资产，改在这里按需生成、按集绑定。
   */
  const loadEpisodeAssets = useCallback(async () => {
    if (!episodeId) return;
    setAssetsErr(null);
    try {
      const bundle: EpisodeAssetsBundle = await assets.listEpisodeAssets(episodeId);
      setEpChars(bundle.characters);
      setEpLocs(bundle.locations);
      setEpProps(bundle.props);
      setProjChars(bundle.projectLevelCharacters ?? []);
      setProjLocs(bundle.projectLevelLocations ?? []);
      setProjProps(bundle.projectLevelProps ?? []);
    } catch (err) {
      setAssetsErr(
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
      );
    }
  }, [episodeId]);

  useEffect(() => {
    loadEpisode();
  }, [loadEpisode]);
  useEffect(() => {
    loadScenes();
  }, [loadScenes]);
  useEffect(() => {
    loadEpisodeAssets();
  }, [loadEpisodeAssets]);

  /**
   * 生成本集专属的角色 / 场景 / 道具 seeds。
   * series 场景下强烈建议在拆场次之前触发，让 Scene Outline 能拿到"本集资产"上下文。
   */
  async function onGenerateEpisodeAssetSeeds() {
    if (!episodeId) return;
    setAssetsGenerating(true);
    setAssetsErr(null);
    try {
      await assets.generateEpisodeAssetSeeds(episodeId);
      await loadEpisodeAssets();
    } catch (err) {
      setAssetsErr(
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
      );
    } finally {
      setAssetsGenerating(false);
    }
  }

  const stages = useMemo(
    () =>
      computeWorkspaceStages({
        project,
        bible,
        episodes: siblings,
        currentEpisodeId: episodeId,
        active: "scene_keyframe",
      }),
    [project, bible, siblings, episodeId],
  );

  const lights = useMemo(
    () => (episode ? computeEpisodeLights(episode) : []),
    [episode],
  );

  const { prev, next } = useMemo(() => {
    if (!episode) return { prev: null as Episode | null, next: null as Episode | null };
    const sorted = [...siblings].sort((a, b) => a.episodeNo - b.episodeNo);
    const idx = sorted.findIndex((e) => e.id === episode.id);
    return {
      prev: idx > 0 ? sorted[idx - 1] : null,
      next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null,
    };
  }, [episode, siblings]);

  async function onSaveScript() {
    if (!episode) return;
    setScriptSaving(true);
    setError(null);
    try {
      const updated = await projects.updateEpisode(episode.id, {
        title: edit.title,
        episodeGoal: edit.episodeGoal,
        episodeConflict: edit.episodeConflict,
        episodeEndingHook: edit.episodeEndingHook,
        version: episode.version,
      });
      setEpisode(updated);
      setSiblings((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setScriptSaving(false);
    }
  }

  async function onConfirmScript() {
    if (!episode) return;
    setScriptConfirming(true);
    setError(null);
    try {
      // 先保存最新草稿再走 confirm，避免"改了没保存"导致确认覆盖失败
      const saved = await projects.updateEpisode(episode.id, {
        title: edit.title,
        episodeGoal: edit.episodeGoal,
        episodeConflict: edit.episodeConflict,
        episodeEndingHook: edit.episodeEndingHook,
        version: episode.version,
      });
      const confirmed = await projects.confirmEpisodeStory(saved.id, saved.version);
      setEpisode(confirmed);
      setSiblings((list) => list.map((x) => (x.id === confirmed.id ? confirmed : x)));
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setScriptConfirming(false);
    }
  }

  // === async LLM jobs（拆场次 / 重生成本篇故事）===
  // 页面切走再回来时，useAsyncJob 会用 listBySource 自动 resume 未跑完的任务。
  const scenesJob = useAsyncJob({
    entityType: "episode",
    entityId: episodeId ?? "",
    resumeOnMount: !!episodeId,
    taskTypeFilter: ["storyboard_generate"],
    onDone: async () => {
      if (!episodeId) return;
      const res = await storyboards.listScenes(episodeId);
      setScenes(res.items);
    },
  });
  const storyJob = useAsyncJob({
    entityType: "episode",
    entityId: episodeId ?? "",
    resumeOnMount: !!episodeId,
    taskTypeFilter: ["story_generate"],
    onDone: async () => {
      if (!episodeId) return;
      const updated = await projects.getEpisode(episodeId);
      setEpisode(updated);
      setEdit({
        title: updated.title ?? "",
        episodeGoal: updated.episodeGoal ?? "",
        episodeConflict: updated.episodeConflict ?? "",
        episodeEndingHook: updated.episodeEndingHook ?? "",
      });
      setSiblings((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    },
  });

  // 把 scenesJob 状态映射到本页的 scenesState 状态机。
  useEffect(() => {
    if (scenesJob.status === "running") {
      setScenesState("generating");
      setGenErr(null);
    } else if (scenesJob.status === "succeeded") {
      setScenesState("preview");
      setGenErr(null);
    } else if (scenesJob.status === "failed") {
      setScenesState("error");
      setGenErr(scenesJob.error || "任务失败");
    }
  }, [scenesJob.status, scenesJob.error]);

  useEffect(() => {
    setStoryRegenerating(storyJob.status === "running");
    if (storyJob.status === "failed") setStoryRegenErr(storyJob.error);
    else if (storyJob.status === "succeeded" || storyJob.status === "idle")
      setStoryRegenErr(null);
  }, [storyJob.status, storyJob.error]);

  async function onGenerateScenes() {
    if (!episodeId) return;
    await scenesJob.start(async () => {
      const ticket = await storyboards.generateScenes(episodeId, genCountOverride);
      return ticket.taskId;
    });
  }

  async function onRegenerateStory() {
    if (!episode) return;
    // 主题锁：默认预填当前标题（对于成语故事，标题就是成语，如「画蛇添足」）。
    //   - 用户直接确认 → 保留当前主题，仅重生正文骨架，避免 LLM 换成「亡羊补牢」。
    //   - 用户改写 → 走新主题。
    //   - 用户清空 → 让 AI 自由选题（旧行为）。
    //   - 用户按取消 → 中止。
    const currentTitle = (episode.title ?? "").trim();
    const promptMsg = scriptConfirmed
      ? `⚠️ 本篇故事目前已确认（v${episode.version}）。重新生成会覆盖当前内容并把状态降级为草稿。\n\n主题（默认保留当前主题；留空由 AI 自由选题）：`
      : "重新生成会用最新的 AI 结果覆盖当前草稿。\n\n主题（默认保留当前主题；留空由 AI 自由选题）：";
    const topicInput = window.prompt(promptMsg, currentTitle);
    if (topicInput === null) return; // 用户取消
    const topicHint = topicInput.trim();
    setError(null);
    await storyJob.start(async () => {
      const ticket = await projects.regenerateEpisodeOutline(
        episode.id,
        topicHint || undefined,
      );
      return ticket.taskId;
    });
  }

  async function onConfirmScene(s: Scene) {
    setConfirmingSceneId(s.id);
    // Clear any previous per-scene error before the new attempt.
    setSceneErrors((prev) => {
      const next = { ...prev };
      delete next[s.id];
      return next;
    });
    try {
      const updated = await storyboards.confirmScene(s.id, s.version);
      setScenes((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      if (err instanceof ApiError) {
        // Persist inline on the scene card so global refreshes don't wipe it.
        setSceneErrors((prev) => ({
          ...prev,
          [s.id]: { code: err.code, message: err.message, details: err.details },
        }));
      } else {
        setError(String(err));
      }
    } finally {
      setConfirmingSceneId(null);
    }
  }

  async function onUnconfirmScene(s: Scene) {
    setConfirmingSceneId(s.id);
    setSceneErrors((prev) => {
      const next = { ...prev };
      delete next[s.id];
      return next;
    });
    try {
      const updated = await storyboards.unconfirmScene(s.id, s.version);
      setScenes((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      if (err instanceof ApiError) {
        setSceneErrors((prev) => ({
          ...prev,
          [s.id]: { code: err.code, message: err.message, details: err.details },
        }));
      } else {
        setError(String(err));
      }
    } finally {
      setConfirmingSceneId(null);
    }
  }

  /**
   * Round-3 P1-④：让 AI 只重新生成这一场（保持其他场次不变）。
   *
   * 交互：
   *   - 二次确认（原摘要将被覆盖）；
   *   - 成功后替换本地场卡；
   *   - 出错走 sceneErrors 内联展示；
   *   - 提示：下游 shots / 首帧图 / 视频可能因此需要重生（P2-⑤ 会自动标 stale）。
   */
  async function onRegenerateScene(s: Scene) {
    // 已经在重生中就忽略（避免同一场次的重复点击导致版本冲突）。
    if (regeneratingSceneIds.has(s.id)) return;
    const confirmed = window.confirm(
      `⚠️ 确认重生 S${s.sceneNo}${s.title ? ` · ${s.title}` : ""}？\n\n` +
        `本场所有分镜、首帧图、视频将被【彻底删除】并按新剧情重建，操作无法撤销。\n\n` +
        `（场次摘要 / 戏剧目标 / 冲突也会一并覆盖，状态回到「草稿」需重新确认）`,
    );
    if (!confirmed) return;
    setRegeneratingSceneIds((prev) => {
      const next = new Set(prev);
      next.add(s.id);
      return next;
    });
    setSceneErrors((prev) => {
      const next = { ...prev };
      delete next[s.id];
      return next;
    });
    try {
      const updated = await storyboards.regenerateScene(s.id, s.version);
      setScenes((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      if (err instanceof ApiError) {
        setSceneErrors((prev) => ({
          ...prev,
          [s.id]: { code: err.code, message: err.message, details: err.details },
        }));
      } else {
        setError(String(err));
      }
    } finally {
      setRegeneratingSceneIds((prev) => {
        const next = new Set(prev);
        next.delete(s.id);
        return next;
      });
    }
  }

  /**
   * Round-3 P1-①：打开某实体（scene / episode）的历史版本抽屉，拉取 `entity_snapshots`。
   *
   * 每次覆盖式更新（含 regenerate 单场重生 / 本篇故事重生）都会在 update 前留一条
   * `reason=update` 的快照，所以列表天然按时间倒序展示所有历史版本。
   */
  async function openHistory(target: HistoryTarget) {
    setHistoryTarget(target);
    setHistoryError(null);
    setHistoryItems([]);
    setHistoryLoading(true);
    try {
      const res = await snapshots.list(target.type, target.id, 30);
      setHistoryItems(res.items);
    } catch (err) {
      setHistoryError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryTarget(null);
    setHistoryItems([]);
    setHistoryError(null);
  }

  /**
   * Round-3 P1-①：把当前实体回滚到某个快照版本。
   *
   * 回滚会覆盖当前值，因此二次确认；并且会自动写一条"回滚前"的新快照，
   * 意味着即使 rollback 后不满意，胖哥也可以再 rollback 回去。
   */
  async function onRollbackToSnapshot(snap: SnapshotDigest) {
    const target = historyTarget;
    if (!target) return;
    const confirmed = window.confirm(
      `确认把 ${target.label} 回滚到 v${snap.version}（${new Date(snap.createdAt).toLocaleString()}）？\n\n当前 v${target.version} 会被自动保存到历史版本，可再次回滚回来。`,
    );
    if (!confirmed) return;
    setRollbackBusyId(snap.id);
    setHistoryError(null);
    try {
      await snapshots.rollback(snap.id, target.version);
      // 刷新对应实体 + 历史列表
      if (target.type === "scenes") {
        const current = scenes.find((x) => x.id === target.id);
        if (current) {
          const [scenesRes, historyRes] = await Promise.all([
            storyboards.listScenes(current.episodeId),
            snapshots.list("scenes", target.id, 30),
          ]);
          setScenes(scenesRes.items);
          setHistoryItems(historyRes.items);
          // 同步更新 target.version，避免下次回滚 expectedVersion 过期
          const updated = scenesRes.items.find((x) => x.id === target.id);
          if (updated) setHistoryTarget({ ...target, version: updated.version });
        }
      } else if (target.type === "episodes") {
        const [ep, historyRes] = await Promise.all([
          projects.getEpisode(target.id),
          snapshots.list("episodes", target.id, 30),
        ]);
        setEpisode(ep);
        setHistoryItems(historyRes.items);
        setHistoryTarget({ ...target, version: ep.version });
      }
    } catch (err) {
      setHistoryError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
      );
    } finally {
      setRollbackBusyId(null);
    }
  }

  // Episode 级首帧生成 / 单张重试逻辑已下线（模块整体废弃）。
  // 分镜首帧的生成、重试、再抽一张统一由 SceneShotFrames 内部处理。

  const scriptConfirmed = episode?.storyStatus === "confirmed";
  const scriptDirty =
    !!episode &&
    (edit.title !== (episode.title ?? "") ||
      edit.episodeGoal !== (episode.episodeGoal ?? "") ||
      edit.episodeConflict !== (episode.episodeConflict ?? "") ||
      edit.episodeEndingHook !== (episode.episodeEndingHook ?? ""));

  const confirmedSceneCount = scenes.filter((s) => s.storyboardStatus === "confirmed").length;

  // 全套按内容形态派生的文案（EP/篇/册/场次/剧本/场景 …）。
  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );
  const {
    itemBadge,
    episodeNoun,
    sceneNoun,
    sceneBadge,
    keyframeNoun,
    scriptSectionLabel,
    scriptFields,
    panelTitle,
  } = outlineCopy;

  if (!episodeId) {
    return (
      <div className="card">
        <div className="error">缺少 episode id 参数</div>
      </div>
    );
  }

  return (
    <WorkspaceShell
      stages={stages}
      title={
        episode
          ? `${itemBadge(episode.episodeNo)} · ${episode.title || "（未命名）"}`
          : `${episodeNoun}工作台`
      }
      subtitle={
        <>
          <Link href="/story">← 返回{panelTitle}</Link>
          {project && (
            <span style={{ marginLeft: 12 }}>
              项目：<strong>{project.name}</strong>
            </span>
          )}
        </>
      }
    >
      {error && <div className="error">{error}</div>}

      {!episode && !error && (
        <section className="card">
          <div className="muted">正在加载{episodeNoun}数据…</div>
        </section>
      )}

      {episode && (
        <>
          {/* ===== 顶栏：5 灯状态 + 集间跳转 ===== */}
          <section className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div className="episode-lights">
                {lights.map((l) => (
                  <span
                    key={l.key}
                    className={`episode-light episode-light-${l.status}`}
                    title={`${l.label}：${l.status}`}
                  >
                    <span className="episode-light-dot" />
                    {l.label}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {prev ? (
                  <Link
                    href={`/story/episode/${prev.id}`}
                    className="btn btn-secondary"
                    style={{ fontSize: 13 }}
                  >
                    ← {itemBadge(prev.episodeNo)}
                  </Link>
                ) : (
                  <span className="btn btn-secondary" style={{ fontSize: 13, opacity: 0.5 }}>
                    ← 无
                  </span>
                )}
                {next ? (
                  <Link
                    href={`/story/episode/${next.id}`}
                    className="btn btn-secondary"
                    style={{ fontSize: 13 }}
                  >
                    {itemBadge(next.episodeNo)} →
                  </Link>
                ) : (
                  <span className="btn btn-secondary" style={{ fontSize: 13, opacity: 0.5 }}>
                    无 →
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* ===== A) 剧本 ===== */}
          <section className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>
                {scriptSectionLabel}{" "}
                <span className="muted" style={{ fontSize: 13, fontWeight: "normal" }}>
                  · {scriptFields.goal.label} / {scriptFields.conflict.label} / {scriptFields.endingHook.label}（本阶段的最小可用骨架）
                </span>
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="chip">
                  {scriptConfirmed ? "✅ 已确认" : "🟡 待确认"} · v{episode.version}
                </span>
                <button
                  type="button"
                  className="episode-story-regen"
                  onClick={() =>
                    openHistory({
                      type: "episodes",
                      id: episode.id,
                      label: "本篇故事",
                      version: episode.version,
                    })
                  }
                  title="查看本篇故事的历史版本，可回滚到任一历史版本"
                >
                  🕒 历史版本
                </button>
                <button
                  type="button"
                  className="episode-story-regen"
                  disabled={storyRegenerating}
                  onClick={onRegenerateStory}
                  title="用 AI 重新生成本篇故事骨架（会覆盖当前字段并降级为草稿）"
                >
                  {storyRegenerating ? "⏳ 生成中…" : "🔄 重新生成"}
                </button>
              </div>
            </div>

            {storyRegenErr && (
              <div className="error" style={{ marginBottom: 8 }}>
                ❌ {storyRegenErr}
              </div>
            )}

            {/* AI 元信息（钩子类型 / 学习锚点 / 年龄提示 / AI 预估场次数） */}
            {(episode.hookType ||
              episode.learningAnchor ||
              episode.ageHint ||
              episode.sceneCountEstimate) && (
              <div className="episode-meta-chips">
                {episode.hookType && (
                  <span className="episode-meta-chip" title="钩子类型（参考 0xsline / zenstory）">
                    钩子：<strong>{episode.hookType}</strong>
                  </span>
                )}
                {episode.learningAnchor && (
                  <span className="episode-meta-chip" title="教学 / 寓意 / 主题锚点">
                    锚点：<strong>{episode.learningAnchor}</strong>
                  </span>
                )}
                {episode.ageHint && (
                  <span className="episode-meta-chip" title="AI 预估的目标观众">
                    受众：<strong>{episode.ageHint}</strong>
                  </span>
                )}
                {episode.sceneCountEstimate && (
                  <span className="episode-meta-chip" title="AI 根据本篇内容自动估算的场次数">
                    AI 预估场次：<strong>{episode.sceneCountEstimate}</strong>
                  </span>
                )}
              </div>
            )}

            <div className="form-row">
              <label>{scriptFields.title.label}</label>
              <input
                value={edit.title}
                onChange={(e) => setEdit((s) => ({ ...s, title: e.target.value }))}
                placeholder={scriptFields.title.placeholder}
              />
            </div>
            <div className="form-row">
              <label>{scriptFields.goal.label}</label>
              <textarea
                rows={2}
                value={edit.episodeGoal}
                onChange={(e) => setEdit((s) => ({ ...s, episodeGoal: e.target.value }))}
                placeholder={scriptFields.goal.placeholder}
              />
            </div>
            <div className="form-row">
              <label>{scriptFields.conflict.label}</label>
              <textarea
                rows={2}
                value={edit.episodeConflict}
                onChange={(e) => setEdit((s) => ({ ...s, episodeConflict: e.target.value }))}
                placeholder={scriptFields.conflict.placeholder}
              />
            </div>
            <div className="form-row">
              <label>{scriptFields.endingHook.label}</label>
              <textarea
                rows={2}
                value={edit.episodeEndingHook}
                onChange={(e) =>
                  setEdit((s) => ({ ...s, episodeEndingHook: e.target.value }))
                }
                placeholder={scriptFields.endingHook.placeholder}
              />
            </div>

            {/* 四段节奏（arcBeats）—— 只读，来自 LLM；若无则整个块隐藏 */}
            {episode.arcBeats && episode.arcBeats.length > 0 && (
              <div className="form-row">
                <label>四段节奏</label>
                <div
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 12px",
                  }}
                >
                  {episode.arcBeats.map((b, i) => (
                    <div key={`${b.phase}-${i}`} className="arc-beat-row">
                      <div className="arc-beat-phase">
                        {b.phase}
                        {typeof b.weight === "number" && (
                          <span className="muted" style={{ marginLeft: 4, fontSize: 11 }}>
                            {Math.round(b.weight * 100)}%
                          </span>
                        )}
                      </div>
                      <div className="arc-beat-desc">{b.description}</div>
                    </div>
                  ))}
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    参考 0xsline/short-drama：opening 起势 · rising 攀升 · storm 风暴 · climax 决战。
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onSaveScript}
                disabled={scriptSaving || !scriptDirty}
              >
                {scriptSaving
                  ? "保存中…"
                  : scriptDirty
                    ? scriptConfirmed
                      ? "💾 保存修改（将取消确认）"
                      : "💾 保存草稿"
                    : "已保存"}
              </button>
              {(!scriptConfirmed || scriptDirty) && (
                <button
                  type="button"
                  className="btn"
                  onClick={onConfirmScript}
                  disabled={scriptConfirming || scriptDirty}
                  title={
                    scriptDirty
                      ? `请先保存修改后再确认${scriptSectionLabel}`
                      : undefined
                  }
                >
                  {scriptConfirming ? "确认中…" : `✅ 确认${scriptSectionLabel}`}
                </button>
              )}
              {scriptConfirmed && !scriptDirty && (
                <span className="muted" style={{ alignSelf: "center", fontSize: 13 }}>
                  ✅ 已确认 v{episode.version}；直接改字段即可，保存会自动取消确认。
                </span>
              )}
            </div>
          </section>

          {/* ===== A') 本集资产 =====
              两档分区展示：
                1) 项目级共用（drama = 全量；series = 系列包装级 mascot 等）—— read-only 视图，供本集拆场次时参考。
                2) 本集专属（只对 series 生成；drama 不需要，因此按钮对 drama 隐藏）。
              */}
          <section className="card">
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>
                本集角色 &amp; 场景{" "}
                <span
                  className="muted"
                  style={{ fontWeight: "normal", fontSize: 13 }}
                >
                  {project?.projectType === "series"
                    ? "（项目级共用 + 本集专属；拆场次和关键帧生成会优先复用这里的 visualLock）"
                    : "（drama 项目级共用资产 · 全集通用）"}
                </span>
              </h3>
              {/* 只有 series 才提供「生成本集资产」入口；drama 全部资产项目级，
                  在项目总览页维护即可，这里不再暴露入口避免误用。 */}
              {project?.projectType === "series" && (
                <button
                  className="primary"
                  onClick={onGenerateEpisodeAssetSeeds}
                  disabled={assetsGenerating}
                  title="调用 AI 根据本集 title / summary / goal / conflict / turn 生成本集专属角色 / 场景 / 道具 seeds"
                >
                  {assetsGenerating
                    ? "生成中…"
                    : epChars.length + epLocs.length + epProps.length > 0
                      ? "重新生成本集资产"
                      : "生成本集资产"}
                </button>
              )}
            </div>

            {assetsErr && <div className="error-inline">{assetsErr}</div>}

            {/* 项目级共用 —— 有则显示；drama 主要看这一区 */}
            {(projChars.length > 0 || projLocs.length > 0 || projProps.length > 0) && (
              <div style={{ marginBottom: 16 }}>
                <div
                  className="muted"
                  style={{ fontSize: 12, marginBottom: 6, letterSpacing: 0.5 }}
                >
                  🌐 项目级共用
                  {project?.projectType === "drama"
                    ? "（drama 主资产池，全集通用）"
                    : "（跨集共用；如系列主持人 / mascot / IP 视觉锁）"}
                </div>
                <div className="asset-panel">
                  <EpisodeAssetGroup
                    kind="character"
                    title="角色"
                    emptyLabel="—"
                    items={projChars}
                  />
                  <EpisodeAssetGroup
                    kind="location"
                    title="场景"
                    emptyLabel="—"
                    items={projLocs}
                  />
                  <EpisodeAssetGroup
                    kind="prop"
                    title="道具"
                    emptyLabel="—"
                    items={projProps}
                  />
                </div>
              </div>
            )}

            {/* 本集专属 —— 仅 series 展示；drama 隐藏本区，避免视觉噪音 */}
            {project?.projectType === "series" &&
              (epChars.length === 0 && epLocs.length === 0 && epProps.length === 0 ? (
                <div className="muted" style={{ padding: "12px 0" }}>
                  本集尚未生成专属资产。点击右上方「生成本集资产」，AI 会基于剧本要点（目标 / 冲突 / 转折）产出本集角色、场景、道具
                  seeds，并落到该集下，供拆场次和关键帧复用。
                </div>
              ) : (
                <div>
                  <div
                    className="muted"
                    style={{ fontSize: 12, marginBottom: 6, letterSpacing: 0.5 }}
                  >
                    🎬 本集专属
                  </div>
                  <div className="asset-panel">
                    <EpisodeAssetGroup
                      kind="character"
                      title="角色"
                      emptyLabel="尚无角色"
                      items={epChars}
                    />
                    <EpisodeAssetGroup
                      kind="location"
                      title="场景"
                      emptyLabel="尚无场景"
                      items={epLocs}
                    />
                    <EpisodeAssetGroup
                      kind="prop"
                      title="道具"
                      emptyLabel="尚无道具"
                      items={epProps}
                    />
                  </div>
                </div>
              ))}

            {/* drama + 无项目级资产：提示到项目总览页维护 */}
            {project?.projectType === "drama" &&
              projChars.length === 0 &&
              projLocs.length === 0 &&
              projProps.length === 0 && (
                <div className="muted" style={{ padding: "12px 0" }}>
                  drama 项目的角色 / 场景 / 道具在项目级维护。请回到{" "}
                  <Link href={`/story?projectId=${episode?.projectId ?? ""}`}>
                    项目总览
                  </Link>{" "}
                  生成 Story Bible 或手动创建资产。
                </div>
              )}
          </section>

          {/* ===== B) 场次 ===== */}
          <section className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>
                本{episodeNoun}{sceneNoun}{" "}
                <span className="muted" style={{ fontSize: 13, fontWeight: "normal" }}>
                  · {sceneNoun}是{keyframeNoun}生成的最小单元
                </span>
              </h3>
              {scenes.length > 0 && (
                <span className="chip">
                  {confirmedSceneCount} / {scenes.length} 已确认
                </span>
              )}
            </div>

            {!scriptConfirmed && scenes.length === 0 && (
              <div className="state-panel state-empty">
                <p style={{ marginTop: 0 }} className="muted">
                  ⏳ 建议先在上方确认{scriptSectionLabel}，AI 拆{sceneNoun}时会以{scriptFields.goal.label} / {scriptFields.conflict.label} / {scriptFields.endingHook.label}为锚，
                  拆出来的{sceneNoun}质量会更稳。当然，先拆{sceneNoun}探索一下也是允许的。
                </p>
              </div>
            )}

            {scenesState === "empty" && (
              <div className="prefill-hero">
                <div className="prefill-hero-title">🎬 AI 一键拆{sceneNoun}</div>
                <div className="prefill-hero-desc">
                  {episode.sceneCountEstimate
                    ? `AI 已根据本${episodeNoun}的目标 / 冲突 / 结尾钩子等推荐拆成 `
                    : `AI 会根据本${episodeNoun}的目标 / 冲突 / 结尾钩子自动估算合适的${sceneNoun}数量`}
                  {episode.sceneCountEstimate && (
                    <>
                      <strong>{episode.sceneCountEstimate}</strong> 个{sceneNoun}
                    </>
                  )}
                  ，接入 LLM 后由 AI 直接产出{sceneNoun}骨架（目标 / 冲突 / 节奏）；
                  未配置 API Key 时会返回 provider_unavailable，不再产出 mock 数据。
                </div>
                <div className="prefill-hero-controls">
                  <button
                    type="button"
                    className="prefill-hero-cta"
                    onClick={onGenerateScenes}
                  >
                    ✨ AI 自动拆{sceneNoun}
                    {episode.sceneCountEstimate ? `（约 ${episode.sceneCountEstimate} 个）` : ""}
                  </button>
                </div>
                <details style={{ marginTop: 12 }}>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
                    ⚙️ 高级：手动指定{sceneNoun}数量
                  </summary>
                  <div className="form-row" style={{ margin: "8px 0 0" }}>
                    <label>手动{sceneNoun}数</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={genCountOverride ?? ""}
                      placeholder={
                        episode.sceneCountEstimate
                          ? `留空则用 AI 预估 ${episode.sceneCountEstimate}`
                          : "留空则由 AI 决定"
                      }
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setGenCountOverride(v ? Math.max(1, Math.min(20, Number(v))) : undefined);
                      }}
                      style={{ maxWidth: 160 }}
                    />
                  </div>
                </details>
              </div>
            )}

            {scenesState === "generating" && (
              <div className="state-panel state-generating">
                <div>
                  ⏳ 正在拆分{" "}
                  {genCountOverride ?? episode.sceneCountEstimate ?? "AI 预估"} 个{sceneNoun}…
                </div>
                {Array.from({
                  length: genCountOverride ?? episode.sceneCountEstimate ?? 4,
                }).map((_, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <div className="skeleton short" />
                    <div className="skeleton wide" />
                  </div>
                ))}
              </div>
            )}

            {scenesState === "error" && (
              <div className="state-panel state-error">
                <div>❌ 生成失败：{genErr}</div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 12 }}
                  onClick={onGenerateScenes}
                >
                  🔁 重试
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => setScenesState("empty")}
                >
                  取消
                </button>
              </div>
            )}

            {scenesState === "preview" && scenes.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span className="muted">共 {scenes.length} 个{sceneNoun}</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 13 }}
                    onClick={() => setScenesState("empty")}
                  >
                    ➕ 追加{sceneNoun}
                  </button>
                  <Link
                    href={`/storyboards?episode=${episode.id}`}
                    className="btn btn-secondary"
                    style={{ marginLeft: "auto", fontSize: 13 }}
                  >
                    🔧 进入完整 Storyboard Studio →
                  </Link>
                </div>

                <div className="episode-grid">
                  {scenes.map((s) => {
                    const confirmed = s.storyboardStatus === "confirmed";
                    return (
                      <div key={s.id} className="episode-card">
                        <div className="episode-card-header">
                          <span className="episode-badge">
                            {sceneBadge(s.sceneNo ?? s.sortOrder ?? 0)}
                          </span>
                          <div className="episode-title">{s.title || `（未命名${sceneNoun}）`}</div>
                        </div>
                        <div className="episode-summary">
                          {s.summary || s.description || s.dramaticGoal || "尚无描述"}
                        </div>
                        <div className="episode-lights">
                          <span
                            className={`episode-light ${confirmed ? "episode-light-done" : ""}`}
                          >
                            <span className="episode-light-dot" />
                            {confirmed ? "已确认" : "草稿"}
                          </span>
                          {s.hook && (
                            <span className="episode-light" title={`本${sceneNoun}钩子`}>
                              <span className="episode-light-dot" />
                              hook
                            </span>
                          )}
                          {s.pacing && (
                            <span className="episode-light" title={`本${sceneNoun}节奏`}>
                              <span className="episode-light-dot" />
                              {s.pacing}
                            </span>
                          )}
                        </div>
                        {sceneErrors[s.id] && (
                          <div
                            role="alert"
                            style={{
                              marginTop: 8,
                              padding: "8px 10px",
                              borderRadius: 6,
                              border: "1px solid #f5c2c7",
                              background: "#f8d7da",
                              color: "#842029",
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <strong>
                                {sceneErrors[s.id].code === "blocked_by_issue"
                                  ? "❌ 无法确认：分镜未通过硬校验"
                                  : `❌ ${sceneErrors[s.id].code}`}
                              </strong>
                              <button
                                type="button"
                                aria-label="关闭"
                                onClick={() =>
                                  setSceneErrors((prev) => {
                                    const next = { ...prev };
                                    delete next[s.id];
                                    return next;
                                  })
                                }
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "#842029",
                                  cursor: "pointer",
                                  fontSize: 14,
                                  lineHeight: 1,
                                }}
                              >
                                ✕
                              </button>
                            </div>
                            <div style={{ marginTop: 4 }}>{sceneErrors[s.id].message}</div>
                            {(() => {
                              // Surface concrete blocked shot ids when the backend
                              // returns `details.blockedShots` (see storyboard-service.ts).
                              const d = sceneErrors[s.id].details as
                                | { blockedShots?: string[] }
                                | undefined;
                              if (d?.blockedShots && d.blockedShots.length > 0) {
                                return (
                                  <div style={{ marginTop: 4, opacity: 0.85 }}>
                                    受阻 shot：{d.blockedShots.length} 个（点击右上「🔧 进入完整 Storyboard Studio →」补齐 keyframe / 字段）
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        )}
                        <div className="episode-card-footer">
                          <span className="muted" style={{ fontSize: 12 }}>
                            v{s.version}
                          </span>
                          <div style={{ display: "flex", gap: 6 }}>
                            {/* Round-3 P1-①：查看/回滚历史版本 —— 只在有过至少一次修改时才有意义，
                                但为了简单起见始终展示，抽屉打开时列表为空会直接提示"暂无历史版本"。*/}
                            <button
                              type="button"
                              className="episode-card-cta episode-card-cta-secondary"
                              onClick={() =>
                                openHistory({
                                  type: "scenes",
                                  id: s.id,
                                  label: `S${s.sceneNo}${s.title ? " · " + s.title : ""}`,
                                  version: s.version,
                                })
                              }
                              title="查看本场历史版本，可回滚"
                            >
                              🕒 历史版本
                            </button>
                            {/* Round-3 P1-④：单场重生 —— 在 draft 和 confirmed 状态下都提供，
                                但会二次确认；confirmed 状态下走此按钮会强制回到 draft。 */}
                            <button
                              type="button"
                              className="episode-card-cta episode-card-cta-secondary"
                              disabled={
                                regeneratingSceneIds.has(s.id) || confirmingSceneId === s.id
                              }
                              onClick={() => onRegenerateScene(s)}
                              title="仅重新生成本场，其他场次保持不变（支持同时对多个场次并行触发）"
                            >
                              {regeneratingSceneIds.has(s.id) ? "AI 重生中…" : "🔄 重生本场"}
                            </button>
                            {confirmed ? (
                              <button
                                type="button"
                                className="episode-card-cta episode-card-cta-secondary"
                                disabled={confirmingSceneId === s.id}
                                onClick={() => onUnconfirmScene(s)}
                              >
                                取消确认
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="episode-card-cta episode-card-cta-primary"
                                disabled={
                                  confirmingSceneId === s.id || regeneratingSceneIds.has(s.id)
                                }
                                onClick={() => onConfirmScene(s)}
                              >
                                {confirmingSceneId === s.id
                                  ? "确认中…"
                                  : `确认本${sceneNoun} →`}
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Shot 首帧折叠区：默认收起以保持视觉密度；一旦场次被确认，
                            自动展开把下一步（生成分镜首帧）入口顶到眼前。 */}
                        <SceneShotFrames
                          sceneId={s.id}
                          sceneNo={s.sceneNo ?? s.sortOrder ?? 0}
                          autoExpand={s.storyboardStatus === "confirmed"}
                          // 重生本场后 scene.version 会 +1，用作 reloadKey 触发
                          // 子组件清缓存重新拉取 shots/首帧/视频，避免看到旧 3 shot。
                          reloadKey={s.version}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {/* B') Episode 级「首帧参考图」模块已下线：
              - 该模块历史上只做视觉预览，无下游消费（视频/拼接均消费分镜首帧图）。
              - 首帧生成入口已合并进各场次的分镜首帧区（SceneShotFrames，见 A/C 之间的 D/E 组件）。 */}

          {/* ===== B'') 本集视频拼接预览（Round-4 Phase-C） ===== */}
          <EpisodeCompositionPreview episodeId={episode.id} />

          {/* ===== C) 后续阶段（预留入口） ===== */}
          <section className="card">
            <h3 style={{ marginTop: 0 }}>
              后续阶段{" "}
              <span className="muted" style={{ fontSize: 13, fontWeight: "normal" }}>
                · 待{sceneNoun}全部确认后再启用
              </span>
            </h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link
                href={`/prompts?episode=${episode.id}`}
                className="btn btn-secondary"
                style={{ fontSize: 13 }}
              >
                🧠 生成 / 查看本{episodeNoun}提示词
              </Link>
              <Link
                href="/reviews"
                className="btn btn-secondary"
                style={{ fontSize: 13 }}
              >
                🔍 送审规则包
              </Link>
              <Link
                href="/exports"
                className="btn btn-secondary"
                style={{ fontSize: 13 }}
              >
                📦 拼接导出
              </Link>
            </div>
          </section>
        </>
      )}
      {/* Round-3 P1-①：历史版本抽屉。使用固定定位 overlay，避免破坏页面主布局。 */}
      {historyTarget && (
        <EntityHistoryDrawer
          target={historyTarget}
          items={historyItems}
          loading={historyLoading}
          error={historyError}
          rollbackBusyId={rollbackBusyId}
          onClose={closeHistory}
          onRollback={(snap) => onRollbackToSnapshot(snap)}
        />
      )}
    </WorkspaceShell>
  );
}

/**
 * Round-3 P1-① 通用历史版本抽屉。
 *
 * - 只做展示与"选择回滚"的入口，实际调用交给父组件的 `onRollback`。
 * - payload 内容故意不展开——rollback 是"整体回滚"，无字段级 diff；如果要看差异，
 *   可以先回滚到目标版本，再从当前版本走 "🔄 重生本场" 或手动编辑。
 * - 支持场次（scenes）与本篇故事（episodes）两类实体，标题/文案由 target.label 提供。
 * - 遵循 SOUL 结构化 + 深色透明背景。
 */
function EntityHistoryDrawer(props: {
  target: HistoryTarget;
  items: SnapshotDigest[];
  loading: boolean;
  error: string | null;
  rollbackBusyId: string | null;
  onClose: () => void;
  onRollback: (snap: SnapshotDigest) => void;
}) {
  const { target, items, loading, error, rollbackBusyId, onClose, onRollback } = props;
  const kindLabel = target.type === "scenes" ? "场次" : "本篇故事";
  const emptyHint =
    target.type === "scenes"
      ? "暂无历史版本（本场自创建以来还未被修改过）。"
      : "暂无历史版本（本篇故事自创建以来还未被修改过）。";
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 40,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "90vw",
          height: "100%",
          background: "#fff",
          boxShadow: "-4px 0 16px rgba(0,0,0,0.12)",
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <strong style={{ fontSize: 16 }}>🕒 {kindLabel}历史版本 · {target.label}</strong>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          当前版本 v{target.version}；点击"回滚到此版本"会把当前值另存为新的历史条目，可再次回滚回来。
        </div>
        {error && (
          <div
            style={{
              color: "#c81717",
              background: "#fdecec",
              padding: 8,
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
        {loading && <div className="muted">加载中…</div>}
        {!loading && items.length === 0 && !error && (
          <div className="muted" style={{ fontSize: 13 }}>
            {emptyHint}
          </div>
        )}
        {items.map((snap) => {
          return (
            <div
              key={snap.id}
              style={{
                border: "1px solid #e5e5e5",
                borderRadius: 6,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>v{snap.version}</span>
                <span className="muted" style={{ fontSize: 11 }}>
                  {new Date(snap.createdAt).toLocaleString()}
                </span>
              </div>
              {snap.summary && <div style={{ fontSize: 13 }}>{snap.summary}</div>}
              {snap.reason && (
                <div className="muted" style={{ fontSize: 11 }}>
                  {snap.reason === "update"
                    ? "· 触发：更新前自动快照"
                    : snap.reason === "regenerate"
                      ? "· 触发：AI 重生前自动快照"
                      : snap.reason === "rollback"
                        ? "· 触发：回滚前自动快照"
                        : `· 触发：${snap.reason}`}
                </div>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={rollbackBusyId === snap.id}
                onClick={() => onRollback(snap)}
                style={{ marginTop: 6 }}
              >
                {rollbackBusyId === snap.id ? "回滚中…" : `回滚到此版本 →`}
              </button>
            </div>
          );
        })}
        {/* entity id 保留在 DOM 上便于调试 */}
        <input type="hidden" value={`${target.type}:${target.id}`} readOnly />
      </div>
    </div>
  );
}


// -----------------------------------------------------------------------------
// EpisodeAssetGroup —— 展示本集专属角色/场景/道具的紧凑卡片组
// P1 扩展：每张卡额外挂"参考图缩略图 + 🎨 生成参考图按钮"，触发 seedream 出图并落库。
// -----------------------------------------------------------------------------
type AssetKind = "character" | "location" | "prop";

interface AssetRefState {
  thumbnail?: string; // dataUrl
  generating?: boolean;
  error?: string;
  /** Round-3 P0：最新一张 image_asset 的元信息，用于失败态展示 + 单张重试。 */
  latest?: ImageAssetRecord;
  /** 单张重试进行中 */
  retrying?: boolean;
}

function EpisodeAssetGroup({
  kind,
  title,
  emptyLabel,
  items,
}: {
  kind: AssetKind;
  title: string;
  emptyLabel: string;
  items: Array<{
    id: string;
    name: string;
    visualLock?: string;
  }>;
}) {
  const [refs, setRefs] = useState<Record<string, AssetRefState>>({});

  // 初次挂载 + items 变化时，并发拉每个资产的最新一张参考图作为缩略图。
  //   失败不阻塞列表展示，仅把该卡的 error 显式吃掉（列表始终能渲染出资产名 + visualLock）。
  useEffect(() => {
    if (items.length === 0) return;
    const list = kind === "character"
      ? imageAssets.listByCharacter
      : kind === "location"
        ? imageAssets.listByLocation
        : imageAssets.listByProp;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        items.map(async (it) => {
          try {
            const r = await list(it.id);
            const latest = r.items[0];
            // Round-3 P0：latest 是失败图时 thumbnail 为空，UI 会展示失败态；
            // 附带完整 image_asset 用于「重试」按钮。
            return [
              it.id,
              {
                thumbnail: latest && latest.status !== "failed" ? latest.dataUrl : undefined,
                latest,
              },
            ] as const;
          } catch {
            return [it.id, {}] as const;
          }
        }),
      );
      if (cancelled) return;
      setRefs((prev) => {
        const next = { ...prev };
        for (const [id, state] of results) {
          next[id] = { ...next[id], ...state };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, items]);

  async function onGenerate(assetId: string) {
    setRefs((prev) => ({
      ...prev,
      [assetId]: { ...prev[assetId], generating: true, error: undefined },
    }));
    try {
      const gen =
        kind === "character"
          ? imageAssets.generateCharacterReference
          : kind === "location"
            ? imageAssets.generateLocationReference
            : imageAssets.generatePropReference;
      const res = await gen(assetId);
      setRefs((prev) => ({
        ...prev,
        [assetId]: { thumbnail: res.dataUrl, generating: false, latest: res.asset },
      }));
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      // 失败也把「后端刚落的 failed 图」拉一次，UI 展示失败卡 + 重试按钮。
      let latestFailed: ImageAssetRecord | undefined;
      try {
        const list = kind === "character"
          ? imageAssets.listByCharacter
          : kind === "location"
            ? imageAssets.listByLocation
            : imageAssets.listByProp;
        const r = await list(assetId);
        latestFailed = r.items[0];
      } catch {
        // 忽略：拉不到就只显示 error 文本
      }
      setRefs((prev) => ({
        ...prev,
        [assetId]: {
          ...prev[assetId],
          generating: false,
          error: msg,
          thumbnail: latestFailed && latestFailed.status !== "failed" ? latestFailed.dataUrl : undefined,
          latest: latestFailed ?? prev[assetId]?.latest,
        },
      }));
    }
  }

  /**
   * Round-3 P0：单张资产参考图重试。
   * 语义与 onGenerate 类似，区别在于：走 imageAssets.retry(prevImageAssetId)，
   * 复用 prev 的 prompt/size 让 seedream 再冲一次。
   */
  async function onRetry(assetId: string, imageAssetId: string) {
    setRefs((prev) => ({
      ...prev,
      [assetId]: { ...prev[assetId], retrying: true, error: undefined },
    }));
    try {
      const res = await imageAssets.retry(imageAssetId);
      setRefs((prev) => ({
        ...prev,
        [assetId]: {
          thumbnail: res.dataUrl,
          retrying: false,
          latest: res.asset,
        },
      }));
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      // 重试仍然失败：把 latest 更新为最新的 failed 记录（后端已落库）。
      let latestFailed: ImageAssetRecord | undefined;
      try {
        const list = kind === "character"
          ? imageAssets.listByCharacter
          : kind === "location"
            ? imageAssets.listByLocation
            : imageAssets.listByProp;
        const r = await list(assetId);
        latestFailed = r.items[0];
      } catch {
        // 忽略
      }
      setRefs((prev) => ({
        ...prev,
        [assetId]: {
          ...prev[assetId],
          retrying: false,
          error: msg,
          latest: latestFailed ?? prev[assetId]?.latest,
          thumbnail: latestFailed && latestFailed.status !== "failed" ? latestFailed.dataUrl : undefined,
        },
      }));
    }
  }

  return (
    <div className="asset-group">
      <h4 style={{ margin: "8px 0" }}>
        {title}{" "}
        <span className="muted" style={{ fontWeight: "normal", fontSize: 12 }}>
          ·{items.length}
        </span>
      </h4>
      {items.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>
          {emptyLabel}
        </div>
      ) : (
        <div className="asset-grid">
          {items.map((it) => {
            const ref = refs[it.id] ?? {};
            return (
              <div key={it.id} className="asset-card">
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                  }}
                >
                  {/* 缩略图区（80×140，9:16 缩比） */}
                  <div
                    style={{
                      width: 80,
                      height: 140,
                      background: "#f3f4f6",
                      border: "1px solid #e5e7eb",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    {ref.generating ? (
                      <div
                        className="muted"
                        style={{ fontSize: 11, textAlign: "center" }}
                      >
                        生成中…
                      </div>
                    ) : ref.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ref.thumbnail}
                        alt={`${it.name} 参考图`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : ref.latest?.status === "failed" ? (
                      <div
                        title={ref.latest.errorMessage ?? "生成失败"}
                        style={{
                          width: "100%",
                          height: "100%",
                          background: "#ffecec",
                          color: "#c0392b",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          textAlign: "center",
                          padding: 4,
                        }}
                      >
                        <div style={{ fontSize: 20 }}>⚠️</div>
                        <div>失败</div>
                      </div>
                    ) : (
                      <div
                        className="muted"
                        style={{ fontSize: 10, textAlign: "center", padding: 4 }}
                      >
                        暂无
                        <br />
                        参考图
                      </div>
                    )}
                  </div>

                  {/* 卡片文本区 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="asset-card-title">
                      <strong>{it.name}</strong>
                    </div>
                    {it.visualLock && (
                      <div className="asset-card-visual-lock">
                        <span className="asset-visual-lock-label">
                          visualLock
                        </span>
                        <span>{it.visualLock}</span>
                      </div>
                    )}
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onGenerate(it.id)}
                        disabled={ref.generating || ref.retrying}
                        title={
                          ref.thumbnail
                            ? "用最新 visualLock 重新生成参考图（会追加一张新记录）"
                            : "调用 Seedream 生成本资产的视觉锁参考图（20-40s）"
                        }
                        style={{ fontSize: 12 }}
                      >
                        {ref.generating
                          ? "⏳ 生成中"
                          : ref.thumbnail
                            ? "🔄 重新生成参考图"
                            : "🎨 生成参考图"}
                      </button>
                      {ref.latest?.status === "failed" && ref.latest.id && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            ref.latest && onRetry(it.id, ref.latest.id)
                          }
                          disabled={ref.retrying || ref.generating}
                          title={
                            ref.latest.errorMessage
                              ? `重试上一次失败：${ref.latest.errorMessage}`
                              : "重试上一次失败"
                          }
                          style={{ fontSize: 12 }}
                        >
                          {ref.retrying ? "⏳ 重试中" : "🔁 重试"}
                        </button>
                      )}
                    </div>
                    {ref.latest?.status === "failed" && ref.latest.errorMessage && (
                      <div
                        className="error-inline"
                        style={{ marginTop: 6, fontSize: 12 }}
                      >
                        上次失败：{ref.latest.errorMessage}
                      </div>
                    )}
                    {ref.error && (
                      <div
                        className="error-inline"
                        style={{ marginTop: 6, fontSize: 12 }}
                      >
                        {ref.error}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// -----------------------------------------------------------------------------
// SceneShotFrames —— scene 卡片底部的"分镜首帧图"折叠区
// -----------------------------------------------------------------------------
// 交互：默认收起，避免打乱 scene 卡片视觉密度；点击展开时懒加载 shots + 每个
// shot 的最新首帧图。每个 shot 一个横向 mini 卡：缩略图 + shot#/type + 生成/重生按钮。
//
// 说明：
//   * 目前 shot 生成入口另有 Storyboard Studio，本组件不负责创建 shot，只在
//     shot 已存在时用于生成/展示"首帧图"。
//   * 首帧图与场次确认状态解耦：即使 scene 已确认，也允许对个别 shot 重生首帧。
//   * 生成一次约 20-40s，UI 需要有明显 loading 态。
interface ShotFrameState {
  thumbnail?: string;
  generating?: boolean;
  error?: string;
  /** Round-3 P0：最新一张 image_asset（含失败态），用于失败卡片 + 重试按钮。 */
  latest?: ImageAssetRecord;
  retrying?: boolean;
  /** Round-4 Phase-C：最新一条 video_asset（含失败态），用于视频预览 + 重生按钮。 */
  video?: VideoAssetRecord;
  /** 视频生成进行中（Seedance 2.0-mini 通常 30-90s）。 */
  videoGenerating?: boolean;
  /** 视频生成 / 重生的错误信息。 */
  videoError?: string;
  /**
   * Round-4 Phase-C 补丁：视频生成"预览"参数（durationSec / resolution / ratio /
   * modelId / isI2V / blockers / warnings）。在真正调 Ark 之前展示给用户。
   * shot 首帧图 / 台词 / 动作块任一变化后需要重拉，让预估时长跟上。
   */
  preview?: ShotVideoPreview;
  /** 预览加载中，避免多次并发拉取。 */
  previewLoading?: boolean;
}

function SceneShotFrames({
  sceneId,
  sceneNo,
  autoExpand,
  reloadKey,
}: {
  sceneId: string;
  sceneNo: number;
  /**
   * 由外部传入的"建议展开"信号。典型场景：场次骨架刚被确认，UI 层顺势
   * 把分镜首帧折叠区展开，把下一步入口顶到用户眼前，避免"确认完了不知道
   * 干嘛"的动作断层。已展开状态不会被再次收起 —— 尊重用户手动 collapse。
   */
  autoExpand?: boolean;
  /**
   * 外部触发的"强制重拉"信号。典型场景：场次被「重生本场」推倒重建后，
   * scene.version + 1，父组件把新 version 透传下来，本组件用它作为依赖
   * 重置内部 shots/frames 缓存，触发重新拉取。
   *
   * 不用 React `key` 强制 remount，是为了保留用户的 `expanded` UI 状态
   * 与滚动位置，只清缓存而不重建 DOM，交互更平滑。
   */
  reloadKey?: number | string;
}) {
  const [expanded, setExpanded] = useState(!!autoExpand);
  // 当 autoExpand 由 false → true（场次刚被确认）时，自动展开。
  // 反向不做处理，避免用户手动收起后被强制展开的坏体验。
  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [frames, setFrames] = useState<Record<string, ShotFrameState>>({});
  // ★ 修复「重生本场后 UI 仍显示旧 shot」：
  // 外部 reloadKey（= scene.version）变化即视为"服务端数据被覆盖了"，
  // 清空内部缓存后由下面的懒加载 useEffect 重新拉取一次。
  //
  // 这里刻意跳过首次渲染（首次 loaded=false 时无需清理，避免多余的 setState）。
  const isFirstReloadKeyRef = useRef(true);
  useEffect(() => {
    if (isFirstReloadKeyRef.current) {
      isFirstReloadKeyRef.current = false;
      return;
    }
    setLoaded(false);
    setShots([]);
    setFrames({});
    setListErr(null);
  }, [reloadKey]);
  // 快速创建第 1 个 shot 的内联状态
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  // 首帧图放大预览：点击 shot 缩略图后弹出全屏 modal。
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxLabel, setLightboxLabel] = useState<string>("");
  // 按 ESC 关闭 lightbox
  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  // 首次展开时懒加载 shots + 缩略图
  useEffect(() => {
    if (!expanded || loaded) return;
    let cancelled = false;
    setLoading(true);
    setListErr(null);
    (async () => {
      try {
        const res = await storyboards.listShots(sceneId);
        if (cancelled) return;
        setShots(res.items);
        // 并发拉每个 shot 的最新首帧图 + 最新视频 + 生成预览，
        // 一次搞定，避免用户展开 shot 卡后还要再等 preview 单独往返一次。
        const results = await Promise.all(
          res.items.map(async (sh) => {
            const [image, video, preview] = await Promise.all([
              imageAssets.listByShot(sh.id).then(
                (r) => r.items[0],
                () => undefined,
              ),
              videoAssets.listByShot(sh.id).then(
                (r) => r.items[0],
                () => undefined,
              ),
              videoAssets.previewShotVideo(sh.id).catch(() => undefined),
            ]);
            return [
              sh.id,
              {
                thumbnail:
                  image && image.status !== "failed" ? image.dataUrl : undefined,
                latest: image,
                video,
                preview,
              },
            ] as const;
          }),
        );
        if (cancelled) return;
        setFrames((prev) => {
          const next = { ...prev };
          for (const [id, state] of results) next[id] = { ...next[id], ...state };
          return next;
        });
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setListErr(
          err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, loaded, sceneId]);

  /**
   * 刷新一个 shot 的视频生成预览（durationSec / resolution / isI2V / blockers…）。
   *
   * 调用时机：
   *   - shot 首帧图刚生成 / 重试成功 → i2v 模式可能从"不可用"翻到"可用"；
   *   - 视频生成 succeeded → 预览基本不变，但顺手刷新一次不亏。
   *
   * 用 `previewLoading` 做并发保护，避免同一 shot 短时间内多次并发拉取。
   */
  async function refreshPreview(shotId: string) {
    setFrames((prev) => ({
      ...prev,
      [shotId]: { ...prev[shotId], previewLoading: true },
    }));
    try {
      const preview = await videoAssets.previewShotVideo(shotId);
      setFrames((prev) => ({
        ...prev,
        [shotId]: { ...prev[shotId], preview, previewLoading: false },
      }));
    } catch {
      setFrames((prev) => ({
        ...prev,
        [shotId]: { ...prev[shotId], previewLoading: false },
      }));
    }
  }

  async function onGenerate(shotId: string) {
    setFrames((prev) => ({
      ...prev,
      [shotId]: { ...prev[shotId], generating: true, error: undefined },
    }));
    try {
      const res = await imageAssets.generateShotFirstFrame(shotId);
      setFrames((prev) => ({
        ...prev,
        [shotId]: { thumbnail: res.dataUrl, generating: false, latest: res.asset },
      }));
      // 首帧图刚就绪 → 视频生成从 t2v/blocked 状态翻到 i2v/可用，刷新预览。
      void refreshPreview(shotId);
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      // 失败也拉一次最新的 image_asset：后端已落 status='failed' 记录。
      let latestFailed: ImageAssetRecord | undefined;
      try {
        const r = await imageAssets.listByShot(shotId);
        latestFailed = r.items[0];
      } catch {
        /* ignore */
      }
      setFrames((prev) => ({
        ...prev,
        [shotId]: {
          ...prev[shotId],
          generating: false,
          error: msg,
          latest: latestFailed ?? prev[shotId]?.latest,
        },
      }));
    }
  }

  /** Round-3 P0：单张 shot 首帧图重试。 */
  async function onRetry(shotId: string, imageAssetId: string) {
    setFrames((prev) => ({
      ...prev,
      [shotId]: { ...prev[shotId], retrying: true, error: undefined },
    }));
    try {
      const res = await imageAssets.retry(imageAssetId);
      setFrames((prev) => ({
        ...prev,
        [shotId]: {
          thumbnail: res.dataUrl,
          retrying: false,
          latest: res.asset,
        },
      }));
      // 重试成功后首帧图恢复可用，视频预览要刷新。
      void refreshPreview(shotId);
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      let latestFailed: ImageAssetRecord | undefined;
      try {
        const r = await imageAssets.listByShot(shotId);
        latestFailed = r.items[0];
      } catch {
        /* ignore */
      }
      setFrames((prev) => ({
        ...prev,
        [shotId]: {
          ...prev[shotId],
          retrying: false,
          error: msg,
          latest: latestFailed ?? prev[shotId]?.latest,
        },
      }));
    }
  }

  /**
   * Round-4 Phase-C：为指定 shot 生成 Seedance 视频。
   *
   * 参数策略（Round-4 补丁）：
   *   不再硬编码 durationSec / resolution，而是发**空 body**——后端
   *   `generateShotVideo` 会用与 `previewShotVideoParams` 完全一致的推导逻辑
   *   算出最终参数，保证"预览显示什么，实际就生成什么"。
   *
   * 前置：shot 必须已有一张 status='succeeded' 的首帧图。
   */
  async function onGenerateVideo(shotId: string) {
    setFrames((prev) => ({
      ...prev,
      [shotId]: {
        ...prev[shotId],
        videoGenerating: true,
        videoError: undefined,
      },
    }));
    try {
      const res = await videoAssets.generateShotVideo(shotId, {
        generateAudio: true,
      });
      setFrames((prev) => ({
        ...prev,
        [shotId]: {
          ...prev[shotId],
          videoGenerating: false,
          video: res.asset,
        },
      }));
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
      // 失败后再拉一次最新，把 failed 记录同步到 UI（供"重试"按钮读取）
      let latestFailed: VideoAssetRecord | undefined;
      try {
        const r = await videoAssets.listByShot(shotId);
        latestFailed = r.items[0];
      } catch {
        /* ignore */
      }
      setFrames((prev) => ({
        ...prev,
        [shotId]: {
          ...prev[shotId],
          videoGenerating: false,
          videoError: msg,
          video: latestFailed ?? prev[shotId]?.video,
        },
      }));
    }
  }

  // 快速创建第 1 个分镜（当本场次尚无 shot 时）。填最小必要字段：
  //   shotNo=1, sortOrder=1, shotType="medium shot"，intent 留给用户后续在
  //   Storyboard Studio 补齐；这里的目的只是解锁"生成首帧"链路。
  async function onCreateFirstShot() {
    setCreating(true);
    setCreateErr(null);
    try {
      const shot = await storyboards.createShot(sceneId, {
        shotNo: 1,
        sortOrder: 1,
        shotType: "medium shot",
      });
      setShots([shot]);
      setFrames((prev) => ({ ...prev, [shot.id]: {} }));
      return shot;
    } catch (err) {
      setCreateErr(
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
      );
      return null;
    } finally {
      setCreating(false);
    }
  }

  /**
   * Round-3 UX：一步式「生成本段首帧」——空场次时把「创建首个分镜 + 生成首帧」
   * 合并成单次点击。用户角度：确认段落后直接点这一次就能拿到首帧图。
   */
  async function onCreateFirstShotAndFrame() {
    const shot = await onCreateFirstShot();
    if (!shot) return; // 创建失败，错误已展示
    await onGenerate(shot.id);
  }

  return (
    <div style={{ marginTop: 8, borderTop: "1px dashed #e5e7eb", paddingTop: 8 }}>
      <button
        type="button"
        className="btn btn-sm btn-secondary"
        style={{ fontSize: 12 }}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={`场次 ${sceneNo} 的分镜首帧图（Seedream 9:16 竖屏，图生图暂未接入）`}
      >
        {expanded ? "▾ 收起分镜首帧" : "▸ 展开分镜首帧"}
      </button>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {loading && (
            <div className="muted" style={{ fontSize: 12 }}>
              加载分镜列表…
            </div>
          )}
          {listErr && (
            <div className="error-inline" style={{ fontSize: 12 }}>
              ❌ {listErr}
            </div>
          )}
          {loaded && !listErr && shots.length === 0 && (
            <div style={{ fontSize: 12 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                本场次尚无分镜。点下面一步直出首帧图；若要精细编排镜头，也可以去
                Storyboard Studio。
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={onCreateFirstShotAndFrame}
                  disabled={creating}
                  style={{ fontSize: 11 }}
                  title="自动为本场创建一个默认镜头，并立即为其生成首帧图（一步到位）"
                >
                  {creating ? "创建分镜…" : "🎬 生成本段首帧"}
                </button>
              </div>
              {createErr && (
                <div
                  className="error-inline"
                  style={{ marginTop: 6, fontSize: 11 }}
                >
                  {createErr}
                </div>
              )}
            </div>
          )}
          {loaded && shots.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 8,
              }}
            >
              {shots.map((sh) => {
                const st = frames[sh.id] ?? {};
                return (
                  <div
                    key={sh.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: 8,
                      border: "1px solid #e5e7eb",
                      borderRadius: 6,
                      background: "#fafafa",
                    }}
                  >
                    <div
                      style={{
                        width: 68,
                        height: 120,
                        background: "#f3f4f6",
                        border: "1px solid #e5e7eb",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        flexShrink: 0,
                      }}
                    >
                      {st.generating ? (
                        <div
                          className="muted"
                          style={{ fontSize: 11, textAlign: "center" }}
                        >
                          生成中…
                        </div>
                      ) : st.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={st.thumbnail}
                          alt={`Shot#${sh.shotNo} 首帧`}
                          title="点击放大查看"
                          onClick={() => {
                            setLightboxSrc(st.thumbnail ?? null);
                            setLightboxLabel(
                              `S${sceneNo} · Shot#${sh.shotNo}${sh.shotType ? " · " + sh.shotType : ""}`,
                            );
                          }}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            cursor: "zoom-in",
                          }}
                        />
                      ) : st.latest?.status === "failed" ? (
                        <div
                          title={st.latest.errorMessage ?? "生成失败"}
                          style={{
                            width: "100%",
                            height: "100%",
                            background: "#ffecec",
                            color: "#c0392b",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            textAlign: "center",
                          }}
                        >
                          <div style={{ fontSize: 18 }}>⚠️</div>
                          <div>失败</div>
                        </div>
                      ) : (
                        <div
                          className="muted"
                          style={{
                            fontSize: 10,
                            textAlign: "center",
                            padding: 4,
                          }}
                        >
                          暂无
                          <br />
                          首帧
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        Shot #{sh.shotNo}
                        {sh.shotType ? (
                          <span
                            className="muted"
                            style={{
                              fontWeight: "normal",
                              marginLeft: 4,
                              fontSize: 11,
                            }}
                          >
                            · {sh.shotType}
                          </span>
                        ) : null}
                      </div>
                      {/* 方案 A：shot 上的 dialogue / action / intent 直接展示，
                          方便胖哥一眼看出每个 shot 到底在拍什么，不用点开 Studio。 */}
                      {(sh.action || sh.dialogue || sh.intent) && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11,
                            lineHeight: 1.5,
                            color: "#374151",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          {sh.action && (
                            <div title={sh.action}>
                              <span style={{ opacity: 0.55 }}>🎬 </span>
                              {sh.action}
                            </div>
                          )}
                          {sh.dialogue && (
                            <div
                              title={sh.dialogue}
                              style={{ whiteSpace: "pre-wrap" }}
                            >
                              <span style={{ opacity: 0.55 }}>💬 </span>
                              {sh.dialogue}
                            </div>
                          )}
                          {sh.intent && (
                            <div
                              title={sh.intent}
                              className="muted"
                              style={{ fontSize: 10 }}
                            >
                              🎯 {sh.intent}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Round-4 Phase-C 补丁：视频生成"预览"条。
                          在点击「🎥 生成本段视频」之前，先展示即将下发到 Ark 的参数：
                            · 预估时长（含来源：explicit / text_estimate / default）
                            · 分辨率 + 画幅
                            · i2v / t2v（是否有首帧图）
                            · 阻断项（blockers）/ 软提示（warnings）
                          与后端 `previewShotVideoParams` 完全一致，保证"看到什么，生什么"。 */}
                      {st.preview && (
                        <div
                          style={{
                            marginTop: 6,
                            padding: "4px 6px",
                            borderRadius: 4,
                            background: st.preview.canGenerate
                              ? "rgba(59, 130, 246, 0.08)"
                              : "rgba(239, 68, 68, 0.08)",
                            border: `1px solid ${
                              st.preview.canGenerate
                                ? "rgba(59, 130, 246, 0.25)"
                                : "rgba(239, 68, 68, 0.25)"
                            }`,
                            fontSize: 10,
                            lineHeight: 1.5,
                          }}
                          title={
                            st.preview.canGenerate
                              ? "点击「🎥 生成本段视频」后，将按下面参数下发到 Ark。"
                              : "当前无法生成视频，请先解决 blockers。"
                          }
                        >
                          <div>
                            <span style={{ fontWeight: 600 }}>预估：</span>
                            <span
                              title={
                                st.preview.durationSource === "shot_text"
                                  ? `AI 已给本 shot 写好 dialogue ${st.preview.durationDialogueChars}字 + action ${st.preview.durationActionChars}字，按字数精确估算`
                                  : st.preview.durationSource === "text_estimate"
                                    ? `按 scene dialogue/action 块 ${st.preview.durationDialogueChars}字 + ${st.preview.durationActionChars}字精确估算`
                                    : st.preview.durationSource === "scene_summary"
                                      ? `块表未录入，改用场次 summary + shot.intent（约 shot 均摊 ${st.preview.durationActionChars}字 + 本 shot 特有 ${st.preview.durationDialogueChars}字）估算`
                                      : st.preview.durationSource === "explicit"
                                        ? "shot 上显式指定了 durationSec"
                                        : "无信号，使用默认时长兜底"
                              }
                            >
                              {st.preview.durationSec}s
                              <span
                                style={{ opacity: 0.65, marginLeft: 2 }}
                              >
                                ({st.preview.durationSource})
                              </span>
                            </span>
                            {" · "}
                            <span>{st.preview.resolution}</span>
                            {" · "}
                            <span>{st.preview.ratio}</span>
                            {" · "}
                            <span
                              title={
                                st.preview.isI2V
                                  ? "image-to-video：使用首帧图作为视觉锚点"
                                  : "text-to-video：无首帧图，纯文本生成"
                              }
                            >
                              {st.preview.isI2V ? "i2v" : "t2v"}
                            </span>
                            <span
                              style={{
                                opacity: 0.65,
                                marginLeft: 4,
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                              }}
                              title="Ark 模型 endpoint id"
                            >
                              {st.preview.modelId}
                            </span>
                          </div>
                          {st.preview.blockers.length > 0 && (
                            <div
                              style={{
                                marginTop: 2,
                                color: "#b91c1c",
                              }}
                            >
                              ⛔ {st.preview.blockers.join("；")}
                            </div>
                          )}
                          {st.preview.warnings.length > 0 && (
                            <div
                              style={{
                                marginTop: 2,
                                color: "#a16207",
                              }}
                            >
                              ⚠️ {st.preview.warnings.join("；")}
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onGenerate(sh.id)}
                          disabled={st.generating || st.retrying}
                          style={{ fontSize: 11 }}
                          title={
                            st.thumbnail
                              ? "重新生成本 shot 的首帧图（追加一张新记录，不覆盖历史）"
                              : "为本 shot 生成 9:16 首帧图（约 20-40s）"
                          }
                        >
                          {st.generating
                            ? "⏳ 生成中"
                            : st.thumbnail
                              ? "🔄 重新生成首帧"
                              : "🎬 生成首帧"}
                        </button>
                        {st.latest?.status === "failed" && st.latest.id && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              st.latest && onRetry(sh.id, st.latest.id)
                            }
                            disabled={st.retrying || st.generating}
                            style={{ fontSize: 11 }}
                            title={
                              st.latest.errorMessage
                                ? `重试上一次失败：${st.latest.errorMessage}`
                                : "重试上一次失败"
                            }
                          >
                            {st.retrying ? "⏳" : "🔁 重试"}
                          </button>
                        )}
                        {/* Round-4 Phase-C：视频生成入口。
                            按钮启用条件：
                              1. 已有可用首帧图（缩略图 st.thumbnail 存在）；
                              2. 预览未阻断（preview 未加载时按老逻辑放行）；
                            成功过一次后按钮改为「🔄 重新生成视频」——同样 append-only。 */}
                        {st.thumbnail && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => onGenerateVideo(sh.id)}
                            disabled={
                              st.videoGenerating ||
                              st.generating ||
                              st.retrying ||
                              (st.preview
                                ? !st.preview.canGenerate
                                : false)
                            }
                            style={{ fontSize: 11 }}
                            title={
                              st.preview && !st.preview.canGenerate
                                ? `暂不可生成：${st.preview.blockers.join("；")}`
                                : st.preview
                                  ? `将按 ${st.preview.durationSec}s / ${st.preview.resolution} / ${st.preview.ratio} / ${
                                      st.preview.isI2V ? "i2v" : "t2v"
                                    } 生成视频（约 30-90s）。`
                                  : "基于本 shot 的首帧图 + 剧情/角色/道具锁，调 Seedance 2.0-mini 生成视频。约 30-90s。"
                            }
                          >
                            {st.videoGenerating
                              ? "⏳ 生成视频中"
                              : st.video?.status === "succeeded"
                                ? "🔄 重新生成视频"
                                : "🎥 生成本段视频"}
                          </button>
                        )}
                      </div>
                      {/* 视频预览：只在 succeeded 时展示 <video>；失败/过期时展示原因。 */}
                      {st.video?.status === "succeeded" && st.video.videoUrl && (
                        <div style={{ marginTop: 6 }}>
                          <video
                            src={st.video.videoUrl}
                            controls
                            playsInline
                            preload="metadata"
                            style={{
                              width: "100%",
                              maxWidth: 240,
                              borderRadius: 4,
                              background: "#000",
                            }}
                          />
                          {/* 视频生成参数元数据（0009 migration 起，字段与后端 video_assets 表一一对应）：
                              分两行展示，避免挤在一起：
                                第一行：核心播放参数 —— 时长 / 分辨率 / 画幅 / 模式(i2v/t2v) / 状态
                                第二行：追溯参数     —— 模型 / task / 时长来源（附字数明细） */}
                          <div
                            className="muted"
                            style={{
                              fontSize: 10,
                              marginTop: 3,
                              lineHeight: 1.5,
                            }}
                          >
                            <div>
                              <span title="视频时长（秒），来源见下一行 durationSource">
                                {st.video.durationSec}s
                              </span>
                              {" · "}
                              <span title="分辨率">
                                {st.video.resolution}
                              </span>
                              {" · "}
                              <span title="画幅">{st.video.ratio}</span>
                              {" · "}
                              <span
                                title={
                                  st.video.isI2V
                                    ? "image-to-video：首帧图作为视觉锚点"
                                    : "text-to-video：无首帧图"
                                }
                              >
                                {st.video.isI2V ? "i2v" : "t2v"}
                              </span>
                              {" · "}
                              <span title="上游任务状态">
                                {st.video.status}
                              </span>
                            </div>
                            <div style={{ marginTop: 2 }}>
                              <span
                                title="Ark 模型 endpoint id"
                                style={{ opacity: 0.8 }}
                              >
                                {st.video.modelId || "unknown"}
                              </span>
                              {st.video.taskId && (
                                <>
                                  {" · "}
                                  <span
                                    title="Ark 视频异步任务 id（用于排障 / observability）"
                                    style={{
                                      opacity: 0.8,
                                      fontFamily:
                                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                                    }}
                                  >
                                    task:{st.video.taskId.slice(0, 8)}…
                                  </span>
                                </>
                              )}
                              {st.video.durationSource && (
                                <>
                                  {" · "}
                                  <span
                                    title={
                                      st.video.durationSource ===
                                      "text_estimate"
                                        ? `按台词${st.video.durationDialogueChars}字 + 动作${st.video.durationActionChars}字估算`
                                        : st.video.durationSource ===
                                            "explicit"
                                          ? "上游/shot 显式指定"
                                          : "无信号，使用默认时长兜底"
                                    }
                                  >
                                    {st.video.durationSource}
                                    {st.video.durationSource ===
                                      "text_estimate" && (
                                      <>
                                        {" ("}
                                        {st.video.durationDialogueChars}+
                                        {st.video.durationActionChars}
                                        {"字)"}
                                      </>
                                    )}
                                  </span>
                                </>
                              )}
                            </div>
                            <div
                              style={{
                                marginTop: 2,
                                opacity: 0.7,
                              }}
                              title="上游 URL 24h 过期，若过期请点「🔄 重新生成视频」"
                            >
                              ⚠️ 上游 URL 约 24h 过期
                            </div>
                          </div>
                        </div>
                      )}
                      {st.video?.status === "failed" && (
                        <div
                          className="error-inline"
                          style={{ marginTop: 4, fontSize: 11 }}
                          title={st.video.errorMessage ?? "视频生成失败"}
                        >
                          上次视频失败：{st.video.errorMessage ?? "未知原因"}
                        </div>
                      )}
                      {st.videoError && (
                        <div
                          className="error-inline"
                          style={{ marginTop: 4, fontSize: 11 }}
                        >
                          {st.videoError}
                        </div>
                      )}
                      {st.latest?.status === "failed" && st.latest.errorMessage && (
                        <div
                          className="error-inline"
                          style={{ marginTop: 4, fontSize: 11 }}
                          title={st.latest.errorMessage}
                        >
                          上次失败：{st.latest.errorMessage}
                        </div>
                      )}
                      {/* Round-3 P2-⑤：stale 提示 —— 说明这张图对应的场次已经被重生/回滚，
                          现有首帧图可能已经跟新剧情不一致，建议重生。 */}
                      {st.latest?.status === "stale" && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11,
                            color: "#a76a00",
                            background: "#fff6e5",
                            padding: "4px 6px",
                            borderRadius: 4,
                          }}
                          title={
                            st.latest.staleReason === "scene_regenerated"
                              ? "本场剧情已重生，首帧图可能已过期"
                              : `已过期：${st.latest.staleReason ?? "未知原因"}`
                          }
                        >
                          ⚠️ 已过期，建议重生首帧
                        </div>
                      )}
                      {st.error && (
                        <div
                          className="error-inline"
                          style={{ marginTop: 4, fontSize: 11 }}
                        >
                          {st.error}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {lightboxSrc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxLabel ? `预览 ${lightboxLabel}` : "首帧图预览"}
          onClick={() => setLightboxSrc(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.85)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            cursor: "zoom-out",
          }}
        >
          <div
            style={{
              color: "#fff",
              fontSize: 13,
              marginBottom: 12,
              opacity: 0.85,
            }}
          >
            {lightboxLabel}
            <span style={{ marginLeft: 12, opacity: 0.6 }}>
              点击背景 / 按 ESC 关闭
            </span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxSrc}
            alt={lightboxLabel}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "min(95vw, 1200px)",
              maxHeight: "85vh",
              objectFit: "contain",
              borderRadius: 6,
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
              cursor: "default",
            }}
          />
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// EpisodeCompositionPreview —— 本集视频拼接预览（Round-4 Phase-C）
// -----------------------------------------------------------------------------
// 定位：视频生成的下一步「拼接」的 MVP 客户端实现。
//
// 展示：
//   * 就绪进度：readyShotCount / totalShotCount + 总时长
//   * 每个 shot 一行：sceneNo · shotNo · 时长；未生成的行标灰
//   * ▶️ 顺序播放：单一 <video> 顺序切源，模拟拼接效果
//   * 📥 导出 manifest.json：下载有序 URL 清单（用户可用任何工具本地 ffmpeg concat）
//   * 🔄 刷新：重新拉取 manifest
//
// 说明：真正的服务端 mp4 拼接（ffmpeg concat）已在 todo（Phase-C.2），需要用户
// 本地安装 ffmpeg。当前先用客户端顺序播放 + manifest 导出让链路可用。
function EpisodeCompositionPreview({ episodeId }: { episodeId: string }) {
  const [manifest, setManifest] = useState<EpisodeCompositionManifest | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 顺序播放状态：null 表示未播放；数字为当前正在播放的 items 索引。
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await videoAssets.compositionManifest(episodeId);
      setManifest(res);
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setLoading(false);
    }
  }, [episodeId]);

  useEffect(() => {
    load();
  }, [load]);

  // 顺序播放的核心：切到下一个已就绪 item。
  // 跳过未生成的 shot，避免 <video> 因 src 空导致报错。
  const readyIndices = useMemo(
    () =>
      (manifest?.items ?? [])
        .map((it, i) => (it.video?.videoUrl ? i : -1))
        .filter((i) => i >= 0),
    [manifest],
  );

  function startSequential() {
    if (readyIndices.length === 0) return;
    setPlayingIdx(readyIndices[0]!);
  }

  function stopSequential() {
    setPlayingIdx(null);
    if (videoRef.current) {
      videoRef.current.pause();
    }
  }

  // 当前源切换时自动开始播放
  useEffect(() => {
    if (playingIdx == null) return;
    const el = videoRef.current;
    if (!el) return;
    el.play().catch(() => {
      // 有些浏览器/网页在没有用户手势时会拒绝自动播放；静默失败。
    });
  }, [playingIdx]);

  function onEnded() {
    if (playingIdx == null || !manifest) return;
    // 找到下一个已就绪的 index
    const cursor = readyIndices.indexOf(playingIdx);
    const next = readyIndices[cursor + 1];
    if (next != null) {
      setPlayingIdx(next);
    } else {
      // 播完最后一条：结束顺序播放
      setPlayingIdx(null);
    }
  }

  function onDownloadManifest() {
    if (!manifest) return;
    const payload = {
      episodeId: manifest.episodeId,
      episodeNo: manifest.episodeNo,
      episodeTitle: manifest.episodeTitle,
      totalDurationSec: manifest.totalDurationSec,
      // 本地 ffmpeg 用：`ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4`
      // 由于 ffmpeg concat demuxer 需要「file 'xxx.mp4'」格式的文本，我们同时
      // 给出 JSON 和 ffmpeg concat list 两种形态。
      shots: manifest.items.map((it) => ({
        sceneNo: it.sceneNo,
        shotNo: it.shotNo,
        durationSec: it.video?.durationSec ?? null,
        videoUrl: it.video?.videoUrl ?? null,
        note: it.video ? null : "视频未生成",
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `episode-${manifest.episodeNo}-composition-manifest.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const currentItem: CompositionItem | undefined =
    playingIdx != null && manifest ? manifest.items[playingIdx] : undefined;

  return (
    <section className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0 }}>
          🎞️ 本集视频拼接{" "}
          <span className="muted" style={{ fontSize: 13, fontWeight: "normal" }}>
            · 客户端顺序播放 · 服务端 ffmpeg concat 后续接入
          </span>
        </h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={load}
            disabled={loading}
            style={{ fontSize: 12 }}
            title="重新拉取本集的分镜视频清单"
          >
            {loading ? "⏳ 刷新中…" : "🔄 刷新"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={playingIdx == null ? startSequential : stopSequential}
            disabled={loading || readyIndices.length === 0}
            style={{ fontSize: 12 }}
            title="按 (场次 · 分镜) 顺序自动切换视频源，模拟一集完整视频"
          >
            {playingIdx == null
              ? readyIndices.length === 0
                ? "▶️ 顺序播放（暂无视频）"
                : `▶️ 顺序播放（${readyIndices.length} 段）`
              : "⏹ 停止播放"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onDownloadManifest}
            disabled={!manifest || manifest.items.length === 0}
            style={{ fontSize: 12 }}
            title="下载本集分镜视频的有序 URL 清单（JSON），可自行本地 ffmpeg concat 拼真 mp4"
          >
            📥 导出 manifest
          </button>
        </div>
      </div>

      {err && (
        <div className="error-inline" style={{ marginBottom: 8, fontSize: 12 }}>
          {err}
        </div>
      )}

      {manifest && (
        <div
          className="muted"
          style={{ fontSize: 12, marginBottom: 8, display: "flex", gap: 12, flexWrap: "wrap" }}
        >
          <span>
            就绪：<strong>{manifest.readyShotCount}</strong> /{" "}
            {manifest.totalShotCount} 段
          </span>
          <span>预计总时长：约 {manifest.totalDurationSec}s</span>
          {manifest.totalShotCount === 0 && (
            <span>暂无分镜。先在上方场次里生成首帧 + 视频。</span>
          )}
        </div>
      )}

      {/* 顺序播放的单一 <video>：切换 src 触发下一段 */}
      {playingIdx != null && currentItem?.video?.videoUrl && (
        <div style={{ marginBottom: 8 }}>
          <video
            ref={videoRef}
            src={currentItem.video.videoUrl}
            controls
            autoPlay
            playsInline
            onEnded={onEnded}
            style={{
              width: "100%",
              maxWidth: 360,
              borderRadius: 6,
              background: "#000",
            }}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            当前：S{currentItem.sceneNo} · Shot#{currentItem.shotNo} ·{" "}
            {currentItem.video.durationSec}s（
            {readyIndices.indexOf(playingIdx) + 1} / {readyIndices.length}）
          </div>
        </div>
      )}

      {manifest && manifest.items.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 6,
            maxHeight: 220,
            overflowY: "auto",
            padding: 4,
            border: "1px solid #eef1f4",
            borderRadius: 6,
            background: "#fafbfc",
          }}
        >
          {manifest.items.map((it, i) => {
            const ready = !!it.video?.videoUrl;
            const isCurrent = playingIdx === i;
            return (
              <button
                key={`${it.sceneId}-${it.shotId}`}
                type="button"
                onClick={() => ready && setPlayingIdx(i)}
                disabled={!ready}
                title={
                  ready
                    ? `点击跳到 S${it.sceneNo} · Shot#${it.shotNo}`
                    : "该 shot 尚未生成视频，回到上方场次里生成"
                }
                style={{
                  fontSize: 11,
                  padding: "6px 8px",
                  borderRadius: 4,
                  border: isCurrent
                    ? "1.5px solid #2563eb"
                    : "1px solid #e5e7eb",
                  background: ready ? (isCurrent ? "#dbeafe" : "#fff") : "#f3f4f6",
                  color: ready ? "#111" : "#9ca3af",
                  cursor: ready ? "pointer" : "not-allowed",
                  textAlign: "left",
                  lineHeight: 1.35,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  S{it.sceneNo} · #{it.shotNo}
                </div>
                <div style={{ fontSize: 10 }}>
                  {ready
                    ? `${it.video?.durationSec ?? 0}s`
                    : "· 未生成"}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
