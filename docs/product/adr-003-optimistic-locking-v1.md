# ADR-003 乐观锁与版本冲突策略 v1.0

## 1. 状态

- `accepted`

## 2. 背景

文档中多个对象已存在 `version` 语义：

- `project_story_bibles`
- `episodes`
- `characters`
- `character_looks`
- `locations`
- `props`
- `scenes`
- `shots`
- `keyframe_specs`
- `prompt_specs`

同时页面规格里已定义“对象已被更新，请刷新后再编辑”的错态，因此必须统一版本冲突策略。

## 3. 决策

V1 采用 `版本号乐观锁`：

- 所有可编辑核心对象都带 `version`
- 客户端提交更新时必须带当前 `version`
- 服务端仅在版本匹配时写入
- 写入成功后 `version += 1`

## 4. 冲突规则

### 4.1 冲突条件

- 请求中的 `version` 小于数据库当前值

### 4.2 服务端行为

- 返回标准错误：
  - `code = "version_conflict"`
- 返回：
  - 当前对象摘要
  - 当前版本号
  - 最近变更时间

### 4.3 客户端行为

- 展示冲突提示
- 提供动作：
  - 刷新并覆盖本地视图
  - 比较差异
  - 重新编辑

## 5. 适用范围

- `PATCH /api/projects/:projectId/story-bible`
- `PATCH /api/episodes/:episodeId`
- `PATCH /api/characters/:characterId`
- `PATCH /api/locations/:locationId`
- `PATCH /api/props/:propId`
- `PATCH /api/style-guides/:styleGuideId`
- `PATCH /api/scenes/:sceneId`
- `PATCH /api/shots/:shotId`
- `PATCH /api/keyframes/:keyframeId`
- `PATCH /api/character-looks/:lookId`
- 其他写核心事实层的更新端点

## 6. 不适用范围

- 任务状态更新
- 日志追加
- 审查事件追加
- activity 事件追加

这些属于 append-only 或系统写入，不走乐观锁。

## 7. 影响

- API 请求体需要显式带 `version`
- 页面保存前必须保留最近一次加载版本
- Review / Prompt 的 `source_outdated` 也可复用相同版本语义
