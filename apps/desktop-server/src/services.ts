/**
 * Service bootstrap: instantiate all core-services on top of a
 * RepositoryRegistry. Routes receive this container via `c.get("services")`.
 */

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
  ContinuityService,
  ImageAssetService,
  VideoAssetService,
  RollbackService,
  ServiceContext,
} from "@dramaflow/core-services";
import { RepositoryRegistry } from "@dramaflow/domain";

export interface ServiceBundle {
  ctx: ServiceContext;
  story: StoryService;
  asset: AssetService;
  storyboard: StoryboardService;
  modelProfile: ModelProfileService;
  promptCompiler: PromptCompilerService;
  jobs: JobOrchestratorService;
  artifact: ArtifactService;
  review: ReviewService;
  export: ExportService;
  continuity: ContinuityService;
  imageAsset: ImageAssetService;
  videoAsset: VideoAssetService;
  rollback: RollbackService;
}

export function createServiceBundle(
  registry: RepositoryRegistry,
  actor?: string,
): ServiceBundle {
  const ctx: ServiceContext = { repos: registry, actor };
  const jobs = new JobOrchestratorService(ctx);
  const review = new ReviewService(ctx);
  return {
    ctx,
    story: new StoryService(ctx),
    asset: new AssetService(ctx),
    storyboard: new StoryboardService(ctx),
    modelProfile: new ModelProfileService(ctx),
    promptCompiler: new PromptCompilerService(ctx),
    jobs,
    artifact: new ArtifactService(ctx),
    review,
    export: new ExportService(ctx, { jobs, reviews: review }),
    continuity: new ContinuityService(ctx),
    imageAsset: new ImageAssetService(ctx),
    videoAsset: new VideoAssetService(ctx),
    rollback: new RollbackService(ctx),
  };
}
