"use client";

/**
 * Prompt Center — compile state machine.
 *
 * Prompt compile in DramaFlow is per-source (shot/scene), so this page provides
 * a source picker (episode → scene → shot / or scene for TTS) and a state
 * machine around the compile action:
 *   empty(no prompts for this source) | generating(compiling)
 *   | preview(editable positive/negative + confirm) | error
 *
 * The prompt list for a picked source is always shown so users can inspect
 * older drafts / confirmed versions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  projects,
  prompts,
  storyboards,
  type Episode,
  type Project,
  type PromptSpec,
  type Scene,
  type Shot,
} from "@/lib/api";
import { ProjectPicker, useSelectedProject } from "@/lib/project-picker";
import { getOutlineCopy } from "@/lib/workspace-stages";

type PanelState = "empty" | "generating" | "preview" | "error";
type SourceKind = "shot" | "scene";

export default function PromptsPage() {
  const [projectId, setProjectId] = useSelectedProject();
  const [project, setProject] = useState<Project | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeId, setEpisodeId] = useState<string>("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneId, setSceneId] = useState<string>("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotId, setShotId] = useState<string>("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("shot");
  const [targetType, setTargetType] = useState<"image" | "video">("image");

  const [items, setItems] = useState<PromptSpec[]>([]);
  const [state, setState] = useState<PanelState>("empty");
  const [genErr, setGenErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const loadEpisodes = useCallback(async () => {
    if (!projectId) return;
    try {
      const [p, e] = await Promise.all([
        projects.get(projectId),
        projects.episodes(projectId),
      ]);
      setProject(p);
      setEpisodes(e.items);
      if (!episodeId && e.items.length > 0) setEpisodeId(e.items[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [projectId, episodeId]);

  const loadScenes = useCallback(async () => {
    if (!episodeId) {
      setScenes([]);
      setSceneId("");
      return;
    }
    try {
      const res = await storyboards.listScenes(episodeId);
      setScenes(res.items);
      if (res.items.length > 0) setSceneId((prev) => prev || res.items[0].id);
      else setSceneId("");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [episodeId]);

  const loadShots = useCallback(async () => {
    if (!sceneId) {
      setShots([]);
      setShotId("");
      return;
    }
    try {
      const res = await storyboards.listShots(sceneId);
      setShots(res.items);
      if (res.items.length > 0) setShotId((prev) => prev || res.items[0].id);
      else setShotId("");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [sceneId]);

  useEffect(() => {
    loadEpisodes();
  }, [loadEpisodes]);
  useEffect(() => {
    loadScenes();
  }, [loadScenes]);
  useEffect(() => {
    loadShots();
  }, [loadShots]);

  const sourceEntityType = sourceKind;
  const sourceEntityId = sourceKind === "shot" ? shotId : sceneId;

  const loadPrompts = useCallback(async () => {
    if (!sourceEntityId) {
      setItems([]);
      setState("empty");
      return;
    }
    setError(null);
    try {
      const res = await prompts.listBySource(sourceEntityType, sourceEntityId);
      setItems(res.items);
      setState(res.items.length > 0 ? "preview" : "empty");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [sourceEntityType, sourceEntityId]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  async function onCompile() {
    if (!sourceEntityId) return;
    setState("generating");
    setGenErr(null);
    try {
      if (sourceKind === "shot") {
        await prompts.compileShot(sourceEntityId, targetType);
      } else {
        await prompts.compileSceneTts(sourceEntityId);
      }
      await loadPrompts();
      setState("preview");
    } catch (err) {
      setGenErr(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      setState("error");
    }
  }

  async function onConfirm(p: PromptSpec) {
    setConfirming(p.id);
    try {
      await prompts.confirm(p.id, p.version);
      await loadPrompts();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setConfirming(null);
    }
  }

  const compileBtnDisabled = !sourceEntityId;
  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );
  const { itemBadge, sceneNoun, sceneBadge, keyframeNoun, episodeNoun } = outlineCopy;
  const compileLabel =
    sourceKind === "shot"
      ? `✨ 编译 ${targetType === "image" ? keyframeNoun : "视频"} Prompt`
      : `✨ 编译${sceneNoun} TTS Prompt`;

  const latest = useMemo(() => (items.length > 0 ? items[0] : null), [items]);

  return (
    <>
      <header className="page-header">
        <h2>Prompt Center</h2>
        <span className="subtitle">Prompt 编译 · 版本 · 确认</span>
      </header>

      <section className="card">
        <ProjectPicker value={projectId} onChange={setProjectId} />
        {!projectId && (
          <div className="muted" style={{ marginTop: 12 }}>
            请先选择项目（可从「
            <Link href="/">项目总览</Link>」进入）。
          </div>
        )}
      </section>

      {error && <div className="error-banner">{error}</div>}

      {projectId && (
        <section className="card">
          <h3>选择 Prompt 源</h3>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={
                "chip " + (sourceKind === "shot" ? "chip-active" : "")
              }
              onClick={() => setSourceKind("shot")}
            >
              镜头 Prompt（图/视频）
            </button>
            <button
              type="button"
              className={
                "chip " + (sourceKind === "scene" ? "chip-active" : "")
              }
              onClick={() => setSourceKind("scene")}
            >
              {sceneNoun} TTS Prompt
            </button>
          </div>
          <div className="form-row" style={{ maxWidth: 320 }}>
            <label>{episodeNoun}</label>
            <select
              value={episodeId}
              onChange={(e) => {
                setEpisodeId(e.target.value);
                setSceneId("");
                setShotId("");
              }}
            >
              <option value="">— 选择 —</option>
              {episodes.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {itemBadge(ep.episodeNo)}
                  {ep.title ? ` · ${ep.title}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ maxWidth: 320 }}>
            <label>{sceneNoun}</label>
            <select
              value={sceneId}
              onChange={(e) => {
                setSceneId(e.target.value);
                setShotId("");
              }}
            >
              <option value="">— 选择 —</option>
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {sceneBadge(s.sceneNo ?? 0)}
                  {s.title ? ` · ${s.title}` : ""}
                </option>
              ))}
            </select>
          </div>
          {sourceKind === "shot" && (
            <>
              <div className="form-row" style={{ maxWidth: 320 }}>
                <label>镜头</label>
                <select value={shotId} onChange={(e) => setShotId(e.target.value)}>
                  <option value="">— 选择 —</option>
                  {shots.map((s) => (
                    <option key={s.id} value={s.id}>
                      Shot #{s.shotNo}
                      {s.shotType ? ` · ${s.shotType}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row" style={{ maxWidth: 220 }}>
                <label>Target</label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as "image" | "video")}
                >
                  <option value="image">image · {keyframeNoun}</option>
                  <option value="video">video · 视频</option>
                </select>
              </div>
            </>
          )}
        </section>
      )}

      {projectId && sourceEntityId && (
        <section className="card">
          <h3>
            当前源的 Prompt{" "}
            <span className="muted" style={{ fontSize: 13, fontWeight: "normal" }}>
              · {sourceKind}:{sourceEntityId.slice(0, 8)}
            </span>
          </h3>

          {state === "empty" && (
            <div className="state-panel state-empty">
              <p style={{ marginTop: 0 }}>
                🧪 该源尚未编译过 Prompt。点击下方按钮基于事实层
                （角色 look / 场地 / 道具 / 台词 / 连续性锁）汇编 Prompt 草稿。
                <br />
                <span className="muted">
                  编译走服务端 assemble + 稳定模板；LLM 不参与编译，可安全反复重试。
                </span>
              </p>
              <button
                type="button"
                className="btn"
                disabled={compileBtnDisabled}
                onClick={onCompile}
              >
                {compileLabel}
              </button>
            </div>
          )}

          {state === "generating" && (
            <div className="state-panel state-generating">
              <div>⏳ 正在编译 Prompt…</div>
              <div className="skeleton wide" style={{ marginTop: 12 }} />
              <div className="skeleton mid" />
              <div className="skeleton short" />
            </div>
          )}

          {state === "error" && (
            <div className="state-panel state-error">
              <div>❌ 编译失败：{genErr}</div>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 12 }}
                onClick={onCompile}
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
                <span className="chip">共 {items.length} 版</span>
                {latest && (
                  <>
                    <span className="chip">最新：{latest.targetType}</span>
                    <span className="chip">状态：{latest.status}</span>
                    <span className="chip">v{latest.version}</span>
                  </>
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginLeft: "auto" }}
                  onClick={onCompile}
                >
                  🔄 重新编译一版
                </button>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>状态</th>
                    <th>版本</th>
                    <th>正向 Prompt</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <code>{p.targetType}</code>
                      </td>
                      <td>
                        <span
                          className={
                            "tag " + (p.status === "confirmed" ? "tag-ok" : "")
                          }
                        >
                          {p.status}
                        </span>
                      </td>
                      <td>v{p.version}</td>
                      <td className="muted" style={{ maxWidth: 480 }}>
                        {p.positivePrompt
                          ? p.positivePrompt.slice(0, 120) +
                            (p.positivePrompt.length > 120 ? "…" : "")
                          : "—"}
                      </td>
                      <td>
                        {p.status === "draft" && (
                          <button
                            type="button"
                            className="btn"
                            disabled={confirming === p.id}
                            onClick={() => onConfirm(p)}
                          >
                            {confirming === p.id ? "…" : "✅ 确认"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
                ⚠️ 确认后 Prompt 版本会与 Artifact / Job 强绑定；如需修改，请先重新编译新版本。
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
