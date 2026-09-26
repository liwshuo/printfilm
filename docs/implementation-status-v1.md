# DramaFlow Studio — 实现进度 (v1)

> 权威规格：`docs/product/data-and-api-v1.md`（DDL / 类型 / API 契约）、`adr-003`（乐观锁）、`adr-004`（错误信封）、`adr-005`（迁移）、`adr-006`（派生状态）。
> 本文件只记录**已落地代码**的状态，规格本身以 `docs/product/` 为准。

## 技术栈

pnpm workspace + TypeScript(strict) + zod + better-sqlite3；`apps/desktop-server` 走 Hono + `@hono/node-server`；`apps/web` 走 Next.js 14 App Router，纯客户端组件，通过 rewrites 代理到 desktop-server。

## 包结构与状态

| 包 | 职责 | 状态 |
| --- | --- | --- |
| `packages/domain` | 领域类型、枚举、JSON 字段结构、API 契约、错误信封、repository ports、zod schemas、纯 derivation | ✅ 编译通过 |
| `packages/repositories` | SQLite 迁移 runner、连接、entity mapper、repository 实现、registry | ✅ 编译 + smoke 通过 |
| `packages/core-services` | Story / Asset / Storyboard / ModelProfile / PromptCompiler / JobOrchestrator / Artifact / Review / Export 业务编排 | ✅ 编译 + smoke 通过 |
| `apps/desktop-server` | Hono 本地 REST + SSE API，组合 repositories + core-services | ✅ 编译 + smoke 通过 |
| `apps/web` | Next.js 14 App Router 工作台 UI（10 个模块页） | ✅ `next build` 全部路由生成 |

## core-services 已实现能力

- **StoryService**：project / episode CRUD、故事圣经 seed & patch、`confirmEpisodeStory`（完整度 gate）、`getProjectStoryStatus`（adr-006 §3 rollup）、`checkStoryCompleteness`。
- **AssetService**：character / location / prop CRUD；CharacterLook 版本链（新分组 vs 组内新版本，维护每角色唯一 default+current 不变量）；`disable*` 在被 scene/shot 引用时抛 `blocked_by_reference`。
- **StoryboardService**：scene / shot / keyframe / 台词块 / 动作块 CRUD；`confirmScene` 受分镜硬校验 gate（不通过抛 `blocked_by_issue`）；确认/取消确认后在同一事务内重算 episode `storyboardStatus` rollup（§6.2）；`validateStoryboard`（关键帧可产出 gate，adr-006 §4）；link 表 upsert/remove。
- **ModelProfileService**：`model_profiles` CRUD（timestamped，无乐观锁，adr-003 §6）；`ModelProfileView` 投影只暴露 `credentialBound` + 末四位掩码 `credentialHint`，原始 secret 不外泄（adr-001，仅存 `endpointKey` 引用）；`testCredential` 为契约级 stub（报告凭证是否绑定，真实连通性属 Model Adapter）。
- **PromptCompilerService**：执行 prompt 的唯一出口（prompt-compiler-contract）。`assembleShotInput` / `assembleSceneTtsInput` 从事实层拼装标准化输入；`compile`/`compileImage`/`compileVideo`/`compileTTS` 按 target 生成固定顺序 sections，`compiledPrompt` 由同一批 sections 有序拼接；重编译同 (source, target) 将旧 draft/confirmed 置 `superseded` 并回填 `supersededBy`；`confirmPrompt`（draft→confirmed，乐观锁）。只读事实层，不建任务、不调 provider、不改事实。
- **JobOrchestratorService**：执行层唯一入口（job-orchestrator-contract）。`GenerationTask` 状态机 `queued→running→succeeded|failed`、`queued|running→cancelled`、`failed→retry`（新建 retryCount+1 任务）；`completeJob` 回写 artifacts（`status:ready`）并对 `compose_export` 同步 ExportBundle 状态；`failJob`/`cancelJob`/`retryJob`（非 failed 抛 `task_not_retryable`）；task log 贯穿各转移。不编译 prompt、不改事实、不做 provider 适配。
- **ArtifactService**：产物元数据 lookup + 生命周期。`listBySource` / `listByProject` 支持 `artifactType` / `status` / `sourceEntityType` / `sourceEntityId` / `sourceTaskId` 过滤；`markDeleted`（软删除，幂等）；`markBroken`（`deleted` 状态拒绝）。产物写入仍由 JobOrchestrator.completeJob 与 ExportService.completeCompose 承担。
- **ReviewService**：审查中心编排（review-center-spec）。`ReviewRun` 状态机 `queued→running→succeeded|failed`；`finishRun` 按批写入 issue 后从 project-level 阻塞集合派生 `verdict`（`blocked` iff 存在 severity∈{high,critical} 且 status∈{open,reopened}）；issue 状态机 `open↔resolved|ignored→reopened`，配 `ReviewIssueEvent` append-only 历史；`ignoreIssue` 强制 `ignoreReason`；**reopen 去重**：新建 issue 命中已 `resolved` 的相同 `ruleCode + location` 自动 reopen 而非重复创建；`assertNoBlockingIssues` 抛 `blocked_by_issue`，供 Prompt / Task / Export 下游门禁复用。
- **ExportService**：导出中心编排（export-center-spec）。`createExport` 先过 `blocked_by_issue` 门禁，按 `bundleType` 顺序生成 `v{n+1}`（§7.7），创建 queued bundle 并同事务派生 `compose_export` 任务、回填 `composeTaskId`；`startCompose` / `completeCompose`（同事务写入 `outputPath` / `manifest` / `bundleSizeBytes` / `finishedAt` 并创建 bundle 类型的 Artifact，adr-006 §5 状态映射）/ `failCompose`（`invalid_state` 之外还沉淀 `errorMessage`）/ `cancelCompose`（cancelled 视为 failed，spec §14.3）；`retryExport` 仅允许 `failed`，重启 compose 任务并把 bundle 复位为 queued。

## apps/desktop-server 已实现能力

- **App factory** (`server.ts`)：Hono app，注入 service bundle middleware、CORS、logger、DomainError → HTTP envelope 统一 onError；健康探针 `GET /api/health`；404 也走 envelope。
- **Bootstrap** (`index.ts`)：env 驱动 (`DRAMAFLOW_DB` / `DRAMAFLOW_PORT` / `DRAMAFLOW_ACTOR`)，本地 127.0.0.1 监听（默认 5174）。
- **REST 路由**（全部挂在 `/api` 下）：
  - `projects.ts`：Project CRUD、story-status/story-completeness、Story Bible、Episodes、`confirm-story`、activity feed。
  - `assets.ts`：character / character-look 版本链、locations、props（含 disable）。
  - `storyboards.ts`：scenes / shots / keyframes / dialogue / action blocks / link 表 / `confirm-scene` + `validate`。
  - `models.ts`：model-profiles CRUD + `view/views` 掩码投影 + `set-active` + `test-credential`。
  - `prompts.ts`：`compile` / `compile-shot-prompt` / `compile-scene-tts` / list by source / confirm。
  - `jobs.ts`：job create/start/complete/fail/cancel/retry、logs、list-by-project。
  - `artifacts.ts`：list、get、`mark-deleted`、`mark-broken`。
  - `reviews.ts`：review-runs 状态机、issues CRUD + 状态迁移 + events。
  - `exports.ts`：export bundle create（含阻塞门禁）/start/complete/fail/cancel/retry/list。
  - `events.ts`：SSE（`GET /api/events?projectId=...`），in-process 事件总线在各写操作后 publish。
- **错误映射** (`errors.ts`)：将 `DomainError.code` 一一映射到 HTTP status（例如 `version_conflict → 409`、`missing_resource → 404`、`blocked_by_issue → 409`、`provider_unavailable → 502`），其余降级到 `internal_error → 500`，body 恒为 ApiErrorEnvelope。

## apps/web 已实现能力

Next.js 14 App Router（`react` 18），单一左侧导航 + 每模块独立页面，均为 Client Component 直接 `fetch(/api/...)`：

- `/`：Project Dashboard — 项目列表 + 快速创建。
- `/story`：Story Workspace — Story Bible 内联编辑（onBlur 携带 `version` 乐观锁）+ Episode 列表/新增/`确认故事`。
- `/assets`：Asset Ledger — 角色 / 场地 / 道具三块 ResourceBrowser（复用 `/api/projects/:id/{characters|locations|props}`）。
- `/storyboards`：Storyboard Studio — 选剧集 → 拉取 scenes，展示 `storyboardStatus`。
- `/prompts`：Prompt Center — 按 sourceEntityType 过滤 prompts 列表，展示 supersede / confirmed 状态。
- `/models`：Model Settings — 模型档案创建 + 掩码 view + `set-active` 启停。
- `/jobs`：Production Hub — 项目任务表，4s 轮询，`重试` / `取消` 直连 core-services。
- `/reviews`：Review Center — 项目问题表，按严重度着色，`解决` / `忽略` 携带 optimistic version。
- `/exports`：Export Center — 一键 `发起导出`（走门禁），5s 轮询，展示 bundle 状态 / manifest / 输出路径 / 大小。
- 共享工具：`lib/api.ts`（ApiError 解析 envelope）、`lib/project-picker.tsx`（localStorage 记住选择）、`lib/resource-browser.tsx`（通用列表回显）。
- 通过 `next.config.mjs` 的 `rewrites` 把 `/api/*` 代理到 `DRAMAFLOW_API_BASE`（默认 `http://127.0.0.1:5174`）。

## 横切约束落地

- **乐观锁（adr-003）**：所有 versioned 更新透传 `expectedVersion`，冲突抛 `version_conflict`。
- **错误信封（adr-004）**：业务错误统一 `DomainError`；输入经 zod 校验，失败转 `validation_failed`；desktop-server 统一转 HTTP envelope；web `ApiError` 反解 envelope 供 UI 展示。
- **迁移（adr-005）**：文件化 SQL + `schema_migrations(version, applied_at, checksum)`，逐条事务执行，checksum 变动报错。
- **多写原子性**：core-services 多写操作包裹在 `RepositoryRegistry.transaction`。

## 验证方式

```bash
pnpm install                    # 首次
pnpm run build                  # 全量 tsc --build（domain + repositories + core-services + desktop-server）
pnpm run smoke                  # build + 三个 smoke test
pnpm --filter @dramaflow/web build  # Next.js 全量生产构建（可选）
```

- `scripts/smoke-repositories.mjs`：迁移、CRUD、JSON round-trip、乐观锁、activity 读写。
- `scripts/smoke-core-services.mjs`：全链路业务规则；乐观锁冲突、故事确认 gate、造型版本链、分镜 gate、rollup、`blocked_by_reference`；prompt supersede + 确认；任务状态机 + retry + cancel；产物 soft-delete / broken；审查 reopen 去重 + `blocked_by_issue`；导出 create/complete/fail/retry。
- `scripts/smoke-desktop-server.mjs`：Hono `app.request()`（不绑端口）验证健康探针、project/episode CRUD、故事圣经 patch（乐观锁）、model-profile 掩码 view、错误信封 (`validation_failed` / `version_conflict` / `missing_resource`) 与 404 fallback。

启动本地一体机：

```bash
# 终端 1
pnpm --filter @dramaflow/desktop-server build && \
  DRAMAFLOW_DB=./dramaflow.sqlite3 node apps/desktop-server/dist/index.js

# 终端 2
pnpm --filter @dramaflow/web dev
# → http://localhost:5173 （UI），/api/* 自动代理到 :5174
```

当前状态：`pnpm run smoke` 三段全绿；`apps/web` `next build` 12 条路由全部静态生成。

## 后续可选增强

1. `apps/web` 全模块加接 SSE `/api/events`，把轮询升级为事件推送，让 Production Hub / Export Center 状态实时刷新。
2. Storyboard Studio 页补齐 shot / keyframe / dialogue / action 的可视化编辑与 confirm gate 交互。
3. Prompt Center 加“查看 compiledPrompt / 版本 diff / 确认”按钮，直连 `/api/prompts/:id`。
4. Review Center 加规则批量 run 触发 + verdict 概览。
5. Export Center manifest 详情弹窗、artifact 引用链视图。
6. 单进程打包 (Tauri / Electron) 与凭据 KeyChain 存储（`ModelProfile.endpointKey` 目前只存引用）。
