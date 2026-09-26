/**
 * A1 · ContentType + VisualStyle SSOT
 *
 * 事实调研来源：0xsline/short-drama、chatfire-AI/huobao-drama、
 * UllrAI/CineGen-ShortDrama、zenstory-ai/drama-skills。
 *
 * - `ContentType`：项目一级内容形态枚举（7 种）。是"这个项目要产出的媒介类型"，
 *   与 `projectType`（drama|series）正交：drama 只支持视频/漫画类，series 全支持。
 * - `VisualStyle`：每种 ContentType 挂一份预设风格列表，用户可选预设或写自定义
 *   `customPrompt`；`resolvedPrompt` 是最终注入到 image/video prompt 的英文片段
 *   （PromptCompilerService 会追加到画面主体之后作为 `Style Suffix`）。
 *
 * ⚠️ 本文件是 SSOT：packages/repositories 的 seed / apps/web 的表单预设 /
 *    apps/desktop-server 的校验都必须从这里 import，不允许再各自维护副本。
 */

// ===== ContentType =====

/**
 * 项目一级内容形态。
 *
 * - `short_drama`     竖/横屏真人或 AI 视频短剧，情节驱动（最主流）
 * - `motion_comic`    漫剧：漫画分格 + 局部动效 + 配音（CineGen 主打）
 * - `animation`       全帧 2D/3D 动画（皮克斯 / 吉卜力 / 水墨等）
 * - `comic`           静态漫画（条漫 / 页漫）
 * - `picture_book`    绘本：图文交替、单册叙事，series 独占
 * - `documentary`     纪录短片：真实事件/人物/科普，series 独占
 * - `educational_story` 教育小故事：成语故事 / 数学故事 / 童话寓言等，series 独占
 */
export const CONTENT_TYPES = [
  "short_drama",
  "motion_comic",
  "animation",
  "comic",
  "picture_book",
  "documentary",
  "educational_story",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export interface ContentTypeMeta {
  key: ContentType;
  zh: string;
  desc: string;
  /** 允许的 projectType；drama = 长弧连续；series = 每集独立。 */
  supportedProjectTypes: readonly ("drama" | "series")[];
  /** 默认的视觉风格预设 key（用户未选时用它）。 */
  defaultVisualStylePresetKey: string;
  /**
   * A1: 故事设定预设。
   * - `world` = 世界设定（drama + 短剧/动画/漫剧/漫画）：保留完整戏剧字段（世界观、
   *   人物关系、反派体系、钩子系统、节奏计划）。
   * - `series` = 系列设定（教育故事 / 绘本 / 纪录短片）：精简为 4 个轻量字段
   *   （风格基调、目标受众、核心主题、背景设定），去掉戏剧密度重的钩子/反派/节奏。
   * 见 `STORY_SETTING_PRESETS`。
   */
  storySettingPreset: StorySettingPresetKey;
}

export const CONTENT_TYPE_REGISTRY: Record<ContentType, ContentTypeMeta> = {
  short_drama: {
    key: "short_drama",
    zh: "短剧",
    desc: "竖/横屏真人或 AI 视频短剧，情节驱动",
    supportedProjectTypes: ["drama", "series"],
    defaultVisualStylePresetKey: "cinematic_realism",
    storySettingPreset: "world",
  },
  motion_comic: {
    key: "motion_comic",
    zh: "漫剧",
    desc: "漫画分格 + 局部动效 + 配音，介于漫画与视频之间",
    supportedProjectTypes: ["drama", "series"],
    defaultVisualStylePresetKey: "japanese_manga_color",
    storySettingPreset: "world",
  },
  animation: {
    key: "animation",
    zh: "动画片",
    desc: "全帧 2D/3D 动画，角色动作叙事",
    supportedProjectTypes: ["drama", "series"],
    defaultVisualStylePresetKey: "pixar_3d",
    storySettingPreset: "world",
  },
  comic: {
    key: "comic",
    zh: "漫画/条漫",
    desc: "静态漫画分格，条漫/页漫皆可，无动效",
    supportedProjectTypes: ["drama", "series"],
    defaultVisualStylePresetKey: "shonen_manga",
    storySettingPreset: "world",
  },
  picture_book: {
    key: "picture_book",
    zh: "绘本",
    desc: "图文交替、单册叙事，面向低幼/亲子/科普",
    supportedProjectTypes: ["series"],
    defaultVisualStylePresetKey: "watercolor_illustration",
    storySettingPreset: "series",
  },
  documentary: {
    key: "documentary",
    zh: "纪录短片",
    desc: "真实事件/人物/科普纪实，每集独立选题",
    supportedProjectTypes: ["series"],
    defaultVisualStylePresetKey: "documentary_realism",
    storySettingPreset: "series",
  },
  educational_story: {
    key: "educational_story",
    zh: "教育小故事",
    desc: "成语故事 / 数学故事 / 童话寓言等，寓教于乐",
    supportedProjectTypes: ["series"],
    defaultVisualStylePresetKey: "chinese_ink_child",
    storySettingPreset: "series",
  },
};

// ===== StorySettingPreset =====

/**
 * 故事设定预设 key。
 * - `world` 世界设定：完整戏剧字段（drama + 短剧/动画/漫剧/漫画）。
 * - `series` 系列设定：精简 4 字段（教育故事 / 绘本 / 纪录短片）。
 */
export type StorySettingPresetKey = "world" | "series";

/**
 * 故事设定字段的规格化描述。UI 和 prompt 都读同一份定义，杜绝两处漂移。
 *
 * `path` 使用点分路径指向 `ProjectStoryBible` 上的字段：
 *  - 顶层字段：`logline` | `theme` | `tone`
 *  - JSON blob 内的子键：`worldRules.setting` | `worldRules.targetAudience` | ...
 *  - hookSystem / villainSystem / pacingPlan / characterRelations 也走 `worldRules.xxx`
 *    或直接一级 key（world preset 用一级）。
 */
export interface StorySettingFieldMeta {
  /** 点分路径，用于 UI 表单 & prompt 反填。 */
  path: string;
  /** UI 展示标签。 */
  label: string;
  /** 一句话说明，作为 UI helper 与 prompt 里的字段解释。 */
  helper: string;
  /** JSON blob 类字段 vs 纯文本字段。 */
  kind: "text" | "json";
}

export interface StorySettingPresetMeta {
  key: StorySettingPresetKey;
  /** UI 面板标题（如"项目世界设定"/"项目系列设定"）。 */
  label: string;
  /** UI 生成按钮文案（如"一键生成世界设定"）。 */
  generatorLabel: string;
  /** 空态说明。 */
  emptyHint: string;
  /** 该 preset 允许/期望生成的字段列表。 */
  fields: readonly StorySettingFieldMeta[];
}

/**
 * 世界设定 & 系列设定 两个预设的完整定义。
 * 顺序即 UI 展示顺序（story workspace 面板 A 从上到下渲染）。
 */
export const STORY_SETTING_PRESETS: Record<StorySettingPresetKey, StorySettingPresetMeta> = {
  world: {
    key: "world",
    label: "世界设定",
    generatorLabel: "一键生成世界设定",
    emptyHint:
      "尚未生成世界设定。系统会根据项目类型 / 题材 / 受众，产出一套完整的世界观、人物关系、反派体系、钩子系统与节奏计划。",
    fields: [
      { path: "logline", label: "一句话故事", helper: "1 句概括核心故事张力", kind: "text" },
      { path: "theme", label: "主题", helper: "本剧要表达的核心主题", kind: "text" },
      { path: "tone", label: "调性", helper: "整体风格与叙事情绪", kind: "text" },
      { path: "worldRules", label: "世界观规则", helper: "时空/规则/禁忌等世界底层设定", kind: "json" },
      { path: "characterRelations", label: "人物关系", helper: "主角、配角、反派之间的关系网", kind: "json" },
      { path: "villainSystem", label: "反派体系", helper: "反派动机、势力层级、对抗结构", kind: "json" },
      { path: "hookSystem", label: "钩子系统", helper: "五种钩子（开场/悬念/情感/反转/爽点）的分布", kind: "json" },
      { path: "pacingPlan", label: "节奏计划", helper: "四段节奏曲线（铺垫/激化/爆发/收束）", kind: "json" },
    ],
  },
  series: {
    key: "series",
    label: "系列设定",
    generatorLabel: "一键生成系列设定",
    emptyHint:
      "尚未生成系列设定。系统会根据项目类型 / 题材 / 受众，产出四项轻量设定：风格基调、目标受众、核心主题、背景设定。",
    fields: [
      { path: "tone", label: "风格基调", helper: "整体的情绪调性与讲述方式", kind: "text" },
      {
        path: "worldRules.targetAudience",
        label: "目标受众",
        helper: "年龄段/兴趣画像/知识水平",
        kind: "text",
      },
      { path: "theme", label: "核心主题", helper: "希望每集都围绕/回归的价值内核", kind: "text" },
      {
        path: "worldRules.setting",
        label: "背景设定",
        helper: "共通的时代/世界/角色底色",
        kind: "text",
      },
    ],
  },
};

/** 便捷函数：按 contentType 获取 story setting preset。 */
export function getStorySettingPreset(contentType: ContentType): StorySettingPresetMeta {
  const key = CONTENT_TYPE_REGISTRY[contentType].storySettingPreset;
  return STORY_SETTING_PRESETS[key];
}

// ===== VisualStyle =====

export interface VisualStylePreset {
  /** 全局唯一 key（形如 `pixar_3d`、`chinese_ink`）。 */
  key: string;
  /** 中文展示名。 */
  zh: string;
  /** 一句话中文说明，用于表单提示。 */
  desc: string;
  /**
   * 注入到 image / video prompt 尾部的英文 suffix，需能被主流生图/生视频模型识别。
   * 保持精炼、以逗号分隔关键词。
   */
  promptSuffix: string;
}

/**
 * 每种 ContentType 挂一份视觉风格预设。用户可选预设、写自定义 `customPrompt`
 * 或两者叠加。数据事实来源：4 个参考项目 README + Doubao Seedream 常用风格。
 */
export const VISUAL_STYLE_PRESETS: Record<ContentType, readonly VisualStylePreset[]> = {
  short_drama: [
    {
      key: "cinematic_realism",
      zh: "电影级写实",
      desc: "电影感、真实光影、浅景深、35mm",
      promptSuffix:
        "cinematic realism, photorealistic, natural lighting, shallow depth of field, 35mm film look, high detail",
    },
    {
      key: "urban_vertical",
      zh: "竖屏都市",
      desc: "现代都市场景、9:16 竖屏构图、氛围灯",
      promptSuffix:
        "modern urban scene, vertical 9:16 framing, moody ambient lighting, contemporary Chinese city",
    },
    {
      key: "hongkong_retro",
      zh: "复古港片",
      desc: "80/90s 港片质感、霓虹、颗粒感",
      promptSuffix:
        "1980s Hong Kong cinema style, neon lights, film grain, saturated colors, nostalgic mood",
    },
    {
      key: "cyberpunk",
      zh: "赛博朋克",
      desc: "霓虹雨夜、高对比、未来都市",
      promptSuffix:
        "cyberpunk, neon rain, high contrast, futuristic megacity, holographic signage, blade runner mood",
    },
    {
      key: "wong_karwai",
      zh: "王家卫风",
      desc: "抽帧、慢动作、暖色调、氛围叙事",
      promptSuffix:
        "Wong Kar-wai style, step-printing motion blur, warm tungsten palette, intimate close-ups, expressive lighting",
    },
    {
      key: "japanese_slice_of_life",
      zh: "日剧治愈",
      desc: "自然光、清新、生活质感",
      promptSuffix:
        "Japanese slice-of-life drama, natural daylight, soft pastel palette, everyday intimate framing",
    },
  ],
  motion_comic: [
    {
      key: "japanese_manga_color",
      zh: "日式彩漫",
      desc: "日漫彩稿、清晰线条、饱和色块",
      promptSuffix:
        "Japanese color manga panel, clean cel lines, vibrant flat colors, dynamic paneling",
    },
    {
      key: "korean_webtoon",
      zh: "韩式条漫",
      desc: "韩漫风格、柔和渐变、纵向条漫构图",
      promptSuffix:
        "Korean webtoon style, soft gradients, vertical scroll composition, glossy digital painting",
    },
    {
      key: "american_comic",
      zh: "美漫风",
      desc: "粗线条、强对比、英雄式动态",
      promptSuffix:
        "American superhero comic style, bold inking, halftone shading, dynamic action pose",
    },
    {
      key: "chinese_guofeng_comic",
      zh: "中式古风漫",
      desc: "国风水墨叠加漫画线稿",
      promptSuffix:
        "Chinese guofeng manhua, ink-wash background with clean line art, historical costume, mystical mood",
    },
    {
      key: "monochrome_manga",
      zh: "黑白漫",
      desc: "网点纸、纯黑白、经典少年漫",
      promptSuffix:
        "black and white shonen manga, screentone shading, high contrast ink, classic panel layout",
    },
  ],
  animation: [
    {
      key: "pixar_3d",
      zh: "皮克斯 3D",
      desc: "皮克斯质感、柔光大眼、高细节 3D 卡通",
      promptSuffix:
        "Pixar 3D animation style, soft global illumination, expressive big-eye characters, high-detail subsurface scattering, family-friendly",
    },
    {
      key: "ghibli",
      zh: "吉卜力风",
      desc: "宫崎骏、手绘赛璐珞、日系田园",
      promptSuffix:
        "Studio Ghibli style, hand-drawn cel animation, lush painted backgrounds, whimsical Japanese pastoral mood",
    },
    {
      key: "chinese_ink",
      zh: "水墨国风",
      desc: "中国水墨动画、留白、写意山水",
      promptSuffix:
        "Chinese ink wash animation, calligraphic brushstrokes, negative space, monochrome landscape, poetic mood",
    },
    {
      key: "paper_cut",
      zh: "剪纸中国风",
      desc: "民间剪纸、层叠平面、暖红底色",
      promptSuffix:
        "Chinese paper-cut animation, layered flat silhouettes, warm red palette, folk art texture",
    },
    {
      key: "cel_shaded_anime",
      zh: "赛璐珞动漫",
      desc: "日系赛璐珞、干净上色、动漫大眼",
      promptSuffix:
        "cel-shaded anime, crisp line art, flat cel coloring, expressive anime eyes, dynamic keyframe",
    },
    {
      key: "disney_2d",
      zh: "迪士尼 2D",
      desc: "经典迪士尼手绘、饱和色、童话感",
      promptSuffix:
        "classic Disney 2D animation, hand-drawn linework, saturated fairy-tale palette, expressive character acting",
    },
    {
      key: "flat_vector",
      zh: "扁平矢量",
      desc: "MG 动画感、扁平色块、几何造型",
      promptSuffix:
        "flat vector motion graphics, geometric shapes, minimal palette, clean design, MG-style animation",
    },
  ],
  comic: [
    {
      key: "shonen_manga",
      zh: "少年漫",
      desc: "少年向、动感、粗黑线、网点",
      promptSuffix:
        "shonen manga style, dynamic action lines, bold inking, screentone shading, expressive teenage characters",
    },
    {
      key: "shoujo_manga",
      zh: "少女漫",
      desc: "少女向、闪亮眼睛、花纹背景",
      promptSuffix:
        "shoujo manga style, sparkling eyes, floral decorative backgrounds, delicate line art, romantic mood",
    },
    {
      key: "american_indie_comic",
      zh: "美漫独立风",
      desc: "独立漫画、粗糙笔触、复古印刷",
      promptSuffix:
        "indie American comic style, rough inked linework, vintage print texture, muted palette",
    },
    {
      key: "chinese_ink_comic",
      zh: "水墨漫画",
      desc: "水墨背景 + 现代分格叙事",
      promptSuffix:
        "Chinese ink wash comic, watercolor backgrounds, modern panel layout, poetic composition",
    },
    {
      key: "minimal_bw",
      zh: "极简黑白",
      desc: "极简线条、纯黑白、留白多",
      promptSuffix:
        "minimalist black and white comic, clean thin linework, generous white space, calm mood",
    },
    {
      key: "vertical_scroll_comic",
      zh: "条漫平涂",
      desc: "国产条漫、平涂上色、竖向长条",
      promptSuffix:
        "vertical scroll comic, flat cell-shaded coloring, elongated portrait panels, Chinese webtoon aesthetic",
    },
  ],
  picture_book: [
    {
      key: "watercolor_illustration",
      zh: "水彩插画",
      desc: "水彩晕染、暖色调、童趣",
      promptSuffix:
        "children book watercolor illustration, soft wash of colors, warm palette, gentle whimsical mood, storybook composition",
    },
    {
      key: "kids_crayon",
      zh: "儿童蜡笔",
      desc: "蜡笔涂色、粗轮廓、稚拙感",
      promptSuffix:
        "kids crayon illustration, chunky outlines, playful naive drawing, textured paper background",
    },
    {
      key: "flat_cartoon",
      zh: "扁平卡通",
      desc: "圆润造型、平涂大色块、可爱",
      promptSuffix:
        "flat cartoon illustration, rounded shapes, cheerful pastel palette, cute character design",
    },
    {
      key: "paper_cut_collage",
      zh: "剪纸拼贴",
      desc: "手工剪纸拼贴、纸质纹理",
      promptSuffix:
        "paper cut collage illustration, layered paper textures, folk art aesthetic, tactile handmade feel",
    },
    {
      key: "pencil_sketch_color",
      zh: "手绘素描上色",
      desc: "铅笔线稿 + 淡彩上色",
      promptSuffix:
        "hand-drawn pencil sketch with soft color wash, gentle detail, illustrative storybook feel",
    },
    {
      key: "digital_colored_pencil",
      zh: "数字彩铅",
      desc: "彩色铅笔质感、细腻、暖光",
      promptSuffix:
        "digital colored pencil illustration, textured strokes, warm cozy lighting, children book aesthetic",
    },
  ],
  documentary: [
    {
      key: "documentary_realism",
      zh: "电影级纪录",
      desc: "自然光、35mm、纪实电影质感",
      promptSuffix:
        "documentary film realism, natural daylight, 35mm cinematic look, observational framing, authentic mood",
    },
    {
      key: "news_reportage",
      zh: "新闻纪实",
      desc: "新闻感、手持感、直击现场",
      promptSuffix:
        "news reportage style, handheld camera, on-scene documentary framing, neutral color grading",
    },
    {
      key: "archival_bw",
      zh: "黑白档案",
      desc: "老照片黑白、颗粒感、历史感",
      promptSuffix:
        "archival black and white photography, grainy film, historical documentary aesthetic",
    },
    {
      key: "nature_macro",
      zh: "自然微距",
      desc: "自然纪录片、微距、超高细节",
      promptSuffix:
        "nature documentary macro cinematography, ultra-high detail, natural light, BBC Earth aesthetic",
    },
    {
      key: "vlog_vertical",
      zh: "VLOG 竖屏",
      desc: "竖屏、生活流、暖调、现代",
      promptSuffix:
        "vertical vlog documentary, handheld intimate framing, warm contemporary color grading, everyday authentic mood",
    },
  ],
  educational_story: [
    {
      key: "chinese_ink_child",
      zh: "水墨童趣",
      desc: "水墨国风 + 卡通萌趣（适合成语故事）",
      promptSuffix:
        "Chinese ink painting with cute cartoon characters, watercolor washes, traditional Chinese aesthetic, kid-friendly, storybook composition, full-frame environmental scenery (mountains / village / interior filled with props), soft ambient colored background, avoid blank white rice-paper background",
    },
    {
      key: "paper_cut_kids",
      zh: "剪纸中国风",
      desc: "剪纸拼贴、暖红调、传统童趣",
      promptSuffix:
        "Chinese paper-cut illustration for kids, layered folk art, warm red palette, traditional cultural motifs, storybook feel",
    },
    {
      key: "kids_3d_cute",
      zh: "3D 卡通萌趣",
      desc: "圆润 3D、萌系、明亮色彩",
      promptSuffix:
        "3D cute cartoon animation, rounded chibi characters, bright cheerful lighting, kid-friendly educational scene",
    },
    {
      key: "math_infographic",
      zh: "数学插画",
      desc: "几何图形、数字符号、明快色彩（适合数学故事）",
      promptSuffix:
        "educational math illustration, geometric shapes, numbers and symbols, clean infographic style, vibrant cheerful palette",
    },
    {
      key: "storybook_watercolor",
      zh: "童话水彩",
      desc: "童话感水彩、柔光、温馨",
      promptSuffix:
        "fairy tale watercolor illustration, soft dreamy palette, whimsical children storybook composition",
    },
    {
      key: "textbook_hand_drawn",
      zh: "手绘教材",
      desc: "教材式手绘、清晰、易理解",
      promptSuffix:
        "hand-drawn textbook illustration, clear educational layout, friendly cartoon characters, easy-to-follow visual explanation",
    },
  ],
};

// ===== VisualStyle 用户选择 =====

/**
 * 项目上保存的视觉风格选择：可选预设 key、可选自定义 prompt、
 * 最终解析出的英文 suffix（由 `resolveVisualStyle` 生成，写死到项目上，
 * 后续编译提示词直接读，无需再查 registry）。
 */
export interface ProjectVisualStyle {
  /** 预设 key；未选时为空，此时以 `customPrompt` 为准。 */
  presetKey?: string;
  /** 用户自定义描述（中文或英文均可，会原样拼入 prompt）。 */
  customPrompt?: string;
  /**
   * 最终注入到画面 prompt 的 suffix。由 `resolveVisualStyle` 生成；
   * 存到项目上做冗余，防止 registry 演进导致历史项目提示词漂移。
   */
  resolvedPrompt: string;
}

/**
 * 根据 ContentType + 用户选择解析出最终 `ProjectVisualStyle`。
 *
 * 拼装规则：
 *  1. 若 presetKey 命中当前 ContentType 的 presets → 取其 `promptSuffix`；
 *  2. 若 customPrompt 非空 → 追加到 suffix 末尾（"; " 分隔）；
 *  3. 都为空 → 取 ContentType 的 `defaultVisualStylePresetKey` 对应 preset。
 */
export function resolveVisualStyle(
  contentType: ContentType,
  input?: { presetKey?: string; customPrompt?: string },
): ProjectVisualStyle {
  const presets = VISUAL_STYLE_PRESETS[contentType];
  const meta = CONTENT_TYPE_REGISTRY[contentType];
  const presetKey = input?.presetKey?.trim() || undefined;
  const custom = input?.customPrompt?.trim() || undefined;

  const chosen =
    (presetKey && presets.find((p) => p.key === presetKey)) ||
    (!presetKey && !custom
      ? presets.find((p) => p.key === meta.defaultVisualStylePresetKey)
      : undefined);

  const parts: string[] = [];
  if (chosen) parts.push(chosen.promptSuffix);
  if (custom) parts.push(custom);
  const resolvedPrompt = parts.join("; ");

  return {
    presetKey: chosen?.key ?? undefined,
    customPrompt: custom,
    resolvedPrompt,
  };
}

/** 按 projectType 过滤可选 ContentType。 */
export function contentTypesForProjectType(
  projectType: "drama" | "series",
): ContentTypeMeta[] {
  return CONTENT_TYPES
    .map((k) => CONTENT_TYPE_REGISTRY[k])
    .filter((m) => m.supportedProjectTypes.includes(projectType));
}

/** 判断给定组合是否合法。 */
export function isContentTypeSupported(
  projectType: "drama" | "series",
  contentType: ContentType,
): boolean {
  return CONTENT_TYPE_REGISTRY[contentType].supportedProjectTypes.includes(projectType);
}
