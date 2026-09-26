/**
 * Zod validation schemas for API write boundaries (Story / Asset / Storyboard).
 * These validate request payloads before they reach services; they are the runtime
 * counterpart of the TS types in entities.ts / json-fields.ts.
 *
 * Optimistic-lock rule (adr-003): every PATCH on a versioned core entity must carry `version`.
 * Use `withVersion(schema)` to express that at the API boundary.
 */

import { z } from "zod";
import {
  CONTENT_TYPES,
  VISUAL_STYLE_PRESETS,
  isContentTypeSupported,
  type ContentType,
} from "./content-types.js";

// ===== shared =====

export const idSchema = z.string().min(1);
export const isoTimeSchema = z.string().min(1);
const jsonObject = z.record(z.unknown());

/** Wrap a patch schema so it carries the required optimistic-lock `version`. */
export function withVersion<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...shape, version: z.number().int().nonnegative() });
}

// ===== projects (Project Setup) =====

export const projectOutputSpecSchema = z.object({
  resolution: z.enum(["720p", "1080p", "4k"]),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  targetDurationSec: z.number().positive().optional(),
  subtitle: z.enum(["burned", "sidecar", "none"]),
  voiceover: z.enum(["tts", "none"]),
});

export const projectModelPolicySchema = z.object({
  imageProvider: z.string().optional(),
  videoProvider: z.string().optional(),
  ttsProvider: z.string().optional(),
  quality: z.enum(["draft", "standard", "high"]).optional(),
});

export const projectCreativeConstraintsSchema = z.object({
  forbiddenGenres: z.array(z.string()).default([]),
  styleTaboos: z.array(z.string()).default([]),
  contentBoundaries: z.array(z.string()).default([]),
});

// ContentType 枚举（drama vs series 的可用集合在下面 refine 中校验）
const contentTypeSchema = z.enum(
  CONTENT_TYPES as unknown as readonly [ContentType, ...ContentType[]],
);

// Visual style 用户输入：presetKey 与 customPrompt 至少给一个由调用方决定；
// 若均为空，schema 会自动 fallback 到该 ContentType 的 default preset。
const visualStyleInputSchema = z
  .object({
    presetKey: z.string().trim().min(1).optional(),
    customPrompt: z.string().trim().min(1).max(500).optional(),
  })
  .default({});

export const createProjectSchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1),
    status: z.enum(["draft", "active", "archived"]).default("draft"),
    projectType: z.enum(["series", "drama"]).default("drama"),
    /** A1: 内容形态，缺省 short_drama，需与 projectType 相容。 */
    contentType: contentTypeSchema.default("short_drama"),
    /** A1: 视觉风格输入；presetKey 需属于该 ContentType 的预设。 */
    visualStyle: visualStyleInputSchema,
    complianceMode: z.enum(["domestic", "overseas"]).default("domestic"),
    genre: z.string().optional(),
    audience: z.string().optional(),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
    targetDurationSec: z.number().positive().optional(),
    language: z.string().default("zh-CN"),
    outputSpec: projectOutputSpecSchema.default({
      resolution: "1080p",
      fps: 30,
      subtitle: "burned",
      voiceover: "tts",
    }),
    modelPolicy: projectModelPolicySchema.default({}),
    creativeConstraints: projectCreativeConstraintsSchema.default({
      forbiddenGenres: [],
      styleTaboos: [],
      contentBoundaries: [],
    }),
  })
  .superRefine((data, ctx) => {
    // 1) contentType 必须在 projectType 支持列表内
    if (!isContentTypeSupported(data.projectType, data.contentType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentType"],
        message: `content type "${data.contentType}" not supported for project type "${data.projectType}"`,
      });
    }
    // 2) visualStyle.presetKey 必须属于该 contentType 的预设
    const preset = data.visualStyle?.presetKey;
    if (preset) {
      const presets = VISUAL_STYLE_PRESETS[data.contentType];
      if (!presets.some((p) => p.key === preset)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["visualStyle", "presetKey"],
          message: `visual style preset "${preset}" not available for content type "${data.contentType}"`,
        });
      }
    }
  });

export const updateProjectSchema = withVersion({
  name: z.string().min(1).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  projectType: z.enum(["series", "drama"]).optional(),
  contentType: contentTypeSchema.optional(),
  visualStyle: visualStyleInputSchema.optional(),
  complianceMode: z.enum(["domestic", "overseas"]).optional(),
  genre: z.string().optional(),
  audience: z.string().optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  targetDurationSec: z.number().positive().optional(),
  language: z.string().optional(),
  outputSpec: projectOutputSpecSchema.optional(),
  modelPolicy: projectModelPolicySchema.optional(),
  creativeConstraints: projectCreativeConstraintsSchema.optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// ===== episodes (Story Workspace) =====

export const createEpisodeSchema = z.object({
  projectId: idSchema,
  episodeNo: z.number().int().positive(),
  title: z.string().optional(),
  summary: z.string().optional(),
  hookType: z.string().optional(),
  episodeGoal: z.string().optional(),
  episodeConflict: z.string().optional(),
  episodeTurn: z.string().optional(),
  episodeEndingHook: z.string().optional(),
});

export const updateEpisodeSchema = withVersion({
  title: z.string().optional(),
  summary: z.string().optional(),
  hookType: z.string().optional(),
  episodeGoal: z.string().optional(),
  episodeConflict: z.string().optional(),
  episodeTurn: z.string().optional(),
  episodeEndingHook: z.string().optional(),
  learningAnchor: z.string().optional(),
  ageHint: z.string().optional(),
  sceneCountEstimate: z.number().int().positive().optional(),
  arcBeats: z.array(jsonObject).optional(),
});

export type CreateEpisodeInput = z.infer<typeof createEpisodeSchema>;
export type UpdateEpisodeInput = z.infer<typeof updateEpisodeSchema>;

// ===== story bible =====

export const updateStoryBibleSchema = withVersion({
  logline: z.string().optional(),
  theme: z.string().optional(),
  tone: z.string().optional(),
  worldRules: jsonObject.optional(),
  hookSystem: jsonObject.optional(),
  pacingPlan: jsonObject.optional(),
  villainSystem: jsonObject.optional(),
  characterRelations: jsonObject.optional(),
});

export type UpdateStoryBibleInput = z.infer<typeof updateStoryBibleSchema>;

// ===== characters / looks / locations / props (Asset Ledger) =====

export const createCharacterSchema = z.object({
  projectId: idSchema,
  /** A1 scope: 传入 = 该集专属；不传 = 项目级资产（drama 默认，series 跨集共用）。 */
  episodeId: idSchema.optional(),
  name: z.string().min(1),
  roleType: z.string().optional(),
  genderPresentation: z.string().optional(),
  ageRange: z.string().optional(),
  identitySummary: z.string().optional(),
  personality: z.string().optional(),
  motivation: z.string().optional(),
  taboos: z.string().optional(),
  speechStyle: z.string().optional(),
  visualLock: z.string().optional(),
});

export const updateCharacterSchema = withVersion({
  name: z.string().min(1).optional(),
  roleType: z.string().optional(),
  genderPresentation: z.string().optional(),
  ageRange: z.string().optional(),
  identitySummary: z.string().optional(),
  personality: z.string().optional(),
  motivation: z.string().optional(),
  taboos: z.string().optional(),
  speechStyle: z.string().optional(),
  visualLock: z.string().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const createCharacterLookSchema = z.object({
  characterId: idSchema,
  lookName: z.string().min(1),
  lookType: z.string().optional(),
  appearanceSpec: jsonObject.default({}),
  hairSpec: jsonObject.default({}),
  makeupSpec: jsonObject.default({}),
  wardrobeSpec: jsonObject.default({}),
  propsSpec: jsonObject.default({}),
  continuityRules: jsonObject.default({}),
  isDefault: z.boolean().default(false),
  createdBy: z.string().optional(),
  changeSummary: z.string().optional(),
});

export const createLocationSchema = z.object({
  projectId: idSchema,
  /** A1 scope: 传入 = 该集专属；不传 = 项目级。 */
  episodeId: idSchema.optional(),
  name: z.string().min(1),
  locationType: z.string().optional(),
  visualSpec: jsonObject.default({}),
  spaceRules: jsonObject.default({}),
  lightingRules: jsonObject.default({}),
  continuityRules: jsonObject.default({}),
  visualLock: z.string().optional(),
});

export const updateLocationSchema = withVersion({
  name: z.string().min(1).optional(),
  locationType: z.string().optional(),
  visualSpec: jsonObject.optional(),
  spaceRules: jsonObject.optional(),
  lightingRules: jsonObject.optional(),
  continuityRules: jsonObject.optional(),
  visualLock: z.string().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const createPropSchema = z.object({
  projectId: idSchema,
  /** A1 scope: 传入 = 该集专属；不传 = 项目级。 */
  episodeId: idSchema.optional(),
  name: z.string().min(1),
  propType: z.string().optional(),
  visualSpec: jsonObject.default({}),
  ownership: jsonObject.default({}),
  continuityRules: jsonObject.default({}),
  visualLock: z.string().optional(),
});

export const updatePropSchema = withVersion({
  name: z.string().min(1).optional(),
  propType: z.string().optional(),
  visualSpec: jsonObject.optional(),
  ownership: jsonObject.optional(),
  continuityRules: jsonObject.optional(),
  visualLock: z.string().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;
export type UpdateCharacterInput = z.infer<typeof updateCharacterSchema>;
export type CreateCharacterLookInput = z.infer<typeof createCharacterLookSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type CreatePropInput = z.infer<typeof createPropSchema>;
export type UpdatePropInput = z.infer<typeof updatePropSchema>;

// ===== scenes / shots / keyframes (Storyboard Studio) =====

export const createSceneSchema = z.object({
  episodeId: idSchema,
  sceneNo: z.number().int().positive(),
  title: z.string().optional(),
  locationId: idSchema.optional(),
  timeOfDay: z.string().optional(),
  summary: z.string().optional(),
  dramaticGoal: z.string().optional(),
  conflict: z.string().optional(),
  sceneTags: z.array(z.string()).default([]),
  entryState: jsonObject.default({}),
  exitState: jsonObject.default({}),
  sortOrder: z.number().int().nonnegative(),
});

export const updateSceneSchema = withVersion({
  title: z.string().optional(),
  locationId: idSchema.optional(),
  timeOfDay: z.string().optional(),
  summary: z.string().optional(),
  dramaticGoal: z.string().optional(),
  conflict: z.string().optional(),
  sceneTags: z.array(z.string()).optional(),
  entryState: jsonObject.optional(),
  exitState: jsonObject.optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const createShotSchema = z.object({
  sceneId: idSchema,
  shotNo: z.number().int().positive(),
  shotType: z.string().optional(),
  intent: z.string().optional(),
  cameraPlan: jsonObject.default({}),
  performanceNotes: z.string().optional(),
  startState: jsonObject.default({}),
  endState: jsonObject.default({}),
  handoffAnchor: jsonObject.default({}),
  isKeyShot: z.boolean().default(false),
  durationSec: z.number().positive().optional(),
  dialogue: z.string().optional(),
  action: z.string().optional(),
  sortOrder: z.number().int().nonnegative(),
});

export const updateShotSchema = withVersion({
  shotType: z.string().optional(),
  intent: z.string().optional(),
  cameraPlan: jsonObject.optional(),
  performanceNotes: z.string().optional(),
  startState: jsonObject.optional(),
  endState: jsonObject.optional(),
  handoffAnchor: jsonObject.optional(),
  isKeyShot: z.boolean().optional(),
  durationSec: z.number().positive().optional(),
  dialogue: z.string().optional(),
  action: z.string().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const createKeyframeSchema = z.object({
  shotId: idSchema,
  frameType: z.enum(["start", "end", "key"]),
  composition: jsonObject.default({}),
  subjectLayout: jsonObject.default({}),
  expressionPose: jsonObject.default({}),
  backgroundRequirement: jsonObject.default({}),
  continuityAnchor: jsonObject.default({}),
  promptSummary: z.string().optional(),
});

export const updateKeyframeSchema = withVersion({
  frameType: z.enum(["start", "end", "key"]).optional(),
  composition: jsonObject.optional(),
  subjectLayout: jsonObject.optional(),
  expressionPose: jsonObject.optional(),
  backgroundRequirement: jsonObject.optional(),
  continuityAnchor: jsonObject.optional(),
  promptSummary: z.string().optional(),
});

export const createDialogueBlockSchema = z.object({
  sceneId: idSchema,
  speakerCharacterId: idSchema.optional(),
  text: z.string().min(1),
  emotion: z.string().optional(),
  deliveryNote: z.string().optional(),
  sortOrder: z.number().int().nonnegative(),
});

export const createActionBlockSchema = z.object({
  sceneId: idSchema,
  actionText: z.string().min(1),
  actorRefs: z.array(idSchema).default([]),
  propRefs: z.array(idSchema).default([]),
  sortOrder: z.number().int().nonnegative(),
});

export type CreateSceneInput = z.infer<typeof createSceneSchema>;
export type UpdateSceneInput = z.infer<typeof updateSceneSchema>;
export type CreateShotInput = z.infer<typeof createShotSchema>;
export type UpdateShotInput = z.infer<typeof updateShotSchema>;
export type CreateKeyframeInput = z.infer<typeof createKeyframeSchema>;
export type UpdateKeyframeInput = z.infer<typeof updateKeyframeSchema>;
export type CreateDialogueBlockInput = z.infer<typeof createDialogueBlockSchema>;
export type CreateActionBlockInput = z.infer<typeof createActionBlockSchema>;

// ===== model profiles (Model Settings §) =====
// model_profiles is timestamped (no version column) — updates are not optimistic-locked.

export const createModelProfileSchema = z.object({
  provider: z.string().min(1),
  modelType: z.enum(["llm", "image", "video", "tts"]),
  modelName: z.string().min(1),
  /** Reference key only, never the raw secret (adr-001). */
  endpointKey: z.string().min(1).optional(),
  defaultParams: jsonObject.default({}),
  isActive: z.boolean().default(true),
});

export const updateModelProfileSchema = z.object({
  provider: z.string().min(1).optional(),
  modelType: z.enum(["llm", "image", "video", "tts"]).optional(),
  modelName: z.string().min(1).optional(),
  endpointKey: z.string().min(1).optional(),
  defaultParams: jsonObject.optional(),
  isActive: z.boolean().optional(),
});

export type CreateModelProfileInput = z.infer<typeof createModelProfileSchema>;
export type UpdateModelProfileInput = z.infer<typeof updateModelProfileSchema>;

// ===== A1 scope 扩展：ContinuityLock / EpisodeAssetRef =====

export const continuityLockAppliesToSchema = z.object({
  characterIds: z.array(idSchema).optional(),
  locationIds: z.array(idSchema).optional(),
  propIds: z.array(idSchema).optional(),
  shotIds: z.array(idSchema).optional(),
  note: z.string().optional(),
});

export const createContinuityLockSchema = z.object({
  projectId: idSchema,
  episodeId: idSchema.optional(),
  scope: z.enum(["project", "episode", "scene"]).default("project"),
  lockPhrase: z.string().min(1),
  appliesTo: continuityLockAppliesToSchema.default({}),
  status: z.enum(["active", "disabled"]).default("active"),
});

export const updateContinuityLockSchema = z.object({
  lockPhrase: z.string().min(1).optional(),
  appliesTo: continuityLockAppliesToSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const attachEpisodeAssetRefSchema = z.object({
  episodeId: idSchema,
  assetType: z.enum(["character", "location", "prop"]),
  assetId: idSchema,
  note: z.string().optional(),
});

export type CreateContinuityLockInput = z.infer<typeof createContinuityLockSchema>;
export type UpdateContinuityLockInput = z.infer<typeof updateContinuityLockSchema>;
export type AttachEpisodeAssetRefInput = z.infer<typeof attachEpisodeAssetRefSchema>;
