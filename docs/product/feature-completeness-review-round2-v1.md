# DramaFlow Studio 实现前完备度独立复核（第二轮）

- 文档：`feature-completeness-review-round2-v1.md`
- 评审人：李硕（lishuo.oo）
- 评审时间：2026-09-21
- 评审范围：`docs/product/` 全部 31 份文档（约 1.24 万行）
- 评审方式：独立只读核查（不改文档、不写代码），4 组并行深度评审 + 主审跨组交叉验证与逐条独立核实
- 基线：本轮建立在 `feature-completeness-review-v1.md`（第一轮 P0 收口）与其 §8（上一轮 P1/P2 收口）之上，聚焦**仍然残留**的缺口

---

## 1. 总体结论

**一句话结论：文档已达到可开工状态，无 P0（无「前后端会各写一套 / 无法开工」的硬缺口）。** 上两轮钉死的核心口径（adr-006 三决策、响应契约 §6.3、文本任务 §8.6、returnTo 双向、ReviewRun 状态拆分、横切规范 §7.12）经本轮独立复核确认已在各 spec 与数据契约中**真实落地且相互自洽**。四大链路（入口总览 / 事实层 / 生产核心 / 执行闭环）核心均为 Ready / Production Ready。

**残留为 5 条 P1 + 6 条 P2**，性质均为「收口更严的小口径 / 归口一致性 / 体验完善」，**不阻塞开工**。

> **更新（2026-09-21）：5 条 P1 已全部收口**，详见 §7。文档基线现判定为「实现前完备」，P2 与实现并行处理即可。下方 §2 P1 清单保留原始记录以备追溯。

### 1.1 各簇完善度评级总表

| 文档簇 | 代表文档 | 评级 | 残留 P0 | 残留 P1 | 关键短板 |
|---|---|---|---|---|---|
| 入口与总览 | prd / architecture / prd-modules / project-setup / project-dashboard / model-settings / repo-structure / README | 基本可实现 | 0 | 3 | Dashboard 审查中心入口卡状态口径悬空；部分响应类型未归口；model-settings 用了未登记错误码 |
| 事实层 | data-and-api / story-workspace / script-editor / asset-ledger / reference-adoption-policy | 可直接实现 | 0 | 1 | validate 端点响应类型未归口 §6.3；blocks 无 version 豁免未在权威处登记 |
| 生产核心 | storyboard-studio / prompt-center / prompt-compiler / production-hub / job-orchestrator | 可直接实现 | 0 | 0 | 链路闭环严密，无 P0/P1；仅少量 P2 |
| 执行闭环+横切 | review-center / export-center / page-state-machine / navigation-matrix / adr-001~006 | 基本可实现 | 0 | 2 | schema_migrations 表 DDL 缺失；ExportManifest 命名类型未归口 data-api |

### 1.2 严重度定义

- **P0**：缺了会导致前后端各写一套 / 无法开工的硬缺口（本轮 **0 条**）。
- **P1**：影响主流程质量或需求确定性（口径悬空、契约归口不一致、错误码未登记）。
- **P2**：边界 / 体验 / 横切超集性完善项。

---

## 2. 残留缺口清单（P1，建议开工前收口）

> 均已逐条独立核实（精确到 §章节 / 字段 / 表名 / 类型名），非二手转述。

- `[维度1/3] P1 | project-dashboard-spec §11.2 快捷入口区 vs data-and-api §6.2 九阶段`
  - 问题：§11.2「快捷入口区」把**审查中心**列为入口卡（§239），并规定入口卡 `moduleStatus`「复用对应阶段 `stageStatus`（见 §7 / §6.2 派生表）」（§246）。但 data-api §6.2「Dashboard 9 阶段」= Setup / Story Bible / Episodes / Script / Assets / Storyboard / Prompt / Production / Export，**不含「审查」阶段**。审查中心入口卡无对应阶段可复用 → 其状态口径悬空。
  - 建议：明确审查中心入口卡的状态来源——要么补一条「审查」派生态（基于最近 review-run 的 `status`/`verdict` 与 open issue 数），要么在 §11.2 声明审查中心为「常驻可进入」且不复用阶段状态。

- `[维度1/2] P1 | data-and-api §6.3 归口不完整（validate / dashboard-metrics 响应类型）`
  - 问题：上轮已将多数「同一端点两套 schema」收敛到 §6.3，但仍有两个端点的响应类型**只定义在模块 spec、未归口 §6.3**：`POST /api/scenes/:sceneId/validate`（script-editor §201 仅口述「返回逐检查项 ok/warning/error 与定位 ref」，无命名类型）；`GET /api/projects/:projectId/dashboard-metrics`（`DashboardMetrics` 定义在 project-dashboard §8.3）。与「响应契约唯一权威在 data-api §6.3」原则不一致。
  - 建议：把 `SceneValidateResult`、`DashboardMetrics` 提升到 data-api §6.3，模块 spec 改为引用注释（与本轮其余 §6.3 类型处理方式一致）。

- `[维度2/5] P1 | data-and-api 缺 schema_migrations 表 DDL（adr-005）`
  - 问题：adr-005 定义了 SQLite 版本化迁移策略，data-api §9 实现顺序也提到「SQLite migration」，但 data-api 的 DDL 段**没有 `schema_migrations`（或等价版本记录）表定义**。Repository / 迁移层缺统一落地依据。
  - 建议：在 data-api DDL 段补 `schema_migrations` 表（version / applied_at 等），与 adr-005 策略对齐。

- `[维度2] P1 | ExportManifest 命名类型未归口 data-api（JSON 黑盒遗漏项）`
  - 问题：export-center §383 定义了 `interface ExportManifest`，但 data-api 权威处 `ExportBundle.manifest` 仍是 `Record<string, unknown>`（§1146）、表列 `manifest_json`（§568）。这是上轮「核心 JSON blob 补命名 schema、唯一权威在 data-api §6」治理的一个遗漏对象。
  - 建议：将 `ExportManifest` 结构移入 data-api §6 作为唯一权威，export-center 改为引用。

- `[维度6] P1 | model-settings 引用了 adr-004 未定义的错误码 blocked_by_reference`
  - 问题：model-settings §5.3（§68）删除保护返回 `blocked_by_reference`（标注 adr-004），但 adr-004 §4 必备错误码清单为 validation_failed / version_conflict / invalid_state / blocked_by_issue / missing_resource / path_missing / provider_unavailable / task_not_retryable / export_not_ready / internal_error，**无 `blocked_by_reference`**。错误码不在权威清单 → 前端无法统一映射。
  - 建议：二选一——把 `blocked_by_reference` 补入 adr-004 §4，或复用 `blocked_by_issue`/`invalid_state` 并在 details 里带引用来源。

---

## 3. 残留缺口清单（P2，可实现中处理）

- `[维度5] P2 | scene dialogue/action blocks 的 PATCH 不带 version 豁免未在权威处显式登记`
  - script-editor §8.4（§172）明确「对白块/动作块自身不带 version，其增删改不改变 scenes.version」，属**有意设计**；但 data-api §7.12 只写「适用对象见 adr-003 §5」，adr-003 §5 未把 blocks 显式列为豁免对象。blocks 是可 PATCH 编辑对象却不走乐观锁，存在并发覆盖（last-write-wins 静默覆盖）风险——单机 local-first V1 影响很小。
  - 建议：在 adr-003 §6「不适用范围」或 data-api §7.12 显式登记 blocks 为乐观锁豁免对象，说明理由。

- `[维度3] P2 | shot 级 status 字典（含 ready）未纳入 page-state-machine 横切总表`
  - storyboard §14.3「Shot Status 派生规则」使用 `ready` 等 shot 级状态，但 page-state-machine（横切权威）总表仅收录 storyStatus / scriptStatus / storyboardStatus 等模块主状态，**未收录 shot 级 status 字典**。横切超集性有小缺口。
  - 说明（**纠正一处评审误报**）：shot 级 `ready` 与 scene 级 `storyboardStatus=ready_for_review` 是**不同对象的不同字段**，不构成「状态词冲突」；真正的小缺口是 shot status 未进横切总表。
  - 建议：在 page-state-machine 补收 shot 级 status 字典，或注明「shot 级状态以 storyboard spec §14.3 为准」。

- `[维度8] P2 | adr-002 未逐事件定义 payload 字段级 schema`
  - adr-002 §5 列出事件主题（含 `review.run.finished`）并要求「payload 必须是结构化对象」，但未逐事件给出字段级 schema（如 review.run.finished 是否直接携带 status/verdict）。因各页均有 GET 兜底端点（review 用 `GET /api/review-runs/:runId`），即便 payload 只带 id 也可拉取最新，风险可控。
  - 建议：为高频事件补最小 payload 字段约定，减少一次回拉。

- `[维度4] P2 | prd-modules 原型图阶段节点数疑与文字不一致`
  - prd-modules §76 文字为「展示 9 个阶段状态」，需核对同页 Mermaid 原型图节点数是否同为 9（疑为 8）。属文档内部小不一致。
  - 建议：核对并对齐原型图节点数与 §6.2 九阶段。

- `[维度2] P2 | targetDurationSec 双写已声明主从、建议加实现期校验`
  - `projects.target_duration_sec`（data-api §133）与 `output_spec_json.targetDurationSec`（§700/782）双写；project-setup §107/§151 已声明「同值、以基础信息值为准、二者不得冲突」，**主从口径已明确**，非缺口。
  - 建议：实现时加一处写入校验/断言，防止两者漂移。

- `[体验] P2 | README 阅读顺序按「模块深挖顺序」排列，与业务流方向不直观`
  - 当前阅读顺序 storyboard(#9) 早于 story(#15)、setup(#17)，是历史「模块深挖」顺序，非「Setup→Story→Script→…→Export」业务流方向，新读者不易顺读。
  - 建议：README 增加一条「按业务流推荐阅读」索引，或调整顺序编号。

---

## 4. 跨文档一致性交叉校验结论（已通过项）

以下为本轮重点交叉验证、确认**已一致无残留**的项：

- **ReviewRun 状态词表**：`ReviewRunStatus`(queued/running/succeeded/failed) + `ReviewRunVerdict`(passed/blocked) 在 data-api、review-center §7.6、page-state-machine 派生态三处一致，无残留旧 pending/passed/failed 混用。
- **returnTo 双向闭环**：navigation-matrix §6.1/§6.3/§6.4 登记的每个接收方，在目标 spec 均有真实接收章节（Story §11.3 / Asset §17.3 / Storyboard §6.3.2 / Prompt §6.3.1 / Production §9.3.1），双向一一对应。
- **PromptTargetType 口径**：`text` 仅在 data-api §8.6 走系统模板编译，prompt-compiler §9 `CompileInput` 有意只约束 image/video/tts，§131 已注明 text 不走 CompileInput；Production Hub 创建 modal 仅媒体三类。三处自洽。
- **keyframe 门禁**：storyboard / prompt / adr-006 对「可生产 shot 一律 start+end 且 confirmed」表述一致，`StoryboardValidateResult.keyframeGate` 作为超集子项定位清晰。
- **横切规范 §7.12**：乐观锁 / 错误信封 / 实时更新在 Dashboard/Production/Review/Export 的快照+SSE+轮询兜底端点均已落地。
- **model_profiles 归属**：model-settings 作为唯一 owner，与 data-api §7.7 端点、adr-001 密钥策略、Prompt Center 候选来源（isActive+credentialBound+modelType 匹配）一致。

---

## 5. 建议的收口顺序（开工前，均为文档层小改）

1. **归口类（一次做完）**：将 `SceneValidateResult`、`DashboardMetrics`、`ExportManifest` 提升到 data-api §6.3/§6，模块 spec 改引用；补 `schema_migrations` 表 DDL。（对应 §2 第 2、4 条与 P1-3）
2. **错误码登记**：adr-004 §4 增补 `blocked_by_reference`（或改用既有码）。（§2 第 5 条）
3. **Dashboard 审查入口口径**：明确审查中心入口卡状态来源。（§2 第 1 条）
4. **P2 顺手项**：adr-003 §6 登记 blocks 乐观锁豁免；page-state-machine 补收 shot status；README 加业务流阅读索引。

> 完成上述 5 条 P1 后，文档基线可判定为「实现前完备」。P2 与实现并行处理即可。实现过程中若暴露新的口径缺口，仍以对应 spec + `data-and-api-v1.md` 为唯一权威回写，不在代码里另立事实。

---

## 6. 附：评审方法说明

- 本报告由 4 组并行独立只读评审（入口总览 / 事实层 / 生产核心 / 执行闭环+横切）汇总，每组按统一 8 维度 rubric 逐模块核对，并交叉验证 data-and-api、page-state-machine、navigation-matrix 与各契约/ADR。
- 主审对四组上报的每条 P0/P1 做了**逐条独立复核**（grep/read 精确取证），甄别并纠正了 1 处误报（shot 级 `ready` 被误判为违反 scene 级 `ready_for_review`）、下调了 2 条严重度（blocks 无 version、SSE payload schema 由 P1 降 P2），确保清单可直接落实到 spec 修订。

---

## 7. P1 收口状态（2026-09-21 已完成）

本轮识别的 5 条 P1 已全部在文档层收口，逐条对应改动如下：

- **P1-1 Dashboard 审查入口状态口径**：`project-dashboard-spec §11.2/§11.3` 已把入口卡拆为「阶段型入口」（复用 §6.2 阶段 `stageStatus`）与「非阶段型入口（审查中心）」；审查中心 `moduleStatus` 改由审查态派生（`blocked`/`in_progress`/`done`，来源 `blocking-issues` + 最近 review-run，口径对齐 Review Center §7.6），并明确审查中心作为常驻中控**始终可进入**、不置灰。
- **P1-2 响应类型归口 §6.3**：`data-and-api §6.3` 新增 `SceneValidateResult`（含逐检查项 `ok/warning/error` + 定位 `ref`）与 `DashboardMetrics` 两个权威类型；`/scenes/:id/validate` 与 `/dashboard-metrics` 两端点均加权威引用注释；`script-editor §9.1`、`project-dashboard §8.3` 已改为引用 §6.3。
- **P1-3 schema_migrations 表 DDL**：`data-and-api` DDL 段（PRAGMA 之后）新增 `CREATE TABLE schema_migrations (version / applied_at / checksum)`，对齐 adr-005 §4.2；表清单新增 §3.6「系统 / 元数据层」收录该表。
- **P1-4 ExportManifest 归口**：`data-and-api §6` 新增权威 `ExportManifest` 结构，`ExportBundle.manifest` 类型由 `Record<string, unknown>` 改为 `ExportManifest`；`export-center §15.3` 改为引用 data-api 权威。
- **P1-5 blocked_by_reference 错误码登记**：`adr-004 §4` 必备错误码增补 `blocked_by_reference`，并在 §5 补充其与 `blocked_by_issue` 的语义区分（引用保护 vs issue 阻塞）；`model-settings §5.3` 的使用现已在权威清单内。

**收口后结论**：本轮 5 条 P1 全部闭环，无 P0/P1 残留。文档基线判定为**「实现前完备，可进入实现」**。剩余 6 条 P2 不阻塞开工，可与实现并行处理（其中 targetDurationSec 双写已有主从口径，仅需实现期加一致性校验）。实现过程中若暴露新的口径缺口，仍以对应 spec + `data-and-api-v1.md` 为唯一权威回写，不在代码里另立事实。
