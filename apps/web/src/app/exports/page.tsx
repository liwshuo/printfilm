"use client";

/**
 * Export Center — bundle state machine.
 *
 * Follows the DramaFlow generation state-machine pattern:
 *   empty(no bundles) | generating(pending/composing) | preview(ready/failed history)
 *   | error(create call itself failed, e.g. blocked_by_issue from Review gate)
 *
 * Bundle status is polled every 5s; individual failed bundles can be retried in place.
 * Create form lets the user choose bundleType (per project / per episode) and
 * optionally scope down to a specific episode.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  exportsApi,
  projects,
  type Episode,
  type ExportBundle,
  type Project,
} from "@/lib/api";
import { ProjectPicker, useSelectedProject } from "@/lib/project-picker";
import { getOutlineCopy } from "@/lib/workspace-stages";

type PanelState = "empty" | "generating" | "preview" | "error";

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  composing: "合成中",
  ready: "✅ 就绪",
  failed: "❌ 失败",
  cancelled: "已取消",
};

const STATUS_TONE: Record<string, string> = {
  pending: "",
  composing: "",
  ready: "tag-ok",
  failed: "tag-danger",
  cancelled: "",
};

export default function ExportsPage() {
  const [projectId, setProjectId] = useSelectedProject();
  const [project, setProject] = useState<Project | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [items, setItems] = useState<ExportBundle[]>([]);
  const [state, setState] = useState<PanelState>("empty");
  const [error, setError] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // form
  const [bundleType, setBundleType] = useState<string>("project.mp4");
  const [scopeEpisodeId, setScopeEpisodeId] = useState<string>("");
  const [versionLabel, setVersionLabel] = useState<string>("");
  const [skipReviewGate, setSkipReviewGate] = useState<boolean>(false);

  const isDrama = project?.projectType === "drama";
  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );
  const { itemBadge, episodeNoun } = outlineCopy;

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const [p, ep, res] = await Promise.all([
        projects.get(projectId),
        projects.episodes(projectId),
        exportsApi.list(projectId),
      ]);
      setProject(p);
      setEpisodes(ep.items);
      setItems(res.items);
      setState(res.items.length > 0 ? "preview" : "empty");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load();
    if (!projectId) return;
    const iv = setInterval(() => {
      // 只有存在进行中的 bundle 时才轮询，避免 idle 打扰后端。
      const hasInflight = items.some((b) => b.status === "pending" || b.status === "composing");
      if (hasInflight) load();
    }, 5000);
    return () => clearInterval(iv);
  }, [load, projectId, items]);

  async function onCreate() {
    if (!projectId) return;
    setCreating(true);
    setCreateErr(null);
    const wasEmpty = items.length === 0;
    if (wasEmpty) setState("generating");
    try {
      await exportsApi.create({
        projectId,
        bundleType,
        scopeType: scopeEpisodeId ? "episode" : "project",
        scopeRefId: scopeEpisodeId || undefined,
        versionLabel: versionLabel || undefined,
        skipReviewGate,
      });
      await load();
    } catch (err) {
      setCreateErr(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      if (wasEmpty) setState("error");
    } finally {
      setCreating(false);
    }
  }

  async function onRetry(b: ExportBundle) {
    try {
      await exportsApi.retry(b.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function onStart(b: ExportBundle) {
    try {
      await exportsApi.start(b.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function onCancel(b: ExportBundle) {
    try {
      await exportsApi.cancel(b.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  const inflight = useMemo(
    () => items.filter((b) => b.status === "pending" || b.status === "composing"),
    [items],
  );

  return (
    <>
      <header className="page-header">
        <h2>Export Center</h2>
        <span className="subtitle">
          Export Bundle · Compose 任务 · Manifest
          {project && (
            <span style={{ marginLeft: 12 }}>
              <span className="tag">
                {outlineCopy.projectTypeBadge(isDrama)}
              </span>
            </span>
          )}
        </span>
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
          <h3>发起导出</h3>
          <div className="form-row" style={{ maxWidth: 320 }}>
            <label>Bundle 类型</label>
            <select value={bundleType} onChange={(e) => setBundleType(e.target.value)}>
              <option value="project.mp4">整片 MP4</option>
              <option value="episode.mp4">单{episodeNoun} MP4</option>
              <option value="assets.zip">资产包 ZIP</option>
              <option value="storyboard.pdf">分镜 PDF</option>
            </select>
          </div>
          {bundleType === "episode.mp4" && (
            <div className="form-row" style={{ maxWidth: 320 }}>
              <label>选择{episodeNoun}</label>
              <select
                value={scopeEpisodeId}
                onChange={(e) => setScopeEpisodeId(e.target.value)}
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
          )}
          <div className="form-row" style={{ maxWidth: 320 }}>
            <label>版本标签（可选）</label>
            <input
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="e.g. 首播剪 / v1.0"
            />
          </div>
          <label className="checkbox-row" style={{ display: "block", margin: "8px 0" }}>
            <input
              type="checkbox"
              checked={skipReviewGate}
              onChange={(e) => setSkipReviewGate(e.target.checked)}
            />{" "}
            <span className="muted" style={{ fontSize: 13 }}>
              跳过 Review Center 阻塞校验（仅 ops 应急使用）
            </span>
          </label>
          <button type="button" className="btn" onClick={onCreate} disabled={creating}>
            {creating ? "发起中…" : "🚀 发起导出"}
          </button>
          <span className="muted" style={{ marginLeft: 12, fontSize: 13 }}>
            若审查存在阻塞问题，将返回 <code>blocked_by_issue</code>。
          </span>
          {createErr && (
            <div className="error-banner" style={{ marginTop: 12 }}>
              {createErr}
            </div>
          )}
        </section>
      )}

      {projectId && (
        <section className="card">
          <h3>Bundle 列表</h3>

          {state === "empty" && !creating && (
            <div className="state-panel state-empty">
              <p style={{ marginTop: 0 }}>
                📦 项目尚未生成任何导出包。填写上方表单发起第一份导出。
              </p>
            </div>
          )}

          {state === "generating" && (
            <div className="state-panel state-generating">
              <div>⏳ 正在生成导出任务…</div>
              <div className="skeleton wide" style={{ marginTop: 12 }} />
              <div className="skeleton mid" />
            </div>
          )}

          {state === "error" && (
            <div className="state-panel state-error">
              <div>❌ 发起失败：{createErr}</div>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 12 }}
                onClick={onCreate}
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
              {inflight.length > 0 && (
                <div className="chip-row" style={{ marginBottom: 12 }}>
                  <span className="chip">⏳ 进行中 {inflight.length}</span>
                  <span className="chip">每 5s 自动刷新</span>
                </div>
              )}
              <table className="table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>范围</th>
                    <th>版本</th>
                    <th>状态</th>
                    <th>输出路径</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <code>{b.bundleType}</code>
                      </td>
                      <td className="muted">
                        {b.scopeType === "episode" && b.scopeRefId
                          ? `EP · ${b.scopeRefId.slice(0, 8)}`
                          : "整个项目"}
                      </td>
                      <td>
                        <code>{b.versionLabel || `v${b.version}`}</code>
                      </td>
                      <td>
                        <span className={"tag " + (STATUS_TONE[b.status] || "")}>
                          {STATUS_LABEL[b.status] || b.status}
                        </span>
                        {b.status === "failed" && b.errorMessage && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {b.errorMessage}
                          </div>
                        )}
                      </td>
                      <td className="muted" style={{ maxWidth: 280 }}>
                        {b.outputPath || "—"}
                      </td>
                      <td className="muted">{b.createdAt}</td>
                      <td>
                        {b.status === "pending" && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => onStart(b)}
                          >
                            ▶️ 开始
                          </button>
                        )}
                        {b.status === "composing" && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => onCancel(b)}
                          >
                            取消
                          </button>
                        )}
                        {b.status === "failed" && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => onRetry(b)}
                          >
                            🔁 重试
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </>
  );
}
