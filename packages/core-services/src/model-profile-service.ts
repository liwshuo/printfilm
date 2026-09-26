/**
 * ModelProfileService — model profile CRUD + view projection + credential test
 * (data-and-api-v1.md §10 step 6, model-settings-spec §).
 *
 * `model_profiles` is timestamped (no version column) — updates are NOT
 * optimistic-locked (adr-003 §6). Secrets are never stored here: only an
 * `endpointKey` reference is kept (adr-001).
 *
 * NOTE: real provider reachability is a Model Adapter concern (out of core-services
 * scope). `testCredential` here is the contract-level stub: it reports whether a
 * credential reference is bound, not whether the remote endpoint is live.
 */

import type {
  ModelProfile,
  ModelProfileView,
  ModelCredentialTestResult,
  Id,
} from "@dramaflow/domain";
import {
  createModelProfileSchema,
  updateModelProfileSchema,
  missingResource,
} from "@dramaflow/domain";
import { BaseService } from "./context.js";
import { parseInput } from "./validate.js";

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}

export function toModelProfileView(p: ModelProfile): ModelProfileView {
  const credentialBound = p.endpointKey != null && p.endpointKey !== "";
  const view: ModelProfileView = {
    id: p.id,
    provider: p.provider,
    modelType: p.modelType,
    modelName: p.modelName,
    isActive: p.isActive,
    credentialBound,
    defaultParams: p.defaultParams,
  };
  if (credentialBound) view.credentialHint = maskKey(p.endpointKey as string);
  return view;
}

export class ModelProfileService extends BaseService {
  create(raw: unknown): ModelProfile {
    const input = parseInput(createModelProfileSchema, raw);
    return this.repos.modelProfiles.create({
      provider: input.provider,
      modelType: input.modelType,
      modelName: input.modelName,
      endpointKey: input.endpointKey,
      defaultParams: input.defaultParams,
      isActive: input.isActive,
    });
  }

  update(id: Id, raw: unknown): ModelProfile {
    const patch = parseInput(updateModelProfileSchema, raw);
    const existing = this.repos.modelProfiles.getById(id);
    if (!existing) throw missingResource(`模型档案不存在：${id}`, { id });
    return this.repos.modelProfiles.update(id, patch);
  }

  setActive(id: Id, isActive: boolean): ModelProfile {
    const existing = this.repos.modelProfiles.getById(id);
    if (!existing) throw missingResource(`模型档案不存在：${id}`, { id });
    return this.repos.modelProfiles.update(id, { isActive });
  }

  get(id: Id): ModelProfile | null {
    return this.repos.modelProfiles.getById(id);
  }

  getView(id: Id): ModelProfileView | null {
    const p = this.repos.modelProfiles.getById(id);
    return p ? toModelProfileView(p) : null;
  }

  list(): ModelProfile[] {
    return this.repos.modelProfiles.list();
  }

  listViews(): ModelProfileView[] {
    return this.repos.modelProfiles.list().map(toModelProfileView);
  }

  /**
   * Contract-level credential check. V1 reports whether a credential reference
   * is bound; live endpoint verification is delegated to the Model Adapter.
   */
  testCredential(id: Id): ModelCredentialTestResult {
    const profile = this.repos.modelProfiles.getById(id);
    if (!profile) throw missingResource(`模型档案不存在：${id}`, { id });
    const bound = profile.endpointKey != null && profile.endpointKey !== "";
    if (!bound) {
      return {
        ok: false,
        errorCode: "provider_unavailable",
        errorMessage: "未绑定凭证引用（endpointKey）",
      };
    }
    return { ok: true, verifiedAt: new Date().toISOString(), latencyMs: 0 };
  }
}
