import { randomUUID } from "node:crypto";

/** Generate a new opaque id. */
export function newId(): string {
  return randomUUID();
}

/** Current time as ISO8601 (UTC). */
export function nowIso(): string {
  return new Date().toISOString();
}
