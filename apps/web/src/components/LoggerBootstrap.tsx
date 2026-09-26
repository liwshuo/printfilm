"use client";

/**
 * Mounted once in the root layout so `window.onerror` and
 * `unhandledrejection` are wired up as soon as the app hydrates.
 * Sends every uncaught error to `.runtime/logs/web.<date>.log` via
 * POST /api/logs — see `apps/web/src/lib/logger.ts`.
 */

import { useEffect } from "react";
import { installGlobalHandlers } from "@/lib/logger";

export function LoggerBootstrap(): null {
  useEffect(() => {
    installGlobalHandlers();
  }, []);
  return null;
}
