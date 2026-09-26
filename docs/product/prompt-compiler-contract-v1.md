# Prompt Compiler Contract v1.0

## 1. 文档目标

本文档定义 `Prompt Compiler` 的职责边界、输入输出、版本约束和禁止行为。

该模块是整个平台最关键的收敛点，负责把事实层数据统一翻译成执行层可消费的 prompt 规格。

如果这个模块边界不硬，后续系统极容易重新滑向：

- UI 层临时拼 prompt
- adapter 层补业务约束
- worker 层按报错反向改 prompt
- 同一镜头在多个地方存在多个 prompt 真相

## 2. 模块定位

`Prompt Compiler` 是平台中最终执行 prompt 的唯一出口。

它负责：

- 读取事实层
- 读取 model profile
- 按 target type 生成统一 prompt spec
- 输出标准化结果供任务系统消费

它不负责：

- 直接调用模型
- 直接创建任务
- 更新故事事实
- 临时修改上游资产

## 3. 设计来源

- `drama-skills`
  - 借用“先确认后生产”的思想
- `CineGen-ShortDrama`
  - 借用 keyframe-driven 的桥梁设计
- `huobao-drama`
  - 借用 prompt 作为执行层输入的思路
- `trae_projects`
  - 仅参考多模型调用前的组织方式

本模块只借方法和边界，不复制任何外部 prompt 文本。

## 4. 目标与非目标

### 4.1 目标

- 为图片生成输出稳定的 prompt spec
- 为视频生成输出稳定的 prompt spec
- 为 TTS 生成输出稳定的文本规格
- 支持 prompt diff、版本和确认状态
- 让所有执行链使用统一结构

### 4.2 非目标

- 不做 provider-specific prompt 拼接
- 不做任务状态管理
- 不直接存放媒体产物
- 不替代故事引擎和分镜引擎

## 5. 输入来源

Prompt Compiler 只允许读取以下数据：

### 5.1 故事层输入

- `Project`
- `ProjectStoryBible`
- `Episode`

### 5.2 设定层输入

- `Character`
- `CharacterLook`
- `Location`
- `Prop`
- `StyleGuide`

### 5.3 分镜层输入

- `Scene`
- `Shot`
- `KeyframeSpec`
- `ContinuityAnchor`
- `scene_characters`
- `shot_characters`
- `shot_props`

### 5.4 配置层输入

- `ModelProfile`
- 编译器内部模板版本
- 项目级 prompt policy

## 6. 输出对象

统一输出为 `PromptSpec`。

### 6.1 PromptSpec 字段

- `id`
- `projectId`
- `episodeId`
- `sceneId`
- `shotId`
- `keyframeId`
- `targetType`
- `sourceEntityType`
- `sourceEntityId`
- `compiledPrompt`
- `sections`
  - 结构化编译输出（`PromptSection[]`，见 data-and-api §6 `PromptSection`：`key` / `label` / `content` / `sourceRefs`），供 Prompt Center 分段预览
  - `compiledPrompt` 是 `sections` 按固定顺序拼接后的文本快照，二者必须由同一次编译产出，保证一致
- `negativePrompt`
- `modelProfileId`
- `compilerVersion`
- `status`
- `createdAt`
- `updatedAt`

### 6.2 targetType

- `text`
- `image`
- `video`
- `tts`

> 说明：`image` / `video` / `tts` 为 shot/scene 级、走 §9 `CompileInput` 的事实驱动编译；`text` 为 LLM 文本任务（`story_generate` 等）的目标类型，由系统模板 + 项目/集级事实自动编译，输入不走 shot 级 `CompileInput`，且不在 Prompt Center 手工编辑（口径见 `data-and-api-v1.md` §8.6）。本文档 §9/§10 的编译规则与固定段落结构仅约束 shot/scene 级三类；`text` 的段落模板由各来源页（如 Story Workspace）定义。

### 6.3 status

- `draft`
- `confirmed`
- `superseded`

## 7. 子编译器划分

### 7.1 Image Prompt Compiler

用途：

- 角色参考图
- 场景参考图
- 道具参考图
- 关键帧图片

输入重点：

- 角色外观
- 服装状态
- 场景空间规则
- 关键帧构图

### 7.2 Video Prompt Compiler

用途：

- shot 级视频生成
- image-to-video
- keyframe interpolation

前置条件：

- 目标 shot 必须已过 keyframe 门禁（start+end 关键帧齐备且 confirmed，见 adr-006 §4）；由所属场 `storyboardStatus=confirmed` 的确认校验保证，编译器不再单独定义前置口径

输入重点：

- shot intent
- camera plan
- start / end state
- continuity anchor
- 角色动作与表演约束

### 7.3 TTS Compiler

用途：

- 对白文本
- 旁白文本
- 临时配音脚本

输入重点：

- 角色说话风格
- 台词文本
- 情绪说明
- 是否需要语音角色 profile

## 8. 编译流程

标准流程如下：

1. 校验 source entity 是否存在
2. 读取事实层依赖
3. 读取 model profile
4. 组装标准化 compiler input
5. 执行目标编译器
6. 生成 `PromptSpec`
7. 写入版本和状态
8. 返回给调用方

## 9. Compiler Input Contract

为了避免页面和 service 各自拼字段，必须先组装统一输入对象。

```ts
export interface PromptCompilerInput {
  project: Project;
  storyBible?: ProjectStoryBible;
  episode?: Episode;
  scene?: Scene;
  shot?: Shot;
  characters: Character[];
  characterLooks: CharacterLook[];
  location?: Location;
  props: Prop[];
  keyframes: KeyframeSpec[];
  continuityAnchors: ContinuityAnchor[];
  modelProfile?: ModelProfile;
  targetType: "image" | "video" | "tts";
  sourceEntityType: "character" | "location" | "scene" | "shot" | "episode" | "keyframe";
  sourceEntityId: string;
}
```

## 10. Prompt 编译规则

### 10.1 只编译，不推理业务真相

Prompt Compiler 不能自行猜测：

- 角色当前穿哪套衣服
- 当前镜头有哪些角色
- 该镜头延续上一镜什么状态

这些内容必须来自事实层。

### 10.2 正向锚点优先

Prompt 必须以正向描述为主，优先表达：

- 画面主体
- 人物身份
- 角色外观
- 服装版本
- 场景环境
- 构图方式
- 镜头动作
- continuity 约束

不允许大量依赖负向禁令来兜底业务逻辑。

### 10.3 Prompt 结构化

不同 target type 必须具有固定段落结构。

例如视频 prompt 推荐结构：

1. 镜头目标
2. 角色与服装
3. 场景与空间
4. 动作与表演
5. 摄影与运镜
6. continuity 与起止状态

## 11. 禁止行为

### 11.1 UI 禁止行为

- 页面组件直接拼最终 prompt
- 页面根据失败日志追加 prompt 文本
- 页面缓存一份独立 prompt 真相

### 11.2 Service 禁止行为

- Story Service 拼 prompt
- Asset Service 拼 prompt
- Storyboard Service 拼 prompt

### 11.3 Adapter 禁止行为

- 根据 provider 特性注入业务规则
- 擅自改写角色和镜头约束
- 覆盖 compiler 输出

### 11.4 Worker 禁止行为

- 遇错后自动追加业务 prompt
- 按结果反向修改事实层
- 在执行层维护第二份 prompt 状态

## 12. 版本管理

### 12.1 compilerVersion

每条 `PromptSpec` 必须记录：

- 编译器主版本
- 模板版本
- 规则版本

示例：

- `prompt-compiler@1.0.0`
- `image-compiler@1.0.0`
- `video-compiler@1.0.0`

### 12.2 superseded 机制

当同一 source entity 重新编译时：

- 旧版本保留
- 状态改为 `superseded`
- 新版本进入 `draft`

## 13. 确认机制

在 V1 中，执行前建议由用户确认：

- 编译结果
- target type
- model profile
- 是否进入任务系统

这部分设计来源于 `drama-skills` 的“先确认后生产”。

## 14. 与任务系统的边界

Prompt Compiler 输出 `PromptSpec` 后即结束。

后续由：

- `Job Orchestrator`
  - 根据 PromptSpec 创建任务
- `Model Adapter`
  - 负责 provider 请求翻译

Prompt Compiler 不负责：

- 重试
- 取消
- 回调
- 产物回填

## 15. 最小接口建议

### 15.1 Service 接口

```ts
export interface PromptCompilerService {
  compile(input: PromptCompilerInput): Promise<PromptSpec>;
  compileImage(input: PromptCompilerInput): Promise<PromptSpec>;
  compileVideo(input: PromptCompilerInput): Promise<PromptSpec>;
  compileTTS(input: PromptCompilerInput): Promise<PromptSpec>;
}
```

### 15.2 API 接口

- `POST /api/prompts/compile`
- `POST /api/shots/:shotId/prompts/compile-image`
- `POST /api/shots/:shotId/prompts/compile-video`
- `POST /api/scenes/:sceneId/prompts/compile-tts`

## 16. 测试重点

- 同一镜头多次编译是否稳定
- 缺失 look / location / keyframe 时是否正确报错
- target type 是否输出正确结构
- 旧版本是否正确标记为 `superseded`
- compiler 是否完全不读执行层状态

## 17. 一句话结论

- `Prompt Compiler` 是系统的唯一 prompt 出口，它必须只读取事实层、只输出标准化 PromptSpec，并且绝不承担任何临时补丁职责。
