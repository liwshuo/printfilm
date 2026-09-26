# Repo Structure v1.0

## 1. 文档目标

本文档用于定义：

- V1 推荐的仓库目录结构
- 各目录的职责边界
- 哪些代码应该放在哪一层
- 哪些代码不应该出现在某一层

目标是避免后续开发重新回到：

- 大量业务逻辑堆进单个前端页面
- prompt、任务、适配器、事实模型混在一起
- 工具脚本、临时代码和正式模块边界不清

## 2. 仓库形态

V1 推荐使用单仓库多包结构，但仍然保持轻量。

补充说明：

- 产品名统一使用 `DramaFlow Studio`
- 仓库名 `printfilm-next` 仅作为实现仓名保留

推荐形态：

```text
printfilm-next/  # repository name
  apps/
  packages/
  docs/
  data/
  scripts/
```

## 3. 顶层目录

### 3.1 apps

用途：

- 放运行时应用

包括：

- `apps/web`
- `apps/desktop-server`

### 3.2 packages

用途：

- 放可复用业务模块
- 放领域模型、contract、service、adapter、pipeline

### 3.3 docs

用途：

- 放产品、架构、接口、决策文档

### 3.4 data

用途：

- 放本地运行时数据

### 3.5 scripts

用途：

- 放独立工具脚本
- 只允许放构建、迁移、诊断类脚本

不允许：

- 长期业务逻辑依赖 scripts 目录

## 4. apps/web

### 职责

- 渲染工作台 UI
- 发起业务请求
- 展示项目、分镜、任务、产物、审查

### 推荐结构

```text
apps/web/
  app/
  components/
  features/
  lib/
  styles/
```

### 说明

- `app/`
  - 页面和路由
- `components/`
  - 通用组件
- `features/`
  - 按业务域拆分页面逻辑
- `lib/`
  - 仅放前端辅助工具，不放核心业务逻辑

### 禁止项

- 页面组件直接拼最终 prompt
- 页面组件直接调用模型 API
- 页面组件直接修改数据库
- 页面组件实现任务状态机

## 5. apps/desktop-server

### 职责

- 提供本地 HTTP API
- 管理 SQLite 连接
- 运行本地任务队列
- 调用 worker 与 adapter
- 管理本地文件写入和导出

### 推荐结构

```text
apps/desktop-server/
  src/
    api/
    server/
    jobs/
    storage/
    bootstrap/
```

### 说明

- `api/`
  - 路由和 handler
- `server/`
  - 服务启动与容器初始化
- `jobs/`
  - 本地任务 runner
- `storage/`
  - SQLite / 文件系统访问
- `bootstrap/`
  - 启动配置

## 6. packages/domain

### 职责

- 放领域类型
- 放 schema
- 放枚举
- 放 contract 基础定义

### 内容

- entity types
- zod schema
- repository interface
- shared enums

### 原则

- 不依赖 UI
- 不依赖 provider
- 不依赖具体数据库实现

## 7. packages/story-engine

### 职责

- 故事开发规则
- 题材模板抽象
- 节奏与钩子规则
- 剧情审查规则

### 来源

- 重点参考 `short-drama`
- 方法上参考 `drama-skills`

### 禁止项

- 不放模型调用
- 不放数据库连接
- 不放页面逻辑

## 8. packages/storyboard-engine

### 职责

- scene -> shot 拆分辅助
- keyframe 结构辅助
- continuity anchor 计算辅助

### 来源

- 重点参考 `CineGen-ShortDrama`

### 禁止项

- 不直接执行视频任务
- 不直接调用 provider

## 9. packages/prompt-compiler

### 职责

- 统一编译 image / video / tts prompt
- 输出 `PromptSpec`

### 必须包含

- compiler input builder
- image compiler
- video compiler
- tts compiler
- compiler versioning

### 禁止项

- 不直接调用模型
- 不直接建任务
- 不直接写 artifact

## 10. packages/model-adapters

### 职责

- 屏蔽 provider 差异
- 统一 LLM / Image / Video / TTS 调用接口

### 推荐结构

```text
packages/model-adapters/
  src/
    base/
    llm/
    image/
    video/
    tts/
```

### 原则

- adapter 不感知业务真相
- adapter 不注入业务 prompt
- adapter 只做请求翻译和结果标准化

## 11. packages/job-runner

### 职责

- 实现 Job Orchestrator
- 调度 worker
- 更新任务状态
- 统一回写 artifact

### 内容

- task state machine
- retry policy
- cancel policy
- callback handlers

### 禁止项

- 不拼 prompt
- 不修改故事、设定、分镜

## 12. packages/media-pipeline

### 职责

- FFmpeg 合成
- 字幕烧录
- 成片导出

### 内容

- compose worker
- subtitle pipeline
- export bundle helpers

## 13. packages/repositories

### 职责

- 实现 domain repository
- 对 SQLite 提供统一读写接口

### 推荐结构

```text
packages/repositories/
  src/
    sqlite/
    mappers/
    repositories/
```

### 原则

- repository 层只负责数据持久化
- 不负责业务判断

## 14. packages/review-rules

### 职责

- 审查规则
- 问题生成
- issue 分类与 severity 规则

### 来源

- 重点参考 `short-drama`
- 方法上参考 `drama-skills`

## 15. data 目录

### 推荐结构

```text
data/
  sqlite/
  projects/
  artifacts/
  cache/
  exports/
  logs/
```

### 说明

- `sqlite/`
  - 本地数据库文件
- `projects/`
  - 项目级附属文件
- `artifacts/`
  - 图片 / 视频 / 音频产物
- `cache/`
  - 中间缓存
- `exports/`
  - 导出包
- `logs/`
  - 结构化日志

## 16. docs 目录

### 推荐结构

```text
docs/
  product/
  engineering/
  decisions/
```

### 说明

- `product/`
  - 当前 PRD、架构、数据、contract 文档
- `engineering/`
  - 后续实现细节
- `decisions/`
  - ADR 风格决策记录
- V1 设计冻结阶段的 ADR 先放在 `docs/product/`，进入实现阶段后可整体迁移到 `docs/decisions/`

## 17. 推荐依赖方向

依赖关系建议如下：

```text
apps/web -> packages/domain
apps/web -> packages/prompt-compiler (type only or API contract only)

apps/desktop-server -> packages/domain
apps/desktop-server -> packages/repositories
apps/desktop-server -> packages/story-engine
apps/desktop-server -> packages/storyboard-engine
apps/desktop-server -> packages/prompt-compiler
apps/desktop-server -> packages/model-adapters
apps/desktop-server -> packages/job-runner
apps/desktop-server -> packages/media-pipeline
apps/desktop-server -> packages/review-rules
```

### 原则

- UI 依赖 domain 和 API contract
- 后端依赖 service、repository、adapter、job modules
- adapter 不反向依赖 story / storyboard

## 18. 最先应该创建的目录

> 权威实现顺序以 `data-and-api-v1.md` §10「实现顺序建议」为准；本节仅给出与之一致的**目录骨架**落地顺序，不再单独定义一套实现顺序。

建议按下面顺序落骨架（对应 `data-and-api-v1.md` §10 的 domain types -> repository -> 编译/执行层 -> 应用层）：

1. `packages/domain`
2. `packages/repositories`
3. `packages/prompt-compiler`
4. `packages/job-runner`
5. `apps/desktop-server`
6. `apps/web`

## 19. 一句话结论

- 仓库结构的目标不是好看，而是让 `事实层、编译层、执行层、适配层` 从目录上就彼此隔离，避免重新长出旧项目那种“大一统补丁式结构”。
