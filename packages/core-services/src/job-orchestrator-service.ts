/**
 * JobOrchestratorService — the single entry for the execution layer
 * (job-orchestrator-contract-v1.md, data-and-api-v1.md §10 step 7).
 *
 * Owns the GenerationTask state machine, retry/cancel, task logging, and artifact
 * writeback. It never compiles prompts, never mutates story/asset/storyboard facts,
 * and never performs provider protocol adaptation (contract §2/§4.2).
 *
 * State machine (contract §8): queued -> running -> succeeded|failed;
 * queued|running -> cancelled; failed -> (retry creates a NEW task).
 * `generation_tasks` is not optimistic-locked — transitions go through
 * `updateStatus` (adr-003 §6).
 *
 * NOTE: methods are synchronous, matching the sync better-sqlite3 stack. The
 * contract's Promise-typed interface is honored by the async HTTP layer wrapping
 * these calls; success/failure are delivered here via explicit callback methods
 * (completeJob / failJob), which is the contract's callback model.
 */

import type {
  GenerationTask,
  TaskLog,
  ArtifactType,
  TaskType,
  TaskStatus,
  ApiErrorCode,
  ExportBundle,
  ExportBundleStatus,
  EntityPatch,
  TaskPollProfile,
  Id,
} from "@dramaflow/domain";
import { missingResource, invalidState, DomainError } from "@dramaflow/domain";
import { BaseService } from "./context.js";

const nowIso = (): string => new Date().toISOString();

export interface CreateJobInput {
  projectId: Id;
  taskType: TaskType;
  sourceEntityType: string;
  sourceEntityId: Id;
  promptSpecId?: Id;
  modelProfileId?: Id;
  priority?: number;
  inputPayload?: Record<string, unknown>;
}

export interface CompleteJobResult {
  outputPayload?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  costEstimate?: number;
  artifacts?: Array<{
    artifactType: ArtifactType;
    filePath: string;
    previewPath?: string;
    metadata?: Record<string, unknown>;
    sourceEntityType?: string;
    sourceEntityId?: Id;
  }>;
}

export interface FailJobInput {
  /** Standard error code, aligned with adr-004 §4. */
  errorCode: ApiErrorCode;
  errorMessage: string;
}

export class JobOrchestratorService extends BaseService {
  /** Create + enqueue a task (contract §11). */
  createJob(input: CreateJobInput): GenerationTask {
    return this.repos.transaction(() => {
      if (!this.repos.projects.getById(input.projectId)) {
        throw missingResource(`项目不存在：${input.projectId}`, { projectId: input.projectId });
      }
      if (input.promptSpecId && !this.repos.promptSpecs.getById(input.promptSpecId)) {
        throw missingResource(`PromptSpec 不存在：${input.promptSpecId}`, {
          promptSpecId: input.promptSpecId,
        });
      }
      if (input.modelProfileId && !this.repos.modelProfiles.getById(input.modelProfileId)) {
        throw missingResource(`模型档案不存在：${input.modelProfileId}`, {
          modelProfileId: input.modelProfileId,
        });
      }
      const task = this.repos.generationTasks.create({
        projectId: input.projectId,
        taskType: input.taskType,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        promptSpecId: input.promptSpecId,
        modelProfileId: input.modelProfileId,
        status: "queued",
        priority: input.priority ?? 0,
        retryCount: 0,
        inputPayload: input.inputPayload ?? {},
        outputPayload: {},
        usage: {},
      });
      this.log(task.id, "task.created", `任务入队：${task.taskType}`, { status: "queued" });
      this.logActivity({
        projectId: task.projectId,
        eventType: "task.created",
        summary: `创建任务 ${task.taskType}`,
        targetRef: { entityType: "task", entityId: task.id },
        payload: { extra: { taskType: task.taskType } },
      });
      return task;
    });
  }

  /** queued -> running (contract §8). */
  startJob(taskId: Id): GenerationTask {
    return this.repos.transaction(() => {
      const task = this.getOrThrow(taskId);
      this.assertStatus(task, ["queued"], "开始执行");
      const updated = this.repos.generationTasks.updateStatus(taskId, {
        status: "running",
        startedAt: nowIso(),
      });
      this.log(taskId, "task.started", "任务开始执行", {});
      return updated;
    });
  }

  /** running -> succeeded, with artifact writeback (contract §12.3). */
  completeJob(taskId: Id, result: CompleteJobResult = {}): GenerationTask {
    return this.repos.transaction(() => {
      const task = this.getOrThrow(taskId);
      this.assertStatus(task, ["running"], "完成");
      const updated = this.repos.generationTasks.updateStatus(taskId, {
        status: "succeeded",
        outputPayload: result.outputPayload ?? {},
        usage: result.usage ?? {},
        costEstimate: result.costEstimate,
        finishedAt: nowIso(),
        durationMs: this.durationSince(task.startedAt),
      });
      for (const a of result.artifacts ?? []) {
        this.repos.artifacts.create({
          projectId: task.projectId,
          artifactType: a.artifactType,
          sourceTaskId: task.id,
          sourceEntityType: a.sourceEntityType ?? task.sourceEntityType,
          sourceEntityId: a.sourceEntityId ?? task.sourceEntityId,
          filePath: a.filePath,
          previewPath: a.previewPath,
          metadata: a.metadata ?? {},
          status: "ready",
        });
      }
      if (task.taskType === "compose_export") this.markExportBundle(task, "ready");
      this.log(taskId, "task.succeeded", "任务成功", {
        artifacts: (result.artifacts ?? []).length,
      });
      return updated;
    });
  }

  /** queued|running -> failed; preserves input context for retry (contract §12.2). */
  failJob(taskId: Id, error: FailJobInput): GenerationTask {
    return this.repos.transaction(() => {
      const task = this.getOrThrow(taskId);
      this.assertStatus(task, ["queued", "running"], "标记失败");
      const updated = this.repos.generationTasks.updateStatus(taskId, {
        status: "failed",
        errorCode: error.errorCode,
        errorMessage: error.errorMessage,
        finishedAt: nowIso(),
        durationMs: this.durationSince(task.startedAt),
      });
      if (task.taskType === "compose_export") {
        this.markExportBundle(task, "failed", error.errorMessage);
      }
      this.log(taskId, "task.failed", error.errorMessage, { errorCode: error.errorCode });
      return updated;
    });
  }

  /** Explicit retry: keep original, create a new task with retryCount+1 (contract §13). */
  retryJob(taskId: Id): GenerationTask {
    return this.repos.transaction(() => {
      const task = this.getOrThrow(taskId);
      if (task.status !== "failed") {
        throw new DomainError({
          code: "task_not_retryable",
          message: `任务状态 ${task.status} 不可重试（仅 failed 可重试）`,
          details: { taskId, status: task.status },
        });
      }
      const retry = this.repos.generationTasks.create({
        projectId: task.projectId,
        taskType: task.taskType,
        sourceEntityType: task.sourceEntityType,
        sourceEntityId: task.sourceEntityId,
        promptSpecId: task.promptSpecId,
        modelProfileId: task.modelProfileId,
        status: "queued",
        priority: task.priority,
        retryCount: task.retryCount + 1,
        retryOfTaskId: task.id,
        inputPayload: task.inputPayload,
        outputPayload: {},
        usage: {},
      });
      this.log(retry.id, "task.retry", `重试自任务 ${task.id}`, {
        retryOfTaskId: task.id,
        retryCount: retry.retryCount,
      });
      return retry;
    });
  }

  /** queued|running -> cancelled (contract §8). */
  cancelJob(taskId: Id): GenerationTask {
    return this.repos.transaction(() => {
      const task = this.getOrThrow(taskId);
      this.assertStatus(task, ["queued", "running"], "取消");
      const updated = this.repos.generationTasks.updateStatus(taskId, {
        status: "cancelled",
        finishedAt: nowIso(),
        durationMs: this.durationSince(task.startedAt),
      });
      this.log(taskId, "task.cancelled", "任务已取消", {});
      return updated;
    });
  }

  /**
   * A2 一体化入队 + 后台执行 helper。
   *
   * Web 端「拆段落 / 重新生成本篇故事 / 追加生成故事」这类 LLM 长耗时操作，
   * 前端不再等 HTTP，而是：
   *   1. HTTP 立即返回 `{ taskId }`（202）
   *   2. 前端轮询 `GET /jobs/:id` 直到 `succeeded|failed|cancelled`
   *
   * 该方法：
   *   - 同步创建 `generation_tasks` 行（`queued`）；
   *   - 通过 `setImmediate` 在下一 tick 后台执行 `worker`；
   *   - worker 抛错时自动 failJob；正常返回时 completeJob（outputPayload = worker 返回值）。
   *
   * 注意：由于本地跑在同一个 Node 进程，若进程崩溃仍在 running 的任务会停留在
   * 「running」状态，服务重启后需要外部 sweeper 补偿；MVP 阶段暂不处理。
   */
  enqueueAndRun<T extends Record<string, unknown>>(
    input: CreateJobInput,
    worker: (task: GenerationTask) => Promise<T | void>,
  ): GenerationTask {
    const task = this.createJob(input);
    setImmediate(async () => {
      try {
        this.startJob(task.id);
      } catch (err) {
        // startJob 失败一般是状态被改（比如取消）—— 直接放弃执行。
        this.log(task.id, "task.start.skipped", (err as Error).message, {});
        return;
      }
      try {
        const out = await worker(task);
        this.completeJob(task.id, { outputPayload: out ?? {} });
      } catch (err) {
        // 尽量保留 DomainError code；否则统一按 provider_unavailable 记录，便于前端展示。
        const domain = err as { code?: string; message?: string };
        const errorCode = (domain?.code as ApiErrorCode | undefined) ?? "provider_unavailable";
        const errorMessage = domain?.message ?? String(err);
        try {
          this.failJob(task.id, { errorCode, errorMessage });
        } catch (failErr) {
          this.log(task.id, "task.fail.error", (failErr as Error).message, {});
        }
      }
    });
    return task;
  }

  // ===== reads =====

  getJob(id: Id): GenerationTask | null {
    return this.repos.generationTasks.getById(id);
  }

  listJobs(projectId: Id): GenerationTask[] {
    return this.repos.generationTasks.listByProject(projectId);
  }

  /**
   * 按来源实体列出任务，前端在页面挂载 / 刷新时用来 resume：
   * 传 `statusIn: ["queued","running"]` 只拉在跑的。
   */
  listJobsBySource(
    sourceEntityType: string,
    sourceEntityId: Id,
    statusIn?: readonly TaskStatus[],
  ): GenerationTask[] {
    return this.repos.generationTasks.listBySource(sourceEntityType, sourceEntityId, statusIn);
  }

  listLogs(taskId: Id): TaskLog[] {
    return this.repos.taskLogs.listByTask(taskId);
  }

  // ===== A1 类型化轮询档案 + 错误分类（参考 huobao-drama POLL_PROFILES） =====

  /**
   * 返回指定任务类型的轮询档案（intervalMs / maxAttempts / retryable / terminal codes）。
   * provider 接入层根据 profile 决定 poll 频次与失败自动重试策略。
   */
  getPollProfile(taskType: TaskType): TaskPollProfile {
    return POLL_PROFILES[taskType] ?? DEFAULT_POLL_PROFILE;
  }

  /**
   * 依据 errorCode 判定错误类别：
   * - "retryable" → 由 orchestrator 自动创建 retry task
   * - "terminal"  → 立即终态，禁止 auto-retry（仍可人工 retry）
   * - "unknown"   → 保底按 terminal 处理（可人工 retry）
   */
  classifyError(taskType: TaskType, errorCode?: string): "retryable" | "terminal" | "unknown" {
    if (!errorCode) return "unknown";
    const p = this.getPollProfile(taskType);
    if (p.retryableCodes.includes(errorCode)) return "retryable";
    if (p.terminalCodes.includes(errorCode)) return "terminal";
    return "unknown";
  }

  /**
   * 便捷入口：失败后按 profile 自动决策是否 auto-retry。
   * 返回 { failed, retried }。若 retried 存在则返回新任务。
   * 仍保留 failJob + retryJob 单独调用能力（无缝兼容）。
   */
  failAndMaybeRetry(
    taskId: Id,
    error: FailJobInput,
  ): { failed: GenerationTask; retried?: GenerationTask } {
    const failed = this.failJob(taskId, error);
    const cls = this.classifyError(failed.taskType, error.errorCode);
    if (cls === "retryable") {
      const retried = this.retryJob(taskId);
      return { failed, retried };
    }
    return { failed };
  }

  // ===== internal =====

  private getOrThrow(id: Id): GenerationTask {
    const task = this.repos.generationTasks.getById(id);
    if (!task) throw missingResource(`任务不存在：${id}`, { id });
    return task;
  }

  private assertStatus(task: GenerationTask, allowed: TaskStatus[], action: string): void {
    if (!allowed.includes(task.status)) {
      throw invalidState(`任务状态「${task.status}」不允许${action}`, {
        taskId: task.id,
        status: task.status,
        allowed,
      });
    }
  }

  private durationSince(startedAt?: string): number | undefined {
    if (!startedAt) return undefined;
    const start = Date.parse(startedAt);
    if (Number.isNaN(start)) return undefined;
    return Math.max(0, Date.now() - start);
  }

  private log(
    taskId: Id,
    eventType: string,
    message: string,
    payload: Record<string, unknown>,
  ): void {
    this.repos.taskLogs.append({ taskId, eventType, message, payload });
  }

  private markExportBundle(
    task: GenerationTask,
    status: ExportBundleStatus,
    errorMessage?: string,
  ): void {
    const bundle = this.repos.exportBundles
      .listByProject(task.projectId)
      .find((b) => b.composeTaskId === task.id);
    if (!bundle) return;
    const patch: EntityPatch<ExportBundle> = { status };
    if (errorMessage !== undefined) patch.errorMessage = errorMessage;
    this.repos.exportBundles.update(bundle.id, patch);
  }
}

// ===== POLL_PROFILES（参考 huobao-drama） =====

/**
 * 每个 task 类型的默认轮询档案。数值参考 huobao-drama 生产实践：
 * - 文本/合成类：5s × 60 = 5 min
 * - 图片：5s × 120 = 10 min
 * - 视频：10s × 300 = 50 min
 * - TTS：3s × 60 = 3 min
 *
 * retryableCodes：网络类瞬时错误，允许 orchestrator 自动 retry。
 * terminalCodes：内容违规/账号异常/参数错误，立即终态，禁止 auto-retry。
 * 其他 error code 默认走 unknown（terminal 处理但保留人工 retry 入口）。
 */
const DEFAULT_POLL_PROFILE: TaskPollProfile = {
  intervalMs: 5000,
  maxAttempts: 60,
  retryableCodes: [
    "provider_network_timeout",
    "provider_rate_limited",
    "provider_unavailable",
    "provider_5xx",
  ],
  terminalCodes: [
    "provider_invalid_request",
    "provider_content_violation",
    "provider_auth_failed",
    "provider_quota_exhausted",
    "blocked_by_issue",
    "validation_failed",
  ],
  note: "默认档案：5s × 60，命中 retryableCodes 自动重试，命中 terminalCodes 立即终态。",
};

const POLL_PROFILES: Record<TaskType, TaskPollProfile> = {
  story_generate: {
    ...DEFAULT_POLL_PROFILE,
    intervalMs: 5000,
    maxAttempts: 60,
    note: "故事生成：文本 LLM，5s × 60 = 5 min。",
  },
  storyboard_generate: {
    ...DEFAULT_POLL_PROFILE,
    intervalMs: 5000,
    maxAttempts: 60,
    note: "分镜生成：文本 LLM，5s × 60 = 5 min。",
  },
  keyframe_generate: {
    ...DEFAULT_POLL_PROFILE,
    intervalMs: 5000,
    maxAttempts: 120,
    note: "关键帧图像：5s × 120 = 10 min。",
  },
  prompt_compile: {
    ...DEFAULT_POLL_PROFILE,
    intervalMs: 3000,
    maxAttempts: 40,
    note: "提示词编译：短流程，3s × 40 = 2 min。",
  },
  image_generate: {
    ...DEFAULT_POLL_PROFILE,
    intervalMs: 5000,
    maxAttempts: 120,
    note: "图像生成：5s × 120 = 10 min。",
  },
  video_generate: {
    ...DEFAULT_POLL_PROFILE,
    intervalMs: 10000,
    maxAttempts: 300,
    note: "视频生成：10s × 300 = 50 min。",
  },
  tts_generate: {
    ...DEFAULT_POLL_PROFILE,
    intervalMs: 3000,
    maxAttempts: 60,
    note: "TTS：3s × 60 = 3 min。",
  },
  compose_export: {
    ...DEFAULT_POLL_PROFILE,
    intervalMs: 5000,
    maxAttempts: 120,
    terminalCodes: [
      ...DEFAULT_POLL_PROFILE.terminalCodes,
      "ffmpeg_failed",
      "assets_missing",
    ],
    note: "合成导出：本地 FFmpeg 主导，5s × 120 = 10 min，ffmpeg_failed 立即终态。",
  },
};

/** Expose for tests / provider-adapter selection. */
export { POLL_PROFILES, DEFAULT_POLL_PROFILE };
