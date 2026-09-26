/**
 * Structured API error envelope + required error codes.
 * Authority: adr-004-api-error-envelope-v1.md. All POST/PATCH/DELETE business errors
 * must serialize to `ApiErrorEnvelope` with a `code` from `ApiErrorCode`.
 */

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  suggestedAction?: string;
  /** Links to navigation-matrix repair target. */
  suggestedTarget?: string;
}

/** adr-004 §4 必备错误码. */
export const API_ERROR_CODES = [
  "validation_failed",
  "version_conflict",
  "invalid_state",
  "blocked_by_issue",
  "blocked_by_reference",
  "missing_resource",
  "path_missing",
  "provider_unavailable",
  "task_not_retryable",
  "export_not_ready",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * Domain-level error carrying an `ApiErrorEnvelope`.
 * The HTTP layer (apps/desktop-server) maps this to a JSON body; services throw it.
 */
export class DomainError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly suggestedAction?: string;
  readonly suggestedTarget?: string;

  constructor(envelope: {
    code: ApiErrorCode;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
    suggestedAction?: string;
    suggestedTarget?: string;
  }) {
    super(envelope.message);
    this.name = "DomainError";
    this.code = envelope.code;
    this.retryable = envelope.retryable ?? false;
    this.details = envelope.details;
    this.suggestedAction = envelope.suggestedAction;
    this.suggestedTarget = envelope.suggestedTarget;
  }

  toEnvelope(): ApiErrorEnvelope {
    const env: ApiErrorEnvelope = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details !== undefined) env.details = this.details;
    if (this.suggestedAction !== undefined) env.suggestedAction = this.suggestedAction;
    if (this.suggestedTarget !== undefined) env.suggestedTarget = this.suggestedTarget;
    return env;
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}

// ===== Common error factories (keep messages user-readable, adr-004 §5) =====

/** adr-003 optimistic-lock conflict; details carry currentVersion + object summary. */
export function versionConflict(details: {
  currentVersion: number;
  updatedAt?: string;
  summary?: Record<string, unknown>;
}): DomainError {
  return new DomainError({
    code: "version_conflict",
    message: "当前对象已被更新，请刷新后重试。",
    retryable: false,
    details,
    suggestedAction: "refresh",
  });
}

export function validationFailed(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError({
    code: "validation_failed",
    message,
    retryable: false,
    details,
  });
}

export function invalidState(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError({ code: "invalid_state", message, retryable: false, details });
}

export function missingResource(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError({ code: "missing_resource", message, retryable: false, details });
}

/** Blocked because unresolved review/validation issue exists (adr-004 §5). */
export function blockedByIssue(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError({ code: "blocked_by_issue", message, retryable: false, details });
}

/** Blocked because target is still referenced by other objects (adr-004 §5). */
export function blockedByReference(
  message: string,
  details: Record<string, unknown>,
): DomainError {
  return new DomainError({ code: "blocked_by_reference", message, retryable: false, details });
}

/**
 * External AI/model provider is not configured or is currently unavailable
 * (adr-004 §5 · provider_unavailable). Used when a generation call requires
 * the Ark provider but the API key is missing or the upstream request failed.
 * Maps to HTTP 502.
 */
export function providerUnavailable(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError({
    code: "provider_unavailable",
    message,
    retryable: true,
    details,
    suggestedAction: "configure_ai_key",
    suggestedTarget: "/models",
  });
}
