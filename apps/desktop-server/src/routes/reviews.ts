/**
 * Review Center routes (review-center-spec-v1.md, §10 step 9).
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";
import {
  CreateReviewRunInput,
  CreateReviewIssueInput,
  FinishReviewRunInput,
  RunRulePacksInput,
} from "@dramaflow/core-services";

export function reviewsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ===== Review Runs =====
  r.post("/reviews/run", async (c) => {
    const body = await readJsonBody<CreateReviewRunInput>(c.req.raw);
    const run = c.get("services").review.createRun(body);
    publish("review.run.created", { id: run.id }, run.projectId);
    return c.json(run, 201);
  });
  r.get("/projects/:id/review-runs", (c) =>
    c.json({ items: c.get("services").review.listRuns(c.req.param("id")) }),
  );
  r.get("/review-runs/:id", (c) => {
    const run = c.get("services").review.getRun(c.req.param("id"));
    if (!run) return c.json({ code: "missing_resource", message: "审查运行不存在", retryable: false }, 404);
    return c.json(run);
  });
  r.post("/review-runs/:id/start", (c) => {
    const run = c.get("services").review.startRun(c.req.param("id"));
    publish("review.run.status.changed", { id: run.id, status: run.status }, run.projectId);
    return c.json(run);
  });
  r.post("/review-runs/:id/finish", async (c) => {
    const body = await readJsonBody<FinishReviewRunInput>(c.req.raw);
    const run = c.get("services").review.finishRun(c.req.param("id"), body);
    publish(
      "review.run.finished",
      { id: run.id, verdict: run.verdict, status: run.status },
      run.projectId,
    );
    return c.json(run);
  });
  r.post("/review-runs/:id/fail", async (c) => {
    const { errorMessage } = await readJsonBody<{ errorMessage: string }>(c.req.raw);
    const run = c.get("services").review.failRun(c.req.param("id"), errorMessage);
    publish(
      "review.run.status.changed",
      { id: run.id, status: run.status, errorMessage },
      run.projectId,
    );
    return c.json(run);
  });

  // ===== Review Issues =====
  r.get("/projects/:id/review-issues", (c) => {
    const only = c.req.query("only");
    if (only === "blocking") {
      return c.json({ items: c.get("services").review.listBlockingIssues(c.req.param("id")) });
    }
    return c.json({ items: c.get("services").review.listIssues(c.req.param("id")) });
  });
  r.post("/review-issues", async (c) => {
    const body = await readJsonBody<CreateReviewIssueInput>(c.req.raw);
    const issue = c.get("services").review.createIssue(body);
    publish("review.issue.changed", { id: issue.id, status: issue.status }, issue.projectId);
    return c.json(issue, 201);
  });
  r.get("/review-issues/:id", (c) => {
    const i = c.get("services").review.getIssue(c.req.param("id"));
    if (!i) return c.json({ code: "missing_resource", message: "审查问题不存在", retryable: false }, 404);
    return c.json(i);
  });
  r.get("/review-issues/:id/events", (c) =>
    c.json({ items: c.get("services").review.listIssueEvents(c.req.param("id")) }),
  );
  r.post("/review-issues/:id/resolve", async (c) => {
    const { resolutionNote, changedBy } = await readJsonBody<{
      resolutionNote?: string;
      changedBy?: string;
    }>(c.req.raw);
    const i = c.get("services").review.resolveIssue(c.req.param("id"), resolutionNote, changedBy);
    publish("review.issue.changed", { id: i.id, status: i.status }, i.projectId);
    return c.json(i);
  });
  r.post("/review-issues/:id/ignore", async (c) => {
    const { ignoreReason, changedBy } = await readJsonBody<{
      ignoreReason: string;
      changedBy?: string;
    }>(c.req.raw);
    const i = c.get("services").review.ignoreIssue(c.req.param("id"), ignoreReason, changedBy);
    publish("review.issue.changed", { id: i.id, status: i.status }, i.projectId);
    return c.json(i);
  });
  r.post("/review-issues/:id/reopen", async (c) => {
    const { note, changedBy } = await readJsonBody<{ note?: string; changedBy?: string }>(
      c.req.raw,
    );
    const i = c.get("services").review.reopenIssue(c.req.param("id"), note, changedBy);
    publish("review.issue.changed", { id: i.id, status: i.status }, i.projectId);
    return c.json(i);
  });

  // ===== 内置规则包（vertical slice） =====
  r.post("/projects/:id/reviews/run-rule-packs", async (c) => {
    const body = await readJsonBody<Omit<RunRulePacksInput, "projectId">>(c.req.raw);
    const result = c.get("services").review.runRulePacks({
      projectId: c.req.param("id"),
      episodeId: body.episodeId,
      packs: body.packs,
    });
    publish(
      "review.run.finished",
      { id: result.runId, verdict: result.verdict },
      c.req.param("id"),
    );
    return c.json(result, 201);
  });

  return r;
}
