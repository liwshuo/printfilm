# Docs Review v1.0

## 1. 文档目标

本文档记录对 `docs/product` 全量文档的一次一致性评审，用于：

- 标记页面规格与数据模型之间的对不上之处
- 标记文档之间互相矛盾的结论
- 标记已被引用但尚未定义的 API 与类型
- 标记全系统需要、但当前没有任何一份文档负责的决策
- 给出进入代码骨架前的修订顺序

本文档不引入新的产品决策，只指出需要决策的位置。

## 2. 评审范围

- 范围
  - `docs/product/*.md`，共 20 份规格文档加 1 份索引，合计约 8570 行
- 方法
  - 逐份通读，以 `data-and-api-v1.md` 的 schema 与类型为基线，交叉核对各模块 spec、状态机总表与跳转矩阵
- 限制
  - 仓库当前没有代码，所有结论基于文档之间的相互一致性，不涉及实现

## 3. 结论摘要

### 3.1 文档基线评价

- 分层边界定义得足够硬
  - 事实层与执行层分离
  - `Prompt Compiler` 是唯一 prompt 出口
  - `Job Orchestrator` 是唯一任务入口
  - 三条原则在架构、两份 contract、仓库结构中反复出现且没有互相拆台
- 每份文档都显式写了“不负责什么”和禁止行为清单
- UI 派生态已收敛成统一字典，并要求各页面复用、不得自造近义词
- 模块 spec 已细化到字段级、空态错态级、抽屉弹窗级，可直接进入 UI 实现

### 3.2 核心问题

- 页面 spec 已经细到字段级，但数据模型还停在上一版
- 两者之间目前有 14 处对不上
- 其中 5 处会直接卡住开发

### 3.3 问题分布

| 类别 | 阻塞 | 高 | 中 | 低 | 合计 |
| --- | --- | --- | --- | --- | --- |
| 数据模型缺口 | 3 | 5 | 5 | 1 | 14 |
| 文档互相矛盾 | 1 | 1 | 5 | 5 | 12 |
| API 契约缺口 | 0 | 2 | 3 | 1 | 6 |
| 跨领域未决 | 1 | 2 | 4 | 1 | 8 |
| 编辑性问题 | 0 | 0 | 0 | 5 | 5 |
| 合计 | 5 | 10 | 17 | 13 | 45 |

核对基线：`docs/product` 全部 20 份规格文档，最后修改时间均不晚于 2026-09-21 14:14。

### 3.4 对“设计冻结”的建议

- 当前不建议直接冻结
- 建议先完成两件事再冻结
  - 定下 `R-15` 分镜确认粒度
  - 定下 `R-32` 模型密钥存储方式
- 否则 `packages/domain` 一旦落地就要返工

## 4. 阻塞项（先定这五条）

### R-15 分镜确认粒度：episode 还是 scene

- 严重度：`阻塞`
- 类别：文档互相矛盾
- 证据
  - `data-and-api-v1.md` 把 `storyboard_status` 放在 `episodes` 表上
  - `page-state-machine-v1.md` §8.1 写 `Episode.storyboardStatus`
  - `storyboard-studio-spec-v1.md` §12.3 写“scene `storyboardStatus` 更新为 `confirmed`”
  - `storyboard-studio-spec-v1.md` §7.2 要求每个 scene item 展示 `storyboardStatus`
  - `navigation-matrix-v1.md` §5.4 的前置条件是“当前 scene 对应 `storyboardStatus=confirmed`”
  - `scenes` 表目前没有任何 status 列
- 影响
  - 确认按钮的作用域
  - Prompt 中心的门禁条件
  - 审查范围的挂载点
  - “修改已确认分镜后状态回退”落在哪一层
- 建议
  - 选 scene 级：给 `scenes` 加 `storyboard_status`，`episodes.storyboard_status` 改为派生聚合
  - 选 episode 级：改写分镜台与跳转矩阵，scene 导航栏只展示完成度不展示状态

### R-32 模型 API Key 的存储方式未定义

- 严重度：`阻塞`
- 类别：跨领域未决
- 证据
  - 平台明确要调云端 image / video / llm / tts API
  - `model_profiles.endpoint_key` 是全部文档中唯一与密钥相关的字段
  - 21 份文档没有任何一处讨论密钥存储位置、是否加密、或从环境变量读取
- 影响
  - 默认实现结果会是本机 SQLite 明文存储
  - 项目归档包导出时可能连带导出密钥
- 建议
  - 以 ADR 形式确定：环境变量 / 加密列 / OS keychain
  - 同时明确 `project_archive_bundle` 的密钥剔除规则

### R-01 任务日志没有表

- 严重度：`阻塞`
- 类别：数据模型缺口
- 证据
  - `data-and-api-v1.md` §7.8 定义了 `GET /api/tasks/:taskId/logs`
  - `job-orchestrator-contract-v1.md` §15 要求结构化日志，字段为 task id / event type / timestamp / message / optional payload
  - `production-hub-spec-v1.md` §9.7 要求展示 `taskLogEvents[]`
  - schema 中没有 `task_logs` 表
- 建议
  - 新增 `task_logs`，字段对齐 §15 的最低要求与推荐事件枚举

### R-02 成本字段全缺

- 严重度：`阻塞`
- 类别：数据模型缺口
- 证据
  - `prd-v1.md` §11 把“单集平均成本”列为 V1 成功指标
  - `project-dashboard-spec-v1.md` §8.1 有成本卡，展示今日成本与累计成本
  - `production-hub-spec-v1.md` §6.2 有 `estimatedCost`，§8.3 有成本列，§8.6 支持按成本排序
  - `generation_tasks` 没有任何 cost、token 用量或耗时列
- 建议
  - 决定成本落点：`generation_tasks` 加 `cost_estimate` / `usage_json`，或单独建 `task_costs`
  - 同时明确成本是 provider 返回值还是本地按 model profile 估算

### R-03 PromptSpec 没有版本号，`source_outdated` 算不出来

- 严重度：`阻塞`
- 类别：数据模型缺口
- 证据
  - `prompt-center-spec-v1.md` §9.4 版本列表要展示 `versionNo` / `createdBy` / `diffFromPrevious`
  - `production-hub-spec-v1.md` §8.3 要展示 `promptSpecVersion`
  - `page-state-machine-v1.md` §14 把 `source_outdated` 定义为“source 版本高于 prompt 版本”
  - `prompt_specs` 只有 `compiler_version`，没有版本号
  - `scenes` / `shots` / `keyframe_specs` 三张表都没有 `version` 列
  - `prompt_specs` 也没有记录编译时的 source 版本快照
- 影响
  - 主链上最关键的派生态目前无法计算
  - Prompt 中心的返工链与 readiness checks 都建立在这个派生态之上
- 建议
  - `prompt_specs` 增加 `version`、`superseded_by`、`source_version_snapshot_json`
  - `scenes` / `shots` / `keyframe_specs` 增加 `version`，在编辑时递增

## 5. 数据模型缺口

页面 spec 明确要求的字段，在 SQLite 表结构里没有落点。

### R-04 对白块与动作块没有表

- 严重度：`高`
- 证据
  - `script-editor-spec-v1.md` §8.3 定义 Dialogue Block：`speakerCharacterId` / `text` / `emotion` / `deliveryNote` / `order`
  - §8.4 定义 Action Block：`actionText` / `actorRefs[]` / `propRefs[]` / `order`
  - §8.5 定义 `sceneTags[]`
  - `scenes` 表只有一个 `summary` 文本字段
- 建议
  - 新增 `scene_dialogue_blocks` 与 `scene_action_blocks`
  - `sceneTags` 可落在 `scenes` 的 json 列

### R-05 剧本快照没有表

- 严重度：`高`
- 证据
  - `script-editor-spec-v1.md` §10 要求 `snapshotId` / `versionLabel` / `createdAt` / `createdBy` / `changeSummary`，并支持恢复
  - §18 引用 `POST /api/episodes/:episodeId/snapshots`
  - schema 中没有任何快照表
- 建议
  - 新增 `script_snapshots`，存整集 scene 结构的序列化快照

### R-06 审查运行没有表

- 严重度：`高`
- 证据
  - `review-center-spec-v1.md` §6.2 要求 `lastReviewRunAt`
  - §6.3 要求“打开最近一次审查结果”
  - §7.2 定义 `scopeType` / `scopeRef` / `reviewTypes[]` / `runMode`
  - `review_issues` 无法归属到某一次运行
- 建议
  - 新增 `review_runs`，`review_issues` 增加 `review_run_id`

### R-07 分集地图与角色关系字段缺失

- 严重度：`高`
- 证据
  - `story-workspace-spec-v1.md` §8.3 要求 `episodeGoal` / `episodeConflict` / `episodeTurn` / `episodeEndingHook`
  - `episodes` 表只有 `summary` 与 `hook_type`
  - §8.2 要求 `mainCharacter` / `mainConflict` / `relationshipMap` / `motivationChain`
  - `project_story_bibles` 的 json 列中没有对应位置
- 建议
  - `episodes` 增加分集地图 json 列
  - `project_story_bibles` 增加 `character_relations_json`

### R-08 StyleGuide 从未被建模

- 严重度：`高`
- 证据
  - `prd-v1.md` §8.2 视觉设定文档包含“视觉风格”
  - `prd-v1.md` §9.4 资产台账包含“风格规则管理”
  - `prompt-compiler-contract-v1.md` §5.2 把 `StyleGuide` 列为设定层输入类型
  - schema 没有 `style_guides` 表，TS 类型没有该 interface，资产台账页面也没有对应 tab
- 建议
  - 补 `style_guides` 表与类型，并在 `asset-ledger-spec-v1.md` 增加一个 tab
  - 或明确 V1 不做，从 PRD 与 compiler contract 中移除

### R-09 `export_bundles` 字段不足且默认状态矛盾

- 严重度：`中`
- 证据
  - `export-center-spec-v1.md` §9 需要 scope 类型与引用、`versionLabel`、`finishedAt`、`bundleSize`、失败原因
  - `export_bundles` 这些字段全部没有
  - 表定义为 `status TEXT NOT NULL DEFAULT 'ready'`
  - §14.1 的状态机是 `queued` / `running` / `ready` / `failed`
- 建议
  - 补齐缺失列，默认值改为 `queued`

### R-10 `generation_tasks` 缺 `retry_of_task_id`

- 严重度：`中`
- 证据
  - `job-orchestrator-contract-v1.md` §13.2 要求“原任务保留、新建新任务、新任务关联原任务 id”
  - 表里只有 `retry_count`，没有指向原任务的外键
- 建议
  - 增加 `retry_of_task_id`，自引用外键

### R-11 `review_issues` 缺证据字段，事件缺操作人

- 严重度：`中`
- 证据
  - `review-center-spec-v1.md` §9.3 要求 `reviewEvidence` 与 `ruleCode`
  - §8.1 要求列表展示 `sourceVersion`
  - §9.4 要求状态历史展示 `changedBy`
  - 这四个字段在 `review_issues` 与 `review_issue_events` 中都不存在
- 建议
  - `review_issues` 增加 `rule_code` / `evidence_json` / `source_version`
  - `review_issue_events` 增加 `changed_by`

### R-12 `shots` 缺 `is_key_shot`

- 严重度：`中`
- 证据
  - `storyboard-studio-spec-v1.md` §8.5 支持“标记为关键镜头”
  - §12.2 的确认门禁之一是“所有关键 shot 至少有 start/end frame”
  - `shots` 表没有对应字段
- 建议
  - 增加 `is_key_shot`，否则该门禁无法实现

### R-13 最近活动流没有数据来源

- 严重度：`中`
- 证据
  - `project-dashboard-spec-v1.md` §10.1 列了 8 类事件
  - §10.2 要求 `eventType` / `summary` / `actor` / `timestamp` / `targetRef`
  - 没有任何 activity 或 audit 表来产生这些事件
- 建议
  - 新增 `activity_events`，由各 service 在状态变更时写入

### R-14 look 版本模型与版本历史面板对不上

- 严重度：`低`
- 证据
  - `character_looks` 只有一个 `version` 整数列
  - `asset-ledger-spec-v1.md` §10.2 要求 `versionNo` / `createdBy` / `changeSummary` / `isCurrent`
  - §10.4 规定“已引用版本不允许直接覆盖，通过新版本替代”，这要求一个版本一行
  - §8.2 的 `hairSpec` / `makeupSpec` 在表里也没有对应列
- 建议
  - 明确 look 版本是“同 look 多行”还是“单行 + 独立版本表”
  - 补 `created_by` 与 `change_summary`

## 6. 文档互相矛盾

两份及以上文档对同一件事给出了不同答案。`R-15` 见第 4 节。

### R-16 retry 有两套互斥语义

- 严重度：`高`
- 证据
  - `job-orchestrator-contract-v1.md` §8.2 允许 `failed -> queued`，即原任务复活
  - 同文档 §13.2 要求保留原任务并新建任务
  - `production-hub-spec-v1.md` §18 写“重试不覆盖原任务记录”
- 建议
  - 统一为“新建任务 + `retry_of_task_id`”
  - 删除 §8.2 的 `failed -> queued` 边

### R-17 资产删除策略不一致

- 严重度：`中`
- 证据
  - `prd-modules-and-prototypes-v1.md` §12.2 把“删除资产”“删除分镜”列为需二次确认的破坏性动作
  - `asset-ledger-spec-v1.md` §11.3 规定有引用时不允许删除、只允许停用
  - `data-and-api-v1.md` §7.4 没有 characters / locations / props 的 DELETE 路由
- 建议
  - 统一为“无引用可删、有引用只能停用”，并补对应 DELETE 路由

### R-18 TS 类型与 SQL 不同步

- 严重度：`中`
- 证据
  - `Character` 类型缺 `genderPresentation` / `ageRange` / `taboos`，这三个字段 SQL 里有，`asset-ledger-spec-v1.md` §8.1 的字段表里也有
  - `ReviewIssueEvent extends BaseEntity` 要求 `updatedAt`
  - `review_issue_events` 表只有 `created_at`
- 建议
  - 补齐 `Character` 字段
  - `ReviewIssueEvent` 不继承 `BaseEntity`，或给表补 `updated_at`

### R-19 契约引用了未定义的类型

- 严重度：`中`
- 证据
  - `prompt-compiler-contract-v1.md` §9 的 `PromptCompilerInput` 用到 `ProjectStoryBible`、`Prop`、`ContinuityAnchor`
  - `data-and-api-v1.md` §6 没有定义这三个 interface
  - `ExportBundle`、`StyleGuide` 以及 `scene_characters` / `shot_characters` / `shot_props` 的行类型同样缺失
- 影响
  - 按当前文档，`PromptCompilerInput` 无法通过类型检查
- 建议
  - 把 §6 补到与 SQL 表一一对应

### R-20 “同一 source+target 只能有一个 confirmed”没有约束落点

- 严重度：`中`
- 证据
  - `prompt-center-spec-v1.md` §13.3 把它列为关键约束
  - §18 把它列为页面级验收标准
  - schema 没有对应的 partial unique index
- 建议
  - 增加 `UNIQUE(source_entity_type, source_entity_id, target_type) WHERE status = 'confirmed'`

### R-21 模块命名有两套

- 严重度：`低`
- 证据
  - `prd-v1.md` §9 用 `Project Workspace` / `Story Engine` / `Story Editor`，共 9 个模块
  - 其余所有文档用 `Project Dashboard` / `Story Workspace` / `Script Editor`，共 10 个模块
- 建议
  - 把 `prd-v1.md` §9 对齐到 10 模块命名

### R-22 阶段数量对不上

- 严重度：`低`
- 证据
  - `prd-modules-and-prototypes-v1.md` §3.2 写“展示 8 个阶段状态”
  - `project-dashboard-spec-v1.md` §7.1 列了 9 个阶段
- 建议
  - 统一为 9 个阶段

### R-23 packages 与 data 目录清单不一致

- 严重度：`低`
- 证据
  - `architecture-v1.md` §11 的目录建议中没有 `packages/repositories` 与 `packages/review-rules`
  - `repo-structure-v1.md` §13 与 §14 为这两个包专门写了职责章节
  - `data/` 目录两处不同，`repo-structure-v1.md` §15 多了 `sqlite/` 与 `logs/`
- 建议
  - 以 `repo-structure-v1.md` 为准，回填 `architecture-v1.md` §11

### R-24 项目级字段没有声明归属页面

- 严重度：`低`
- 证据
  - `project-setup-spec-v1.md` §7 与 §8.1 可编辑 `genre` / `audience` / `tone` / `worldRules`
  - `story-workspace-spec-v1.md` §8.1 同样可编辑这几个字段
  - 两处分别落在 `projects` 与 `project_story_bibles` 上
- 影响
  - 没有 owner 声明，实现时容易双写并产生两套真相
- 建议
  - 明确每个字段的唯一编辑页面，另一页只读回显

### R-45 prompt supersede 在页面层有冗余手动动作

- 严重度：`中`
- 证据
  - `prompt-center-spec-v1.md` §13.2 规定重新编译时旧版本自动标记 `superseded`
  - §14.3 规定确认动作会把同 source + target 的旧 confirmed 置为 `superseded`
  - 以上两条说明 supersede 是自动副作用，不是用户动作
  - §14.1 的全局操作栏仍保留手动按钮 `标记 superseded`
  - §14.2 的按钮启用条件只写了“确认当前版本”与“进入生产中心”，该按钮没有启用条件
- 影响
  - §13.3 规定进入生产的 prompt 必须来自 `confirmed`
  - 手动把唯一的 confirmed 置为 `superseded` 会让该 source 失去可生产版本，且没有定义恢复路径
- 建议
  - 去掉手动按钮，supersede 只作为重新编译与确认的副作用
  - 若保留，必须补启用条件与恢复路径，并说明与 `POST /api/prompts/:promptId/supersede` 的关系

### R-25 实现顺序有三个版本

- 严重度：`低`
- 证据
  - `README.md` 建议从 `packages/domain` 与 `packages/repositories` 开始
  - `repo-structure-v1.md` §18 是 domain → prompt-compiler → job-runner → repositories
  - `data-and-api-v1.md` §10 是 migration → types → repository → services
- 建议
  - 保留一份，其余引用它

## 7. API 契约缺口

模块 spec 引用了 `data-and-api-v1.md` §7 正式清单里不存在的端点。

### R-26 模块 spec 引用了正式清单里没有的端点

- 严重度：`高`
- 证据
  - `POST /api/scenes/:sceneId/storyboard/validate`
  - `POST /api/scenes/:sceneId/storyboard/confirm`
  - `POST /api/scenes/:sceneId/validate`
  - `DELETE /api/scenes/:sceneId`
  - `POST /api/episodes/:episodeId/script/confirm`
  - `POST /api/episodes/:episodeId/script/push-to-storyboard`
  - `POST /api/episodes/:episodeId/snapshots`
  - `GET /api/assets/:assetType/:assetId/usage`
- 建议
  - 全部回填到 `data-and-api-v1.md` §7，该文档是 API 的唯一真相源

### R-27 `continuity_anchors` 没有任何 API

- 严重度：`高`
- 证据
  - 它是 schema 中的一等表
  - `storyboard-studio-spec-v1.md` §11 为它设计了完整的 Continuity Inspector 面板
  - §11.4 定义了新建 / 编辑 / 删除 / 从上一镜自动建议四个动作
  - `data-and-api-v1.md` §7.5 没有任何相关路由
- 建议
  - 补 CRUD 路由与“自动建议”路由

### R-28 三层确认动作都没有显式端点

- 严重度：`中`
- 证据
  - `story-workspace-spec-v1.md` §11.1 有“确认故事层”
  - `script-editor-spec-v1.md` §11.1 有“确认剧本”
  - `storyboard-studio-spec-v1.md` §12.1 有“确认当前场分镜”
  - 目前只能映射到通用 PATCH
- 影响
  - 确认动作带副作用：回退下游状态、生成快照、触发校验
- 建议
  - 为三个确认动作分别定义独立路由

### R-29 shot 的排序、复制、删除缺端点

- 严重度：`中`
- 证据
  - `storyboard-studio-spec-v1.md` §8.5 支持拖拽排序、复制、删除
  - §8.6 要求排序后自动重算 `shotNo`
  - API 只有 `PATCH /api/shots/:shotId`
- 影响
  - 逐条 PATCH 重排会出现中间态，破坏 `UNIQUE(scene_id, shot_no)`
- 建议
  - 增加批量重排端点，在单个事务内完成

### R-30 导出没有下载端点

- 严重度：`中`
- 证据
  - `export-center-spec-v1.md` §9.4 要展示 `downloadUrl` 并提供下载按钮
  - `data-and-api-v1.md` §7.11 只有 manifest 与 retry
- 建议
  - 增加下载路由

### R-31 looks 路由命名脱离约定

- 严重度：`低`
- 证据
  - `PATCH /api/looks/:lookId` 与其他路由的资源命名不一致
  - 表名是 `character_looks`，其他路由都用完整资源名
- 建议
  - 改为 `/api/character-looks/:lookId`

## 8. 跨领域未决

全系统都要用，但当前没有任何一份文档负责。`R-32` 见第 4 节。

### R-33 没有选实时更新方案

- 严重度：`高`
- 证据
  - `production-hub-spec-v1.md` §9.3 要求“任务状态变化实时可见”
  - §15.2 要求 running 时“显示最新日志滚动”
  - `project-dashboard-spec-v1.md` §14 要求阶段状态与真实模块状态同步
  - `architecture-v1.md` 与 `data-and-api-v1.md` 都没有在 SSE / WebSocket / 轮询之间做选择
- 建议
  - 以 ADR 形式确定推送方案

### R-34 并发与乐观锁没有定义

- 严重度：`高`
- 证据
  - `asset-ledger-spec-v1.md` §16.4 有“当前对象已被更新，请刷新后再编辑”错态
  - `version` 列存在于 `episodes` / `character_looks` / `project_story_bibles`
  - 没有文档说明 `version` 的递增时机与 API 层的 If-Match 语义
- 建议
  - 明确乐观锁策略，并在 §7 的 PATCH 路由上统一约定

### R-35 没有统一的 API 错误响应约定

- 严重度：`中`
- 证据
  - 每个模块 spec 都有完整的错态文案与动作
  - 全局只定义了导航层的 `NavigationCheckResult`
  - HTTP 层的错误信封没有约定
- 建议
  - 定义统一错误结构：code / message / details / retryable

### R-36 列表端点没有分页与筛选参数

- 严重度：`中`
- 证据
  - `production-hub-spec-v1.md` §7.1 有 6 个筛选维度加日期范围
  - `review-center-spec-v1.md` §8.2 有 7 个筛选维度
  - `data-and-api-v1.md` §7 只写了路径，没有 query 参数约定
- 建议
  - 为列表端点定义统一的分页、排序、筛选参数规范

### R-37 `artifacts.file_path` 的语义未定

- 严重度：`中`
- 证据
  - 没有说明是绝对路径还是相对 `data/` 的路径
  - `export-center-spec-v1.md` §16.3 有“路径失效”错态
  - `page-state-machine-v1.md` §14 有 `path_missing` 派生态
  - 没有任何文档描述文件与数据库的对账流程
- 建议
  - 统一为相对路径，并定义一个路径校验与修复流程

### R-38 migration 方案未选

- 严重度：`中`
- 证据
  - `data-and-api-v1.md` §10 的第一步就是“SQLite migration”
  - 没有定迁移工具、版本号约定
  - 没说 schema 变更时本地已有项目数据怎么处理
- 建议
  - 以 ADR 形式确定迁移工具与版本约定

### R-39 ADR 目录还是空的

- 严重度：`低`
- 证据
  - `repo-structure-v1.md` §16 规定了 `docs/decisions/` 与 `docs/engineering/`
  - `README.md` 下一步建议写“先冻结文档基线并补充必要 ADR”
  - 两个目录目前都不存在
- 建议
  - `R-32` / `R-33` / `R-34` / `R-38` 正好是首批四份 ADR 的内容

## 9. 编辑性问题

不影响实现，但影响文档本身的可读性与目录生成。

### R-40 `prd-modules-and-prototypes-v1.md` 标题编号坏了

- 严重度：`低`
- 证据
  - 有两个 `## 4.`，模块 1 与模块 2 共用
  - “模块 1：项目总览”的子节用的是 `### 3.1` 到 `### 3.5`，是从模块 0 复制后没改

### R-41 `storyboard-studio-spec-v1.md` 有两个 `### 14.3`

- 严重度：`低`
- 证据
  - “Shot Status 派生规则”与“派生条件”用了同一个编号

### R-42 多处用 `##` 承载应为 `###` 的子节

- 严重度：`低`
- 证据
  - `navigation-matrix-v1.md` §5.1 到 §5.6
  - `asset-ledger-spec-v1.md` §8.1 到 §8.4
  - `production-hub-spec-v1.md` §12.1
  - `prompt-center-spec-v1.md` §15.1 到 §15.3
  - `reference-adoption-policy-v1.md` §3.1 到 §3.5
  - `storyboard-studio-spec-v1.md` §13.1 到 §13.3

### R-43 产品名与仓库名不一致

- 严重度：`低`
- 证据
  - 文档一律用 `DramaFlow Studio`
  - 仓库名是 `printfilm-next`
  - 没有一句话交代两者关系

### R-44 导出中心一个章节标题词不达意

- 严重度：`低`
- 证据
  - `export-center-spec-v1.md` §8 标题为“中央视图列表区”，内容是导出历史列表

## 10. 建议修订顺序

前两条是决策，不是补文档；定下来之后后面几条才有唯一答案。

1. 定死分镜确认粒度（`R-15`），同步修改 schema 与 4 份相关文档
2. 写 ADR：模型 API Key 的存储方式（`R-32`）
3. 补齐执行层缺的四张表：`task_logs` / `review_runs` / `script_snapshots` / `activity_events`（`R-01` `R-06` `R-05` `R-13`）
4. 给 `prompt_specs` 加版本号并记录 source 版本快照，让 `source_outdated` 可计算（`R-03`）
5. 决定成本模型的落点（`R-02`）
6. 把 retry 语义统一为“新建任务 + `retry_of_task_id`”（`R-16` `R-10`）
7. 把 TS 类型补到与 SQL 一一对应（`R-19` `R-18`）
8. 把各模块 spec 的端点回填进 `data-and-api-v1.md`，并补 `continuity_anchors`、确认动作、shot 排序、导出下载（`R-26` 到 `R-30`）
9. 去掉 Prompt 中心的手动 supersede 按钮，或为它补齐启用条件与恢复路径（`R-45`）
10. 再写三份 ADR：实时推送方案、乐观锁策略、migration 工具与约定（`R-33` `R-34` `R-38`）
11. 修标题编号、统一模块命名、对齐阶段数量与 packages 清单（`R-21` 到 `R-23`、`R-40` 到 `R-44`）

## 11. 一句话结论

- 这套文档的方法论和边界已经立住了，真正的缺口不在想法层而在落地层：页面规格跑在了数据模型前面，先把第 4 节这五条决策补上，再冻结基线，`packages/domain` 才不会一写出来就返工。
