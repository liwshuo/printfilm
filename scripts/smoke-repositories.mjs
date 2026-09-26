// Dev smoke test for the persistence layer (not a unit test framework).
// Run: node scripts/smoke-repositories.mjs
import { createSqliteRepositoryRegistry } from "../packages/repositories/dist/index.js";
import { isDomainError } from "../packages/domain/dist/index.js";

const { registry, migration, close } = createSqliteRepositoryRegistry({
  filename: ":memory:",
});

console.log("migrations applied:", migration?.applied);

// create project
const project = registry.projects.create({
  name: "Demo Drama",
  slug: "demo-drama",
  status: "draft",
  projectType: "drama",
  contentType: "short_drama",
  visualStyle: { resolvedPrompt: "cinematic realism, natural lighting" },
  complianceMode: "domestic",
  aspectRatio: "9:16",
  episodeCount: 0,
  language: "zh-CN",
  outputSpec: { resolution: "1080p", fps: 24, subtitle: "burned", voiceover: "tts" },
  modelPolicy: {},
  creativeConstraints: { forbiddenGenres: [], styleTaboos: [], contentBoundaries: [] },
});
console.log("created project:", project.id, "v", project.version);

// read back
const fetched = registry.projects.getById(project.id);
console.assert(fetched?.slug === "demo-drama", "slug round-trip");
console.assert(fetched?.outputSpec.resolution === "1080p", "json round-trip");

// optimistic lock: wrong version -> conflict
let conflict = false;
try {
  registry.projects.update(project.id, { name: "x" }, 999);
} catch (e) {
  conflict = isDomainError(e) && e.code === "version_conflict";
}
console.assert(conflict, "expected version_conflict on wrong version");

// correct version -> bump
const updated = registry.projects.update(project.id, { name: "Demo Drama 2" }, project.version);
console.assert(updated.version === project.version + 1, "version bumped");
console.assert(updated.name === "Demo Drama 2", "name updated");

// episode + scene + shot + keyframe (cascade + rollup path)
const ep = registry.episodes.create({
  projectId: project.id,
  episodeNo: 1,
  storyStatus: "draft",
  scriptStatus: "draft",
  storyboardStatus: "draft",
  productionStatus: "idle",
  reviewStatus: "pending",
});
const scene = registry.scenes.create({
  episodeId: ep.id,
  sceneNo: 1,
  sceneTags: ["opening"],
  entryState: {},
  exitState: {},
  storyboardStatus: "draft",
  sortOrder: 0,
});
console.assert(Array.isArray(scene.sceneTags) && scene.sceneTags[0] === "opening", "stringArray round-trip");

const counts = registry.scenes.countByEpisodeAndStatus(ep.id);
console.assert(counts.total === 1 && counts.draft === 1, "scene counts");

// activity append + read
registry.activityEvents.append({
  projectId: project.id,
  eventType: "project.created",
  summary: "created",
  targetRef: { entityType: "project", entityId: project.id },
  payload: {},
});
const acts = registry.activityEvents.listByProject(project.id);
console.assert(acts.length === 1 && acts[0].targetRef.entityType === "project", "activity round-trip");

close();
console.log("SMOKE OK");
