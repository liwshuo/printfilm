# DramaFlow Studio Architecture v1.0

## 1. 架构目标

- 让平台具备清晰的阶段边界。
- 让故事、设定、分镜成为唯一真相源。
- 让 prompt 只从一个出口产生。
- 让模型调用、任务调度、产物回填、审查导出彼此解耦。
- 让本地运行成为默认形态，同时为未来远程协作预留空间。

## 2. 总体架构

平台采用 `local-first` 的四层结构：

1. 前端工作台层
2. 本地应用服务层
3. 任务执行与模型适配层
4. 本地存储与文件层

同时与外部云端模型 API 通信。

## 3. 分层设计

### 3.1 前端工作台层

职责：

- 渲染项目工作台
- 承载故事、设定、分镜编辑交互
- 展示 prompt、任务、产物、审查结果
- 发起业务请求

不负责：

- 不直接访问数据库
- 不直接调用模型 API
- 不拼接最终 prompt
- 不直接管理任务状态机

主要页面：

- Project Dashboard
- Story Workspace
- Asset Ledger
- Storyboard Studio
- Prompt Center
- Production Hub
- Review Center
- Export Center

### 3.2 本地应用服务层

职责：

- 封装领域模型
- 暴露统一 HTTP API
- 维护业务状态机
- 协调事实层与执行层

核心服务：

- `Story Service`
- `Asset Service`
- `Storyboard Service`
- `Prompt Compiler Service`
- `Review Service`
- `Export Service`
- `Model Profile Service`
- `Artifact Service`

### 3.3 任务执行与模型适配层

职责：

- 接收标准化任务
- 统一调度模型调用
- 管理队列、重试、取消、回调
- 统一回写产物和日志

核心模块：

- `Job Orchestrator`
- `LLM Worker`
- `Image Worker`
- `Video Worker`
- `TTS Worker`
- `Compose Worker`
- `Model Adapters`

### 3.4 本地存储与文件层

职责：

- 存储结构化业务数据
- 管理本地产物和缓存
- 管理临时文件、导出包、日志

组成：

- `SQLite`
- 本地文件系统
- 本地缓存目录

## 4. 事实层与执行层

这是平台最重要的边界。

### 4.1 事实层

事实层负责记录：

- 故事
- 角色
- 场景
- 道具
- 分镜
- 关键帧规格

事实层的特点：

- 可编辑
- 可确认
- 可版本化
- 不被执行失败污染

### 4.2 执行层

执行层负责记录：

- prompt 规格
- 任务
- 模型调用结果
- 产物
- 执行日志

执行层的特点：

- 可重跑
- 可重试
- 可取消
- 不修改事实层

### 4.3 硬边界规则

- 事实层只被编辑器和事实服务修改。
- 执行层只由 Prompt Compiler 和 Job Orchestrator 生成。
- 任一 worker 都不能直接回写故事、设定、分镜。
- 任一页面组件都不能临时补写模型调用参数污染真相源。

## 5. Prompt Compiler

Prompt Compiler 是架构核心。

### 5.1 定位

- 它是最终执行 prompt 的唯一出口。
- 它接收事实层数据，输出标准化 prompt spec。
- 它统一承接图片、视频、TTS 三种目标。

### 5.2 输入

- 项目故事规则
- 角色与外观台账
- 场景与道具台账
- 分镜与关键帧规格
- continuity anchor
- model profile

### 5.3 输出

- `PromptSpec`
  - target type
  - source entity
  - compiled prompt
  - negative prompt
  - compiler version
  - model profile reference

### 5.4 禁止项

- UI 拼接最终 prompt
- Adapter 拼接业务约束
- Worker 根据错误自动补业务文案
- 同一镜头在多个地方各自生成不同版本 prompt

## 6. Job Orchestrator

### 6.1 定位

- 平台的唯一任务入口。
- 负责将 prompt spec 转成执行任务。
- 负责队列、优先级、重试和回调。

### 6.2 职责

- 创建任务
- 调度 worker
- 更新任务状态
- 记录失败原因
- 写回 artifacts

### 6.3 任务状态

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

### 6.4 关键规则

- 所有模型调用必须通过任务系统。
- worker 不允许绕过 orchestrator 独立执行。
- 回调必须回到统一任务接口。

## 7. Model Adapters

### 7.1 设计来源

- 参考 `huobao-drama` 的多模型接入思路
- 参考 `trae_projects` 的 adapter 层做法

### 7.2 Adapter 类型

- `LLM Adapter`
- `Image Adapter`
- `Video Adapter`
- `TTS Adapter`

### 7.3 Adapter 责任

- 将平台统一任务格式翻译成 provider 请求格式
- 屏蔽 provider 差异
- 返回标准化结果

### 7.4 Adapter 不负责

- 不修改业务事实
- 不决定业务流程
- 不拼故事约束
- 不覆盖 Prompt Compiler 的输出

## 8. Storyboard Studio

### 8.1 设计来源

- 重点参考 `CineGen-ShortDrama`

### 8.2 核心职责

- 将 scene 拆成 shot
- 为 shot 定义镜头意图
- 规划关键帧
- 管理 continuity
- 为 prompt 编译提供结构化输入

### 8.3 为什么重要

- 关键帧是图像生成和视频生成之间的桥梁
- continuity 需要结构化显式表达，而不是留给 prompt 猜
- 导演工作台比“直接出视频”更符合短剧工业化要求

## 9. Review Center

### 9.1 设计来源

- 参考 `short-drama` 的审查与规则体系
- 参考 `drama-skills` 的 creator-first 审查逻辑

### 9.2 审查类型

- `story`
- `asset`
- `continuity`
- `prompt`
- `compliance`

### 9.3 审查结果

- 必须结构化入库
- 必须能定位到 episode / scene / shot
- 必须能回跳到编辑页面

## 10. Export Center

### 10.1 设计来源

- 参考 `huobao-drama` 的导出思路

### 10.2 导出类型

- 文本交付包
- 素材交付包
- 成片导出
- 项目归档包

### 10.3 责任边界

- 导出是读取层，不是修改层
- 不允许导出逻辑顺手修正故事或资产数据

## 11. 本地目录建议

```text
apps/
  web/
  desktop-server/
packages/
  domain/
  story-engine/
  storyboard-engine/
  prompt-compiler/
  repositories/
  review-rules/
  model-adapters/
  job-runner/
  media-pipeline/
data/
  sqlite/
  projects/
  artifacts/
  cache/
  exports/
  logs/
```

## 12. 技术选型建议

### 12.1 前端

- `Next.js`
- React
- TypeScript

### 12.2 本地服务

- Node.js
- Hono 或 Next.js Route Handlers

### 12.3 数据存储

- V1：SQLite
- 后续多人版：Postgres

### 12.4 媒体处理

- FFmpeg

### 12.5 队列

- V1 可以先从本地队列实现
- 后续再切 Redis/BullMQ

## 13. 参考项目采用边界

### 13.1 采用来源

- `drama-skills`
  - 主要提供工作流骨架与 SSOT 思路
- `short-drama`
  - 主要提供故事规则与审查逻辑
- `CineGen-ShortDrama`
  - 主要提供 keyframe-driven 与导演工作台思路
- `huobao-drama`
  - 主要提供 adapter、任务编排、产物回填思路
- `trae_projects`
  - 仅参考模型调用组织方式，不复用其状态结构

### 13.2 禁止复制的实现模式

- 禁止复制外部项目的页面级业务状态机。
- 禁止复制外部项目的 prompt 拼接链路。
- 禁止复制外部项目的历史兼容补丁和迁移分支。
- 禁止复制外部项目的“运行状态与业务真相混存”模型。
- 禁止复制外部项目的“大而全单体 service” 结构。

### 13.3 强制保留的架构原则

- 事实层只借鉴结构，不继承任何外部仓库的历史耦合。
- Prompt Compiler 只借鉴方法，不复制 prompt 文本。
- Adapter 只借鉴分层方式，不继承原仓库的业务判断。
- Job Orchestrator 只借鉴状态机思路，不继承原仓库的任务模型细节。

### 13.4 实现策略

- 默认重写实现。
- 默认不直接复用外部业务代码。
- 如需复用小型工具函数，必须满足：
  - License 明确允许
  - 可单独抽离
  - 不引入上游状态结构
  - 不带入内容资产风险

## 14. 最关键的三份 contract

### 14.1 Story Contract

- 输出统一故事结构
- 不直接生成媒体任务

### 14.2 Prompt Contract

- 只接受事实层输入
- 输出标准化 prompt spec

### 14.3 Job Contract

- 只接受 prompt spec + model profile
- 输出 task state + artifacts

## 15. 一句话总结

- 这套架构的核心不是多复杂，而是边界足够硬：`事实层负责真相，执行层负责生成，Prompt Compiler 负责唯一出口，Job Orchestrator 负责唯一入口。`
