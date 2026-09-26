/** JSON (de)serialization helpers for TEXT-backed JSON columns. */

/** Serialize a value for a JSON TEXT column. */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Parse a JSON object column, falling back to `{}`. */
export function fromJsonObject<T extends Record<string, unknown>>(
  raw: unknown,
  fallback: T = {} as T,
): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" ? parsed : fallback) as T;
  } catch {
    return fallback;
  }
}

/** Parse a JSON array column, falling back to `[]`. */
export function fromJsonArray<T>(raw: unknown, fallback: T[] = []): T[] {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

/** SQLite stores booleans as 0/1 INTEGER. */
export function toDbBool(value: boolean | undefined): number {
  return value ? 1 : 0;
}

export function fromDbBool(value: unknown): boolean {
  return value === 1 || value === true;
}

/** Normalize nullable TEXT/number columns to `undefined` for optional entity fields. */
export function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}
