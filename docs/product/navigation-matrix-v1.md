# 模块间跳转矩阵 navigation-matrix-v1

> 说明：本文件曾在一次文档批量整改中被误操作清空，此版本依据各模块 spec、`page-state-machine-v1.md` 与评审记录重建，主链与返工链路由条件已与各 spec 对齐；如与本地历史版本有出入，以各模块 spec 为准。

## 1. 目标与范围

- 统一定义 `DramaFlow Studio` 各模块之间的跳转关系，避免各模块 spec 各写一套导航。
- 覆盖三类跳转：
  - 主链正向推进（Project Setup 到 Export Center）
  - 反查与返工回跳（下游回到上游修复）
  - Dashboard / 全局快捷入口跳转
- 与 `page-state-machine-v1.md` 保持一致：跳转的前置条件一律引用状态机中的持久状态与派生态，不在本文件另立状态。

## 2. 模块与主链定义

- 正式模块（10 个，命名以 `prd-v1.md` §9 为准）：
  - Project Setup
  - Project Dashboard
  - Story Workspace
  - Asset Ledger
  - Script Editor
  - Storyboard Studio
  - Prompt Center
  - Production Hub
  - Review Center
  - Export Center
- 主链（正向生产链路）：
  - `Project Setup -> Story Workspace -> Script Editor -> Storyboard Studio -> Prompt Center -> Production Hub -> Review Center / Export Center`
- 支撑面（非主链、可从任意主链页进入）：
  - `Project Dashboard`：项目总览与阶段推进的运营驾驶舱入口
  - `Asset Ledger`：资产台账，供故事层与分镜层引用

## 3. 上下文携带规范

- 所有跨模块跳转统一通过路由上下文携带定位信息，禁止依赖页面内隐式状态。
- 面包屑上下文（顶部固定）：`项目 > 集 > 场 > 镜`，对应 `projectId / episodeId / sceneId / shotId`。
- 通用上下文参数：
  - `projectId`：所有页面必带
  - `episodeId` / `sceneId` / `shotId`：按目标模块所处层级携带
  - `returnTo`：标记返工跳转的回跳目标，例如 `production_hub`、`prompt_center`
  - `promptSpecId`：从 Prompt Center 进入生产时携带的唯一 prompt 版本号
  - `sourceEntityRef`：prompt / 任务对应的 source 实体引用（shot / scene 等）
  - `taskId`：从 Production Hub 反查时携带
  - `keyframeId`（可选）：回跳分镜修复时定位到具体关键帧
  - `scopeType` / `scopeRef`：审查范围定位（项目 / 集 / 场 / 镜）
- 回跳约定：带 `returnTo` 的跳转在目标动作完成后，应提供“返回来源页”的显式入口，回到发起跳转的模块。

## 4. 通用跳转规则

- 主链跳转必须满足目标模块的进入前置条件（见 §5 各条），否则入口置灰并提示缺失项。
- 破坏性或不可逆跳转（如覆盖 confirmed prompt 后进入生产）需二次确认，规则对齐 `prd-modules-and-prototypes-v1.md` §13.2。
- 失败码映射：下游失败态（如任务失败、source 过期、artifact 缺失）复用 `adr-004-api-error-envelope-v1.md` 的错误信封，并映射到对应修复页入口（见 §6）。
- 导航一致性：左侧模块导航固定，任意页面右上角统一展示“保存状态 + 最近保存时间”。

## 5. 主链跳转矩阵

### 5.1 Project Setup -> Story Workspace

- 触发
  - 完成项目初始化关键字段后点击“进入故事开发”
- 前置条件
  - 项目必填字段（`genre` / `audience` 等）已保存
- 携带上下文
  - `projectId`
- 说明
  - `genre` / `audience` 在故事层只读回显，唯一编辑入口仍在 Project Setup

### 5.2 Story Workspace -> Script Editor

- 触发
  - 故事层动作栏 `进入剧本编辑`
- 前置条件
  - 故事层事实（`logline` / `theme` / `worldRules` 等）完整，`storyStatus` 满足进入剧本的完整性检查
- 携带上下文
  - `projectId` / `episodeId`

### 5.3 Script Editor -> Storyboard Studio

- 触发
  - 剧本页场次动作 `跳转 scene 编辑`
- 前置条件
  - 目标 scene 已在剧本中定义
- 携带上下文
  - `projectId` / `episodeId` / `sceneId`

### 5.4 Storyboard Studio -> Prompt Center

- 触发
  - 分镜导演台动作 `进入 Prompt 中心`
- 前置条件
  - 当前 scene 对应 `storyboardStatus = confirmed`
  - 该场全部可生产 shot 已过 keyframe 门禁（start+end 且 confirmed，见 adr-006 §4）——由 confirmed 前置校验保证，故进入 Prompt 即可编译 video
- 携带上下文
  - `projectId` / `episodeId` / `sceneId` / `shotId`
- 反向入口
  - Prompt Center 提供 `返回分镜导演台`

### 5.5 Prompt Center -> Production Hub

- 触发
  - Prompt Center 动作 `进入生产中心`
- 前置条件
  - 目标 prompt 来自 `confirmed`，不能是 `superseded`
  - 进入生产前检查不存在 `error`；存在 `warning` 时可进入但需二次确认
- 携带上下文
  - `promptSpecId`
  - `sourceEntityRef`
- 说明
  - 任一进入生产的 prompt 都有唯一 `PromptSpecId`

### 5.6 Production Hub -> Review Center / Export Center

- 触发
  - 任务进入 `succeeded` 后，从生产中心进入审查或导出
- 前置条件
  - Review Center：存在可审查的 source / artifact
  - Export Center：存在可用的目标 artifact（如 `final_video_bundle` 需存在可用视频 artifact）
- 携带上下文
  - Review Center：`scopeType` / `scopeRef`
  - Export Center：`sourceRefs` / `artifactRefs`

## 6. 反查与返工跳转定义

### 6.1 Production Hub -> Prompt Center

- 用途
  - failed task 反查 prompt
- 携带上下文
  - `taskId`
  - `returnTo=production_hub`
- 说明
  - 修复 prompt 后可回到生产中心重新发起任务
- 接收方（已落地）
  - `prompt-center-spec §6.3.1`：接收 `taskId` + `returnTo=production_hub`，展示 `返回生产中心` 回跳入口

### 6.2 Prompt Center -> Storyboard Studio

- 用途
  - `source_outdated` 或 source 缺失时回跳修复
- 携带上下文
  - `keyframeId`（可选）
  - `returnTo=prompt_center`
- 说明
  - 分镜修复并重新 confirmed 后，回到 Prompt Center 重新编译

### 6.3 Review Center -> Source Modules

- 用途
  - issue 定位修复
- 携带上下文
  - `scopeRef` 指向的 source 实体（故事 / 剧本 / 分镜 / prompt）
  - `returnTo=review_center`
- 说明
  - 修复后回到审查中心，可将对应问题标记 resolved / reopened
- 接收方（已落地，统一展示 `返回审查中心` 回跳入口）
  - `story-workspace-spec §11.3`（`scopeRef=episodeId`）
  - `asset-ledger-spec §17.3`（`scopeRef=artifactId`）
  - `storyboard-studio-spec §6.3.2`（`scopeRef=sceneId`/`shotId`）
  - `prompt-center-spec §6.3.1`（`scopeRef=promptSpecId`）
  - `production-hub-spec §9.3.1`（`scopeRef=shotId`/`promptSpecId`）

### 6.4 Export Center -> Production Hub

- 用途
  - 导出缺少 artifact 时回到生产补齐
- 携带上下文
  - `sourceRefs` / `artifactRefs`
  - `returnTo=export_center`
- 说明
  - 判断缺少 artifact 还是文件写入失败后，重试导出或返回生产中心补齐
- 接收方（已落地）
  - `production-hub-spec §9.3.1`：接收 `sourceRefs` / `artifactRefs` + `returnTo=export_center`，展示 `返回导出中心` 回跳入口

## 7. Dashboard 快捷入口跳转规则

### 7.1 快捷入口统一规则

- Project Dashboard 的快捷入口按“当前阶段 + 阻塞项”生成，直接跳转到对应主链模块。
- 快捷入口一律携带完整上下文（至少 `projectId`，按阶段追加 `episodeId` / `sceneId` / `shotId`），进入后落在具体待办对象上，避免二次寻找。
- 快捷入口的可用性与 §5 的进入前置条件一致：前置不满足时置灰并提示缺失项。

### 7.2 阻塞展示规则

- Dashboard 对每个阶段展示是否存在阻塞（来自 `page-state-machine-v1.md` 的 `blocked` 派生态）。
- 阻塞项需给出可点击的修复入口，跳转规则复用 §6 的反查 / 返工定义。
- 阻塞未解除时，下游主链快捷入口保持置灰，保证跳转矩阵与状态机口径一致。
