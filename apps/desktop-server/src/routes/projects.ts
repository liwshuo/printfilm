/**
 * Projects + Story Bible + Episodes + Activity Feed routes
 * (data-and-api-v1.md §7 Project Setup / Story Editor).
 */

import { Hono } from "hono";
import { AppEnv, readJsonBody } from "../env.js";
import { publish } from "../events.js";

export function projectsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ===== Projects =====
  r.get("/projects", (c) => c.json({ items: c.get("services").story.listProjects() }));
  r.post("/projects", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const project = c.get("services").story.createProject(body);
    publish("project.created", { id: project.id, name: project.name }, project.id);
    return c.json(project, 201);
  });
  r.get("/projects/:id", (c) => {
    const p = c.get("services").story.getProject(c.req.param("id"));
    if (!p) return c.json({ code: "missing_resource", message: "项目不存在", retryable: false }, 404);
    return c.json(p);
  });
  r.patch("/projects/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const p = c.get("services").story.updateProject(c.req.param("id"), body);
    publish("project.updated", { id: p.id }, p.id);
    return c.json(p);
  });
  r.delete("/projects/:id", (c) => {
    const id = c.req.param("id");
    const ok = c.get("services").story.deleteProject(id);
    if (!ok) {
      return c.json({ code: "missing_resource", message: "项目不存在", retryable: false }, 404);
    }
    publish("project.deleted", { id }, id);
    return c.json({ ok: true, id }, 200);
  });
  r.get("/projects/:id/story-status", (c) =>
    c.json(c.get("services").story.getProjectStoryStatus(c.req.param("id"))),
  );
  r.get("/projects/:id/story-completeness", (c) =>
    c.json(c.get("services").story.checkStoryCompleteness(c.req.param("id"))),
  );

  // ===== Story Bible =====
  r.get("/projects/:id/story-bible", (c) => {
    const b = c.get("services").story.getStoryBible(c.req.param("id"));
    if (!b) return c.json({ code: "missing_resource", message: "故事圣经不存在", retryable: false }, 404);
    return c.json(b);
  });
  r.patch("/projects/:id/story-bible", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const projectId = c.req.param("id");
    const bible = c.get("services").story.updateStoryBible(projectId, body);
    publish("story.bible.updated", { projectId }, projectId);
    return c.json(bible);
  });
  // Stub AI generation of the story bible (story-workspace-spec §14). LLM not
  // wired yet — returns generated-origin content synchronously.
  r.post("/projects/:id/story-bible/generate", async (c) => {
    const projectId = c.req.param("id");
    const bible = await c.get("services").story.generateStoryBible(projectId);
    publish("story.bible.generated", { projectId }, projectId);
    return c.json(bible);
  });

  // ===== Episodes =====
  r.get("/projects/:id/episodes", (c) =>
    c.json({ items: c.get("services").story.listEpisodes(c.req.param("id")) }),
  );
  r.post("/projects/:id/episodes", async (c) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    body.projectId = c.req.param("id");
    const ep = c.get("services").story.createEpisode(body);
    publish("episode.created", { id: ep.id, episodeNo: ep.episodeNo }, ep.projectId);
    return c.json(ep, 201);
  });
  // Async LLM outline job：立即入队并返回 202 + { taskId }，前端轮询 /jobs/:id 获取结果。
  // 保留 `?sync=1` 走同步链路（老 smoke / CLI 场景）。
  r.post("/projects/:id/episodes/generate-outline", async (c) => {
    const projectId = c.req.param("id");
    const body = await readJsonBody<{ count?: number; topicHint?: string }>(c.req.raw).catch(
      () => ({}) as { count?: number; topicHint?: string },
    );
    if (c.req.query("sync") === "1") {
      const episodes = await c
        .get("services")
        .story.generateEpisodeOutline(projectId, body.count, {
          topicHint: body.topicHint,
        });
      publish("story.outline.generated", { projectId, count: episodes.length }, projectId);
      return c.json({ items: episodes }, 201);
    }
    const services = c.get("services");
    const task = services.jobs.enqueueAndRun(
      {
        projectId,
        taskType: "story_generate",
        sourceEntityType: "project",
        sourceEntityId: projectId,
        inputPayload: {
          kind: "episode_outline.generate",
          count: body.count ?? 3,
          topicHint: body.topicHint ?? null,
        },
      },
      async () => {
        const episodes = await services.story.generateEpisodeOutline(projectId, body.count, {
          topicHint: body.topicHint,
        });
        publish("story.outline.generated", { projectId, count: episodes.length }, projectId);
        return { episodeIds: episodes.map((e) => e.id), count: episodes.length };
      },
    );
    return c.json({ taskId: task.id, status: task.status }, 202);
  });
  r.get("/episodes/:id", (c) => {
    const ep = c.get("services").ctx.repos.episodes.getById(c.req.param("id"));
    if (!ep) return c.json({ code: "missing_resource", message: "剧集不存在", retryable: false }, 404);
    return c.json(ep);
  });
  r.patch("/episodes/:id", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const ep = c.get("services").story.updateEpisode(c.req.param("id"), body);
    publish("episode.updated", { id: ep.id }, ep.projectId);
    return c.json(ep);
  });
  r.delete("/episodes/:id", (c) => {
    const id = c.req.param("id");
    const ok = c.get("services").story.deleteEpisode(id);
    if (!ok) return c.json({ code: "missing_resource", message: "剧集不存在", retryable: false }, 404);
    publish("episode.deleted", { id }, undefined);
    return c.body(null, 204);
  });
  r.post("/episodes/:id/confirm-story", async (c) => {
    const { expectedVersion } = await readJsonBody<{ expectedVersion: number }>(c.req.raw);
    const ep = c.get("services").story.confirmEpisodeStory(c.req.param("id"), expectedVersion);
    publish("episode.story.confirmed", { id: ep.id, status: ep.storyStatus }, ep.projectId);
    return c.json(ep);
  });
  r.post("/episodes/:id/regenerate-outline", async (c) => {
    const episodeId = c.req.param("id");
    const body = await readJsonBody<{ topicHint?: string }>(c.req.raw).catch(
      () => ({}) as { topicHint?: string },
    );
    const services = c.get("services");
    // 先取 episode 获取 projectId（generation_tasks 需要 projectId）
    const episode = services.ctx.repos.episodes.getById(episodeId);
    if (!episode)
      return c.json({ code: "missing_resource", message: "剧集不存在", retryable: false }, 404);

    if (c.req.query("sync") === "1") {
      const ep = await services.story.regenerateEpisodeOutline(episodeId, {
        topicHint: body?.topicHint,
      });
      publish("episode.story.regenerated", { id: ep.id }, ep.projectId);
      return c.json(ep);
    }

    const task = services.jobs.enqueueAndRun(
      {
        projectId: episode.projectId,
        taskType: "story_generate",
        sourceEntityType: "episode",
        sourceEntityId: episodeId,
        inputPayload: {
          kind: "episode_outline.regenerate",
          topicHint: body?.topicHint ?? null,
        },
      },
      async () => {
        const ep = await services.story.regenerateEpisodeOutline(episodeId, {
          topicHint: body?.topicHint,
        });
        publish("episode.story.regenerated", { id: ep.id }, ep.projectId);
        return { episodeId: ep.id, version: ep.version };
      },
    );
    return c.json({ taskId: task.id, status: task.status }, 202);
  });

  // ===== Activity Feed =====
  r.get("/projects/:id/activity", (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    const events = c.get("services").ctx.repos.activityEvents.listByProject(
      c.req.param("id"),
      limit,
    );
    return c.json({ items: events });
  });

  return r;
}
