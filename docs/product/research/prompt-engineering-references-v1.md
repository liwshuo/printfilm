# printfilm-next Prompt 工程调研报告

> 目标：从 4 个开源短剧/漫剧项目里扒 prompt 组织模式，指导 printfilm-next（DramaFlow Studio）prompt 层改写。以下均基于抓到的实际源码/skill 文件。
>
> 生成时间：2026-09-24 · 与"移除 stub / provider 硬依赖"改动同批交付

---

## 项目一：`0xsline/short-drama`

**一句话定位**：Claude Code / Codex CLI 用的 **纯 Markdown 短剧编剧技能包**（无后端、无 API 调用），覆盖 50–100 集微短剧从选题到导出的全流程。

**工作流阶段**：`/start`（选题）→ `/plan`（故事骨架）→ `/characters`（角色 + 四层反派）→ `/outline`（分集目录）→ `/episode N`（分集剧本）→ `/review N`（五维评分）→ `/compliance`（合规）→ `/export`（导出）；侧枝 `/overseas` 切换出海模式。

**prompt 组织模式**
- **多文件技能包**：单入口 `SKILL.md`（约 520 行，就是 system prompt），配 8 份 `references/*.md`（genre / opening / rhythm / hook / paywall / satisfaction / villain / compliance，共 ~2126 行）。
- **按命令懒加载**：`/plan` 只读 `rhythm-curve.md + paywall-design.md + satisfaction-matrix.md`；`/episode` 只在第 1–3 集读 `opening-rules.md`。避免全量注入。
- **无 JSON schema 约束**，直接约定 Markdown 输出模板（场景头 `## S01 | 内景 · 咖啡厅 | 黄昏`、`△` 景别 / `♪` 配乐 / `**角色**：（表情）台词`）。
- **状态文件 `.drama-state.json`** 作为跨轮次的变量注入源：`genre / audience / tone / totalEpisodes / mode(domestic|overseas) / language`。
- **强结构模板**：13 种题材 × 四层反派体系（小 → 中 → 大 → 隐藏）× 五种钩子（悬念/反转/情绪/信息/危机）× 四段节奏曲线（起势 15% / 攀升 30% / 风暴 35% / 决战 20%）× 八类爽感矩阵。
- **温度/model 不出现**（AI 编辑器负责），只约束"输出"。

**值得 printfilm-next 借鉴**
- **懒加载参考文档**：不要一个 mega system prompt。system 保持骨架，把"节奏曲线/钩子/反派/爽感"等 domain knowledge 拆成外挂 md，按阶段和内容形态按需拼接 → 落地：`prompts/story-bible/references/*.md`，`buildUserPrompt()` 里根据 `mode` 选择性拼接。
- **状态文件驱动变量注入**：printfilm 已有 project 表，把 `genre/tone/audience/episodeCount/mode` 提到 project 元数据，每次调用 LLM 前统一 hydrate。
- **强结构骨架（钩子/反派/节奏曲线）应固化为 prompt 常量**：`packages/core-services/src/ai/prompts/story-bible/constants/rhythm-curve.md`，作为 system 常量注入。
- **形态开关**：`domestic vs overseas`（格式头、语言、文化替换）是同一 system + 分支模板 → printfilm 的 `short_drama vs picture_book vs documentary` 同构处理。

---

## 项目二：`chatfire-AI/huobao-drama`

**一句话定位**：TypeScript 全栈（Hono + Mastra Agents）**端到端 AI 短剧生产平台**，可跑本地小说 → 剧本 → 资产 → 分镜 → 视频 → 拼接。Volcengine Seedance / MiniMax H3 / Wan 3.0 均已接入。

**工作流阶段**：小说 → `script_rewriter`（格式化剧本）→ `extractor`（人物/场景/道具抽取）→ `storyboard_breaker`（分镜段落）→ `prompt_generator`（图片/视频 prompt）→ 视频生成 → FFmpeg 拼接。四个 Mastra Agent 各挂一个 `SKILL.md`。

**prompt 组织模式**
- **多 skill pack（一个 agent = 一个目录）**：`backend/workspace/skills/{script-rewriter,extractor,storyboard-breaker,prompt-generator}/SKILL.md`。每个 skill 一个 YAML front-matter（`name`, `description`）+ 正文规范。
- **多语言变体**：约定 `SKILL.<lang>.md`（en/ja/ko），随 UI 语言 `content_language` 加载，缺失回退中文基础版。
- **prompt 与代码分离 + 用户可在 Settings 页运行时编辑**（写入 SQLite / userData 目录）。这是最工程化的一家。
- **无 JSON schema**：靠 Mastra Agent 的 tool call（`read_storyboard_context` / `save_storyboards` / `update_storyboard`）来结构化输出，把校验和落库交给工具。
- **变量注入以工具返回值为主**：不是 `{{}}` 模板变量，而是 agent 先调 `read_storyboard_context` 拿到 scenes/characters/props 再生成，保证跨镜一致。
- **规则量化**：段落 8–15 秒、子镜头 2–6 秒、台词时长下限 `字数/4.5 + 2秒`、总时长锚 `字数/500字/分钟`。

**值得 printfilm-next 借鉴**
- **YAML front-matter + 正文**：每个 prompt 文件都带 `name / description / model`，方便注册表统一加载 → 落地 `packages/core-services/src/ai/prompts/*/system.md` 用 gray-matter 读 front-matter。
- **prompt 用户可编辑（数据库 override）**：printfilm 可以内置默认 prompt，用户在 UI 覆盖后写回 SQLite（DramaFlow 用户如果自己迭代 prompt，不必改代码）。
- **工具化 context 注入**：分镜 prompt 明文写"必须先调 `read_storyboard_context`"再产出。printfilm 的 `StoryboardService.generateScenes` 应先加载 world_setting + episode_outline + characters，然后作为 few-shot / context block 拼进 user prompt，而不是让 LLM 编。
- **硬规则量化**：把"字/秒""段落/秒"这类 rule 写进 prompt，能极大压缩胡编空间 → 落地：picture_book 每页文字量、documentary 每段解说字数都要给出明确公式。
- **多语言 prompt 变体**：路径约定 `prompts/xxx/system.zh-CN.md, system.en-US.md`。

---

## 项目三：`UllrAI/CineGen-ShortDrama`

**一句话定位**：Gemini 2.5 Flash + Veo 3.1 的 **纯前端漫剧 (motion comic) / animatic 工作台**，"Script → Assets → Keyframe → Video"关键帧驱动。IndexedDB 存储。

**工作流阶段**：Phase01 剧本/分镜 → Phase02 资产/选角（含 Wardrobe System）→ Phase03 导演台（Start/End Keyframe + Veo 首尾帧插值）→ Phase04 成片导出。

**prompt 组织模式**
- **单文件代码内 prompt**：`services/geminiService.ts` 里把所有 prompt 内嵌到 TS 模板字符串。**没有 skill 目录、没有 md**。
- **强 JSON schema 约束**：Gemini `responseMimeType: "application/json"` + `responseSchema`（用 `Type.OBJECT/ARRAY/STRING`）显式定义结构。这是 4 个项目里唯一真正做 schema 强约束的。
- **system+user 不严格分离**（Gemini 用单 prompt），但通过"角色卡"式开头做 role-play：`Act as a professional cinematographer.`
- **变量注入靠模板字符串**：`Language for Text Output: ${lang}` / `Scene Details: Location: ${scene.location}` / `Characters: ${JSON.stringify(...)}`。
- **模型分层**：`gemini-2.5-flash`（逻辑/schema 化文本）、`gemini-2.5-flash-image`（Nano Banana，参考图约束一致性）、`veo-3.1-fast-generate-preview`（首尾帧视频）。**图像生成靠 inlineData 直接塞 base64 参考图**保证角色/场景一致性——不是靠 prompt 描述。
- **`maxOutputTokens: 8192`, 无 temperature 参数**（Gemini SDK 默认）；重试用 exponential backoff 应对 429。
- **每场景独立请求**（`BATCH_SIZE = 1`）避免 JSON 截断；再全局重编 `shot-N` id。

**值得 printfilm-next 借鉴**
- **JSON schema 是首选，不是可选**：Ark chat 支持 `response_format={"type":"json_object"}`，printfilm 每个 chat call 都应带 zod schema，服务端再 parse+校验，失败直接抛错（贴合"不再走 stub"策略）。
- **每场景/每集独立请求，避免 8k 截断**：EpisodeOutline 生成分集时按批 4–5 集，Storyboard 按 scene 独立请求。
- **参考图 base64 内联 = 一致性锁**：printfilm 若走漫剧/motion_comic 形态生成关键帧，走 seedream 的 image-to-image + character reference sheet，不要依赖描述性 prompt 保证人脸一致。
- **prompt 中显式提示 token 上限**（"Keep it under 40 words to save tokens"）— 是防止 JSON 截断的实用小技巧。
- **模型分层调用**：chat 用 doubao-lite，图像用 seedream + reference，视频用 seedance + 首尾帧。

---

## 项目四：`zenstory-ai/drama-skills`

**一句话定位**：面向 Claude Code / Codex 的 **11 个 skill 组成的工业级短剧/漫剧生产工作流**，"5 份 Markdown 就是创作事实"，人机确认闸门在生成媒体之前。工作室蒸馏产物。

**工作流阶段**：原著分析 `novel-analyze` → 故事开发 `develop` → 单集剧本 `write` → 资产 `assets` → 图片 prompt `image-prompts` → 分镜/关键帧 `storyboard` → 视频 prompt `video-prompts` → 生产 `produce`（预览-确认-执行）→ 剪辑 `edit` → 审查 `review`。

**prompt 组织模式**
- **11 个独立 skill 目录**：每个 `skills/short-drama-*/SKILL.md` + `references/*.md` + `scripts/*.py`（确定性校验器）。
- **每集只维护 5 份 md**（剧本 / 视觉设定 / 分镜 / 图片提示词 / 视频提示词），跨 skill 用 ID 引用（`SHOT-EP001-002` / `LOCK-JIANGCHEN-DRESS` / `IMG-JIANGCHEN-SHEET` / `MOTION-EP001-002` / `REF-*` / `PLAN-*`）。
- **YAML front-matter + "触发条件"式 description**（写给上游 agent 判断何时召唤这个 skill）。
- **确定性校验器（Python 脚本）当审计工具**：`creator_markdown_check.py` 检查五份文档间的 ID 引用一致性，写漏了会输出"原因型报错"（不是 "校验失败"）。
- **"确认闸门"**：生产 skill 先把本次任务的数量、内容、参数、参考、adapter 全部写进文件展示给人，明确确认后才花钱。
- **变量粒度极细的"连续性锁"**：`LOCK-JIANGCHEN-DRESS · 锁面: olive-green stand-collar service dress`，锁面就是能原样贴进图片/视频 prompt 的短语。
- **模型行为方言**：`references/minimax-h3.md` 记录"H3 中文可发声 4.1 字/秒"、"说话人第一次出现要在 `<d>` 外交代画内画外"等。

**值得 printfilm-next 借鉴**
- **ID 化的跨阶段引用**：`WORLD-*` / `EP-N-OUTLINE` / `SC-EP001-003` / `SHOT-EP001-012` / `KF-EP001-012-START`。printfilm 已经有 episode/scene 数据模型，把 slug 化 ID 固化到 prompt 里，跨阶段串联。
- **"连续性锁" 概念**：每个角色/场景/道具生成时抽取一句"可原样贴入 image/video prompt 的锁面短语"，存到 project 表，后续所有关键帧/视频 prompt 拼接这段短语 → 解决 seedream/seedance 一致性最痛点。
- **确定性校验器**：printfilm 每次 LLM 输出（world setting、episode outline、storyboard）后，走一遍 zod + business rule 校验（"每集至少 N 个 scene"、"每 scene 有 hook_type"、"角色引用必须在 characters 表存在"），失败原因型报错触发 re-ask。
- **"按需读取知识"结构**：system prompt 保持精简，把 domain knowledge（钩子/爽感/节奏/合规）拆到 `references/*.md`，user prompt 根据 signal 决定注入哪一段。
- **frontmatter 里的 description 是路由条件**：printfilm 里做 orchestrator 时可以借鉴。

---

## 跨项目共性 vs 差异

### 共识（都在做）
1. **阶段拆分**：都把"世界/故事 → 分集 → 剧本 → 分镜 → 关键帧/视频 prompt"拆成独立 skill/agent，**不用 mega prompt 一把梭**。
2. **skill pack 目录 + Markdown**：3/4 项目采用 `SKILL.md + references/*.md` 结构（CineGen 例外，因为是纯前端代码）。
3. **变量注入**：都靠 `{{project}}, {{episode_no}}, {{genre}}, {{tone}}, {{language}}, {{mode}}` 六类核心变量在 user prompt 拼装。
4. **强结构化输出**：要么 JSON schema（CineGen）、要么 Markdown 硬模板（0xsline / zenstory）、要么 tool call（huobao）——**没有一家让 LLM 自由输出散文**。
5. **一致性锁 / reference image**：所有 image/video 项目都在解决人物/场景一致性，靠"参考图 + 短语锁"，**不靠自然语言描述**。
6. **国内/海外双模式**：所有短剧项目都要考虑 domestic vs overseas（好莱坞格式 + 英文 + 文化替换）。

### 差异
| 维度 | 0xsline | huobao | CineGen | zenstory |
|---|---|---|---|---|
| Prompt 载体 | 纯 md skill | md skill（DB 可覆盖）+ Mastra tool | 代码内 TS 模板 | md skill + Python 校验器 |
| 输出约束 | Markdown 模板 | Mastra tool schema | Gemini JSON responseSchema | Markdown ID 交叉引用 + 脚本核对 |
| 温度/max_tokens | 未定 | 未在 skill 出现 | maxOutputTokens=8192 | 未在 skill 出现 |
| 参考文档加载 | 命令级懒加载 | 全量作为 system | 无外挂 | signal 驱动懒加载 |
| few-shot | 无 | 无 | 无 | 无 |
| 一致性策略 | 文本"角色档案" | 白底道具图 + reference_id | Character variation + Nano Banana inline | 连续性锁短语 + 参考图 ID |

**要点**：几乎**没有一个项目在用真正的 few-shot 示例**——都是"角色扮演开头 + 规则清单 + 输出模板"三件套。因为规则清单已经足够长，示例反而挤占 token。

---

## 面向 printfilm-next 的落地建议

### 1. 目录结构

```
packages/core-services/src/ai/prompts/
├── shared/
│   ├── roles/                      # 通用角色卡
│   │   ├── screenwriter.md
│   │   ├── worldbuilder.md
│   │   ├── storyboard-director.md
│   │   └── prompt-engineer.md
│   ├── constants/
│   │   ├── rhythm-curve.md         # 移植 0xsline
│   │   ├── hook-types.md
│   │   ├── villain-tiers.md
│   │   └── compliance-checklist.md
│   └── output-conventions.md       # ID 命名 / 场景头 / 标签
├── story-bible/                    # buildWorldSettingFromLlm / buildSeriesSettingFromLlm
│   ├── system.ts                   # 角色卡 + 输出约束
│   ├── user.ts                     # 变量注入 (project meta)
│   ├── schema.ts                   # zod: worldSetting / seriesSetting union
│   └── variants/
│       ├── drama.md                # short_drama / motion_comic / animation
│       ├── series.md               # comic / picture_book (系列/单元型)
│       ├── documentary.md
│       └── educational-story.md
├── episode-outline/                # buildEpisodeOutlineFromLlm
│   ├── system.ts
│   ├── user.ts
│   ├── schema.ts                   # zod array<EpisodeCard>
│   └── variants/{drama,series,picture-book,documentary,educational-story}.md
├── scene-outline/                  # StoryboardService.generateScenes
│   ├── system.ts
│   ├── user.ts
│   ├── schema.ts
│   └── variants/*.md
├── shot/                           # 后续做分镜
│   └── ...
└── keyframe/                       # image / video prompt 合成
    ├── image-prompt.ts             # seedream
    ├── video-prompt.ts             # seedance
    └── continuity-lock.ts          # 锁面短语抽取
```

**system.ts / user.ts / schema.ts 拆分原则**：
- `system.ts`：只 export 一段固定字符串 —— 角色 + 输出格式约束 + 硬规则 + 输出 ID 命名规范。**不含项目具体信息**。
- `user.ts`：`build(ctx: PromptContext) => string`，把 project/episode/scene meta 拼进模板 `${ctx.projectName}` / `${ctx.genre}` / `${ctx.mode}` / `${ctx.contentForm}`。
- `schema.ts`：zod schema + `responseFormat: { type: "json_object" }` 的说明。**LLM 输出必须过 zod parse**，失败直接抛 Error（贴合无 stub 策略）。
- `variants/*.md`：内容形态分支模板，通过 `${ctx.contentForm}` 选择 `import.meta.glob` 加载。

### 2. system prompt 应固化的内容
- **角色** = "你是 DramaFlow Studio 的资深短剧/漫剧编剧顾问兼 story bible 架构师"
- **语气** = 严谨、可执行、面向拍摄/绘制/生成的团队，不写散文和心理评论
- **输出格式** = 必须返回严格合法 JSON，schema 见附件；顶层字段固定，未知字段禁止；字符串一律 UTF-8 简体中文（除专有名词）；不得包含 markdown 代码围栏
- **ID 规范** = `EP001`, `SC-EP001-003`, `CHR-<slug>`, `LOC-<slug>`, `PROP-<slug>`, `LOCK-<slug>-<attr>`
- **一致性锁** = "为每个新角色/场景生成一条 ≤ 15 词的英文短语放到 `visual_lock` 字段，用于下游 image/video prompt 拼接"
- **合规红线**（domestic 模式）
- **禁止事项** = 不猜项目未提供的信息；不虚构人物姓氏之外的社会关系；不生成外部链接

### 3. user prompt 应动态注入的变量

| 变量 | 来源 | 用途 |
|---|---|---|
| `project_name / project_slug` | project 表 | 头部标识 |
| `content_form` | project | 触发 variants 分支 |
| `project_type` | project | drama / series，改变分集编号规则（EP vs VOL） |
| `genre / tone / audience / language / mode` | project meta | 分支模板变量 |
| `episode_count / episode_duration_target` | project | 节奏计算 |
| `world_setting_json` (episode-outline 阶段起) | 上一阶段产物 | 作为 context block |
| `characters / locations / props`（scene-outline 阶段起) | 数据库 | 强制引用，避免幻觉新角色 |
| `previous_episodes_summary` | 数据库 | 长剧续写连贯性 |
| `style_reference / visual_locks` | project 或上阶段 | image/video prompt 稳定性 |

### 4. Few-shot 什么时候用

- **不需要**：story bible / episode outline / scene outline — 规则清单 + JSON schema 已经够压。
- **需要**：image prompt / video prompt / shot description — 因为 seedream / seedance 对 prompt 风格敏感，1–2 个内部标定的高质量示例能显著提升出图稳定性。放在 `keyframe/*.ts` 里做 in-context few-shot。
- **需要**：educational_story / picture_book 这种低频形态 —— 给 1 个整段示例 ground the model。

### 5. 内容形态如何切分支

**推荐"共享 system + 内容形态分支模板"**（≈ huobao 多语言变体思路），不做完全独立 prompt 包：

- 共享 system：`shared/roles/*.md + shared/constants/*.md + shared/output-conventions.md`——一致性锁、ID 规范、JSON 约束在所有形态复用。
- variants 只提供**差异化的规则块**（例如 `picture_book` 里"单页 60–120 字 + 单页一图 + 图文并列"；`documentary` 里"每段解说 8–15 秒 + 引用真实事件需标注 [需核实]"），插到 system 末尾。
- **只有 `short_drama` / `motion_comic` / `animation` / `comic` 共用一套"钩子+节奏"规则**（drama 系）；`picture_book` / `educational_story` / `documentary` 各自独立规则块。用 `contentFormGroup(contentForm)` 二分。

### 6. Ark chat 建议参数

```ts
// packages/core-services/src/ai/ark/chat.ts
const ARK_CHAT_DEFAULTS = {
  model: 'doubao-seed-2-0-lite-260428',
  temperature: 0.4,          // 结构化生成偏低；创意场景可覆盖到 0.7
  top_p: 0.9,
  max_tokens: 8192,          // 与 CineGen 一致，防 JSON 截断
  response_format: { type: 'json_object' },
  stream: false,
};

// 每类调用建议：
// worldSetting / seriesSetting:    temperature 0.6, max_tokens 6144
// episodeOutline:                  temperature 0.5, max_tokens 8192
// sceneOutline / storyboard:       temperature 0.4, max_tokens 8192
// image/video prompt 抽取:          temperature 0.2, max_tokens 2048
```

- **strict JSON**：Ark 支持 `response_format: {"type":"json_object"}`，同时在 system 里明确 "严格返回一个合法 JSON 对象"。
- **失败策略**：一次重试（温度降 0.1），仍失败抛 `LlmSchemaValidationError` 到调用方——**不 fallback 到 stub**。
- **token 提示**：在 user prompt 尾部加"整个响应必须 ≤ 8k tokens，如超限请压缩描述而非截断字段"。
- **每集/每 scene 独立请求**（跟 CineGen 一样），不一次性生成整季，避免截断。

### 7. 三个现有 chat 调用点的改造清单

- `StoryService.buildWorldSettingFromLlm` / `buildSeriesSettingFromLlm`
  - 拆到 `prompts/story-bible/{system,user,schema}.ts`
  - system 里预置"世界圣经 vs 系列圣经"两段常量（union schema），根据 `project_type` 选择
  - 输出必含 `visual_locks[]`（每 world/series 至少给 3 个跨集视觉锁）
- `StoryService.buildEpisodeOutlineFromLlm`
  - system 里注入 rhythm-curve + hook-types（drama 系）或对应形态规则
  - user 里注入 world_setting_json + 已存在的分集摘要
  - schema 强制 `hook_type ∈ {悬念,反转,情绪,信息,危机}`, `is_paywall ∈ boolean`, `beat: '起势'|'攀升'|'风暴'|'决战'`
- `StoryboardService.generateScenes`
  - user 必须先加载该 episode 的 `characters/locations/props` 作为 context block
  - schema 强制 `character_ids[]` 必须来自 context（引导 LLM 不自己发明角色），后端 zod 二次校验
  - 每个 scene 输出 `duration_estimate_seconds` + `hook_end` 字段

---

## 附：一句话总结建议

1. **prompt 拆到 `packages/core-services/src/ai/prompts/<stage>/<system|user|schema>.ts`，用 zod + Ark `response_format: json_object` 做强约束，失败直接抛错。**
2. **内容形态用"共享 system + variants md"分支，drama 系四种共用一套节奏/钩子规则包。**
3. **在 project 元数据里长住 6 个变量：genre / tone / audience / mode / language / content_form，所有 user prompt 从这里 hydrate。**
4. **引入"连续性锁 (visual_lock)"字段贯穿 world → character → keyframe → image/video prompt，是 seedream/seedance 一致性的关键。**
5. **参考文档懒加载（zenstory 模式）而不是灌进一份大 system。**
6. **图像/视频 prompt 需要 1–2 条 few-shot；文本结构化输出不需要。**
7. **温度矩阵：结构化 0.2–0.5，创意剧本 0.5–0.7，image/video prompt 抽取 0.2。max_tokens 统一 8192，超长任务拆批。**
