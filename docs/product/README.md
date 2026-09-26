# Product Docs Index

- 产品名为 `DramaFlow Studio`
- 当前仓库名 `printfilm-next` 仅作为实现仓名保留，后续文档均以产品名为准

## 文档列表

- `prd-v1.md`
  - 平台产品目标、用户、工作流、模块范围
- `architecture-v1.md`
  - 系统分层、模块边界、Prompt Compiler 与 Job Orchestrator 设计
- `data-and-api-v1.md`
  - 数据模型、SQLite 草案、TypeScript 类型、API 路由
- `reference-adoption-policy-v1.md`
  - 参考项目采用策略、代码复用边界、License 风险与禁止复制模式
- `prompt-compiler-contract-v1.md`
  - Prompt Compiler 的输入输出、禁止行为、版本与确认机制
- `job-orchestrator-contract-v1.md`
  - Job Orchestrator 的任务状态机、worker 边界、回调与产物回写
- `repo-structure-v1.md`
  - 仓库目录结构、模块落位、依赖方向与实现顺序
- `prd-modules-and-prototypes-v1.md`
  - 按模块拆解的功能规格、实际效果、验收标准与页面级 Mermaid 原型图
- `storyboard-studio-spec-v1.md`
  - 分镜导演台字段级规格、状态流转、抽屉弹窗与页面级原型（模块深挖第一份）
- `prompt-center-spec-v1.md`
  - Prompt 中心字段级规格、PromptSpec 版本流转、确认机制与页面级原型
- `production-hub-spec-v1.md`
  - 生产中心字段级规格、任务状态机映射、日志与产物回填页面设计
- `review-center-spec-v1.md`
  - 审查中心字段级规格、issue 流转、定位与修复闭环页面设计
- `export-center-spec-v1.md`
  - 导出中心字段级规格、bundle/manifest/版本追溯与下载交付页面设计
- `asset-ledger-spec-v1.md`
  - 设定台账字段级规格、版本策略、引用关系与影响分析页面设计
- `story-workspace-spec-v1.md`
  - 故事开发字段级规格、AI assist 选择应用、完整性检查与页面设计
- `script-editor-spec-v1.md`
  - 剧本编辑字段级规格、scene 结构化编辑、快照与分镜推进页面设计
- `project-setup-spec-v1.md`
  - 项目初始化/设置字段级规格、关键字段影响评估与页面设计
- `project-dashboard-spec-v1.md`
  - 项目总览字段级规格、阶段推进、阻塞问题与运营驾驶舱页面设计
- `model-settings-spec-v1.md`
  - 模型设置全局页字段级规格：model profile 增删改查、启用/停用、密钥绑定/测试/解绑（`model_profiles` 与密钥管理的唯一模块 owner，密钥策略遵循 adr-001）
- `page-state-machine-v1.md`
  - 全页面持久状态、UI 派生态、阻塞规则与上下游联动总表
- `navigation-matrix-v1.md`
  - 模块间跳转矩阵、主链与返工链路由条件、上下文携带规范
- `docs-review-v1.md`
  - 全量文档一致性评审结论、45 条待办问题、冻结前的修订顺序
- `docs-review-action-v1.md`
  - docs-review 逐条整改状态、已回写项与待 ADR 决策清单
- `docs-review-round2-v1.md`
  - 第二轮复核：已验证解决项、状态失真项与 12 条新发现
- `feature-completeness-review-v1.md`
  - 实现前 10 个模块功能细节完善度评审：8 维度 rubric、模块评级、系统性问题与补齐顺序
- `adr-001-key-storage-v1.md`
  - 模型密钥存储策略，确定使用 OS keychain + 引用键
- `adr-002-realtime-updates-v1.md`
  - 实时更新策略，确定使用 SSE + 轮询兜底
- `adr-003-optimistic-locking-v1.md`
  - 乐观锁策略，统一核心对象的 version 冲突处理
- `adr-004-api-error-envelope-v1.md`
  - API 错误响应结构，统一错误信封与错误码
- `adr-005-migration-strategy-v1.md`
  - SQLite migration 策略，统一版本号、执行与兼容规则
- `adr-006-core-scope-decisions-v1.md`
  - 三个核心口径决策：故事确认作用域（分集级）、keyframe 门禁范围（可生产 shot 一律 start+end）、Export 编排链路（compose_export 任务驱动）
- `implementation-status-v2-a1-and-round2.md`
  - A1 项目模型（`series | drama` + nullable `episode_id` scope + m2m 引用表）与 4 参考项目 7 项改进点的落地矩阵、端到端已打通场景、二轮借鉴纳入项与下一步顺序

## 建议阅读顺序

1. `prd-v1.md`
2. `architecture-v1.md`
3. `data-and-api-v1.md`
4. `reference-adoption-policy-v1.md`
5. `prompt-compiler-contract-v1.md`
6. `job-orchestrator-contract-v1.md`
7. `repo-structure-v1.md`
8. `prd-modules-and-prototypes-v1.md`
9. `storyboard-studio-spec-v1.md`
10. `prompt-center-spec-v1.md`
11. `production-hub-spec-v1.md`
12. `review-center-spec-v1.md`
13. `export-center-spec-v1.md`
14. `asset-ledger-spec-v1.md`
15. `story-workspace-spec-v1.md`
16. `script-editor-spec-v1.md`
17. `project-setup-spec-v1.md`
18. `project-dashboard-spec-v1.md`
19. `model-settings-spec-v1.md`
20. `page-state-machine-v1.md`
21. `navigation-matrix-v1.md`
22. `docs-review-v1.md`
23. `docs-review-action-v1.md`
24. `docs-review-round2-v1.md`
25. `feature-completeness-review-v1.md`
26. `adr-001-key-storage-v1.md`
27. `adr-002-realtime-updates-v1.md`
28. `adr-003-optimistic-locking-v1.md`
29. `adr-004-api-error-envelope-v1.md`
30. `adr-005-migration-strategy-v1.md`
31. `adr-006-core-scope-decisions-v1.md`
32. `implementation-status-v2-a1-and-round2.md`

## 设计来源

- `drama-skills`
  - 工作流骨架
  - creator-first
  - 先确认后生产
- `short-drama`
  - 剧情规则
  - 节奏与钩子体系
  - 审查逻辑
- `CineGen-ShortDrama`
  - 导演工作台
  - 关键帧驱动
  - continuity 设计
- `huobao-drama`
  - 多模型接入
  - 任务编排
  - 媒体处理与导出
- `trae_projects`
  - adapter 风格的模型调用参考

## 当前结论

- V1 采用 `local-first` 形态
- 平台运行在本机
- 模型调用走云端 API
- 事实层与执行层彻底分离
- Prompt Compiler 是唯一 prompt 出口
- Job Orchestrator 是唯一任务入口
- 外部项目默认只参考方法、结构和 contract，不直接拼装代码与内容资产
- PRD 已补充到模块级功能规格，并为每个模块提供页面级原型图
- 已补充页面状态机总表与模块间跳转矩阵
- 已完成一次全量文档一致性评审，并已建立整改闭环清单，见 `docs-review-v1.md` 与 `docs-review-action-v1.md`
- 已补齐 5 份开发前关键 ADR，文档基线已更接近可冻结状态
- 第二轮复核确认 26 条整改已落地，但发现 2 条状态失真与 12 条新问题，见 `docs-review-round2-v1.md`
- 已完成实现前功能细节完善度评审（`feature-completeness-review-v1.md`），并据此完成一轮文档收口：
  - 新增 `adr-006` 钉死 3 个核心口径：故事确认作用域（分集级权威 + 项目级派生 rollup）、keyframe 门禁（可生产 shot 一律 start+end 且 confirmed）、Export 编排（compose_export 任务驱动 bundle 状态）
  - `data-and-api-v1.md` 补齐 Setup 落库字段、scene 冲突、Prompt 结构化 sections、task error_code、export compose_task_id，以及故事/剧本/审查/导出的缺失端点与 9 阶段派生规则
  - 10 个模块 spec 已对齐新契约、硬化接口，并统一贯穿乐观锁（adr-003）、错误信封（adr-004）、实时更新（adr-002）三条横切规范
- 在上一轮 P0 收口基础上，再完成一轮 P1/P2 缺口收口（本轮）：
  - **ReviewRun 状态词表统一**：拆分为正交的 `ReviewRunStatus`（`queued/running/succeeded/failed`）与 `ReviewRunVerdict`（`passed/blocked`），并对齐 `review-center-spec` §7.6 与 `page-state-machine` 派生态
  - **API 响应契约归一**：新增 `data-and-api-v1.md` §6.3，将 `validate-setup`、`preview-impact`、`completeness-check`、`storyboard/validate`、model profile 等「同一端点两套 schema」收敛为唯一权威命名类型，各模块 spec 改为引用
  - **文本 / LLM 任务口径收口**：`PromptTargetType` 增加 `text`，明确文本任务仍走 Prompt Compiler（系统模板 + 事实层自动编译，不进 Prompt Center 手工编辑），Production Hub 仅允许手工创建媒体任务
  - **模型配置与密钥管理归属**：新增 `model-settings-spec-v1.md` 作为 `model_profiles` 与密钥管理的唯一模块 owner，密钥策略遵循 adr-001（SQLite 只存引用键，原始 key 进 OS Keychain）
  - **回跳上下文双向落地**：`returnTo` 在来源页发起、目标页接收两侧均落地（Production Hub↔Prompt Center、Review Center→Story/Asset/Storyboard/Prompt/Production、Export Center→Production Hub），并对齐 `navigation-matrix`
  - **核心 JSON blob 补 schema**：StoryBible 各子对象、`ReviewEvidence`、`ScriptSnapshotPayload`、`ActivityEvent` 等由 `Record<string, unknown>` 改为命名 TS 结构
  - **首屏骨架态补齐**：Story Workspace / Script Editor / Asset Ledger / Storyboard Studio / Review Center 五页统一补充结构化 skeleton 加载态与局部刷新不清空规范
- 结论（客观）：文档层面 P0 缺口已收口，本轮 P1/P2 缺口亦已收口；架构、交互与需求细节达到「P1/P2 收口后可进入实现」状态。实现过程中若发现新的口径缺口，仍以对应 spec + `data-and-api-v1.md` 为唯一权威回写

## 下一步建议

- 实现顺序仍以 `data-and-api-v1.md` §10「实现顺序建议」为唯一权威版本（`migration -> domain types -> repositories -> core services -> contracts -> artifact/review/export`），其余文档一律引用它
- 实现前先通读 `adr-006-core-scope-decisions-v1.md`，三个核心口径为跨模块前置约束
- 从 `packages/domain`、`packages/repositories` 与核心 services 开始搭代码骨架
- 优先实现主链页面：
  - `Storyboard Studio`
  - `Prompt Center`
  - `Production Hub`
- 然后补支撑链页面：
  - `Review Center`
  - `Asset Ledger`
  - `Story Workspace`
  - `Script Editor`
  - `Project Dashboard`
  - `Export Center`
