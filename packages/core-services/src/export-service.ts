/**
 * ExportService — Export Center orchestration
 * (export-center-spec-v1.md, data-and-api-v1.md §10 step 10).
 *
 * Owns the `export_bundles` lifecycle end-to-end:
 *  - `createExport`: gated by `blocked_by_issue` (Review §12.4). Creates a
 *    bundle in `queued` and a paired `compose_export` GenerationTask via
 *    JobOrchestrator; wires `composeTaskId` on the bundle. `version` is
 *    generated per project + bundleType sequence (spec §7.7).
 *  - `startCompose` / `completeCompose` / `failCompose` / `cancelCompose`:
 *    thin wrappers on JobOrchestrator whose status mapping drives the bundle
 *    (adr-006 §5, spec §14.3). `completeCompose` additionally persists the
 *    export payload (`outputPath` / `manifest` / `bundleSizeBytes`) and creates
 *    a bundle Artifact for downstream reference (spec §14.3).
 *  - `retryExport`: allowed only from `failed` (spec §14.2). Spawns a NEW
 *    `compose_export` task and resets the bundle back to `queued`. The prior
 *    task id is preserved via `retryOfTaskId` on the new task, ensuring the
 *    lineage remains observable.
 *
 * NOTE: manifest content is authored by the caller (compose engine, out of
 * core-services scope). ExportService merely persists it and enforces the
 * transactional payload write on `succeeded`.
 */

import type {
  ExportBundle,
  ExportManifest,
  GenerationTask,
  ApiErrorCode,
  Id,
} from "@dramaflow/domain";
import { missingResource, invalidState } from "@dramaflow/domain";
import { BaseService, type ServiceContext } from "./context.js";
import {
  JobOrchestratorService,
  type CompleteJobResult,
} from "./job-orchestrator-service.js";
import { ReviewService } from "./review-service.js";

const nowIso = (): string => new Date().toISOString();

export interface CreateExportInput {
  projectId: Id;
  bundleType: string;
  scopeType?: string;
  scopeRefId?: Id;
  versionLabel?: string;
  modelProfileId?: Id;
  inputPayload?: Record<string, unknown>;
  /** Skip Review Center blocking-issue gate (default false; only use for ops). */
  skipReviewGate?: boolean;
}

export interface CompleteExportInput {
  outputPath: string;
  manifest: ExportManifest;
  bundleSizeBytes?: number;
}

export interface FailExportInput {
  errorCode: ApiErrorCode;
  errorMessage: string;
}

export class ExportService extends BaseService {
  private readonly jobs: JobOrchestratorService;
  private readonly reviews: ReviewService;

  constructor(
    ctx: ServiceContext,
    deps?: { jobs?: JobOrchestratorService; reviews?: ReviewService },
  ) {
    super(ctx);
    this.jobs = deps?.jobs ?? new JobOrchestratorService(ctx);
    this.reviews = deps?.reviews ?? new ReviewService(ctx);
  }

  createExport(input: CreateExportInput): ExportBundle {
    return this.repos.transaction(() => {
      if (!this.repos.projects.getById(input.projectId)) {
        throw missingResource(`项目不存在：${input.projectId}`, {
          projectId: input.projectId,
        });
      }
      if (!input.skipReviewGate) this.reviews.assertNoBlockingIssues(input.projectId);

      const version = this.nextVersion(input.projectId, input.bundleType);
      const bundle = this.repos.exportBundles.create({
        projectId: input.projectId,
        bundleType: input.bundleType,
        version,
        versionLabel: input.versionLabel,
        scopeType: input.scopeType,
        scopeRefId: input.scopeRefId,
        outputPath: "",
        manifest: this.emptyManifest(input, version),
        status: "queued",
      });

      const task = this.jobs.createJob({
        projectId: input.projectId,
        taskType: "compose_export",
        sourceEntityType: "export_bundle",
        sourceEntityId: bundle.id,
        modelProfileId: input.modelProfileId,
        inputPayload: input.inputPayload ?? {},
      });
      const linked = this.repos.exportBundles.update(bundle.id, {
        composeTaskId: task.id,
      });
      this.logActivity({
        projectId: bundle.projectId,
        eventType: "export.created",
        summary: `创建导出：${bundle.bundleType} ${version}`,
        targetRef: { entityType: "export_bundle", entityId: bundle.id },
        payload: {
          toStatus: "queued",
          extra: { bundleType: bundle.bundleType, version, composeTaskId: task.id },
        },
      });
      return linked;
    });
  }

  /** queued -> running via compose task (spec §14.3). */
  startCompose(bundleId: Id): { bundle: ExportBundle; task: GenerationTask } {
    return this.repos.transaction(() => {
      const bundle = this.getOrThrow(bundleId);
      const task = this.jobs.startJob(this.getComposeTaskId(bundle));
      return { bundle: this.getOrThrow(bundleId), task };
    });
  }

  /**
   * running -> ready (spec §14.3). Same transaction:
   *  1. jobs.completeJob(task) → task succeeded, bundle status flipped to ready
   *     by orchestrator's mapping, plus caller-supplied artifacts recorded
   *  2. Persist `outputPath` / `manifest` / `bundleSizeBytes` / `finishedAt`
   *  3. Create a `bundle` artifact pointing at `outputPath` for downstream ref
   */
  completeCompose(bundleId: Id, input: CompleteExportInput): ExportBundle {
    return this.repos.transaction(() => {
      const bundle = this.getOrThrow(bundleId);
      const taskId = this.getComposeTaskId(bundle);
      const result: CompleteJobResult = { outputPayload: { outputPath: input.outputPath } };
      this.jobs.completeJob(taskId, result);
      const finalized = this.repos.exportBundles.update(bundleId, {
        outputPath: input.outputPath,
        manifest: input.manifest,
        bundleSizeBytes: input.bundleSizeBytes,
        finishedAt: nowIso(),
      });
      this.repos.artifacts.create({
        projectId: bundle.projectId,
        artifactType: "bundle",
        sourceTaskId: taskId,
        sourceEntityType: "export_bundle",
        sourceEntityId: bundle.id,
        filePath: input.outputPath,
        metadata: {
          bundleType: bundle.bundleType,
          version: bundle.version,
          bundleSizeBytes: input.bundleSizeBytes,
        },
        status: "ready",
      });
      this.logActivity({
        projectId: bundle.projectId,
        eventType: "export.ready",
        summary: `导出就绪：${bundle.bundleType} ${bundle.version}`,
        targetRef: { entityType: "export_bundle", entityId: bundle.id },
        payload: { toStatus: "ready", extra: { outputPath: input.outputPath } },
      });
      return finalized;
    });
  }

  /** queued|running -> failed (spec §14.3). Failure comes through the task. */
  failCompose(bundleId: Id, input: FailExportInput): ExportBundle {
    return this.repos.transaction(() => {
      const bundle = this.getOrThrow(bundleId);
      const taskId = this.getComposeTaskId(bundle);
      this.jobs.failJob(taskId, input);
      // JobOrchestrator maps compose_export failed → bundle failed + errorMessage.
      return this.getOrThrow(bundleId);
    });
  }

  /** queued|running -> failed via cancel (spec §14.3: cancelled视为导出中止). */
  cancelCompose(bundleId: Id): ExportBundle {
    return this.repos.transaction(() => {
      const bundle = this.getOrThrow(bundleId);
      const taskId = this.getComposeTaskId(bundle);
      this.jobs.cancelJob(taskId);
      return this.getOrThrow(bundleId);
    });
  }

  /**
   * Retry a failed export (spec §14.2): spawns a fresh `compose_export` task,
   * resets the bundle to `queued`, and re-wires `composeTaskId`. The prior
   * task id lineage is preserved via `retryOfTaskId` on the new task.
   */
  retryExport(bundleId: Id): ExportBundle {
    return this.repos.transaction(() => {
      const bundle = this.getOrThrow(bundleId);
      if (bundle.status !== "failed") {
        throw invalidState(
          `导出状态「${bundle.status}」不允许重试（仅 failed 可重试）`,
          { bundleId, status: bundle.status },
        );
      }
      const priorTaskId = bundle.composeTaskId;
      const retryTask = this.jobs.retryJob(this.getComposeTaskId(bundle));
      const reset = this.repos.exportBundles.update(bundleId, {
        status: "queued",
        composeTaskId: retryTask.id,
        errorMessage: undefined,
      });
      this.logActivity({
        projectId: bundle.projectId,
        eventType: "export.retried",
        summary: `重试导出：${bundle.bundleType} ${bundle.version}`,
        targetRef: { entityType: "export_bundle", entityId: bundle.id },
        payload: {
          fromStatus: "failed",
          toStatus: "queued",
          extra: { priorTaskId, retryTaskId: retryTask.id },
        },
      });
      return reset;
    });
  }

  // ===== Reads =====

  getBundle(id: Id): ExportBundle | null {
    return this.repos.exportBundles.getById(id);
  }

  listBundles(projectId: Id): ExportBundle[] {
    return this.repos.exportBundles.listByProject(projectId);
  }

  // ===== internal helpers =====

  private getOrThrow(id: Id): ExportBundle {
    const b = this.repos.exportBundles.getById(id);
    if (!b) throw missingResource(`导出包不存在：${id}`, { id });
    return b;
  }

  private getComposeTaskId(bundle: ExportBundle): Id {
    if (!bundle.composeTaskId) {
      throw invalidState(`导出包尚未绑定 compose 任务：${bundle.id}`, {
        bundleId: bundle.id,
      });
    }
    return bundle.composeTaskId;
  }

  private nextVersion(projectId: Id, bundleType: string): string {
    const count = this.repos.exportBundles
      .listByProject(projectId)
      .filter((b) => b.bundleType === bundleType).length;
    return `v${count + 1}`;
  }

  private emptyManifest(input: CreateExportInput, version: string): ExportManifest {
    return {
      bundleType: input.bundleType,
      version,
      createdAt: nowIso(),
      scope: {
        scopeType: input.scopeType ?? "project",
        scopeRefId: input.scopeRefId,
      },
      includedFiles: [],
      sourceRefs: [],
      artifactRefs: [],
      promptRefs: [],
      reviewRefs: [],
      counts: {
        includedArtifactsCount: 0,
        includedPromptCount: 0,
        includedReviewIssueCount: 0,
      },
    };
  }
}
