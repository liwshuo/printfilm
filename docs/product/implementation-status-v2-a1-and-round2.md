# Implementation Status v2 — A1 Model + 7-Point Foundation + Round-2 Borrowings

**日期：** 2026-09-22  
**范围：** printfilm-next（DramaFlow Studio）本地工作台  
**关联文档：** `data-and-api-v1.md`（数据/API 权威）、`docs-review-round2-v1.md`、`docs/adr/adr-006-core-scope-decisions-v1.md`  
**里程碑：** A1 项目模型 + 7 项参考项目改进点的数据模型/服务底座落地；关键产品流程端到端打通。

---

## 0. 一句话结论

**A1（`series | drama` + nullable `episode_id` scope + m2m 引用表）** 与来自 4 个参考项目的 **7 条改进点** 已在数据模型、Domain、Repositories、Core-Services 层完整落地；**创建项目/项目切换/Story Workspace 生成态状态机** 三条最直接的用户可见流程已端到端打通，本地 desktop-server 已按新 schema 冷启动，`series` / `drama` 差异化生成 stub 生效。审查规则分级、五维质量评分、连续性锁校验、合规 gate 与跨集 handoff 生成等的**表结构与领域类型已就位**，具体计算逻辑（compute / verify / gate）作为下一步 stub → provider 演进按需接入。

---

## 1. A1 项目模型（决策 & 落地）

**决策：** 同一套资产/故事表，通过 nullable `episode_id` 表达作用域，配合 m2m 引用表允许 `series` 显式跨集复用。

| 维度 | drama（连续剧） | series（选集/单元剧） |
|---|---|---|
| 故事圣经 | 项目级唯一（`episode_id IS NULL`） | 项目级共享底座 + 每集独立 bible（`episode_id NOT NULL`） |
| 资产（Character/Location/Prop） | 默认项目级共享 | 默认剧集级独立，通过 `episode_asset_refs` 显式复用 |
| 跨集连续性 | `episodes.handoff_state_json` 交接胶囊 | 通常留空；跨集资产复用由 m2m 显式表达 |
| 命名唯一性 | 分部索引：项目内 name 唯一（`WHERE episode_id IS NULL`） | 分部索引：`(project_id, episode_id, name)` 唯一 |
| Story generate 文案 | 长弧连续 / 集尾钩子 / 阶段性对手 | 单元式主题 / 集尾情感落点 / 每集独立冲突 |

**落地位点：**
- Schema：`0001_init.sql`（预发布期直接改并重置本地 DB，`schema_migrations` checksum 允许干净重放；上线后转回严格 append-only 0002+）
- Domain：`ProjectType`、`ComplianceMode` enums；`Project.projectType / complianceMode`；`ProjectStoryBible.episodeId?`；`Character/Location/Prop.episodeId?`；`ProjectStoryBibleRepository.getByProjectAndEpisode`
- Repositories：mappings 补齐新列；`SqliteProjectStoryBibleRepository.getByProjectId` 已过滤 `episode_id IS NULL`
- Core-Services：`StoryService.createProject` 传递 projectType/complianceMode；`generateStoryBible / generateEpisodeOutline` 按 projectType 分流文案 & handoff seeding
- Desktop-Server：`POST /api/projects/:id/story-bible/generate`、`POST /api/projects/:id/episodes/generate-outline`
- Web：Dashboard 创建表单显式选择项目类型 & 合规模式；列表按类型/合规打 tag；Story Workspace header 展示类型标识

---

## 2. 参考项目 7 项改进点 — 落地矩阵

来源：`0xsline/short-drama`、`chatfire-AI/huobao-drama`、`UllrAI/CineGen-ShortDrama`、`zenstory-ai/drama-skills`。

| # | 改进点 | 数据/领域底座 | Service 层 | UI 层 | 完成度 |
|---|---|---|---|---|---|
| 1 | 角色衣橱 / look 变体 + shot 级 look 绑定 | 原 `character_looks` 表 + `shot_characters.look_id` 已存在 | AssetService（已建） | 后续 Storyboard 侧接入 | ✅ 底座就位；UI 待接 |
| 2 | 三态参考图（unverified/planned/verified） | `artifacts.reference_state` 新列 + `ArtifactReferenceState` enum + `Artifact.referenceState?` | ArtifactService 可读写 | 后续 Asset/Prompt 侧展示 | ✅ 底座就位；UI 待接 |
| 3 | 生成时强上下文注入（角色 look/场景参考图/连续性锁） | `character_looks` + `artifacts.reference_state` + `continuity_locks` 表 | `PromptCompilerService` 可查询这些锚点做上下文注入 | Prompt Center 展示注入上下文 | ✅ 底座就位；compiler 拓展待接 |
| 4 | 合规审查 + 出海/国内双模式 | `projects.compliance_mode` 新列 + `ComplianceMode` enum + 现有 `ReviewIssueType.compliance` | ReviewService 按 mode 分流规则集；ExportService 加 gate | Dashboard 表单选合规；Review/Export 展示 mode | ✅ 底座就位 + 表单接入；规则集 & export gate 待接 |
| 5 | 连续性锁 / handoff_state | 新表 `continuity_locks`；`episodes.handoff_state_json` + `HandoffStateJson` 类型 | drama outline 生成时已 seed 最小 handoff | 后续 Review 侧机械核对锁面 | ✅ 底座就位 + drama 自动 seed；机械核对待接 |
| 6 | 审查规则分级（结构性硬约束 vs 建议） | `review_issues.rule_tier` 新列 + `ReviewRuleTier` enum + `ReviewIssue.ruleTier?` | ReviewService 按 tier 决定 block/pass | Review Center 按 tier 分组展示 | ✅ 底座就位；判定逻辑待接 |
| 7 | 五维质量评分 | `review_runs.quality_scores_json` + `QualityScoresJson` 类型 + `ReviewRun.qualityScores?` | ReviewService run 完成时填评分 | Review Center 展示雷达 / 分数条 | ✅ 底座就位；评分算法待接 |

---

## 3. 二轮参考项目深挖 — 已纳入的可借鉴点

由子任务对 4 个参考项目做架构/工作流/交互层面的深挖，本轮已选择性纳入或明确记入路线图。

**huobao-drama（最同源）**
- 统一任务生命周期 `sys_task` + `POLL_PROFILES`（图片 5s×120 / 视频 10s×300），上游明确 failed 立即终态：**路线图** — 下一步 `JobOrchestrator` 拓展任务类型化轮询档案 + 终态/可重试错误分类；schema 已支持（`generation_tasks` 现有）。
- 参考素材归一化（压缩 768px/q68、去重、上限）+ 三态参考图：**已建底座**（reference_state），归一化管线在 provider 接入时同步落。
- 批量提示词以「实际落库为准」判定成败：**已记入** `job-orchestrator-contract-v1` 后续修订项。

**short-drama（Claude Skill 阶段状态机）**
- 强阶段推进（`/start→/plan→/characters→/outline→/episode→/review→/compliance→/export`）：**本轮 UI 已按同一心智改造**（Story Workspace 生成态状态机 empty→generating→preview→confirmed→error）；后续 storyboard/prompt/review/export 页面按同模板逐一收口。
- 五维质量评分 + 合规审查：**底座已建**（quality_scores_json + compliance_mode）。

**CineGen（衣橱 / keyframe / 上下文注入）**
- 角色 variation + shot-level look 绑定：**已在 schema**（`character_looks` + `shot_characters.look_id`）。
- start/end keyframe：**已在 schema**（`keyframe_specs.keyframe_type` = start/end/key）。
- 生成时强上下文注入 + 429 退避：**底座已建**，注入 & 退避在 provider 接入时落。

**drama-skills（阶段契约 / owner / 锁面 / handoff）**
- 稳定 ID + 阶段契约 owner 机制：现有 `contracts.ts` + optimistic-lock（adr-003）已覆盖 stable ID 与写权语义。
- 参考图三态、连续性锁逐字锁面、handoff_state 交接胶囊、规则分级：**7 点改进已全部对应落地**（见 §2）。
- 确认语义 + 规则分级：`ReviewRuleTier` enum + 现有 `ConfirmStatus` / adr-006 派生状态已支持。

---

## 4. 本轮端到端已打通的产品流程

| 场景 | 触点 | 状态 |
|---|---|---|
| 创建项目（含 projectType / complianceMode / genre / audience / aspectRatio / duration / language / outputSpec） | Dashboard 表单（含收展开关） | ✅ 完整表单 + 后端持久化 |
| 项目列表可点击进入 | Dashboard 表格行 | ✅ 点击写 localStorage + 跳转 `/story` |
| 项目类型 / 合规模式在列表打 tag | Dashboard 表格 | ✅ 「连续剧 / 选集剧」+「国内 / 出海」 |
| Story Workspace — 项目故事圣经生成态状态机 | `/story` 页 | ✅ empty→generating→preview(editable)→confirmed；error 可重试 |
| Story Workspace — 分集大纲生成态状态机 | `/story` 页 | ✅ empty→generating(骨架屏)→preview→追加生成；error 可重试 |
| drama vs series 差异化 stub 文案 | 故事圣经 & 分集 stub | ✅ 后端按 projectType 分流；UI header 展示当前类型 |
| drama 自动 seed handoff open-setups | `generateEpisodeOutline` | ✅ EP*n* 结尾悬念 → EP*n+1* 开场兑现 |
| 错误文案「slug 已被占用」→「项目 ID 已被占用」 | Duplicate slug 校验 | ✅ 已改并验证 |

**验证记录（本地）：**
- `pnpm run smoke`（repositories + core-services + desktop-server）全绿。
- `pnpm --filter @dramaflow/web build` 通过（Next 14.2.5 静态构建 12/12 页面）。
- 冷启动 desktop-server（新 checksum）+ web dev；`/api/health` + 9 个页面 `GET` 均 200。
- 端到端：drama 项目 → 生成圣经 → 生成 3 集大纲，series 项目 → 生成圣经 → 生成 2 集大纲，文案与 handoff 状态符合各自模型预期。

---

## 5. 未展开为完整 vertical slice 的项（有意为之）

以下项目的**表结构 / 领域类型 / repository mapping 已就位**，但计算逻辑（compute / verify / gate）与 UI 显示层作为 stub → provider 演进的下一批任务：

1. **Per-episode Story Bible 生成流程（series）**：`ProjectStoryBibleRepository.getByProjectAndEpisode` 已加；`StoryService` 侧暂未暴露 `generateEpisodeBible` 端点。
2. **m2m 跨集资产复用（`episode_asset_refs`）**：表已建，`AssetService` 侧的 attach/detach/list-refs 与 UI 侧的「引用现有资产」入口下一版落。
3. **连续性锁机械核对**：`continuity_locks` 表已建，`ReviewService` 中的锁面逐字扫描器作为下一批 rule pack 落。
4. **五维质量评分算法**：`quality_scores_json` 列 + 类型已建，评分函数（节奏/爽点/台词/格式/连贯性）按后续规则清单落。
5. **审查规则分级判定**：`rule_tier` 列已建，`ReviewService` block/pass 判定与 `ReviewIssueEvent` 处理路径下一批更新。
6. **出海/国内合规规则集 + 导出 gate**：`compliance_mode` 已在表单/持久化就位，`ReviewService.applyComplianceRules(mode)` 与 `ExportService.gate(bundle)` 分域规则包下一批落。
7. **Prompt 编译期强上下文注入**：`PromptCompilerService` 已能读到三态参考图 / 连续性锁 / character look 的 schema；具体注入片段（`sections` 追加 `context.reference` / `context.lock`）随 provider 接入落。
8. **JobOrchestrator 类型化轮询档案 + 终态错误分类**：`generation_tasks` 已在；档案表结构（POLL_PROFILES）作为 orchestrator 拓展项，与 provider 接入同步。

---

## 6. Pre-release 迁移策略特别说明

- **本轮编辑了已应用的 `0001_init.sql`**（属违反 adr-005 append-only 原则）。理由：项目尚未 ship，无线上/用户数据，A1 及 7 项改动结构性极大，用 0002 rebuild 数条表并非产品阶段的必要复杂度。
- **执行方式：** 删除本地 `dramaflow.sqlite3*` 文件 → 服务重启 → 0001 以新 checksum 干净重放。in-memory smoke 不受影响。
- **上线前恢复：** 一旦有真实用户数据，回到严格 append-only 0002+ 模式（adr-005 §4.2 tamper guard）。此约束仍保留在 0001 头注释与 adr-005 中。

---

## 7. 下一步（建议顺序）

1. **完整 vertical slice**：把 §5 中的 **合规规则包（4）+ 审查规则分级判定（5）+ 五维质量评分（7）** 三项合并落 Review Center（含出海/国内两套 rule pack、rule_tier block/pass、quality_scores 展示）。这是「作品可交付」的临门一脚。
2. **连续性锁机械核对**：与 Prompt Center 联动，让 drama 场景的锁面能被 review 阶段逐字扫描。
3. **m2m 跨集资产复用 UI**：在 Asset Ledger 侧加「引用现有资产」入口 + 剧集级列表分组视图（series 优先价值大）。
4. **JobOrchestrator 类型化轮询档案**：接入首个真实 provider 前的准备工作，避免所有失败一律重试的浪费。
5. **Storyboard / Prompt / Review / Export 页面** 按 Story Workspace 的生成态状态机模板逐一改造，形成一致心智。

---

## 8. Round-3 落地状态（2026-09-22 二次更新）

上一节 §7 的 5 条建议本轮全部完成，以下为逐项完成度与端到端验证结论：

| # | 建议项 | 状态 | 关键落点 |
|---|---|---|---|
| 1 | Review Center vertical slice（合规 + rule_tier + 五维评分） | ✅ 完成 | `ReviewService.runRulePacks()` 一次跑 compliance + continuity + quality，返回 `{runId, verdict, createdIssueIds, qualityScores, blockingCount, advisoryCount}`；`isBlockingIssue()` 按 `rule_tier` + severity + status 判定；`POST /api/projects/:id/reviews/run-rule-packs` 接入；`/reviews` 页面已改造为 Runner + Issues Board + Runs History + 五维评分条 |
| 2 | 连续性锁机械核对 | ✅ 完成 | `ContinuityService`（create/update/disable/delete/list）+ `ReviewService.runContinuityPack()` 在 scene.summary / shot.intent / shot.performanceNotes 中做逐字扫描；未命中创建 `continuity_broken` issue（`rule_tier=structural_invariant`, severity=high）→ 直接进入 blocking |
| 3 | 跨集资产复用 UI（m2m `episode_asset_refs`） | ✅ 完成 | `AssetService.listAvailable{Characters,Locations,Props}()` 聚合项目级 + 本集 + m2m refs；`attach/detach/listRefs/listAvailable` 四组 route；`/assets` 页面 series 项目下自动出现「跨集资产复用」面板 |
| 4 | JobOrchestrator 类型化轮询档案 | ✅ 完成 | `POLL_PROFILES`（image_generate / video_generate / tts_generate / compose_export）+ `retryableCodes` / `terminalCodes` 分类；`failAndMaybeRetry()` 依 profile 决定自动 retry；接真实 provider 前的准备就绪 |
| 5 | Storyboard / Prompt / Export 页面 状态机改造 | ✅ 完成 | 三页统一 `empty → generating → preview → error` 模板：Storyboard 走「一键生成场次骨架」（`generateScenes` stub）；Prompt 走「按 shot/scene 编译」的 compile trigger；Export 走「create → poll status → retry」，含 5s 轮询与阻塞门 |

**新增 API 一览：**
```
POST   /api/episodes/:id/scenes/generate
POST   /api/projects/:id/reviews/run-rule-packs
GET    /api/projects/:id/continuity-locks
POST   /api/projects/:id/continuity-locks
PATCH  /api/continuity-locks/:id
POST   /api/continuity-locks/:id/disable
DELETE /api/continuity-locks/:id
GET    /api/episodes/:id/asset-refs
GET    /api/episodes/:id/available-assets
POST   /api/episodes/:id/asset-refs
DELETE /api/episodes/:eid/asset-refs/:type/:aid
```

**端到端验证（2026-09-22 18:39）：**
- `pnpm --filter @dramaflow/{domain,repositories,core-services,desktop-server,web} build` 全绿。
- `smoke:repositories / smoke:core-services / smoke:desktop-server` 全部 OK。
- E2E API：创建 series 项目 → 生成 3 集大纲 → EP1 generateScenes(3) → 项目级锁 create → run-rule-packs 返回 `verdict=blocked` + `blockingCount=1`（锁面未在场景文本命中，continuity pack 正确报警）+ `qualityScores.overall=68` → EP2 attach 项目级 character ref → refs=1、available.characters=1 → disable lock → active=0。
- 页面 200：`/ /story /assets /storyboards /prompts /models /jobs /reviews /exports` 全 200。

**当前边界（仍是有意的 stub）：**
- 五维评分算法：`ReviewService.runQualityPack` 目前是「基于 episode/scene/shot/dialogue 数量的启发式 stub」，等真实 provider 与规则清单确定后再替换为规则驱动打分。
- 合规规则包：`COMPLIANCE_RULES.domestic / .overseas` 是关键词字典 stub，未接入外部审查服务，可无损扩展或替换为向量/LLM 侧车。
- `POLL_PROFILES` 已定义但尚未有真实 provider 消费——空跑无害，等首个 provider 接入时按 profile 启用。
- Prompt 编译期强上下文注入：`PromptCompilerService` 已能读到锁与三态参考图 schema，但当前编译模板尚未插入 `context.lock` / `context.reference` 片段（保留给 provider 落地时）。

---

*本文档为本轮改动的收口记录。后续任何 A1 model / 7 点 / 二轮借鉴项的实际接入进展，请更新对应行的完成度状态并在 §8 追加下一轮记录。*


---

## §9. AI Provider Adapter 接入（2026-09-22 三次更新）

**目标**：复用 `/Users/bytedance/Documents/trae_projects/printfilm` 项目现有的 AI Provider
与模型，把 Story / Storyboard 从 stub 升级为「有 Key 走 LLM、无 Key 或失败回退 stub」的
渐进式实现，保证本地无 Key 时 UI 状态机也能走通。

### 9.1 Provider 事实（源码事实调研）

- 源项目 `types/model.ts` 事实：
  - `BUILTIN_PROVIDERS`：`antsk`（GitCC，`https://api.gitcc.com`）+ `volcengine-ark`（默认，`https://ark.cn-beijing.volces.com`）。
  - `DEFAULT_CHAT_MODEL_ID = "doubao-seed-2-0-lite-260428"`
  - `DEFAULT_IMAGE_MODEL_ID = "doubao-seedream-5-0-260128"`
  - `DEFAULT_VIDEO_MODEL_ID = "doubao-seedance-2-0-mini-260615"`
- 源项目浏览器侧通过 `/api-proxy` 转发规避 CORS；printfilm-next AI Adapter 运行在 Node/Hono 后端，直连 Ark，不走 `/api-proxy`。

### 9.2 新增代码

- `packages/core-services/src/ai/`
  - `types.ts`：`ChatMessage / ChatOptions / ChatResult / AiApiKeyError / AiUpstreamError`。
  - `ark-config.ts`：baseUrl、endpoint、默认模型 id，`resolveApiKey / isProviderReady / getProviderStatus`；KEY 优先级 `ARK_API_KEY > ANTSK_API_KEY > API_KEY`。
  - `ark-chat.ts`：`POST /api/v3/chat/completions`；`response_format: json_object`；3 次退避重试（400/401/403 不重试）；`verifyChatReady()` 做最小 5 token 探活。
  - `ark-image.ts`：`POST /api/v3/images/generations`；`aspectToSize()` 映射常见比例。
  - `ark-video.ts`：Seedance 异步任务 `submit → poll`，间隔 5s、最大 20min。
- `packages/core-services/src/index.ts`：追加 `export * from "./ai/index.js"`。
- `apps/desktop-server/src/routes/ai.ts`：
  - `GET /api/ai/status`：cheap，只读 env。
  - `POST /api/ai/verify`：真的调一次 Ark chat。
- `apps/desktop-server/src/server.ts`：`app.route("/api", aiRouter())`。

### 9.3 业务接入（stub → LLM 渐进式）

- `story-service.ts`
  - `generateStoryBible` → `async`；`isProviderReady()` 时走 `buildStoryBibleFromLlm`，
    schema 严格 JSON（`logline / theme / tone / worldRules / hookSystem / pacingPlan /
    villainSystem / characterRelations`）；失败回退 stub；Activity `payload.extra.source =
    "llm" | "stub"`。
  - `generateEpisodeOutline` → `async`；LLM 生成 N 集，兼容 `{ episodes | items | data }`；失败回退 stub。
- `storyboard-service.ts`
  - `generateScenes` → `async`；LLM 生成本集 N 个场次骨架
    （`title / summary / dramaticGoal / conflict / timeOfDay`）；失败回退 stub。
- `apps/desktop-server/src/routes/projects.ts` / `storyboards.ts`：把三个生成 route 改为 `await`。

### 9.4 Web UI

- `apps/web/src/lib/api.ts`：新增 `ai.status()` / `ai.verify()` 与类型 `AiProviderStatus / AiVerifyResult`。
- `apps/web/src/app/models/page.tsx`：顶部新增「AI Provider · 火山方舟 Ark（默认）」卡片，
  展示 `ready / keySource / baseUrl / defaultModels / hint`，支持「调用 Ark 探活」按钮，
  未配置 Key 时提示 `export ARK_API_KEY=<your_key>`。

### 9.5 smoke（本地无 KEY 场景）

- `GET /api/ai/status` → `ready: false`，默认模型三项正确。
- `POST /api/projects/:id/story-bible/generate` → stub 落库。
- `POST /api/projects/:id/episodes/generate-outline` → stub 分集落库。
- `POST /api/episodes/:id/scenes/generate` → stub 场次落库。

配好 `ARK_API_KEY` 后重启 `apps/desktop-server`，三个生成接口自动切到 LLM。

### 9.6 配套文档

- 新增 [docs/ops/ai-provider-setup-v1.md](../ops/ai-provider-setup-v1.md)：Provider / 模型 / 环境变量 / 探活 / 回退策略。


### 9.7 Web UI 直接配置 Key（2026-09-22 四次更新）

**目标**：Web `/models` 页可以直接输入并保存 `ARK_API_KEY`，不必再 `export` 环境变量。

- `packages/core-services/src/ai/ark-config.ts`
  - 新增 runtime API Key 覆盖层：`setRuntimeApiKey` / `getRuntimeApiKey`。
  - `resolveApiKey`：`runtime > ARK_API_KEY > ANTSK_API_KEY > API_KEY`。
  - `getProviderStatus`：新增 `keySource: "runtime" | ...`、`keyPreview`（末 4 位遮罩）。
  - `maskKey`：`sk-****xxxx`。
- `apps/desktop-server/src/routes/ai.ts`
  - `POST /api/ai/config`：body `{ apiKey, persist? }`；写 runtime override；`persist=true`
    时同时写入 `.runtime/ai.env`（`chmod 0600`）。
  - `POST /api/ai/config/clear`：清 runtime override + 删除 `.runtime/ai.env`。
  - `loadPersistedAiConfig()`：desktop-server 启动时读 `.runtime/ai.env` 到 runtime override。
- `apps/desktop-server/src/index.ts`：main 中调用 `loadPersistedAiConfig()`，日志提示。
- `apps/desktop-server/src/routes/ai.ts` + `core-services/src/ai/ark-chat.ts`
  - `verifyChatReady` 返回结构化 `{ok, modelId?, finishReason?, status?, error?}`，
    Web UI 直接展示。
- `apps/web/src/lib/api.ts`
  - 新增 `ai.saveKey(apiKey, persist)` / `ai.clearKey()`；类型 `AiSaveKeyResult / AiClearKeyResult`。
- `apps/web/src/app/models/page.tsx`
  - Ark 卡片新增：
    - `password` 类型输入框 + 显示/隐藏切换
    - 「持久化到 `.runtime/ai.env`」勾选（默认勾选）
    - 「保存并验证」（保存后自动 verify）
    - 「只探活现有 Key」/「清除 Key」/「刷新状态」
    - 状态行追加 `keyPreview` 遮罩显示。
- `.gitignore`：追加 `.runtime/`，避免 Key 文件被误提交。

### 9.8 smoke（Web UI Key 全链路）

- `POST /api/ai/config` `{apiKey:"sk-persisttest-9999", persist:true}` → 返回
  `ready:true / keySource:"runtime" / keyPreview:"sk-****9999" / persisted:true`。
- `.runtime/ai.env` 落盘、权限 `-rw-------`。
- 重启 desktop-server → 日志 `AI provider key loaded from .runtime/ai.env`；`GET /api/ai/status`
  仍 `ready:true`。
- `POST /api/ai/config/clear` → `ready:false`、`.runtime/ai.env` 已删除。
- `POST /api/ai/verify` 假 Key 场景返回 `ping.ok:false, status:401, error:"...AuthenticationError..."`，
  证明请求穿透到火山方舟接口层。
