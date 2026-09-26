"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  projects,
  CONTENT_TYPE_REGISTRY,
  VISUAL_STYLE_PRESETS,
  contentTypesForProjectType,
  isContentTypeSupported,
  type Project,
  type ProjectType,
  type ComplianceMode,
  type AspectRatio,
  type ContentType,
} from "@/lib/api";
import { getOutlineCopy } from "@/lib/workspace-stages";

const LS_KEY = "dramaflow:selectedProjectId";

interface FormState {
  name: string;
  slug: string;
  projectType: ProjectType;
  /** A1: 内容形态，与 projectType 联动过滤。 */
  contentType: ContentType;
  /** A1: 视觉风格预设 key，可空表示走该 contentType 的 default preset。 */
  visualStylePresetKey: string;
  /** A1: 用户自定义风格描述，可与预设叠加。 */
  visualStyleCustomPrompt: string;
  complianceMode: ComplianceMode;
  genre: string;
  audience: string;
  aspectRatio: AspectRatio;
  targetDurationSec: string;
  language: string;
  resolution: "720p" | "1080p" | "4k";
  fps: 24 | 25 | 30;
  subtitle: "burned" | "sidecar" | "none";
  voiceover: "tts" | "none";
}

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  projectType: "drama",
  contentType: "short_drama",
  // 空字符串 = "跟随内容形态默认预设"，提交时不显式传 presetKey，让后端 fallback。
  visualStylePresetKey: "",
  visualStyleCustomPrompt: "",
  complianceMode: "domestic",
  genre: "",
  audience: "",
  aspectRatio: "9:16",
  targetDurationSec: "60",
  language: "zh-CN",
  resolution: "1080p",
  fps: 30,
  subtitle: "burned",
  voiceover: "tts",
};

export default function DashboardPage() {
  const router = useRouter();
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await projects.list();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // A1: projectType → contentType 联动
  // 当 projectType 切换后，若当前 contentType 不在新 projectType 支持列表内，
  // 自动切回该 projectType 的第一个可选 contentType，并重置 visualStyle。
  const availableContentTypes = useMemo(
    () => contentTypesForProjectType(form.projectType),
    [form.projectType],
  );

  useEffect(() => {
    // 1) 若当前 contentType 不再支持新 projectType，切到首选
    if (!isContentTypeSupported(form.projectType, form.contentType)) {
      const first = availableContentTypes[0];
      if (first) {
        setForm((f) => ({
          ...f,
          contentType: first.key,
          visualStylePresetKey: "",
          visualStyleCustomPrompt: "",
        }));
      }
      return;
    }

    // 2) 若切到 series 且当前 contentType 是「drama 典型」(short_drama)，
    //    主动切到 series 独占的首选内容形态（如教育小故事），提示用户
    //    "选集剧≠只能拍短剧"。用户仍可手动改回。
    if (form.projectType === "series" && form.contentType === "short_drama") {
      const seriesOnly = availableContentTypes.find(
        (m) =>
          m.supportedProjectTypes.length === 1 && m.supportedProjectTypes[0] === "series",
      );
      if (seriesOnly) {
        setForm((f) => ({
          ...f,
          contentType: seriesOnly.key,
          visualStylePresetKey: "",
          visualStyleCustomPrompt: "",
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.projectType]);

  // A1: contentType → visualStylePresetKey 联动
  // contentType 切换时，若旧 presetKey 不在新预设列表内，重置为空（= default）。
  const availableVisualStyles = useMemo(
    () => VISUAL_STYLE_PRESETS[form.contentType] ?? [],
    [form.contentType],
  );

  useEffect(() => {
    if (
      form.visualStylePresetKey &&
      !availableVisualStyles.some((p) => p.key === form.visualStylePresetKey)
    ) {
      setForm((f) => ({ ...f, visualStylePresetKey: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.contentType]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const duration = form.targetDurationSec.trim();
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        projectType: form.projectType,
        contentType: form.contentType,
        complianceMode: form.complianceMode,
        aspectRatio: form.aspectRatio,
        language: form.language,
        outputSpec: {
          resolution: form.resolution,
          fps: form.fps,
          subtitle: form.subtitle,
          voiceover: form.voiceover,
        },
      };
      // A1: visualStyle — 只在用户显式选了 preset 或写了自定义 prompt 时才带上；
      // 全空 → 由后端 resolveVisualStyle 用该 contentType 的 default preset 兜底。
      const visualStyleInput: Record<string, string> = {};
      if (form.visualStylePresetKey) {
        visualStyleInput.presetKey = form.visualStylePresetKey;
      }
      if (form.visualStyleCustomPrompt.trim()) {
        visualStyleInput.customPrompt = form.visualStyleCustomPrompt.trim();
      }
      if (Object.keys(visualStyleInput).length > 0) {
        payload.visualStyle = visualStyleInput;
      }
      if (form.genre.trim()) payload.genre = form.genre.trim();
      if (form.audience.trim()) payload.audience = form.audience.trim();
      if (duration) payload.targetDurationSec = Number(duration);
      await projects.create(payload);
      setForm(EMPTY_FORM);
      setExpanded(false);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setCreating(false);
    }
  }

  function openProject(p: Project) {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, p.id);
    router.push("/story");
  }

  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(p: Project) {
    const confirmed =
      typeof window !== "undefined" &&
      window.confirm(
        `确认删除项目「${p.name}」？\n\n此操作会级联删除该项目下的：\n· 全部条目（分集 / 篇目 / 分册）及其子节点\n· 故事设定 / 提示词 / 导出记录\n· 关联资产（角色 / 场景 / 道具 / 素材）\n\n操作不可撤销。`,
      );
    if (!confirmed) return;
    try {
      setDeletingId(p.id);
      setError(null);
      await projects.delete(p.id);
      // 如果被删的是当前选中项目，清掉 localStorage 以免下次进入 /story 时 404。
      if (typeof window !== "undefined" && window.localStorage.getItem(LS_KEY) === p.id) {
        window.localStorage.removeItem(LS_KEY);
      }
      await reload();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.code} (HTTP ${err.status}): ${err.message}`
          : String(err);
      setError(msg);
      if (typeof window !== "undefined") {
        window.alert(`删除项目失败：\n${msg}`);
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <header className="page-header">
        <h2>项目总览</h2>
        <span className="subtitle">Project Dashboard · 全部项目一屏直达</span>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="card">
        <h3>新建项目</h3>
        <form onSubmit={onCreate}>
          <div className="form-row">
            <label>项目名称</label>
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
              placeholder="如：都市重生·2026"
            />
          </div>
          <div className="form-row">
            <label>项目 ID（唯一）</label>
            <input
              value={form.slug}
              onChange={(e) => update("slug", e.target.value)}
              required
              placeholder="如：urban-reborn-2026"
            />
          </div>
          <div className="form-row">
            <label>项目类型</label>
            <select
              value={form.projectType}
              onChange={(e) => update("projectType", e.target.value as ProjectType)}
            >
              <option value="drama">连续型（drama · 跨条目主线连贯，项目级共享故事/资产）</option>
              <option value="series">系列型（series · 每条目独立主题，允许跨条目复用设定）</option>
            </select>
            <div className="muted" style={{ marginTop: 4 }}>
              💡 项目类型 = 故事结构（是否跨条目连贯），下方「内容形态」 = 产出形式（短剧 / 动画 / 教育故事 / 绘本 / 纪录…），两个字段独立。
            </div>
          </div>
          <div className="form-row">
            <label>内容形态</label>
            <select
              value={form.contentType}
              onChange={(e) => update("contentType", e.target.value as ContentType)}
            >
              {availableContentTypes.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.zh} · {m.desc}
                </option>
              ))}
            </select>
            <div className="muted" style={{ marginTop: 4 }}>
              内容形态决定分镜/资产模板与视觉风格预设集，与项目类型正交。
            </div>
          </div>
          <div className="form-row">
            <label>视觉风格</label>
            <select
              value={form.visualStylePresetKey}
              onChange={(e) => update("visualStylePresetKey", e.target.value)}
            >
              <option value="">
                跟随内容形态默认（
                {
                  availableVisualStyles.find(
                    (p) => p.key === CONTENT_TYPE_REGISTRY[form.contentType].defaultVisualStylePresetKey,
                  )?.zh
                }
                ）
              </option>
              {availableVisualStyles.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.zh} · {p.desc}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>自定义风格描述（可选）</label>
            <input
              value={form.visualStyleCustomPrompt}
              onChange={(e) => update("visualStyleCustomPrompt", e.target.value)}
              placeholder="如：唐代宫廷画风、暖光、丝绸质感（会与所选预设叠加注入 prompt）"
              maxLength={500}
            />
          </div>
          <div className="form-row">
            <label>合规模式</label>
            <select
              value={form.complianceMode}
              onChange={(e) => update("complianceMode", e.target.value as ComplianceMode)}
            >
              <option value="domestic">国内（domestic · 走国内合规规则集）</option>
              <option value="overseas">出海（overseas · 走出海/海外合规规则集）</option>
            </select>
          </div>

          {expanded && (
            <>
              <div className="form-row">
                <label>题材（可选）</label>
                <input
                  value={form.genre}
                  onChange={(e) => update("genre", e.target.value)}
                  placeholder="如：都市情感、悬疑、职场"
                />
              </div>
              <div className="form-row">
                <label>目标受众（可选）</label>
                <input
                  value={form.audience}
                  onChange={(e) => update("audience", e.target.value)}
                  placeholder="如：25-35 都市女性"
                />
              </div>
              <div className="form-row">
                <label>画幅</label>
                <select
                  value={form.aspectRatio}
                  onChange={(e) => update("aspectRatio", e.target.value as AspectRatio)}
                >
                  <option value="9:16">9:16（竖屏 · 默认）</option>
                  <option value="16:9">16:9（横屏）</option>
                  <option value="1:1">1:1（方形）</option>
                </select>
              </div>
              <div className="form-row">
                <label>单集目标时长（秒）</label>
                <input
                  type="number"
                  min={10}
                  value={form.targetDurationSec}
                  onChange={(e) => update("targetDurationSec", e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>语言</label>
                <select value={form.language} onChange={(e) => update("language", e.target.value)}>
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                  <option value="id-ID">Bahasa Indonesia</option>
                  <option value="th-TH">ภาษาไทย</option>
                </select>
              </div>
              <div className="form-row">
                <label>输出规格</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select
                    value={form.resolution}
                    onChange={(e) =>
                      update("resolution", e.target.value as FormState["resolution"])
                    }
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                    <option value="4k">4k</option>
                  </select>
                  <select
                    value={form.fps}
                    onChange={(e) => update("fps", Number(e.target.value) as 24 | 25 | 30)}
                  >
                    <option value={24}>24 fps</option>
                    <option value={25}>25 fps</option>
                    <option value={30}>30 fps</option>
                  </select>
                  <select
                    value={form.subtitle}
                    onChange={(e) =>
                      update("subtitle", e.target.value as FormState["subtitle"])
                    }
                  >
                    <option value="burned">字幕：烧录</option>
                    <option value="sidecar">字幕：sidecar</option>
                    <option value="none">字幕：无</option>
                  </select>
                  <select
                    value={form.voiceover}
                    onChange={(e) =>
                      update("voiceover", e.target.value as FormState["voiceover"])
                    }
                  >
                    <option value="tts">配音：TTS</option>
                    <option value="none">配音：无</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn" disabled={creating}>
              {creating ? "创建中…" : "创建项目"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginLeft: 8 }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起高级设置" : "展开高级设置"}
            </button>
            <span className="muted" style={{ marginLeft: 12 }}>
              默认 1080p · 30fps · 烧录字幕 · TTS 配音 · 9:16 · 简体中文（时长与内容形态强相关，可在工作流中调整）
            </span>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>项目列表</h3>
        {loading ? (
          <div className="muted">加载中…</div>
        ) : items.length === 0 ? (
          <div className="muted">还没有项目，先创建一个。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>项目</th>
                <th>项目 ID</th>
                <th>类型</th>
                <th>内容形态</th>
                <th>合规</th>
                <th>条目数</th>
                <th>版本</th>
                <th>更新时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => openProject(p)}
                  title="点击打开项目工作台"
                >
                  <td>
                    <strong>{p.name}</strong>
                  </td>
                  <td>
                    <code>{p.slug}</code>
                  </td>
                  <td>
                    <span className="tag">
                      {getOutlineCopy(p.contentType).projectTypeBadge(
                        p.projectType === "drama",
                      )}
                    </span>
                  </td>
                  <td>
                    <span className="tag">
                      {CONTENT_TYPE_REGISTRY[p.contentType]?.zh ?? p.contentType}
                    </span>
                  </td>
                  <td>
                    <span className="tag">
                      {p.complianceMode === "domestic" ? "国内" : "出海"}
                    </span>
                  </td>
                  <td>{p.episodeCount}</td>
                  <td>v{p.version}</td>
                  <td className="muted">{p.updatedAt}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openProject(p);
                        }}
                      >
                        打开 →
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ color: "#dc2626", borderColor: "#fca5a5" }}
                        disabled={deletingId === p.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p);
                        }}
                        title="删除项目（级联清理所有关联数据）"
                      >
                        {deletingId === p.id ? "删除中…" : "删除"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
