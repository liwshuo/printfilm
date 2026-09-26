"use client";

/**
 * Review Center — vertical slice with generation state machine.
 *
 * Panels:
 *   A) Rule Packs Runner — 一键跑「合规 + 连续性锁 + 五维质量评分」内置规则包，
 *      empty → generating → preview（含 verdict / 五维雷达 / blocking vs advisory）。
 *   B) Issues Board — 分组展示 blocking（结构性/reviewed 硬约束）vs advisory（craft/taste 建议）。
 *      支持 resolve / ignore / reopen 状态迁移。
 *   C) Runs History — 历次审查运行的 verdict、qualityScores.overall、时间戳。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  continuity,
  projects,
  reviews,
  type ContinuityLock,
  type Project,
  type ReviewIssue,
  type ReviewRun,
  type RunRulePacksResult,
  type Episode,
} from "@/lib/api";
import { ProjectPicker, useSelectedProject } from "@/lib/project-picker";
import { getOutlineCopy } from "@/lib/workspace-stages";

type GenState = "empty" | "generating" | "preview" | "error";

const SEV_PILL: Record<string, string> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "",
};

const TIER_LABEL: Record<string, string> = {
  structural_invariant: "结构不变式",
  reviewed_invariant: "已审不变式",
  craft_default: "工艺默认（建议）",
  taste_option: "口味选项（建议）",
};

function isBlocking(i: ReviewIssue): boolean {
  if (i.status !== "open" && i.status !== "reopened") return false;
  if (i.severity !== "high" && i.severity !== "critical") return false;
  const tier = i.ruleTier ?? "reviewed_invariant";
  return tier === "structural_invariant" || tier === "reviewed_invariant";
}

export default function ReviewsPage() {
  const [projectId, setProjectId] = useSelectedProject();
  const [project, setProject] = useState<Project | null>(null);

  const [issues, setIssues] = useState<ReviewIssue[]>([]);
  const [runs, setRuns] = useState<ReviewRun[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeId, setEpisodeId] = useState<string>("");

  const [genState, setGenState] = useState<GenState>("empty");
  const [lastRun, setLastRun] = useState<RunRulePacksResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );
  const { itemBadge, episodeNoun, sceneNoun } = outlineCopy;

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const [p, iss, rn, eps] = await Promise.all([
        projects.get(projectId),
        reviews.listIssues(projectId),
        reviews.listRuns(projectId),
        api.get<{ items: Episode[] }>(`/api/projects/${projectId}/episodes`),
      ]);
      setProject(p);
      setIssues(iss.items);
      setRuns(rn.items);
      setEpisodes(eps.items);
      if (rn.items.length > 0) {
        // 有历史 → 直接进 preview 展示上一次运行的 qualityScores
        const latest = rn.items[0];
        if (latest.status === "succeeded") {
          setLastRun({
            runId: latest.id,
            verdict: latest.verdict ?? "passed",
            createdIssueIds: [],
            qualityScores: latest.qualityScores ?? {},
            blockingCount: iss.items.filter(isBlocking).length,
            advisoryCount: iss.items.filter(
              (i) => !isBlocking(i) && (i.status === "open" || i.status === "reopened"),
            ).length,
          });
          setGenState("preview");
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const runRulePacks = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    setGenState("generating");
    try {
      const result = await reviews.runRulePacks(projectId, {
        episodeId: episodeId || undefined,
      });
      setLastRun(result);
      setGenState("preview");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setGenState("error");
    }
  }, [projectId, episodeId, load]);

  const changeStatus = useCallback(
    async (issue: ReviewIssue, action: "resolve" | "ignore" | "reopen") => {
      try {
        if (action === "resolve") await reviews.resolve(issue.id);
        else if (action === "ignore") {
          const reason = window.prompt("请填写忽略原因（必填）");
          if (!reason) return;
          await reviews.ignore(issue.id, reason);
        } else {
          await reviews.reopen(issue.id);
        }
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      }
    },
    [load],
  );

  const blocking = useMemo(() => issues.filter(isBlocking), [issues]);
  const advisory = useMemo(
    () =>
      issues.filter(
        (i) =>
          !isBlocking(i) && (i.status === "open" || i.status === "reopened"),
      ),
    [issues],
  );
  const closed = useMemo(
    () => issues.filter((i) => i.status === "resolved" || i.status === "ignored"),
    [issues],
  );

  return (
    <>
      <header className="page-header">
        <h2>Review Center</h2>
        <span className="subtitle">合规 · 连续性 · 五维质量</span>
      </header>
      <ProjectPicker value={projectId} onChange={setProjectId} />

      {/* ===== Panel A: Rule Packs Runner ===== */}
      <section className="card">
        <div className="section-title">
          <h3>内置规则包</h3>
          <span className="muted">合规 + 连续性锁 + 五维质量评分</span>
        </div>
        {episodes.length > 0 && (
          <div className="chip-row" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ marginRight: 8 }}>
              作用域：
            </span>
            <button
              className={"chip " + (episodeId === "" ? "chip-active" : "")}
              onClick={() => setEpisodeId("")}
              type="button"
            >
              项目级
            </button>
            {episodes.map((e) => (
              <button
                key={e.id}
                className={"chip " + (episodeId === e.id ? "chip-active" : "")}
                onClick={() => setEpisodeId(e.id)}
                type="button"
              >
                {itemBadge(e.episodeNo)} {e.title ? `· ${e.title}` : ""}
              </button>
            ))}
          </div>
        )}

        {genState === "empty" && (
          <div className="state-panel state-empty">
            <p className="muted">尚未运行规则包。点击下方按钮触发。</p>
            <button className="btn" onClick={runRulePacks} disabled={!projectId}>
              一键运行内置规则包
            </button>
          </div>
        )}

        {genState === "generating" && (
          <div className="state-panel state-generating">
            <div className="skeleton" style={{ height: 60 }} />
            <div className="skeleton" style={{ height: 60 }} />
            <p className="muted">正在运行内置规则包（合规 → 连续性 → 五维）…</p>
          </div>
        )}

        {genState === "preview" && lastRun && (
          <div>
            <div className="chip-row" style={{ marginBottom: 12 }}>
              <span
                className={
                  "tag " + (lastRun.verdict === "blocked" ? "tag-danger" : "tag-ok")
                }
              >
                verdict：{lastRun.verdict === "blocked" ? "阻塞（Blocked）" : "通过（Passed）"}
              </span>
              <span className="tag tag-danger">阻塞 {lastRun.blockingCount}</span>
              <span className="tag">建议 {lastRun.advisoryCount}</span>
              {lastRun.qualityScores.overall != null && (
                <span className="tag tag-ok">
                  综合分 {lastRun.qualityScores.overall}
                </span>
              )}
            </div>
            <QualityScoreGrid scores={lastRun.qualityScores} />
            <button className="btn-secondary" onClick={runRulePacks}>
              再跑一次
            </button>
          </div>
        )}

        {genState === "error" && (
          <div className="state-panel state-error">
            <p style={{ color: "#c00" }}>运行失败：{error}</p>
            <button className="btn" onClick={runRulePacks}>
              重试
            </button>
          </div>
        )}
      </section>

      {/* ===== Panel B: Issues Board ===== */}
      <section className="card">
        <div className="section-title">
          <h3>问题看板</h3>
          <span className="muted">
            阻塞 {blocking.length}｜建议 {advisory.length}｜已关闭 {closed.length}
          </span>
        </div>
        <IssueList title="🚨 阻塞（结构性 / 已审不变式）" items={blocking} onAction={changeStatus} />
        <IssueList title="💡 建议（工艺默认 / 口味选项）" items={advisory} onAction={changeStatus} />
        <IssueList title="✅ 已关闭" items={closed} onAction={changeStatus} muted />
      </section>

      {/* ===== Panel B.5: Continuity Locks ===== */}
      {projectId && (
        <ContinuityLocksPanel
          projectId={projectId}
          project={project}
          episodes={episodes}
          onChanged={load}
        />
      )}

      {/* ===== Panel C: Runs History ===== */}
      <section className="card">
        <div className="section-title">
          <h3>运行历史</h3>
          <span className="muted">共 {runs.length} 次</span>
        </div>
        {runs.length === 0 ? (
          <p className="muted">尚未有任何审查运行。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>scope</th>
                <th>reviewTypes</th>
                <th>status</th>
                <th>verdict</th>
                <th>综合分</th>
                <th>finishedAt</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.scopeType}</td>
                  <td>{r.reviewTypes.join(" · ")}</td>
                  <td>
                    <span
                      className={"pill " + (r.status === "succeeded" ? "ok" : "warn")}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td>
                    {r.verdict && (
                      <span
                        className={
                          "pill " + (r.verdict === "blocked" ? "danger" : "ok")
                        }
                      >
                        {r.verdict}
                      </span>
                    )}
                  </td>
                  <td>{r.qualityScores?.overall ?? "-"}</td>
                  <td className="muted">
                    {r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {error && <div className="error-banner">{error}</div>}
    </>
  );
}

function ContinuityLocksPanel({
  projectId,
  project,
  episodes,
  onChanged,
}: {
  projectId: string;
  project: Project | null;
  episodes: Episode[];
  onChanged: () => void;
}) {
  const [locks, setLocks] = useState<ContinuityLock[]>([]);
  const [scope, setScope] = useState<"project" | "episode" | "scene">("project");
  const [episodeId, setEpisodeId] = useState<string>("");
  const [lockPhrase, setLockPhrase] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );
  const { itemBadge, episodeNoun, sceneNoun } = outlineCopy;

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await continuity.list(projectId);
      setLocks(res.items);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate() {
    if (!lockPhrase.trim()) return;
    setErr(null);
    try {
      await continuity.create(projectId, {
        lockPhrase: lockPhrase.trim(),
        scope,
        episodeId: scope === "project" ? undefined : episodeId || undefined,
        status: "active",
      });
      setLockPhrase("");
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function onDisable(l: ContinuityLock) {
    try {
      await continuity.disable(l.id);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function onDelete(l: ContinuityLock) {
    if (!window.confirm(`确认删除锁「${l.lockPhrase}」？`)) return;
    try {
      await continuity.delete(l.id);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  const active = locks.filter((l) => l.status === "active");
  const disabled = locks.filter((l) => l.status !== "active");

  return (
    <section className="card">
      <div className="section-title">
        <h3>连续性锁</h3>
        <span className="muted">
          逐字锁面 · 参与 continuity 规则包机械核对（active {active.length} · 停用 {disabled.length}）
        </span>
      </div>

      {err && <div className="error-banner">{err}</div>}

      <div className="chip-row" style={{ marginBottom: 8 }}>
        {(["project", "episode", "scene"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={"chip " + (scope === s ? "chip-active" : "")}
            onClick={() => setScope(s)}
          >
            {s === "project" ? "项目级" : s === "episode" ? `${episodeNoun}级` : `${sceneNoun}级`}
          </button>
        ))}
      </div>
      {(scope === "episode" || scope === "scene") && episodes.length > 0 && (
        <div className="form-row" style={{ maxWidth: 320 }}>
          <label>绑定{episodeNoun}</label>
          <select value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}>
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
      <div className="form-row" style={{ maxWidth: 480 }}>
        <label>锁面文字（Continuity Pack 会在场景/镜头文本中做字面匹配）</label>
        <input
          value={lockPhrase}
          onChange={(e) => setLockPhrase(e.target.value)}
          placeholder="e.g. 主角右手戴银戒指"
        />
      </div>
      <button type="button" className="btn" onClick={onCreate} disabled={!lockPhrase.trim()}>
        ➕ 新建锁
      </button>

      <h4 style={{ marginTop: 16 }}>当前锁</h4>
      {locks.length === 0 ? (
        <div className="muted">暂无连续性锁。</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>锁面</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {locks.map((l) => (
              <tr key={l.id}>
                <td>
                  <span className="tag">{l.scope}</span>
                  {l.episodeId && (
                    <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                      EP · {l.episodeId.slice(0, 8)}
                    </span>
                  )}
                </td>
                <td>
                  <code>{l.lockPhrase}</code>
                </td>
                <td>
                  <span className={"tag " + (l.status === "active" ? "tag-ok" : "")}>
                    {l.status}
                  </span>
                </td>
                <td>
                  {l.status === "active" ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onDisable(l)}
                    >
                      停用
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onDelete(l)}
                    >
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function IssueList({
  title,
  items,
  onAction,
  muted,
}: {
  title: string;
  items: ReviewIssue[];
  onAction: (i: ReviewIssue, action: "resolve" | "ignore" | "reopen") => void;
  muted?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <h4 style={{ margin: "8px 0" }}>{title}</h4>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {items.map((i) => (
          <li
            key={i.id}
            style={{
              padding: 10,
              border: "1px solid #eee",
              borderRadius: 6,
              marginBottom: 6,
              opacity: muted ? 0.7 : 1,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span className={"pill " + SEV_PILL[i.severity]}>{i.severity}</span>
              {i.ruleTier && (
                <span className="tag">{TIER_LABEL[i.ruleTier] ?? i.ruleTier}</span>
              )}
              <span className="tag">{i.issueType}</span>
              {i.ruleCode && <span className="muted">[{i.ruleCode}]</span>}
              <strong>{i.title}</strong>
            </div>
            {i.description && (
              <p style={{ marginTop: 6 }}>{i.description}</p>
            )}
            {i.suggestion && (
              <p style={{ marginTop: 4 }} className="muted">
                建议：{i.suggestion}
              </p>
            )}
            <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
              {(i.status === "open" || i.status === "reopened") && (
                <>
                  <button className="btn-secondary" onClick={() => onAction(i, "resolve")}>
                    标记已解决
                  </button>
                  <button className="btn-secondary" onClick={() => onAction(i, "ignore")}>
                    忽略
                  </button>
                </>
              )}
              {(i.status === "resolved" || i.status === "ignored") && (
                <button className="btn-secondary" onClick={() => onAction(i, "reopen")}>
                  重开
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QualityScoreGrid({
  scores,
}: {
  scores: {
    pacing?: number;
    hook?: number;
    dialogue?: number;
    format?: number;
    coherence?: number;
    overall?: number;
    notes?: string;
  };
}) {
  const rows: Array<[string, number | undefined]> = [
    ["节奏 Pacing", scores.pacing],
    ["爽点 Hook", scores.hook],
    ["台词 Dialogue", scores.dialogue],
    ["格式 Format", scores.format],
    ["连贯 Coherence", scores.coherence],
  ];
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 8,
          margin: "8px 0",
        }}
      >
        {rows.map(([label, v]) => (
          <div
            key={label}
            style={{
              padding: 8,
              border: "1px solid #eee",
              borderRadius: 6,
              textAlign: "center",
            }}
          >
            <div className="muted" style={{ fontSize: 12 }}>
              {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{v ?? "-"}</div>
            <div
              style={{
                height: 4,
                background: "#eee",
                borderRadius: 2,
                marginTop: 4,
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, v ?? 0)}%`,
                  height: 4,
                  background: (v ?? 0) >= 75 ? "#3aa675" : (v ?? 0) >= 50 ? "#d69f34" : "#c04b4b",
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {scores.notes && (
        <p className="muted" style={{ marginTop: 4 }}>
          备注：{scores.notes}
        </p>
      )}
    </div>
  );
}
