/**
 * Log ingestion routes — accepts browser-side error / warning reports and
 * appends them to `.runtime/logs/web.<date>.log` for post-hoc debugging.
 *
 * Contract (POST /api/logs):
 *   Body: {
 *     level: "debug" | "info" | "warn" | "error",
 *     event?: string,                // short tag, defaults to "web.report"
 *     message?: string,
 *     stack?: string,                // captured Error.stack when available
 *     url?: string,                  // window.location.href
 *     userAgent?: string,
 *     extra?: Record<string, unknown>
 *   }
 *   Body may also be `{ records: [ ... ] }` for batch upload.
 *
 * Response: 204 No Content. Never fails — best-effort logging must not block UX.
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { log as writeLog, LogLevel } from "../logger.js";

interface WebLogRecord {
  level?: LogLevel;
  event?: string;
  message?: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  extra?: Record<string, unknown>;
}

const ALLOWED_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function ingest(rec: WebLogRecord, clientIp: string | undefined): void {
  const level: LogLevel = ALLOWED_LEVELS.includes(rec.level as LogLevel)
    ? (rec.level as LogLevel)
    : "info";
  const event = typeof rec.event === "string" && rec.event ? rec.event : "web.report";
  writeLog("web", level, event, {
    message: rec.message,
    stack: rec.stack,
    url: rec.url,
    userAgent: rec.userAgent,
    clientIp,
    extra: rec.extra,
  });
}

export function logsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post("/logs", async (c) => {
    try {
      const body = await readJsonBody<
        WebLogRecord | { records: WebLogRecord[] }
      >(c.req.raw);
      const clientIp =
        c.req.header("x-forwarded-for") ??
        c.req.header("x-real-ip") ??
        undefined;

      if (body && Array.isArray((body as { records?: WebLogRecord[] }).records)) {
        for (const rec of (body as { records: WebLogRecord[] }).records) {
          ingest(rec, clientIp);
        }
      } else {
        ingest(body as WebLogRecord, clientIp);
      }
    } catch {
      // Swallow — logging must never fail hard.
    }
    return c.body(null, 204);
  });

  return r;
}
