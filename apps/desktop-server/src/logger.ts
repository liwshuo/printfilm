/**
 * Simple JSONL file logger for desktop-server (P0).
 *
 * Design goals:
 *   - **Zero external deps**: uses `node:fs` sync appends. QPS is low, so we
 *     accept the ergonomic cost for guaranteed durability.
 *   - **Per-day rotation**: one file per (name, YYYY-MM-DD) under
 *     `apps/desktop-server/.runtime/logs/`.
 *   - **JSONL**: one JSON object per line, easy to grep / jq / tail.
 *   - **Named sinks**: reserve `server` for own logs, `web` for browser upload
 *     via POST /api/logs. Additional sinks (e.g. `worker`) can be added later.
 *
 * NOT a general-purpose logger. When the app grows, swap to pino/winston.
 */

import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  ts: string; // ISO
  level: LogLevel;
  event: string; // short kebab-case tag, e.g. "http.request", "domain.error"
  [key: string]: unknown;
}

/** Where all log files live. */
const LOG_ROOT = path.resolve(
  process.cwd(),
  process.env.DRAMAFLOW_LOG_DIR ?? ".runtime/logs",
);

/** Ensure the log directory exists once at boot. */
function ensureDir(): void {
  try {
    fs.mkdirSync(LOG_ROOT, { recursive: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[logger] failed to mkdir log root:", err);
  }
}
ensureDir();

/** Today's log file for a named sink, e.g. `.runtime/logs/server.2026-09-24.log`. */
function fileFor(name: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.join(LOG_ROOT, `${name}.${y}-${m}-${dd}.log`);
}

/** Serialize an unknown value in a way that survives Error objects. */
function serializeValue(v: unknown): unknown {
  if (v instanceof Error) {
    return {
      name: v.name,
      message: v.message,
      stack: v.stack,
      // Domain errors carry .code / .details — surface them if present.
      code: (v as { code?: unknown }).code,
      details: (v as { details?: unknown }).details,
    };
  }
  return v;
}

/**
 * Write a record to the given sink. `fields` is merged into the record; any
 * `Error` value in it is expanded to `{ name, message, stack, code, details }`.
 */
export function log(
  sink: string,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    event,
    ...Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, serializeValue(v)]),
    ),
  };
  const line = JSON.stringify(record) + "\n";
  try {
    fs.appendFileSync(fileFor(sink), line, "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[logger] appendFileSync failed:", err);
  }
  // Also echo to stdout so the existing tail-based workflow keeps working.
  if (level === "error" || level === "warn") {
    // eslint-disable-next-line no-console
    console[level === "error" ? "error" : "warn"](
      `[${sink}] ${event}`,
      fields,
    );
  }
}

/** Convenience: server-side logs. */
export const serverLog = {
  debug: (event: string, fields?: Record<string, unknown>) =>
    log("server", "debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) =>
    log("server", "info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) =>
    log("server", "warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) =>
    log("server", "error", event, fields),
};

/** Convenience: browser-uploaded logs. */
export const webLog = {
  debug: (fields: Record<string, unknown>) => log("web", "debug", "web.report", fields),
  info: (fields: Record<string, unknown>) => log("web", "info", "web.report", fields),
  warn: (fields: Record<string, unknown>) => log("web", "warn", "web.report", fields),
  error: (fields: Record<string, unknown>) => log("web", "error", "web.report", fields),
};

/** Expose the resolved log root for tooling / CLI. */
export function getLogRoot(): string {
  return LOG_ROOT;
}
