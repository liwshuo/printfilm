# ADR-004 API 错误响应结构 v1.0

## 1. 状态

- `accepted`

## 2. 背景

多个页面文档已经定义了丰富的空态、错态、阻塞态，但 HTTP 层此前没有统一错误信封，会导致：

- 后端返回自由文本
- 前端 hardcode 文案
- 重试与跳转建议无法复用

## 3. 决策

V1 统一采用结构化错误信封。

```ts
interface ApiErrorEnvelope {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  suggestedAction?: string;
  suggestedTarget?: string;
}
```

## 4. 必备错误码

- `validation_failed`
- `version_conflict`
- `invalid_state`
- `blocked_by_issue`
- `blocked_by_reference`
- `missing_resource`
- `path_missing`
- `provider_unavailable`
- `task_not_retryable`
- `export_not_ready`
- `internal_error`

## 5. 规则

- `blocked_by_issue` vs `blocked_by_reference`
  - `blocked_by_issue`：因存在未解决的审查/校验 issue 而阻塞（如含 error 校验项时确认/推送被阻塞）
  - `blocked_by_reference`：因目标对象仍被其他对象引用而阻塞删除/停用（如 model profile 仍被 PromptSpec/GenerationTask 绑定），`details` 需列出引用来源
- `message`
  - 面向用户可读
- `code`
  - 面向程序判断
- `details`
  - 放结构化上下文
- `retryable`
  - 决定前端是否展示“重试”
- `suggestedTarget`
  - 与导航矩阵联动，可指向修复页

## 6. 示例

### 6.1 版本冲突

```json
{
  "code": "version_conflict",
  "message": "当前对象已被更新，请刷新后重试。",
  "details": {
    "currentVersion": 8
  },
  "retryable": false,
  "suggestedAction": "refresh"
}
```

### 6.2 导出未完成

```json
{
  "code": "export_not_ready",
  "message": "当前导出尚未完成，暂不可下载。",
  "retryable": true,
  "suggestedAction": "retry"
}
```

## 7. 影响

- `navigation-matrix-v1.md` 中的失败码映射可以直接复用
- 所有 POST/PATCH/DELETE 端点必须按此结构返回业务错误
