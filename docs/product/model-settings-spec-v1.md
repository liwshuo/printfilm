# 模型设置页 model-settings-spec v1.0

## 1. 模块定位

- 本页是 `model_profiles` 与模型密钥的**唯一管理入口**，收口此前无模块归属的两块能力：
  1. 模型 Profile 的增删改查（provider / modelType / modelName / defaultParams / isActive）
  2. 模型密钥（API Key）的绑定 / 测试连通性 / 解绑
- 数据结构见 `data-and-api-v1.md` §5 `model_profiles` 表、§6 `ModelProfile` 与 §6.3 `ModelProfileView` / `ModelCredentialTestResult`。
- 密钥存储策略遵循 `adr-001-key-storage-v1.md`：SQLite 只存 `endpoint_key` 引用键，原始密钥进 OS Keychain。
- 本页是**项目无关的全局设置页**（非某个 project 下的子页），从全局导航进入。

## 2. 页面结构

- 顶部：`新增模型 Profile` 主按钮 + 按 `modelType`（llm / image / video / tts）过滤的分组 Tab
- 主区：模型 Profile 列表（表格）
- 右侧 / 抽屉：选中 Profile 的详情与密钥管理

## 3. 列表规格

### 3.1 列定义（数据来自 `GET /api/model-profiles` → `ModelProfileView[]`）

- `provider`
- `modelType`
- `modelName`
- `credentialBound`（是否已绑定密钥，徽标）
- `credentialHint`（尾号 / 摘要，如 `sk-***a1b2`；**绝不回显完整 key**，adr-001 §5.3）
- `lastVerifiedAt`（最后验证时间）
- `isActive`（启用 / 停用开关）

### 3.2 行级动作

- `编辑`（provider / modelName / defaultParams）
- `启用 / 停用`（`POST /api/model-profiles/:id/is-active`）
- `绑定密钥` / `更换密钥`（§4）
- `测试连通性`（§4）
- `解绑密钥`（§4）
- `删除 Profile`（§5.3）

## 4. 密钥管理（adr-001）

- `绑定 / 更换密钥`：
  - 端点：`POST /api/model-profiles/:id/credential`，请求体携带原始 key
  - 原始 key 写入 OS Keychain，SQLite 仅写 `endpoint_key` 引用键
  - 响应只回 `credentialHint`，输入框提交后立即清空，前端不缓存明文
- `测试连通性`：
  - 端点：`POST /api/model-profiles/:id/credential/test`，响应 `ModelCredentialTestResult`
  - `ok=true` 刷新 `lastVerifiedAt` 并展示延迟；`ok=false` 展示 `errorCode` / `errorMessage`（adr-004 信封）
- `解绑密钥`：
  - 端点：`DELETE /api/model-profiles/:id/credential`，清除 Keychain 条目与 `endpoint_key`
  - 解绑后 `credentialBound=false`，该 Profile 在 Prompt Center 绑定时视为「密钥缺失」不可用

## 5. 增删改规则

### 5.1 新增 / 编辑

- 新增：`POST /api/model-profiles`；编辑：`PATCH /api/model-profiles/:id`
- 校验：`provider` / `modelType` / `modelName` 必填；`modelType` 取值对齐 `ModelType`
- `defaultParams` 为 provider 私有默认参数（JSON），本页只做透明存取，不解释语义

### 5.2 并发策略

- `model_profiles` 为**单机全局配置**、写入并发极低，V1 采用 last-write-wins，不接 adr-003 乐观锁（无 `version` 列）。
- 该决策显式区别于「核心可编辑内容对象」（Story / Script / Storyboard / Prompt 等仍走 adr-003 乐观锁）。

### 5.3 删除与引用保护

- 端点：`DELETE /api/model-profiles/:id`
- 软校验：若被 `PromptSpec.modelProfileId` 或 `GenerationTask.modelProfileId` 引用，返回 `blocked_by_reference`（adr-004），`details` 列出引用来源，提示先替换绑定
- 数据层 FK 为 `ON DELETE SET NULL`（见 data-api §5），软校验是 UI 前置拦截，避免静默断链

## 6. 错误与错态

- 所有端点业务错误按 `adr-004` `ApiErrorEnvelope` 返回
- 连通性测试失败：行内展示错误摘要 + `重试`
- Keychain 不可用（如系统拒绝访问）：返回 `internal_error`，提示检查系统钥匙串权限
- 空状态：无任何 Profile 时展示引导「新增第一个模型 Profile」

## 7. 与其他模块的关系

- **Prompt Center**：`绑定 model profile`（`POST /api/prompts/:promptId/bind-model-profile`）的候选列表 = 本页 `isActive=true` 且 `credentialBound=true` 且 `modelType` 与 target 匹配的 Profile；密钥缺失的 Profile 在候选中置灰。
- **Production Hub**：创建任务选择 model profile 时同样只列合法 Profile。
- **Export**：导出包一律剔除任何密钥值，只带模型 Profile 公开元数据（adr-001 §5.2）。

## 8. 一句话结论

- 模型设置页把「模型配置」与「密钥管理」从悬空状态收敛为单一 owner，配合 adr-001 保证密钥永不落 SQLite / 导出 / 日志。
