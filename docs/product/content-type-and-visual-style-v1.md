# ContentType & VisualStyle v1

> 立项形态与视觉风格的 SSOT。事实来源：0xsline/short-drama、chatfire-AI/huobao-drama、
> UllrAI/CineGen-ShortDrama、zenstory-ai/drama-skills 四个参考项目 README；
> 落地位置：`packages/domain/src/content-types.ts`。所有创建/更新项目、Prompt 编译
> 都必须走这份 SSOT，禁止在各层维护副本。

## 1. 概念模型

- **projectType（连续/选集）**：故事结构维度。
  - `drama` = 连续剧：项目级共享故事圣经/资产/连续性；对齐 0xsline 的长弧体系（反派/钩子/节奏曲线）。
  - `series` = 选集/单元剧：每集独立故事，用户按集给梗概；资产/世界观可选复用。
- **contentType（内容形态）**：媒介维度，与 projectType 正交，决定分镜/资产/prompt 模板与风格预设集。
- **visualStyle（视觉风格）**：画面风格维度，每种 contentType 挂一组预设；用户可选预设、写自定义 prompt，或两者叠加。

三者关系：`projectType × contentType × visualStyle`，前两级二级联动，第三级从当前 contentType 的预设集选取。

## 2. ContentType 枚举（7 种）

| key | 中文 | 说明 | 支持的 projectType |
| --- | --- | --- | --- |
| `short_drama` | 短剧 | 竖/横屏真人或 AI 视频短剧，情节驱动 | drama / series |
| `motion_comic` | 漫剧 | 漫画分格 + 局部动效 + 配音 | drama / series |
| `animation` | 动画片 | 全帧 2D/3D 动画 | drama / series |
| `comic` | 漫画/条漫 | 静态漫画，条漫或页漫，无动效 | drama / series |
| `picture_book` | 绘本 | 图文交替、单册叙事 | **series 独占** |
| `documentary` | 纪录短片 | 真实事件/人物/科普纪实 | **series 独占** |
| `educational_story` | 教育小故事 | 成语故事 / 数学故事 / 童话寓言等 | **series 独占** |

**规则**：
- `drama` 强调"一部长故事拆 N 集"，因此排除绘本/纪录/教育故事（这三类天然独立成集）。
- `series` 全支持。

## 3. VisualStyle 预设

每种 contentType 挂一组 5–7 个预设，`promptSuffix` 是英文关键词，会注入到 image/video prompt 尾部。用户如需教育故事又想要迪士尼 2D 感，可以：
1. `contentType = animation`，选预设 `disney_2d`；或
2. `contentType = educational_story`，选预设 `chinese_ink_child`，`customPrompt` 里补 `"Disney 2D linework"`。

### 各内容形态预设一览

- **short_drama**：电影级写实 / 竖屏都市 / 复古港片 / 赛博朋克 / 王家卫风 / 日剧治愈
- **motion_comic**：日式彩漫 / 韩式条漫 / 美漫风 / 中式古风漫 / 黑白漫
- **animation**：**皮克斯 3D** / **吉卜力风** / **水墨国风** / 剪纸中国风 / 赛璐珞动漫 / 迪士尼 2D / 扁平矢量
- **comic**：少年漫 / 少女漫 / 美漫独立风 / 水墨漫画 / 极简黑白 / 条漫平涂
- **picture_book**：水彩插画 / 儿童蜡笔 / 扁平卡通 / 剪纸拼贴 / 手绘素描上色 / 数字彩铅
- **documentary**：电影级纪录 / 新闻纪实 / 黑白档案 / 自然微距 / VLOG 竖屏
- **educational_story**：**水墨童趣**（默认） / 剪纸中国风 / 3D 卡通萌趣 / 数学插画 / 童话水彩 / 手绘教材

完整 promptSuffix 见 `packages/domain/src/content-types.ts` 的 `VISUAL_STYLE_PRESETS`。

## 4. 用户输入 & Resolve 规则

前端表单 `visualStyle` 输入：
```jsonc
{ "presetKey": "chinese_ink_child",     // 可选；必须属于当前 contentType 预设
  "customPrompt": "宋代山水笔法" }        // 可选；≤500 字符，与预设叠加
```

`resolveVisualStyle(contentType, input)` 拼装规则：
1. `presetKey` 命中 → 取该 preset 的 `promptSuffix`
2. `customPrompt` 非空 → 用 `"; "` 追加到末尾
3. 两者都为空 → 取 `CONTENT_TYPE_REGISTRY[contentType].defaultVisualStylePresetKey`

resolved 结果冗余存入项目行的 `visual_style_json.resolvedPrompt`，**防止 registry 演进导致历史项目 prompt 漂移**。

## 5. 校验

`createProjectSchema.superRefine`：
- `contentType` 必须在 `projectType` 的支持集合内 → 否则 `path:["contentType"]` custom issue。
- `visualStyle.presetKey` 必须属于该 `contentType` 的预设集 → 否则 `path:["visualStyle","presetKey"]` custom issue。

`updateProject` 补一次 preset 校验，覆盖 "只改 contentType 顺带带上旧 presetKey" 的路径。

## 6. Prompt 注入

`PromptCompilerService` 在 `buildImageSections` / `buildVideoSections` 的最前面各注入一个 `content_style` section：
```
Content type: 教育小故事 (educational_story) — 成语故事 / 数学故事 / 童话寓言等，寓教于乐
Style: Chinese ink painting with cute cartoon characters, watercolor washes, ... ; 宋代山水笔法
```
TTS section 不受影响（风格只作用于画面）。

## 7. 数据落库

`projects` 表新增字段（已折进 `0001_init.sql`，pre-release 阶段允许直接改）：
```sql
content_type TEXT NOT NULL DEFAULT 'short_drama',
visual_style_json TEXT NOT NULL DEFAULT '{"resolvedPrompt":""}',
```

## 8. Smoke 验证清单（已跑）

| Case | 期望 | 实际 |
| --- | --- | --- |
| `contentType=picture_book` + `projectType=drama` | 400 validation_failed | ✅ |
| `contentType=educational_story` + preset `pixar_3d` | 400 validation_failed | ✅ |
| `contentType=educational_story` + preset `chinese_ink_child` + custom | resolvedPrompt 双段拼接 | ✅ |
| `contentType=animation` + preset `pixar_3d` | resolvedPrompt = Pixar suffix | ✅ |
| 空 `visualStyle` | 走 default preset fallback | ✅ |

## 9. 后续（不在本次范围）

- 各 contentType 的分镜模板 / 资产模板（当前 storyboard-service 尚未按 contentType 分派）。
- `motion_comic` 的分镜"局部动效" hint、`comic` 的分格布局 hint。
- 前端展示：项目卡片 badge 增加 visualStyle 中文标签。
- Preset 的 i18n（当前仅中文标签，promptSuffix 已经是英文对模型友好）。

## 10. StorySettingPreset —— 「世界设定」/「系列设定」

原「故事圣经」的命名与字段一刀切并不合理：短剧/漫剧/动画这类**戏剧密度重**的形态确实需要世界观 + 人物关系 + 反派 + 钩子 + 节奏五套字段；而绘本、纪录、教育小故事这类**每集独立**的形态并不需要长弧钩子和反派体系，只要 4 项轻量设定即可。

### 10.1 两种预设

| preset key | UI 名称 | 覆盖 ContentType | 字段 |
| --- | --- | --- | --- |
| `world` | **世界设定** | `short_drama` / `animation` / `motion_comic` / `comic`（以及所有 drama 项目） | logline / theme / tone / worldRules / characterRelations / villainSystem / hookSystem / pacingPlan（完整戏剧字段） |
| `series` | **系列设定** | `picture_book` / `documentary` / `educational_story` | 风格基调（tone）/ 目标受众（worldRules.targetAudience）/ 核心主题（theme）/ 背景设定（worldRules.setting） |

**注意**：DB schema 不动 —— `project_story_bibles` 表本来就把 hookSystem / pacingPlan / villainSystem / characterRelations 存成独立 JSON blob，series preset 生成时把它们保持为空对象 `{}`，UI 也不再展示这些块。这样既不破坏 pre-release 的表结构，又能在 UI/Prompt 层把两种形态彻底区分。

### 10.2 契约位置

- **SSOT**：`packages/domain/src/content-types.ts` 的 `STORY_SETTING_PRESETS` + `CONTENT_TYPE_REGISTRY[*].storySettingPreset`。
- **UI 读取**：`getStorySettingPreset(project.contentType)` 拿到 preset meta，用于面板标题、按钮文案、空态提示、字段渲染。
- **Prompt 分派**：`story-service.ts` 的 `generateStoryBible` 按 preset 走两条完全不同的 prompt：
  - `world` prompt → 8 字段 JSON schema，包含反派/钩子/节奏。
  - `series` prompt → 4 字段 JSON schema（`{ tone, theme, worldRules.{targetAudience,setting} }`），显式告诉 LLM "无长弧钩子/反派体系/节奏曲线等戏剧密度字段"。
  - LLM 万一越权吐了戏剧密度字段，series 分支的 `finalizeLlmPatch` 会强制清空这些字段。

### 10.3 活动流命名

`activities.summary` 现在按 preset 分别落地：
- world → `生成世界设定（短剧，llm）` / `…（stub）`
- series → `生成系列设定（教育小故事，llm）` / `…（stub）`

替代了原来的"生成项目故事圣经（连续剧/选集剧）"命名。

### 10.4 UI 变化速览

Story Workspace 面板 A：
| 状态 | world preset | series preset |
| --- | --- | --- |
| 标题 | 项目**世界设定** | 项目**系列设定** |
| 生成按钮 | ✨ 一键生成**世界设定** | ✨ 一键生成**系列设定** |
| 编辑字段 | Logline / 主题 / 基调 | 风格基调 / 目标受众 / 核心主题 / 背景设定 |
| 详情预览 | 折叠 `world/hook/pacing/villain/relations` JSON | **不展示**（噪音字段被隐藏） |
| Subtitle | "世界设定 · 分集大纲 · 生成式工作台" | "系列设定 · 分集大纲 · 生成式工作台" |

### 10.5 Smoke 验证（已跑）

| Case | 期望 | 实际 |
| --- | --- | --- |
| `educational_story` 项目 → `/story-bible/generate` | 只有 4 精简字段，戏剧字段全空对象 | ✅ |
| `picture_book` 项目 → `/story-bible/generate` | 同上 | ✅ |
| `short_drama` 项目 → `/story-bible/generate` | 完整 8 字段（含 hook / pacing / villain / relations） | ✅ |
| Activity 摘要 | 按 preset 显示"世界设定"/"系列设定" | ✅ |
