# printfilm-next 工作流 × LLM 数据构建 落地设计方案 v1

> 作者：小叮当（协作 · 胖哥）
> 生成时间：2026-09-24
> 前置阅读：
> - [prompt 工程调研报告](../research/prompt-engineering-references-v1.md)
> - [LLM 接口清单](../research/llm-interfaces-inventory-v1.md)
> - `docs/product/data-and-api-v1.md`（数据与 API 主设计）
> - `docs/product/story-workspace-spec.md`（Story Workspace 规范）

---

## 0. TL;DR（一屏结论）

- **每阶段一个 prompt 包**：`packages/core-services/src/ai/prompts/<stage>/{system.ts, user.ts, schema.ts, variants/*.md}`，服务层只做 `promptPack.build(ctx) → callArkChat → schema.parse`，业务逻辑与 prompt 彻底解耦。
- **传给 LLM 的 payload = 5 块拼装**：`shared roles` + `shared constants(懒加载)` + `content-form variant` + `structured context blocks` + `output schema instruction`。**上游产物永远以数据块（JSON / 表格）而不是散文形式注入 user prompt**。
- **JSON schema 强约束 + zod 二次校验 + 失败即抛错**：全流程无 stub 回退，对齐已上线的 `provider_unavailable` 策略。
- **ID 化跨阶段引用 + `visual_lock` 一致性锁短语**：`WORLD-*` / `EP001` / `SC-EP001-003` / `CHR-<slug>` / `LOC-<slug>` / `PROP-<slug>` / `KF-EP001-003-A` / `LOCK-*`。锁短语从 world/character/location/prop 抽取，向下贯穿到 keyframe/image/video prompt，保证 seedream/seedance 一致性。
- **内容形态 = 共享 system + variants md 分支**：`short_drama / motion_comic / animation / comic`（drama 系）共用一套钩子/节奏；`picture_book / educational_story / documentary`（series 系）各自独立规则块。
- **温度矩阵**：结构化 0.35–0.5，创意剧本 0.5–0.7，image/video prompt 抽取 0.2。`max_tokens=8192` 统一，长任务按 episode / scene 拆批。
- **落地 3 步**：Step 1 把 4 个现有 chat 调用（world/series/episode/scene）搬到 prompt 包并接入 zod；Step 2 增补 scriptSkeleton（阶段 C）和 keyframe/imagePrompt（阶段 E/F）；Step 3 接入 videoPrompt（阶段 G）+ 一致性锁全链路。

---

## 1. 目标与非目标

### 目标
1. 让每阶段"给 LLM 传什么、要 LLM 吐什么、拿到之后怎么落库"三件事有唯一权威定义。
2. 让 prompt 与业务代码彻底解耦，可以在不改 service 的情况下迭代 prompt。
3. 让 7 种内容形态（short_drama / motion_comic / animation / comic / picture_book / educational_story / documentary）在同一套骨架下走各自的 variant，不需要维护 7 份平行代码。
4. 让 seedream 5.0 / seedance 2.0-mini 的一致性问题在阶段 A 就锁住（visual_lock 从 world 一路传到 keyframe/image/video prompt）。
5. 保留"无 stub、失败即抛"的运行原则；给出统一的错误分类与用户可读消息。

### 非目标
- 不解决 LLM 计费 / 配额 / 限流 —— 由 desktop-server 中的 `AiUpstreamError` + `provider_unavailable` 已覆盖。
- 不引入外部 vector store / RAG —— 前期 context 完全来自 SQLite；短期不用向量检索。
- 不改动 UI 工作台 stage 划分 —— UI 层的 `workspace-stages.ts` 保持不变，本方案是"UI 之下的 prompt 层"。

---

## 2. 核心设计原则（10 条）

| # | 原则 | 落地形式 |
|---|---|---|
| 1 | **阶段独立** | 每阶段一个 prompt 包（system/user/schema），互不依赖 |
| 2 | **数据先行** | 上游产物以 JSON 结构化块注入 user prompt，禁止让 LLM 编 |
| 3 | **JSON 强约束** | Ark `response_format: json_object` + zod parse，失败抛 `provider_unavailable` |
| 4 | **共享 system + variants md 分支** | 内容形态差异只写在 variants 里，system 保持精简 |
| 5 | **懒加载参考文档** | rhythm-curve / hook-types / villain-tiers 按 `contentForm + stage` 决定是否注入 |
| 6 | **ID 化跨阶段引用** | slug 化 ID + 明确 ID 命名规范；LLM 引用必须来自 context 提供 |
| 7 | **一致性锁短语** | 每个新角色/场景/道具生成 `visual_lock ≤ 15 词英文短语`，下游直接拼接 |
| 8 | **温度分级** | 结构化 0.4, 剧本 0.6, image/video 0.2 |
| 9 | **拆批调用** | 每 episode / 每 scene 独立请求，防 JSON 截断 |
| 10 | **可用户覆盖（Phase 2）** | 未来把 prompt 存入 SQLite `ai_prompt_overrides` 表，UI 可编辑；默认走内置 |

---

## 3. 阶段全景图

```
┌────────────┬─────────────────┬────────────────┬────────────────────┬────────────────────────┐
│ Stage      │ 输入上下文        │ LLM 调用         │ 输出实体              │ 现状（2026-09-24）      │
├────────────┼─────────────────┼────────────────┼────────────────────┼────────────────────────┤
│ A. WorldSet│ project meta     │ chat            │ ProjectStoryBible   │ 已接入，本次要拆到 prompts/│
│            │ (contentForm,    │ doubao-lite     │ + visual_locks[]    │ 目录并加 zod            │
│            │  genre, tone…)   │ temp 0.55       │ + character_seeds[] │                        │
├────────────┼─────────────────┼────────────────┼────────────────────┼────────────────────────┤
│ B. Outline │ world_setting +  │ chat            │ Episode[] draft     │ 已接入；本次内容形态分支 │
│            │ 已有集摘要 + N    │ doubao-lite     │ + hook_type/beat    │ 已加，接下来加 schema 校验│
│            │                  │ temp 0.5        │                     │                        │
├────────────┼─────────────────┼────────────────┼────────────────────┼────────────────────────┤
│ C. Script  │ episode draft +  │ chat            │ Episode.script_body │ **未接入 LLM**；本方案   │
│  Skeleton  │ world + chars    │ doubao-lite     │ (goal/conflict/     │ 新增                   │
│            │                  │ temp 0.65       │  turn/hook 精修)     │                        │
├────────────┼─────────────────┼────────────────┼────────────────────┼────────────────────────┤
│ D. Scene   │ episode script + │ chat            │ Scene[] skeleton    │ 已接入；本次接 zod +     │
│  Outline   │ world + chars    │ doubao-lite     │ + character_ids[]   │ 引用校验                │
│            │                  │ temp 0.4        │ + duration_est      │                        │
├────────────┼─────────────────┼────────────────┼────────────────────┼────────────────────────┤
│ E. Keyframe│ scene + chars +  │ chat            │ KeyframeSpec[]      │ **未接入**；本方案新增   │
│  Plan      │ locations        │ doubao-lite     │ (start/end frame)   │                        │
│            │                  │ temp 0.4        │ + visual_locks 引用  │                        │
├────────────┼─────────────────┼────────────────┼────────────────────┼────────────────────────┤
│ F. Image   │ KeyframeSpec +   │ chat →          │ ImagePromptSpec     │ **未接入**；调 seedream  │
│  Prompt    │ visual_locks +   │ (few-shot)      │ (positive/negative/ │ 前的中间层              │
│            │ style_reference  │ temp 0.2        │  ratio/steps)       │                        │
├────────────┼─────────────────┼────────────────┼────────────────────┼────────────────────────┤
│ G. Video   │ 首尾 KF +        │ chat →          │ VideoPromptSpec     │ **未接入**；调 seedance  │
│  Prompt    │ dialogue +       │ (few-shot)      │ (motion desc/       │ 前的中间层              │
│            │ visual_locks     │ temp 0.2        │  camera/duration)   │                        │
└────────────┴─────────────────┴────────────────┴────────────────────┴────────────────────────┘
```

---

## 4. Prompt 目录重构方案

```
packages/core-services/src/ai/
├── ark/                                # 现有 chat/image/video adapter，保持不动
│   ├── ark-chat.ts
│   ├── ark-image.ts
│   ├── ark-video.ts
│   ├── ark-config.ts
│   └── types.ts
├── prompts/                            # ✨ 新增：所有 prompt 集中管理
│   ├── shared/
│   │   ├── roles/
│   │   │   ├── screenwriter.md         # 通用编剧角色卡
│   │   │   ├── worldbuilder.md         # 世界圣经架构师
│   │   │   ├── storyboard-director.md  # 分镜导演
│   │   │   ├── image-prompt-engineer.md
│   │   │   └── video-prompt-engineer.md
│   │   ├── constants/
│   │   │   ├── rhythm-curve.md         # 移植 0xsline (drama 系)
│   │   │   ├── hook-types.md           # 5 类钩子定义
│   │   │   ├── villain-tiers.md        # 4 层反派体系（drama）
│   │   │   ├── satisfaction-matrix.md  # 8 类爽感（drama）
│   │   │   ├── educational-values.md   # 教育故事价值观清单
│   │   │   ├── picture-book-beats.md   # 绘本节拍模型
│   │   │   ├── documentary-structure.md
│   │   │   └── compliance-checklist.md # 国内合规红线
│   │   ├── output-conventions.md       # ID 命名 + JSON 输出约束 + visual_lock 规范
│   │   ├── loader.ts                   # 读 md + gray-matter frontmatter + 缓存
│   │   └── context-builder.ts          # buildPromptContext(project, episode?, scene?)
│   ├── story-bible/                    # Stage A
│   │   ├── system.ts
│   │   ├── user.ts
│   │   ├── schema.ts
│   │   ├── variants/
│   │   │   ├── drama.md                # short_drama / motion_comic / animation / comic
│   │   │   ├── educational-story.md
│   │   │   ├── picture-book.md
│   │   │   └── documentary.md
│   │   └── index.ts                    # export { build, parse, ARK_PARAMS }
│   ├── episode-outline/                # Stage B
│   │   └── ...（同上）
│   ├── episode-script/                 # Stage C ✨ 新增
│   │   └── ...
│   ├── scene-outline/                  # Stage D
│   │   └── ...
│   ├── keyframe-plan/                  # Stage E ✨ 新增
│   │   └── ...
│   ├── image-prompt/                   # Stage F ✨ 新增
│   │   └── ...
│   └── video-prompt/                   # Stage G ✨ 新增
│       └── ...
└── index.ts                            # 统一 export
```

**模块契约**（每个 prompt 包都遵守）：

```ts
// packages/core-services/src/ai/prompts/<stage>/index.ts
import { z } from 'zod';
export interface PromptPack<InputCtx, Output> {
  /** 组装 { system, user, response_format }，纯函数、可 unit test */
  build(ctx: InputCtx): {
    system: string;
    user: string;
    responseFormat: 'json';
    temperature: number;
    maxTokens: number;
    // 该阶段依赖的懒加载常量文件名列表，供 loader 装配
    loadConstants: string[];
  };
  /** 严格 schema 校验；失败抛 zod error（上层转 provider_unavailable） */
  schema: z.ZodType<Output>;
  /** 便于监控 / 日志：这是哪一阶段、什么 contentForm */
  stageId: string;
}
```

---

## 5. 变量注入清单（六件套 + 阶段扩展）

**基础六件套（所有阶段都拿）** — 来自 `project` 表：

| 变量 | 字段 | 用途 |
|---|---|---|
| `project_name` | `projects.name` | 头部标识 |
| `project_slug` | `projects.slug` | 生成 ID 前缀 |
| `content_form` | `projects.content_type` | 决定 variant 分支 |
| `project_type` | `projects.project_type` | `drama`/`series`，影响编号 |
| `genre` | `projects.genre` | 题材（有 contentType 兜底） |
| `tone` | `projects.tone`（或 bible.tone） | 语气 |
| `audience` | `projects.audience` | 目标受众 |
| `mode` | `projects.mode`（新字段） | `domestic`/`overseas` |
| `language` | `projects.language`（新字段） | `zh-CN`/`en-US`… |

> `mode` 和 `language` 是本方案新增字段建议：短期可先 hardcode `mode=domestic, language=zh-CN`，后续补 DB migration。

**阶段扩展 context blocks**：

| Stage | 追加 context |
|---|---|
| A | 已有 project.description、genre 补齐；本轮无上游产物 |
| B | `world_setting_json`（logline/theme/tone/worldRules/hookSystem/pacingPlan）+ `previous_episodes_summary[]` |
| C | 单集 episode draft（title/summary/goal/conflict/turn/hook）+ `world_setting_json` + `characters[]`（本项目已建） |
| D | episode script（confirmed）+ `characters[]` + `locations[]` + `props[]` + episode script goals |
| E | `scene[]`（with dramatic_goal/conflict）+ characters + locations + visual_locks |
| F | `KeyframeSpec` + character_visual_locks[] + location_visual_lock + style_reference |
| G | 首尾 `KeyframeSpec` + dialogue_block + motion hint + visual_locks |

**注入方式**：所有 context 块**以 `<block name="xxx">...JSON.stringify(...)...</block>` 的形式塞进 user prompt**（不用自然语言描述），LLM 拿到就能 parse。

---

## 6. ID 命名规范 & 一致性锁体系

### 6.1 ID 命名（跨阶段引用的骨架）

| 实体 | ID 格式 | 举例 |
|---|---|---|
| Project | `PRJ-<slug>` | `PRJ-shou-zhu-dai-tu-01` |
| World Setting | `WORLD-<projectSlug>` | `WORLD-shou-zhu-dai-tu-01` |
| Episode | `EP<3位补零>` | `EP001` |
| Scene | `SC-EP<no>-<3位补零>` | `SC-EP001-003` |
| Shot | `SH-SC-EP001-003-<2位>` | `SH-SC-EP001-003-02` |
| Character | `CHR-<slug>` | `CHR-song-nong` |
| Location | `LOC-<slug>` | `LOC-tian-tou-shu-xia` |
| Prop | `PROP-<slug>` | `PROP-shu-gan` |
| Keyframe | `KF-<sceneId>-<A|B>` | `KF-SC-EP001-003-A`（Start）/ `-B`（End） |
| Visual Lock | `LOCK-<entityKind>-<slug>-<attr>` | `LOCK-CHR-song-nong-dress` |
| Image Prompt | `IMG-<keyframeId>` | `IMG-KF-SC-EP001-003-A` |
| Video Prompt | `VID-<sceneId>` | `VID-SC-EP001-003` |

**规则**：
- LLM 生成新实体时**必须自主分配 ID**（system prompt 中要求）；后端 zod 校验唯一性和格式。
- LLM 引用**已有实体必须来自 user prompt 提供的清单**，不允许自创（system prompt 明确禁止）。
- 引用不存在的实体 → zod parse 失败 → 抛错重生成，一次机会。

### 6.2 一致性锁 `visual_lock`

**痛点**：seedream/seedance 每次生图对同一角色/场景会漂移。

**解法**：每个 character/location/prop 在 Stage A 生成时，除了长描述，还必须产出一条 `visual_lock`——**可直接原样拼进 image/video prompt 的英文短语**：

```json
// character CHR-song-nong
{
  "id": "CHR-song-nong",
  "name_zh": "宋农",
  "identity_summary": "中年农夫，皮肤黝黑，眉眼朴实，衣着简陋",
  "visual_lock": "middle-aged Chinese farmer, tanned skin, weathered face, coarse hemp tunic and straw sandals",
  "visual_lock_negative": "no modern clothing, no glasses, no watch"
}

// location LOC-tian-tou-shu-xia
{
  "id": "LOC-tian-tou-shu-xia",
  "name_zh": "田头树下",
  "visual_lock": "rural farmland edge with a lone leafy tree, ink-wash Chinese landscape style, soft daylight"
}
```

**约束**：
- `visual_lock` ≤ 15 英文单词，禁止中文。
- Stage F/G 拼 image/video prompt 时**直接拼接**这些 lock 短语，不重新生成描述。
- 用户可在 Asset Ledger 手动修改 `visual_lock`（未来功能）。

---

## 7. Stage A · 世界圣经 / 系列设定

### 7.1 输入

| Key | 来源 | 是否必填 |
|---|---|---|
| project 六件套 | project 表 | 必填 |
| `existing_bible_hints` | `projects.description` 或历史 bible 片段 | 可选 |

**上游产物**：无（这是链路起点）。

### 7.2 Prompt 组织

**System prompt**（骨架）：

```
<role src="shared/roles/worldbuilder.md" />

你是 DramaFlow Studio 的资深世界圣经架构师。

<output-conventions src="shared/output-conventions.md" />

<content-form-rules>
  <variant contentForm="drama">
    <load-constants>rhythm-curve, hook-types, villain-tiers, satisfaction-matrix</load-constants>
    输出字段必须包含: logline / theme / tone / worldRules / hookSystem / pacingPlan / villainSystem / characterRelations
  </variant>
  <variant contentForm="educational-story">
    <load-constants>educational-values</load-constants>
    输出字段: logline / theme / tone / worldRules{setting, targetAudience} / valueThemes[]
    禁止生成 villain / paywall / rhythm 相关字段。
  </variant>
  <!-- picture-book / documentary 类似 -->
</content-form-rules>

<consistency-locks>
  为每个 seed character/location/prop 生成 visual_lock (≤ 15 英文词)，用于下游图像生成一致性。
</consistency-locks>

严格返回一个合法 JSON 对象，schema 见附件。不得输出 markdown 代码围栏。
```

**User prompt**：

```
<block name="project">
{
  "id": "PRJ-shou-zhu-dai-tu-01",
  "name": "守株待兔",
  "content_form": "educational_story",
  "project_type": "series",
  "genre": "成语故事",
  "tone": "亲切、寓教于乐",
  "audience": "6-12 岁儿童及家长共读",
  "mode": "domestic",
  "language": "zh-CN"
}
</block>

<block name="existing_hints">
用户已填写的初始描述：一个关于守株待兔的成语系列，希望每集用生动的动物形象讲一个道理。
</block>

<task>
请输出 educational_story 形态的系列设定，含 6-10 个 character seeds 和 4-6 个 location seeds，
每个 seed 必须带 visual_lock。
</task>
```

### 7.3 输出 zod schema（drama 变体节选）

```ts
// prompts/story-bible/schema.ts
import { z } from 'zod';

const VisualLockSchema = z.object({
  id: z.string().regex(/^LOCK-/),
  positive: z.string().max(120),   // 英文 ≤ 15 词
  negative: z.string().max(200).optional(),
});

const CharacterSeedSchema = z.object({
  id: z.string().regex(/^CHR-/),
  name_zh: z.string(),
  role_type: z.enum(['protagonist', 'antagonist', 'supporting', 'mentor', 'foil']),
  identity_summary: z.string().max(200),
  motivation: z.string().max(200),
  visual_lock: VisualLockSchema,
});

const LocationSeedSchema = z.object({
  id: z.string().regex(/^LOC-/),
  name_zh: z.string(),
  description: z.string().max(200),
  visual_lock: VisualLockSchema,
});

export const StoryBibleDramaSchema = z.object({
  id: z.string().regex(/^WORLD-/),
  logline: z.string().max(200),
  theme: z.string().max(120),
  tone: z.string().max(120),
  world_rules: z.object({
    setting: z.string(),
    rules: z.array(z.string()).min(2).max(8),
  }),
  hook_system: z.object({
    opening_hook: z.string(),
    per_episode_hook: z.string(),
  }),
  pacing_plan: z.object({
    structure: z.string(),
    beats_per_episode: z.number().int().min(3).max(8),
    curve_stages: z.array(z.enum(['起势', '攀升', '风暴', '决战'])).length(4),
  }),
  villain_system: z.object({
    tiers: z.array(z.object({
      tier: z.enum(['小', '中', '大', '隐藏']),
      description: z.string(),
    })).length(4),
  }),
  character_relations: z.object({
    protagonist_id: z.string(),
    relations: z.array(z.object({
      from: z.string(),
      to: z.string(),
      type: z.enum(['对立', '同盟', '暧昧', '误会', '师徒', '亲情']),
    })),
  }),
  character_seeds: z.array(CharacterSeedSchema).min(3).max(12),
  location_seeds: z.array(LocationSeedSchema).min(2).max(8),
  visual_locks_summary: z.array(z.string()),  // 汇总便于下游快速引用
});

export const StoryBibleSeriesSchema = z.object({
  id: z.string().regex(/^WORLD-/),
  logline: z.string().max(200),
  theme: z.string(),
  tone: z.string(),
  world_rules: z.object({
    setting: z.string(),
    target_audience: z.string(),
  }),
  value_themes: z.array(z.string()).min(1).max(20),  // 教育/绘本必备
  character_seeds: z.array(CharacterSeedSchema).min(2).max(20),
  location_seeds: z.array(LocationSeedSchema).min(1).max(12),
});

export const StoryBibleSchema = z.discriminatedUnion('_kind', [
  z.object({ _kind: z.literal('drama'), payload: StoryBibleDramaSchema }),
  z.object({ _kind: z.literal('series'), payload: StoryBibleSeriesSchema }),
]);
```

### 7.4 内容形态差异化

| contentForm | preset | 特有字段 | 禁止字段 |
|---|---|---|---|
| short_drama / motion_comic / animation / comic | drama | villain_system, hook_system, pacing_plan.curve_stages | — |
| educational_story | series | value_themes[]（价值观清单） | villain_system, hook_system |
| picture_book | series | value_themes[], emotional_beats[] | villain_system, pacing_plan |
| documentary | series | subject_criteria, ethical_notes | villain_system, hook_system.per_episode_hook |

### 7.5 现有代码对齐

**现状**：`StoryService.buildWorldSettingFromLlm` / `buildSeriesSettingFromLlm` 在 `story-service.ts` 里直接拼字符串。

**改造**：
1. 抽出 `packages/core-services/src/ai/prompts/story-bible/index.ts`。
2. `generateStoryBible` 里改为：
   ```ts
   const pack = storyBiblePromptPack;
   const { system, user, temperature, maxTokens } = pack.build({ project, existingHints });
   const res = await callArkChat({ systemPrompt: system, prompt: user, responseFormat: 'json', temperature, maxTokens });
   const parsed = pack.schema.safeParse(JSON.parse(res.content));
   if (!parsed.success) throw providerUnavailable('LLM 输出 schema 校验失败', { errors: parsed.error.flatten() });
   // 落库 —— 除了写入 ProjectStoryBible 主体，同时写入 characters / locations 表和 visual_locks 表
   ```
3. 落库拆分：把 `character_seeds / location_seeds / visual_locks_summary` 分别写入 characters / locations 表（新增 `visual_lock_positive` `visual_lock_negative` 字段）；这样后续 Stage D/E/F 直接 SELECT。

---

## 8. Stage B · 分集 / 篇目 / 册目大纲

### 8.1 输入

| Key | 来源 |
|---|---|
| 六件套 | project |
| `world_setting_json` | ProjectStoryBible 全量 |
| `existing_episodes_summary[]` | `episodes` 表已有集合摘要（title/summary/hook_type） |
| `start_no` | 计算：max(episodeNo) + 1 |
| `count` | UI 传入（educational_story 默认 1，其余 3） |

### 8.2 Prompt 组织

**System prompt**（骨架）：

```
<role src="shared/roles/screenwriter.md" />
<output-conventions src="shared/output-conventions.md" />

<content-form-rules>
  <variant contentForm="drama">
    <load-constants>rhythm-curve, hook-types</load-constants>
    每集必须给出 hook_type ∈ {悬念, 反转, 情绪, 信息, 危机}，beat ∈ {起势, 攀升, 风暴, 决战}。
    集尾必须留强钩子，与下一集 handoff。
  </variant>
  <variant contentForm="educational-story">
    每篇聚焦一个成语/寓言。ending_hook 应为"金句"或"启示"而非悬念。
    不使用 hook_type / beat 字段。
  </variant>
  <!-- picture-book: 每册围绕一个情感目标 + emotional_beat；documentary: 每集聚焦一个真实议题 -->
</content-form-rules>

引用规则：
- 引用 character 必须使用 characters context block 里提供的 id，不允许创造新 character。
- 若剧情确需新人物，输出到 new_characters[]，由后续人工确认。

严格 JSON 输出，schema 见附件。
```

**User prompt**：

```
<block name="project">{...六件套...}</block>
<block name="world_setting">{...ProjectStoryBible 全量 JSON...}</block>
<block name="characters">
[ { "id": "CHR-song-nong", "name_zh": "宋农", "role_type": "protagonist" }, ... ]
</block>
<block name="existing_episodes">
[ { "episode_no": 1, "title": "...", "summary": "...", "hook_type": "..." }, ... ]
</block>
<task>
从第 {start_no} 集起续写 {count} 集，语言 zh-CN。
</task>
```

### 8.3 输出 zod schema

```ts
// prompts/episode-outline/schema.ts
const EpisodeDraftSchema = z.object({
  id: z.string().regex(/^EP\d{3}$/),
  episode_no: z.number().int().positive(),
  title: z.string().max(40),
  summary: z.string().max(300),
  episode_goal: z.string().max(200),
  episode_conflict: z.string().max(200),
  episode_turn: z.string().max(200),
  episode_ending_hook: z.string().max(200),
  hook_type: z.enum(['悬念', '反转', '情绪', '信息', '危机']).optional(),
  beat: z.enum(['起势', '攀升', '风暴', '决战']).optional(),
  character_refs: z.array(z.string().regex(/^CHR-/)),
  new_characters: z.array(z.object({
    id: z.string().regex(/^CHR-/),
    name_zh: z.string(),
    identity_summary: z.string(),
    visual_lock: VisualLockSchema,
  })).default([]),
});

export const EpisodeOutlineSchema = z.object({
  episodes: z.array(EpisodeDraftSchema).min(1).max(10),
});
```

### 8.4 内容形态差异化

| contentForm | 必填字段 | 可选/禁用 |
|---|---|---|
| drama 系 | hook_type, beat, episode_ending_hook（强钩子） | — |
| educational_story | value_theme（关联 world.value_themes 之一）, 结尾金句 | hook_type/beat 禁用 |
| picture_book | emotional_beat, 结尾情感落点 | hook_type/beat 禁用 |
| documentary | subject_ref, ethical_note | hook_type/beat 禁用 |

### 8.5 现有代码对齐

**改造**：`StoryService.buildEpisodeOutlineFromLlm` 已按 contentType 分支写 system prompt（本轮改动），下一步把 payload / schema 挪到 prompt 包并接 zod。

**注意**：`new_characters[]` 落库时如果自动写入 characters 表，需要一个 confirm 闸门——先写成 `pending_review` 状态，UI 上让胖哥点确认后转正式。

---

## 9. Stage C · 单集剧本骨架（新增）

### 9.1 输入

| Key | 来源 |
|---|---|
| 六件套 | project |
| `world_setting_json` | bible |
| `episode_draft` | 目标 Episode 全量 |
| `characters_involved` | 通过 episode.character_refs 关联的 characters |

### 9.2 Prompt 目标

在 Stage B 已经给出 goal/conflict/turn/hook 短句的基础上，为单集"扩写"成更完整的剧本骨架：多段 arc、每段的情感转变、每段涉及的角色和地点。**不生成台词**（台词是 Stage D/E 的活）。

### 9.3 输出 zod schema

```ts
// prompts/episode-script/schema.ts
export const EpisodeScriptSchema = z.object({
  episode_id: z.string().regex(/^EP\d{3}$/),
  refined_summary: z.string().max(500),
  arc_beats: z.array(z.object({
    beat_no: z.number().int().positive(),
    beat_type: z.enum(['setup', 'inciting', 'rising', 'midpoint', 'reversal', 'climax', 'resolution']),
    title: z.string().max(40),
    description: z.string().max(300),
    character_refs: z.array(z.string().regex(/^CHR-/)),
    location_refs: z.array(z.string().regex(/^LOC-/)).default([]),
    emotional_shift: z.string().max(120),   // 主角情绪转变
  })).min(4).max(8),
  key_moments: z.array(z.string()).min(1).max(5),  // 供拆场 hint
});
```

### 9.4 内容形态差异化

- drama 系：arc_beats 走 setup→inciting→rising→midpoint→reversal→climax→resolution。
- educational_story：arc_beats 简化为 情境建立 → 主角错误尝试 → 挫折/冲突 → 领悟 → 金句。
- picture_book：每 beat 对应一个"跨页 hint"，直接产出 5–8 个跨页目录。
- documentary：arc_beats 走 议题引入 → 人物切面 → 张力升级 → 开放式追问。

### 9.5 现有代码对齐

**新增**：`StoryService.refineEpisodeScript(episodeId)`，落库把 `arc_beats[]` 写入 `episodes.arc_beats_json` 新字段（migration 增加），或写入 `episode_arc_beats` 新表。

UI 层：`/story/episode/[id]` 增加 "🧠 AI 展开剧本骨架" 按钮，紧接现有"确认本篇故事"之后。

---

## 10. Stage D · 场景 / 分场 / 段落 / 跨页拆分

### 10.1 输入

| Key | 来源 |
|---|---|
| 六件套 | project |
| `episode_script_json` | Stage C 产物（arc_beats + key_moments） |
| `characters_involved` | 涉及的 characters 全量（含 visual_lock） |
| `locations_involved` | 涉及的 locations 全量（含 visual_lock） |
| `props_available` | 项目级 props（含 visual_lock） |
| `count` | 建议：drama 4–6，education 3–5，picture_book 8–12（跨页数），documentary 4–8 |

### 10.2 Prompt 组织

**System prompt**（骨架）：

```
<role src="shared/roles/storyboard-director.md" />
<output-conventions src="shared/output-conventions.md" />

<content-form-rules>
  <variant contentForm="drama">
    每 scene 必须给出 dramatic_goal / conflict / duration_estimate_seconds (30-90) / hook_end。
    第 1 场建立情境；最后 1 场推进集尾钩子；中段升级冲突。
  </variant>
  <variant contentForm="educational-story">
    每段承担一个叙事任务: 起因 / 尝试 / 挫折 / 领悟 / 金句。
    每段 20-40 秒。
  </variant>
  <variant contentForm="picture-book">
    输出跨页 (spread) 数组。每 spread 只承载一个可视化情感节拍。
    每 spread ≤ 120 字文字, 一个主要画面。
  </variant>
</content-form-rules>

引用规则：
- scene.character_ids 必须来自 characters context block 提供的 id。
- scene.location_id 必须来自 locations context block（若确无合适位置可留空并解释）。
- scene.prop_refs 必须来自 props context block（可空数组）。

严格 JSON 输出。
```

**User prompt**：把 characters / locations / props / episode_script_json 全部作为 `<block>` 注入。

### 10.3 输出 zod schema

```ts
const SceneSchema = z.object({
  id: z.string().regex(/^SC-EP\d{3}-\d{3}$/),
  scene_no: z.number().int().positive(),
  title: z.string().max(40),
  summary: z.string().max(300),
  dramatic_goal: z.string().max(200),
  conflict: z.string().max(200),
  time_of_day: z.enum(['dawn', 'day', 'dusk', 'night']),
  duration_estimate_seconds: z.number().int().min(5).max(300),
  hook_end: z.string().max(150).optional(),      // 场尾钩子（drama 系）
  character_ids: z.array(z.string().regex(/^CHR-/)),
  location_id: z.string().regex(/^LOC-/).optional(),
  prop_refs: z.array(z.string().regex(/^PROP-/)).default([]),
  emotional_beat: z.string().max(80).optional(), // picture_book / education
});

export const SceneOutlineSchema = z.object({
  scenes: z.array(SceneSchema).min(2).max(20),
});
```

### 10.4 现有代码对齐

**现状**：`StoryboardService.buildScenesFromLlm` 已按 contentType 分支（本轮改动）。

**改造**：
1. 拆到 prompt 包 `scene-outline/index.ts`。
2. **补充 context block**：user prompt 追加 characters/locations/props JSON。当前只传 episode 元数据。
3. 接 zod，`character_ids` 引用不在 context 里 → 校验失败，抛错重试。
4. 落库时把 `character_ids` 写入 `scene_characters` 关联表；`location_id` 写入 scenes.location_id。

---

## 11. Stage E · 关键帧规格（Keyframe Plan，新增）

### 11.1 输入

| Key | 来源 |
|---|---|
| 六件套 | project |
| `scene` | Scene 全量 |
| `characters_in_scene` | 该场涉及的 characters（含 visual_lock） |
| `location_in_scene` | 该场 location（含 visual_lock） |
| `props_in_scene` | 该场涉及的 props |
| `style_reference` | 项目级 style（如"皮克斯"/"水墨"，来自 `projects.visual_style`） |

### 11.2 Prompt 目标

为每个 scene 生成"首尾两个 keyframe"（对齐 seedance 首尾帧模式）：
- **KF-A (Start Frame)**：场景开始的静态画面。
- **KF-B (End Frame)**：场景结束的静态画面（对应戏剧转折）。

每个 keyframe 只描述**画面构成**，不写风格/参数（风格由 image prompt 层追加）。

### 11.3 输出 zod schema

```ts
const KeyframeSpecSchema = z.object({
  id: z.string().regex(/^KF-SC-EP\d{3}-\d{3}-[AB]$/),
  scene_id: z.string().regex(/^SC-EP\d{3}-\d{3}$/),
  role: z.enum(['start', 'end']),
  camera: z.object({
    shot_size: z.enum(['ELS', 'LS', 'MS', 'MCU', 'CU', 'ECU']),
    angle: z.enum(['eye_level', 'high_angle', 'low_angle', 'birds_eye', 'dutch']),
    movement: z.enum(['static', 'pan', 'tilt', 'push_in', 'pull_out', 'tracking']).optional(),
  }),
  subject: z.object({
    character_ids: z.array(z.string().regex(/^CHR-/)),
    action_zh: z.string().max(150),
    expression_zh: z.string().max(80).optional(),
  }),
  environment: z.object({
    location_id: z.string().regex(/^LOC-/),
    time_of_day: z.enum(['dawn', 'day', 'dusk', 'night']),
    weather: z.string().max(40).optional(),
    lighting_zh: z.string().max(120),
  }),
  props_visible: z.array(z.string().regex(/^PROP-/)).default([]),
  composition_hint_zh: z.string().max(200),   // 构图提示（对角线、居中、留白等）
});

export const KeyframePlanSchema = z.object({
  keyframes: z.array(KeyframeSpecSchema).length(2),  // 每场固定 A + B
});
```

### 11.4 现有代码对齐

**新增**：`StoryboardService.generateKeyframePlan(sceneId)`。落库写入 `keyframes` 表（现有实体），并把 `character_ids`、`location_id` 写关联字段。

---

## 12. Stage F · 图像 Prompt 生成（image-prompt，新增）

### 12.1 输入

| Key | 来源 |
|---|---|
| `keyframe` | Stage E 产物 |
| `character_visual_locks[]` | 场景 characters 的 visual_lock 短语 |
| `location_visual_lock` | 场景 location 的 visual_lock |
| `style_reference` | 项目级 visual_style（如"皮克斯 3D"/"水墨"/"日式漫画"） |
| `few_shot_examples` | 内置 1-2 条高质量 seedream prompt 示例 |

### 12.2 Prompt 组织

**System prompt**（few-shot 版）：

```
<role src="shared/roles/image-prompt-engineer.md" />

你是 doubao-seedream-5-0-260128 的 prompt 工程师。目标：把 KeyframeSpec 转成
一条可以直接投给 seedream 的 image prompt。

规则：
1. positive prompt 用英文，逗号分隔；≤ 60 tokens。
2. 首段是主体（character visual_locks + 动作），次段是环境（location visual_lock + light + weather），末段是风格（style_reference + camera + composition）。
3. negative prompt 用英文，逗号分隔，包含 character visual_lock_negative 汇总。
4. 严禁在 prompt 里写中文（除非用户明确要求中文水印）。
5. 输出严格 JSON，含 positive / negative / aspect_ratio / steps / cfg。

<few-shot examples>
KeyframeSpec (input) → ImagePromptSpec (output) 示例（内置 1-2 条）
</few-shot>

<style-mapping>
  { "皮克斯 3D": "pixar 3d style, cinematic lighting, sub-surface scattering",
    "水墨":     "traditional chinese ink painting, sumi-e, rice paper texture, minimalist",
    "日式漫画":  "manga style, screentone, cel-shaded, expressive lineart" }
</style-mapping>
```

### 12.3 输出 zod schema

```ts
export const ImagePromptSpecSchema = z.object({
  id: z.string().regex(/^IMG-KF-/),
  keyframe_id: z.string().regex(/^KF-/),
  positive: z.string().max(500),
  negative: z.string().max(400),
  aspect_ratio: z.enum(['9:16', '16:9', '1:1', '4:5', '3:4']),
  steps: z.number().int().min(20).max(60),
  cfg: z.number().min(2).max(15),
  seed: z.number().int().optional(),           // 可选，用于 A/B 复用同一 seed
  reference_image_ids: z.array(z.string()).default([]),  // 引用 characters 已有参考图
});
```

### 12.4 落地路径

- `PromptCompilerService.compileImagePrompt(keyframeId)` 返回 `ImagePromptSpec`。
- 该阶段可选走 LLM（推荐）或走**纯代码模板**拼接（更省钱 —— visual_lock 已经把大部分工作做完了）。**建议模板拼接为主，LLM 只做"补齐 composition"**。
- 后续 `callArkImage(spec)` 消费。

---

## 13. Stage G · 视频 Prompt 生成（video-prompt，新增）

### 13.1 输入

| Key | 来源 |
|---|---|
| `scene` | Scene 全量 |
| `keyframe_start / keyframe_end` | 首尾 KeyframeSpec |
| `dialogue_blocks[]` | 该场对白（若已录入） |
| `visual_locks[]` | 场景 characters/location 的 visual_lock |

### 13.2 Prompt 组织与输出

给 seedance 2.0-mini 的 prompt 需要三段：**motion 描述**、**镜头运动**、**首尾帧一致性提示**。

```ts
export const VideoPromptSpecSchema = z.object({
  id: z.string().regex(/^VID-SC-/),
  scene_id: z.string().regex(/^SC-EP\d{3}-\d{3}$/),
  motion_positive: z.string().max(500),        // 英文，主体动作 + 环境动态
  camera_motion: z.string().max(200),          // "slow push-in", "handheld tracking" 等
  duration_seconds: z.number().min(3).max(15),  // seedance 单次上限
  start_keyframe_id: z.string().regex(/^KF-/),
  end_keyframe_id: z.string().regex(/^KF-/),
  negative: z.string().max(400),
  audio_hint: z.string().max(200).optional(),   // 供后期 TTS/BGM 参考
});
```

### 13.3 落地建议

- 与 Stage F 类似，**模板拼接为主 + LLM 补 motion 语义**。
- 一次 seedance call 可能返回 5–10s 视频，长镜头拆成多个 scene。

---

## 14. Ark 调用参数矩阵

| Stage | 模型 | temperature | max_tokens | response_format | 备注 |
|---|---|---|---|---|---|
| A. Story Bible | doubao-seed-2-0-lite | 0.55 | 8192 | json_object | 一次调用产出 world + seeds |
| B. Episode Outline | doubao-seed-2-0-lite | 0.5 | 4096 | json_object | 每批 ≤ 5 集 |
| C. Episode Script | doubao-seed-2-0-lite | 0.65 | 4096 | json_object | 单集一次调用 |
| D. Scene Outline | doubao-seed-2-0-lite | 0.4 | 4096 | json_object | 单集一次调用 |
| E. Keyframe Plan | doubao-seed-2-0-lite | 0.4 | 2048 | json_object | 单 scene 一次调用 |
| F. Image Prompt | doubao-seed-2-0-lite | 0.2 | 1024 | json_object | 单 keyframe 一次调用；few-shot |
| G. Video Prompt | doubao-seed-2-0-lite | 0.2 | 1024 | json_object | 单 scene 一次调用；few-shot |
| Ping | doubao-seed-2-0-lite | 0 | 5 | — | 现有 `/api/ai/verify` 5-token 试探 |

**失败重试**：所有阶段一次 zod 校验失败后重试一次（`temperature -= 0.1`）；仍失败抛 `provider_unavailable`，前端展示。

---

## 15. 校验与失败处理策略

### 15.1 错误分类

| 错误 | 触发条件 | 抛出 |
|---|---|---|
| `provider_unavailable` (未配 key) | `isProviderReady() === false` | 立即抛；前端引导至 `/models` |
| `provider_unavailable` (LLM 失败) | `AiUpstreamError` | 直接抛；`retryable: true` |
| `provider_unavailable` (schema 校验) | `zod.safeParse().success === false` | 重试 1 次后抛；`details: { errors: ... }` |
| `provider_unavailable` (数量不符) | e.g. episode count ≠ 期望 | 重试 1 次后抛 |
| `validation_failed` (引用不存在) | e.g. scene.character_ids 引用未知 CHR | 抛；details 里列出未知 ID；用户可选择"这些是新角色→加入" |

### 15.2 引用一致性检查

zod schema 只能做格式校验，**引用是否存在**要靠后端二次校验：

```ts
function validateReferences(scenes: SceneDraft[], ctx: SceneOutlineContext) {
  const knownChars = new Set(ctx.characters.map(c => c.id));
  const knownLocs = new Set(ctx.locations.map(l => l.id));
  const knownProps = new Set(ctx.props.map(p => p.id));
  for (const s of scenes) {
    for (const cid of s.character_ids) {
      if (!knownChars.has(cid)) throw providerUnavailable(`LLM 引用了未知角色 ${cid}`, { unknownId: cid });
    }
    if (s.location_id && !knownLocs.has(s.location_id)) {
      throw providerUnavailable(`LLM 引用了未知地点 ${s.location_id}`, { unknownId: s.location_id });
    }
    for (const pid of s.prop_refs ?? []) {
      if (!knownProps.has(pid)) throw providerUnavailable(`LLM 引用了未知道具 ${pid}`, { unknownId: pid });
    }
  }
}
```

---

## 16. 落地路径（3 步走）

### Step 1（第 1 周）—— 把现有 4 个 chat 调用搬到 prompt 包 + 接 zod

**改动清单**：
1. 建 `packages/core-services/src/ai/prompts/` 目录；shared/{roles,constants,output-conventions,loader,context-builder}。
2. `story-bible/` + `episode-outline/` + `scene-outline/` 三个 prompt 包完整落地（system.ts/user.ts/schema.ts）。
3. `StoryService.generateStoryBible` / `generateEpisodeOutline`、`StoryboardService.generateScenes` 改成 `pack.build → callArkChat → pack.schema.parse` 三段式。
4. 增加 zod 引用一致性检查（Scene Outline 阶段）。
5. DB migration：`characters` 表新增 `visual_lock_positive` `visual_lock_negative` 列；`projects` 表新增 `mode` `language` 列（可选，先 hardcode）。
6. 联调：跑一遍成语故事 + 短剧两条链路，验证 zod 全绿。

**风险**：现有 `character_seeds` / `location_seeds` 未必都能一次 LLM 出全，需要给"不足时补齐"的回填按钮。

### Step 2（第 2–3 周）—— 补齐 Episode Script + Keyframe Plan + Image Prompt

**改动清单**：
1. 新增 `episode-script/` + `keyframe-plan/` + `image-prompt/` prompt 包。
2. `StoryService.refineEpisodeScript(episodeId)` + `StoryboardService.generateKeyframePlan(sceneId)` + `PromptCompilerService.compileImagePrompt(keyframeId)`。
3. UI 层：`/story/episode/[id]` 新增"AI 展开骨架"；`/storyboards` 新增"AI 生成关键帧"；`/prompts` 新增"编译 image prompt"。
4. 接入 `callArkImage` —— seedream 5.0 首次真正被调用（先手动挑一个 keyframe 试出图）。
5. 建 `image_prompt_specs` 表（新实体）。

### Step 3（第 4 周）—— 视频 Prompt + 一致性锁全链路 + 用户可覆盖 prompt

**改动清单**：
1. `video-prompt/` prompt 包。
2. `callArkVideo` 首次接入 —— seedance 2.0-mini 首尾帧模式。
3. 建 `video_prompt_specs` 表 + `video_generation_jobs` 表（异步轮询）。
4. 建 `ai_prompt_overrides` 表：`(stageId, contentForm, promptType, body)`；`/models` 页新增"Prompt 编辑器"（Phase 2 加，非阻塞）。
5. 全链路一致性验证：跑一集守株待兔 → world → outline → script → scenes → keyframes → images → video，人工评估同一角色跨镜一致性。

---

## 17. 附录 A · 完整 zod schema 索引

- `story-bible/schema.ts` — StoryBibleSchema (drama | series) + CharacterSeed + LocationSeed + VisualLock
- `episode-outline/schema.ts` — EpisodeOutlineSchema
- `episode-script/schema.ts` — EpisodeScriptSchema
- `scene-outline/schema.ts` — SceneOutlineSchema
- `keyframe-plan/schema.ts` — KeyframePlanSchema
- `image-prompt/schema.ts` — ImagePromptSpecSchema
- `video-prompt/schema.ts` — VideoPromptSpecSchema

## 附录 B · shared/output-conventions.md 内容骨架

```md
# 输出约定（所有 stage 通用）

## 1. 语言
- 除 `visual_lock` / `image_prompt.positive` / `image_prompt.negative` / `video_prompt.motion_positive` 用英文外，一律简体中文。

## 2. JSON 输出
- 返回单一 JSON 对象；不得加 markdown 代码围栏。
- 未知字段禁止输出。
- 字段名遵循 snake_case。

## 3. ID 规范
- ...（同 §6.1 表格）

## 4. 引用规则
- 只能引用 user prompt `<block name="characters/locations/props">` 中提供的 ID。
- 确需新实体时，输出到对应的 `new_*[]` 数组，视为待确认草稿。

## 5. Visual Lock
- 生成新 character / location / prop 时，必须提供 `visual_lock.positive`（英文，≤ 15 词）。
- `visual_lock.negative` 可选，用于抵消常见幻觉。

## 6. 时长与字数
- picture_book 单跨页文字 ≤ 120 字。
- educational_story 单段解说 ≤ 200 字。
- documentary 单段解说 30–60 秒（按 220 字/分钟估算）。
```

## 附录 C · 与参考项目对应关系（速查）

| 本方案模块 | 灵感来源 |
|---|---|
| shared/constants/懒加载 | 0xsline `references/*.md` + 命令级懒加载 |
| variants md 分支 | huobao-drama 多语言 skill 变体 |
| JSON schema 强约束 + response_format | UllrAI/CineGen `responseSchema` |
| visual_lock 一致性锁短语 | zenstory `LOCK-*` 连续性锁 |
| ID 化跨阶段引用 | zenstory `SHOT-EP001-002` / `IMG-*` / `MOTION-*` |
| Prompt 目录 + frontmatter | huobao SKILL.md YAML |
| Python 校验器 → zod + reference check | zenstory `creator_markdown_check.py` 的思想在 TS 侧落地 |
| few-shot（仅 image/video） | 全体项目共识：文本结构化不用示例，图像/视频用 |

---

## 结语

这套方案的核心是把"传给 LLM 的东西"从"字符串拼接"升级成"数据契约"：
- 上游产物是**数据块**，不是散文。
- 输出是 **zod schema**，不是自由 markdown。
- 引用是 **ID**，不是名字。
- 一致性是 **visual_lock 短语**，不是描述。
- 内容形态是 **variants md 分支**，不是 if-else 拼字符串。

按 Step 1→3 落地节奏，第 1 周就能看到"守株待兔"跑通 world→outline→scene 的强 schema 链路，第 3 周开始出图，第 4 周出视频；同时 prompt 层与代码解耦，未来迭代 prompt 不需要动 service 层。
