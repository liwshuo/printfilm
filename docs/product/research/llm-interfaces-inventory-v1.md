# printfilm-next 当前 LLM 接口清单

> 生成时间：2026-09-24 · 用于胖哥对照火山方舟 Ark 官方文档核对参数。
> 只列**代码里真正调用过**的接口；`callArkImage` / `callArkVideo` 已存在但业务代码尚未接入，也列出，标注"尚未接入"。

## 提供商基础信息

| 项 | 值 |
|---|---|
| Provider | **Volcengine Ark** (火山方舟) |
| Base URL | `https://ark.cn-beijing.volces.com` |
| 鉴权 | `Authorization: Bearer <ARK_API_KEY>` |
| Key 来源优先级 | 运行时 UI 配置 (`.runtime/ai.env`) → 环境变量 `ARK_API_KEY` |
| Key 状态查询 | `GET /api/ai/status`（本地 desktop-server） |
| Key 试连 | `POST /api/ai/verify`（本地 desktop-server，5 token 试探） |
| Key 配置 | `POST /api/ai/config`（本地 desktop-server） |
| Key 清除 | `POST /api/ai/config/clear`（本地 desktop-server） |

## 内置模型清单（Ark 侧）

| 模态 | 常量 | 模型 ID | 用途 |
|---|---|---|---|
| Chat | `DEFAULT_CHAT_MODEL_ID` | `doubao-seed-2-0-lite-260428` | 结构化文本生成（world / episode / scene） |
| Image | `DEFAULT_IMAGE_MODEL_ID` | `doubao-seedream-5-0-260128` | 关键帧图片（尚未接入业务代码） |
| Video | `DEFAULT_VIDEO_MODEL_ID` | `doubao-seedance-2-0-mini-260615` | 首尾帧视频（尚未接入业务代码） |

## Ark 官方 API 端点（复用 trae_projects/printfilm 的接入模式）

| 端点常量 | 路径 | 方法 | 用途 |
|---|---|---|---|
| `ARK_CHAT_ENDPOINT` | `/api/v3/chat/completions` | POST | OpenAI-compatible chat；支持 `response_format: {"type":"json_object"}` |
| `ARK_IMAGE_ENDPOINT` | `/api/v3/images/generations` | POST | OpenAI-compatible image；seedream 5.0 |
| `ARK_VIDEO_TASK_ENDPOINT` | `/api/v3/contents/generations/tasks` | POST + GET 轮询 | 视频异步任务；seedance |

> 官方文档入口：火山方舟 → 模型广场 → doubao / seedream / seedance → API 参考。

## 当前 chat 调用点（业务代码里 3 处 + 1 处探活）

### 1. `StoryService.generateStoryBible → buildWorldSettingFromLlm`
- 文件：`packages/core-services/src/story-service.ts`（`callArkChat` 第 1 处）
- 场景：drama + 短剧/动画/漫剧/漫画 → 生成"世界圣经"（logline / theme / tone / worldRules / hookSystem / pacingPlan / villainSystem / characterRelations）
- 调用参数
  - model: default（`doubao-seed-2-0-lite-260428`）
  - `responseFormat: "json"`
  - `temperature: 0.85`
  - `maxTokens: 2048`

### 2. `StoryService.generateStoryBible → buildSeriesSettingFromLlm`
- 文件：`packages/core-services/src/story-service.ts`
- 场景：series + 教育故事/绘本/纪录短片 → 生成"系列设定"（logline / theme / tone / worldRules {setting, targetAudience}）
- 调用参数：同上（`temperature: 0.85, maxTokens: 2048, response_format: json`）

### 3. `StoryService.generateEpisodeOutline → buildEpisodeOutlineFromLlm`
- 文件：`packages/core-services/src/story-service.ts`
- 场景：所有内容形态。system prompt **按 contentType 分支**（educational_story / picture_book / documentary / comic / animation / motion_comic / short_drama）。
- 调用参数
  - `responseFormat: "json"`
  - `temperature: 0.85`
  - `maxTokens: 2048`
- 现在无 API Key 会抛 `provider_unavailable`，前端 `/story` 会展示"请先在 /models 配置 Ark API Key"。

### 4. `StoryboardService.generateScenes → buildScenesFromLlm`
- 文件：`packages/core-services/src/storyboard-service.ts`
- 场景：拆分场骨架。**按 contentType 分支**（同上）。
- 调用参数
  - `responseFormat: "json"`
  - `temperature: 0.8`
  - `maxTokens: 2048`

### 5. `pingArkChat`（探活，用于 `POST /api/ai/verify`）
- 文件：`packages/core-services/src/ai/ark-chat.ts`
- 场景：Settings 页 → "试连接" 按钮
- 调用参数：`maxTokens: 5`（5 token 试探）

## 尚未接入业务代码的调用点

| 函数 | 文件 | 现状 |
|---|---|---|
| `callArkImage` | `packages/core-services/src/ai/ark-image.ts` | 已实现 Ark 图像 OpenAI-compatible API 调用（`/api/v3/images/generations`, seedream 5.0），业务代码尚未调用；未来 keyframe stage 接入 |
| `callArkVideo` | `packages/core-services/src/ai/ark-video.ts` | 已实现 Ark 视频异步任务调用（`/api/v3/contents/generations/tasks`, seedance 2.0-mini），业务代码尚未调用；未来 video stage 接入 |

## 请求/响应示意（chat）

```jsonc
// POST https://ark.cn-beijing.volces.com/api/v3/chat/completions
// Authorization: Bearer <ARK_API_KEY>
{
  "model": "doubao-seed-2-0-lite-260428",
  "messages": [
    { "role": "system", "content": "<systemPrompt>" },
    { "role": "user",   "content": "<userPrompt>" }
  ],
  "temperature": 0.85,
  "max_tokens": 2048,
  "response_format": { "type": "json_object" }
}
```

响应遵循 OpenAI chat completion 协议：`choices[0].message.content` 是模型返回的 JSON 字符串（业务侧 `JSON.parse` 后再走 zod 校验）。

## 建议查阅的文档

- 火山方舟 · doubao-seed-2-0 chat completions 参数（temperature / max_tokens / response_format）
- 火山方舟 · seedream 5.0 图像生成 API（size / quality / n / reference_image inline）
- 火山方舟 · seedance 2.0-mini 视频异步任务 API（首尾帧 keyframe / 轮询任务状态 / 结果 URL 有效期）
- Ark 错误码：`401 unauthorized`, `429 rate_limited`, `5xx upstream`——目前 desktop-server 已经 map 到 HTTP 502 `provider_unavailable`。
