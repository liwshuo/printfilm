# Job Orchestrator Contract v1.0

## 1. 文档目标

本文档定义 `Job Orchestrator` 的职责、输入输出、状态机、worker 边界与回调机制。

该模块是平台执行层的唯一入口，用于确保：

- 所有模型调用统一走任务系统
- 所有重试和取消行为统一管理
- 所有产物统一回填
- 所有执行日志统一落点

## 2. 模块定位

`Job Orchestrator` 是执行层的中心调度器。

它负责：

- 创建任务
- 调度 worker
- 更新任务状态
- 管理重试
- 接受回调
- 回写产物

它不负责：

- 编译 prompt
- 修改故事、设定、分镜真相
- 决定业务规则
- 直接承担 provider 协议适配

## 3. 设计来源

- `huobao-drama`
  - 借用多模型执行、任务追踪、产物回填思路
- `trae_projects`
  - 借用 adapter + 执行链路的组织意识

本模块只借执行底座结构，不继承其历史状态模型。

## 4. 目标与非目标

### 4.1 目标

- 所有执行任务统一入队
- 统一支持图片、视频、TTS、合成任务
- 支持优先级、重试、取消、日志
- 将产物标准化回写到 `artifacts`

### 4.2 非目标

- 不做高复杂度分布式调度
- 不做多租户资源隔离
- 不让任务系统持有业务真相
- 不让 worker 各自维护独立状态机

## 5. 任务输入来源

所有任务必须源于标准化对象。

允许来源：

- `PromptSpec`
- `ModelProfile`
- `source entity reference`

不允许来源：

- 页面拼接的临时 prompt
- UI 直接传 provider-specific payload
- worker 自己拼的新任务

## 6. 任务类型

### 6.1 V1 支持的 taskType

- `story_generate`
- `storyboard_generate`
- `keyframe_generate`
- `prompt_compile`
- `image_generate`
- `video_generate`
- `tts_generate`
- `compose_export`

### 6.2 V1 推荐真正入队的执行任务

执行层建议重点支持：

- `image_generate`
- `video_generate`
- `tts_generate`
- `compose_export`

其中：

- `story_generate`
- `storyboard_generate`
- `keyframe_generate`
- `prompt_compile`

可以根据实现选择是否走统一队列，但 contract 允许纳入任务体系。

## 7. 任务对象

```ts
export interface GenerationTask {
  id: string;
  projectId: string;
  taskType: TaskType;
  sourceEntityType: string;
  sourceEntityId: string;
  promptSpecId?: string;
  modelProfileId?: string;
  status: TaskStatus;
  priority: number;
  retryCount: number;
  retryOfTaskId?: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  usage: Record<string, unknown>;
  costEstimate?: number;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}
```

## 8. 状态机

### 8.1 标准状态

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

### 8.2 状态流转

标准流转：

1. `queued`
2. `running`
3. `succeeded` 或 `failed`

额外流转：

- `queued -> cancelled`
- `running -> cancelled`
- `failed -> cancelled`（可选，取决于中断时机）

### 8.3 状态机约束

- `succeeded` 不能再进入 `running`
- `cancelled` 不能自动复活
- `retry` 必须创建新任务，原任务保持终态不复活
- 任一状态变化都必须写日志

## 9. Job 创建 Contract

### 9.1 创建任务的输入

```ts
export interface CreateJobInput {
  projectId: string;
  taskType: TaskType;
  sourceEntityType: string;
  sourceEntityId: string;
  promptSpecId?: string;
  modelProfileId?: string;
  priority?: number;
  inputPayload?: Record<string, unknown>;
}
```

### 9.2 创建前置校验

- project 是否存在
- source entity 是否存在
- promptSpec 是否存在且状态合法
- modelProfile 是否存在且启用
- taskType 与 targetType 是否匹配

### 9.3 创建后结果

- 写入 `generation_tasks`
- 进入 `queued`
- 返回 task id

## 10. Worker 边界

每个 worker 只负责一种执行能力。

### 10.1 LLM Worker

- 只负责文本生成类执行
- 不修改故事事实

### 10.2 Image Worker

- 只负责图像生成
- 输入为 PromptSpec + ModelProfile

### 10.3 Video Worker

- 只负责视频生成
- 输入为 PromptSpec + ModelProfile + 可选图片引用

### 10.4 TTS Worker

- 只负责语音合成

### 10.5 Compose Worker

- 只负责 FFmpeg 拼接、字幕烧录、打包导出

### 10.6 Worker 严禁行为

- 自行拼接业务 prompt
- 自行修改故事和分镜
- 自行生成第二套任务状态
- 自行定义 artifact 格式

## 11. Adapter 边界

worker 可以调用 adapter，但 adapter 只负责：

- provider 请求翻译
- provider 返回值标准化

adapter 不负责：

- 业务补丁
- prompt 修复
- 事实层变更

## 12. 回调与结果回写

### 12.1 成功回写

成功后需要：

- 更新任务状态为 `succeeded`
- 写入 `outputPayload`
- 创建 `Artifact`
- 记录 `finishedAt`
- 若为 `compose_export` 任务：在同一事务中更新其关联的 `export_bundle`（见 adr-006 §5）——`status=ready`，写入 `output_path` / `manifest_json` / `bundle_size_bytes`，并生成 bundle artifact

### 12.2 失败回写

失败后需要：

- 更新任务状态为 `failed`
- 写入 `errorMessage`
- 写入 `errorCode`（取值对齐 adr-004 §4 必备错误码）
- 记录失败日志
- 保留输入上下文以便 retry
- 若为 `compose_export` 任务：同步将关联 `export_bundle.status` 置为 `failed` 并写入 `error_message`

### 12.3 产物回写原则

所有执行结果都必须通过统一 Artifact Service 回写：

- 图片 -> image artifact
- 视频 -> video artifact
- 音频 -> audio artifact
- 字幕 -> subtitle artifact
- 导出包 -> bundle artifact

不允许：

- worker 直接写业务表
- 页面自己登记产物
- adapter 直接落本地数据库

## 13. Retry Contract

### 13.1 retry 原则

- retry 必须显式触发
- retry 不修改原始 PromptSpec
- retry 不修改事实层
- retry 可以沿用原 promptSpecId 和 modelProfileId

### 13.2 retry 行为

- 原任务保留
- 新建新任务
- 新任务 `retryCount = 原任务.retryCount + 1`
- 新任务写入 `retryOfTaskId = 原任务.id`
- 原任务状态保持 `failed`，不得回退到 `queued`

## 14. Cancel Contract

### 14.1 cancel 原则

- 只能取消 `queued` 或 `running` 的任务
- 已成功任务不能取消
- 已失败任务不能取消

### 14.2 cancel 结果

- 状态更新为 `cancelled`
- 写入日志
- 如 provider 支持则尝试中断远端任务

## 15. Logging Contract

任务日志必须是结构化的。

### 15.1 最低要求

- task id
- event type
- timestamp
- message
- optional payload

### 15.2 推荐事件

- `task_created`
- `task_started`
- `task_progress`
- `task_failed`
- `task_succeeded`
- `task_cancelled`
- `artifact_written`

## 16. 最小接口建议

### 16.1 Orchestrator 接口

```ts
export interface JobOrchestrator {
  createJob(input: CreateJobInput): Promise<GenerationTask>;
  startJob(taskId: string): Promise<void>;
  retryJob(taskId: string): Promise<GenerationTask>;
  cancelJob(taskId: string): Promise<void>;
  handleSuccess(taskId: string, payload: Record<string, unknown>): Promise<void>;
  handleFailure(taskId: string, error: string, payload?: Record<string, unknown>): Promise<void>;
}
```

### 16.2 API 接口

- `POST /api/tasks`
- `GET /api/tasks`
- `GET /api/tasks/:taskId`
- `POST /api/tasks/:taskId/retry`
- `POST /api/tasks/:taskId/cancel`

## 17. Artifact 回写 Contract

```ts
export interface ArtifactWriteInput {
  projectId: string;
  artifactType: "image" | "video" | "audio" | "subtitle" | "bundle";
  sourceTaskId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  filePath: string;
  previewPath?: string;
  metadata?: Record<string, unknown>;
}
```

## 18. V1 实现建议

### 18.1 调度方式

- V1 可以先使用单进程本地队列
- 不必一开始引入复杂分布式消息系统

### 18.2 执行顺序

- 先支持 image / video / tts
- 再支持 compose_export

### 18.3 持久化要求

- task 必须落数据库
- artifact 必须落数据库
- 文件必须落本地文件系统

## 19. 测试重点

- task 状态机是否正确
- retry 是否不污染原始任务
- cancel 是否只对合法状态生效
- worker 是否无法绕过 orchestrator
- artifact 是否统一回写

## 20. 一句话结论

- `Job Orchestrator` 是执行层唯一入口，它必须统一承接任务、统一调度 worker、统一回写产物，并且绝不持有业务真相。 
