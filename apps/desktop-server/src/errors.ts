/**
 * DomainError → HTTP response envelope mapping (adr-004 §4).
 *
 * Each DomainError.code has a canonical HTTP status; the response body is the
 * ApiErrorEnvelope produced by `DomainError.toEnvelope()`. Unknown errors are
 * masked as `internal_error` with a generic message (no stack leak).
 */

import { HTTPException } from "hono/http-exception";
import { Context } from "hono";
import { DomainError, isDomainError, ApiErrorEnvelope } from "@dramaflow/domain";
import { serverLog } from "./logger.js";

const HTTP_STATUS: Record<string, number> = {
  validation_failed: 400,
  version_conflict: 409,
  invalid_state: 409,
  blocked_by_issue: 409,
  blocked_by_reference: 409,
  missing_resource: 404,
  path_missing: 404,
  provider_unavailable: 502,
  task_not_retryable: 409,
  export_not_ready: 409,
  internal_error: 500,
};

export function statusForCode(code: string): number {
  return HTTP_STATUS[code] ?? 500;
}

export function errorEnvelope(err: DomainError): ApiErrorEnvelope {
  return err.toEnvelope();
}

/**
 * Global onError handler for Hono. Any thrown error from a route handler is
 * normalized to an ApiErrorEnvelope response **and** durable-logged so we can
 * post-hoc debug from `.runtime/logs/server.<date>.log`.
 *
 * Log fields:
 *   - method / path / status: request identity + response status
 *   - code / message / details: DomainError contract (or "internal_error")
 *   - stack: full stack for `internal_error` (never sent to client)
 */
export function toErrorResponse(err: Error, c: Context): Response {
  const method = c.req.method;
  const path = c.req.path;

  if (isDomainError(err)) {
    const status = statusForCode(err.code);
    // 4xx from expected domain rules → info; 5xx (provider) → error.
    const level = status >= 500 ? "error" : "warn";
    serverLog[level]("http.domain_error", {
      method,
      path,
      status,
      code: err.code,
      message: err.message,
      details: err.details,
      retryable: err.retryable,
    });
    return c.json(errorEnvelope(err), status as never);
  }

  if (err instanceof HTTPException) {
    serverLog.warn("http.hono_exception", {
      method,
      path,
      status: err.status,
      message: err.message,
    });
    const body: ApiErrorEnvelope = {
      code: "internal_error",
      message: err.message || "HTTP error",
      retryable: false,
    };
    return c.json(body, err.status as never);
  }

  // Unknown crash — log full stack, but never leak to the client.
  serverLog.error("http.unhandled", {
    method,
    path,
    status: 500,
    err,
  });
  const body: ApiErrorEnvelope = {
    code: "internal_error",
    message: "服务内部错误",
    retryable: false,
  };
  return c.json(body, 500);
}
