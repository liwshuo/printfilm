"use client";

/**
 * Storyboard Studio — scene generation state machine.
 *
 * Follows the same 4-state UX pattern as Story Workspace:
 *   empty | generating | preview(editable) | confirmed
 * plus a transient `error` overlay on failed generation.
 *
 * Per-episode: when an episode has no scenes, we surface a
 * 「一键生成场次骨架」 CTA that hits POST /api/episodes/:id/scenes/generate
 * (currently a determinstic stub that appends N draft scenes).
 * Once scenes exist we render the scene table with inline confirm/unconfirm.
 * The LLM wiring later only replaces the underlying endpoint; the UI
 * state machine stays identical.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  projects,
  storyboards,
  type Episode,
  type Project,
  type Scene,
} from "@/lib/api";
import { ProjectPicker, useSelectedProject } from "@/lib/project-picker";
import { getOutlineCopy } from "@/lib/workspace-stages";

type PanelState = "empty" | "generating" | "preview" | "error";

/**
 * Next.js 14 要求使用 useSearchParams 的组件必须包在 <Suspense> 内，否则
 * static export 阶段会 bailout。把整个页面拆到一个内部组件，再由默认导出
 * 包上 Suspense，即可满足要求。
 */
export default function StoryboardsPage() {
  return (
    <Suspense fallback={null}>
      <StoryboardsPageInner />
    </Suspense>
  );
}

function StoryboardsPageInner() {
  const [projectId, setProjectId] = useSelectedProject();
  const searchParams = useSearchParams();
  // 允许通过 URL `?episode=xxx` 从 Story Workspace 一键跳过来预选该集
  const requestedEpisodeId = searchParams?.get("episode") ?? "";
  const [project, setProject] = useState<Project | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeId, setEpisodeId] = useState<string>("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [state, setState] = useState<PanelState>("empty");
  const [genErr, setGenErr] = useState<string | null>(null);
  const [genCount, setGenCount] = useState<number>(4);
  const [confirming, setConfirming] = useState<string | null>(null);

  const isDrama = project?.projectType === "drama";
  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );
  const { itemBadge, sceneNoun, sceneBadge, keyframeNoun, episodeNoun, panelTitle } =
    outlineCopy;

  const loadEpisodes = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const [p, e] = await Promise.all([projects.get(projectId), projects.episodes(projectId)]);
      setProject(p);
      setEpisodes(e.items);
      // 优先级：URL 参数 > 已选中的 episodeId > 第一集
      if (requestedEpisodeId && e.items.some((it) => it.id === requestedEpisodeId)) {
        setEpisodeId(requestedEpisodeId);
      } else if (!episodeId && e.items.length > 0) {
        setEpisodeId(e.items[0].id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [projectId, episodeId, requestedEpisodeId]);

  const loadScenes = useCallback(async () => {
    if (!episodeId) return;
    setError(null);
    try {
      const res = await storyboards.listScenes(episodeId);
      setScenes(res.items);
      setState(res.items.length > 0 ? "preview" : "empty");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [episodeId]);

  useEffect(() => {
    loadEpisodes();
  }, [loadEpisodes]);
  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  async function onGenerateScenes() {
    if (!episodeId) return;
    setState("generating");
    setGenErr(null);
    try {
      // 走 async job：POST 202 → poll → refetch scenes。
      const ticket = await storyboards.generateScenes(episodeId, genCount);
      const { pollJob } = await import("@/lib/api");
      const final = await pollJob(ticket.taskId);
      if (final.status === "succeeded") {
        const list = await storyboards.listScenes(episodeId);
        setScenes(list.items);
        setState("preview");
      } else {
        throw new Error(final.errorMessage || final.errorCode || "任务失败");
      }
    } catch (err) {
      setGenErr(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      setState("error");
    }
  }

  async function onConfirmScene(s: Scene) {
    setConfirming(s.id);
    try {
      const updated = await storyboards.confirmScene(s.id, s.version);
      setScenes((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setConfirming(null);
    }
  }
  async function onUnconfirmScene(s: Scene) {
    setConfirming(s.id);
    try {
      const updated = await storyboards.unconfirmScene(s.id, s.version);
      setScenes((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setConfirming(null);
    }
  }

  const currentEpisode = useMemo(
    () => episodes.find((e) => e.id === episodeId),
    [episodes, episodeId],
  );

  const confirmedCount = scenes.filter((s) => s.storyboardStatus === "confirmed").length;

  return (
    <>
      <header className="page-header">
        <h2>Storyboard Studio</h2>
        <span className="subtitle">
          {sceneNoun} · {keyframeNoun} · 台词/动作块
          {project && (
            <span style={{ marginLeft: 12 }}>
              <span className="tag">{outlineCopy.projectTypeBadge(isDrama)}</span>
            </span>
          )}
        </span>
      </header>

      <section className="card">
        <ProjectPicker value={projectId} onChange={setProjectId} />
        {!projectId && (
          <div className="muted" style={{ marginTop: 12 }}>
            请先选择一个项目（可从「
            <Link href="/">项目总览</Link>」点击项目行进入）。
          </div>
        )}
      </section>

      {error && <div className="error-banner">{error}</div>}

      {projectId && episodes.length === 0 && (
        <section className="card">
          <div className="state-panel state-empty">
            <p style={{ marginTop: 0 }}>
              🎯 该项目暂无{episodeNoun}。请先到{" "}
              <Link href="/story">Story Workspace</Link> 生成{panelTitle}。
            </p>
          </div>
        </section>
      )}

      {projectId && episodes.length > 0 && (
        <>
          <section className="card">
            <div className="form-row" style={{ maxWidth: 480 }}>
              <label>选择{episodeNoun}</label>
              <select value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}>
                {episodes.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {itemBadge(ep.episodeNo)}
                    {ep.title ? ` · ${ep.title}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {currentEpisode && (
              <div className="chip-row" style={{ marginTop: 8 }}>
                <span className="chip">目标：{currentEpisode.episodeGoal || "—"}</span>
                <span className="chip">冲突：{currentEpisode.episodeConflict || "—"}</span>
                <span className="chip">
                  钩子：{currentEpisode.episodeEndingHook || "—"}
                </span>
                <span className="chip">v{currentEpisode.version}</span>
              </div>
            )}
          </section>

          <section className="card">
            <h3>
              {sceneNoun}骨架{" "}
              <span className="muted" style={{ fontWeight: "normal", fontSize: 13 }}>
                {isDrama
                  ? `· 连续项目：跨${episodeNoun}连续性锁生效，切勿破坏主线`
                  : `· 系列项目：本${episodeNoun}独立主线，落实开合钩子`}
              </span>
            </h3>

            {state === "empty" && (
              <div className="state-panel state-empty">
                <p style={{ marginTop: 0 }}>
                  🎬 该{episodeNoun}尚未生成{sceneNoun}。选择要一次生成的数量，一键生成骨架后再逐一打磨。
                  <br />
                  <span className="muted">
                    当前 LLM 未接入，此处走确定性 stub 生成，创建 N 个占位{sceneNoun}。
                  </span>
                </p>
                <div className="form-row" style={{ maxWidth: 220 }}>
                  <label>本次生成数量</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={genCount}
                    onChange={(e) => setGenCount(Number(e.target.value) || 1)}
                  />
                </div>
                <button type="button" className="btn" onClick={onGenerateScenes}>
                  ✨ 一键生成 {genCount} 个{sceneNoun}骨架
                </button>
              </div>
            )}

            {state === "generating" && (
              <div className="state-panel state-generating">
                <div>⏳ 正在生成 {genCount} 个{sceneNoun}…</div>
                {Array.from({ length: genCount }).map((_, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <div className="skeleton short" />
                    <div className="skeleton wide" />
                  </div>
                ))}
              </div>
            )}

            {state === "error" && (
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
                  onClick={() => setState("empty")}
                >
                  取消
                </button>
              </div>
            )}

            {state === "preview" && (
              <>
                <div className="chip-row" style={{ marginBottom: 12 }}>
                  <span className="chip">共 {scenes.length} 个{sceneNoun}</span>
                  <span className="chip">已确认 {confirmedCount}</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setState("empty")}
                    style={{ marginLeft: "auto" }}
                  >
                    ➕ 追加生成更多
                  </button>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{sceneNoun}</th>
                      <th>标题</th>
                      <th>目标</th>
                      <th>摘要</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenes.map((s) => (
                      <tr key={s.id}>
                        <td>{sceneBadge(s.sceneNo ?? 0)}</td>
                        <td>{s.title || "—"}</td>
                        <td className="muted">{s.dramaticGoal || "—"}</td>
                        <td className="muted" style={{ maxWidth: 320 }}>
                          {s.summary || <span className="muted">（空）</span>}
                        </td>
                        <td>
                          <span
                            className={
                              "tag " +
                              (s.storyboardStatus === "confirmed" ? "tag-ok" : "")
                            }
                          >
                            {s.storyboardStatus === "confirmed" ? "已确认" : "草稿"}
                          </span>
                        </td>
                        <td>
                          {s.storyboardStatus === "confirmed" ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={confirming === s.id}
                              onClick={() => onUnconfirmScene(s)}
                            >
                              取消确认
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn"
                              disabled={confirming === s.id}
                              onClick={() => onConfirmScene(s)}
                            >
                              {confirming === s.id ? "…" : "✅ 确认"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
                  ⚠️ 已确认的{sceneNoun}会被 Review Center 视为「结构性不变式」的锚点。修改前请先取消确认。
                </div>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
