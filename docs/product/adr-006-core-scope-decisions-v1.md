# ADR-006 三个核心口径决策（作用域 / 粒度 / 编排）v1.0

## 1. 状态

- `accepted`

## 2. 背景

`feature-completeness-review-v1.md` §4 指出：进入实现前必须先钉死 3 个"作用域/粒度/编排"口径，否则前后端各写一套必然返工。这三处口径分散在多份文档中且相互冲突：

- Story 确认作用域：Story Workspace spec 按项目级单值处理，但 `data-and-api-v1.md` §5 `episodes.story_status` 落在集级，`page-state-machine-v1.md` §5.1 明确 `Episode.storyStatus`，`data-and-api-v1.md` §7.2 confirm 端点却是项目级。
- keyframe 门禁范围：`storyboard-studio-spec-v1.md` §10.4「每个可生产 shot 必须有 start/end」与 §12.2「所有关键 shot 至少有 start/end」口径不一致，`prompt-center-spec-v1.md` §12.2 video 前置条件又是第三套说法。
- Export 编排链路：`export-center-spec-v1.md` 未说明创建导出是否经 Job Orchestrator 生成 `compose_export` 任务，`export_bundle.status` 与底层 `task.status` 如何联动未定义。

本 ADR 一次性钉死这三处口径，作为所有相关 spec 与 `data-and-api-v1.md` 修订的唯一依据。

## 3. 决策一：Story 确认作用域 = 分集级权威

### 3.1 决策

- **持久权威态是分集级**：故事确认状态的唯一权威字段是 `Episode.storyStatus`（`draft | confirmed`），落在 `episodes` 表，与 `data-and-api-v1.md` §5 和 `page-state-machine-v1.md` §5.1 保持一致。
- **项目级不新增持久字段**：不引入项目级 `storyStatus` 持久列；项目层的「故事是否已确认」是**派生态** `projectStoryStatus`。
- **确认动作提供两个端点**：
  - `POST /api/episodes/:episodeId/story/confirm`：单集确认，权威写入 `Episode.storyStatus = confirmed`。
  - `POST /api/projects/:projectId/story/confirm`：便捷批量操作，语义 = 对满足完整性检查的全部集执行单集确认（rollup 快捷入口，不是独立真相）。

### 3.2 派生态 projectStoryStatus

- `confirmed`：项目下存在至少 1 集且全部集 `storyStatus = confirmed`
- `partial`：部分集 `confirmed`
- `draft`：无任何集 `confirmed`
- 该派生态仅用于 Dashboard / Story Workspace 概览展示与批量确认按钮态，不落库。

### 3.3 回写清单

- `story-workspace-spec-v1.md`：概览读派生 `projectStoryStatus`；确认动作区分「确认本集」与「批量确认全部集」；进入剧本编辑必须携带 `episodeId`。
- `data-and-api-v1.md`：§7.2 明确项目级 confirm = 批量语义并补单集 confirm 端点；§6.2 登记 `projectStoryStatus` 为派生态。
- `page-state-machine-v1.md`：§5.1 补充「项目级为派生 rollup，权威在集级」说明。
- `navigation-matrix-v1.md`：§5.2 前置条件以集级 `storyStatus` 表述（已一致，无需改）。

## 4. 决策二：keyframe 门禁 = 可生产 shot 一律要求 start + end 关键帧

### 4.1 决策

- **门禁对象是「可生产 shot」**：凡将进入 image / video 生产的 shot，一律要求同时存在 `start` 与 `end` 两个 `KeyframeSpec`（`frameType = start` 且 `frameType = end`），且状态为 `confirmed`。
- **`is_key_shot` 不改变门禁**：`is_key_shot` 仅表示「是否强制人工精修关键帧」，不影响 keyframe 门禁范围；非关键 shot 同样要求 start/end 才可生产，可由 AI 生成后直接确认。
- **场级确认是硬校验落点**：`Scene.storyboardStatus = confirmed` 的前置校验之一 = 该场全部 shot 均满足上述 start/end keyframe 门禁。由此保证「已确认的场必然可编译 video」，消除 §10.4/§12.2/Prompt §12.2 之间的「已确认但不可编译」静默断链。

### 4.2 校验链

- `POST /api/scenes/:sceneId/storyboard/validate`：返回 `StoryboardValidateResult`（data-api §6.3，权威结构）。其中 keyframe 门禁结果为每个 shot 的 `keyframeGate` 子项（缺 start / 缺 end / 未 confirmed）；该端点在门禁之外还返回基础字段缺口与 continuity 判级，本 ADR 只约束 `keyframeGate` 部分，不与更宽的校验响应冲突。
- `POST /api/scenes/:sceneId/storyboard/confirm`：门禁未全部通过时返回 `invalid_state` 错误信封，`details` 列出未达标 shot。
- Prompt Center video 编译前置 = 对应 shot 已通过 keyframe 门禁（由场级 confirmed 保证），不再单独定义第三套口径。

### 4.3 回写清单

- `storyboard-studio-spec-v1.md`：§10.4 与 §12.2 统一为「可生产 shot 一律要求 start/end」，写进场级 validate/confirm 校验。
- `prompt-center-spec-v1.md`：§12.2 video 前置直接引用本门禁（「已确认场即已满足」）。
- `data-and-api-v1.md`：§7.3 `storyboard/validate` 与 `storyboard/confirm` 明确校验规则。
- `page-state-machine-v1.md`：§8.5 阻塞条件「keyframe 不完整」明确为「可生产 shot 缺 start/end」。

## 5. 决策三：Export 编排 = 经 Job Orchestrator 生成 compose_export 任务

### 5.1 决策

- **创建导出 = 创建一个 `compose_export` 任务**：`POST /api/exports` 在写入 `export_bundles` 记录的同时，经 Job Orchestrator 创建一个 `compose_export` 的 `generation_task`（由 Compose Worker 执行 FFmpeg 拼接 / 字幕烧录 / 打包，见 `job-orchestrator-contract-v1.md` §10.5）。
- **bundle 与 task 1:1 关联**：`export_bundles` 新增 `compose_task_id` 关联到该任务。
- **status 由 task 驱动**：`export_bundle.status` 由 `compose_export` 任务状态映射驱动，同时保留 bundle 级语义：
  - task `queued` → bundle `queued`
  - task `running` → bundle `running`
  - task `succeeded` → bundle `ready`（同事务写入 `output_path` / `manifest_json` / `bundle_size_bytes`，并按 §17 生成 bundle artifact）
  - task `failed` → bundle `failed`（写入 `error_message`）
  - task `cancelled` → bundle `failed`（视为导出中止）
- **进度与实时**：复用 `adr-002-realtime-updates-v1.md` §5 的 `task.status.changed`，Export Center 通过 `compose_task_id` 订阅任务事件；V1 不新增导出专用事件主题。
- **职责边界**：`compose_export` 任务只由 Export Center 触发创建；Production Hub 的 Create Task Modal 不手动创建 `compose_export`，仅只读展示该类任务。

### 5.2 回写清单

- `export-center-spec-v1.md`：§2 明确导出经 Job Orchestrator 编排；§7 创建导出流程补 `compose_task_id` 与状态映射；§17 导出进度来源复用 `task.status.changed`。
- `production-hub-spec-v1.md`：§7.1 / §12 明确 `compose_export` 由 Export Center 创建，Production Hub 只读。
- `job-orchestrator-contract-v1.md`：§12.1 成功回写补「`compose_export` 成功后同事务更新对应 `export_bundle`」。
- `data-and-api-v1.md`：`export_bundles` 表 + `ExportBundle` 类型补 `compose_task_id`；§7.11 `POST /api/exports` 说明创建任务；§8 新增 Export Contract。

## 6. 影响

- 三处口径钉死后，`data-and-api-v1.md` 为唯一契约地基，各 spec 只引用不另立。
- 相关模块 spec 的「作用域/门禁/编排」表述必须与本 ADR 一致，冲突以本 ADR 为准。
- 本 ADR 与 `feature-completeness-review-v1.md` §4 第 1 步对应，是启动实现前的前置条件。
