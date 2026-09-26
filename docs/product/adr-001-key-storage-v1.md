# ADR-001 模型密钥存储策略 v1.0

## 1. 状态

- `accepted`

## 2. 背景

平台为本机运行的 `local-first` 工作台，但需要调用云端：

- LLM
- image
- video
- TTS

因此必须明确 API Key 的存储方式。若不定义，默认实现很容易退化成：

- SQLite 明文存储
- 导出归档时误带密钥
- 日志中泄漏密钥引用和值

## 3. 可选方案

### A. 明文存 SQLite

- 优点
  - 实现最简单
- 缺点
  - 安全性不可接受
  - 不符合本平台长期形态

### B. 全部走环境变量

- 优点
  - 简单
  - 对开发环境友好
- 缺点
  - 不适合多 provider / 多 profile 的本地工作台
  - 用户切换模型配置体验差

### C. SQLite 存引用，原始密钥进 OS Keychain

- 优点
  - 安全性与可用性平衡最好
  - 适合单机版产品
  - 便于多 provider / 多 profile 管理
- 缺点
  - 需要一层 keychain adapter

## 4. 决策

V1 采用 `方案 C`：

- `model_profiles.endpoint_key`
  - 只存 `credential reference key`
  - 不存原始密钥
- 原始密钥
  - 存入 OS keychain
  - macOS 下优先接系统 Keychain
- 环境变量
  - 仅用于开发模式或显式覆盖
  - 不作为默认主路径

## 5. 规则

### 5.1 数据层

- `model_profiles.endpoint_key`
  - 语义是引用键，不是 secret
- SQLite、导出包、日志、activity、review evidence 中禁止出现原始密钥

### 5.2 导出层

- `project archive bundle`
  - 一律不导出任何密钥值
  - 只允许导出模型 profile 的公开元数据

### 5.3 UI 层

- 模型配置页只显示：
  - provider
  - model name
  - 是否已绑定密钥
  - 最后验证时间
- 不回显完整 key
- 最多只显示尾号或摘要

### 5.4 日志层

- task logs
- activity events
- error envelope

都只能记录：

- credential ref
- provider
- profile id

不能记录原始 secret

## 6. 落地影响

- `packages/model-adapters`
  - 需要 `credential provider`
- `apps/desktop-server`
  - 需要 keychain bridge
- `data-and-api-v1.md`
  - `endpoint_key` 已按“引用键”解释

## 7. 后续动作

- 补一层 `CredentialService`
- 在模型设置页增加：
  - 绑定密钥
  - 测试连通性
  - 解绑密钥
- 在导出链路加入密钥剔除校验
