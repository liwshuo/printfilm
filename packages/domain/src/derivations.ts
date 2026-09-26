/**
 * Pure derivation helpers. No side effects, no I/O.
 * Authority: data-and-api-v1.md §6.2, adr-006 §3/§4.
 *
 * NOTE on persistence boundary:
 * - `Episode.storyboardStatus` is a *persisted rollup summary* recomputed inside the same
 *   transaction as scene changes (§6.2). This module only computes the value; the service
 *   decides when to write it.
 * - `projectStoryStatus` and `shotProducible` are *derived* states and are never persisted.
 */

import type { ConfirmStatus } from "./enums.js";
import type { KeyframeSpec } from "./entities.js";
import type { ProjectStoryStatus } from "./contracts.js";

/**
 * Episode storyboard rollup (§6.2):
 * all draft -> draft; all confirmed -> confirmed; mixed -> partial; empty -> draft.
 */
export function computeEpisodeStoryboardRollup(
  sceneStatuses: ConfirmStatus[],
): ConfirmStatus | "partial" {
  if (sceneStatuses.length === 0) return "draft";
  const allConfirmed = sceneStatuses.every((s) => s === "confirmed");
  if (allConfirmed) return "confirmed";
  const allDraft = sceneStatuses.every((s) => s === "draft");
  if (allDraft) return "draft";
  return "partial";
}

/**
 * Project-level story rollup (adr-006 §3):
 * confirmed = >=1 episode and all episodes confirmed; partial = some confirmed; draft = none.
 */
export function computeProjectStoryStatus(
  episodeStoryStatuses: ConfirmStatus[],
): ProjectStoryStatus {
  if (episodeStoryStatuses.length === 0) return "draft";
  const confirmedCount = episodeStoryStatuses.filter((s) => s === "confirmed").length;
  if (confirmedCount === 0) return "draft";
  if (confirmedCount === episodeStoryStatuses.length) return "confirmed";
  return "partial";
}

export interface KeyframeGate {
  producible: boolean;
  hasStartKeyframe: boolean;
  hasEndKeyframe: boolean;
  keyframesConfirmed: boolean;
  blocked: boolean;
}

/**
 * shotProducible keyframe gate (adr-006 §4 / §6.2):
 * a shot is producible when it has both a start and an end KeyframeSpec, both confirmed.
 * `blocked` = the shot is expected to be producible but is missing a start/end or not confirmed.
 */
export function computeKeyframeGate(keyframes: KeyframeSpec[]): KeyframeGate {
  const startFrames = keyframes.filter((k) => k.frameType === "start");
  const endFrames = keyframes.filter((k) => k.frameType === "end");
  const hasStartKeyframe = startFrames.length > 0;
  const hasEndKeyframe = endFrames.length > 0;
  const relevant = [...startFrames, ...endFrames];
  const keyframesConfirmed =
    relevant.length > 0 && relevant.every((k) => k.status === "confirmed");
  const producible = hasStartKeyframe && hasEndKeyframe && keyframesConfirmed;
  const blocked = !producible;
  return { producible, hasStartKeyframe, hasEndKeyframe, keyframesConfirmed, blocked };
}
