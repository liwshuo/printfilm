# Page State Machine v1.0

## 1. 文档目标

- 将所有核心页面的状态机统一收敛成一份总表。
- 明确每个页面的：
  - 持久状态
  - UI 派生态
  - 进入条件
  - 离开条件
  - 阻塞条件
  - 上下游联动
- 用于冻结前端状态设计，避免实现阶段出现页面各自定义状态的问题。

## 2. 全局规则

### 2.1 状态分类

- `持久状态`
  - 来源于数据库字段
  - 必须可回放、可同步、可审计
- `UI 派生态`
  - 来源于持久状态 + 校验结果 + issue 结果
  - 仅用于页面显示和按钮启停

### 2.2 全局阻塞规则

- 任一页面只要出现 `blocking issue`，则：
  - 不阻止查看
  - 但阻止继续推进到下游生产动作
- `blocking issue` 的来源：
  - 高优先级 continuity error
  - 高优先级 review issue
  - 缺少必填结构化字段
  - 引用对象失效

### 2.3 全局回退规则

- 任何已确认页面，如果上游真相源发生关键变化，则：
  - 保留历史记录
  - 当前页面进入 `needs_refresh` 或 `unsynced` UI 派生态
  - 由用户决定是否重编译 / 重确认 / 重生产

## 3. 项目初始化页（Project Setup）

### 3.1 持久状态

- `Project.status`
  - `draft`
  - `active`
  - `archived`

### 3.2 UI 派生态

- `editing`
- `valid`
- `invalid`
- `saving`
- `save_error`

### 3.3 进入条件

- 新建项目
- 从总览进入“编辑项目设置”

### 3.4 离开条件

- 创建成功并进入故事开发
- 保存成功后返回项目总览

### 3.5 阻塞条件

- 必填字段不完整
- slug 冲突
- 关键规格校验失败

### 3.6 关键联动

- 修改项目级规格后：
  - Story Workspace 需回显新规格
  - Dashboard 指标更新
  - 下游模块可能进入 `unsynced` 提示

## 4. 项目总览页（Project Dashboard）

### 4.1 持久状态

- 读取各模块聚合结果，不自持业务持久状态

### 4.2 UI 派生态

- `healthy`
- `attention_needed`
- `blocked`
- `loading`
- `load_error`

### 4.3 进入条件

- 打开任一项目默认首页

### 4.4 离开条件

- 跳往任一模块详情页

### 4.5 阻塞条件

- 无阻塞浏览，但存在 blocking issue 时必须高亮显示

### 4.6 关键联动

- 各模块确认 / 失败 / 重跑结果都需回写到总览指标

## 5. 故事开发页（Story Workspace）

### 5.1 持久状态

- `Episode.storyStatus`
  - `draft`
  - `confirmed`
  - 故事确认的唯一权威持久态在集级（见 adr-006 §3）；项目级「故事是否已确认」是派生 rollup `projectStoryStatus`（confirmed/partial/draft），不落库

### 5.2 UI 派生态

- `incomplete`
- `ready_for_script`
- `dirty`
- `saving`
- `save_error`
- `ai_suggestion_available`

### 5.3 进入条件

- 项目已创建

### 5.4 离开条件

- 故事确认后进入剧本编辑

### 5.5 阻塞条件

- 缺少 logline / main conflict / episode hook 等关键字段

### 5.6 关键联动

- 故事发生重大变更时：
  - 剧本页进入 `unsynced`
  - 已确认的剧本不能静默继续下游推进

## 6. 剧本编辑页（Script Editor）

### 6.1 持久状态

- `Episode.scriptStatus`
  - `draft`
  - `confirmed`

### 6.2 UI 派生态

- `incomplete`
- `ready_for_storyboard`
- `dirty`
- `saving`
- `save_error`
- `story_unsynced`
- `storyboard_unsynced`

### 6.3 进入条件

- 项目与故事层已存在

### 6.4 离开条件

- 剧本确认后进入分镜导演台

### 6.5 阻塞条件

- scene 缺目标
- 对白/动作块为空
- entry/exit state 缺失

### 6.6 关键联动

- 剧本快照恢复后：
  - 分镜导演台进入 `unsynced`

## 7. 设定台账页（Asset Ledger）

### 7.1 持久状态

- `Character.status`
  - `active | disabled`
- `Location.status`
  - `active | disabled`
- `Prop.status`
  - `active | disabled`
- `CharacterLook.version`
  - 版本递增

### 7.2 UI 派生态

- `editing`
- `dirty`
- `saving`
- `save_error`
- `unsynced_downstream`
- `has_reference_conflict`

### 7.3 进入条件

- 项目创建后任何阶段均可进入

### 7.4 离开条件

- 返回引用页或总览

### 7.5 阻塞条件

- look 默认值冲突
- 被引用对象非法停用

### 7.6 关键联动

- 资产变更后：
  - Storyboard / Prompt 页面显示 `unsynced`
  - 不自动覆盖已确认内容

## 8. 分镜导演台（Storyboard Studio）

### 8.1 持久状态

- `Scene.storyboardStatus`
  - `draft`
  - `confirmed`
- `KeyframeSpec.status`
  - `draft`
  - `confirmed`

### 8.2 UI 派生态

- `incomplete`
- `ready_for_review`
- `dirty`
- `saving`
- `save_error`
- `blocked`
- `asset_unsynced`
- `script_unsynced`

### 8.3 进入条件

- 存在 scene / shot 结构

### 8.4 离开条件

- 当前场分镜确认后进入 Prompt Center

### 8.5 阻塞条件

- continuity error
- keyframe 不完整（存在可生产 shot 缺 start/end 关键帧或未 confirmed，见 adr-006 §4）
- look / prop / state 缺失

### 8.6 关键联动

- 修改已 confirmed 分镜后：
  - 当前 `Scene.storyboardStatus` 回退为 `draft`
  - Prompt Center 对应 source 进入 `source_outdated`

## 9. Prompt 中心（Prompt Center）

### 9.1 持久状态

- `PromptSpec.status`
  - `draft`
  - `confirmed`
  - `superseded`

### 9.2 UI 派生态

- `not_compiled`
- `source_outdated`
- `model_unbound`
- `ready_to_confirm`
- `ready_to_produce`
- `blocked`

### 9.3 进入条件

- 来自 Storyboard Studio
- 来自 Production Hub 反查

### 9.4 离开条件

- 确认后进入 Production Hub
- 返回 source entity

### 9.5 阻塞条件

- 上游 source 不完整
- model profile 缺失
- review 阻塞

### 9.6 关键联动

- 上游变更后：
  - 当前 confirmed 保留历史
  - UI 显示 `source_outdated`
  - 新编译版本变为 draft

## 10. 生产中心（Production Hub）

### 10.1 持久状态

- `GenerationTask.status`
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
  - `cancelled`

### 10.2 UI 派生态

- `retryable`
- `cancellable`
- `artifact_ready`
- `artifact_preview_broken`

### 10.3 进入条件

- 来自 Prompt Center
- 直接查看历史任务

### 10.4 离开条件

- 进入 Artifact 预览
- 返回 Prompt / Storyboard / Dashboard

### 10.5 阻塞条件

- 不阻止查看，但无 confirmed prompt 时不能创建任务

### 10.6 关键联动

- 成功生成后：
  - artifact 入库
  - Dashboard 指标更新
  - 导出中心可消费

## 11. 审查中心（Review Center）

### 11.1 持久状态

- `ReviewRun.status`（执行生命周期，`ReviewRunStatus`）
  - `queued`
  - `running`
  - `succeeded`
  - `failed`（运行自身异常终止，非"有阻塞项"）
- `ReviewRun.verdict`（审查结论，`ReviewRunVerdict`，仅 `status=succeeded` 时有值）
  - `passed`（无 `high`/`critical` open issue）
  - `blocked`（存在阻塞项）
- `ReviewIssue.status`
  - `open`
  - `resolved`
  - `ignored`
  - `reopened`

### 11.2 UI 派生态

- `has_blocking_issues`（= 最近 run `status=succeeded` 且 `verdict=blocked`）
- `empty_clean`（= 最近 run `status=succeeded` 且 `verdict=passed`）
- `needs_rerun`（= 被审查对象在最近一次 run 之后发生变更，结论过期）
- `run_failed`（= 最近 run `status=failed`，运行本身失败）

### 11.3 进入条件

- 可从任意模块进入

### 11.4 离开条件

- 跳转到 source 页面修复

### 11.5 阻塞条件

- 高优先级 issue 会阻塞 Prompt 确认或生产推进

### 11.6 关键联动

- issue reopen 后：
  - Dashboard 重新高亮
  - 相关模块重新显示阻塞标识

## 12. 导出中心（Export Center）

### 12.1 持久状态

- `ExportBundle.status`
  - `queued`
  - `running`
  - `ready`
  - `failed`
  - 由关联 `compose_export` 任务状态驱动（见 adr-006 §5）：task queued/running→queued/running；succeeded→ready；failed/cancelled→failed

### 12.2 UI 派生态

- `downloadable`
- `path_missing`
- `retryable`

### 12.3 进入条件

- 项目存在可交付资源

### 12.4 离开条件

- 下载完成
- 返回总览或生产中心

### 12.5 阻塞条件

- 缺少 bundle 所需 artifact

### 12.6 关键联动

- 生产中心产物补齐后，导出中心重新可用

## 13. 跨页面统一状态映射表

| 页面 | 持久状态 | UI 派生态 | 阻塞来源 |
| --- | --- | --- | --- |
| Project Setup | `Project.status` | `valid/invalid/saving` | 必填字段、slug、规格冲突 |
| Dashboard | 聚合只读 | `healthy/blocked` | 高优 issue、失败任务 |
| Story Workspace | `storyStatus` | `ready_for_script` | 缺故事关键字段 |
| Script Editor | `scriptStatus` | `ready_for_storyboard` | 缺 scene 结构字段 |
| Asset Ledger | 资产 status/version | `unsynced_downstream` | 引用冲突 |
| Storyboard Studio | `storyboardStatus` | `ready_for_review/blocked` | continuity、keyframe 缺失 |
| Prompt Center | `PromptSpec.status` | `not_compiled/source_outdated` | source 缺失、model 未绑、review 阻塞 |
| Production Hub | `Task.status` | `retryable/cancellable` | 无 confirmed prompt |
| Review Center | `ReviewIssue.status` | `has_blocking_issues` | 高优问题 |
| Export Center | `ExportBundle.status` | `downloadable/retryable` | 缺 artifact |

## 14. UI 派生态字典（统一）

为避免各页面各自命名，V1 统一派生态字典如下：

| 派生态 | 含义 | 触发条件 | 允许动作 |
| --- | --- | --- | --- |
| `incomplete` | 数据不完整 | 必填结构化字段缺失 | 编辑、保存 |
| `ready_for_script` | 可推进到剧本阶段 | 故事完整性检查通过 | 确认故事、进入剧本 |
| `ready_for_storyboard` | 可推进到分镜阶段 | 剧本结构检查通过 | 确认剧本、进入分镜 |
| `ready_for_review` | 分镜可确认 | 分镜校验通过且无 continuity 阻塞 | 确认分镜、进入 Prompt |
| `dirty` | 页面有未保存改动 | 本地编辑未持久化 | 保存、重置 |
| `saving` | 保存进行中 | 提交保存请求后 | 等待、取消编辑 |
| `save_error` | 保存失败 | 保存请求失败 | 重试、查看错误 |
| `unsynced` | 上游变更未同步 | 上游真相源发生关键变化 | 同步、重编译、回跳修复 |
| `source_outdated` | prompt 对应 source 过期 | source 版本高于 prompt 版本 | 重编译、比较差异 |
| `not_compiled` | 尚无 prompt 版本 | source + target 不存在 PromptSpec | 编译 |
| `model_unbound` | 未绑定模型配置 | PromptSpec 无可用 modelProfile | 绑定模型 |
| `blocked` | 推进动作受阻 | 高优 issue 或阻塞校验存在 | 跳转修复 |
| `retryable` | 允许重试 | 任务/导出状态为 failed | 重试 |
| `cancellable` | 允许取消 | 任务状态为 queued/running | 取消 |
| `downloadable` | 可下载 | 导出状态为 ready 且路径可用 | 下载、打开路径 |
| `path_missing` | 文件路径不可用 | 记录存在但路径失效 | 重试导出、修复路径 |

命名规范：

- 页面必须复用以上枚举名，不得自造近义词。
- 若需新增派生态，先在本字典补定义，再落到页面文档。

## 15. 一句话结论

- 这份状态机总表的目的，是把“页面感知到的状态”和“数据库真实存在的状态”彻底分开；前者服务交互，后者服务系统一致性。
