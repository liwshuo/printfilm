# Docs Review Round 2 v1.0

## 1. 文档目标

本文档只记录第二轮评审的发现，用于复核 `docs-review-v1.md` 与 `docs-review-action-v1.md` 的整改结果。

内容分三部分：

- 已验证解决的条目
- 状态失真的条目，即行动清单标记为 `resolved` 但实际未落地
- 本轮新发现的问题，编号从 `R-46` 接续

第一轮的问题编号与结论仍以 `docs-review-v1.md` 为准，本文档不重述。

## 2. 评审范围

- 基线
  - 第一轮评审时的文档状态，全部文件最后修改时间不晚于 2026-09-21 14:14
- 本轮
  - 2026-09-21 14:37 至 14:47 之间的修订
- 本轮变更
  - 新增 5 份 ADR 与 1 份行动清单
  - `data-and-api-v1.md` 由 927 行增至 1183 行
  - 8 份模块 spec 被修改
- 方法
  - 逐条核验行动清单中标记为 `resolved` 的条目是否真的回写到主文档
  - 通读修订后的 `data-and-api-v1.md` 与 5 份 ADR，查找新引入的不一致

## 3. 结论摘要

- 整改质量高，数据层基本重建了一遍
- 45 条中有 26 条经核验确实解决
- 2 条被标记 `resolved` 但实际未落地
- 12 条为本轮新发现，其中一部分由本轮修订自身引入
- 行动清单只覆盖 45 条中的 29 条，其余 16 条没有状态记录

## 4. 已验证解决

以下条目经逐条核验，已真实回写到主文档。

### 4.1 数据模型

- `R-01`
  - 新增 `task_logs`，字段覆盖 Logging Contract 的最低要求
- `R-02`
  - `generation_tasks` 增加 `usage_json` / `cost_estimate` / `duration_ms`
- `R-03`
  - `prompt_specs` 增加 `version` / `source_version_snapshot_json` / `superseded_by`
  - `scenes` / `shots` / `keyframe_specs` 均增加 `version`
  - `source_outdated` 现在可计算
- `R-04`
  - 新增 `scene_dialogue_blocks` 与 `scene_action_blocks`
  - `scenes` 增加 `scene_tags_json`
- `R-05`
  - 新增 `script_snapshots`
- `R-06`
  - 新增 `review_runs`，`review_issues` 增加 `review_run_id`
- `R-07`
  - `episodes` 增加分集地图四字段
  - `project_story_bibles` 增加 `character_relations_json`
- `R-08`
  - 新增 `style_guides`，类型与 API 同步补齐
- `R-09`
  - `export_bundles` 补齐 scope / version_label / bundle_size_bytes / error_message / finished_at
  - 默认状态改为 `queued`
- `R-10`
  - `generation_tasks` 增加 `retry_of_task_id`
- `R-11`
  - `review_issues` 增加 `rule_code` / `evidence_json` / `source_version`
  - `review_issue_events` 增加 `changed_by`
- `R-12`
  - `shots` 增加 `is_key_shot`
- `R-13`
  - 新增 `activity_events`
- `R-18`
  - `Character` 补回 `genderPresentation` / `ageRange` / `taboos`
  - `review_issue_events` 补 `updated_at`
- `R-19`
  - 补齐 `ProjectStoryBible` / `Prop` / `ContinuityAnchor` / `StyleGuide` / `ExportBundle` 五个类型
- `R-20`
  - 增加 confirmed 唯一性 partial unique index

### 4.2 状态与边界

- `R-15`
  - 分镜确认粒度定为 scene 级
  - `scenes` 增加 `storyboard_status`
  - `episodes.storyboard_status` 降级为聚合展示，SQL 内已加注释
  - `page-state-machine-v1.md` 已同步为 `Scene.storyboardStatus`
  - `navigation-matrix-v1.md` 与 `storyboard-studio-spec-v1.md` 原本就是场级表述，现已自洽
- `R-45`
  - `prompt-center-spec-v1.md` §14.1 的手动 `标记 superseded` 按钮已移除
  - supersede 只保留为重新编译与确认的副作用

### 4.3 API

- `R-26`
  - 8 个端点全部回填到 §7
- `R-27`
  - continuity anchors 的 CRUD 与 suggest 端点补齐
- `R-29`
  - 补 `DELETE /api/shots/:shotId`、`POST /api/scenes/:sceneId/shots/reorder`、`POST /api/shots/:shotId/duplicate`
- `R-30`
  - 补 `GET /api/exports/:exportId/download`
- `R-31`
  - `PATCH /api/looks/:lookId` 改为 `PATCH /api/character-looks/:lookId`

### 4.4 跨领域

- `R-32`
  - `ADR-001` 确定 OS keychain 加引用键方案
  - `model_profiles.endpoint_key` 已在 SQL 与类型中注明是引用键
- `R-33`
  - `ADR-002` 确定 SSE 加轮询兜底
- `R-34`
  - `ADR-003` 确定版本号乐观锁
- `R-35`
  - `ADR-004` 确定统一错误信封与错误码
- `R-38`
  - `ADR-005` 确定文件化 SQL migration 与 `schema_migrations` 表

## 5. 状态失真

以下条目在 `docs-review-action-v1.md` 中标记为 `resolved`，但核验后并未落地。

### R-16 retry 语义仍是两套，状态应回退为 `open`

- 行动清单记录
  - 结论“retry 语义统一为新建任务 + retry_of_task_id”
  - 状态 `resolved`
  - 回写位置 `data-and-api-v1.md`
- 实际情况
  - 矛盾本身不在数据层，而在 `job-orchestrator-contract-v1.md`
  - 该文件最后修改时间为 2026-09-20 20:19，本轮完全未修改
  - §8.2 仍保留 `failed -> queued`，仅发生在 retry 时
  - §13.2 仍使用“推荐实现”这种软措辞，未成为强约束
  - §7 的 `GenerationTask` 接口没有 `retryOfTaskId`，已与 `data-and-api-v1.md` 的同名类型不一致
- 结论
  - 加字段不等于消歧义
- 建议
  - 删除 §8.2 的 `failed -> queued` 边
  - §13.2 改为强约束表述
  - §7 的接口补 `retryOfTaskId`，或直接引用 `data-and-api-v1.md` 的类型

### R-28 三层确认端点只做了两层，状态应改为 `in_progress`

- 行动清单记录
  - 结论“三层确认动作端点独立化”
  - 状态 `resolved`
- 实际情况
  - `POST /api/episodes/:episodeId/script/confirm` 已补
  - `POST /api/scenes/:sceneId/storyboard/confirm` 已补
  - 故事层确认端点仍然不存在
  - `story-workspace-spec-v1.md` §11.1 的“确认故事层”与 §11.2 的 `storyStatus 为 confirmed` 仍只能映射到通用 PATCH
- 建议
  - 补 `POST /api/episodes/:episodeId/story/confirm`

## 6. 本轮新发现

### R-46 Prompt 中心接口映射仍引用已删除端点

- 严重度：`中`
- 来源：本轮修订引入
- 证据
  - `data-and-api-v1.md` §7.6 已删除 `POST /api/prompts/:promptId/supersede`
  - `prompt-center-spec-v1.md` §19 仍列出该端点
- 说明
  - `R-45` 的修法本身正确，手动按钮与端点一并移除
  - 只是接口映射一节漏改
- 建议
  - 从 §19 删除该条

### R-47 新增的六张表没有 TypeScript 类型

- 严重度：`中`
- 来源：本轮修订引入
- 证据
  - `task_logs`
  - `review_runs`
  - `script_snapshots`
  - `activity_events`
  - `scene_dialogue_blocks`
  - `scene_action_blocks`
  - 以上六张表在 §6 中都没有对应 interface
- 说明
  - `R-19` 刚补齐五个缺失类型，新增表又开了六个口子
  - `activity_events` 与 `task_logs` 是 append-only，不应继承 `BaseEntity`，需要单独的基类型
- 建议
  - 补齐六个类型
  - 为 append-only 表定义 `AppendOnlyEntity`

### R-48 ADR-003 的版本覆盖范围与 schema 不符

- 严重度：`中`
- 证据
  - `ADR-003` §3 写“所有可编辑核心对象都带 `version`”
  - `characters` / `locations` / `props` 三张表都没有 `version` 列
  - `ADR-003` §5 的适用范围列表也没有这三者的 PATCH 端点
  - `asset-ledger-spec-v1.md` §16.4 的版本冲突错态针对的正是资产对象
- 建议
  - 给三张表补 `version`，并把对应端点加入 ADR 适用范围
  - 或在 ADR 中明确这三类对象不走乐观锁，并同步修改资产台账的错态

### R-49 Episode 聚合状态缺中间态且没有维护规则

- 严重度：`中`
- 来源：`R-15` 的修法引入
- 证据
  - `episodes.storyboard_status` 已注明仅作聚合展示
  - `Episode.storyboardStatus` 的类型仍是 `ConfirmStatus`，只有 `draft` 与 `confirmed`
  - 无法表达“五个场确认了三个”
  - `project-dashboard-spec-v1.md` §7.2 要求 `completionPercent`
  - `storyboard-studio-spec-v1.md` §7.2 要求展示每个 scene 的分镜完成度
  - 没有任何文档规定该聚合字段由谁、在什么时机更新
- 建议
  - 引入 `partial` 中间态，或直接改为由 scene 状态实时派生、不落库
  - 若保留落库，必须写明更新时机

### R-50 派生态定义未限定作用对象

- 严重度：`低`
- 来源：`R-15` 的修法引入
- 证据
  - `data-and-api-v1.md` §6.1 的 `ready_for_review` 仍写“由 `storyboardStatus=draft` 且分镜校验通过派生”
  - 现在存在 `Scene.storyboardStatus` 与 `Episode.storyboardStatus` 两个同名字段
- 建议
  - 限定为 `Scene.storyboardStatus`

### R-51 scene 的重排与复制缺端点

- 严重度：`中`
- 证据
  - `script-editor-spec-v1.md` §7.2 支持复制 scene 与拖拽 scene 排序
  - §8.1 的 `sceneNo` 与 `UNIQUE(episode_id, scene_no)` 意味着重排需要批量事务
  - shot 已经有 `reorder` 与 `duplicate` 端点，scene 没有
- 建议
  - 对称补 `POST /api/episodes/:episodeId/scenes/reorder` 与 `POST /api/scenes/:sceneId/duplicate`

### R-52 建表顺序产生前向外键引用

- 严重度：`低`
- 来源：本轮修订引入
- 证据
  - `review_issues` 在 §5 中先于 `review_runs` 定义
  - `review_issues` 的外键指向 `review_runs(id)`
  - SQLite 的外键在 DML 时才解析，可以运行
  - Postgres 下该 `CREATE TABLE` 会直接失败
  - §2 的设计原则写明“SQLite 结构尽量兼容后续切换到 Postgres”
- 建议
  - 把 `review_runs` 移到 `review_issues` 之前

### R-53 ADR 存放位置与仓库结构约定冲突

- 严重度：`低`
- 证据
  - 五份 ADR 位于 `docs/product/`
  - `repo-structure-v1.md` §16 规定 `docs/decisions/` 用于存放 ADR 风格决策记录
- 建议
  - 迁移到 `docs/decisions/`
  - 或修改 `repo-structure-v1.md` 的目录约定

### R-54 look 多版本模型仍未解决

- 严重度：`低`
- 说明：`R-14` 只补了字段，核心建模问题仍在
- 证据
  - `character_looks` 已补 `hair_spec_json` / `makeup_spec_json` / `created_by` / `change_summary`
  - 但仍是单行加一个 `version` 整数
  - `asset-ledger-spec-v1.md` §10.4 要求“已引用版本不允许直接覆盖，通过新版本替代”，这要求一个版本一行
  - §8.2 的“同一角色只能有一个默认 look”没有任何约束落点
- 建议
  - 明确多版本存储形态
  - 为 `is_default` 增加 partial unique index

### R-55 行动清单未覆盖全部评审项

- 严重度：`低`
- 证据
  - `docs-review-v1.md` 共 45 条
  - `docs-review-action-v1.md` 记录了 29 条
  - 未记录的 16 条为：`R-14` `R-17` `R-21` `R-22` `R-23` `R-24` `R-25` `R-31` `R-36` `R-37` `R-39` `R-40` 到 `R-44`
  - 其中 `R-31` 与 `R-39` 实际已完成但没有记录
  - `R-17` `R-24` `R-36` `R-37` 仍然实打实开着
- 建议
  - 行动清单补全 45 条状态，缺一条都会让“闭环”失真

### R-56 分镜导演台未同步本轮新增字段与端点

- 严重度：`低`
- 证据
  - `storyboard-studio-spec-v1.md` 最后修改时间为 2026-09-21 14:02，本轮未修改
  - `docs-review-action-v1.md` §6 的首轮同步清单包含 6 份文件，不含它
  - 本轮新增的 `is_key_shot`、`version`、`Scene.storyboardStatus`、continuity anchors 端点都未进入其字段表与接口映射
- 说明
  - 它是主链核心模块，同步优先级应高于已同步的部分文档
- 建议
  - 列入下一轮同步的第一位

### R-57 索引覆盖不足

- 严重度：`低`
- 证据
  - 已加索引覆盖 `episodes` / `scenes` / `shots` / `task_logs` / `review_runs` / `review_issues` / `activity_events`
  - 高频查询路径仍缺索引：
    - `generation_tasks(project_id, status)`，生产中心默认按状态筛选
    - `generation_tasks(prompt_spec_id)`，从 prompt 反查任务
    - `prompt_specs(source_entity_type, source_entity_id)`，Prompt 中心主查询
    - `artifacts(project_id)` 与 `artifacts(source_task_id)`
    - `keyframe_specs(shot_id)` 与 `continuity_anchors(shot_id)`
- 建议
  - 按页面主查询路径补齐

## 7. 建议处理顺序

1. 修正 `R-16` 与 `R-28` 在行动清单中的状态，再按结论真正落地
2. 修 `R-46`，避免接口映射指向已删除端点
3. 补 `R-47` 的六个类型，与 `R-19` 拉齐
4. 定 `R-49` 的聚合状态形态，它会影响总览页与分镜台两处
5. 处理 `R-48` 与 `R-51`
6. 其余按 `R-50` `R-52` 到 `R-57` 顺序清理
7. 行动清单补齐 45 条状态后，再讨论文档冻结

## 8. 一句话结论

- 这一轮把第一轮指出的数据层缺口真正补上了，质量没有问题；剩下的风险不在“还有多少没做”，而在“已经标记做完但实际没做”——闭环清单一旦失真，后面每一轮复核都会建立在错误基线上。
