/**
 * Shared Hono env type: routes read `services` via `c.get("services")`.
 */

import { Hono } from "hono";
import { ServiceBundle } from "./services.js";

export type AppEnv = {
  Variables: {
    services: ServiceBundle;
  };
};

export type AppHono = Hono<AppEnv>;

/** Read a JSON body; empty body yields `{}`. Never throws on empty/whitespace. */
export async function readJsonBody<T = Record<string, unknown>>(
  req: Request,
): Promise<T> {
  const text = await req.text();
  if (!text || text.trim() === "") return {} as T;
  return JSON.parse(text) as T;
}
