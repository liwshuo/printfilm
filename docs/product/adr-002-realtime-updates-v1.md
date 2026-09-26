# ADR-002 实时更新策略 v1.0

## 1. 状态

- `accepted`

## 2. 背景

以下页面都要求近实时更新：

- Production Hub 的任务状态与日志滚动
- Project Dashboard 的阶段状态与最近活动
- Review Center 的运行结果回写

需要在 SSE / WebSocket / 轮询之间定方案。

## 3. 可选方案

### A. 纯轮询

- 优点
  - 实现简单
- 缺点
  - 任务日志体验差
  - 资源浪费明显

### B. WebSocket

- 优点
  - 双向实时能力强
- 缺点
  - 单机阶段复杂度偏高
  - 重连与会话管理成本高

### C. SSE + 轮询兜底

- 优点
  - 服务端推送简单
  - 适合单机 HTTP 服务
  - 断线恢复相对容易
- 缺点
  - 仅单向推送

## 4. 决策

V1 采用 `SSE + 轮询兜底`：

- 默认：
  - 页面通过 SSE 订阅任务与审查事件
- 兜底：
  - SSE 不可用时切到定频轮询

## 5. 事件主题

- `task.status.changed`
- `task.log.appended`
- `artifact.created`
- `review.run.finished`
- `review.issue.changed`
- `dashboard.metrics.changed`

## 6. 协议约束

- 事件必须包含：
  - `eventType`
  - `projectId`
  - `timestamp`
  - `payload`
- payload 必须是结构化对象，不传自由文本片段

## 7. 客户端策略

- 首次进页：
  - 先拉一次快照数据
  - 再订阅 SSE
- SSE 断开：
  - 指数退避重连
  - 超过阈值后切轮询
- 页签隐藏：
  - 降低事件处理频率

## 8. 影响

- `apps/desktop-server`
  - 增加 SSE endpoint
- `Production Hub`
  - 日志区走增量流式更新
- `Dashboard`
  - 阶段卡与最近活动支持被动刷新
