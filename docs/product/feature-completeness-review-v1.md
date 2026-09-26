# 各模块功能细节完善度评审 feature-completeness-review-v1

## 1. 评审目标与范围

- 目标：在进入工程实现前，判断 10 个模块 spec 的**功能细节完善度**——是否已细到工程师可直接开工，并识别所有会**阻塞实现或导致返工**的缺口。
- 与前序评审的区别：`docs-review-v1.md` / `docs-review-round2-v1.md` 关注文档一致性/矛盾/编号；本轮关注**功能深度、契约硬度与可实现性**，不重复报排版类问题。
- 评审对象（10 个模块 spec）：Project Setup、Project Dashboard、Story Workspace、Script Editor、Asset Ledger、Storyboard Studio、Prompt Center、Production Hub、Review Center、Export Center。
- 交叉核对基线：`data-and-api-v1.md`（§5 表/§6 类型/§7 端点）、`page-state-machine-v1.md`、`navigation-matrix-v1.md`、`prompt-compiler-contract-v1.md`、`job-orchestrator-contract-v1.md`、`adr-002`（SSE+轮询）、`adr-003`（乐观锁）、`adr-004`（错误信封）。

### 1.1 评审 rubric（8 维度）

1. 功能覆盖完整性（页面目标动作 → 是否都有实现规格）
2. 字段级完整性（类型/约束/默认值/校验/来源/落库位置）
3. 状态与流转闭环（持久态/派生态/异常/回退/并发冲突）
4. 交互态齐全度（空态/错态/加载态/二次确认/边界）
5. 接口契约硬度（动作 → 真实端点 + 请求/响应/错误码）
6. 异常与错误处理（失败码/重试/超时/部分失败/错误信封）
7. 跨模块一致性（跳转入口/上下文携带参数对齐）
8. 可实现性 gap（是否细到可直接开工）

### 1.2 严重度定义

- **P0**：直接阻塞实现或必然返工（核心动作无接口、状态机断裂、关键字段无落库、编排链路未定）。
- **P1**：影响主流程质量或需求确定性（异常分支缺失、字段约束/口径不明、实时机制未落地）。
- **P2**：边界/体验完善项（空态文案、极端值、视觉规则、分页）。

## 2. 总体结论

**一句话结论**：文档骨架整体齐全、章节结构统一，但**功能细节尚未到"可直接开工"的程度**——普遍卡在"接口契约停留在建议、字段无落库归属、状态派生规则缺失、异步动作被当同步、跨模块上下文未握手"这几类系统性缺口上。建议先钉死下述 P0，再启动实现。

### 2.1 模块完善度评级总表

| 模块 | 完善度评级 | P0 | 关键短板 |
| --- | --- | --- | --- |
| Project Setup | 需补齐关键细节 | 2 | 输出规格/模型策略/创作约束字段无落库位置与写入端点 |
| Project Dashboard | 需补齐关键细节 | 1 | 9 阶段 stageStatus/completionPercent 派生规则完全缺失 |
| Story Workspace | 需补齐关键细节 | 4 | 故事确认作用域与数据模型冲突；完整性检查/集排序无端点 |
| Script Editor | 需补齐关键细节 | 3 | scene"冲突"字段缺失；快照恢复、对白/动作块 CRUD 无接口 |
| Asset Ledger | 基本可实现·待补少量 | 1 | 非 look 资产/风格的版本化无表无端点（其余最扎实） |
| Storyboard Studio | 需补齐关键细节 | 1~2 | keyframe 门禁范围不一致；核心 shot 动作端点未落 |
| Prompt Center | 需补齐关键细节 | 1 | 结构化预览无数据契约；编译同步/异步与版本口径未定 |
| Production Hub | 基本可实现·待补少量 | 0 | 与 job-orchestrator 基本对齐；缺字段级来源与实时映射 |
| Review Center | 需补齐关键细节 | 1 | review-run 状态查询端点缺失，run→结果回显闭环断裂 |
| Export Center | 需补齐关键细节 | 1 | 与 Job Orchestrator 的 compose_export 编排关系未定义 |

- **相对最扎实**：Asset Ledger（look 多版本/默认/乐观锁/引用链路）、Production Hub（任务生命周期与编排契约对齐）。
- **最需要先补**：Story Workspace、Script Editor、Project Setup、Project Dashboard。

## 3. 跨模块系统性问题（根因，比单点缺口更值得先解决）

这 9 类横切问题在多个模块反复出现，是"功能不完善"的真正根因。建议按主题统一治理，而不是逐模块打补丁。

- **S1 接口契约停留在"建议"层**：各 spec 末尾章节名为"后续接口映射建议"，措辞偏软；多个核心动作没有落到真实端点与请求/响应/错误码。缺失或错配的端点包括：Story 完整性检查、Story/Episode 集排序、Setup 字段落库端点、Script 快照 GET/restore 与对白/动作块 CRUD、Asset 版本 POST、Review-run 状态查询、Storyboard shot CRUD 映射、Prompt 编译端点集歧义。**建议：把各 spec 的"接口映射建议"升级为强绑定契约章节。**
- **S2 乐观锁（adr-003）未落地**：多数 PATCH 类动作只在错态文案里提 `version_conflict`，未按 adr-003 §5 明确"PATCH 必带 version"，也缺"比较差异/刷新覆盖/重新编辑"三动作。涉及 Story、Script、Storyboard、Asset、Setup。
- **S3 错误信封（adr-004）未贯穿**：普遍只覆盖个别错态，未系统映射 `validation_failed / invalid_state / blocked_by_issue / missing_resource / internal_error` 等错误码。
- **S4 实时更新（adr-002 SSE+轮询）落地不均**：Dashboard、Production、Review、Export 多处缺"先拉快照再订阅"的主题→区块映射；Review/Export 甚至全文无实时章节。
- **S5 状态派生规则缺失或口径不一**：Dashboard 9 阶段 stageStatus/completionPercent 聚合规则完全缺失；Prompt UI 派生态自造近义词、未收口到 page-state-machine 统一字典；continuity ok/warning/error 判定引擎归属与算法未定。
- **S6 字段无落库归属 / JSON blob 无 schema**：Setup 的输出规格+模型策略 8 字段、Story 的 mainCharacter/relationshipMap/cliffhangerPlan、Storyboard 的 camera_plan_json、Script 的 character_relations_json 等无表列或无内部 schema，直接导致"字段级 diff / 结构化预览"无法实现。
- **S7 异步 AI 动作被当同步建模**：Story"AI 生成分集"、Prompt"编译"、Storyboard"AI 生成 shot 草稿"被当同步 modal，缺 pending/进度/超时/取消/部分成功，与 data-and-api 中 `story_generate / prompt_compile` 的异步任务性质冲突。
- **S8 跨模块上下文/回跳握手缺失**：多处跳转未携带 navigation-matrix 定义的上下文参数（`taskId / returnTo / scopeRef / sourceRefs / keyframeId / sourceEntityRef`），也未定义"返回来源页"入口。涉及 Production→Prompt、Prompt→Storyboard、Review→Source、Export→Production。
- **S9 导出编排链路空洞**：Export Center 与 job-orchestrator 的 `compose_export` 任务关系、`export_bundle.status` 与底层 `task.status` 联动未定义（P0），且连累 Production Hub 的 compose_export 创建路径。

## 4. 建议的补齐顺序（实现前必须先钉死）

1. **先定 3 个"作用域/粒度"口径**（否则前后端各写一套必返工）：
   - Story 确认作用域：项目级 vs 分集级（Story §6.2/§11/§13 与 `episodes.story_status` 冲突）。
   - keyframe 门禁范围：可生产 shot 是否一律要求 start/end（Storyboard §10.4 vs §12.2 vs Prompt §12.2）。
   - Export 编排链路：导出是否经 Job Orchestrator 生成 compose_export 任务及状态联动。
2. **再补"无接口/无落库"的 P0**：Setup 8 个项目级字段落库、Script 快照恢复+block CRUD+conflict 字段、Dashboard 阶段派生规则、Prompt 结构化预览契约、Review-run 状态查询端点。
3. **再统一 3 条横切规范**：S1 接口契约硬化、S2/S3 乐观锁+错误信封、S4 实时更新（SSE+轮询）。
4. **最后清 P1/P2**：跨模块上下文携带、异步动作交互态、边界/视觉/分页。

> 下面第 5 节给出逐模块的完整缺口清单（含 §章节/字段引用与建议）。

## 5. 分模块缺口清单

> 每条格式：`[rubric 维度] 严重度 | 缺口（引用 §章节/字段）| 建议补什么`

### 5.1 Project Setup（project-setup-spec-v1.md）— 需补齐关键细节

- `[2/5] P0 | §8.2 输出规格(defaultSubtitleLanguage/exportPreset/defaultPromptPolicy/defaultModelPolicy) 与 §8.3 模型策略(llmProfileId/imageProfileId/videoProfileId/ttsProfileId) 在 data-api §5 projects 表、§6 Project 类型中均无对应列，也无 projects→model_profiles 默认绑定，无处持久化 | 在 projects 表补列或建项目级配置关联表，明确落库时机与 §7 写入端点`
- `[2] P0 | §8.1 创作约束字段 styleDirection/forbiddenPatterns/complianceLevel/targetRegion 无持久化归属：projects 表无这些列；style_guides 表只有 visual_style/forbidden_patterns_json，且 §7.4 无创建 style_guide 的 POST 端点 | 指明各字段写入哪张表、style_guide 是否随项目创建自动生成`
- `[2] P1 | episodeCount 语义冲突：§7.3 定义为必填 1-500，但 projects.episode_count DEFAULT 0，又在 dashboard/故事层作为"实际集数"聚合 | 明确是"计划集数"还是"实际集数"，必要时拆字段`
- `[3] P1 | 编辑模式(§11.2)缺并发处理：projects 表无 version、adr-003 §5 未含 PATCH /api/projects | 明确是否纳入乐观锁，纳入则补 version + version_conflict 处理`
- `[3] P1 | 项目 status 生命周期未定义：state-machine §3.1 有 draft/active/archived，本页未说明创建是否 draft→active | 补 status 迁移动作与触发时机`
- `[5/6] P1 | §16 validate-setup / preview-impact 请求体与响应结构未定义；slug 冲突/必填失败未映射 adr-004 错误码 | 补两端点响应 schema 与错误码映射`
- `[2] P1 | 约束/输出字段缺类型与取值：complianceLevel/targetRegion/exportPreset/defaultPromptPolicy/defaultModelPolicy 无枚举/默认值；forbiddenPatterns 未定义列表 vs 自由文本 | 逐字段补类型/枚举/默认/校验`
- `[2] P1 | §8.2 defaultModelPolicy 与 §8.3 四个 profileId 语义重复、关系不清 | 明确取舍去冗余`
- `[2] P2 | projectSlug 自动生成规则未定义（中文名转 slug、冲突重试）| 补生成算法与冲突自增`
- `[4] P2 | §6.2"放弃当前编辑"无 dirty 二次确认；编辑模式加载态/加载失败错态未覆盖 | 补加载态、错态、放弃编辑确认`
- `[7] P2 | §6.2"返回项目列表"指向的列表页在 10 模块中不存在 | 明确归属或补列表视图`
- `[4] P2 | 无 model_profile 时 §8.3 模型策略选择空态未定义 | 补"暂无模型配置"空态`

### 5.2 Project Dashboard（project-dashboard-spec-v1.md）— 需补齐关键细节

- `[2/8] P0 | §7.2 stageStatus(not_started/in_progress/completed/blocked)、completionPercent、blockingIssueCount 派生规则完全缺失：9 阶段如何从 episode 级/scene 级状态聚合、百分比如何算均未定义 | 给出每阶段→源字段聚合映射表与 completionPercent 口径，否则 GET /stage-status 无法实现`
- `[2] P1 | §8.1 进度卡"已确认 shot 比例"无数据支撑：shots 表无确认状态字段 | 改为 scene/keyframe/prompt 维度，或为 shot 补确认语义`
- `[2/6] P1 | §8.1 成本卡：generation_tasks 只有 cost_estimate、无实际成本，provider 无直连列；"今日/累计成本""成本异常"口径未定 | 明确成本来源字段、聚合方式与异常阈值`
- `[3/8] P1 | adr-002 §8 要求 Dashboard 走 SSE+轮询兜底，但本 spec 全文未提实时刷新 | 补首屏快照+SSE 订阅+轮询兜底`
- `[7] P1 | §11 快捷入口缺置灰/前置条件规则（navigation §7.1/§5 要求前置不满足置灰）；todoHint 生成规则未定义 | 对齐 navigation 补可用性判定与 todoHint 派生`
- `[2/7] P1 | §10.2 activity_events.targetRef 结构未标准化，§10.3 点击跳转无法路由 | 定义 targetRef {type+ids} schema 及各 eventType 跳转目标`
- `[1/6] P1 | §6.2"归档项目"无端点与流程，缺二次确认/归档后影响/解档路径 | 补归档端点、确认弹窗、归档后行为与解档入口`
- `[2] P2 | §8.1 任务概览卡漏 cancelled 状态，未定义统计时间窗 | 补 cancelled 展示与统计口径`
- `[4] P2 | 页面级 attention_needed/blocked 派生态未映射到 UI 呈现 | 补顶部健康度徽标与 blocked 高亮`
- `[2] P2 | §9"高优先级"未映射 severity 枚举；issue.locationLabel 在 review_issues 表无此列 | 明确高优判定并标注 locationLabel 为派生`
- `[4] P2 | §10 活动流 / §9 阻塞卡分页与条数上限未声明 | 补首屏条数与"加载更多"`

### 5.3 Story Workspace（story-workspace-spec-v1.md）— 需补齐关键细节

- `[3/2] P0 | storyStatus 作用域自相矛盾：§6.2/§11/§13 当项目级单值，但 data-api §5 story_status 在 episodes 表、state-machine §5.1 明确 Episode.storyStatus，而 confirm 端点 §7.2 是项目级 | 定死 confirm 语义（批量写全部集 vs 项目 rollup？概览读哪个），否则实现二义`
- `[5/1] P0 | "运行完整性检查"(§10/§11.1) 无对应端点（对比 script 有 /scenes/:id/validate）| 明确纯前端派生（给规则集）还是新增端点`
- `[5/1] P0 | §7.2"调整集顺序"无端点（§7.3 只有 scenes/reorder）| 补 POST /projects/:projectId/episodes/reorder 及请求体`
- `[2] P0 | §8.2 mainCharacter/mainConflict/relationshipMap/motivationChain 无存储映射：project_story_bibles 仅 villain_system_json、character_relations_json | 明确落在哪个 JSON 列及子结构`
- `[5] P1 | "AI 生成分集草案"(§7.3) 对应 §7.2 /episodes/generate-outline，但 §17 只映射 story-bible/generate | 补映射并区分 bible vs outline 两个端点`
- `[6] P1 | AI 生成为异步任务(story_generate)，但 §12.1/§14.2 按同步 modal 建模 | 补 pending/进度/超时/取消/部分成功交互`
- `[2] P1 | §8.4 cliffhangerPlan 无对应列（仅 pacing_plan_json/hook_system_json）| 明确并入哪列或新增`
- `[3/7] P1 | §13.3"重大改动回退 draft"触发条件未定义；state-machine §5.6 要求故事变更后向剧本页发 unsynced，未定义 | 定义"重大改动"判定与下游 unsynced 信号`
- `[7] P1 | §11"进入剧本编辑"未携带/选择 episodeId（scriptStatus 分集级，navigation §5.2 要求 episodeId）| 明确进入定位到哪一集`
- `[2/8] P1 | character_relations/hook_system/pacing_plan 等 JSON blob 无 schema，而 §9.2/§12.2 需字段级 diff | 给出结构化 schema`
- `[3] P2 | 乐观锁：PATCH story-bible 需带 version，仅 §14.3 提 version_conflict，缺三动作 | 补 adr-003 §4.3 比较/刷新/重编辑`
- `[6] P2 | 除 version_conflict 外未引用 adr-004 错误码 | 概览错态补信封码映射`

### 5.4 Script Editor（script-editor-spec-v1.md）— 需补齐关键细节

- `[1/3] P0 | scene"冲突"字段缺失：§3.2 目标与 §9.1 校验都要求，但 §8.1/8.2 无 conflict 字段、scenes 表也只有 dramatic_goal/entry/exit_state | 补 sceneConflict 字段及表列，或明确用哪个既有字段承载`
- `[5] P0 | 快照查看/恢复(§10.2) 无端点：§7.3 只有创建快照，无 GET 详情、无 restore | 补 GET /snapshots/:id 与恢复端点，定义与 scene.version 乐观锁交互`
- `[5] P0 | 对白块/动作块 CRUD(§8.3/8.4/8.6) 无专用端点，也未说明是否随 PATCH /scenes 嵌套保存 | 明确 block 级契约（独立端点或嵌套 payload + 排序）`
- `[2] P1 | §10.1 snapshotPayloadVersion 在 script_snapshots 表无对应列 | 补列或改为 payload 内字段`
- `[3/7] P1 | state-machine §6.2 定义 story_unsynced，spec §10.3 只处理 storyboard_unsynced | 补"上游故事变更→剧本页 story_unsynced"处理`
- `[7] P1 | scene_characters 关联表（角色/look 出场）由谁写入未定义，而 §9.2 References 与下游分镜依赖它 | 明确写入时机与入口`
- `[3] P1 | 乐观锁：PATCH scenes/shots 需带 version，仅 §15.2 给冲突文案，缺比较/刷新动作 | 补三动作`
- `[8] P1 | §9.1"角色引用是否有效"规则不明（disabled 角色/失效 look 是否算无效）| 定义有效性判定与错误定位`
- `[4/6] P1 | 删除已含 shot/artifact 的 scene(§13) 若被拒无错误码映射；push-to-storyboard 失败态未覆盖 | 补失败信封码与错态`
- `[2] P2 | 对白/动作块字段约束未定义（text 必填？emotion 枚举？order 规则）| 补字段约束`
- `[7] P2 | push-to-storyboard 为集级(§18)，但 navigation §5.3 按 scene 进入分镜 | 统一推送粒度`

### 5.5 Asset Ledger（asset-ledger-spec-v1.md）— 基本可实现·待补少量

- `[1/5] P0 | "新建风格版本"(§8.5)、非 look 资产"新建版本"(§11.1)、§10.1"其他资产基础版本快照"既无端点也无表：characters/locations/props/style_guides 只有单个 version 列，无版本历史行、无 snapshot 表；§7.4 无 POST 版本端点 | 二选一：补版本历史表+端点，或明确 V1 仅 look 版本化并移除相关按钮`
- `[3/5] P1 | "设为默认 look"(§8.2) 无专用端点、原默认置 false 的原子性未定义；"新建版本"时旧行 is_current 置 false 的事务未落到端点行为 | 明确两个写操作的原子事务（对齐 default_current 部分唯一索引）`
- `[2/5] P1 | 概览 unsyncedChangesCount/referenceConflictCount、列表 usageCount/unsyncedFlag 无接口来源（usage 端点仅 per-asset）| 补项目级聚合端点或列表内联字段`
- `[5] P1 | Impact Analysis Drawer(§14) 无映射端点；§7.1 /preview-impact 为项目级非资产级 | 明确 impact 端点作用域与入参`
- `[3/7] P1 | 下游 unsynced 检测机制未定义：scene_characters/shot_characters 存 look_id 但不存版本，§15.3 靠什么判定未说明 | 定义检测口径（如 look_id.is_current=false 触发 unsynced）`
- `[3] P1 | "被引用对象非法停用"(state-machine §7.5) 与 referenceConflict 定义缺失 | 给出停用前置校验与冲突判定`
- `[2/4] P1 | Create Asset Modal 重名冲突未处理，locations 表无 UNIQUE(project_id,name) | 补唯一约束与重名错态`
- `[4] P2 | baseTemplate 语义/来源未定义，需与 reference-adoption-policy"禁止复制内容模板"边界对齐`
- `[3] P2 | §15.4 仅"刷新后再编辑"，少于 adr-003 §4.3 三动作 | 补比较/刷新覆盖/重编辑`
- `[4] P2 | 无 disabled 资产 re-activate 动作 | 补重新启用`

### 5.6 Storyboard Studio（storyboard-studio-spec-v1.md）— 需补齐关键细节

> 已收口（不重复报）：确认粒度已明确为**场级**（§12.3/§14.1），`storyboardStatusSource=Scene.storyboardStatus` 非 episode 聚合，与 data-api §6.2 一致，R-15 争议在本 spec 侧已解决。

- `[3] P0 | §10.4"每个可生产 shot 必须有 start/end"与 §12.2 确认条件"所有关键 shot 至少有 start/end"口径不一致；非 key shot 可通过场级确认，却在 Prompt Center §12.2 video 前置被卡死 | 统一 keyframe 门禁范围（建议：可生产 shot 一律要求 start/end）并写进确认校验，防"已确认但不可编译"静默断链`
- `[5] P0/P1 | §18"接口映射建议"为软建议且缺多个核心端点：§8.5 新建/复制/删除 shot、§8.6 拖拽排序、§8.7 AI 生成 shot 草稿（data-api §7.3/§7.5 均已有真实端点）未列 | 升级为强绑定映射，逐动作对应真实端点`
- `[2] P1 | §9.2 镜头语言 cameraSize/cameraAngle/cameraMovement/compositionNotes 及 actionBeats/emotionTarget 无对应列（shots 表只有 camera_plan_json/performance_notes）| 定义 camera_plan_json 内部 schema（枚举键名与取值），明确各字段落哪个 JSON`
- `[3/6] P1 | 全 spec 未提乐观锁：§9.3 保存 shot、§10.3 keyframe、§12 确认场均未携带 version（adr-003 §5 要求 PATCH /shots、/keyframes、/scenes 必带）| 补 version 入参与冲突态`
- `[3/7] P1 | §12.3"修改 shot 状态回退 draft"未定义触发范围，以及如何驱动下游 Prompt 进入 source_outdated（state-machine §8.6 要求传播）| 明确触发条件 + 通过 shots.version 变更驱动 PromptSpec.source_version_snapshot 比较形成传播链`
- `[7] P1 | 与 navigation §6.2 回跳握手缺失：Prompt Center 回跳带 keyframeId + returnTo=prompt_center，本 spec 未定义接收上下文、定位 keyframe、提供"返回 Prompt 中心"入口 | 补上下文接收与回跳入口`
- `[1] P1 | §3"选择集和场"中"选择集"无实现规格（§6 顶部栏仅切上/下一场，无 episode 切换器）| 明确 episode 是否可切换，否则修正措辞`
- `[6] P1 | §12 分镜校验自身失败、§8.7 AI 生成失败、§11.4 continuity suggest 失败均无错态 | 补三类异步动作失败态与重试，对齐 adr-004`
- `[8] P1 | continuity ok/warning/error 判定规则未定义（§11.6 仅举例）| 定义校验规则集与产出方（storyboard validate? review service?）`
- `[4/7] P2 | §12"进入 Prompt 中心"未声明携带上下文与定位对象（navigation §5.4 要求 projectId/episodeId/sceneId/shotId）| 明确 sourceEntityRef/选中对象口径`
- `[4] P2 | 编辑已确认场使下游 prompt superseded，§13.3 确认弹窗未提示"此操作将使下游 prompt 过期"二次确认 | 补破坏性提示`
- `[2] P2 | §9.2 shotNo 既可编辑又在 §8.6 拖拽自动重算，且有 UNIQUE(scene_id,shot_no) | 明确是否允许直接编辑，避免与 reorder/唯一约束冲突`
- `[4] P2 | 超多 shot 无虚拟化/分页；start_state_json/end_state_json/handoff_anchor_json 结构未定义 | 补大列表性能策略与起止状态 JSON 结构`

### 5.7 Prompt Center（prompt-center-spec-v1.md）— 需补齐关键细节

- `[2/5] P0 | §8.3 结构化 sections（Image: Subject/Look/Scene/Composition/Continuity 等）无数据契约：PromptSpec 仅存 compiledPrompt(TEXT)+negativePrompt，编译契约也未定义结构化输出 | 在 compiler 输出/PromptSpec 增加 sections_json 契约，否则中央预览只能解析裸文本`
- `[5/8] P1 | 编译同步/异步未定义：data-api TaskType 含 prompt_compile（暗示异步），但本 spec 把编译当同步、无 compiling/进度态 | 明确同步返回 draft 还是异步任务，补加载/进度态`
- `[5] P1 | compile 请求契约缺失：§9.2 compile target/scope(shot/scene/episode)/mode(full/only missing/refresh superseded) 在 data-api §7.6 与编译契约 §15 均无请求体 schema | 定义 POST /api/prompts/compile 请求体`
- `[5] P1 | 端点映射不一致：§19 只列通用 /api/prompts/compile，但 §7.6 另有 compile-image/compile-video/compile-tts；§9.2"编译当前 tab/全部类型"未指明用哪个 | 明确权威端点集并逐 tab/scope 映射`
- `[2/5] P1 | compilerVersion 口径冲突：§8.4/§9.4 视为单字符串，但 compiler-contract §12.1 要求三段版本 | 统一为结构化三段版本或明确编码格式`
- `[2] P1 | §9.4 展示 createdBy，但 prompt_specs 表与 PromptSpec 类型均无该字段 | 补库列+类型，或去除展示`
- `[7] P1 | TTS 源实体口径不清：§12.3 TTS 前置需对白/旁白（场级），端点是 compile-tts（场级），但 §7 source tree 以 shot/keyframe 为中心 | 明确 TTS 绑定的 source entity 层级及各 tab 可用性`
- `[1/4] P1 | 各 source entity 类型下 tab 可用性未定义：§8.2 恒显三 tab，但 keyframe 无 video/tts、非 shot 无 video | 定义 sourceEntityType→可用 tab 前置矩阵`
- `[4/5] P1 | §14.2 未定义"编译"按钮启用条件；§12 前置（look/角色/keyframe 齐备）未与按钮态绑定 | 补编译按钮启用/置灰规则`
- `[3/7] P1 | 派生态词表未收口：state-machine §9.2 定义 source_outdated/model_unbound/ready_to_confirm/ready_to_produce/blocked，本 spec §6.2 未纳入、§16 用零散空错态替代 | 显式引用统一派生态字典`
- `[6/7] P1 | §16.4 source 过期仅给"重新编译"，缺 navigation §6.2"回跳分镜修复"入口；source_outdated 检测规则（version 快照对比）未定义 | 补回跳入口+明确版本快照对比算法`

### 5.8 Production Hub（production-hub-spec-v1.md）— 基本可实现·待补少量

> 核心任务生命周期（创建/列表/详情/重试/取消/日志/产物）与 job-orchestrator §8/§13/§14 状态机、data-api §7.8 基本对齐，无 P0；缺口集中在字段来源、反查上下文与实时映射。

- `[7] P1 | §11.1 动作栏缺 navigation §5.6 的 Production Hub→Review/Export 主链入口 | 补下游进入动作并携带 scopeType/scopeRef、sourceRefs/artifactRefs`
- `[2/6] P1 | §9.7 lastErrorCode 无持久来源：generation_tasks 仅 error_message、无 error_code 列 | 明确取自 task_log payload 还是失败信封并定义映射`
- `[2] P1 | §9.7 日志行 retryable 在数据层不存在（task_logs/TaskLog 均无）| 补字段或改为按 eventType/errorCode 派生`
- `[7] P1 | §9.3/§17.2 反查 prompt 未携带 navigation §6.1 的 taskId + returnTo=production_hub，未定义"返回来源页"入口 | 补上下文参数与回跳`
- `[4/6] P1 | §9.8 展示 artifact.status 但未枚举 ready/deleted/broken 与 path_missing；§16.3 只覆盖"预览失败" | 补 path_missing/broken 独立态与"回生产重建"动作`
- `[5/4] P1 | §15.2 仅说"SSE 失败回退轮询"，未把 adr-002 §5 的 task.status.changed/task.log.appended/artifact.created 映射到区块，也未描述"先拉快照再订阅" | 补主题-区块映射与快照优先`
- `[2/8] P1 | §6.2 顶部统计对应 GET /dashboard-metrics，但响应结构未定义、派生口径缺失 | 补响应 schema 与计算口径`
- `[1/8] P1 | §7.1 将 compose_export 列为可筛选 taskType，但 §12 Create Task Modal 只支持从 confirmed prompt 创建 | 明确 compose_export 由 Export Center 经 Job Orchestrator 创建的路径`
- `[3] P2 | §14"failed 不能再次取消"与 job-orchestrator §8.2"failed→cancelled(可选)"分歧 | 统一取消合法态`
- `[3/4] P2 | Cancel Task Modal 展示"是否已存在部分产物"，但取消后部分 artifact 去留/清理未定义 | 补部分产物处置`
- `[2] P2 | §8.3 列 usage 如何展示未定义；promptSpecVersion/modelProfileName/sourceEntityLabel 为 join 派生未标注来源 | 标注派生来源与展示形态`
- `[4] P2 | 任务列表 loading/骨架态未定义 | 补列表加载态`
- `[7] P2 | navigation §5.6 用"任务进入 ready"与状态机 succeeded 不一致 | 统一 navigation 措辞`

### 5.9 Review Center（review-center-spec-v1.md）— 需补齐关键细节

- `[5/3] P0 | §7.2 reviewRunId 运行后回填、§6.2 latestReviewRunId，但 data-api §7.10 只有 POST /api/reviews/run，无 review-run 状态查询端点；adr-002 §7 要求"先拉快照" | 补 GET /api/review-runs/:id（或明确 SSE-only + 快照来源），否则 run→结果回显闭环断裂`
- `[4/5] P1 | 全文无实时更新章节，但 adr-002 §5 定义 review.run.finished/review.issue.changed | 补 SSE+轮询兜底`
- `[3/4] P1 | ReviewRun.status=queued/running/succeeded/failed，但 §17 只有"运行失败"错态 | 补运行中态与完成回显`
- `[2] P1 | §6.2 warningCount 与 severity 枚举不一致（severity=low/medium/high/critical，无 warning）| 明确 warningCount 对应哪些 severity 或改名`
- `[2/4] P1 | §6.2 blockingSummary / §6.3"只看阻塞"未定义"阻塞"阈值 | 明确 critical-only 还是 high+critical`
- `[3] P1 | §18.3"同类问题仍存在→reopened"未说明是自动 reopen 已 resolved 还是新建 issue | 补 reopen/dedup 规则`
- `[7] P1 | §9.5 五个跳转按钮未携带 navigation §6.3 的 scopeRef + returnTo=review_center，也未定义各按钮用 issue 定位哪个 ID | 补上下文映射与回跳`
- `[4] P2 | §11.3"reopen 建议填原因"但无 Reopen Modal | 补 Reopen 确认交互`
- `[5] P2 | §8.4 list filters 无 reviewRunId，无法支撑 §6.3"打开最近一次审查结果" | 补 reviewRunId 筛选`
- `[4] P2 | 大量 issue 下无批量 resolve/ignore | 补批量操作`
- `[2] P2 | §8 缺 severity 显示/配色规则 | 补 severity 视觉规则`
- `[2] P2 | §15 ignoreReason 必填但无长度/格式校验 | 补校验约束`

### 5.10 Export Center（export-center-spec-v1.md）— 需补齐关键细节

- `[3/5] P0 | job-orchestrator §6/§10.5 把 compose_export/打包导出列为 taskType 与 Compose Worker 职责，但 Export §2"不负责修复任务失败"，未说明创建导出是否经 Job Orchestrator 生成 compose_export 任务、export_bundle.status 与底层 task.status 如何联动 | 明确编排链路与状态映射`
- `[4/5] P1 | §17.1"等待导出完成"无 SSE/轮询机制；adr-002 §5 事件表无导出专用事件 | 补导出进度来源（复用 task.status.changed 或新增 export 事件）`
- `[2] P1 | export_bundles.version NOT NULL，但 §7.2 只有 versionLabel，未说明必填 version 如何生成 | 补 version 生成规则`
- `[2] P1 | manifest 存在 §9.3 与 §15.1 两套列表，data-api manifest 为 Record<string,unknown>，§18 要求"完整可追溯" | 定义 manifest 的 TS 类型/JSON schema`
- `[4/6] P1 | §7.3 要求存在可用 artifact，但未定义 create 前按 §6.1 做 path_missing 预检并阻断 | 补创建前预检与错误码`
- `[7] P1 | §7.5/§17.2 返回生产中心未携带 navigation §6.4 的 sourceRefs/artifactRefs + returnTo=export_center | 补上下文参数与回跳`
- `[3] P2 | §13 重试导出未说明新建 export_bundle 还是原地重跑，与 §14.2"同一 versionLabel 再导出提示"关系未理清 | 明确 retry 语义`
- `[6] P2 | §17.2 只描述"文件写入失败"现象，未映射 adr-004 具体 code，失败后半成品清理未定义 | 补错误码与清理策略`
- `[2/4] P2 | §6.2 概览无 queued/running 计数，进行中导出不可见 | 补在途导出计数`
- `[4] P2 | §14.2"同一 versionLabel 再导出"未定义覆盖确认弹窗 | 补覆盖确认交互`
- `[4] P2 | 列表加载态、导出中断（应用关闭后恢复）未定义 | 补加载态与中断恢复`
- `[7] P2 | 从 Production Hub 进入（携带 sourceRefs/artifactRefs）如何预填导出配置未描述 | 补入参预填逻辑`

## 6. 附：评审方法说明

- 本报告由 4 组并行深度评审汇总（入口与总览层 / 事实层 / 生产核心 / 执行闭环），每组按第 1 节统一 rubric 逐模块核对，并交叉验证 data-and-api、page-state-machine、navigation-matrix 与各契约/ADR 文档。
- 缺口引用尽量精确到 §章节号或字段名，便于逐条落实到 spec 修订与 `data-and-api-v1.md` 的表/端点补充。

## 7. 收口状态（已按 §4 顺序完成文档整改）

本报告识别的缺口已在一轮文档整改中收口，进入实现前无遗留 P0：

- 第 1 步（3 个核心口径）：已由 `adr-006-core-scope-decisions-v1.md` 钉死——故事确认作用域（分集级权威 + 项目级派生 rollup）、keyframe 门禁（可生产 shot 一律 start+end 且 confirmed）、Export 编排（compose_export 任务驱动 bundle 状态），并回写 `data-and-api`、`page-state-machine`、`navigation-matrix`、`prompt-compiler-contract`、`job-orchestrator-contract` 及相关 spec。
- 第 2 步（P0 无接口/无落库）：`data-and-api-v1.md` 已补 Setup 输出规格/模型策略/创作约束落库字段、scene 冲突字段、Prompt 结构化 `sections`、task `error_code`、export `compose_task_id`，以及故事完整性检查/单集确认/集 reorder、剧本快照 GET/restore、对白与动作块 CRUD、review-run 状态查询、style-guide 创建等缺失端点，并补齐 Dashboard 9 阶段派生规则。
- 第 3 步（横切规范）：乐观锁（adr-003）、错误信封（adr-004）、实时更新（adr-002）已通过 `data-and-api` §7.12 统一贯穿，并在 10 个模块 spec 的接口/错态/实时区块逐条引用。
- 第 4 步（P1/P2）：各模块 spec 已按本报告 §5 清单补齐字段级完整性、交互态、边界与跨模块上下文携带（本轮又经一次独立复核发现并补齐若干残留 P1/P2，详见 §8）。
- 结论：本报告 §2「0 个模块可直接实现」的判断已随整改失效；文档基线已达可进入实现状态，实现前以 `adr-006` 与 `data-and-api-v1.md` 为唯一契约地基。

## 8. 第二轮独立复核与 P1/P2 收口（本轮）

在上述 §7 收口基础上，又做了一次只读独立复核（重新取证，不凭记忆），确认 P0 无遗留，但发现若干 **P1/P2 级残留缺口**，并已逐项收口：

- **ReviewRun 状态词表三方冲突（P1）**：`data-and-api`、`review-center-spec`、`page-state-machine` 三处混用 `pending/running/passed/failed`，语义轴不清。**已收口**：拆分为正交的 `ReviewRunStatus`（`queued/running/succeeded/failed`，run 执行生命周期）与 `ReviewRunVerdict`（`passed/blocked`，审查结论）；`review_runs` 表补 `status`/`verdict` 两列；`review-center-spec §7.6` 与 `page-state-machine` 派生态（`has_blocking_issues`/`empty_clean`/`needs_rerun`/`run_failed`）同步对齐。
- **同一端点两套响应 schema（P1）**：`validate-setup`、`preview-impact`、`completeness-check`、`storyboard/validate`、model profile 等端点在模块 spec 与 data-api 各写一套。**已收口**：新增 `data-and-api-v1.md §6.3` 作为响应契约唯一权威（`ProjectSetupValidationResult`/`ProjectSetupImpactResult`/`StoryCompletenessResult`/`StoryboardValidateResult`/`ModelProfileView`/`ModelCredentialTestResult`），各模块 spec 改为引用注释；并在 `adr-006 §4.2` 澄清其只约束 `storyboard/validate` 的 `keyframeGate` 子集。
- **文本 / LLM 任务口径不清（P1）**：`story_generate`/`prompt_compile` 等文本任务的 PromptSpec 来源与任务入口归属未定。**已收口**：`PromptTargetType` 增加 `text`；新增 `data-api §8.6` 与 `prompt-compiler-contract` 说明——文本任务仍走 Prompt Compiler（系统模板 + 事实层自动编译，不进 Prompt Center 手工编辑）；Production Hub 创建 modal 仅允许 `image_generate/video_generate/tts_generate`，文本/系统任务只读展示。
- **模型配置与密钥管理无模块 owner（P1）**：`model_profiles` 与密钥 UI 无承接页。**已收口**：新增 `model-settings-spec-v1.md` 作为全局设置页，承接 profile 增删改查、启用/停用、密钥绑定/测试/解绑/删除保护，严格遵循 `adr-001`（SQLite 只存引用键、原始 key 进 OS Keychain、UI 不回显完整 key）；`data-api §7.7` 扩展相应端点，Prompt Center 候选列表来源指向本页。
- **回跳上下文单向落地（P1/S8 收尾）**：`returnTo` 此前多为发起侧有、接收侧缺。**已收口**：接收侧全部补齐——Story Workspace §11.3、Asset Ledger §17.3、Storyboard Studio §6.3.2、Prompt Center §6.3.1、Production Hub §9.3.1，并在 `navigation-matrix` §6.1/§6.3/§6.4 登记已落地接收方，形成双向闭环。
- **核心 JSON blob 仍为黑盒（P1/S6 收尾）**：**已收口**：StoryBible 各子对象（`WorldRulesJson`/`CharacterRelationsJson`/`VillainSystemJson`/`PacingPlanJson`/`HookSystemJson`）、`ReviewEvidence`、`ScriptSnapshotPayload`、`ActivityTargetRef`/`ActivityPayload` 由 `Record<string, unknown>` 改为命名 TS 结构，`data-api §6` 为唯一权威。
- **首屏加载态缺失（P2）**：五个编辑/审查页缺结构化 skeleton 描述。**已收口**：Story Workspace §14.5、Script Editor §15.5、Asset Ledger §16.6、Storyboard Studio §16.6、Review Center §18.5 统一补充首屏骨架态、局部刷新不清空、加载失败走错态重试的规范。
- **结论（客观修订）**：文档层面 P0 已收口、本轮 P1/P2 亦已收口，架构 / 交互 / 需求细节达到「P1/P2 收口后可进入实现」状态。这不等于零风险——实现过程中若暴露新的口径缺口，仍以对应 spec + `data-and-api-v1.md` 为唯一权威回写，不在代码里另立事实。
