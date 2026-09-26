# AI Provider 配置指南 · v1（火山方舟 Ark）

> 目标：把 `/Users/bytedance/Documents/trae_projects/printfilm` 项目正在用的火山方舟
> Provider / 模型直接复用到 `printfilm-next`，实现故事圣经 / 分集大纲 / 分镜场次的
> 真实 LLM 生成。无 Key 时会自动回退到确定性 stub，不影响 UI 状态机走通。

---

## 1. Provider 与默认模型（来源：trae_projects/printfilm/types/model.ts）

- Provider: `volcengine-ark`（Volcengine Ark）
- baseUrl: `https://ark.cn-beijing.volces.com`
- 默认模型：
  - Chat：`doubao-seed-2-0-lite-260428`
  - Image：`doubao-seedream-5-0-260128`
  - Video：`doubao-seedance-2-0-mini-260615`
- Endpoints：
  - Chat：`POST /api/v3/chat/completions`
  - Image：`POST /api/v3/images/generations`
  - Video：`POST /api/v3/contents/generations/tasks`（异步任务 + 轮询）

与源项目差异：源项目浏览器侧靠 `/api-proxy` 转发以规避 CORS；
`printfilm-next` 的 AI Adapter 运行在 Node/Hono 后端，直接向 Ark 发起 HTTPS 请求。

---

## 2. 配置 API Key

有两种方式，均可用；**Web UI 优先**。

### 2.1 Web UI 配置（推荐）

打开 `http://127.0.0.1:5173/models` → 顶部「AI Provider · 火山方舟 Ark（默认）」卡片：

1. 在 `ARK_API_KEY` 输入框粘贴 Key（默认密码遮罩，可点「显示」查看）。
2. 勾选「持久化到 `.runtime/ai.env`（重启后仍生效）」：
   - **勾选**：Key 会写入 `.runtime/ai.env`（chmod 0600），并进入进程 runtime 覆盖。
     `desktop-server` 下次启动会自动加载。
   - **不勾选**：仅写入当前进程 runtime 内存，重启后失效（适合临时调试）。
3. 点「保存并验证」：保存后会自动调用 `POST /api/ai/verify` 做一次 5-token 探活。
4. 状态卡片会显示 `keySource=runtime` 和 `keyPreview=sk-****xxxx`（末 4 位）。
5. 需要清除时点「清除 Key」，会同时删除 `.runtime/ai.env`。

### 2.2 环境变量（备选，兼容性）

优先级（Node 端 `process.env`，从低到高：先 runtime override，再 env）：

- runtime override（Web UI 保存 / `.runtime/ai.env`）
- `ARK_API_KEY`
- `ANTSK_API_KEY`
- `API_KEY`

复用 trae_projects 现有 Key：

```bash
export ARK_API_KEY=<your_ark_key>
```

生效后必须重启 desktop-server：

```bash
cd /Users/bytedance/Workspace/personal/printfilm-next
pkill -f 'apps/desktop-server/dist/index.js'
nohup node apps/desktop-server/dist/index.js > .runtime/desktop-server.log 2>&1 &
```

### 2.3 存储位置与安全

- `.runtime/ai.env`：进程本地文件，权限 `0600`，仅本机进程可读。
- 已加入项目 `.gitignore`（`.runtime/`）保护，绝不会随代码提交。
- `GET /api/ai/status` 不回显明文，只返回遮罩后的 `keyPreview`（例如 `sk-****9999`）。

---

## 3. 相关接口

- `GET /api/ai/status`：只读 env + runtime override，不打上游。
- `POST /api/ai/verify`：真调一次 5 token Ark chat 探活，返回 `ping.ok / modelId / finishReason / status / error`。
- `POST /api/ai/config`：body `{ apiKey: string, persist?: boolean }`；写 runtime override + 可选写文件。
- `POST /api/ai/config/clear`：清 runtime override + 删除 `.runtime/ai.env`。

---

## 4. Adapter 代码入口

- `packages/core-services/src/ai/`
  - `ark-config.ts`：Provider baseUrl、endpoint、默认模型 id、`resolveApiKey()`、
    `getProviderStatus()`、`isProviderReady()`。
  - `ark-chat.ts`：Chat Completions（含 `response_format: json_object` 与 3 次退避重试）。
  - `ark-image.ts`：图片生成。
  - `ark-video.ts`：Seedance 异步任务创建 + 轮询。
  - `types.ts`：`ChatMessage / ChatOptions / ChatResult / AiApiKeyError / AiUpstreamError`。
- 业务接入：
  - `story-service.ts`
    - `generateStoryBible`：`isProviderReady()` 时调 Ark chat，
      要求模型输出严格 JSON（`logline/theme/tone/worldRules/hookSystem/pacingPlan/villainSystem/characterRelations`）；
      失败或非 JSON 时打 `console.warn` 并回退 stub。
    - `generateEpisodeOutline`：Ark chat 生成 N 集分集草案，兼容
      `{ episodes | items | data }` 三种包装。
  - `storyboard-service.ts`
    - `generateScenes`：Ark chat 生成本集 N 个场次骨架，schema 含
      `title / summary / dramaticGoal / conflict / timeOfDay`。

---

## 5. 回退策略与错误分类

- 任何一次 LLM 调用失败（网络 / 400 / 401 / 敏感词 / 非 JSON）都不会阻塞用户操作：
  会以 stub 结果落库，`activityLogs.payload.extra.source = "stub"` 记录。
- 错误分类：
  - `AiApiKeyError`：未配置 KEY。
  - `AiUpstreamError`：上游 HTTP 非 2xx，携带 `status`。
- Chat 重试：非 400/401/403 的错误会做 1s / 2s / 3s 三次退避。

---

## 6. 已验证 smoke（本地无 KEY 场景）

- `GET /api/ai/status` → `ready: false`，默认模型三项返回正确。
- `POST /api/projects/:id/story-bible/generate` → stub 落库，Activity `story.bible.generated` 附 `source: "stub"`。
- `POST /api/projects/:id/episodes/generate-outline` → stub 分集落库。
- `POST /api/episodes/:id/scenes/generate` → stub 场次落库。

配置好 `ARK_API_KEY` 后：

- `POST /api/ai/verify` 应返回 `ping.ok: true` + `modelId: doubao-seed-2-0-lite-260428`。
- 上述三个生成接口会转由 LLM 产出，Activity 中 `extra.source = "llm"`。
