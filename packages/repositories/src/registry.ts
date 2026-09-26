import type { RepositoryRegistry } from "@dramaflow/domain";
import { openDatabase, type SqliteDatabase, type OpenDatabaseOptions } from "./sqlite/connection.js";
import { runMigrations, loadMigrations, type MigrationResult } from "./sqlite/migrator.js";
import {
  SqliteProjectRepository,
  SqliteProjectStoryBibleRepository,
  SqliteEpisodeRepository,
} from "./repositories/story.js";
import {
  SqliteCharacterRepository,
  SqliteCharacterLookRepository,
  SqliteLocationRepository,
  SqlitePropRepository,
  SqliteStyleGuideRepository,
} from "./repositories/asset.js";
import {
  SqliteSceneRepository,
  SqliteShotRepository,
  SqliteKeyframeSpecRepository,
  SqliteContinuityAnchorRepository,
  SqliteSceneDialogueBlockRepository,
  SqliteSceneActionBlockRepository,
  SqliteSceneCharacterRepository,
  SqliteShotCharacterRepository,
  SqliteShotPropRepository,
} from "./repositories/storyboard.js";
import {
  SqliteModelProfileRepository,
  SqlitePromptSpecRepository,
  SqliteGenerationTaskRepository,
  SqliteTaskLogRepository,
  SqliteArtifactRepository,
} from "./repositories/execution.js";
import {
  SqliteReviewRunRepository,
  SqliteReviewIssueRepository,
  SqliteReviewIssueEventRepository,
  SqliteScriptSnapshotRepository,
  SqliteActivityEventRepository,
  SqliteExportBundleRepository,
} from "./repositories/review.js";
import {
  SqliteContinuityLockRepository,
  SqliteEpisodeAssetRefRepository,
} from "./repositories/scope.js";
import { SqliteImageAssetRepository } from "./repositories/image-asset.js";
import { SqliteVideoAssetRepository } from "./repositories/video-asset.js";
import { SqliteEntitySnapshotRepository } from "./repositories/entity-snapshot.js";
import { installSnapshotSink, runWithoutSnapshot } from "./repositories/base.js";

/**
 * Concrete SQLite-backed RepositoryRegistry. Wires every repository against a single
 * connection and provides an atomic `transaction` boundary (better-sqlite3 nests via savepoints).
 */
export class SqliteRepositoryRegistry implements RepositoryRegistry {
  readonly projects: SqliteProjectRepository;
  readonly storyBibles: SqliteProjectStoryBibleRepository;
  readonly episodes: SqliteEpisodeRepository;
  readonly characters: SqliteCharacterRepository;
  readonly characterLooks: SqliteCharacterLookRepository;
  readonly locations: SqliteLocationRepository;
  readonly props: SqlitePropRepository;
  readonly styleGuides: SqliteStyleGuideRepository;
  readonly scenes: SqliteSceneRepository;
  readonly sceneDialogueBlocks: SqliteSceneDialogueBlockRepository;
  readonly sceneActionBlocks: SqliteSceneActionBlockRepository;
  readonly shots: SqliteShotRepository;
  readonly keyframeSpecs: SqliteKeyframeSpecRepository;
  readonly continuityAnchors: SqliteContinuityAnchorRepository;
  readonly sceneCharacters: SqliteSceneCharacterRepository;
  readonly shotCharacters: SqliteShotCharacterRepository;
  readonly shotProps: SqliteShotPropRepository;
  readonly promptSpecs: SqlitePromptSpecRepository;
  readonly modelProfiles: SqliteModelProfileRepository;
  readonly generationTasks: SqliteGenerationTaskRepository;
  readonly taskLogs: SqliteTaskLogRepository;
  readonly artifacts: SqliteArtifactRepository;
  readonly reviewIssues: SqliteReviewIssueRepository;
  readonly reviewRuns: SqliteReviewRunRepository;
  readonly reviewIssueEvents: SqliteReviewIssueEventRepository;
  readonly scriptSnapshots: SqliteScriptSnapshotRepository;
  readonly activityEvents: SqliteActivityEventRepository;
  readonly exportBundles: SqliteExportBundleRepository;
  readonly continuityLocks: SqliteContinuityLockRepository;
  readonly episodeAssetRefs: SqliteEpisodeAssetRefRepository;
  readonly imageAssets: SqliteImageAssetRepository;
  readonly videoAssets: SqliteVideoAssetRepository;
  readonly entitySnapshots: SqliteEntitySnapshotRepository;

  constructor(private readonly db: SqliteDatabase) {
    this.projects = new SqliteProjectRepository(db);
    this.storyBibles = new SqliteProjectStoryBibleRepository(db);
    this.episodes = new SqliteEpisodeRepository(db);
    this.characters = new SqliteCharacterRepository(db);
    this.characterLooks = new SqliteCharacterLookRepository(db);
    this.locations = new SqliteLocationRepository(db);
    this.props = new SqlitePropRepository(db);
    this.styleGuides = new SqliteStyleGuideRepository(db);
    this.scenes = new SqliteSceneRepository(db);
    this.sceneDialogueBlocks = new SqliteSceneDialogueBlockRepository(db);
    this.sceneActionBlocks = new SqliteSceneActionBlockRepository(db);
    this.shots = new SqliteShotRepository(db);
    this.keyframeSpecs = new SqliteKeyframeSpecRepository(db);
    this.continuityAnchors = new SqliteContinuityAnchorRepository(db);
    this.sceneCharacters = new SqliteSceneCharacterRepository(db);
    this.shotCharacters = new SqliteShotCharacterRepository(db);
    this.shotProps = new SqliteShotPropRepository(db);
    this.promptSpecs = new SqlitePromptSpecRepository(db);
    this.modelProfiles = new SqliteModelProfileRepository(db);
    this.generationTasks = new SqliteGenerationTaskRepository(db);
    this.taskLogs = new SqliteTaskLogRepository(db);
    this.artifacts = new SqliteArtifactRepository(db);
    this.reviewIssues = new SqliteReviewIssueRepository(db);
    this.reviewRuns = new SqliteReviewRunRepository(db);
    this.reviewIssueEvents = new SqliteReviewIssueEventRepository(db);
    this.scriptSnapshots = new SqliteScriptSnapshotRepository(db);
    this.activityEvents = new SqliteActivityEventRepository(db);
    this.exportBundles = new SqliteExportBundleRepository(db);
    this.continuityLocks = new SqliteContinuityLockRepository(db);
    this.episodeAssetRefs = new SqliteEpisodeAssetRefRepository(db);
    this.imageAssets = new SqliteImageAssetRepository(db);
    this.videoAssets = new SqliteVideoAssetRepository(db);
    this.entitySnapshots = new SqliteEntitySnapshotRepository(db);
    // Round-3 P1-①：把通用快照 sink 注入到 VersionedRepositoryBase.update 的钩子上。
    // 每 registry 实例都会重新注册，最后一次注册胜出——桌面应用同一时间只跑一个 DB，
    // 因此这个"最后写入者胜出"的语义等价于绑定当前活动 DB。
    installSnapshotSink(({ entityType, entityId, version, payload, reason }) => {
      try {
        this.entitySnapshots.append({
          entityType,
          entityId,
          version,
          payloadJson: JSON.stringify(payload),
          reason,
        });
      } catch {
        // 快照失败不能影响主流程；如需诊断可以在此处接入 logger。
      }
    });
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  runWithoutSnapshot<T>(fn: () => T): T {
    return runWithoutSnapshot(fn);
  }
}

export interface CreateRegistryOptions extends OpenDatabaseOptions {
  /** Run pending migrations on open (default true). */
  migrate?: boolean;
}

export interface CreatedRegistry {
  registry: SqliteRepositoryRegistry;
  db: SqliteDatabase;
  migration: MigrationResult | null;
  close(): void;
}

/**
 * Open a SQLite database, apply migrations (adr-005), and build the repository registry.
 * This is the single entry point used by apps/desktop-server bootstrap.
 */
export function createSqliteRepositoryRegistry(
  options: CreateRegistryOptions,
): CreatedRegistry {
  const db = openDatabase(options);
  let migration: MigrationResult | null = null;
  if (options.migrate !== false) {
    migration = runMigrations(db, loadMigrations());
  }
  const registry = new SqliteRepositoryRegistry(db);
  return {
    registry,
    db,
    migration,
    close: () => db.close(),
  };
}
