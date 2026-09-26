# printfilm-next 工作流 × LLM 数据构建 综合方案 v1

> 作者：小叮当（协作 · 胖哥）
> 生成时间：2026-09-24
> 版本：**综合版 v1** — 融合三份前置材料 + doubao 官方接口文档新发现

## 前置材料索引

| # | 材料 | 定位 |
|---|---|---|
| M1 | [prompt 工程调研报告](../research/prompt-engineering-references-v1.md) | 4 个开源项目（0xsline / huobao / CineGen / zenstory）prompt 组织模式 |
| M2 | [LLM 接口清单](../research/llm-interfaces-inventory-v1.md) | printfilm-next 当前已接入的 4 个 Ark chat 调用点 |
| M3 | [工作流 × LLM 数据构建落地方案 v1](workflow-and-llm-data-plan-v1.md) | Stage A-G 骨架 + prompt 包目录 + zod schema |
| **M4** | **doubao 官方接口文档新分析** | **本方案新增：8 个关键参数修正** |

本方案 = M3 骨架 + M1 共识 + M2 现状 + **M4 参数修正**。

---

## 0. TL;DR（一屏结论）

- **接口文档 8 条修正必须落地**：`watermark=false` 显式关闭、图片改用 `b64_json` 避免 24h 过期、`size` 走档位制、视频补齐 `resolution/ratio/duration/generate_audio/return_last_frame`、启用 `sequential_image_generation` 出连贯分镜组图、`generate_audio=true` 直出有声视频、`layer_decomposition` 拆图层（P2）。
- **Stage F 图像阶段升级为双模式**：单图（seedream 单次）+ **组图（sequential_image_generation，单次 ≤ 15 张连贯分镜）**——这是分镜阶段的重大变化，能把"一场 4 帧关键画面"从 4 次调用压到 1 次，且一致性由 Ark 侧保证。
- **Stage G 视频阶段参数结构化**：把 `resolution / ratio / duration / camera_fixed / generate_audio / return_last_frame` 从"零散字段"提为 zod 里的一等公民；`return_last_frame` 让镜头间末帧成为下一镜头的首帧，天然做首尾帧接力。
- **无 stub、失败即抛、zod 强约束**：Ark `response_format=json_object` + zod 二次校验，schema 失败重试 1 次；引用一致性检查兜底。
- **P0（第 1 周）落地范围**：改 4 个已有 chat 调用（world / episode / scene）到 prompt 包 + zod + 修正 `watermark/size`；把现有 `callArkImage` 接入首个 keyframe 出图；把 `callArkVideo` 补齐 body 结构（尚未开出图）。
- **P1（2–3 周）**：Stage C 剧本骨架 + Stage E 关键帧规格 + Stage F 组图 API 首次跑通 5 张分镜。
- **P2（4 周+）**：Stage G 视频（含 generate_audio 直出有声 + return_last_frame 接力）+ Stage H layer_decomposition 分层出图 + `ai_prompt_overrides` 用户可编辑 prompt。

---

## 1. 接口文档 8 条关键修正（M4 → 方案映射）

| # | 修正点 | 默认值/风险 | 本方案对策 | 影响阶段 |
|---|---|---|---|---|
| 1 | **`watermark` 显式关闭** | 默认 `true` → 生产图/视频会带水印 | 所有 image/video call body 强制 `watermark: false` | F / G |
| 2 | **图片返回改用 `b64_json`** | 默认 `url` 24h 过期 → 落库后失效 | image body 加 `response_format: "b64_json"`，落库前存 blob/base64 或转存本地 | F |
| 3 | **`size` 档位制** | 不是任意 `WxH`；只接受档位（如 `1024x1024 / 1024x1792 / 1792x1024`） | 建 `IMAGE_SIZE_PRESETS`，UI 只暴露档位选择；zod 校验必须命中档位 | F |
| 4 | **视频 body 缺关键参数** | `resolution / ratio / duration / camera_fixed / generate_audio / return_last_frame` 都要显式传 | Stage G VideoPromptSpec 把这些提为一等公民字段，服务层根据 spec 组装 body | G |
| 5 | **`sequential_image_generation`（组图 API）** | 单次可出 **≤ 15 张连贯图**，一致性由 Ark 保证 | Stage F 新增"组图模式"，用于"一场 N 帧关键画面"一次生成 | F（新能力） |
| 6 | **`generate_audio` 默认 `true`** | seedance 直接产出**带音频**的视频 | Stage G 输出中把 dialogue / voice_hint / bgm_hint 作为 audio spec 一并传；无声场景显式 `false` | G |
| 7 | **`return_last_frame`** | 视频完成后可返回**末帧图**（供下一镜头当首帧） | Stage G 每 clip 默认 `return_last_frame: true`；下一 clip 的 `image_url` 直接用上一 clip 的末帧 → 天然接力 | G |
| 8 | **`layer_decomposition`（图层拆分）** | 可以让 seedream 输出**前景 / 背景 / 角色 / 元素**分层 PNG | Stage H（新增，P2）：分层出图后 UI 支持"替换背景/换角色"精修合成 | H（新能力） |

**核心结论**：M4 让 Stage F/G 从"能出图/能出视频"升级为"能出**可用于生产的**图/视频"。P0 必须先解决 1/2/3（水印 + b64 + 档位）——否则 seedream 出的图 24h 后就找不到 URL、还带水印，等于白算钱。

---

## 2. 从 4 个参考项目共识提炼的方法论（M1 → 本方案）

| 参考项目 | 关键做法 | 本方案继承为 |
|---|---|---|
| 0xsline `references/*.md` 懒加载 | 按命令拆参考文档，避免 mega system prompt | `shared/constants/*.md` + `pack.build(ctx).loadConstants[]` 按阶段/形态选装 |
| huobao YAML frontmatter skill 包 + DB override | prompt 与代码解耦，可被用户覆盖 | `prompts/<stage>/system.ts` + Phase 2 加 `ai_prompt_overrides` 表 |
| CineGen `responseSchema` + `responseMimeType=json` | Gemini 层做 schema 强约束 | Ark `response_format={type:'json_object'}` + zod 二次校验 |
| zenstory `LOCK-*` 连续性锁 + ID 化跨阶段引用 | 一致性用**短语锁**而非描述 | `visual_lock` 短语 + `WORLD-/EP/SC-/CHR-/LOC-/PROP-/KF-/IMG-/VID-/LOCK-` ID 规范 |
| 全体共识：**几乎不用 few-shot**（除 image/video） | 规则 + schema 够压，少用示例省 token | 文本阶段 A-E 不用 few-shot；F/G 内置 1-2 条示例 |

**方法论一句话**：**把"传给 LLM 的东西"从字符串拼接升级成数据契约** —— 上游产物是数据块，输出是 zod schema，引用是 ID，一致性是 visual_lock 短语，内容形态是 variants md 分支。

---

## 3. 阶段全景图（M3 + M4 综合修正版）

```
Stage       输入 context               LLM 调用         输出实体              新变化(vs M3)
────────────────────────────────────────────────────────────────────────────────────────
A. World    project 六件套              chat            ProjectStoryBible    (承袭 v1)
  Set       + existing_hints          doubao-lite     + character_seeds
                                      T=0.55/8192     + location_seeds
                                                      + visual_locks
────────────────────────────────────────────────────────────────────────────────────────
B. Outline  world_json + prev_eps     chat            Episode[] draft      (承袭 v1)
                                      T=0.5/4096
────────────────────────────────────────────────────────────────────────────────────────
C. Script   episode + world + chars   chat            EpisodeScript        ✨ 新增
  Skeleton                            T=0.65/4096     (arc_beats[])         (承袭 v1)
────────────────────────────────────────────────────────────────────────────────────────
D. Scene    ep_script + chars +       chat            Scene[] skeleton     (承袭 v1)
  Outline   locations + props         T=0.4/4096      + char_ids/loc_id
────────────────────────────────────────────────────────────────────────────────────────
E. Keyframe scene + chars/locs +      chat            KeyframeSpec[]        ✨ 新增
  Plan      visual_locks              T=0.4/2048      (start + end)         (承袭 v1)
────────────────────────────────────────────────────────────────────────────────────────
F. Image    KeyframeSpec[] +          chat →          ImagePromptSpec       ★ 双模式:
  Prompt    visual_locks +            (few-shot)      → 触发 seedream       (1) 单图
            style_reference          T=0.2/1024                             (2) 组图 (M4#5)
                                                                              新增 batch_size≤15
────────────────────────────────────────────────────────────────────────────────────────
G. Video    KF_start/KF_end +         chat →          VideoPromptSpec       ★ 补齐 body:
  Prompt    dialogue + visual_locks   (few-shot)      → 触发 seedance         resolution/ratio
                                      T=0.2/1024      (含 audio_spec)         /duration
                                                                              /generate_audio (M4#6)
                                                                              /return_last_frame (M4#7)
────────────────────────────────────────────────────────────────────────────────────────
H. Layer    (可选) 已有 image +       chat →          LayerDecompSpec       ✨ 新增 P2 (M4#8)
  Decomp    layer_hints              T=0.2/512       → 触发 seedream         前/背景/角色/元素
                                                      layer_decomposition    分层 PNG
```

---

## 4. 每阶段详细方案

> 每个阶段固定 5 小节：**输入 context / Prompt 组织 / 输出 zod schema / Ark body（M4 修正版）/ P 优先级**。
> Stage A-E 的 prompt 骨架和 zod schema 承袭 M3，本文只写差异和 Ark body 变化。

### 4.A · World Setting（P0）

**输入**：project 六件套（name / content_form / project_type / genre / tone / audience）+ `existing_hints`。

**Prompt 组织**（承袭 M3 §7.2）：`shared/roles/worldbuilder.md` + `variants/{drama|educational-story|picture-book|documentary}.md` + `output-conventions`。

**输出 zod schema**（承袭 M3 §7.3）：`StoryBibleSchema = discriminatedUnion('_kind', [drama, series])`；每个 seed 必须含 `visual_lock.positive ≤ 15 英文词`。

**Ark chat body**（M4 无特殊修正）：

```jsonc
POST https://ark.cn-beijing.volces.com/api/v3/chat/completions
{
  "model": "doubao-seed-2-0-lite-260428",
  "messages": [
    { "role": "system", "content": "<systemPrompt>" },
    { "role": "user",   "content": "<userPrompt with blocks>" }
  ],
  "temperature": 0.55,
  "max_tokens": 8192,
  "response_format": { "type": "json_object" }
}
```

**P 优先级**：**P0**（已接入，本轮已按 contentType 分支；剩下的是拆到 prompt 包 + zod）。

---

### 4.B · Episode Outline（P0）

**输入**：project 六件套 + `world_setting_json` + `existing_episodes_summary[]` + `start_no` + `count`。

**Prompt 组织**：drama 系加载 `rhythm-curve / hook-types`；education / picture_book / documentary 各自 variant md。

**输出 zod schema**：`EpisodeOutlineSchema` 含 `hook_type ∈ {悬念/反转/情绪/信息/危机}`（drama 系必填）、`beat ∈ {起势/攀升/风暴/决战}`（drama 系必填）。

**Ark chat body**：`temperature: 0.5, max_tokens: 4096, response_format: json_object`。

**P 优先级**：**P0**（已接入 + 已内容形态分支；剩下 zod + 引用校验）。

---

### 4.C · Episode Script Skeleton（P1，新增）

**输入**：project 六件套 + `world_setting_json` + `episode_draft` + `characters_involved[]`。

**Prompt 目标**：把 Stage B 给出的短句 goal/conflict/turn/hook **扩写成 4-8 个 arc_beats**，每 beat 含 emotional_shift + character_refs + location_refs。**不产台词**。

**输出 zod schema**（承袭 M3 §9.3）：

```ts
export const EpisodeScriptSchema = z.object({
  episode_id: z.string().regex(/^EP\d{3}$/),
  refined_summary: z.string().max(500),
  arc_beats: z.array(z.object({
    beat_no: z.number().int().positive(),
    beat_type: z.enum(['setup','inciting','rising','midpoint','reversal','climax','resolution']),
    title: z.string().max(40),
    description: z.string().max(300),
    character_refs: z.array(z.string().regex(/^CHR-/)),
    location_refs: z.array(z.string().regex(/^LOC-/)).default([]),
    emotional_shift: z.string().max(120),
  })).min(4).max(8),
  key_moments: z.array(z.string()).min(1).max(5),
});
```

**Ark chat body**：`temperature: 0.65, max_tokens: 4096`。

**P 优先级**：**P1**（新增；`StoryService.refineEpisodeScript`）。

---

### 4.D · Scene Outline（P0）

**输入**：episode_script + world + `characters[]` + `locations[]` + `props[]`（全部作为 `<block>` 注入 user prompt）。

**Prompt 组织**：drama 系必填 `dramatic_goal / conflict / duration_estimate_seconds (30-90) / hook_end`；picture_book 输出 spread 数组；educational_story 每段承担 起因/尝试/挫折/领悟/金句 之一。

**输出 zod schema**（承袭 M3 §10.3）：`SceneSchema.character_ids[]` 必须命中 context 提供的 CHR 集合，后端二次校验。

**Ark chat body**：`temperature: 0.4, max_tokens: 4096`。

**P 优先级**：**P0**（已接入 + 已内容形态分支；剩下补 characters/locations/props context block + zod 引用校验）。

---

### 4.E · Keyframe Plan（P1，新增）

**输入**：scene 全量 + `characters_in_scene[]` + `location_in_scene` + `props_in_scene[]` + `visual_locks[]` + `style_reference`。

**Prompt 目标**：每 scene 输出**首尾两帧** KF-A（Start）+ KF-B（End），对齐 seedance 首尾帧模式。**不写风格/参数**（这些属于 Stage F）。

**输出 zod schema**（承袭 M3 §11.3）：`KeyframePlanSchema.keyframes.length === 2`，含 camera + subject + environment + composition_hint。

**Ark chat body**：`temperature: 0.4, max_tokens: 2048`。

**P 优先级**：**P1**（新增；`StoryboardService.generateKeyframePlan(sceneId)`）。

---

### 4.F · Image Prompt & 生成（P0 单图 / P1 组图）

这是本次接口文档修正**影响最大**的阶段。**双模式**：

#### 模式 F1 · 单图（seedream 单次）

**输入**：单个 KeyframeSpec + `character_visual_locks[]` + `location_visual_lock` + `style_reference`。

**中间产物**（先 LLM 编排一条 positive/negative）：

```ts
export const ImagePromptSpecSchema = z.object({
  id: z.string().regex(/^IMG-KF-/),
  keyframe_id: z.string().regex(/^KF-/),
  positive: z.string().max(500),     // 英文，逗号分隔
  negative: z.string().max(400),
  size_preset: z.enum([              // ★ M4#3 档位制
    '1024x1024', '1024x1792', '1792x1024',
    '2048x2048', '1152x2048', '2048x1152',
  ]),
  aspect_ratio: z.enum(['1:1','9:16','16:9','4:5','3:4','2:3']),
  seed: z.number().int().optional(),
  reference_image_ids: z.array(z.string()).default([]),
});
```

**Ark image body**（M4#1/#2/#3 修正）：

```jsonc
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "<positive>",
  "negative_prompt": "<negative>",
  "size": "1024x1792",                // ★ M4#3 档位
  "n": 1,
  "response_format": "b64_json",       // ★ M4#2 用 base64 避 24h 过期
  "watermark": false,                  // ★ M4#1 显式关水印
  "guidance_scale": 5.5,
  "seed": 12345                        // 可选，用于 A/B 重出
}
```

**落库**：`response.data[].b64_json` → 立即 base64 decode 写本地文件 `data/images/IMG-KF-*.png` 并入库 `image_assets` 表（新增），**不保留 URL 引用**。

---

#### 模式 F2 · 组图（sequential_image_generation，★ M4#5 新能力）

**用途**：一场 scene 需要 **N 张（≤15）连贯**关键画面（分镜、多角度、多情绪表情）—— 用组图 API 一次搞定，Ark 侧保证角色/画风一致。

**触发条件**：`KeyframePlan.keyframes.length > 2` 或 UI 主动选择"生成分镜组图"。

**中间产物**：

```ts
export const ImageBatchSpecSchema = z.object({
  id: z.string().regex(/^IMGBATCH-SC-/),
  scene_id: z.string().regex(/^SC-EP\d{3}-\d{3}$/),
  base_prompt: z.string().max(500),        // 共享的角色/环境 lock 短语
  frames: z.array(z.object({               // 每帧的差异描述
    frame_no: z.number().int().positive(),
    delta_prompt: z.string().max(200),     // 相对 base 的差异（动作/表情/镜头）
    keyframe_id: z.string().regex(/^KF-/).optional(),
  })).min(2).max(15),
  size_preset: z.enum([...]),
  aspect_ratio: z.enum([...]),
});
```

**Ark image body**（假设 doubao 组图 API 结构，具体字段名以官方文档为准）：

```jsonc
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "<base_prompt>\n---\nFrame 1: <delta_1>\nFrame 2: <delta_2>\n...",
  "sequential_image_generation": {          // ★ M4#5
    "enabled": true,
    "batch_size": 6                          // ≤ 15
  },
  "size": "1024x1792",
  "response_format": "b64_json",
  "watermark": false
}
```

**优势**：
1. 一致性由 Ark 侧保证，比"6 次单图 + 参考图" 更稳。
2. 一次调用成本远低于 6 次。
3. 特别适合 educational_story / picture_book —— 一次出完整一册的所有跨页画面。

**P 优先级**：单图 **P0**（尽早跑通首个 keyframe 出图验证 M4 修正）；组图 **P1**（改 Stage E 输出 N 帧后再接）。

---

### 4.G · Video Prompt & 生成（P2）

M4#4/#6/#7 让视频阶段的参数结构化并升级为**天然可接力**的能力。

**输入**：scene + KF_start + KF_end + `dialogue_blocks[]`（若有）+ `visual_locks[]` + `previous_clip_last_frame`（若非首镜头）。

**输出 zod schema**（M4 补齐版）：

```ts
export const VideoPromptSpecSchema = z.object({
  id: z.string().regex(/^VID-SC-/),
  scene_id: z.string().regex(/^SC-EP\d{3}-\d{3}$/),

  // === 内容 ===
  motion_positive: z.string().max(500),       // 英文，主体动作 + 环境动态
  motion_negative: z.string().max(400),
  camera_motion: z.string().max(200),          // "slow push-in" / "handheld"

  // === M4#4 视频体一等公民参数 ===
  resolution: z.enum(['480p', '720p', '1080p']),  // 具体档位以官方为准
  ratio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4']),
  duration: z.number().int().min(3).max(15),      // seedance 2.0-mini 单次上限
  camera_fixed: z.boolean().default(false),        // true = 相机固定；配合 motion 使用

  // === 首尾帧接力（M4#7）===
  start_frame_source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('keyframe'), keyframe_id: z.string() }),
    z.object({ kind: z.literal('prev_clip_last_frame'), clip_id: z.string() }),
  ]),
  end_frame_source: z.union([
    z.object({ kind: z.literal('keyframe'), keyframe_id: z.string() }),
    z.object({ kind: z.literal('open') }),
  ]),
  return_last_frame: z.boolean().default(true),   // 默认存末帧，供下一 clip 接

  // === 音频（M4#6）===
  audio_spec: z.object({
    generate_audio: z.boolean().default(true),     // 默认直出有声
    dialogue: z.array(z.object({
      character_id: z.string().regex(/^CHR-/),
      text_zh: z.string(),
      emotion: z.string().max(40).optional(),
    })).default([]),
    voice_hint: z.string().max(200).optional(),    // 音色/语速提示
    bgm_hint: z.string().max(200).optional(),
    sfx_hints: z.array(z.string()).default([]),
  }),
});
```

**Ark video body**（M4 完整版）：

```jsonc
POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
{
  "model": "doubao-seedance-2-0-mini-260615",
  "content": [
    { "type": "text", "text": "<motion_positive prompt> --rs=1080p --rt=9:16 --dur=5 --cf=false" },
    { "type": "image_url", "image_url": { "url": "<KF_start b64 or url>" }, "role": "first_frame" },
    { "type": "image_url", "image_url": { "url": "<KF_end b64 or url>" },   "role": "last_frame" }
  ],
  "resolution": "1080p",              // ★ M4#4
  "ratio": "9:16",                    // ★ M4#4
  "duration": 5,                       // ★ M4#4
  "camera_fixed": false,              // ★ M4#4
  "generate_audio": true,             // ★ M4#6 直出有声
  "return_last_frame": true,          // ★ M4#7 末帧供下一 clip 接
  "watermark": false                  // ★ M4#1
}
```

> 上面参数的**字段名与传递位置**以官方文档为准 —— 有些接口把它们放 top-level，有些放到 `content[].text` 的短横线参数里。**代码层用 spec object 屏蔽差异**，body 组装由 adapter 决定。

**首尾帧接力工作流**：

```
Scene1  KF-A ──┐                                          ┌── KF-B (end_frame)
              ▼                                          ▼
           seedance ── clip1.mp4 + clip1.last.png ──> ...
                                    │
                                    └─(prev_clip_last_frame)─┐
                                                             ▼
Scene2  (无 KF-A) ─────────────────────────────────────>  seedance ── clip2.mp4 + clip2.last.png
```

**P 优先级**：**P2**（Stage F 单图/组图跑通后再接；需要新建 `video_generation_jobs` 表做异步轮询）。

---

### 4.H · Layer Decomposition 分层出图（P2，M4#8 新增）

**用途**：把已生成的 keyframe 图**拆成前景 / 背景 / 角色 / 元素 PNG**，UI 支持"换背景 / 换角色"精修合成。

**输入**：`image_asset_id`（已存在的 IMG-KF-*）+ `decomposition_hints`。

**输出 zod schema**：

```ts
export const LayerDecompSpecSchema = z.object({
  id: z.string().regex(/^LAYERS-IMG-/),
  source_image_id: z.string().regex(/^IMG-/),
  requested_layers: z.array(z.enum([
    'foreground', 'background', 'character_main', 'character_secondary',
    'prop_key', 'prop_secondary', 'sky', 'ground', 'atmosphere',
  ])).min(1).max(6),
});
```

**Ark image body**：

```jsonc
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
{
  "model": "doubao-seedream-5-0-260128",
  "image_url": "<source image b64 or url>",
  "layer_decomposition": {              // ★ M4#8
    "enabled": true,
    "layers": ["foreground", "background", "character_main"]
  },
  "response_format": "b64_json",
  "watermark": false
}
```

**P 优先级**：**P2**（属于精修能力，非核心流程）。

---

## 5. ID 命名 / visual_lock / 变量注入（承袭 M3 §5-§6，本节仅速查）

| 实体 | ID |
|---|---|
| Project / World | `PRJ-<slug>` / `WORLD-<slug>` |
| Episode / Scene / Shot | `EP001` / `SC-EP001-003` / `SH-SC-EP001-003-02` |
| Character / Location / Prop | `CHR-<slug>` / `LOC-<slug>` / `PROP-<slug>` |
| Keyframe / Visual Lock | `KF-<sceneId>-<A|B>` / `LOCK-<entity>-<slug>-<attr>` |
| Image / Image Batch / Video / Layers | `IMG-KF-*` / `IMGBATCH-SC-*` / `VID-SC-*` / `LAYERS-IMG-*` |

**六件套变量**（所有阶段都 hydrate）：`project_name / project_slug / content_form / project_type / genre / tone / audience / mode / language`。

**visual_lock 规则**：每个 character/location/prop 生成时必须给 `visual_lock.positive ≤ 15 英文词`，可选 `visual_lock.negative`。Stage F/G 直接原样拼接。

---

## 6. Ark 完整参数矩阵（M4 修正版）

### 6.1 Chat（Stage A/B/C/D/E + image/video 前的 prompt 编排）

| Stage | model | temp | max_tokens | response_format | 备注 |
|---|---|---|---|---|---|
| A World | doubao-seed-2-0-lite-260428 | 0.55 | 8192 | json_object | seeds 一次产出 |
| B Outline | doubao-seed-2-0-lite | 0.5 | 4096 | json_object | 每批 ≤ 5 集 |
| C Script | doubao-seed-2-0-lite | 0.65 | 4096 | json_object | 单集一次 |
| D Scene | doubao-seed-2-0-lite | 0.4 | 4096 | json_object | 单集一次 |
| E Keyframe | doubao-seed-2-0-lite | 0.4 | 2048 | json_object | 单 scene 一次 |
| F Image spec | doubao-seed-2-0-lite | 0.2 | 1024 | json_object | 单 keyframe 一次；few-shot |
| G Video spec | doubao-seed-2-0-lite | 0.2 | 1024 | json_object | 单 scene 一次；few-shot |
| Ping | doubao-seed-2-0-lite | 0 | 5 | — | `/api/ai/verify` |

### 6.2 Image（seedream 5.0）

| 模式 | 触发 | body 关键字段（M4）|
|---|---|---|
| 单图 | 单个 keyframe | `size` 档位 + `response_format:"b64_json"` + `watermark:false` + `n:1` |
| 组图 | scene 需 N ≤ 15 张连贯 | 追加 `sequential_image_generation:{enabled:true, batch_size:N}` |
| 分层 | 对已有图后处理 | `image_url` + `layer_decomposition:{enabled:true, layers:[...]}`（P2） |

**通用**：默认 `guidance_scale: 5.5`；seed 可选；negative_prompt 拼 `visual_lock_negative[]` 汇总。

### 6.3 Video（seedance 2.0-mini）

| body 字段（M4）| 含义 | 默认值 |
|---|---|---|
| `resolution` | 分辨率档位 | `1080p`（以官方档位为准） |
| `ratio` | 画幅 | 沿用 project 画幅（默认 `9:16`）|
| `duration` | 秒 | `5`（3-15 内） |
| `camera_fixed` | 相机是否固定 | `false` |
| `generate_audio` | 是否直接出有声 | `true`（有 dialogue/hint 时）；纯环境音场景可 `false` |
| `return_last_frame` | 完成后返回末帧图 | `true`（用于接力） |
| `watermark` | 水印 | `false`（M4#1） |
| `content[]` | text + 首帧 image_url + 末帧 image_url | 见 §4.G 示例 |

---

## 7. 落地路径（P0/P1/P2）

### P0 · 第 1 周 · 基础改造 + 首出图验证

**目标**：现有 4 个 chat 调用挪到 prompt 包 + zod；跑通首个 keyframe 出图（验证 M4#1/#2/#3）。

**改动清单**：

1. 建 `packages/core-services/src/ai/prompts/` 目录（shared + story-bible + episode-outline + scene-outline）。
2. `StoryService.generateStoryBible / generateEpisodeOutline`、`StoryboardService.generateScenes` 改为 `pack.build → callArkChat → pack.schema.parse` 三段式。
3. Scene Outline 补 `characters / locations / props` context block + 后端引用校验。
4. `callArkImage` adapter 补 M4 修正：默认 `watermark: false`、`response_format: "b64_json"`、`size` 档位化（建常量 `IMAGE_SIZE_PRESETS`）。
5. 建 `image_assets` 表 + `data/images/` 目录 + base64 落地写入。
6. UI 层 `/story/episode/[id]` 加一个"AI 生成首个 keyframe 图"按钮（配合任一手工填的 KeyframeSpec 用），端到端跑通"world → episode → scene → keyframe（手填） → image（seedream）"。
7. DB migration：`characters` 表增补 `visual_lock_positive / visual_lock_negative`；`projects` 表增补 `mode` `language`（可选，短期 hardcode `domestic / zh-CN`）。

**验收**：能拿到一张不带水印、可持久化、不 24h 过期的 keyframe PNG。

### P1 · 第 2-3 周 · 补齐剧本骨架 + 关键帧 + 组图

**目标**：Stage C / E / F(组图) 三个新增能力全跑通。

**改动清单**：

1. 新增 `prompts/episode-script/` + `prompts/keyframe-plan/` prompt 包。
2. `StoryService.refineEpisodeScript(episodeId)` + `StoryboardService.generateKeyframePlan(sceneId)`。
3. UI 层：`/story/episode/[id]` 新增"AI 展开剧本骨架"（Stage C）；`/storyboards` 新增"AI 生成关键帧计划"（Stage E）。
4. **Stage F 组图**：`callArkImage` adapter 支持 `sequential_image_generation` 分支；`PromptCompilerService.compileImageBatch(sceneId)` 生成 `ImageBatchSpec` 并调用。
5. 建 `image_batches` 表 + 每帧独立 `image_assets` 落库；UI `/storyboards/[sceneId]` 显示组图轮播。
6. 联调一遍**守株待兔一整集**：world → 1 集 outline → refine script → 5 scenes → 5 组 keyframe plan → 5 组 sequential image batch（每 scene 3-6 张），验证角色一致性。

**验收**：一集成语故事的全部关键画面产出，seedream 组图内一致，跨 scene 借用 visual_lock 也基本稳定。

### P2 · 第 4 周+ · 视频接力 + 分层精修 + Prompt 编辑器

**目标**：Stage G / H 全能力接入；可选把 prompt 交给用户自定义。

**改动清单**：

1. 新增 `prompts/video-prompt/`；`callArkVideo` adapter 按 M4 补齐 body（`resolution/ratio/duration/camera_fixed/generate_audio/return_last_frame/watermark`）。
2. **首尾帧接力**：`VideoService.generateSceneClips(episodeId)` 按 scene 顺序生成，每个 scene 从上一 clip 的 `last_frame` 取首帧；Job Orchestrator 做异步轮询（现有 `job_orchestrator_service.ts` 扩展）。
3. 建 `video_prompt_specs` + `video_generation_jobs` + `video_assets` 表。
4. **Stage H 分层**：`prompts/layer-decomposition/` + `callArkImage` adapter `layer_decomposition` 分支；UI `/storyboards/[sceneId]` 提供"拆图层"按钮，出的图另存 `image_layers` 表。
5. **Phase 2 可选**：`ai_prompt_overrides` 表 + `/models` 页 Prompt 编辑器（把 shared/roles 和 variants 内容以 UI 表单暴露）。
6. 全链路一致性验收：一集守株待兔 → world → outline → script → scenes → keyframes → images → clips → 拼接 → 一部完整成语短片。

**验收**：一集守株待兔从零跑到一段带音频的成品短片，角色跨镜识别度可接受。

---

## 8. 校验与失败处理策略

| 错误 | 触发 | 抛 | 前端表现 |
|---|---|---|---|
| provider_unavailable (无 key) | `isProviderReady()===false` | 直接抛，`retryable: true` | 引导 `/models` 配置 key |
| provider_unavailable (LLM 上游) | `AiUpstreamError` | 直接抛 | 展示上游错误码 + 重试按钮 |
| provider_unavailable (schema 校验) | zod parse 失败 | 重试 1 次（temp -0.1）后抛 | 展示 `details.errors` |
| provider_unavailable (引用不存在) | scene.character_ids 命不中 context | 抛 `unknownIds[]` | UI 提示"确认加入新实体或修改"|
| provider_unavailable (image/video 上游) | Ark 返回 4xx/5xx | 直接抛；分级：401→config、429→backoff | image/video Job 标 `failed` |
| provider_unavailable (b64 解码失败) | Ark 返回非合法 base64 | 抛 `decode_error` | 展示"生成成功但保存失败，请重试" |

---

## 9. 附录 A · Ark 调用 curl 示例

### A.1 单图（M4#1/#2/#3 完整版）

```bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/images/generations" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedream-5-0-260128",
    "prompt": "middle-aged Chinese farmer, tanned skin, weathered face, coarse hemp tunic and straw sandals, standing under a lone leafy tree at rural farmland edge, holding a rough wooden stick, worried expression, soft daylight, ink-wash Chinese landscape style, medium shot, rule of thirds",
    "negative_prompt": "modern clothing, glasses, watch, plastic props, blurry, low quality, extra fingers, deformed hands",
    "size": "1024x1792",
    "n": 1,
    "response_format": "b64_json",
    "watermark": false,
    "guidance_scale": 5.5,
    "seed": 20260924
  }'
```

### A.2 组图（M4#5）

```bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/images/generations" \
  -H "Authorization: Bearer $ARK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedream-5-0-260128",
    "prompt": "BASE: middle-aged Chinese farmer under a lone leafy tree, ink-wash style\n---\nFrame 1: hoeing the field with hopeful expression, morning light\nFrame 2: a rabbit crashes into the tree, farmer startled and surprised, mid-day\nFrame 3: farmer picking up the dead rabbit, greedy smile, mid-day\nFrame 4: farmer sitting idly under the tree waiting, dusk\nFrame 5: farmer old and starving, weeds overgrown, snow falling",
    "sequential_image_generation": { "enabled": true, "batch_size": 5 },
    "size": "1024x1792",
    "response_format": "b64_json",
    "watermark": false
  }'
```

### A.3 视频（M4#4/#6/#7 完整版）

```bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks" \
  -H "Authorization: Bearer $ARK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2-0-mini-260615",
    "content": [
      { "type": "text", "text": "middle-aged Chinese farmer swings a hoe, then a rabbit crashes into the tree behind him, he turns startled" },
      { "type": "image_url", "image_url": { "url": "<KF_start_b64>" }, "role": "first_frame" },
      { "type": "image_url", "image_url": { "url": "<KF_end_b64>"   }, "role": "last_frame"  }
    ],
    "resolution": "1080p",
    "ratio": "9:16",
    "duration": 5,
    "camera_fixed": false,
    "generate_audio": true,
    "return_last_frame": true,
    "watermark": false
  }'
```

---

## 10. 附录 B · zod schema 索引

| Stage | Schema | 位置（建议） |
|---|---|---|
| A | `StoryBibleSchema (drama|series)` + `CharacterSeedSchema` + `LocationSeedSchema` + `VisualLockSchema` | `prompts/story-bible/schema.ts` |
| B | `EpisodeOutlineSchema` | `prompts/episode-outline/schema.ts` |
| C | `EpisodeScriptSchema` | `prompts/episode-script/schema.ts` |
| D | `SceneOutlineSchema` | `prompts/scene-outline/schema.ts` |
| E | `KeyframePlanSchema` | `prompts/keyframe-plan/schema.ts` |
| F | `ImagePromptSpecSchema` + `ImageBatchSpecSchema` | `prompts/image-prompt/schema.ts` |
| G | `VideoPromptSpecSchema`（含 audio_spec） | `prompts/video-prompt/schema.ts` |
| H | `LayerDecompSpecSchema` | `prompts/layer-decomposition/schema.ts` |
| 通用 | `VisualLockSchema` | `prompts/shared/schemas/visual-lock.ts` |

---

## 11. 附录 C · 与 4 个参考项目的映射（M1 → 本方案）

| 借鉴点 | 来源 | 本方案位置 |
|---|---|---|
| references 懒加载 | 0xsline | `shared/constants/*.md` + `pack.build(ctx).loadConstants[]` |
| variants md 分支 | huobao | 每 stage 的 `variants/*.md` |
| JSON schema + responseSchema | CineGen | zod + `response_format=json_object` + 后端 zod parse |
| ID 化跨阶段引用 | zenstory | §5 ID 表 |
| 一致性锁短语 | zenstory | `visual_lock.positive/negative` |
| 每场独立请求防截断 | CineGen | Stage D/E/F/G 都按 scene/keyframe 拆批 |
| **组图一致性由平台保证** | **本方案新增（M4#5）** | Stage F 组图模式，一次 ≤ 15 张连贯图 |
| **首尾帧接力做长镜头** | **本方案新增（M4#7）** | Stage G `return_last_frame + prev_clip_last_frame` |
| **有声视频直出** | **本方案新增（M4#6）** | Stage G `generate_audio: true + audio_spec` |

---

## 结语

三份材料融合完毕。核心变化点：

- **接口文档修正（M4）是必须的**：不做 P0 的水印/b64/size 三改，seedream 出的图 24h 后就是垃圾。
- **组图 API（M4#5）+ 首尾帧接力（M4#7）是这次接口分析里价值最大的两个能力**。前者让 picture_book / 分镜类阶段成本降 3-6 倍，后者让"长镜头拼接"从人工剪辑升级为自动接力。
- **P0/P1/P2 落地节奏**：P0 只保 4 个 chat 调用规范化 + 首出图；P1 是"守株待兔一整集出全部关键图"里程碑；P2 是"一段带音频的成品短片"里程碑。

按 P0 落地一周内就能验证 M4 修正的正确性；胖哥先看下 Stage F 双模式和 Stage G 完整 body 是否符合期望，确认后我把 P0 的代码改动清单列出来动手。
