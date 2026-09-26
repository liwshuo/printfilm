# ADR-005 SQLite Migration 策略 v1.0

## 1. 状态

- `accepted`

## 2. 背景

文档已进入“可开发”阶段，且 schema 在持续收敛。若没有 migration 规范，后续会出现：

- 本地项目无法平滑升级
- 同步环境 schema 漂移
- 回滚不可控

## 3. 决策

V1 采用 `文件化 SQL migration + schema version 表`。

## 4. 规范

### 4.1 版本命名

- 采用递增版本号：
  - `0001_init.sql`
  - `0002_add_prompt_version.sql`
  - `0003_add_review_runs.sql`

### 4.2 元数据表

新增：

- `schema_migrations`
  - `version`
  - `applied_at`
  - `checksum`

### 4.3 执行规则

- 启动时自动检查并按顺序执行未应用 migration
- 每个 migration 必须在事务中执行
- migration 不允许修改历史文件，只能新增新版本

### 4.4 回滚策略

- 开发阶段：
  - 允许通过最新快照重建测试库
- 生产数据阶段（本地正式项目）：
  - 优先前向修复，不做自动回滚

## 5. 数据兼容策略

- 对新增非空字段：
  - 必须提供默认值
- 对语义变更字段：
  - 先新增新字段并做迁移，再删除旧字段（分两步）
- 对大 JSON 字段：
  - 增加 `schemaVersion` 子字段，便于应用层解析

## 6. 影响

- `packages/repositories`
  - 启动初始化时必须先跑 migration runner
- `docs/product/data-and-api-v1.md`
  - SQL 只作为“目标 schema 草案”
  - 实际落地以 migration 文件序列为准

## 7. 验收

- 新旧版本数据库都能启动成功
- 迁移后核心模块可读写
- 不丢失既有项目数据
