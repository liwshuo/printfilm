"use client";

/**
 * Asset Ledger — project-level assets + series episode cross-reference panel.
 *
 * Base layout: three ResourceBrowser blocks (Character / Location / Prop) at
 * project scope. For `series` projects we additionally surface a panel that
 * lets an episode pull in assets originally defined on another episode via
 * the `episode_asset_refs` m2m table.
 *
 * For `drama` projects the cross-episode panel is hidden — drama shares the
 * project-level asset pool by default and does not need explicit refs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  episodeAssets,
  projects,
  type AvailableAssets,
  type Episode,
  type EpisodeAssetRef,
  type Project,
} from "@/lib/api";
import { ProjectPicker, useSelectedProject } from "@/lib/project-picker";
import { ResourceBrowser } from "@/lib/resource-browser";
import { getOutlineCopy } from "@/lib/workspace-stages";

type AssetKind = "character" | "location" | "prop";

export default function AssetsPage() {
  const [projectId, setProjectId] = useSelectedProject();
  const [project, setProject] = useState<Project | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setEpisodes([]);
      return;
    }
    projects.get(projectId).then(setProject).catch(() => setProject(null));
    projects
      .episodes(projectId)
      .then((r) => setEpisodes(r.items))
      .catch(() => setEpisodes([]));
  }, [projectId]);

  const isSeries = project?.projectType === "series";
  const isDrama = project?.projectType === "drama";
  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );

  return (
    <>
      <header className="page-header">
        <h2>Asset Ledger</h2>
        <span className="subtitle">
          角色 · 造型 · 场地 · 道具
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
            请先选择项目（可从「
            <Link href="/">项目总览</Link>」进入）。
          </div>
        )}
      </section>

      {projectId && (
        <>
          <section className="card">
            <h3>角色</h3>
            <ResourceBrowser
              projectId={projectId}
              buildUrl={(id) => `/api/projects/${id}/characters`}
              emptyHint="还没有角色。可通过 POST /api/projects/{id}/characters 创建。"
              itemRenderer={(item) => {
                const c = item as {
                  id: string;
                  name: string;
                  roleType?: string;
                  isActive: boolean;
                  version: number;
                };
                return (
                  <div>
                    <strong>{c.name}</strong>{" "}
                    <span className="muted">({c.roleType || "role"})</span>{" "}
                    <span className={"tag " + (c.isActive ? "tag-ok" : "")}>
                      {c.isActive ? "active" : "disabled"}
                    </span>
                    <span className="muted"> · v{c.version}</span>
                  </div>
                );
              }}
            />
          </section>
          <section className="card">
            <h3>场地</h3>
            <ResourceBrowser
              projectId={projectId}
              buildUrl={(id) => `/api/projects/${id}/locations`}
              emptyHint="暂无场地。"
            />
          </section>
          <section className="card">
            <h3>道具</h3>
            <ResourceBrowser
              projectId={projectId}
              buildUrl={(id) => `/api/projects/${id}/props`}
              emptyHint="暂无道具。"
            />
          </section>

          {isSeries && (
            <EpisodeAssetReusePanel
              projectId={projectId}
              project={project}
              episodes={episodes}
            />
          )}
        </>
      )}
    </>
  );
}

/**
 * Series-only cross-episode asset reuse.
 *
 * `episode_asset_refs` lets EP X reuse assets whose canonical owner is EP Y (or
 * the project). The panel shows an episode picker, the current refs for that
 * episode, and the pool of assets available for referencing (= project-scope
 * assets + this episode's own assets + already-referenced assets from other
 * episodes, deduped by the backend `listAvailable*` methods).
 */
function EpisodeAssetReusePanel({
  projectId: _projectId,
  project,
  episodes,
}: {
  projectId: string;
  project: Project | null;
  episodes: Episode[];
}) {
  const [episodeId, setEpisodeId] = useState<string>("");
  const [refs, setRefs] = useState<EpisodeAssetRef[]>([]);
  const [available, setAvailable] = useState<AvailableAssets>({
    characters: [],
    locations: [],
    props: [],
  });
  const [kind, setKind] = useState<AssetKind>("character");
  const [assetIdToAttach, setAssetIdToAttach] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );
  const { itemBadge, episodeNoun } = outlineCopy;

  useEffect(() => {
    if (!episodeId && episodes.length > 0) setEpisodeId(episodes[0].id);
  }, [episodes, episodeId]);

  const load = useCallback(async () => {
    if (!episodeId) return;
    setError(null);
    try {
      const [r, a] = await Promise.all([
        episodeAssets.listRefs(episodeId),
        episodeAssets.listAvailable(episodeId),
      ]);
      setRefs(r.items);
      setAvailable(a);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [episodeId]);

  useEffect(() => {
    load();
  }, [load]);

  const pool = useMemo(() => {
    if (kind === "character") return available.characters;
    if (kind === "location") return available.locations;
    return available.props;
  }, [kind, available]);

  const alreadyRef = useMemo(
    () => new Set(refs.filter((r) => r.assetType === kind).map((r) => r.assetId)),
    [refs, kind],
  );

  async function onAttach() {
    if (!episodeId || !assetIdToAttach) return;
    try {
      await episodeAssets.attach(episodeId, {
        assetType: kind,
        assetId: assetIdToAttach,
        note: note || undefined,
      });
      setAssetIdToAttach("");
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function onDetach(r: EpisodeAssetRef) {
    try {
      await episodeAssets.detach(r.episodeId, r.assetType, r.assetId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  return (
    <section className="card">
      <h3>
        跨{episodeNoun}资产复用{" "}
        <span className="muted" style={{ fontSize: 13, fontWeight: "normal" }}>
          · series 专属：把其它{episodeNoun}/项目级的角色 · 场地 · 道具引入到本{episodeNoun}
        </span>
      </h3>

      {error && <div className="error-banner">{error}</div>}

      <div className="form-row" style={{ maxWidth: 320 }}>
        <label>目标{episodeNoun}</label>
        <select value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}>
          {episodes.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {itemBadge(ep.episodeNo)}
              {ep.title ? ` · ${ep.title}` : ""}
            </option>
          ))}
        </select>
      </div>

      <h4 style={{ marginTop: 16 }}>当前引用</h4>
      {refs.length === 0 ? (
        <div className="muted">尚未引用任何跨集资产。</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>类型</th>
              <th>资产 ID</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {refs.map((r) => (
              <tr key={`${r.assetType}:${r.assetId}`}>
                <td>
                  <span className="tag">{r.assetType}</span>
                </td>
                <td>
                  <code>{r.assetId.slice(0, 8)}</code>
                </td>
                <td className="muted">{r.note || "—"}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onDetach(r)}
                  >
                    移除引用
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: 16 }}>新增引用</h4>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {(["character", "location", "prop"] as AssetKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={"chip " + (kind === k ? "chip-active" : "")}
            onClick={() => {
              setKind(k);
              setAssetIdToAttach("");
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="form-row" style={{ maxWidth: 480 }}>
        <label>选择资产</label>
        <select
          value={assetIdToAttach}
          onChange={(e) => setAssetIdToAttach(e.target.value)}
        >
          <option value="">— 选择 —</option>
          {pool.map((a) => {
            const disabled = alreadyRef.has(a.id) || a.episodeId === episodeId;
            const suffix = a.episodeId === episodeId
              ? `（本${episodeNoun}资产）`
              : alreadyRef.has(a.id)
              ? "（已引用）"
              : a.episodeId
              ? `（${episodeNoun} scope）`
              : "（项目级）";
            return (
              <option key={a.id} value={a.id} disabled={disabled}>
                {a.name} · {a.id.slice(0, 8)} {suffix}
              </option>
            );
          })}
        </select>
      </div>
      <div className="form-row" style={{ maxWidth: 480 }}>
        <label>备注（可选）</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`e.g. 本${episodeNoun}借用第 1 ${episodeNoun}主场景`}
        />
      </div>
      <button
        type="button"
        className="btn"
        onClick={onAttach}
        disabled={!assetIdToAttach}
      >
        ➕ 建立引用
      </button>
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        ⚠️ 项目级资产（未绑定{episodeNoun}）本身就对所有{episodeNoun}可见，无需 ref；只有跨{episodeNoun}借用时才需要建立引用。
      </div>
    </section>
  );
}
