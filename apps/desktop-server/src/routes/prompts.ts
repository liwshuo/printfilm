/**
 * Prompt Compiler routes (prompt-compiler-contract-v1.md, data-api §10 step 5).
 *
 * Two entry styles:
 *  - POST /api/prompts/compile — accepts a fully-shaped PromptCompilerInput
 *  - POST /api/prompts/compile-shot | compile-scene-tts — server-side assemble
 *    from fact layer, then compile in one call (§9 convenience)
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";
import { PromptCompilerInput } from "@dramaflow/core-services";

export function promptsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Direct compile with a pre-assembled input (advanced callers).
  r.post("/prompts/compile", async (c) => {
    const body = await readJsonBody<PromptCompilerInput>(c.req.raw);
    const spec = c.get("services").promptCompiler.compile(body);
    publish("prompt.compiled", { id: spec.id, targetType: spec.targetType }, spec.projectId);
    return c.json(spec, 201);
  });

  // Server-side assemble + compile for a shot.
  r.post("/shots/:id/compile-prompt", async (c) => {
    const body = await readJsonBody<{
      targetType: "image" | "video";
      modelProfileId?: string;
    }>(c.req.raw);
    const svc = c.get("services").promptCompiler;
    const input = svc.assembleShotInput(
      c.req.param("id"),
      body.targetType,
      body.modelProfileId,
    );
    const spec = svc.compile(input);
    publish("prompt.compiled", { id: spec.id, targetType: spec.targetType }, spec.projectId);
    return c.json(spec, 201);
  });

  // Server-side assemble + compile TTS for a scene.
  r.post("/scenes/:id/compile-tts-prompt", async (c) => {
    const body = await readJsonBody<{ modelProfileId?: string }>(c.req.raw);
    const svc = c.get("services").promptCompiler;
    const input = svc.assembleSceneTtsInput(c.req.param("id"), body.modelProfileId);
    const spec = svc.compile(input);
    publish("prompt.compiled", { id: spec.id, targetType: spec.targetType }, spec.projectId);
    return c.json(spec, 201);
  });

  r.get("/prompts/:id", (c) => {
    const p = c.get("services").ctx.repos.promptSpecs.getById(c.req.param("id"));
    if (!p) return c.json({ code: "missing_resource", message: "prompt 不存在", retryable: false }, 404);
    return c.json(p);
  });

  r.post("/prompts/:id/confirm", async (c) => {
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    const p = c.get("services").promptCompiler.confirmPrompt(
      c.req.param("id"),
      expectedVersion,
    );
    publish("prompt.confirmed", { id: p.id }, p.projectId);
    return c.json(p);
  });

  r.get("/prompts", (c) => {
    const sourceEntityType = c.req.query("sourceEntityType");
    const sourceEntityId = c.req.query("sourceEntityId");
    if (!sourceEntityType || !sourceEntityId) {
      return c.json(
        {
          code: "validation_failed",
          message: "缺少 sourceEntityType 与 sourceEntityId",
          retryable: false,
        },
        400,
      );
    }
    const items = c
      .get("services")
      .ctx.repos.promptSpecs.listBySource(sourceEntityType, sourceEntityId);
    return c.json({ items });
  });

  return r;
}
