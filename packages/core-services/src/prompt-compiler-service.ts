/**
 * PromptCompilerService — the single exit for execution prompts
 * (prompt-compiler-contract-v1.md, data-and-api-v1.md §10 step 5).
 *
 * Reads the fact layer only, assembles a standardized `PromptCompilerInput`, and
 * emits a versioned `PromptSpec` (draft). It never calls a provider, never creates
 * tasks, and never mutates story/asset/storyboard facts (contract §2/§11).
 *
 * Recompiling the same (sourceEntity, targetType) supersedes prior draft/confirmed
 * specs (contract §12.2). `compiledPrompt` is the ordered concatenation of `sections`
 * produced in the same pass (contract §6.1).
 *
 * NOTE: `PromptCompilerInput` adds one optional field beyond contract §9 —
 * `dialogueBlocks` — because TTS section content is dialogue-driven and §9's shape
 * does not otherwise carry it. It is optional, so callers matching §9 still type-check.
 */

import type {
  Project,
  ProjectStoryBible,
  Episode,
  Scene,
  Shot,
  KeyframeSpec,
  ContinuityAnchor,
  Character,
  CharacterLook,
  Location,
  Prop,
  ModelProfile,
  PromptSpec,
  PromptSection,
  SceneDialogueBlock,
  Id,
} from "@dramaflow/domain";
import { missingResource, invalidState, CONTENT_TYPE_REGISTRY } from "@dramaflow/domain";
import { BaseService } from "./context.js";

/** Standardized compiler input (prompt-compiler-contract §9, +optional dialogueBlocks). */
export interface PromptCompilerInput {
  project: Project;
  storyBible?: ProjectStoryBible;
  episode?: Episode;
  scene?: Scene;
  shot?: Shot;
  characters: Character[];
  characterLooks: CharacterLook[];
  location?: Location;
  props: Prop[];
  keyframes: KeyframeSpec[];
  continuityAnchors: ContinuityAnchor[];
  dialogueBlocks?: SceneDialogueBlock[];
  modelProfile?: ModelProfile;
  targetType: "image" | "video" | "tts";
  sourceEntityType: "character" | "location" | "scene" | "shot" | "episode" | "keyframe";
  sourceEntityId: Id;
}

type SourceRef = { entityType: string; entityId: Id; version?: number };

function renderSpec(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}

function refsOf(
  entityType: string,
  items: Array<{ id: Id; version?: number }>,
): SourceRef[] {
  return items.map((i) =>
    i.version !== undefined
      ? { entityType, entityId: i.id, version: i.version }
      : { entityType, entityId: i.id },
  );
}

function section(
  key: string,
  label: string,
  content: string,
  sourceRefs: SourceRef[],
): PromptSection {
  return { key, label, content: content.trim() === "" ? "（无）" : content, sourceRefs };
}

export class PromptCompilerService extends BaseService {
  // ===== public compile API (contract §15.1) =====

  compile(input: PromptCompilerInput): PromptSpec {
    this.assertSourcePresent(input);
    this.assertDependencies(input);

    const sections = this.buildSections(input);
    const compiledPrompt = sections
      .map((s) => `【${s.label}】\n${s.content}`)
      .join("\n\n");
    const compilerVersion = `${input.targetType}-compiler@1.0.0`;
    const snapshot = this.buildSnapshot(input);

    return this.repos.transaction(() => {
      const prior = this.repos.promptSpecs
        .listBySource(input.sourceEntityType, input.sourceEntityId)
        .filter(
          (p) =>
            p.targetType === input.targetType &&
            (p.status === "draft" || p.status === "confirmed"),
        );

      const spec = this.repos.promptSpecs.create({
        projectId: input.project.id,
        episodeId: input.episode?.id,
        sceneId: input.scene?.id,
        shotId: input.shot?.id,
        keyframeId: input.sourceEntityType === "keyframe" ? input.sourceEntityId : undefined,
        targetType: input.targetType,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        compiledPrompt,
        sections,
        modelProfileId: input.modelProfile?.id,
        compilerVersion,
        sourceVersionSnapshot: snapshot,
        status: "draft",
      });

      // Supersede prior live versions (contract §12.2), linking them to the new spec.
      for (const p of prior) {
        this.repos.promptSpecs.update(
          p.id,
          { status: "superseded", supersededBy: spec.id },
          p.version,
        );
      }

      this.logActivity({
        projectId: input.project.id,
        eventType: "prompt.compiled",
        summary: `编译 ${input.targetType} prompt（${input.sourceEntityType}）`,
        targetRef: { entityType: "prompt", entityId: spec.id },
        payload: {
          count: prior.length,
          extra: {
            targetType: input.targetType,
            sourceEntityType: input.sourceEntityType,
            sourceEntityId: input.sourceEntityId,
            supersededCount: prior.length,
          },
        },
      });
      return spec;
    });
  }

  compileImage(input: PromptCompilerInput): PromptSpec {
    return this.compile({ ...input, targetType: "image" });
  }

  compileVideo(input: PromptCompilerInput): PromptSpec {
    return this.compile({ ...input, targetType: "video" });
  }

  compileTTS(input: PromptCompilerInput): PromptSpec {
    return this.compile({ ...input, targetType: "tts" });
  }

  /** Confirm a compiled prompt (draft -> confirmed, contract §13). */
  confirmPrompt(id: Id, expectedVersion: number): PromptSpec {
    return this.repos.transaction(() => {
      const spec = this.repos.promptSpecs.getById(id);
      if (!spec) throw missingResource(`Prompt 不存在：${id}`, { id });
      if (spec.status !== "draft") {
        throw invalidState("仅 draft 状态的 prompt 可确认", { id, status: spec.status });
      }
      return this.repos.promptSpecs.update(id, { status: "confirmed" }, expectedVersion);
    });
  }

  // ===== input assemblers (contract §8 step 4) =====

  /** Assemble the compiler input for a shot-level image/video prompt from the fact layer. */
  assembleShotInput(
    shotId: Id,
    targetType: "image" | "video",
    modelProfileId?: Id,
  ): PromptCompilerInput {
    const shot = this.repos.shots.getById(shotId);
    if (!shot) throw missingResource(`镜头不存在：${shotId}`, { shotId });
    const scene = this.repos.scenes.getById(shot.sceneId);
    if (!scene) throw missingResource(`分镜场不存在：${shot.sceneId}`, { id: shot.sceneId });
    const episode = this.repos.episodes.getById(scene.episodeId);
    if (!episode) throw missingResource(`剧集不存在：${scene.episodeId}`, { id: scene.episodeId });
    const project = this.repos.projects.getById(episode.projectId);
    if (!project) throw missingResource(`项目不存在：${episode.projectId}`, { id: episode.projectId });

    const shotChars = this.repos.shotCharacters.listByShot(shotId);
    const characters: Character[] = [];
    const looks: CharacterLook[] = [];
    for (const sc of shotChars) {
      const c = this.repos.characters.getById(sc.characterId);
      if (c) characters.push(c);
      const look = sc.lookId
        ? this.repos.characterLooks.getById(sc.lookId)
        : this.repos.characterLooks.getCurrentDefault(sc.characterId);
      if (look) looks.push(look);
    }

    let location: Location | undefined;
    if (scene.locationId) {
      const loc = this.repos.locations.getById(scene.locationId);
      if (loc) location = loc;
    }

    const props: Prop[] = [];
    for (const sp of this.repos.shotProps.listByShot(shotId)) {
      const p = this.repos.props.getById(sp.propId);
      if (p) props.push(p);
    }

    const input: PromptCompilerInput = {
      project,
      episode,
      scene,
      shot,
      characters,
      characterLooks: looks,
      props,
      keyframes: this.repos.keyframeSpecs.listByShot(shotId),
      continuityAnchors: this.repos.continuityAnchors.listByShot(shotId),
      targetType,
      sourceEntityType: "shot",
      sourceEntityId: shotId,
    };
    const bible = this.repos.storyBibles.getByProjectId(project.id);
    if (bible) input.storyBible = bible;
    if (location) input.location = location;
    if (modelProfileId) {
      const mp = this.repos.modelProfiles.getById(modelProfileId);
      if (mp) input.modelProfile = mp;
    }
    return input;
  }

  /** Assemble the compiler input for a scene-level TTS prompt. */
  assembleSceneTtsInput(sceneId: Id, modelProfileId?: Id): PromptCompilerInput {
    const scene = this.repos.scenes.getById(sceneId);
    if (!scene) throw missingResource(`分镜场不存在：${sceneId}`, { sceneId });
    const episode = this.repos.episodes.getById(scene.episodeId);
    if (!episode) throw missingResource(`剧集不存在：${scene.episodeId}`, { id: scene.episodeId });
    const project = this.repos.projects.getById(episode.projectId);
    if (!project) throw missingResource(`项目不存在：${episode.projectId}`, { id: episode.projectId });

    const characters: Character[] = [];
    for (const sc of this.repos.sceneCharacters.listByScene(sceneId)) {
      const c = this.repos.characters.getById(sc.characterId);
      if (c) characters.push(c);
    }

    const input: PromptCompilerInput = {
      project,
      episode,
      scene,
      characters,
      characterLooks: [],
      props: [],
      keyframes: [],
      continuityAnchors: [],
      dialogueBlocks: this.repos.sceneDialogueBlocks.listByScene(sceneId),
      targetType: "tts",
      sourceEntityType: "scene",
      sourceEntityId: sceneId,
    };
    if (modelProfileId) {
      const mp = this.repos.modelProfiles.getById(modelProfileId);
      if (mp) input.modelProfile = mp;
    }
    return input;
  }

  // ===== validation (contract §8 step 1, §16) =====

  private assertSourcePresent(input: PromptCompilerInput): void {
    const { sourceEntityType: t, sourceEntityId: id } = input;
    const ok =
      (t === "shot" && input.shot?.id === id) ||
      (t === "scene" && input.scene?.id === id) ||
      (t === "episode" && input.episode?.id === id) ||
      (t === "location" && input.location?.id === id) ||
      (t === "keyframe" && input.keyframes.some((k) => k.id === id)) ||
      (t === "character" && input.characters.some((c) => c.id === id));
    if (!ok) {
      throw missingResource(`编译来源实体缺失：${t}#${id}`, { sourceEntityType: t, sourceEntityId: id });
    }
  }

  private assertDependencies(input: PromptCompilerInput): void {
    const visual = input.targetType === "image" || input.targetType === "video";
    if (visual && input.sourceEntityType === "shot") {
      if (!input.location) {
        throw missingResource("镜头缺少场景/地点，无法编译画面 prompt", {
          shotId: input.shot?.id,
        });
      }
      for (const c of input.characters) {
        if (!input.characterLooks.some((l) => l.characterId === c.id)) {
          throw missingResource(`角色缺少可用造型：${c.name}`, { characterId: c.id });
        }
      }
    }
    if (input.targetType === "video" && input.sourceEntityType === "shot") {
      const hasStart = input.keyframes.some((k) => k.frameType === "start");
      const hasEnd = input.keyframes.some((k) => k.frameType === "end");
      if (!hasStart || !hasEnd) {
        throw missingResource("视频编译缺少起止关键帧（start/end）", {
          shotId: input.shot?.id,
          hasStart,
          hasEnd,
        });
      }
    }
  }

  // ===== section builders (contract §10.3 fixed structure per target type) =====

  private buildSections(input: PromptCompilerInput): PromptSection[] {
    switch (input.targetType) {
      case "image":
        return this.buildImageSections(input);
      case "video":
        return this.buildVideoSections(input);
      case "tts":
        return this.buildTtsSections(input);
    }
  }

  private charactersContent(input: PromptCompilerInput): string {
    return input.characters
      .map((c) => (c.identitySummary ? `${c.name}（${c.identitySummary}）` : c.name))
      .join("；");
  }

  private looksContent(input: PromptCompilerInput): string {
    return input.characterLooks
      .map((l) => {
        const body = [
          renderSpec(l.appearanceSpec),
          renderSpec(l.wardrobeSpec),
          renderSpec(l.hairSpec),
          renderSpec(l.makeupSpec),
        ]
          .filter((s) => s !== "")
          .join("\n");
        return `# ${l.lookName}\n${body}`;
      })
      .join("\n\n");
  }

  private locationContent(input: PromptCompilerInput): string {
    if (!input.location) return "";
    return [
      renderSpec(input.location.visualSpec),
      renderSpec(input.location.spaceRules),
      renderSpec(input.location.lightingRules),
    ]
      .filter((s) => s !== "")
      .join("\n");
  }

  /**
   * A1: 项目级「内容形态 + 视觉风格」注入。
   * 内容形态给模型一个中文类型语义（如"皮克斯 3D 动画"），
   * 视觉风格 resolvedPrompt 是精炼英文关键词，供 image/video 模型识别。
   * 注意：本 section 冗余来源为 project.contentType / project.visualStyle。
   */
  private contentStyleContent(input: PromptCompilerInput): string {
    const meta = CONTENT_TYPE_REGISTRY[input.project.contentType];
    const style = input.project.visualStyle?.resolvedPrompt?.trim() ?? "";
    const lines: string[] = [];
    if (meta) {
      lines.push(`Content type: ${meta.zh} (${meta.key}) — ${meta.desc}`);
    }
    if (style) {
      lines.push(`Style: ${style}`);
    }
    return lines.join("\n");
  }

  private buildImageSections(input: PromptCompilerInput): PromptSection[] {
    const keyframeContent = input.keyframes
      .map((k) =>
        [renderSpec(k.composition), renderSpec(k.subjectLayout), renderSpec(k.backgroundRequirement)]
          .filter((s) => s !== "")
          .join("\n"),
      )
      .join("\n\n");
    const continuityContent = input.continuityAnchors
      .map((a) => {
        const body = renderSpec(a.anchorPayload);
        return `${a.anchorType}（${a.strength}）${body ? `\n${body}` : ""}`;
      })
      .filter((s) => s !== "")
      .join("\n");
    return [
      section("content_style", "内容形态与视觉风格", this.contentStyleContent(input), refsOf("project", [input.project])),
      section("subject_identity", "画面主体与身份", this.charactersContent(input), refsOf("character", input.characters)),
      section("appearance_wardrobe", "外观与服装", this.looksContent(input), refsOf("character_look", input.characterLooks)),
      section("scene_space", "场景与空间", this.locationContent(input), input.location ? refsOf("location", [input.location]) : []),
      section("composition", "构图与关键帧", keyframeContent, refsOf("keyframe", input.keyframes)),
      section("continuity", "连续性约束", continuityContent, refsOf("continuity_anchor", input.continuityAnchors)),
    ];
  }

  private buildVideoSections(input: PromptCompilerInput): PromptSection[] {
    const shot = input.shot;
    const goal = [shot?.intent, input.scene?.dramaticGoal].filter(Boolean).join("；");
    const action = shot
      ? [shot.performanceNotes ?? "", renderSpec(shot.startState), renderSpec(shot.endState)]
          .filter((s) => s !== "")
          .join("\n")
      : "";
    const camera = shot ? renderSpec(shot.cameraPlan) : "";
    const anchorLines = input.continuityAnchors
      .map((a) => `${a.anchorType}（${a.strength}）`)
      .join("\n");
    const continuity = shot
      ? [renderSpec(shot.handoffAnchor), anchorLines].filter((s) => s !== "").join("\n")
      : anchorLines;
    const shotRefs = shot ? refsOf("shot", [shot]) : [];
    return [
      section("content_style", "内容形态与视觉风格", this.contentStyleContent(input), refsOf("project", [input.project])),
      section("shot_goal", "镜头目标", goal, [
        ...shotRefs,
        ...(input.scene ? refsOf("scene", [input.scene]) : []),
      ]),
      section("characters_wardrobe", "角色与服装", `${this.charactersContent(input)}\n${this.looksContent(input)}`, [
        ...refsOf("character", input.characters),
        ...refsOf("character_look", input.characterLooks),
      ]),
      section("scene_space", "场景与空间", this.locationContent(input), input.location ? refsOf("location", [input.location]) : []),
      section("action_performance", "动作与表演", action, shotRefs),
      section("cinematography", "摄影与运镜", camera, shotRefs),
      section("continuity_states", "连续性与起止状态", continuity, [
        ...shotRefs,
        ...refsOf("continuity_anchor", input.continuityAnchors),
      ]),
    ];
  }

  private buildTtsSections(input: PromptCompilerInput): PromptSection[] {
    const blocks = input.dialogueBlocks ?? [];
    const lines = blocks
      .map((b) => {
        const speaker = b.speakerCharacterId
          ? input.characters.find((c) => c.id === b.speakerCharacterId)?.name ?? "旁白"
          : "旁白";
        return `${speaker}：${b.text}`;
      })
      .join("\n");
    const emotions = blocks
      .map((b) => b.emotion)
      .filter((e): e is string => !!e)
      .join("；");
    const styles = input.characters
      .filter((c) => !!c.speechStyle)
      .map((c) => `${c.name}：${c.speechStyle}`)
      .join("\n");
    return [
      section("dialogue_text", "台词文本", lines, refsOf("dialogue_block", blocks.map((b) => ({ id: b.id })))),
      section("emotion", "情绪说明", emotions, []),
      section("speech_style", "说话风格", styles, refsOf("character", input.characters)),
    ];
  }

  private buildSnapshot(input: PromptCompilerInput): Record<string, unknown> {
    const idv = (e?: { id: Id; version?: number }) =>
      e ? { id: e.id, version: e.version } : undefined;
    return {
      project: idv(input.project),
      episode: idv(input.episode),
      scene: idv(input.scene),
      shot: idv(input.shot),
      location: idv(input.location),
      characters: input.characters.map((c) => ({ id: c.id, version: c.version })),
      characterLooks: input.characterLooks.map((l) => ({ id: l.id, version: l.version })),
      keyframes: input.keyframes.map((k) => ({ id: k.id, version: k.version })),
      props: input.props.map((p) => ({ id: p.id, version: p.version })),
      modelProfileId: input.modelProfile?.id,
      compiledAt: new Date().toISOString(),
    };
  }
}
