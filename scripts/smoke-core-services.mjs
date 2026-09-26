// Smoke test for @dramaflow/core-services over the real SQLite persistence layer.
// Run: node scripts/smoke-core-services.mjs
import { createSqliteRepositoryRegistry } from "../packages/repositories/dist/index.js";
import { isDomainError } from "../packages/domain/dist/index.js";
import {
  StoryService,
  AssetService,
  StoryboardService,
  ModelProfileService,
  PromptCompilerService,
  JobOrchestratorService,
  ArtifactService,
  ReviewService,
  ExportService,
} from "../packages/core-services/dist/index.js";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}
function expectDomainError(fn, code, msg) {
  try {
    fn();
  } catch (err) {
    assert(isDomainError(err), `${msg}: expected DomainError, got ${err}`);
    assert(err.code === code, `${msg}: expected code=${code}, got ${err.code}`);
    return;
  }
  throw new Error(`${msg}: expected throw ${code}, but nothing thrown`);
}

const { registry, migration, close } = createSqliteRepositoryRegistry({ filename: ":memory:" });
console.log("migrations applied:", migration.applied);

const ctx = { repos: registry, actor: "smoke" };
const story = new StoryService(ctx);
const assets = new AssetService(ctx);
const board = new StoryboardService(ctx);

// --- Project + seeded story bible ---
const project = story.createProject({
  name: "测试短剧",
  slug: "test-drama",
  outputSpec: { resolution: "1080p", fps: 30, subtitle: "burned", voiceover: "tts" },
});
assert(project.version === 1, "project v1");
assert(story.getStoryBible(project.id) !== null, "story bible seeded");
expectDomainError(
  () => story.createProject({ name: "x", slug: "test-drama", outputSpec: { resolution: "1080p", fps: 30, subtitle: "none", voiceover: "none" } }),
  "validation_failed",
  "duplicate slug",
);

// --- Episode + optimistic lock on confirm ---
const ep = story.createEpisode({
  projectId: project.id,
  episodeNo: 1,
  summary: "第一集梗概",
  episodeGoal: "目标",
});
expectDomainError(() => story.confirmEpisodeStory(ep.id, 999), "version_conflict", "stale episode confirm");
const epConfirmed = story.confirmEpisodeStory(ep.id, ep.version);
assert(epConfirmed.storyStatus === "confirmed", "episode story confirmed");
assert(story.getProjectStoryStatus(project.id) === "confirmed", "project story rollup confirmed");

// completeness: episode with no summary is blocking
const ep2 = story.createEpisode({ projectId: project.id, episodeNo: 2 });
const completeness = story.checkStoryCompleteness(project.id);
assert(completeness.projectSummary.totalEpisodes === 2, "2 episodes");
assert(completeness.projectSummary.blockingCount === 1, "ep2 blocks completeness");

// --- Asset: character look version chain ---
const hero = assets.createCharacter({ projectId: project.id, name: "主角" });
const look1 = assets.createCharacterLook({ characterId: hero.id, lookName: "初始造型" });
assert(look1.isDefault && look1.isCurrent && look1.versionNo === 1, "first look default+current v1");
const look2 = assets.createCharacterLookVersion(look1.id, { characterId: hero.id, lookName: "换装造型" });
assert(look2.versionNo === 2 && look2.isCurrent, "look v2 current");
assert(look2.lookGroupId === look1.lookGroupId, "same look group");
const reread1 = registry.characterLooks.getById(look1.id);
assert(reread1.isCurrent === false, "previous look no longer current");
const curDefault = registry.characterLooks.getCurrentDefault(hero.id);
assert(curDefault.id === look2.id, "default moved to v2");

// --- Storyboard: confirm gate + rollup ---
const scene = board.createScene({ episodeId: ep.id, sceneNo: 1, summary: "开场", sortOrder: 0 });
// episode was 'confirmed' storyboardStatus? recompute set to draft because scene is draft
assert(registry.episodes.getById(ep.id).storyboardStatus === "draft", "episode rollup draft after adding draft scene");
expectDomainError(() => board.confirmScene(scene.id, scene.version), "blocked_by_issue", "confirm scene with no shots");

const shot = board.createShot({ sceneId: scene.id, shotNo: 1, shotType: "中景", intent: "介绍主角", sortOrder: 0 });
const kfStart = board.createKeyframe({ shotId: shot.id, frameType: "start" });
const kfEnd = board.createKeyframe({ shotId: shot.id, frameType: "end" });
// not producible until confirmed
let v = board.validateStoryboard(scene.id);
assert(v.passable === false, "not passable before keyframe confirm");
board.confirmKeyframe(kfStart.id, kfStart.version);
board.confirmKeyframe(kfEnd.id, kfEnd.version);
v = board.validateStoryboard(scene.id);
assert(v.passable === true, "passable after both keyframes confirmed");
assert(v.shots[0].keyframeGate.producible === true, "shot producible");

const sceneConfirmed = board.confirmScene(scene.id, scene.version);
assert(sceneConfirmed.storyboardStatus === "confirmed", "scene confirmed");
assert(registry.episodes.getById(ep.id).storyboardStatus === "confirmed", "episode rollup confirmed (single scene)");

// --- blocked_by_reference on disable ---
board.addSceneCharacter({ sceneId: scene.id, characterId: hero.id });
expectDomainError(() => assets.disableCharacter(hero.id, hero.version), "blocked_by_reference", "disable referenced character");
board.removeSceneCharacter(scene.id, hero.id);
const disabled = assets.disableCharacter(hero.id, hero.version);
assert(disabled.status === "disabled", "character disabled after unlink");

// activity feed recorded
const feed = registry.activityEvents.listByProject(project.id);
assert(feed.length > 0, "activity events recorded");

// ============================================================
// ModelProfileService — create / view projection / credential test
// ============================================================
const mp = new ModelProfileService(ctx);
const boundProfile = mp.create({
  provider: "openai",
  modelType: "image",
  modelName: "gpt-image-1",
  endpointKey: "sk-secret-abcd1234",
});
const mpView = mp.getView(boundProfile.id);
assert(mpView !== null, "model profile view exists");
assert(mpView.credentialBound === true, "bound profile credentialBound true");
assert(mpView.credentialHint === "****1234", "credential hint masked to last 4");
assert(JSON.stringify(mpView).indexOf("secret") === -1, "raw secret never leaks into view");
const boundTest = mp.testCredential(boundProfile.id);
assert(boundTest.ok === true, "bound credential test ok");

const unboundProfile = mp.create({ provider: "local", modelType: "tts", modelName: "xtts-v2" });
const unboundView = mp.getView(unboundProfile.id);
assert(unboundView.credentialBound === false, "unbound profile credentialBound false");
assert(unboundView.credentialHint === undefined, "unbound profile has no credentialHint");
const unboundTest = mp.testCredential(unboundProfile.id);
assert(unboundTest.ok === false && unboundTest.errorCode === "provider_unavailable", "unbound credential test provider_unavailable");
assert(mp.list().length === 2, "two model profiles listed");

// ============================================================
// PromptCompilerService — compile / supersede / confirm
// ============================================================
const compiler = new PromptCompilerService(ctx);
// Prepare fact-layer context for a shot-level video prompt (uses a fresh character
// so the earlier disable-character assertions stay intact).
const loc = assets.createLocation({ projectId: project.id, name: "咖啡馆", visualSpec: { style: "暖色调" } });
const sceneNow = registry.scenes.getById(scene.id);
board.updateScene(scene.id, { version: sceneNow.version, locationId: loc.id });
const guest = assets.createCharacter({ projectId: project.id, name: "神秘访客" });
const guestLook = assets.createCharacterLook({ characterId: guest.id, lookName: "风衣造型" });
board.addShotCharacter({ shotId: shot.id, characterId: guest.id, lookId: guestLook.id });

const videoInput = compiler.assembleShotInput(shot.id, "video", boundProfile.id);
const spec1 = compiler.compile(videoInput);
assert(spec1.status === "draft", "compiled prompt is draft");
assert(spec1.targetType === "video", "compiled prompt target video");
assert(spec1.sections.length === 6, "video prompt has 6 fixed sections");
// compiledPrompt must be the ordered concatenation of the same sections
const expectedPrompt = spec1.sections.map((s) => `【${s.label}】\n${s.content}`).join("\n\n");
assert(spec1.compiledPrompt === expectedPrompt, "compiledPrompt equals ordered section concatenation");

// recompiling the same (source, target) supersedes the prior live spec
const spec2 = compiler.compile(compiler.assembleShotInput(shot.id, "video", boundProfile.id));
const spec1Reread = registry.promptSpecs.getById(spec1.id);
assert(spec1Reread.status === "superseded", "prior prompt superseded on recompile");
assert(spec1Reread.supersededBy === spec2.id, "supersededBy links to the new spec");
assert(spec2.status === "draft", "new spec is draft");

// confirm gate + optimistic lock
expectDomainError(() => compiler.confirmPrompt(spec2.id, 999), "version_conflict", "stale prompt confirm");
const confirmedSpec = compiler.confirmPrompt(spec2.id, spec2.version);
assert(confirmedSpec.status === "confirmed", "prompt confirmed");

// ============================================================
// JobOrchestratorService — state machine / artifact writeback / retry / cancel
// ============================================================
const jobs = new JobOrchestratorService(ctx);
const job = jobs.createJob({
  projectId: project.id,
  taskType: "video_generate",
  sourceEntityType: "shot",
  sourceEntityId: shot.id,
  promptSpecId: spec2.id,
  modelProfileId: boundProfile.id,
});
assert(job.status === "queued", "job created queued");
expectDomainError(() => jobs.completeJob(job.id), "invalid_state", "cannot complete a queued job");
assert(jobs.startJob(job.id).status === "running", "job -> running");
const done = jobs.completeJob(job.id, {
  outputPayload: { frames: 120 },
  artifacts: [{ artifactType: "video", filePath: "/tmp/out.mp4", metadata: { durationMs: 4000 } }],
});
assert(done.status === "succeeded", "job -> succeeded");
const arts = registry.artifacts.listByProject(project.id);
assert(arts.some((a) => a.sourceTaskId === job.id && a.status === "ready"), "artifact written back on completion");
expectDomainError(() => jobs.retryJob(job.id), "task_not_retryable", "cannot retry a succeeded job");

// fail -> retry creates a new queued task
const job2 = jobs.createJob({ projectId: project.id, taskType: "image_generate", sourceEntityType: "shot", sourceEntityId: shot.id });
jobs.startJob(job2.id);
const failed = jobs.failJob(job2.id, { errorCode: "internal_error", errorMessage: "provider 500" });
assert(failed.status === "failed", "job2 -> failed");
const retried = jobs.retryJob(job2.id);
assert(retried.status === "queued" && retried.retryCount === 1 && retried.retryOfTaskId === job2.id, "retry spawns queued task with retryCount+1");

// cancel from queued
const job3 = jobs.createJob({ projectId: project.id, taskType: "image_generate", sourceEntityType: "shot", sourceEntityId: shot.id });
assert(jobs.cancelJob(job3.id).status === "cancelled", "job3 -> cancelled");

// logs recorded across transitions
assert(jobs.listLogs(job.id).length >= 2, "job logs recorded (created + started + succeeded)");
assert(jobs.listJobs(project.id).length >= 4, "jobs listed by project");

// ============================================================
// ArtifactService — soft-delete + mark broken lifecycle
// ============================================================
const artifactSvc = new ArtifactService(ctx);
const shotArtifacts = artifactSvc.listBySource(project.id, "shot", shot.id);
assert(shotArtifacts.length >= 1, "artifacts listBySource returns the writeback");
const videoArtifact = shotArtifacts.find((a) => a.artifactType === "video");
assert(videoArtifact && videoArtifact.status === "ready", "video artifact is ready");
const brokenArt = artifactSvc.markBroken(videoArtifact.id, "hash mismatch");
assert(brokenArt.status === "broken", "artifact -> broken");
expectDomainError(
  () => artifactSvc.markBroken("no-such-artifact"),
  "missing_resource",
  "markBroken on missing artifact",
);
const deletedArt = artifactSvc.markDeleted(videoArtifact.id);
assert(deletedArt.status === "deleted", "artifact -> deleted");
expectDomainError(
  () => artifactSvc.markBroken(videoArtifact.id),
  "invalid_state",
  "cannot mark deleted artifact as broken",
);
assert(
  artifactSvc.listByProject(project.id, { status: "deleted" }).length >= 1,
  "artifact list filter by status",
);

// ============================================================
// ReviewService — run lifecycle + issue state machine + reopen dedupe + blocking gate
// ============================================================
const reviewSvc = new ReviewService(ctx);
const run = reviewSvc.createRun({
  projectId: project.id,
  scopeType: "episode",
  scopeRefId: ep.id,
  reviewTypes: ["story", "continuity"],
  runMode: "manual",
});
assert(run.status === "queued", "review run queued");
expectDomainError(
  () => reviewSvc.finishRun(run.id),
  "invalid_state",
  "cannot finish a queued run",
);
assert(reviewSvc.startRun(run.id).status === "running", "run -> running");

// finish with a mix of severities — verdict must be blocked because of the critical issue
const finished = reviewSvc.finishRun(run.id, {
  issues: [
    {
      projectId: project.id,
      issueType: "continuity",
      severity: "critical",
      ruleCode: "CONT-001",
      shotId: shot.id,
      title: "服装版本突变",
      evidence: { locationLabel: `shot ${shot.id}` },
    },
    {
      projectId: project.id,
      issueType: "story",
      severity: "low",
      title: "钩子偏弱（提示，不阻塞）",
    },
  ],
});
assert(finished.status === "succeeded", "run -> succeeded");
assert(finished.verdict === "blocked", "verdict blocked when critical issue present");

const issues = reviewSvc.listIssues(project.id);
const critical = issues.find((i) => i.ruleCode === "CONT-001");
assert(critical && critical.status === "open" && critical.severity === "critical", "critical issue open");

// blocking gate should trigger for downstream actions
expectDomainError(
  () => reviewSvc.assertNoBlockingIssues(project.id),
  "blocked_by_issue",
  "blocked_by_issue gate before critical is resolved",
);

// Prompt compile / task / export are all downstream — blocked_by_issue must fire.
expectDomainError(
  () => new ExportService(ctx).createExport({
    projectId: project.id,
    bundleType: "final_video",
    scopeType: "project",
    scopeRefId: project.id,
  }),
  "blocked_by_issue",
  "export creation blocked by open critical issue",
);

// resolve → gate clears
const resolved = reviewSvc.resolveIssue(critical.id, "已修正服装版本");
assert(resolved.status === "resolved", "issue -> resolved");
assert(
  reviewSvc.listIssueEvents(critical.id).some((e) => e.action === "resolve" && e.toStatus === "resolved"),
  "resolve event appended",
);
reviewSvc.assertNoBlockingIssues(project.id); // no throw

// reopen dedupe: a new run reports the same (ruleCode + shot) issue —
// the resolved issue must reopen instead of a duplicate being created.
const run2 = reviewSvc.createRun({
  projectId: project.id,
  scopeType: "episode",
  scopeRefId: ep.id,
  reviewTypes: ["continuity"],
  runMode: "manual",
});
reviewSvc.startRun(run2.id);
reviewSvc.finishRun(run2.id, {
  issues: [
    {
      projectId: project.id,
      issueType: "continuity",
      severity: "high",
      ruleCode: "CONT-001",
      shotId: shot.id,
      title: "服装版本再次突变",
    },
  ],
});
const critical2 = reviewSvc.getIssue(critical.id);
assert(critical2.status === "reopened", "resolved issue auto-reopened on re-run (dedupe)");
assert(
  reviewSvc.listIssues(project.id).filter((i) => i.ruleCode === "CONT-001").length === 1,
  "no duplicate issue created on re-run",
);
// clear gate by ignoring the reopened issue
const ignored = reviewSvc.ignoreIssue(critical.id, "版本策略允许微差");
assert(ignored.status === "ignored", "issue -> ignored");
expectDomainError(
  () => reviewSvc.ignoreIssue(critical.id, "already ignored"),
  "invalid_state",
  "cannot ignore an already-ignored issue",
);
reviewSvc.assertNoBlockingIssues(project.id); // no throw

// ============================================================
// ExportService — createExport / compose lifecycle / retry
// ============================================================
const exportSvc = new ExportService(ctx);
const bundle = exportSvc.createExport({
  projectId: project.id,
  bundleType: "final_video",
  scopeType: "project",
  scopeRefId: project.id,
  versionLabel: "v-alpha",
});
assert(bundle.status === "queued", "bundle queued");
assert(bundle.version === "v1", "version sequence starts at v1");
assert(bundle.composeTaskId, "bundle wired to compose task");

// simulate compose task lifecycle
exportSvc.startCompose(bundle.id);
const manifest = {
  bundleType: bundle.bundleType,
  version: bundle.version,
  createdAt: new Date().toISOString(),
  scope: { scopeType: "project", scopeRefId: project.id, scopeLabel: project.name },
  includedFiles: [{ path: "/tmp/final.mp4", sizeBytes: 12345 }],
  sourceRefs: [{ entityType: "shot", entityId: shot.id }],
  artifactRefs: [],
  promptRefs: [spec2.id],
  reviewRefs: [critical.id],
  counts: { includedArtifactsCount: 1, includedPromptCount: 1, includedReviewIssueCount: 1 },
};
const ready = exportSvc.completeCompose(bundle.id, {
  outputPath: "/tmp/final.mp4",
  manifest,
  bundleSizeBytes: 12345,
});
assert(ready.status === "ready", "bundle -> ready");
assert(ready.outputPath === "/tmp/final.mp4", "outputPath persisted on complete");
assert(ready.manifest.counts.includedReviewIssueCount === 1, "manifest counts persisted");
assert(ready.finishedAt, "finishedAt stamped");
// bundle artifact was created for downstream reference
const bundleArts = artifactSvc.listBySource(project.id, "export_bundle", bundle.id);
assert(bundleArts.some((a) => a.artifactType === "bundle" && a.status === "ready"), "bundle artifact created on completeCompose");

// second export → version v2
const bundle2 = exportSvc.createExport({
  projectId: project.id,
  bundleType: "final_video",
  scopeType: "project",
  scopeRefId: project.id,
});
assert(bundle2.version === "v2", "next export gets v2");

// fail + retry flow
exportSvc.startCompose(bundle2.id);
const failedBundle = exportSvc.failCompose(bundle2.id, {
  errorCode: "internal_error",
  errorMessage: "ffmpeg crash",
});
assert(failedBundle.status === "failed", "bundle2 -> failed");
assert(failedBundle.errorMessage === "ffmpeg crash", "bundle2 errorMessage recorded");
expectDomainError(
  () => exportSvc.retryExport(bundle.id),
  "invalid_state",
  "cannot retry a ready bundle",
);
const retriedBundle = exportSvc.retryExport(bundle2.id);
assert(retriedBundle.status === "queued", "retried bundle back to queued");
assert(retriedBundle.composeTaskId && retriedBundle.composeTaskId !== bundle2.composeTaskId, "retry rewires composeTaskId");

close();
console.log("SMOKE OK");
