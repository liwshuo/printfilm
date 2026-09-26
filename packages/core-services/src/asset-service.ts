/**
 * AssetService — Character / CharacterLook / Location / Prop orchestration
 * (data-and-api-v1.md §10 step 4b, asset-ledger §).
 *
 * Key behaviours:
 * - Optimistic-lock pass-through on all versioned updates (adr-003).
 * - CharacterLook version chains: new group vs. new version within a group,
 *   maintaining the single default+current invariant per character
 *   (unique index idx_character_looks_default_current_unique).
 * - Disable is blocked with `blocked_by_reference` while the asset is still
 *   referenced by scenes/shots (adr-004 §5).
 */

import { randomUUID } from "node:crypto";
import type { Character, CharacterLook, Location, Prop, Id } from "@dramaflow/domain";
import {
  createCharacterSchema,
  updateCharacterSchema,
  createCharacterLookSchema,
  createLocationSchema,
  updateLocationSchema,
  createPropSchema,
  updatePropSchema,
  missingResource,
  validationFailed,
  invalidState,
  blockedByReference,
} from "@dramaflow/domain";
import { BaseService } from "./context.js";
import { parseInput } from "./validate.js";

export class AssetService extends BaseService {
  // ===== Character =====

  createCharacter(raw: unknown): Character {
    const input = parseInput(createCharacterSchema, raw);
    return this.repos.transaction(() => {
      const project = this.repos.projects.getById(input.projectId);
      if (!project) {
        throw missingResource(`项目不存在：${input.projectId}`, { projectId: input.projectId });
      }
      const character = this.repos.characters.create({
        projectId: input.projectId,
        name: input.name,
        roleType: input.roleType,
        genderPresentation: input.genderPresentation,
        ageRange: input.ageRange,
        identitySummary: input.identitySummary,
        personality: input.personality,
        motivation: input.motivation,
        taboos: input.taboos,
        speechStyle: input.speechStyle,
        status: "active",
      });
      this.logActivity({
        projectId: character.projectId,
        eventType: "asset.character.created",
        summary: `新增角色「${character.name}」`,
        targetRef: { entityType: "asset", entityId: character.id, label: character.name },
      });
      return character;
    });
  }

  updateCharacter(id: Id, raw: unknown): Character {
    const { version, ...rest } = parseInput(updateCharacterSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.characters.getById(id);
      if (!existing) throw missingResource(`角色不存在：${id}`, { id });
      return this.repos.characters.update(id, rest, version);
    });
  }

  listCharacters(projectId: Id): Character[] {
    return this.repos.characters.listByProject(projectId);
  }

  /** Disable a character; blocked while any scene/shot still references it. */
  disableCharacter(id: Id, expectedVersion: number): Character {
    return this.repos.transaction(() => {
      const character = this.repos.characters.getById(id);
      if (!character) throw missingResource(`角色不存在：${id}`, { id });
      const refs = this.countCharacterReferences(character);
      if (refs > 0) {
        throw blockedByReference(`角色仍被 ${refs} 处场景/镜头引用，无法停用`, {
          characterId: id,
          referenceCount: refs,
        });
      }
      const updated = this.repos.characters.update(id, { status: "disabled" }, expectedVersion);
      this.logActivity({
        projectId: character.projectId,
        eventType: "asset.character.disabled",
        summary: `停用角色「${character.name}」`,
        targetRef: { entityType: "asset", entityId: character.id, label: character.name },
        payload: { fromStatus: character.status, toStatus: "disabled" },
      });
      return updated;
    });
  }

  // ===== CharacterLook version chain =====

  listCharacterLooks(characterId: Id): CharacterLook[] {
    return this.repos.characterLooks.listByCharacter(characterId);
  }

  /** Create a brand-new look group (versionNo = 1). First look is forced default. */
  createCharacterLook(raw: unknown): CharacterLook {
    const input = parseInput(createCharacterLookSchema, raw);
    return this.repos.transaction(() => {
      const character = this.repos.characters.getById(input.characterId);
      if (!character) {
        throw missingResource(`角色不存在：${input.characterId}`, {
          characterId: input.characterId,
        });
      }
      const isFirst = this.repos.characterLooks.listByCharacter(input.characterId).length === 0;
      const makeDefault = isFirst || input.isDefault;
      if (makeDefault) this.clearCurrentDefault(input.characterId);
      const look = this.repos.characterLooks.create({
        characterId: input.characterId,
        lookGroupId: randomUUID(),
        versionNo: 1,
        lookName: input.lookName,
        lookType: input.lookType,
        appearanceSpec: input.appearanceSpec,
        hairSpec: input.hairSpec,
        makeupSpec: input.makeupSpec,
        wardrobeSpec: input.wardrobeSpec,
        propsSpec: input.propsSpec,
        continuityRules: input.continuityRules,
        status: "active",
        isCurrent: true,
        isDefault: makeDefault,
        createdBy: input.createdBy,
        changeSummary: input.changeSummary,
      });
      this.logActivity({
        projectId: character.projectId,
        eventType: "asset.look.created",
        summary: `为角色「${character.name}」新增造型「${look.lookName}」`,
        targetRef: { entityType: "asset", entityId: look.id, label: look.lookName },
      });
      return look;
    });
  }

  /**
   * Create the next version within an existing group. The previous look is
   * superseded (isCurrent=false); the new one inherits the group's default flag.
   */
  createCharacterLookVersion(previousLookId: Id, raw: unknown): CharacterLook {
    const input = parseInput(createCharacterLookSchema, raw);
    return this.repos.transaction(() => {
      const previous = this.repos.characterLooks.getById(previousLookId);
      if (!previous) throw missingResource(`造型不存在：${previousLookId}`, { id: previousLookId });
      if (input.characterId !== previous.characterId) {
        throw validationFailed("characterId 与前序造型不一致", {
          expected: previous.characterId,
          received: input.characterId,
        });
      }
      const inheritsDefault = previous.isDefault;
      // Supersede the previous current version within the group.
      this.repos.characterLooks.update(
        previous.id,
        { isCurrent: false, isDefault: false },
        previous.version,
      );
      return this.repos.characterLooks.create({
        characterId: previous.characterId,
        lookGroupId: previous.lookGroupId,
        previousLookId: previous.id,
        versionNo: previous.versionNo + 1,
        lookName: input.lookName,
        lookType: input.lookType,
        appearanceSpec: input.appearanceSpec,
        hairSpec: input.hairSpec,
        makeupSpec: input.makeupSpec,
        wardrobeSpec: input.wardrobeSpec,
        propsSpec: input.propsSpec,
        continuityRules: input.continuityRules,
        status: "active",
        isCurrent: true,
        isDefault: inheritsDefault,
        createdBy: input.createdBy,
        changeSummary: input.changeSummary,
      });
    });
  }

  /** Promote a current look to be the character's default (clearing the old default). */
  setDefaultLook(lookId: Id): CharacterLook {
    return this.repos.transaction(() => {
      const look = this.repos.characterLooks.getById(lookId);
      if (!look) throw missingResource(`造型不存在：${lookId}`, { id: lookId });
      if (!look.isCurrent) {
        throw invalidState("仅可将当前版本设为默认造型", { lookId });
      }
      const currentDefault = this.repos.characterLooks.getCurrentDefault(look.characterId);
      if (currentDefault && currentDefault.id !== look.id) {
        this.repos.characterLooks.update(
          currentDefault.id,
          { isDefault: false },
          currentDefault.version,
        );
      }
      return this.repos.characterLooks.update(look.id, { isDefault: true }, look.version);
    });
  }

  // ===== Location =====

  createLocation(raw: unknown): Location {
    const input = parseInput(createLocationSchema, raw);
    return this.repos.transaction(() => {
      const project = this.repos.projects.getById(input.projectId);
      if (!project) {
        throw missingResource(`项目不存在：${input.projectId}`, { projectId: input.projectId });
      }
      const location = this.repos.locations.create({
        projectId: input.projectId,
        name: input.name,
        locationType: input.locationType,
        visualSpec: input.visualSpec,
        spaceRules: input.spaceRules,
        lightingRules: input.lightingRules,
        continuityRules: input.continuityRules,
        status: "active",
      });
      this.logActivity({
        projectId: location.projectId,
        eventType: "asset.location.created",
        summary: `新增场景「${location.name}」`,
        targetRef: { entityType: "asset", entityId: location.id, label: location.name },
      });
      return location;
    });
  }

  updateLocation(id: Id, raw: unknown): Location {
    const { version, ...rest } = parseInput(updateLocationSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.locations.getById(id);
      if (!existing) throw missingResource(`场景不存在：${id}`, { id });
      return this.repos.locations.update(id, rest, version);
    });
  }

  listLocations(projectId: Id): Location[] {
    return this.repos.locations.listByProject(projectId);
  }

  disableLocation(id: Id, expectedVersion: number): Location {
    return this.repos.transaction(() => {
      const location = this.repos.locations.getById(id);
      if (!location) throw missingResource(`场景不存在：${id}`, { id });
      const refs = this.countLocationReferences(location);
      if (refs > 0) {
        throw blockedByReference(`场景仍被 ${refs} 个分镜场引用，无法停用`, {
          locationId: id,
          referenceCount: refs,
        });
      }
      return this.repos.locations.update(id, { status: "disabled" }, expectedVersion);
    });
  }

  // ===== Prop =====

  createProp(raw: unknown): Prop {
    const input = parseInput(createPropSchema, raw);
    return this.repos.transaction(() => {
      const project = this.repos.projects.getById(input.projectId);
      if (!project) {
        throw missingResource(`项目不存在：${input.projectId}`, { projectId: input.projectId });
      }
      const prop = this.repos.props.create({
        projectId: input.projectId,
        name: input.name,
        propType: input.propType,
        visualSpec: input.visualSpec,
        ownership: input.ownership,
        continuityRules: input.continuityRules,
        status: "active",
      });
      this.logActivity({
        projectId: prop.projectId,
        eventType: "asset.prop.created",
        summary: `新增道具「${prop.name}」`,
        targetRef: { entityType: "asset", entityId: prop.id, label: prop.name },
      });
      return prop;
    });
  }

  updateProp(id: Id, raw: unknown): Prop {
    const { version, ...rest } = parseInput(updatePropSchema, raw);
    return this.repos.transaction(() => {
      const existing = this.repos.props.getById(id);
      if (!existing) throw missingResource(`道具不存在：${id}`, { id });
      return this.repos.props.update(id, rest, version);
    });
  }

  listProps(projectId: Id): Prop[] {
    return this.repos.props.listByProject(projectId);
  }

  disableProp(id: Id, expectedVersion: number): Prop {
    return this.repos.transaction(() => {
      const prop = this.repos.props.getById(id);
      if (!prop) throw missingResource(`道具不存在：${id}`, { id });
      const refs = this.countPropReferences(prop);
      if (refs > 0) {
        throw blockedByReference(`道具仍被 ${refs} 个镜头引用，无法停用`, {
          propId: id,
          referenceCount: refs,
        });
      }
      return this.repos.props.update(id, { status: "disabled" }, expectedVersion);
    });
  }

  // ===== reference scans (blocked_by_reference support) =====

  private clearCurrentDefault(characterId: Id): void {
    const currentDefault = this.repos.characterLooks.getCurrentDefault(characterId);
    if (currentDefault) {
      this.repos.characterLooks.update(
        currentDefault.id,
        { isDefault: false },
        currentDefault.version,
      );
    }
  }

  private countCharacterReferences(character: Character): number {
    let count = 0;
    for (const episode of this.repos.episodes.listByProject(character.projectId)) {
      for (const scene of this.repos.scenes.listByEpisode(episode.id)) {
        count += this.repos.sceneCharacters
          .listByScene(scene.id)
          .filter((l) => l.characterId === character.id).length;
        for (const shot of this.repos.shots.listByScene(scene.id)) {
          count += this.repos.shotCharacters
            .listByShot(shot.id)
            .filter((l) => l.characterId === character.id).length;
        }
      }
    }
    return count;
  }

  private countLocationReferences(location: Location): number {
    let count = 0;
    for (const episode of this.repos.episodes.listByProject(location.projectId)) {
      count += this.repos.scenes
        .listByEpisode(episode.id)
        .filter((s) => s.locationId === location.id).length;
    }
    return count;
  }

  private countPropReferences(prop: Prop): number {
    let count = 0;
    for (const episode of this.repos.episodes.listByProject(prop.projectId)) {
      for (const scene of this.repos.scenes.listByEpisode(episode.id)) {
        for (const shot of this.repos.shots.listByScene(scene.id)) {
          count += this.repos.shotProps
            .listByShot(shot.id)
            .filter((l) => l.propId === prop.id).length;
        }
      }
    }
    return count;
  }

  // ===== A1 跨集资产复用（episode_asset_refs） =====

  /**
   * List all assets available to a specific episode. Includes both:
   * - Episode-owned assets (episodeId === episodeId)
   * - Project-level assets (episodeId IS NULL)
   * - Cross-episode refs attached via episode_asset_refs
   */
  listAvailableCharacters(projectId: Id, episodeId: Id): Character[] {
    const own = this.repos.characters
      .listByProject(projectId)
      .filter((c) => !c.episodeId || c.episodeId === episodeId);
    const refs = this.repos.episodeAssetRefs.listByEpisode(episodeId).filter(
      (r) => r.assetType === "character",
    );
    for (const r of refs) {
      if (own.find((c) => c.id === r.assetId)) continue;
      const c = this.repos.characters.getById(r.assetId);
      if (c) own.push(c);
    }
    return own;
  }

  listAvailableLocations(projectId: Id, episodeId: Id): Location[] {
    const own = this.repos.locations
      .listByProject(projectId)
      .filter((c) => !c.episodeId || c.episodeId === episodeId);
    const refs = this.repos.episodeAssetRefs.listByEpisode(episodeId).filter(
      (r) => r.assetType === "location",
    );
    for (const r of refs) {
      if (own.find((c) => c.id === r.assetId)) continue;
      const c = this.repos.locations.getById(r.assetId);
      if (c) own.push(c);
    }
    return own;
  }

  listAvailableProps(projectId: Id, episodeId: Id): Prop[] {
    const own = this.repos.props
      .listByProject(projectId)
      .filter((c) => !c.episodeId || c.episodeId === episodeId);
    const refs = this.repos.episodeAssetRefs.listByEpisode(episodeId).filter(
      (r) => r.assetType === "prop",
    );
    for (const r of refs) {
      if (own.find((c) => c.id === r.assetId)) continue;
      const c = this.repos.props.getById(r.assetId);
      if (c) own.push(c);
    }
    return own;
  }

  listEpisodeAssetRefs(episodeId: Id) {
    return this.repos.episodeAssetRefs.listByEpisode(episodeId);
  }

  attachAssetToEpisode(
    episodeId: Id,
    assetType: "character" | "location" | "prop",
    assetId: Id,
    note?: string,
  ) {
    return this.repos.transaction(() => {
      const ep = this.repos.episodes.getById(episodeId);
      if (!ep) throw missingResource(`剧集不存在：${episodeId}`, { id: episodeId });
      // verify asset exists and belongs to same project
      const asset =
        assetType === "character"
          ? this.repos.characters.getById(assetId)
          : assetType === "location"
            ? this.repos.locations.getById(assetId)
            : this.repos.props.getById(assetId);
      if (!asset) throw missingResource(`资产不存在：${assetType}/${assetId}`, { assetType, assetId });
      if (asset.projectId !== ep.projectId) {
        throw missingResource(`资产与剧集不属于同一项目`, {
          assetProjectId: asset.projectId,
          episodeProjectId: ep.projectId,
        });
      }
      const ref = this.repos.episodeAssetRefs.attach({ episodeId, assetType, assetId, note });
      this.logActivity({
        projectId: ep.projectId,
        eventType: "asset.episode_ref.attached",
        summary: `剧集 EP${ep.episodeNo} 引用 ${assetType} ${assetId}`,
        targetRef: { entityType: "asset", entityId: assetId },
        payload: { extra: { episodeId, assetType, note } },
      });
      return ref;
    });
  }

  detachAssetFromEpisode(
    episodeId: Id,
    assetType: "character" | "location" | "prop",
    assetId: Id,
  ) {
    return this.repos.transaction(() => {
      const ep = this.repos.episodes.getById(episodeId);
      if (!ep) throw missingResource(`剧集不存在：${episodeId}`, { id: episodeId });
      this.repos.episodeAssetRefs.detach(episodeId, assetType, assetId);
      this.logActivity({
        projectId: ep.projectId,
        eventType: "asset.episode_ref.detached",
        summary: `剧集 EP${ep.episodeNo} 解除引用 ${assetType} ${assetId}`,
        targetRef: { entityType: "asset", entityId: assetId },
        payload: { extra: { episodeId, assetType } },
      });
    });
  }

  /**
   * A2 迁移：把项目下所有「项目级」资产（episode_id IS NULL）批量改挂到指定
   * episode，成为该集专属资产。用于修复 series preset 收窄之前生成的错版
   * seeds（把某一集的角色 / 场景 / 道具误落到项目级）。
   *
   * 语义：不 bump version、不校验 optimistic lock —— 这是一次性数据迁移操作。
   */
  migrateProjectLevelAssetsToEpisode(
    projectId: Id,
    episodeId: Id,
  ): { characters: number; locations: number; props: number } {
    return this.repos.transaction(() => {
      const ep = this.repos.episodes.getById(episodeId);
      if (!ep) throw missingResource(`剧集不存在：${episodeId}`, { id: episodeId });
      if (ep.projectId !== projectId) {
        throw missingResource(`剧集与项目不匹配`, {
          episodeProjectId: ep.projectId,
          projectId,
        });
      }
      const result = {
        characters: this.repos.characters.reassignProjectLevelToEpisode(projectId, episodeId),
        locations: this.repos.locations.reassignProjectLevelToEpisode(projectId, episodeId),
        props: this.repos.props.reassignProjectLevelToEpisode(projectId, episodeId),
      };
      this.logActivity({
        projectId,
        eventType: "asset.project_level.migrated_to_episode",
        summary: `迁移项目级资产到 EP${ep.episodeNo}：角色 ${result.characters}、场景 ${result.locations}、道具 ${result.props}`,
        targetRef: { entityType: "episode", entityId: episodeId },
        payload: { extra: { episodeId, ...result } },
      });
      return result;
    });
  }
}
