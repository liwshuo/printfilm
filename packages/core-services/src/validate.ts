/**
 * Input validation helper. Runs a zod schema and converts failures into the
 * standard `DomainError(validation_failed)` envelope (adr-004 §4).
 *
 * Services accept raw (unknown) request payloads at their boundary and parse
 * them here, so the HTTP layer only has to forward the parsed error body.
 */

import type { z } from "zod";
import { validationFailed } from "@dramaflow/domain";

export function parseInput<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw validationFailed("输入校验未通过", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    });
  }
  return result.data;
}
