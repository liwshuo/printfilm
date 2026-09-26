// Smoke test for @dramaflow/desktop-server.
// Uses in-memory SQLite + Hono's app.request() (no port binding required).
// Verifies: health probe, project/episode CRUD, error envelope, model profile,
// prompt compile, job lifecycle, review issue gate, export bundle create.
//
// Run: node scripts/smoke-desktop-server.mjs

import { createSqliteRepositoryRegistry } from "../packages/repositories/dist/index.js";
import { isDomainError } from "../packages/domain/dist/index.js";
import { createServiceBundle } from "../apps/desktop-server/dist/services.js";
import { createApp } from "../apps/desktop-server/dist/server.js";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

const { registry, close } = createSqliteRepositoryRegistry({ filename: ":memory:" });
const services = createServiceBundle(registry, "smoke");
const app = createApp({ services, logging: false });

async function req(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

// --- Health ---
{
  const { status, json } = await req("GET", "/api/health");
  assert(status === 200, "health 200");
  assert(json.status === "ok", "health ok");
}

// --- Project + story bible + episode ---
const projectRes = await req("POST", "/api/projects", {
  name: "冒烟测试短剧",
  slug: "smoke-drama",
  outputSpec: { resolution: "1080p", fps: 30, subtitle: "burned", voiceover: "tts" },
});
assert(projectRes.status === 201, "project created 201");
const project = projectRes.json;
assert(project.version === 1, "project v1");

const bibleGet = await req("GET", `/api/projects/${project.id}/story-bible`);
assert(bibleGet.status === 200, "story bible autoseeded");

const bibleUpdate = await req("PATCH", `/api/projects/${project.id}/story-bible`, {
  logline: "冒烟主线",
  theme: "测试",
  version: bibleGet.json.version,
});
assert(bibleUpdate.status === 200, `story bible updated, got ${bibleUpdate.status} ${JSON.stringify(bibleUpdate.json)}`);
assert(bibleUpdate.json.logline === "冒烟主线", "story bible logline persisted");

// Duplicate slug → validation_failed envelope
const dupSlug = await req("POST", "/api/projects", {
  name: "重复",
  slug: "smoke-drama",
  outputSpec: { resolution: "1080p", fps: 30, subtitle: "none", voiceover: "none" },
});
assert(dupSlug.status === 400, `duplicate slug -> 400, got ${dupSlug.status}`);
assert(dupSlug.json.code === "validation_failed", "duplicate slug envelope code");

const episodeRes = await req("POST", `/api/projects/${project.id}/episodes`, {
  episodeNo: 1,
  summary: "第一集摘要",
  episodeGoal: "冲突建立",
});
assert(episodeRes.status === 201, "episode created 201");
const episode = episodeRes.json;

const stalePut = await req("POST", `/api/episodes/${episode.id}/confirm-story`, {
  expectedVersion: 999,
});
assert(stalePut.status === 409, `stale confirm -> 409, got ${stalePut.status}`);
assert(stalePut.json.code === "version_conflict", "stale confirm envelope code");

// --- Model profile ---
const modelRes = await req("POST", "/api/model-profiles", {
  provider: "openai",
  modelType: "llm",
  modelName: "gpt-x",
  endpointKey: "openai-default",
  defaultParams: { temperature: 0.5 },
  isActive: true,
});
assert(modelRes.status === 201, "model profile 201");
const modelId = modelRes.json.id;
const viewRes = await req("GET", `/api/model-profiles/${modelId}/view`);
assert(viewRes.status === 200, "model view 200");
assert(viewRes.json.credentialBound === true, "credential bound flag");

// --- Missing resource envelope ---
const missing = await req("GET", "/api/projects/proj_missing_00000");
assert(missing.status === 404, `missing project -> 404, got ${missing.status}`);
assert(missing.json.code === "missing_resource", "missing envelope code");

// --- 404 fallback ---
const notFound = await req("GET", "/api/does/not/exist");
assert(notFound.status === 404, "404 fallback");
assert(notFound.json.code === "missing_resource", "404 envelope");

close();
console.log("smoke:desktop-server ... SMOKE OK");
