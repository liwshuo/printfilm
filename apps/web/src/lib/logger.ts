/**
 * Web-side logger: forwards errors to the desktop-server so we get a durable,
 * grep-able trail alongside the server logs (P0 log system, complements the
 * server-side JSONL sink under `apps/desktop-server/.runtime/logs/`).
 *
 * Design:
 *   - `report(level, event, fields)` sends one JSON record to POST /api/logs.
 *   - fire-and-forget: never awaits, never throws. Logging must never disrupt UX.
 *   - `install()` wires `window.onerror` + `unhandledrejection` once per page.
 *   - `/api/logs` requests themselves are excluded from reporting to avoid
 *     recursive loops.
 */

export type WebLogLevel = "debug" | "info" | "warn" | "error";

export interface WebLogFields {
  message?: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

const LOGS_PATH = "/api/logs";
/**
 * 直连 desktop-server，绕过 Next.js dev rewrite。参见 api.ts 的同名逻辑。
 * 单独放一份是为了避免 logger ↔ api.ts 循环依赖。
 */
const LOGS_ENDPOINT = (() => {
  const explicit =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_DRAMAFLOW_API_BASE
      : undefined;
  const base =
    explicit && explicit.length > 0
      ? explicit.replace(/\/+$/, "")
      : typeof window !== "undefined"
        ? "http://127.0.0.1:5174"
        : "";
  return base + LOGS_PATH;
})();

/** True while a report is in flight — used to break potential recursion. */
let inFlight = false;

/**
 * Send one log record to the server. Non-blocking; catches its own failures.
 * Safe to call from anywhere on the client, including during error handling.
 */
export function report(
  level: WebLogLevel,
  event: string,
  fields: WebLogFields = {},
): void {
  // Never run on the server (Next.js SSR pass) — window is not defined there.
  if (typeof window === "undefined") return;
  // Break recursive reporting: if the /api/logs call itself fails, don't loop.
  if (inFlight) return;

  const payload = {
    level,
    event,
    message: fields.message,
    stack: fields.stack,
    url: window.location?.href,
    userAgent: navigator?.userAgent,
    extra: fields.extra,
  };

  try {
    inFlight = true;
    // Prefer sendBeacon for reliability on page-unload, but fall back to fetch
    // for regular runtime errors (sendBeacon has size caps).
    const ok =
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(
        LOGS_ENDPOINT,
        new Blob([JSON.stringify(payload)], { type: "application/json" }),
      );
    if (!ok) {
      // fire-and-forget fetch
      void fetch(LOGS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // swallow — logging is best-effort
      });
    }
  } finally {
    inFlight = false;
  }
}

/** Convenience helpers. */
export const webLog = {
  debug: (event: string, fields?: WebLogFields) => report("debug", event, fields),
  info: (event: string, fields?: WebLogFields) => report("info", event, fields),
  warn: (event: string, fields?: WebLogFields) => report("warn", event, fields),
  error: (event: string, fields?: WebLogFields) => report("error", event, fields),
};

let installed = false;

/**
 * Wire global handlers so that any unhandled runtime error / promise rejection
 * gets forwarded to `.runtime/logs/web.<date>.log`. Idempotent.
 * Call once from the root layout on the client.
 */
export function installGlobalHandlers(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  window.addEventListener("error", (ev) => {
    // Do NOT report errors that come from /api/logs itself (guard against loops).
    const src = (ev as ErrorEvent).filename ?? "";
    if (src.includes(LOGS_ENDPOINT)) return;
    webLog.error("window.error", {
      message: (ev as ErrorEvent).message,
      stack: (ev as ErrorEvent).error?.stack,
      extra: {
        filename: (ev as ErrorEvent).filename,
        lineno: (ev as ErrorEvent).lineno,
        colno: (ev as ErrorEvent).colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    const isError = reason instanceof Error;
    webLog.error("unhandled.promise", {
      message: isError ? reason.message : String(reason),
      stack: isError ? reason.stack : undefined,
      extra: {
        // capture DomainError-style code/status when possible
        code: (reason as { code?: unknown })?.code,
        status: (reason as { status?: unknown })?.status,
        details: (reason as { details?: unknown })?.details,
      },
    });
  });
}
