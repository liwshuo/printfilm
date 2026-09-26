# Docs Review Action v1.0

## 1. 目标

把 `docs-review-v1.md` 的评审项转为可执行整改清单，统一状态：

- `resolved`: 已回写到主文档
- `in_progress`: 已定方案，待补充或二次核对
- `open`: 尚未开工
- `dropped`: 明确不做

## 2. 已解决项

### 2.1 阻塞与高优先级

| ID | 结论 | 状态 | 回写位置 |
| --- | --- | --- | --- |
| R-01 | 新增 `task_logs` | resolved | `data-and-api-v1.md` |
| R-02 | `generation_tasks` 增加 `usage_json`、`cost_estimate`、`duration_ms` | resolved | `data-and-api-v1.md` |
| R-03 | `prompt_specs` 增加版本与 source 快照字段 | resolved | `data-and-api-v1.md` |
| R-04 | 补 `scene_dialogue_blocks`、`scene_action_blocks` | resolved | `data-and-api-v1.md` |
| R-05 | 补 `script_snapshots` | resolved | `data-and-api-v1.md` |
| R-06 | 补 `review_runs`，`review_issues.review_run_id` 关联 | resolved | `data-and-api-v1.md` |
| R-07 | 分集地图与角色关系字段补齐 | resolved | `data-and-api-v1.md` |
| R-08 | 补 `style_guides` 建模 | resolved | `data-and-api-v1.md` |
| R-15 | 分镜确认粒度定为 `scene` 级，`episode` 保留聚合展示 | resolved | `data-and-api-v1.md`、`page-state-machine-v1.md` |
| R-16 | retry 语义统一为“新建任务 + retry_of_task_id”，原任务保持终态 | resolved | `job-orchestrator-contract-v1.md`、`data-and-api-v1.md` |
| R-26 | 模块引用缺失端点回填到总 API 清单 | resolved | `data-and-api-v1.md` |
| R-27 | continuity anchors API 补齐 | resolved | `data-and-api-v1.md` |
| R-28 | 三层确认动作端点独立化，故事层采用项目级 `POST /api/projects/:projectId/story/confirm` | resolved | `data-and-api-v1.md`、`story-workspace-spec-v1.md` |
| R-32 | `model_profiles.endpoint_key` 仅存密钥引用，原始密钥进 OS keychain | resolved | `data-and-api-v1.md`、`adr-001-key-storage-v1.md` |
| R-33 | 实时更新策略冻结为 `SSE + 轮询兜底` | resolved | `adr-002-realtime-updates-v1.md` |
| R-34 | 乐观锁策略冻结为 `version` 递增校验 | resolved | `adr-003-optimistic-locking-v1.md` |
| R-35 | 统一 API 错误信封与错误码 | resolved | `adr-004-api-error-envelope-v1.md` |
| R-38 | migration 工具与版本约定冻结 | resolved | `adr-005-migration-strategy-v1.md` |
| R-45 | 去掉 Prompt Center 手动 supersede 按钮 | resolved | `prompt-center-spec-v1.md` |
| R-46 | 去掉 Prompt Center 接口映射残留 supersede 端点 | resolved | `prompt-center-spec-v1.md` |
| R-47 | 为六张新增表补齐 TypeScript 类型与 `AppendOnlyEntity` | resolved | `data-and-api-v1.md` |
| R-48 | 资产对象 `characters / locations / props` 补 `version`，并纳入乐观锁范围 | resolved | `data-and-api-v1.md`、`adr-003-optimistic-locking-v1.md`、`asset-ledger-spec-v1.md` |
| R-49 | `Episode.storyboardStatus` 扩展 `partial`，并补聚合规则与更新时机 | resolved | `data-and-api-v1.md` |
| R-50 | `ready_for_review` 明确限定为 `Scene.storyboardStatus` 的派生态 | resolved | `data-and-api-v1.md` |
| R-51 | 补 scene 复制与重排端点 | resolved | `data-and-api-v1.md`、`script-editor-spec-v1.md` |
| R-52 | 调整 `review_runs` 与 `review_issues` 的建表顺序，消除前向外键引用 | resolved | `data-and-api-v1.md` |
| R-56 | 分镜导演台同步 `is_key_shot`、`version`、continuity 端点与 scene 语义 | resolved | `storyboard-studio-spec-v1.md` |
| R-57 | 按页面主查询路径补索引 | resolved | `data-and-api-v1.md` |

### 2.2 中优先级

| ID | 结论 | 状态 | 回写位置 |
| --- | --- | --- | --- |
| R-09 | `export_bundles` 补 scope/version/status 字段，默认 `queued` | resolved | `data-and-api-v1.md` |
| R-10 | `generation_tasks.retry_of_task_id` | resolved | `data-and-api-v1.md` |
| R-11 | 审查证据与规则码、事件操作人补齐 | resolved | `data-and-api-v1.md` |
| R-12 | `shots.is_key_shot` 补齐 | resolved | `data-and-api-v1.md` |
| R-13 | 补 `activity_events` | resolved | `data-and-api-v1.md` |
| R-18 | Character 字段与 ReviewIssueEvent/SQL 对齐 | resolved | `data-and-api-v1.md` |
| R-19 | 补齐缺失领域类型（ProjectStoryBible/Prop/ContinuityAnchor/StyleGuide/ExportBundle） | resolved | `data-and-api-v1.md` |
| R-20 | confirmed 唯一性约束 | resolved | `data-and-api-v1.md` |
| R-29 | shot 重排/复制/删除端点补齐 | resolved | `data-and-api-v1.md` |
| R-30 | 导出下载端点补齐 | resolved | `data-and-api-v1.md` |
| R-31 | look 路由统一为 `/api/character-looks/:lookId` | resolved | `data-and-api-v1.md`、`asset-ledger-spec-v1.md` |
| R-17 | 资产删除策略统一为“无硬删除、有引用只能停用”，PATCH `status=disabled` 落停用 | resolved | `data-and-api-v1.md`、`asset-ledger-spec-v1.md`、`prd-modules-and-prototypes-v1.md` |
| R-36 | 列表端点统一分页/排序/筛选参数 contract（§7.0） | resolved | `data-and-api-v1.md` |
| R-37 | `Artifact.filePath`/`ExportBundle.outputPath` 统一为项目数据根相对路径，补 `path_missing` 校验流程（§6.1） | resolved | `data-and-api-v1.md` |

### 2.3 低优先级与编辑性

| ID | 结论 | 状态 | 回写位置 |
| --- | --- | --- | --- |
| R-39 | 首批 ADR 已实际落文档 | resolved | `adr-001-key-storage-v1.md`、`adr-002-realtime-updates-v1.md`、`adr-003-optimistic-locking-v1.md`、`adr-004-api-error-envelope-v1.md`、`adr-005-migration-strategy-v1.md` |
| R-41 | 修正 `storyboard-studio-spec-v1.md` 重复的 `### 14.3` 编号 | resolved | `storyboard-studio-spec-v1.md` |
| R-24 | 项目级字段声明唯一编辑页面：`genre`/`audience` 归 Project Setup，`tone`/`worldRules` 归 Story Workspace，另一页只读回显 | resolved | `project-setup-spec-v1.md`、`story-workspace-spec-v1.md` |
| R-53 | ADR 目录冲突收口：`repo-structure-v1.md` §16 明确 V1 设计冻结阶段 ADR 先放 `docs/product/`，进入实现阶段后整体迁移 `docs/decisions/` | resolved | `repo-structure-v1.md` |
| R-55 | 行动清单补齐 45 条首轮评审项并纳入 round2 新问题 | resolved | `docs-review-action-v1.md` |

## 3. 本轮新增已收口

| ID | 结论 | 状态 | 回写位置 |
| --- | --- | --- | --- |
| R-14 | look 多版本冻结为“一版本一行”，补 `look_group_id/version_no/previous_look_id/is_current` | resolved | `data-and-api-v1.md`、`asset-ledger-spec-v1.md` |
| R-54 | 默认版本约束落到索引：`character_id` 上 `is_default=1 AND is_current=1` 唯一 | resolved | `data-and-api-v1.md`、`asset-ledger-spec-v1.md` |

## 4. 本轮清理已收口（命名 / 阶段数 / 目录 / 实现顺序 / 层级 / 命名说明）

| ID | 结论 | 状态 | 回写位置 |
| --- | --- | --- | --- |
| R-21 | `prd-v1.md` §9 已核实对齐 10 模块正式命名，无旧命名（`Project Workspace` / `Story Engine` 等）残留 | resolved | `prd-v1.md` |
| R-22 | 阶段状态数已统一为“9 个”，`prd-modules-and-prototypes-v1.md` §3.2 与项目总览一致 | resolved | `prd-modules-and-prototypes-v1.md`、`project-dashboard-spec-v1.md` |
| R-23 | `architecture-v1.md` §11 的 packages / data 目录（`packages/repositories`、`packages/review-rules`、`data/sqlite`、`data/logs`）已与 `repo-structure-v1.md` 对齐 | resolved | `architecture-v1.md`、`repo-structure-v1.md` |
| R-25 | 实现顺序统一为唯一权威版本 `data-and-api-v1.md` §10，README 与 `repo-structure-v1.md` §18 改为引用（§18 仅保留与之一致的目录骨架顺序） | resolved | `README.md`、`repo-structure-v1.md`、`data-and-api-v1.md` |
| R-40 | `prd-modules-and-prototypes-v1.md` 各模块子节编号已修正为与父章节一致（`### 3.1`~`### 13.3`） | resolved | `prd-modules-and-prototypes-v1.md` |
| R-42 | 全量文档 `## N.N` 子节已统一降为 `###`（内部“字段/动作/规则/用途/展示内容”等小标题同步降为 `####`）；`navigation-matrix-v1.md` 在整改中被误清空，已依据各模块 spec、状态机与评审记录重建并修正层级 | resolved | `navigation-matrix-v1.md`、`asset-ledger-spec-v1.md`、`production-hub-spec-v1.md`、`prompt-center-spec-v1.md`、`reference-adoption-policy-v1.md`、`storyboard-studio-spec-v1.md`、`data-and-api-v1.md`、`project-setup-spec-v1.md`、`review-center-spec-v1.md`、`story-workspace-spec-v1.md` |
| R-43 | README 开头与 `repo-structure-v1.md` §1 已说明产品名统一用 `DramaFlow Studio`，`printfilm-next` 仅作为实现仓名保留 | resolved | `README.md`、`repo-structure-v1.md` |
| R-44 | 导出中心 §8 标题已更名为“导出历史列表区规格” | resolved | `export-center-spec-v1.md` |

> 备注：`navigation-matrix-v1.md` 为重建版本，主链与返工链路由条件已与各模块 spec 对齐，建议按实际历史版本再快速核对一次。

## 5. 下一步执行顺序

- docs-review（首轮 45 条）与 round2 的整改项已全部收口，**无遗留 open**。
- 进入实现阶段：按 `data-and-api-v1.md` §10 实现顺序（`migration -> domain types -> repositories -> core services -> contracts -> artifact/review/export`）搭建骨架。
- 优先实现主链页面：`Storyboard Studio`、`Prompt Center`、`Production Hub`。
