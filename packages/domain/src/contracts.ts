/**
 * API response contract types + derived-state contracts.
 * Authority: data-and-api-v1.md §6.2 (derived state) and §6.3 (response contracts).
 * Module specs describe display/interaction only and must reference these shapes.
 */

import type { Id, IsoTime } from "./primitives.js";
import type { ModelType } from "./enums.js";

// ===== §6.3 API 响应契约类型 =====

/** POST /api/projects/:projectId/validate-setup (project-setup §16.2). */
export interface ProjectSetupValidationResult {
  status: "ok" | "warning" | "error";
  items: Array<{
    field: string;
    level: "warning" | "error";
    code: string;
    message: string;
  }>;
}

/** POST /api/projects/:projectId/preview-impact (project-setup §16.3). */
export interface ProjectSetupImpactResult {
  affectedModules: string[];
  affectedCounts: Record<string, number>;
  suggestedActions: string[];
}

/** POST /api/projects/:projectId/story/completeness-check (story-workspace §9). */
export interface StoryCompletenessResult {
  ready: boolean;
  projectSummary: {
    totalEpisodes: number;
    confirmedEpisodes: number;
    blockingCount: number;
  };
  episodeDetails: Array<{
    episodeId: Id;
    ready: boolean;
    gaps: Array<{
      field: string;
      level: "warning" | "error";
      message: string;
    }>;
  }>;
}

/**
 * POST /api/scenes/:sceneId/storyboard/validate (storyboard-studio §12.2 hard check).
 * Superset of the keyframe gate (adr-006 §4): the gate is only its `keyframeGate` item.
 */
export interface StoryboardValidateResult {
  passable: boolean;
  shots: Array<{
    shotId: Id;
    keyframeGate: {
      producible: boolean;
      hasStartKeyframe: boolean;
      hasEndKeyframe: boolean;
      keyframesConfirmed: boolean;
      blocked: boolean;
    };
    fieldGaps: Array<{ field: string; message: string }>;
    continuityStatus: "ok" | "warning" | "error";
  }>;
}

/** GET /api/model-profiles read model — never contains raw secrets (adr-001 §5.3). */
export interface ModelProfileView {
  id: Id;
  provider: string;
  modelType: ModelType;
  modelName: string;
  isActive: boolean;
  credentialBound: boolean;
  credentialHint?: string;
  lastVerifiedAt?: IsoTime;
  defaultParams: Record<string, unknown>;
}

/** POST /api/model-profiles/:id/credential/test response. */
export interface ModelCredentialTestResult {
  ok: boolean;
  verifiedAt?: IsoTime;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

/** POST /api/scenes/:sceneId/validate — script structure check (script-editor §9.1). */
export interface SceneValidateResult {
  status: "ok" | "warning" | "error";
  items: Array<{
    check: string;
    level: "warning" | "error";
    code: string;
    message: string;
    ref?: {
      targetType: "scene" | "dialogue_block" | "action_block" | "character";
      targetId: string;
    };
  }>;
}

/** GET /api/projects/:projectId/dashboard-metrics (project-dashboard §8.3). */
export interface DashboardMetrics {
  tasks: {
    queued: number;
    running: number;
    failed: number;
    succeeded: number;
    cancelled: number;
  };
  cost: {
    todayEstimate: number;
    totalEstimate: number;
    anomalies: Array<{ provider: string; amount: number }>;
  };
  quality: { openIssues: number; criticalIssues: number };
  progress: {
    sceneConfirmedRatio: number;
    shotProducibleRatio: number;
    promptConfirmedRatio: number;
  };
}

// ===== §6.2 派生状态：Dashboard 9 阶段 =====

/** GET /api/projects/:projectId/stage-status per-stage status. */
export type StageStatus = "locked" | "in_progress" | "done" | "blocked";

export type StageKey =
  | "setup"
  | "story_bible"
  | "episodes"
  | "script"
  | "assets"
  | "storyboard"
  | "prompt"
  | "production"
  | "export";

export interface StageStatusItem {
  stage: StageKey;
  order: number;
  stageStatus: StageStatus;
}

export interface StageStatusResult {
  stages: StageStatusItem[];
}

/** Project-level story rollup (adr-006 §3), derived (not persisted). */
export type ProjectStoryStatus = "draft" | "partial" | "confirmed";
