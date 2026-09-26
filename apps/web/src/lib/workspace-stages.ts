/**
 * Workspace stages — 6-step linear pipeline shared by Story Workspace / Episode Workspace.
 *
 * 阶段栏的展示、路由与完成状态都在这里集中判定。页面只负责把加载好的
 * project / bible / episodes 递进来 + 声明当前阶段。
 *
 * P0-1 (workflow-refactor v1)
 */

import {
  CONTENT_TYPE_REGISTRY,
  STORY_SETTING_PRESETS,
  type ContentType,
  type Project,
  type StoryBible,
  type Episode,
} from "./api";

export type WorkspaceStageKey =
  | "project_setup"
  | "story_setting"
  | "episode_outline"
  | "scene_keyframe"
  | "prompt"
  | "export";

export type StageStatus = "todo" | "in_progress" | "done";

export interface ComputedStage {
  key: WorkspaceStageKey;
  index: number; // 1..6, 用于阶段栏编号
  label: string;
  hint?: string;
  status: StageStatus;
  /** null = 当前不可点击（如 Stage 4 需要先选定一集） */
  href: string | null;
}

/**
 * Stage 4 的名字随 contentType 变化 —— 漫画/漫剧叫「分镜插图」、
 * 绘本叫「插图生成」，纪录短片叫「分场素材」，其它默认「分场关键帧」。
 */
export function stage4LabelFor(contentType: ContentType | undefined): string {
  switch (contentType) {
    case "picture_book":
      return "插图生成";
    case "comic":
      return "分镜插图";
    case "motion_comic":
      return "分镜动效";
    case "documentary":
      return "分场素材";
    case "educational_story":
      return "分场插画";
    default:
      return "分场关键帧";
  }
}

/**
 * Stage 2 的名字随 contentType 上挂的 storySettingPreset 变化：
 * world → 「故事设定」（世界设定），series → 「系列设定」。
 */
export function stage2LabelFor(contentType: ContentType | undefined): string {
  if (!contentType) return "故事设定";
  const presetKey = CONTENT_TYPE_REGISTRY[contentType]?.storySettingPreset;
  const preset = presetKey ? STORY_SETTING_PRESETS[presetKey] : null;
  return preset?.label ?? "故事设定";
}

/**
 * Stage 3 名字随 contentType 变化：
 *   成语 / 短故事 → 「故事列表」
 *   绘本         → 「分册目录」
 *   其他（含 drama/animation/motion_comic/comic/documentary） → 「分集大纲」
 * Stage 3 的所有 UI 文案入口都走 getOutlineCopy(contentType)。
 */
export function stage3LabelFor(contentType: ContentType | undefined): string {
  switch (contentType) {
    case "educational_story":
      return "故事列表";
    case "picture_book":
      return "分册目录";
    default:
      return "分集大纲";
  }
}

// ==== Outline hero copy (Stage 3 面板文案) ====
//
// educational_story / picture_book / documentary 与传统 drama 家族的产品心智完全不同，
// 「分集大纲 · 单集时长 · 60 秒常规短剧」这种影视化术语套过去很别扭。
// 这里按 contentType 分家族返回一整套面板文案（标题 / 描述 / 输入 placeholder /
// 集数单位 / 长度字段 / CTA），story/page.tsx 只做消费。

export interface OutlineLengthOption {
  value: number;
  label: string;
}

export interface OutlineCopy {
  /** 面板 h3 标题（分集大纲 / 故事列表 / 分册目录） */
  panelTitle: string;
  /** 面板 h3 副标题（小灰字），用于点明本内容形态的心智 */
  panelSubline: (isDrama: boolean) => string;
  /** hero 大标题（含 emoji） */
  heroTitle: (isDrama: boolean) => string;
  /** hero 说明段（会拿到 count + settingLabel） */
  heroDesc: (opts: { count: number; settingLabel: string; isDrama: boolean }) => string;
  /** textarea placeholder */
  ideaPlaceholder: string;
  /** 集数字段 label（生成集数 / 生成篇数 / 生成册数） */
  countLabel: string;
  /** 计数单位（集 / 篇 / 册） */
  countUnit: string;
  /** 长度字段（时长/页数/字数）；短剧走秒，绘本走页数，故事走字数 */
  lengthField: {
    label: string;
    options: OutlineLengthOption[];
    defaultValue: number;
  };
  /** 主 CTA 文案（"一键生成 N X"） */
  ctaLabel: (count: number) => string;
  /** 追加区块 —— 已生成态下的小横条按钮 */
  reopenTriggerLabel: string;
  /** 追加区块 —— 展开后的 hero title */
  reopenTitle: string;
  /** 追加区块 —— 展开后的描述 */
  reopenDesc: (existing: number) => string;
  /** 追加区块 —— idea textarea placeholder */
  reopenIdeaPlaceholder: string;
  /** 追加区块 —— 数量字段 label（本次追加 X 数） */
  reopenCountLabel: string;
  /** 追加区块 —— 主 CTA */
  reopenCtaLabel: (count: number) => string;
  /** 已生成态小横条上的摘要（"N X 草案已生成"） */
  generatedSummary: (count: number, isDrama: boolean, settingLabel: string) => string;
  /** stub 备注 —— 未接 LLM 时的说明脚注（可选） */
  stubHint: string;
  /** 卡片上的编号前缀（EP / 篇 / 册） */
  itemPrefix: string;
  /** 完整的项目条目 badge（如 EP01 / 第 1 篇 / 第 1 册） */
  itemBadge: (episodeNo: number) => string;
  /** 项目类型 badge，Dashboard 与 Workspace subtitle 用 */
  projectTypeBadge: (isDrama: boolean) => string;
  /** 单条项目的量词：本集 / 本篇 / 本册 / 本话，供 Episode Workspace 复用 */
  episodeNoun: string;
  /** 子节点（原 Scene）的量词：场次 / 分节 / 跨页 / 分场 / 分镜，供 Storyboard 复用 */
  sceneNoun: string;
  /** 子节点单条 badge（如 S01 / 节 1 / 跨页 1） */
  sceneBadge: (sceneNo: number) => string;
  /** 视觉产物量词：关键帧 / 插画 / 插图 / 分镜画，供 Stage 4/5 复用 */
  keyframeNoun: string;
  /** 卡片 footer 的剧本 / 故事 / 本册 状态文案 */
  scriptStatusLabel: (confirmed: boolean) => string;
  /** 单集"剧本"版块的整体命名：drama→本集剧本 / story→本篇故事 / book→本册内容 */
  scriptSectionLabel: string;
  /** 单集剧本 4 字段（标题 / 目标 / 冲突 / 结尾钩子）的家族化 label + placeholder */
  scriptFields: {
    title: { label: string; placeholder: string };
    goal: { label: string; placeholder: string };
    conflict: { label: string; placeholder: string };
    endingHook: { label: string; placeholder: string };
  };
  /** 卡片 summary 为空时的 fallback 文案 */
  emptySummary: string;
  /** 本内容形态在 Stage 3 面板"生成 X 数"字段的默认值（覆盖 UI state 初始值） */
  defaultCount: number;
  /**
   * 讲述风格（可选）——旁白叙述 / 角色表演 / 混合。
   * 仅在教育故事、绘本等以叙述文本为主的内容形态里暴露；未提供则不渲染。
   * 影响后续 AI 生成剧本时的结构：
   *   - narration → 只出旁白文案
   *   - acting   → 只出对话台词
   *   - mixed    → 旁白 + 对话
   * 当前 stub 后端不消费该字段，前端保存，接 LLM 时再透传。
   */
  narrationStyle?: {
    label: string;
    hint: string;
    options: {
      value: NarrationStyle;
      label: string;
      desc: string;
    }[];
    defaultValue: NarrationStyle;
  };
}

export type NarrationStyle = "narration" | "acting" | "mixed";

const NARRATION_STYLE_FOR_STORY: OutlineCopy["narrationStyle"] = {
  label: "讲述风格",
  hint: "决定 AI 生成的正文以旁白为主还是对话为主。可以随时切换后再重新生成。",
  options: [
    {
      value: "narration",
      label: "旁白叙述",
      desc: "全篇以第三人称叙述文本推进，适合朗读 / 有声书 / 说故事。",
    },
    {
      value: "acting",
      label: "角色表演",
      desc: "全篇以角色对话与动作台词推进，适合角色扮演 / 配音练习。",
    },
    {
      value: "mixed",
      label: "混合",
      desc: "旁白 + 角色对话交替推进，适合成语故事 / 绘本情景演绎。",
    },
  ],
  defaultValue: "mixed",
};

const LENGTH_FIELD_SECONDS = {
  label: "单集时长（秒）",
  options: [
    { value: 30, label: "30 秒 · 短竖屏" },
    { value: 60, label: "60 秒 · 常规短剧" },
    { value: 90, label: "90 秒 · 微短剧" },
    { value: 180, label: "3 分钟 · 长条" },
    { value: 300, label: "5 分钟 · 单元剧" },
  ],
  defaultValue: 60,
};

const LENGTH_FIELD_DOC_SECONDS = {
  label: "每集时长（分钟）",
  options: [
    { value: 180, label: "3 分钟 · 短记录" },
    { value: 300, label: "5 分钟 · 短纪录" },
    { value: 600, label: "10 分钟 · 常规" },
    { value: 1500, label: "25 分钟 · 长纪录" },
  ],
  defaultValue: 300,
};

const LENGTH_FIELD_STORY_WORDS = {
  label: "每篇长度（字）",
  options: [
    { value: 300, label: "短 · 约 300 字（幼儿共读）" },
    { value: 600, label: "中 · 约 600 字（小学低年级）" },
    { value: 1200, label: "长 · 约 1200 字（小学高年级+）" },
  ],
  defaultValue: 600,
};

const LENGTH_FIELD_BOOK_PAGES = {
  label: "每册页数",
  options: [
    { value: 8, label: "8 页 · 迷你册" },
    { value: 12, label: "12 页 · 常规" },
    { value: 16, label: "16 页 · 标准绘本" },
    { value: 24, label: "24 页 · 长绘本" },
  ],
  defaultValue: 12,
};

const OUTLINE_COPY_DRAMA: OutlineCopy = {
  panelTitle: "分集大纲",
  panelSubline: (isDrama) =>
    isDrama ? "· 连续剧：跨集主线一致，集尾抛钩子" : "· 选集剧：每集独立主角与主题",
  heroTitle: (isDrama) => `🎬 一句话开始你的${isDrama ? "连续剧" : "选集剧"}`,
  heroDesc: ({ count, settingLabel, isDrama }) =>
    `告诉我你想讲一个什么故事——一句 logline / 一个人物设定 / 一段冲突，AI 会顺着${settingLabel}，直接生成 ${count} 集分集大纲草案；生成后你逐集微调即可，跳过"逐个字段手填"。${
      isDrama ? "" : "（选集剧每集独立，AI 会保证各集角色/风格一致但故事互不相干）"
    }`,
  ideaPlaceholder:
    "例如：一名过气短视频编剧被算法困住，直到遇见能改写他脚本的神秘女主播。",
  countLabel: "生成集数",
  countUnit: "集",
  lengthField: LENGTH_FIELD_SECONDS,
  ctaLabel: (n) => `✨ 一键生成 ${n} 集分集大纲`,
  reopenTriggerLabel: "➕ 追加更多集数",
  reopenTitle: "🔁 追加生成分集大纲",
  reopenDesc: (n) =>
    `当前已有 ${n} 集草案。修改想法或调整集数后，再次生成会**追加**新的集次到列表末尾（不会覆盖已有集数）；如需完全重来，请先手动删除现有集数。`,
  reopenIdeaPlaceholder: "补充新的支线人物 / 新的钩子 / 新的反派…",
  reopenCountLabel: "本次追加集数",
  reopenCtaLabel: (n) => `✨ 追加生成 ${n} 集`,
  generatedSummary: (n, isDrama, settingLabel) =>
    `${n} 集草案已生成 · ${isDrama ? "连续剧" : "选集剧"} · ${settingLabel}`,
  stubHint:
    "💡 未配置 Ark API Key 时走确定性 stub 生成；接入 LLM 后 idea / 时长会作为 prompt 关键参数。",
  itemPrefix: "EP",
  itemBadge: (n) => `EP${String(n).padStart(2, "0")}`,
  projectTypeBadge: (isDrama) =>
    isDrama ? "连续剧 · drama" : "选集剧 · series",
  episodeNoun: "本集",
  sceneNoun: "场次",
  sceneBadge: (n) => `S${String(n).padStart(2, "0")}`,
  keyframeNoun: "关键帧",
  scriptStatusLabel: (confirmed) => (confirmed ? "剧本已确认" : "剧本待确认"),
  scriptSectionLabel: "本集剧本",
  scriptFields: {
    title: { label: "本集标题", placeholder: "给这一集起个短标题" },
    goal: { label: "本集目标", placeholder: "主角这一集想解决什么？" },
    conflict: { label: "本集冲突", placeholder: "谁 / 什么在阻拦？关键困难在哪？" },
    endingHook: {
      label: "结尾钩子",
      placeholder: "留一个让观众想追下一集的收尾",
    },
  },
  emptySummary: "尚无梗概，进入本集后 AI 会先补齐剧本。",
  defaultCount: 3,
};

const OUTLINE_COPY_ANIMATION: OutlineCopy = {
  ...OUTLINE_COPY_DRAMA,
  heroTitle: (isDrama) => `🎞️ 一句话开始你的${isDrama ? "系列动画" : "选集动画"}`,
  ideaPlaceholder:
    "例如：一个爱打呼噜的小龙住在云端，每集去帮不同小动物解决麻烦。",
  projectTypeBadge: (isDrama) =>
    isDrama ? "系列动画 · drama" : "单元动画 · series",
  sceneNoun: "分场",
  keyframeNoun: "关键画面",
};

const OUTLINE_COPY_MOTION_COMIC: OutlineCopy = {
  ...OUTLINE_COPY_DRAMA,
  heroTitle: (isDrama) => `💥 一句话开始你的${isDrama ? "连续动态漫画" : "单元动态漫画"}`,
  ideaPlaceholder:
    "例如：都市异能，男主每次读心都会失去一段自己的记忆…",
  projectTypeBadge: (isDrama) =>
    isDrama ? "连续动态漫画 · drama" : "单元动态漫画 · series",
  sceneNoun: "分镜",
  keyframeNoun: "分镜动效关键帧",
};

const OUTLINE_COPY_COMIC: OutlineCopy = {
  ...OUTLINE_COPY_DRAMA,
  heroTitle: (isDrama) => `📖 一句话开始你的${isDrama ? "长篇漫画" : "单元漫画"}`,
  ideaPlaceholder: "例如：以宋代汴京为背景，讲一群少年破案的故事…",
  projectTypeBadge: (isDrama) =>
    isDrama ? "长篇漫画 · drama" : "单元漫画 · series",
  sceneNoun: "分镜",
  sceneBadge: (n) => `分镜 ${String(n).padStart(2, "0")}`,
  keyframeNoun: "分镜画",
  scriptSectionLabel: "本话剧本",
  episodeNoun: "本话",
  itemBadge: (n) => `第 ${n} 话`,
  itemPrefix: "话",
  scriptStatusLabel: (confirmed) => (confirmed ? "本话剧本已确认" : "本话剧本待确认"),
};

const OUTLINE_COPY_DOCUMENTARY: OutlineCopy = {
  panelTitle: "分集大纲",
  panelSubline: () => "· 每集聚焦一个人物 / 事件切片",
  heroTitle: () => "🎥 一句话告诉我这系列纪录片讲什么",
  heroDesc: ({ count, settingLabel }) =>
    `一句选题 / 一组人物 / 一段社会切片。AI 会顺着${settingLabel}，产出 ${count} 集分集大纲草案（含选题、人物、时间线钩子）。`,
  ideaPlaceholder: "例如：记录北京胡同里最后一批鸽哨手艺人；每集聚焦一位手艺人的一个日常切片。",
  countLabel: "生成集数",
  countUnit: "集",
  lengthField: LENGTH_FIELD_DOC_SECONDS,
  ctaLabel: (n) => `✨ 一键生成 ${n} 集分集大纲`,
  reopenTriggerLabel: "➕ 追加更多集",
  reopenTitle: "🔁 追加生成分集大纲",
  reopenDesc: (n) =>
    `当前已有 ${n} 集草案。追加会把新集拼到末尾，不覆盖已有集数。`,
  reopenIdeaPlaceholder: "补充新的选题 / 新的人物 / 新的切片…",
  reopenCountLabel: "本次追加集数",
  reopenCtaLabel: (n) => `✨ 追加生成 ${n} 集`,
  generatedSummary: (n, _isDrama, settingLabel) =>
    `${n} 集纪录草案已生成 · ${settingLabel}`,
  stubHint:
    "💡 未接 LLM 时使用确定性 stub 生成；接入后 idea / 单集时长会作为 prompt 关键参数。",
  itemPrefix: "EP",
  itemBadge: (n) => `EP${String(n).padStart(2, "0")}`,
  projectTypeBadge: (isDrama) =>
    isDrama ? "系列纪录 · drama" : "单集纪录 · series",
  episodeNoun: "本集",
  sceneNoun: "分场",
  sceneBadge: (n) => `分场 ${String(n).padStart(2, "0")}`,
  keyframeNoun: "分场素材",
  scriptStatusLabel: (confirmed) => (confirmed ? "分集剧本已确认" : "分集剧本待确认"),
  scriptSectionLabel: "本集分集本",
  scriptFields: {
    title: { label: "本集标题", placeholder: "为这一集定一个标题" },
    goal: { label: "本集选题", placeholder: "本集想聚焦的人物 / 事件 / 议题" },
    conflict: { label: "冲突 / 矛盾", placeholder: "现实中的冲突 / 反差 / 悬念在哪？" },
    endingHook: {
      label: "结尾余味",
      placeholder: "本集想让观众留下什么问题 / 情绪 / 观点？",
    },
  },
  emptySummary: "尚无梗概，进入本集后 AI 会先补齐分集本。",
  defaultCount: 3,
};

const OUTLINE_COPY_STORY: OutlineCopy = {
  panelTitle: "故事列表",
  panelSubline: () => "· 每篇独立寓意，可自由挑选 / 追加",
  heroTitle: () => "📚 一句话告诉我这套系列想讲哪些故事",
  heroDesc: ({ count, settingLabel }) =>
    `列出你想改编的成语 / 童话 / 民间故事，或写一句系列主线。AI 会顺着${settingLabel}，直接生成 ${count} 篇独立故事草案，每篇有主角、寓意与结尾金句。`,
  ideaPlaceholder:
    "例如：守株待兔、刻舟求剑、愚公移山、亡羊补牢、画蛇添足、揠苗助长…（一行一个 / 逗号分隔都行）",
  countLabel: "生成篇数",
  countUnit: "篇",
  lengthField: LENGTH_FIELD_STORY_WORDS,
  ctaLabel: (n) => `✨ 一键生成 ${n} 篇故事大纲`,
  reopenTriggerLabel: "➕ 追加更多故事",
  reopenTitle: "🔁 追加生成故事",
  reopenDesc: (n) =>
    `当前已有 ${n} 篇草案。追加会把新故事拼到末尾，已生成的不会被覆盖。`,
  reopenIdeaPlaceholder: "补充新的成语 / 新的主题 / 新的故事名…",
  reopenCountLabel: "本次追加篇数",
  reopenCtaLabel: (n) => `✨ 追加生成 ${n} 篇`,
  generatedSummary: (n, _isDrama, settingLabel) =>
    `${n} 篇故事草案已生成 · ${settingLabel}`,
  stubHint:
    "💡 未接 LLM 时走确定性 stub（内置成语/民间故事池）；接入后 idea / 每篇长度会作为 prompt 关键参数。",
  itemPrefix: "第",
  itemBadge: (n) => `第 ${n} 篇`,
  projectTypeBadge: (isDrama) =>
    isDrama ? "系列故事 · drama" : "系列故事 · series",
  episodeNoun: "本篇",
  sceneNoun: "段落",
  sceneBadge: (n) => `段落 ${n}`,
  keyframeNoun: "插画",
  scriptStatusLabel: (confirmed) => (confirmed ? "本篇已确认" : "本篇待确认"),
  scriptSectionLabel: "本篇故事",
  scriptFields: {
    title: { label: "故事标题", placeholder: "例如：守株待兔 · 农夫的选择" },
    goal: { label: "寓意目标", placeholder: "想让小读者懂得什么？" },
    conflict: {
      label: "情节冲突 / 误区",
      placeholder: "主角遇到了什么问题？走了哪些弯路？",
    },
    endingHook: {
      label: "结尾金句",
      placeholder: "用一句话点出寓意（可以是道理、口诀或小对话）",
    },
  },
  emptySummary: "尚无梗概，进入这篇后 AI 会补齐故事内容。",
  defaultCount: 1,
  narrationStyle: NARRATION_STYLE_FOR_STORY,
};

const OUTLINE_COPY_PICTURE_BOOK: OutlineCopy = {
  panelTitle: "分册目录",
  panelSubline: () => "· 每册讲一个小情境 / 一个情绪弧线",
  heroTitle: () => "🎨 一句话告诉我这套绘本讲什么",
  heroDesc: ({ count, settingLabel }) =>
    `一句主题 / 一组核心概念 / 主角设定，AI 会顺着${settingLabel}，分册产出 ${count} 本小绘本的骨架（含主角情绪弧线、寓意、页数分配）。`,
  ideaPlaceholder:
    "例如：小狐狸学分享——每册讲一个生活情境（分享 / 等待 / 说抱歉 / 认真道别…）",
  countLabel: "生成册数",
  countUnit: "册",
  lengthField: LENGTH_FIELD_BOOK_PAGES,
  ctaLabel: (n) => `✨ 一键生成 ${n} 册绘本目录`,
  reopenTriggerLabel: "➕ 追加更多册",
  reopenTitle: "🔁 追加生成分册",
  reopenDesc: (n) =>
    `当前已有 ${n} 册草案。追加会把新册拼到末尾，已生成的不会被覆盖。`,
  reopenIdeaPlaceholder: "补充新的情境 / 新的主题 / 新的主角变体…",
  reopenCountLabel: "本次追加册数",
  reopenCtaLabel: (n) => `✨ 追加生成 ${n} 册`,
  generatedSummary: (n, _isDrama, settingLabel) =>
    `${n} 册绘本草案已生成 · ${settingLabel}`,
  stubHint:
    "💡 未接 LLM 时走确定性 stub；接入后 idea / 每册页数会作为 prompt 关键参数。",
  itemPrefix: "第",
  itemBadge: (n) => `第 ${n} 册`,
  projectTypeBadge: (isDrama) =>
    isDrama ? "系列绘本 · drama" : "系列绘本 · series",
  episodeNoun: "本册",
  sceneNoun: "跨页",
  sceneBadge: (n) => `跨页 ${n}`,
  keyframeNoun: "插图",
  scriptStatusLabel: (confirmed) => (confirmed ? "本册已确认" : "本册待确认"),
  scriptSectionLabel: "本册内容",
  scriptFields: {
    title: { label: "绘本标题", placeholder: "例如：小狐狸学分享 · 第 1 册" },
    goal: {
      label: "情绪目标",
      placeholder: "想让小朋友体验什么情绪 / 学到什么行为？",
    },
    conflict: {
      label: "生活情境",
      placeholder: "主角遇到什么小挫折 / 小误会？",
    },
    endingHook: {
      label: "收尾寓意",
      placeholder: "一句温柔的收尾，把这一册和下一册串起来",
    },
  },
  emptySummary: "尚无梗概，进入这册后 AI 会补齐绘本情节。",
  defaultCount: 3,
  narrationStyle: NARRATION_STYLE_FOR_STORY,
};

/**
 * 根据 contentType 返回 Stage 3 面板的所有文案 / 长度维度 / CTA。
 * 缺省 fallback 走 drama 家族。
 */
export function getOutlineCopy(contentType: ContentType | undefined): OutlineCopy {
  switch (contentType) {
    case "educational_story":
      return OUTLINE_COPY_STORY;
    case "picture_book":
      return OUTLINE_COPY_PICTURE_BOOK;
    case "documentary":
      return OUTLINE_COPY_DOCUMENTARY;
    case "animation":
      return OUTLINE_COPY_ANIMATION;
    case "motion_comic":
      return OUTLINE_COPY_MOTION_COMIC;
    case "comic":
      return OUTLINE_COPY_COMIC;
    case "short_drama":
    default:
      return OUTLINE_COPY_DRAMA;
  }
}

function bibleHasContent(bible: StoryBible | null): boolean {
  if (!bible) return false;
  const has = (s: unknown) => typeof s === "string" && s.trim().length > 0;
  if (has(bible.logline) || has(bible.theme) || has(bible.tone)) return true;
  const wr = (bible.worldRules ?? {}) as Record<string, unknown>;
  return has(wr.setting) || has(wr.targetAudience);
}

export interface ComputeStagesInput {
  project: Project | null;
  bible: StoryBible | null;
  episodes: Episode[];
  /** 若已选定某一集，Stage 4 的 href 会指向该集页 */
  currentEpisodeId?: string;
  /** 当前激活阶段 key —— 该阶段永远显示为 in_progress */
  active: WorkspaceStageKey;
}

/**
 * 计算 6 个阶段的完成状态 + href。
 * 顺序即 UI 从上到下的展示顺序，不建议前端逐个改。
 */
export function computeWorkspaceStages(input: ComputeStagesInput): ComputedStage[] {
  const { project, bible, episodes, currentEpisodeId, active } = input;
  const contentType = project?.contentType;
  const totalEpisodes = episodes.length;

  // ---- 完成度判定 ----
  const projectDone = !!project;
  const bibleDone = projectDone && bibleHasContent(bible);
  const outlineDone = totalEpisodes > 0;
  // Stage 4/5/6：Episode 层面数据分散在 scenes/shots/tasks，Shell 层拿不全，
  // 这里只做保守判定 —— 4/5/6 阶段没有一集"完整完工"就都算 todo；
  // 由页面自己在阶段栏之外提示实际进度。后续接 rollup 接口再收敛。
  const anyEpisodeShipped = episodes.some(
    (e) => e.productionStatus === "done" && e.reviewStatus === "passed",
  );

  const targetEpisodeId =
    currentEpisodeId && episodes.some((e) => e.id === currentEpisodeId)
      ? currentEpisodeId
      : episodes[0]?.id;

  const raw: Array<Omit<ComputedStage, "status">> = [
    {
      key: "project_setup",
      index: 1,
      label: "项目设定",
      hint: project ? `${project.name} · ${project.slug}` : "名称·类型·风格",
      href: "/",
    },
    {
      key: "story_setting",
      index: 2,
      label: stage2LabelFor(contentType),
      hint: bibleDone ? "已生成 · 可修改" : "logline·主题·基调",
      href: "/story",
    },
    {
      key: "episode_outline",
      index: 3,
      label: stage3LabelFor(contentType),
      hint: outlineDone
        ? `已生成 ${totalEpisodes} ${getOutlineCopy(contentType).countUnit}`
        : "AI 一键生成草稿",
      href: "/story",
    },
    {
      key: "scene_keyframe",
      index: 4,
      label: stage4LabelFor(contentType),
      hint: targetEpisodeId ? "本集分场 · 关键帧" : "选一集进入",
      href: targetEpisodeId ? `/story/episode/${targetEpisodeId}` : null,
    },
    {
      key: "prompt",
      index: 5,
      label: "提示词生成",
      hint: "批量补齐 · 待人工确认",
      href: "/prompts",
    },
    {
      key: "export",
      index: 6,
      label: "拼接导出",
      hint: anyEpisodeShipped ? "已有可导出集数" : "视频·封面·字幕",
      href: "/exports",
    },
  ];

  const doneSet = new Set<WorkspaceStageKey>();
  if (projectDone) doneSet.add("project_setup");
  if (bibleDone) doneSet.add("story_setting");
  if (outlineDone) doneSet.add("episode_outline");
  if (anyEpisodeShipped) {
    // 至少一集完整走完 —— 认为前 5 步在整体层面已经"经历过"
    doneSet.add("scene_keyframe");
    doneSet.add("prompt");
    doneSet.add("export");
  }

  return raw.map((s) => {
    let status: StageStatus = doneSet.has(s.key) ? "done" : "todo";
    if (s.key === active) status = "in_progress";
    return { ...s, status };
  });
}

// ==== Episode-level 5-light status helpers ====

export type EpisodeLightKey = "script" | "scene" | "keyframe" | "video" | "review";
export type EpisodeLightStatus = "todo" | "in_progress" | "warn" | "done" | "failed";

export interface EpisodeLight {
  key: EpisodeLightKey;
  label: string;
  status: EpisodeLightStatus;
}

/**
 * 由 Episode 现有 5 个 status 字段派生 5 灯：
 *   剧本 / 分场 / 关键帧 / 视频 / 审核
 * 关键帧 + 视频 目前共用 productionStatus，等后续 rollup 接口拆细再分。
 */
export function computeEpisodeLights(ep: Episode): EpisodeLight[] {
  const script: EpisodeLightStatus =
    ep.storyStatus === "confirmed" && ep.scriptStatus === "confirmed"
      ? "done"
      : ep.storyStatus === "confirmed"
        ? "in_progress"
        : "todo";
  const scene: EpisodeLightStatus =
    ep.storyboardStatus === "confirmed"
      ? "done"
      : ep.storyboardStatus === "partial"
        ? "warn"
        : "todo";
  const keyframe: EpisodeLightStatus =
    ep.productionStatus === "done"
      ? "done"
      : ep.productionStatus === "partial" || ep.productionStatus === "running"
        ? "in_progress"
        : ep.productionStatus === "failed"
          ? "failed"
          : "todo";
  const video: EpisodeLightStatus =
    // 目前 productionStatus 未拆帧/视频，视频灯保守走 done
    ep.productionStatus === "done" ? "done" : "todo";
  const review: EpisodeLightStatus =
    ep.reviewStatus === "passed"
      ? "done"
      : ep.reviewStatus === "failed"
        ? "failed"
        : "todo";
  return [
    { key: "script", label: "剧本", status: script },
    { key: "scene", label: "分场", status: scene },
    { key: "keyframe", label: "关键帧", status: keyframe },
    { key: "video", label: "视频", status: video },
    { key: "review", label: "审核", status: review },
  ];
}

export interface EpisodeCta {
  label: string;
  href: string;
  variant: "primary" | "secondary";
}

/**
 * 根据 5 灯的当前状态动态决定这一集下一步应该做什么。
 * 单集工作台 (/story/episode/[id]) 会消费。
 */
export function computeEpisodeCta(ep: Episode): EpisodeCta {
  const href = `/story/episode/${ep.id}`;
  if (ep.storyStatus !== "confirmed") {
    return { label: "确认本集剧本 →", href, variant: "primary" };
  }
  if (ep.storyboardStatus !== "confirmed") {
    return {
      label: ep.storyboardStatus === "partial" ? "继续拆场次 →" : "进入场次 →",
      href,
      variant: "primary",
    };
  }
  if (ep.productionStatus === "idle" || ep.productionStatus === "queued") {
    return { label: "生成关键帧 →", href, variant: "primary" };
  }
  if (ep.productionStatus === "running" || ep.productionStatus === "partial") {
    return { label: "继续生成 →", href, variant: "primary" };
  }
  if (ep.productionStatus === "failed") {
    return { label: "查看失败原因 →", href, variant: "secondary" };
  }
  if (ep.reviewStatus !== "passed") {
    return { label: "送审本集 →", href: "/reviews", variant: "primary" };
  }
  return { label: "查看本集时间轴 →", href, variant: "secondary" };
}
