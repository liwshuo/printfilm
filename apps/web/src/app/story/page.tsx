"use client";

/**
 * Story Workspace — generation state machine.
 *
 * Two panels, each following the same 4-state model:
 *   empty | generating | preview(editable) | confirmed
 * plus a transient `error` overlay on failed generation.
 *
 * Panels:
 *   A) Project Story Bible (logline / theme / tone). Empty when the seeded bible
 *      has no logline; user clicks 「一键生成故事圣经」 to fill via stub.
 *   B) Episode Outline (draft episodes). Empty when no episodes; user clicks
 *      「生成 3 集分集大纲」 to append draft episodes via stub.
 *
 * Copy differs slightly for drama vs. series based on project.projectType.
 * When LLM is wired later, only the underlying POST endpoint changes; the UI
 * state machine here stays identical.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  projects,
  assets,
  CONTENT_TYPE_REGISTRY,
  STORY_SETTING_PRESETS,
  contentTypesForProjectType,
  type CharacterAsset,
  type ContentType,
  type Episode,
  type LocationAsset,
  type Project,
  type PropAsset,
  type StoryBible,
  type StorySettingPresetMeta,
} from "@/lib/api";
import { useAsyncJob } from "@/lib/use-async-job";
import { ProjectPicker, useSelectedProject } from "@/lib/project-picker";
import { WorkspaceShell } from "@/lib/workspace-shell";
import {
  computeWorkspaceStages,
  computeEpisodeLights,
  computeEpisodeCta,
  getOutlineCopy,
  type NarrationStyle,
} from "@/lib/workspace-stages";

type PanelState = "empty" | "generating" | "preview" | "confirmed" | "error";

interface BibleEditState {
  logline: string;
  theme: string;
  tone: string;
  /** series preset only —— worldRules.targetAudience */
  targetAudience: string;
  /** series preset only —— worldRules.setting */
  setting: string;
}

/** 抽字段用小工具：worldRules.foo 这类 dot-path 从 storyBible 上取值。 */
function readByPath(b: StoryBible | null, path: string): string {
  if (!b) return "";
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = b;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return "";
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : "";
}

/** 「面板 A 有内容」的判定：任一预设字段（除 logline）非空即视为已生成。 */
function bibleHasContentForPreset(
  b: StoryBible | null,
  preset: StorySettingPresetMeta,
): boolean {
  if (!b) return false;
  return preset.fields.some((f) => {
    if (f.kind !== "text") return false;
    return readByPath(b, f.path).trim().length > 0;
  });
}

export default function StoryPage() {
  const [projectId, setProjectId] = useSelectedProject();
  const [project, setProject] = useState<Project | null>(null);
  const [bible, setBible] = useState<StoryBible | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [error, setError] = useState<string | null>(null);

  // P1 资产（story-bible 落库的 seeds；用户可在面板 C 查看/复用）
  const [assetChars, setAssetChars] = useState<CharacterAsset[]>([]);
  const [assetLocs, setAssetLocs] = useState<LocationAsset[]>([]);
  const [assetProps, setAssetProps] = useState<PropAsset[]>([]);
  const [assetErr, setAssetErr] = useState<string | null>(null);

  // A2 迁移：把项目级资产（episode_id IS NULL）一次性挂到指定分集。
  // 用于修复 series preset 收窄前生成的错版 seeds。
  const [migrateTargetEpId, setMigrateTargetEpId] = useState<string>("");
  const [migrating, setMigrating] = useState(false);
  const [migrateErr, setMigrateErr] = useState<string | null>(null);
  const [migrateInfo, setMigrateInfo] = useState<string | null>(null);

  // Bible panel state
  const [bibleState, setBibleState] = useState<PanelState>("empty");
  const [bibleEdit, setBibleEdit] = useState<BibleEditState>({
    logline: "",
    theme: "",
    tone: "",
    targetAudience: "",
    setting: "",
  });
  const [bibleSaving, setBibleSaving] = useState(false);
  const [bibleGenErr, setBibleGenErr] = useState<string | null>(null);

  // Outline panel state
  const [outlineState, setOutlineState] = useState<PanelState>("empty");
  const [outlineCount, setOutlineCount] = useState<number>(3);
  const [outlineGenErr, setOutlineGenErr] = useState<string | null>(null);
  // P0-2: AI pre-fill seed —— 用户可以填一句 idea / 主题 / 成语列表，作为生成时的 seed
  // 当前 stub 后端不消费该字段，先前端保存，接 LLM 时再透传。
  const [ideaSeed, setIdeaSeed] = useState<string>("");
  const [episodeDurationSec, setEpisodeDurationSec] = useState<number>(60);
  // 讲述风格（旁白 / 表演 / 混合）—— 仅在 outlineCopy.narrationStyle 存在时启用（教育故事、绘本）
  // 当前 stub 后端不消费；接 LLM 时透传，影响生成剧本结构。
  const [narrationStyle, setNarrationStyle] = useState<NarrationStyle>("mixed");
  // P0-2: 是否已进入"重新生成模式"（用户点小横条 → 展开大面板以覆盖式重生成）
  const [prefillReopen, setPrefillReopen] = useState<boolean>(false);

  const isDrama = project?.projectType === "drama";
  // A1: 按 contentType 选故事设定预设。project 未加载时默认走 world，避免面板闪空。
  const settingPreset = useMemo<StorySettingPresetMeta>(
    () =>
      project
        ? STORY_SETTING_PRESETS[
            CONTENT_TYPE_REGISTRY[project.contentType].storySettingPreset
          ]
        : STORY_SETTING_PRESETS.world,
    [project],
  );
  const isSeriesPreset = settingPreset.key === "series";
  // Stage 3 面板文案（分集大纲 / 故事列表 / 分册目录）按 contentType 分家族。
  const outlineCopy = useMemo(
    () => getOutlineCopy(project?.contentType),
    [project?.contentType],
  );
  // 长度字段（单集时长 / 每篇字数 / 每册页数）的默认值随 contentType 变化；
  // 生成数量的默认值（drama=3, story=1, picture_book=3 …）也在这里同步；
  // 讲述风格如果该 contentType 提供了配置，则同步到其 defaultValue。
  // 项目加载完成后同步一次，用户之后手动调整不再回退。
  useEffect(() => {
    if (project?.contentType) {
      setEpisodeDurationSec(outlineCopy.lengthField.defaultValue);
      setOutlineCount(outlineCopy.defaultCount);
      if (outlineCopy.narrationStyle) {
        setNarrationStyle(outlineCopy.narrationStyle.defaultValue);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.contentType]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    setAssetErr(null);
    try {
      const [p, b, e, chars, locs, propsList] = await Promise.all([
        projects.get(projectId),
        projects.storyBible(projectId).catch(() => null),
        projects.episodes(projectId),
        assets.listCharacters(projectId).catch(() => ({ items: [] })),
        assets.listLocations(projectId).catch(() => ({ items: [] })),
        assets.listProps(projectId).catch(() => ({ items: [] })),
      ]);
      setProject(p);
      setBible(b);
      // 用 project 上的 contentType 选 preset，再 seed edit state（world / series 通用字段一次填齐）
      const preset =
        STORY_SETTING_PRESETS[
          CONTENT_TYPE_REGISTRY[p.contentType].storySettingPreset
        ];
      setBibleEdit({
        logline: b?.logline ?? "",
        theme: b?.theme ?? "",
        tone: b?.tone ?? "",
        targetAudience: readByPath(b, "worldRules.targetAudience"),
        setting: readByPath(b, "worldRules.setting"),
      });
      setEpisodes(e.items);
      setAssetChars(chars.items);
      setAssetLocs(locs.items);
      setAssetProps(propsList.items);
      setBibleState(bibleHasContentForPreset(b, preset) ? "preview" : "empty");
      setOutlineState(e.items.length > 0 ? "preview" : "empty");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onGenerateBible() {
    if (!projectId) return;
    setBibleState("generating");
    setBibleGenErr(null);
    try {
      const b = await projects.generateStoryBible(projectId);
      setBible(b);
      setBibleEdit({
        logline: b.logline ?? "",
        theme: b.theme ?? "",
        tone: b.tone ?? "",
        targetAudience: readByPath(b, "worldRules.targetAudience"),
        setting: readByPath(b, "worldRules.setting"),
      });
      setBibleState("preview");
      // Story Bible 生成同时会落 characters / locations / props 资产 seeds，
      // 立即刷新面板 C 列表。用 catch 兜底，别把资产失败挡在故事圣经成功之外。
      try {
        const [chars, locs, propsList] = await Promise.all([
          assets.listCharacters(projectId),
          assets.listLocations(projectId),
          assets.listProps(projectId),
        ]);
        setAssetChars(chars.items);
        setAssetLocs(locs.items);
        setAssetProps(propsList.items);
      } catch (err) {
        setAssetErr(
          err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
        );
      }
    } catch (err) {
      setBibleGenErr(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      setBibleState("error");
    }
  }

  async function onSaveBible() {
    if (!bible) return;
    setBibleSaving(true);
    setError(null);
    try {
      // A1: 按 preset 决定 patch 载荷。
      // - world  preset: 保留原 logline/theme/tone 三个平铺字段的编辑（JSON blob 目前是只读预览，未来再做行级编辑）
      // - series preset: 关闭 logline 编辑，theme/tone 平铺 + worldRules.{targetAudience,setting}
      const patch: Partial<StoryBible> & { version: number } = {
        theme: bibleEdit.theme,
        tone: bibleEdit.tone,
        version: bible.version,
      };
      if (!isSeriesPreset) {
        patch.logline = bibleEdit.logline;
      }
      if (isSeriesPreset) {
        patch.worldRules = {
          ...(bible.worldRules ?? {}),
          targetAudience: bibleEdit.targetAudience,
          setting: bibleEdit.setting,
        };
      }
      const updated = await projects.patchStoryBible(bible.projectId, patch);
      setBible(updated);
      setBibleState("confirmed");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBibleSaving(false);
    }
  }

  function onRegenerateBible() {
    // 二次生成：清回 empty 并 UI 重新引导用户点「生成」，避免直接覆盖用户已改的稿件。
    setBibleState("empty");
  }

  // A1 修 Bug3：允许老项目/选错的项目在此变更 contentType，
  // 修完自动切换故事设定预设（world / series）+ 视觉风格预设默认值。
  const [changingContentType, setChangingContentType] = useState(false);
  const availableContentTypes = useMemo(
    () => (project ? contentTypesForProjectType(project.projectType) : []),
    [project],
  );

  async function onChangeContentType(next: ContentType) {
    if (!project || !projectId) return;
    if (next === project.contentType) return;
    const meta = CONTENT_TYPE_REGISTRY[next];
    const ok = window.confirm(
      `确认把「${project.name}」的内容形态改为「${meta.zh}」？\n\n` +
        `视觉风格会重置为该形态的默认预设（${meta.defaultVisualStylePresetKey}）；` +
        `故事设定字段会切换到「${STORY_SETTING_PRESETS[meta.storySettingPreset].label}」布局，` +
        `已生成内容不会被删除，但部分字段可能不再显示。`,
    );
    if (!ok) return;

    setChangingContentType(true);
    setError(null);
    try {
      await projects.update(projectId, {
        contentType: next,
        // 重置为该内容形态的默认视觉风格
        visualStyle: {},
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setChangingContentType(false);
    }
  }

  // 后台 LLM job：追加生成分集大纲。
  // - 用户点按钮 → POST 202 + { taskId } → 轮询直到 succeeded/failed
  // - 页面切走 / 刷新 → useAsyncJob 在 mount 时用 listBySource 查该 project 是否
  //   还有 queued/running 的 story_generate job，有就无缝续接、跑完自动刷新列表
  const outlineJob = useAsyncJob({
    entityType: "project",
    entityId: projectId ?? "",
    resumeOnMount: !!projectId,
    taskTypeFilter: ["story_generate"],
    onDone: async () => {
      if (!projectId) return;
      const res = await projects.episodes(projectId);
      setEpisodes(res.items);
    },
  });

  // 把 job 状态映射到本页原有的 outlineState 状态机，UI 结构完全不变。
  useEffect(() => {
    if (outlineJob.status === "running") {
      setOutlineState("generating");
      setOutlineGenErr(null);
    } else if (outlineJob.status === "succeeded") {
      setOutlineState("preview");
      setOutlineGenErr(null);
    } else if (outlineJob.status === "failed") {
      setOutlineState("error");
      setOutlineGenErr(outlineJob.error || "任务失败");
    }
  }, [outlineJob.status, outlineJob.error]);

  async function onGenerateOutline() {
    if (!projectId) return;
    await outlineJob.start(async () => {
      const ticket = await projects.generateEpisodeOutline(
        projectId,
        outlineCount,
        ideaSeed.trim() || undefined,
      );
      return ticket.taskId;
    });
  }

  // 单集删除：二次确认后调 DELETE /api/episodes/:id；后端会做级联清理。
  const [deletingEpisodeId, setDeletingEpisodeId] = useState<string | null>(null);
  async function onDeleteEpisode(ep: Episode) {
    if (!projectId) return;
    const confirmed = ep.storyStatus === "confirmed";
    const msg = confirmed
      ? `⚠️「${ep.title || "（未命名）"}」已确认单集，删除将同时清除该集下的场次 / 镜头 / 剧本 / 图片 / 视频等所有制作数据。\n\n此操作不可恢复，确认继续？`
      : `确认删除单集「${ep.title || "（未命名）"}」？\n\n该集下的场次 / 剧本 / 关键帧等数据会一并被清理。`;
    if (!window.confirm(msg)) return;
    setDeletingEpisodeId(ep.id);
    setError(null);
    try {
      await projects.deleteEpisode(ep.id);
      setEpisodes((prev) => {
        const next = prev.filter((e) => e.id !== ep.id);
        if (next.length === 0) setOutlineState("empty");
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setDeletingEpisodeId(null);
    }
  }

  // A2 迁移：把当前项目内所有 episode_id IS NULL 的角色 / 场景 / 道具改挂到指定分集。
  //   典型使用：series preset 收窄前生成的"错版"资产被落成项目级，需要一键挂到「本集」。
  //   后端由 AssetService.migrateProjectLevelAssetsToEpisode 事务处理。
  async function onMigrateProjectAssetsToEpisode() {
    if (!projectId) return;
    if (!migrateTargetEpId) {
      setMigrateErr("请先选择一个目标分集");
      return;
    }
    const target = episodes.find((e) => e.id === migrateTargetEpId);
    const okText = `将当前项目下所有「项目级」（尚未绑定分集的）角色 / 场景 / 道具全部迁移到「${target?.title || "（未命名）"}（第 ${target?.episodeNo ?? "?"} 集）」？\n\n执行后：\n- 这些资产在项目级面板中会消失\n- 出现在该分集详情页的「本集角色 & 场景」面板\n\n此操作可通过再次迁移到其他集来修正。确认继续？`;
    if (!window.confirm(okText)) return;
    setMigrating(true);
    setMigrateErr(null);
    setMigrateInfo(null);
    try {
      const res = await assets.migrateProjectLevelToEpisode(projectId, migrateTargetEpId);
      setMigrateInfo(
        `已迁移：角色 ${res.migrated.characters} · 场景 ${res.migrated.locations} · 道具 ${res.migrated.props}`,
      );
      // 刷新项目级资产列表，让面板 B 立刻反映"项目级已清空/减少"。
      try {
        const [chars, locs, propsList] = await Promise.all([
          assets.listCharacters(projectId),
          assets.listLocations(projectId),
          assets.listProps(projectId),
        ]);
        setAssetChars(chars.items);
        setAssetLocs(locs.items);
        setAssetProps(propsList.items);
      } catch {
        /* 迁移已成功；刷新失败不阻塞 */
      }
    } catch (err) {
      setMigrateErr(
        err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
      );
    } finally {
      setMigrating(false);
    }
  }

  const projectTypeBadge = useMemo(() => {
    if (!project) return null;
    return (
      <>
        <span className="tag">{outlineCopy.projectTypeBadge(isDrama)}</span>
        <span className="tag" style={{ marginLeft: 6 }}>
          {project.complianceMode === "domestic" ? "国内合规" : "出海合规"}
        </span>
      </>
    );
  }, [project, isDrama, outlineCopy]);

  // P0-1: 阶段进度栏 —— 由 workspace-stages 集中判定完成度
  const stages = useMemo(
    () =>
      computeWorkspaceStages({
        project,
        bible,
        episodes,
        active: "story_setting",
      }),
    [project, bible, episodes],
  );

  return (
    <WorkspaceShell
      stages={stages}
      title="Story Workspace"
      subtitle={
        <>
          {settingPreset.label} · {outlineCopy.panelTitle} · 生成式工作台
          {projectTypeBadge && <span style={{ marginLeft: 12 }}>{projectTypeBadge}</span>}
        </>
      }
    >
      <section className="card">
        <ProjectPicker value={projectId} onChange={setProjectId} />
        {!projectId && (
          <div className="muted" style={{ marginTop: 12 }}>
            请先选择一个项目（可从「
            <Link href="/">项目总览</Link>」点击项目行进入）。
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      {projectId && (
        <>
          {/* ===== 面板 A：项目「世界设定」/「系列设定」 —— 由 contentType 决定 ===== */}
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>
                项目{settingPreset.label}{" "}
                <span className="muted" style={{ fontWeight: "normal", fontSize: 13 }}>
                  {isSeriesPreset
                    ? `· ${project ? CONTENT_TYPE_REGISTRY[project.contentType].zh : ""} 每集独立，共享风格 / 受众 / 主题 / 背景`
                    : isDrama
                      ? "· 项目级共享，drama 跨集连续"
                      : "· 项目级共享底座，series 每集可独立细化"}
                </span>
              </h3>
              {project && availableContentTypes.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <span className="muted">内容形态：</span>
                  <select
                    value={project.contentType}
                    disabled={changingContentType}
                    onChange={(e) => onChangeContentType(e.target.value as ContentType)}
                    style={{ padding: "4px 8px", fontSize: 13 }}
                  >
                    {availableContentTypes.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.zh}
                      </option>
                    ))}
                  </select>
                  {changingContentType && <span className="muted">切换中…</span>}
                </div>
              )}
            </div>

            {bibleState === "empty" && (
              <div className="state-panel state-empty">
                <p style={{ marginTop: 0 }}>
                  🎬 {settingPreset.emptyHint}
                  <br />
                  <span className="muted">
                    未配置 Ark API Key 时走确定性 stub；已配置则走 Ark chat 生成。
                  </span>
                </p>
                <button type="button" className="btn" onClick={onGenerateBible}>
                  ✨ {settingPreset.generatorLabel}
                </button>
              </div>
            )}

            {bibleState === "generating" && (
              <div className="state-panel state-generating">
                <div>⏳ 正在生成{settingPreset.label}…</div>
                <div className="skeleton wide" style={{ marginTop: 12 }} />
                <div className="skeleton mid" />
                <div className="skeleton short" />
              </div>
            )}

            {bibleState === "error" && (
              <div className="state-panel state-error">
                <div>❌ 生成失败：{bibleGenErr}</div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 12 }}
                  onClick={onGenerateBible}
                >
                  🔁 重试
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => setBibleState("empty")}
                >
                  取消
                </button>
              </div>
            )}

            {(bibleState === "preview" || bibleState === "confirmed") && bible && (
              <>
                <div className="chip-row">
                  <span className="chip">来源：{bible.sourceRef?.origin ?? "manual"}</span>
                  {bible.sourceRef?.generatedAt && (
                    <span className="chip">生成于 {bible.sourceRef.generatedAt}</span>
                  )}
                  <span className="chip">v{bible.version}</span>
                  {bibleState === "confirmed" && <span className="chip">✅ 已保存</span>}
                </div>

                {/* ---- world preset：logline + theme + tone（原布局）---- */}
                {!isSeriesPreset && (
                  <>
                    <div className="form-row">
                      <label>Logline（一句话故事）</label>
                      <textarea
                        rows={2}
                        value={bibleEdit.logline}
                        onChange={(e) =>
                          setBibleEdit((s) => ({ ...s, logline: e.target.value }))
                        }
                      />
                    </div>
                    <div className="form-row">
                      <label>主题</label>
                      <input
                        value={bibleEdit.theme}
                        onChange={(e) => setBibleEdit((s) => ({ ...s, theme: e.target.value }))}
                      />
                    </div>
                    <div className="form-row">
                      <label>基调 / Tone</label>
                      <input
                        value={bibleEdit.tone}
                        onChange={(e) => setBibleEdit((s) => ({ ...s, tone: e.target.value }))}
                      />
                    </div>
                  </>
                )}

                {/* ---- series preset：风格基调 / 目标受众 / 核心主题 / 背景设定 ---- */}
                {isSeriesPreset && (
                  <>
                    <div className="form-row">
                      <label>风格基调</label>
                      <input
                        value={bibleEdit.tone}
                        onChange={(e) => setBibleEdit((s) => ({ ...s, tone: e.target.value }))}
                        placeholder="整体的情绪调性与讲述方式"
                      />
                    </div>
                    <div className="form-row">
                      <label>目标受众</label>
                      <input
                        value={bibleEdit.targetAudience}
                        onChange={(e) =>
                          setBibleEdit((s) => ({ ...s, targetAudience: e.target.value }))
                        }
                        placeholder="年龄段 / 兴趣画像 / 知识水平"
                      />
                    </div>
                    <div className="form-row">
                      <label>核心主题</label>
                      <input
                        value={bibleEdit.theme}
                        onChange={(e) => setBibleEdit((s) => ({ ...s, theme: e.target.value }))}
                        placeholder="希望每集围绕/回归的价值内核"
                      />
                    </div>
                    <div className="form-row">
                      <label>背景设定</label>
                      <textarea
                        rows={2}
                        value={bibleEdit.setting}
                        onChange={(e) =>
                          setBibleEdit((s) => ({ ...s, setting: e.target.value }))
                        }
                        placeholder="共通的时代 / 世界 / 角色底色"
                      />
                    </div>
                  </>
                )}

                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={onSaveBible}
                    disabled={bibleSaving}
                  >
                    {bibleSaving ? "保存中…" : "💾 保存修改"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginLeft: 8 }}
                    onClick={onRegenerateBible}
                    title="重新走一遍生成流程；不会覆盖当前保存的稿件，除非再次点击「生成」"
                  >
                    🔄 重新生成
                  </button>
                </div>
              </>
            )}

            {/* world preset 才展示戏剧密度重字段的只读预览；series preset 隐藏这块噪音 */}
            {!isSeriesPreset &&
              (bibleState === "preview" || bibleState === "confirmed") &&
              bible && (
                <details style={{ marginTop: 16 }}>
                  <summary className="muted">查看 world / hook / pacing / villain / relations</summary>
                  <pre style={{ fontSize: 12, overflow: "auto" }}>
                    {JSON.stringify(
                      {
                        worldRules: bible.worldRules,
                        hookSystem: bible.hookSystem,
                        pacingPlan: bible.pacingPlan,
                        villainSystem: bible.villainSystem,
                        characterRelations: bible.characterRelations,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
          </section>

          {/* ===== 面板 B：角色 & 场景（Story Bible seeds → 拆场次/关键帧复用） =====
              A2：项目级面板只显示 episodeId 为空的"项目级共用资产"。
                  drama → 全部资产都在这里；
                  series → 通常只有系列包装级（主持人 / mascot / IP 视觉锁），
                            每集专属资产改在分集详情页展示。 */}
          <section className="card">
            <h3>
              角色 &amp; 场景{" "}
              <span className="muted" style={{ fontWeight: "normal", fontSize: 13 }}>
                （
                {project?.projectType === "series"
                  ? "系列级共用资产（主持人 / mascot / 品牌锁）；每集角色 / 场景 / 道具在分集详情页维护"
                  : "Story Bible 生成的资产 seeds，用于分集大纲、拆场次和关键帧生成；visualLock 保证跨镜头一致"}
                ）
              </span>
            </h3>

            {assetErr && <div className="error-inline">资产加载失败：{assetErr}</div>}

            {/* A2 迁移入口：series preset 收窄前生成的错版资产（本应绑定到某集，却被写成项目级）
                可通过下面的选择器批量迁移到指定分集。
                展示条件：series 项目 + 至少 1 个项目级资产 + 至少 1 个已生成的分集。 */}
            {project?.projectType === "series" &&
              episodes.length > 0 &&
              (assetChars.some((c) => !c.episodeId) ||
                assetLocs.some((l) => !l.episodeId) ||
                assetProps.some((p) => !p.episodeId)) && (
                <div
                  className="callout"
                  style={{
                    border: "1px dashed #d0d7de",
                    borderRadius: 6,
                    padding: 12,
                    margin: "8px 0 12px",
                    background: "#fafbfc",
                  }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 6 }}>
                    检测到项目级资产
                    <span
                      className="muted"
                      style={{ fontWeight: "normal", marginLeft: 8, fontSize: 12 }}
                    >
                      （选集剧下这些资产通常应该绑定到某一集，而不是项目级共用）
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    如果这些资产实际上只属于某一集（比如「画蛇添足」的角色 / 场景），
                    可以一键迁移到目标分集。迁移后会显示在该分集详情页的「本集角色 &amp; 场景」面板。
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <select
                      value={migrateTargetEpId}
                      onChange={(e) => setMigrateTargetEpId(e.target.value)}
                      disabled={migrating}
                      style={{ minWidth: 240 }}
                    >
                      <option value="">选择目标分集…</option>
                      {episodes.map((e) => (
                        <option key={e.id} value={e.id}>
                          第 {e.episodeNo} 集 · {e.title || "（未命名）"}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      onClick={onMigrateProjectAssetsToEpisode}
                      disabled={migrating || !migrateTargetEpId}
                    >
                      {migrating ? "迁移中…" : "迁移到该集"}
                    </button>
                  </div>
                  {migrateErr && (
                    <div className="error-inline" style={{ marginTop: 8 }}>
                      迁移失败：{migrateErr}
                    </div>
                  )}
                  {migrateInfo && (
                    <div
                      className="muted"
                      style={{ marginTop: 8, color: "#1a7f37" }}
                    >
                      ✅ {migrateInfo}
                    </div>
                  )}
                </div>
              )}

            {(() => {
              const projectChars = assetChars.filter((c) => !c.episodeId);
              const projectLocs = assetLocs.filter((l) => !l.episodeId);
              const projectProps2 = assetProps.filter((p) => !p.episodeId);
              const empty =
                projectChars.length === 0 &&
                projectLocs.length === 0 &&
                projectProps2.length === 0;
              if (empty) {
                return (
                  <div className="muted" style={{ padding: "12px 0" }}>
                    {project?.projectType === "series"
                      ? "本项目为选集剧 / 单元合集：项目级资产通常只保留跨集共用的极少部分（主持人、系列 mascot 等）。每集专属的角色 / 场景 / 道具请到「分集大纲」的单集详情页生成。"
                      : "暂无资产。生成故事圣经后会自动写入角色 / 场景 / 道具 seeds，也可以进入面板 A 生成/重生。"}
                  </div>
                );
              }
              return (
                <div className="asset-panel">
                  <AssetGroup
                    title="角色"
                    emptyLabel="尚无角色"
                    items={projectChars.map((c) => ({
                      id: c.id,
                      name: c.name,
                      type: c.roleType,
                      detail: c.personality,
                      visualLock: c.visualLock,
                    }))}
                  />
                  <AssetGroup
                    title="场景"
                    emptyLabel="尚无场景"
                    items={projectLocs.map((l) => ({
                      id: l.id,
                      name: l.name,
                      type: l.locationType,
                      detail:
                        typeof l.visualSpec?.atmosphere === "string"
                          ? (l.visualSpec.atmosphere as string)
                          : undefined,
                      visualLock: l.visualLock,
                    }))}
                  />
                  <AssetGroup
                    title="道具"
                    emptyLabel="尚无道具"
                    items={projectProps2.map((p) => ({
                      id: p.id,
                      name: p.name,
                      type: p.propType,
                      detail:
                        typeof p.continuityRules?.purpose === "string"
                          ? (p.continuityRules.purpose as string)
                          : undefined,
                      visualLock: p.visualLock,
                    }))}
                  />
                </div>
              );
            })()}
          </section>

          {/* ===== 面板 C：分集大纲 / 故事列表 / 分册目录 ===== */}
          <section className="card">
            <h3>
              {outlineCopy.panelTitle}{" "}
              <span className="muted" style={{ fontWeight: "normal", fontSize: 13 }}>
                {outlineCopy.panelSubline(isDrama)}
              </span>
            </h3>

            {outlineState === "empty" && (
              <div className="prefill-hero">
                <div className="prefill-hero-title">
                  {outlineCopy.heroTitle(isDrama)}
                </div>
                <div className="prefill-hero-desc">
                  {outlineCopy.heroDesc({
                    count: outlineCount,
                    settingLabel: settingPreset.label,
                    isDrama,
                  })}
                </div>
                <textarea
                  className="prefill-hero-idea"
                  value={ideaSeed}
                  onChange={(e) => setIdeaSeed(e.target.value)}
                  placeholder={outlineCopy.ideaPlaceholder}
                />
                <div className="prefill-hero-controls">
                  <div className="form-row" style={{ margin: 0 }}>
                    <label>{outlineCopy.countLabel}</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={outlineCount}
                      onChange={(e) => setOutlineCount(Number(e.target.value) || 1)}
                      style={{ maxWidth: 100 }}
                    />
                  </div>
                  <div className="form-row" style={{ margin: 0 }}>
                    <label>{outlineCopy.lengthField.label}</label>
                    <select
                      value={episodeDurationSec}
                      onChange={(e) => setEpisodeDurationSec(Number(e.target.value))}
                      style={{ maxWidth: 160 }}
                    >
                      {outlineCopy.lengthField.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {outlineCopy.narrationStyle && (
                    <div className="form-row" style={{ margin: 0 }}>
                      <label>{outlineCopy.narrationStyle.label}</label>
                      <select
                        value={narrationStyle}
                        onChange={(e) => setNarrationStyle(e.target.value as NarrationStyle)}
                        style={{ maxWidth: 160 }}
                        title={
                          outlineCopy.narrationStyle.options.find(
                            (o) => o.value === narrationStyle,
                          )?.desc ?? ""
                        }
                      >
                        {outlineCopy.narrationStyle.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    className="prefill-hero-cta"
                    onClick={onGenerateOutline}
                  >
                    {outlineCopy.ctaLabel(outlineCount)}
                  </button>
                </div>
                {outlineCopy.narrationStyle && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    💬 {outlineCopy.narrationStyle.hint}
                    <br />
                    当前风格：
                    <strong>
                      {outlineCopy.narrationStyle.options.find(
                        (o) => o.value === narrationStyle,
                      )?.label}
                    </strong>{" "}
                    ——{" "}
                    {outlineCopy.narrationStyle.options.find(
                      (o) => o.value === narrationStyle,
                    )?.desc}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 12 }}>
                  {outlineCopy.stubHint}
                </div>
              </div>
            )}

            {outlineState === "generating" && (
              <div className="state-panel state-generating">
                <div>⏳ 正在生成 {outlineCount} {outlineCopy.countUnit}…</div>
                {Array.from({ length: outlineCount }).map((_, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <div className="skeleton short" />
                    <div className="skeleton wide" />
                  </div>
                ))}
              </div>
            )}

            {outlineState === "error" && (
              <div className="state-panel state-error">
                <div>❌ 生成失败：{outlineGenErr}</div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 12 }}
                  onClick={onGenerateOutline}
                >
                  🔁 重试
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => setOutlineState("empty")}
                >
                  取消
                </button>
              </div>
            )}

            {outlineState === "preview" && (
              <>
                {prefillReopen ? (
                  <div className="prefill-hero" style={{ marginBottom: 16 }}>
                    <div className="prefill-hero-title">{outlineCopy.reopenTitle}</div>
                    <div className="prefill-hero-desc">
                      {outlineCopy.reopenDesc(episodes.length)}
                    </div>
                    <textarea
                      className="prefill-hero-idea"
                      value={ideaSeed}
                      onChange={(e) => setIdeaSeed(e.target.value)}
                      placeholder={outlineCopy.reopenIdeaPlaceholder}
                    />
                    <div className="prefill-hero-controls">
                      <div className="form-row" style={{ margin: 0 }}>
                        <label>{outlineCopy.reopenCountLabel}</label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={outlineCount}
                          onChange={(e) =>
                            setOutlineCount(Number(e.target.value) || 1)
                          }
                          style={{ maxWidth: 100 }}
                        />
                      </div>
                      <button
                        type="button"
                        className="prefill-hero-cta"
                        onClick={() => {
                          setPrefillReopen(false);
                          onGenerateOutline();
                        }}
                      >
                        {outlineCopy.reopenCtaLabel(outlineCount)}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setPrefillReopen(false)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="prefill-bar">
                    <span>
                      🪄{" "}
                      {outlineCopy.generatedSummary(
                        episodes.length,
                        isDrama,
                        settingPreset.label,
                      )}
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => setPrefillReopen(true)}>
                        {outlineCopy.reopenTriggerLabel}
                      </button>
                    </div>
                  </div>
                )}

                <div className="episode-grid" style={{ marginTop: 12 }}>
                  {episodes.map((ep) => {
                    const lights = computeEpisodeLights(ep);
                    const cta = computeEpisodeCta(ep);
                    const badge = outlineCopy.itemBadge(ep.episodeNo);
                    return (
                      <div key={ep.id} className="episode-card">
                        <div className="episode-card-header">
                          <span className="episode-badge">{badge}</span>
                          <div className="episode-title">{ep.title || "（未命名）"}</div>
                          <button
                            type="button"
                            className="episode-card-delete"
                            title={
                              ep.storyStatus === "confirmed"
                                ? "删除已确认单集（会清理下游场次 / 剧本 / 关键帧）"
                                : "删除该单集"
                            }
                            disabled={deletingEpisodeId === ep.id}
                            onClick={() => onDeleteEpisode(ep)}
                          >
                            {deletingEpisodeId === ep.id ? "…" : "🗑"}
                          </button>
                        </div>
                        <div className="episode-summary">
                          {ep.episodeGoal ||
                            ep.episodeConflict ||
                            ep.episodeEndingHook ||
                            outlineCopy.emptySummary}
                        </div>
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
                        <div className="episode-card-footer">
                          <span className="muted" style={{ fontSize: 12 }}>
                            {outlineCopy.scriptStatusLabel(
                              ep.storyStatus === "confirmed",
                            )}
                          </span>
                          <Link
                            href={cta.href}
                            className={`episode-card-cta episode-card-cta-${cta.variant}`}
                          >
                            {cta.label}
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </WorkspaceShell>
  );
}

/**
 * 通用资产组渲染：角色 / 场景 / 道具 复用同一张卡片布局。
 */
function AssetGroup({
  title,
  emptyLabel,
  items,
}: {
  title: string;
  emptyLabel: string;
  items: Array<{
    id: string;
    name: string;
    type?: string;
    detail?: string;
    visualLock?: string;
  }>;
}) {
  return (
    <div className="asset-group">
      <h4 style={{ margin: "8px 0" }}>
        {title} <span className="muted" style={{ fontWeight: "normal", fontSize: 12 }}>·{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>{emptyLabel}</div>
      ) : (
        <div className="asset-grid">
          {items.map((it) => (
            <div key={it.id} className="asset-card">
              <div className="asset-card-title">
                <strong>{it.name}</strong>
                {it.type && <span className="asset-tag">{it.type}</span>}
              </div>
              {it.detail && <div className="asset-card-desc muted">{it.detail}</div>}
              {it.visualLock && (
                <div className="asset-card-visual-lock">
                  <span className="asset-visual-lock-label">visualLock</span>
                  <span>{it.visualLock}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
