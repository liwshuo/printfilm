/**
 * ReviewService — Review Center orchestration
 * (review-center-spec-v1.md, data-and-api-v1.md §10 step 9).
 *
 * Owns:
 *  - ReviewRun lifecycle: `queued -> running -> succeeded|failed` (spec §7.6)
 *  - ReviewIssue creation + state machine `open <-> resolved|ignored -> reopened`
 *    with append-only ReviewIssueEvent history (spec §12.4)
 *  - Reopen dedupe: when a new issue matches an existing `resolved` issue by
 *    `ruleCode + location`, auto-reopen the existing issue instead of creating a
 *    duplicate (spec §12.4)
 *  - `blocked_by_issue` downstream gate with rule_tier awareness (drama-skills)：
 *    - `structural_invariant` / `reviewed_invariant` + `severity ∈ {high, critical}`
 *      + `status ∈ {open, reopened}` → 硬阻塞
 *    - `craft_default` / `taste_option` → 不阻塞（提示为主）
 *  - 内置规则包（本轮首批 stub）：
 *    - compliance（合规审查，按 project.complianceMode 分流 domestic/overseas）
 *    - continuity（连续性锁机械核对，drama 场景优先）
 *    - quality（五维质量评分：pacing / hook / dialogue / format / coherence）
 *
 * State-action endpoints are append-only writes (adr-003 §6) — no optimistic lock.
 */

import type {
  ReviewIssue,
  ReviewIssueStatus,
  ReviewIssueType,
  ReviewRun,
  ReviewRunStatus,
  ReviewRunVerdict,
  ReviewIssueEvent,
  ReviewEvidence,
  Severity,
  ReviewRuleTier,
  ComplianceMode,
  ContinuityLock,
  QualityScoresJson,
  Project,
  Id,
} from "@dramaflow/domain";
import {
  DomainError,
  missingResource,
  invalidState,
} from "@dramaflow/domain";
import { BaseService } from "./context.js";

const nowIso = (): string => new Date().toISOString();

export interface CreateReviewRunInput {
  projectId: Id;
  scopeType: string;
  scopeRefId: Id;
  reviewTypes: string[];
  runMode: string;
}

export interface CreateReviewIssueInput {
  projectId: Id;
  reviewRunId?: Id;
  episodeId?: Id;
  sceneId?: Id;
  shotId?: Id;
  promptSpecId?: Id;
  artifactId?: Id;
  issueType: ReviewIssueType;
  severity: Severity;
  ruleCode?: string;
  ruleTier?: ReviewRuleTier;
  evidence?: ReviewEvidence;
  sourceVersion?: string;
  title: string;
  description?: string;
  suggestion?: string;
}

export interface FinishReviewRunInput {
  issues?: CreateReviewIssueInput[];
  qualityScores?: QualityScoresJson;
}

/**
 * 触发内置规则包的输入。episodeId 可选：填则针对该集运行连续性/合规/五维评分，
 * 不填则针对整个项目做粗粒度审查（story 层）。
 */
export interface RunRulePacksInput {
  projectId: Id;
  episodeId?: Id;
  /** 需要跑的规则包，默认全跑。 */
  packs?: Array<"compliance" | "continuity" | "quality">;
}

/** 内置规则包运行结果（面向 UI 直接展示 / logActivity）。 */
export interface RunRulePacksResult {
  runId: Id;
  verdict: ReviewRunVerdict;
  createdIssueIds: Id[];
  qualityScores: QualityScoresJson;
  blockingCount: number;
  advisoryCount: number;
}

export class ReviewService extends BaseService {
  // ===== ReviewRun lifecycle =====

  createRun(input: CreateReviewRunInput): ReviewRun {
    if (!this.repos.projects.getById(input.projectId)) {
      throw missingResource(`项目不存在：${input.projectId}`, { projectId: input.projectId });
    }
    const run = this.repos.reviewRuns.create({
      projectId: input.projectId,
      scopeType: input.scopeType,
      scopeRefId: input.scopeRefId,
      reviewTypes: input.reviewTypes,
      runMode: input.runMode,
      status: "queued",
    });
    this.logActivity({
      projectId: run.projectId,
      eventType: "review.run.created",
      summary: `创建审查运行（${run.scopeType}）`,
      targetRef: { entityType: "review_run", entityId: run.id },
      payload: { toStatus: "queued", extra: { reviewTypes: run.reviewTypes } },
    });
    return run;
  }

  startRun(runId: Id): ReviewRun {
    const run = this.getRunOrThrow(runId);
    this.assertRunStatus(run, ["queued"], "开始运行");
    return this.repos.reviewRuns.update(runId, {
      status: "running",
      startedAt: nowIso(),
    });
  }

  /**
   * running -> succeeded. Persists the batch of issues (with reopen dedupe) and
   * computes `verdict` from the resulting issue set for this run's scope
   * (spec §7.6): `blocked` if any blocking (rule_tier: structural/reviewed +
   * severity high|critical) open|reopened issue exists after this run, else `passed`.
   */
  finishRun(runId: Id, result: FinishReviewRunInput = {}): ReviewRun {
    return this.repos.transaction(() => {
      const run = this.getRunOrThrow(runId);
      this.assertRunStatus(run, ["running"], "结束运行");
      for (const raw of result.issues ?? []) {
        this.createIssueInternal({ ...raw, reviewRunId: runId, projectId: run.projectId });
      }
      const blocking = this.listBlockingByTier(run.projectId);
      const verdict: ReviewRunVerdict = blocking.length > 0 ? "blocked" : "passed";
      const updated = this.repos.reviewRuns.update(runId, {
        status: "succeeded",
        verdict,
        finishedAt: nowIso(),
        qualityScores: result.qualityScores,
      });
      this.logActivity({
        projectId: run.projectId,
        eventType: "review.run.finished",
        summary: `审查运行完成（${verdict}）`,
        targetRef: { entityType: "review_run", entityId: run.id },
        payload: {
          toStatus: "succeeded",
          count: (result.issues ?? []).length,
          extra: { verdict, blockingCount: blocking.length },
        },
      });
      return updated;
    });
  }

  failRun(runId: Id, errorMessage: string): ReviewRun {
    const run = this.getRunOrThrow(runId);
    this.assertRunStatus(run, ["queued", "running"], "标记失败");
    const updated = this.repos.reviewRuns.update(runId, {
      status: "failed",
      finishedAt: nowIso(),
    });
    this.logActivity({
      projectId: run.projectId,
      eventType: "review.run.failed",
      summary: `审查运行失败：${errorMessage}`,
      targetRef: { entityType: "review_run", entityId: run.id },
      payload: { toStatus: "failed", extra: { errorMessage } },
    });
    return updated;
  }

  // ===== Issue create + reopen dedupe =====

  createIssue(input: CreateReviewIssueInput): ReviewIssue {
    return this.repos.transaction(() => this.createIssueInternal(input));
  }

  private createIssueInternal(input: CreateReviewIssueInput): ReviewIssue {
    // Reopen dedupe (spec §12.4): if an existing resolved issue matches
    // ruleCode + location, auto-reopen it instead of creating a duplicate.
    if (input.ruleCode) {
      const match = this.repos.reviewIssues
        .listByProject(input.projectId)
        .find(
          (i) =>
            i.ruleCode === input.ruleCode &&
            i.status === "resolved" &&
            i.episodeId === input.episodeId &&
            i.sceneId === input.sceneId &&
            i.shotId === input.shotId &&
            i.promptSpecId === input.promptSpecId &&
            i.artifactId === input.artifactId,
        );
      if (match) {
        return this.reopenIssueInternal(match.id, "自动重开：再次审查命中已解决问题");
      }
    }
    const issue = this.repos.reviewIssues.create({
      projectId: input.projectId,
      reviewRunId: input.reviewRunId,
      episodeId: input.episodeId,
      sceneId: input.sceneId,
      shotId: input.shotId,
      promptSpecId: input.promptSpecId,
      artifactId: input.artifactId,
      issueType: input.issueType,
      severity: input.severity,
      ruleCode: input.ruleCode,
      ruleTier: input.ruleTier,
      evidence: input.evidence ?? {},
      sourceVersion: input.sourceVersion,
      title: input.title,
      description: input.description,
      suggestion: input.suggestion,
      status: "open",
    });
    return issue;
  }

  // ===== Issue state actions (append-only, no optimistic lock) =====

  resolveIssue(issueId: Id, resolutionNote?: string, changedBy?: string): ReviewIssue {
    return this.repos.transaction(() => {
      const issue = this.getIssueOrThrow(issueId);
      this.assertIssueStatus(issue, ["open", "reopened"], "标记为已解决");
      const updated = this.repos.reviewIssues.update(issueId, {
        status: "resolved",
        resolutionNote,
      });
      this.appendIssueEvent(issue, "resolved", "resolve", resolutionNote, changedBy);
      return updated;
    });
  }

  ignoreIssue(issueId: Id, ignoreReason: string, changedBy?: string): ReviewIssue {
    if (!ignoreReason || ignoreReason.trim() === "") {
      throw invalidState("忽略问题必须提供 ignoreReason", { issueId });
    }
    return this.repos.transaction(() => {
      const issue = this.getIssueOrThrow(issueId);
      this.assertIssueStatus(issue, ["open", "reopened"], "忽略");
      const updated = this.repos.reviewIssues.update(issueId, {
        status: "ignored",
        ignoreReason,
      });
      this.appendIssueEvent(issue, "ignored", "ignore", ignoreReason, changedBy);
      return updated;
    });
  }

  reopenIssue(issueId: Id, note?: string, changedBy?: string): ReviewIssue {
    return this.repos.transaction(() => this.reopenIssueInternal(issueId, note, changedBy));
  }

  private reopenIssueInternal(
    issueId: Id,
    note?: string,
    changedBy?: string,
  ): ReviewIssue {
    const issue = this.getIssueOrThrow(issueId);
    this.assertIssueStatus(issue, ["resolved", "ignored"], "重开");
    const updated = this.repos.reviewIssues.update(issueId, { status: "reopened" });
    this.appendIssueEvent(issue, "reopened", "reopen", note, changedBy);
    return updated;
  }

  private appendIssueEvent(
    issue: ReviewIssue,
    toStatus: ReviewIssueStatus,
    action: "resolve" | "ignore" | "reopen",
    note?: string,
    changedBy?: string,
  ): ReviewIssueEvent {
    return this.repos.reviewIssueEvents.append({
      issueId: issue.id,
      action,
      fromStatus: issue.status,
      toStatus,
      note,
      changedBy: changedBy ?? this.actor,
    });
  }

  // ===== Reads =====

  getIssue(id: Id): ReviewIssue | null {
    return this.repos.reviewIssues.getById(id);
  }

  listIssues(projectId: Id): ReviewIssue[] {
    return this.repos.reviewIssues.listByProject(projectId);
  }

  listBlockingIssues(projectId: Id): ReviewIssue[] {
    return this.listBlockingByTier(projectId);
  }

  listIssueEvents(issueId: Id): ReviewIssueEvent[] {
    return this.repos.reviewIssueEvents.listByIssue(issueId);
  }

  getRun(id: Id): ReviewRun | null {
    return this.repos.reviewRuns.getById(id);
  }

  listRuns(projectId: Id): ReviewRun[] {
    return this.repos.reviewRuns.listByProject(projectId);
  }

  // ===== Downstream gate =====

  /**
   * Throws `blocked_by_issue` if any blocking issue exists.
   * Prompt Compiler / Job Orchestrator / Export Service call this before proceeding.
   * Blocking = severity high|critical + rule_tier structural_invariant|reviewed_invariant.
   * craft_default / taste_option tiers are advisory only.
   */
  assertNoBlockingIssues(projectId: Id): void {
    const blocking = this.listBlockingByTier(projectId);
    if (blocking.length === 0) return;
    throw new DomainError({
      code: "blocked_by_issue",
      message: `存在 ${blocking.length} 条阻塞审查问题，须先解决或忽略`,
      retryable: false,
      details: {
        blockingCount: blocking.length,
        issues: blocking.map((i) => ({
          id: i.id,
          issueType: i.issueType,
          severity: i.severity,
          ruleTier: i.ruleTier ?? null,
          title: i.title,
          status: i.status,
        })),
      },
      suggestedTarget: "review-center",
    });
  }

  // ===== 内置规则包（本轮 vertical slice） =====

  /**
   * 触发内置规则包，返回 run + 命中问题 + 质量评分。
   * 一次调用即走完 create→start→(apply packs)→finish 的完整生命周期。
   */
  runRulePacks(input: RunRulePacksInput): RunRulePacksResult {
    const project = this.repos.projects.getById(input.projectId);
    if (!project) throw missingResource(`项目不存在：${input.projectId}`, { id: input.projectId });
    const packs = new Set(input.packs ?? ["compliance", "continuity", "quality"]);
    const scopeType = input.episodeId ? "episode" : "project";
    const scopeRefId = input.episodeId ?? input.projectId;

    const run = this.createRun({
      projectId: input.projectId,
      scopeType,
      scopeRefId,
      reviewTypes: Array.from(packs),
      runMode: "auto",
    });
    this.startRun(run.id);

    const collected: CreateReviewIssueInput[] = [];
    let qualityScores: QualityScoresJson = {};

    if (packs.has("compliance")) {
      collected.push(...this.runCompliancePack(project, input.episodeId));
    }
    if (packs.has("continuity")) {
      collected.push(...this.runContinuityPack(project, input.episodeId));
    }
    if (packs.has("quality")) {
      qualityScores = this.runQualityPack(project, input.episodeId);
    }

    const finished = this.finishRun(run.id, {
      issues: collected,
      qualityScores,
    });

    const allIssues = this.repos.reviewIssues.listByProject(input.projectId);
    const advisoryCount = allIssues.filter(
      (i) =>
        (i.status === "open" || i.status === "reopened") &&
        !this.isBlockingIssue(i),
    ).length;
    const blocking = this.listBlockingByTier(input.projectId);
    const createdIssueIds = allIssues
      .filter((i) => i.reviewRunId === run.id)
      .map((i) => i.id);

    return {
      runId: finished.id,
      verdict: finished.verdict ?? "passed",
      createdIssueIds,
      qualityScores,
      blockingCount: blocking.length,
      advisoryCount,
    };
  }

  /**
   * 合规规则包：按 project.complianceMode 分流。stub 版落地一组硬约束示例。
   * 命中即建 issue（结构性 tier），后续接真实规则引擎时替换规则集即可。
   */
  private runCompliancePack(
    project: Project,
    episodeId?: Id,
  ): CreateReviewIssueInput[] {
    const mode = project.complianceMode;
    const rules = COMPLIANCE_RULES[mode];
    const collected: CreateReviewIssueInput[] = [];

    // scan story bible + episode bibles for forbidden terms
    const bible =
      episodeId != null
        ? this.repos.storyBibles.getByProjectAndEpisode(project.id, episodeId) ??
          this.repos.storyBibles.getByProjectId(project.id)
        : this.repos.storyBibles.getByProjectId(project.id);

    if (bible) {
      const worldParts = [
        bible.worldRules?.setting ?? "",
        ...(bible.worldRules?.rules ?? []).map((r) => `${r.label}${r.detail ?? ""}`),
        ...(bible.worldRules?.taboos ?? []),
      ];
      const haystack = [bible.logline, bible.theme, ...worldParts]
        .filter(Boolean)
        .join("\n");
      for (const rule of rules) {
        if (rule.pattern.test(haystack)) {
          collected.push({
            projectId: project.id,
            episodeId,
            issueType: "compliance",
            severity: rule.severity,
            ruleCode: rule.code,
            ruleTier: rule.tier,
            title: rule.title,
            description: `${rule.description}（合规模式：${mode === "domestic" ? "国内" : "出海"}）`,
            suggestion: rule.suggestion,
          });
        }
      }
    }
    return collected;
  }

  /**
   * 连续性锁机械核对（drama 优先场景）：将 active 锁面（lock_phrase）与
   * scene summaries / shot camera_notes 做逐字包含扫描，缺失或改写即视为违反。
   * stub 版：只做「锁面在应用范围内至少出现一次」的最小校验。
   */
  private runContinuityPack(
    project: Project,
    episodeId?: Id,
  ): CreateReviewIssueInput[] {
    const collected: CreateReviewIssueInput[] = [];
    const locks: ContinuityLock[] =
      this.repos.continuityLocks.listActive(project.id, episodeId);
    if (locks.length === 0) return collected;

    // gather all scenes + shots in scope
    const episodes = episodeId
      ? [this.repos.episodes.getById(episodeId)].filter(
          (e): e is NonNullable<typeof e> => e != null,
        )
      : this.repos.episodes.listByProject(project.id);

    for (const lock of locks) {
      let hits = 0;
      const scannedBits: string[] = [];
      for (const ep of episodes) {
        const scenes = this.repos.scenes.listByEpisode(ep.id);
        for (const scene of scenes) {
          const summary = scene.summary ?? "";
          scannedBits.push(summary);
          if (summary.includes(lock.lockPhrase)) hits += 1;
          const shots = this.repos.shots.listByScene(scene.id);
          for (const shot of shots) {
            const bits = [shot.intent ?? "", shot.performanceNotes ?? ""].join(" ");
            scannedBits.push(bits);
            if (bits.includes(lock.lockPhrase)) hits += 1;
          }
        }
      }
      if (hits === 0 && scannedBits.length > 0) {
        collected.push({
          projectId: project.id,
          episodeId,
          issueType: "continuity",
          severity: "high",
          ruleCode: `CONTINUITY_LOCK_MISSING:${lock.id}`,
          ruleTier: "reviewed_invariant",
          title: `连续性锁「${lock.lockPhrase}」在应用范围内未被引用`,
          description:
            "锁面（跨镜/跨集不变的名词短语）应在所有相关 scene summary 或 shot camera_note 中逐字出现。",
          suggestion: `请在相关 scene/shot 中显式引用「${lock.lockPhrase}」，或将该锁面 disable。`,
          evidence: {
            locationLabel: episodeId ? `episode:${episodeId}` : "project",
            expected: lock.lockPhrase,
            metrics: { scannedBits: scannedBits.length },
          },
        });
      }
    }
    return collected;
  }

  /**
   * 五维质量评分（pacing / hook / dialogue / format / coherence + overall）。
   * stub 版：基于故事圣经/分集/scene 数量的启发式打分，接真实评分模型时替换实现。
   */
  private runQualityPack(project: Project, episodeId?: Id): QualityScoresJson {
    const episodes = this.repos.episodes.listByProject(project.id);
    const targetEpisodes = episodeId
      ? episodes.filter((e) => e.id === episodeId)
      : episodes;
    if (targetEpisodes.length === 0) {
      return {
        pacing: 60,
        hook: 60,
        dialogue: 60,
        format: 60,
        coherence: 60,
        overall: 60,
        notes: "尚未生成任何分集，评分为默认基准。",
      };
    }
    let dialogueTotal = 0;
    let sceneTotal = 0;
    let shotTotal = 0;
    for (const ep of targetEpisodes) {
      const scenes = this.repos.scenes.listByEpisode(ep.id);
      sceneTotal += scenes.length;
      for (const s of scenes) {
        shotTotal += this.repos.shots.listByScene(s.id).length;
        dialogueTotal += this.repos.sceneDialogueBlocks.listByScene(s.id).length;
      }
    }
    const avgScenes = sceneTotal / targetEpisodes.length;
    const avgShots = shotTotal / Math.max(1, sceneTotal);
    const avgDialogue = dialogueTotal / Math.max(1, sceneTotal);

    // 启发式打分：以 6/scenes、5/shots、3/dialogue 为基线，靠近基线得分 80，偏离扣分。
    const pacing = clampScore(80 - Math.abs(avgScenes - 6) * 4);
    const hook = clampScore(60 + Math.min(20, avgScenes * 2));
    const dialogue = clampScore(70 + Math.min(20, avgDialogue * 3));
    const format = clampScore(80 - Math.abs(avgShots - 5) * 3);
    const coherence = clampScore(
      70 + (this.listBlockingByTier(project.id).length === 0 ? 15 : -20),
    );
    const overall = clampScore(
      (pacing + hook + dialogue + format + coherence) / 5,
    );

    return {
      pacing,
      hook,
      dialogue,
      format,
      coherence,
      overall,
      notes: `基于 ${targetEpisodes.length} 集 / ${sceneTotal} scenes / ${shotTotal} shots / ${dialogueTotal} dialogues 的启发式评分（stub）。`,
    };
  }

  // ===== internal helpers =====

  private isBlockingIssue(i: ReviewIssue): boolean {
    if (i.status !== "open" && i.status !== "reopened") return false;
    if (i.severity !== "high" && i.severity !== "critical") return false;
    // 无 tier 默认按 reviewed_invariant 处理（保底阻塞）
    const tier = i.ruleTier ?? "reviewed_invariant";
    return tier === "structural_invariant" || tier === "reviewed_invariant";
  }

  private listBlockingByTier(projectId: Id): ReviewIssue[] {
    return this.repos.reviewIssues
      .listByProject(projectId)
      .filter((i) => this.isBlockingIssue(i));
  }

  private getRunOrThrow(id: Id): ReviewRun {
    const r = this.repos.reviewRuns.getById(id);
    if (!r) throw missingResource(`审查运行不存在：${id}`, { id });
    return r;
  }

  private getIssueOrThrow(id: Id): ReviewIssue {
    const i = this.repos.reviewIssues.getById(id);
    if (!i) throw missingResource(`审查问题不存在：${id}`, { id });
    return i;
  }

  private assertRunStatus(
    run: ReviewRun,
    allowed: ReviewRunStatus[],
    action: string,
  ): void {
    if (!allowed.includes(run.status)) {
      throw invalidState(`审查运行状态「${run.status}」不允许${action}`, {
        runId: run.id,
        status: run.status,
        allowed,
      });
    }
  }

  private assertIssueStatus(
    issue: ReviewIssue,
    allowed: ReviewIssueStatus[],
    action: string,
  ): void {
    if (!allowed.includes(issue.status)) {
      throw invalidState(`问题状态「${issue.status}」不允许${action}`, {
        issueId: issue.id,
        status: issue.status,
        allowed,
      });
    }
  }
}

// ===== 合规规则包（stub） =====
// 上线前需替换为完整规则集；每条规则显式记录 ruleTier + severity。

interface ComplianceRule {
  code: string;
  pattern: RegExp;
  severity: Severity;
  tier: ReviewRuleTier;
  title: string;
  description: string;
  suggestion: string;
}

const COMPLIANCE_RULES: Record<ComplianceMode, ComplianceRule[]> = {
  domestic: [
    {
      code: "DOM-BLOODY",
      pattern: /(血腥|割喉|凌迟|残忍虐杀)/,
      severity: "critical",
      tier: "structural_invariant",
      title: "国内合规：涉血腥/暴力描写",
      description: "国内平台禁止过度血腥/写实暴力描写。",
      suggestion: "以侧面镜头或环境暗示代替直接暴力表达。",
    },
    {
      code: "DOM-DRUG",
      pattern: /(吸毒|贩毒|冰毒|海洛因)/,
      severity: "critical",
      tier: "structural_invariant",
      title: "国内合规：涉毒品",
      description: "国内平台禁止直接展示毒品交易/使用。",
      suggestion: "将毒品替换为其他违禁品或改为反腐打击线。",
    },
    {
      code: "DOM-GAMBLING",
      pattern: /(赌博|开赌|赌场|抽奖诈骗)/,
      severity: "high",
      tier: "reviewed_invariant",
      title: "国内合规：涉赌博",
      description: "国内平台限制赌博题材直接展示。",
      suggestion: "将赌博场景替换为竞技或商业博弈。",
    },
    {
      code: "DOM-SUPERSTITION",
      pattern: /(重生|穿越|鬼怪|阴阳)/,
      severity: "medium",
      tier: "craft_default",
      title: "国内合规：涉玄幻/迷信元素（建议核实）",
      description: "重生/穿越/鬼怪等元素需符合平台审核口径，建议人工确认。",
      suggestion: "如非核心设定，可将超自然元素弱化为心理暗示或梦境。",
    },
  ],
  overseas: [
    {
      code: "OS-HATE",
      pattern: /(种族歧视|nazi|纳粹|种族清洗)/i,
      severity: "critical",
      tier: "structural_invariant",
      title: "出海合规：仇恨言论",
      description: "海外平台严禁涉种族/宗教/性向仇恨言论。",
      suggestion: "改写为泛化的社会矛盾，避免特定群体标签。",
    },
    {
      code: "OS-MINOR",
      pattern: /(未成年.*(色情|性行为)|child porn|loli)/i,
      severity: "critical",
      tier: "structural_invariant",
      title: "出海合规：涉未成年不当内容",
      description: "海外平台对涉未成年不当内容零容忍，直接封禁。",
      suggestion: "将角色年龄改为成年，或删除相关描写。",
    },
    {
      code: "OS-COPYRIGHT",
      pattern: /(marvel|disney|iron man|batman|超人)/i,
      severity: "high",
      tier: "reviewed_invariant",
      title: "出海合规：疑似侵犯第三方 IP",
      description: "海外平台对第三方 IP 侵权敏感。",
      suggestion: "将 IP 名称替换为原创角色名。",
    },
    {
      code: "OS-POLITICS",
      pattern: /(总统|白宫|国会|总统大选)/,
      severity: "medium",
      tier: "craft_default",
      title: "出海合规：涉政治内容（建议核实）",
      description: "涉政治敏感话题需要人工审核区域合规性。",
      suggestion: "如非核心设定，泛化为虚构国家/政体。",
    },
  ],
};

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
