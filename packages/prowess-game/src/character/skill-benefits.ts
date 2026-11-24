import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import type { ActionDefinitionPayload } from "../definition/runtime-payload.js";
import type { SkillBenefitPayload } from "../definition/rules-authoring-payload.js";
import { definitionRefOf, type ProwessDefinitionRef } from "../definition/envelope.js";
import { deepFreeze } from "../internal/plain-data.js";
import { evaluatePrerequisiteList, type ActionImprovementPrerequisiteResult } from "./action-improvement.js";
import { releaseMaximumLevel, type CharacterMechanicalProfile, type ProfileSkill, type ProfileStat } from "./advancement.js";
import { indexAffinityDefinitions } from "../affinity/definitions.js";
import type { CharacterAffinityProfile, OwnedAffinity } from "../affinity/profile.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import { AFFINITY_RANKS, AFFINITY_ROLES, type AffinityRank } from "../vocabulary/affinity.js";

/**
 * RULES-WO1 (R08) — what each published Skill benefit means for ONE Character, read-only and deterministic:
 *   - whether the Character holds the Skill at the benefit's rank (the Release's Skill rank ladder order);
 *   - each prerequisite group, evaluated with the shared Action-improvement prerequisite evaluation (Level and Stat via
 *     NUMERIC_COMPARE; Skill and Affinity ranks via the M6-WO4 rank evaluation); a group holds when ALL / ANY of its
 *     prerequisites are met, and the benefit is eligible when every group holds;
 *   - the Actions it grants, each checked against the exact ACTION revision this Release pins.
 * A benefit is GRANTED only when the rank is held and it is eligible. Undecidable prerequisites are UNRESOLVED and the
 * benefit is not granted — nothing is guessed. Nothing is applied, spent or persisted.
 */
export type SkillBenefitStatus = "GRANTED" | "RANK_NOT_REACHED" | "INELIGIBLE" | "UNRESOLVED";

export interface SkillBenefitGroupResult {
  readonly groupKey: string;
  readonly mode: "ALL" | "ANY";
  readonly satisfied: boolean | null;
  readonly prerequisites: readonly ActionImprovementPrerequisiteResult[];
}

export interface SkillGrantedAction {
  readonly action: ProwessDefinitionRef;
  /** The exact revision this Release pins, or why it cannot be shown. */
  readonly state: "PINNED" | "REVISION_MISMATCH" | "NOT_IN_RELEASE";
  readonly actionKey: string | null;
}

export interface SkillBenefitSummary {
  readonly benefit: ProwessDefinitionRef;
  readonly benefitKey: string;
  readonly skill: ProwessDefinitionRef;
  readonly minimumRankKey: string;
  readonly heldRankKey: string | null;
  readonly rankMet: boolean;
  readonly eligibility: "RANK_ONLY" | "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED";
  readonly groups: readonly SkillBenefitGroupResult[];
  readonly grantedActions: readonly SkillGrantedAction[];
  readonly writtenBenefit: string;
  readonly status: SkillBenefitStatus;
}

function groupHolds(mode: "ALL" | "ANY", results: readonly ActionImprovementPrerequisiteResult[], unresolved: boolean): boolean | null {
  const met = results.map((r) => r.satisfied);
  if (mode === "ALL") return met.includes(false) ? false : unresolved || met.includes(null) ? null : true;
  return met.includes(true) ? true : unresolved || met.includes(null) ? null : false;
}

/** Every SKILL_BENEFIT the Release pins, evaluated for this Character; ordered by benefitKey. */
export function skillBenefitsForCharacter(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile }): readonly SkillBenefitSummary[] {
  const { bundle, profile } = request;
  const benefits = bundle.definitions.filter((d) => d.definitionKind === "SKILL_BENEFIT");
  if (benefits.length === 0) return deepFreeze([]);
  const core = indexCoreDefinitions(bundle);
  const ladder = core.ok ? [...core.value.skillLadder.payload.ranks].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)) : [];
  const out = benefits.map((envelope) => {
    const ref = definitionRefOf(envelope);
    const payload = envelope.payload as unknown as SkillBenefitPayload;
    const heldRankKey = profile.skills.find((s) => s.skill.entityId === payload.skill.entityId)?.rankKey ?? ladder[0]?.rankKey ?? null;
    const held = ladder.find((r) => r.rankKey === heldRankKey);
    const required = ladder.find((r) => r.rankKey === payload.minimumRankKey);
    const rankMet = held !== undefined && required !== undefined && held.order >= required.order;
    const groups = payload.prerequisiteGroups.map((g) => {
      const { prerequisites, unresolved } = evaluatePrerequisiteList({ bundle, profile, prerequisites: g.prerequisites, source: ref });
      return { groupKey: g.groupKey, mode: g.mode, satisfied: groupHolds(g.mode, prerequisites, unresolved.length > 0), prerequisites };
    });
    const eligibility = groups.length === 0 ? ("RANK_ONLY" as const) : groups.some((g) => g.satisfied === false) ? ("INELIGIBLE" as const) : groups.every((g) => g.satisfied === true) ? ("ELIGIBLE" as const) : ("UNRESOLVED" as const);
    const grantedActions = payload.grantedActions.map((action) => {
      const pinned = bundle.definitions.find((d) => d.entityId === action.entityId && d.definitionKind === "ACTION");
      const state = pinned === undefined ? ("NOT_IN_RELEASE" as const) : pinned.entityVersionId === action.entityVersionId ? ("PINNED" as const) : ("REVISION_MISMATCH" as const);
      return { action, state, actionKey: state === "PINNED" && pinned !== undefined ? (pinned.payload as unknown as ActionDefinitionPayload).actionKey : null };
    });
    const status: SkillBenefitStatus = !rankMet ? "RANK_NOT_REACHED" : eligibility === "INELIGIBLE" ? "INELIGIBLE" : eligibility === "UNRESOLVED" ? "UNRESOLVED" : "GRANTED";
    return { benefit: ref, benefitKey: payload.benefitKey, skill: payload.skill, minimumRankKey: payload.minimumRankKey, heldRankKey, rankMet, eligibility, groups, grantedActions, writtenBenefit: payload.writtenBenefit, status };
  });
  return deepFreeze(out.sort((a, b) => (a.benefitKey < b.benefitKey ? -1 : a.benefitKey > b.benefitKey ? 1 : 0)));
}

/** The further-prerequisite decision of each benefit, for the calculated-value evaluator. */
export function benefitEligibilityOf(summaries: readonly SkillBenefitSummary[]): ReadonlyMap<string, "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED"> {
  return new Map(summaries.filter((s) => s.eligibility !== "RANK_ONLY").map((s) => [s.benefitKey, s.eligibility as "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED"]));
}

// ---- RULES-WO1 Phase F: the SAME evaluation for a sample Character (the authoring preview) --------------------------

/** The sample inputs a Skill-benefit preview supplies: Level, every Stat, Skill ranks and Affinity ranks by exact Entity. */
export interface SkillBenefitSample {
  readonly level: number;
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
  readonly skillRanks: ReadonlyArray<{ readonly skillEntityId: string; readonly rankKey: string }>;
  readonly affinityRanks: ReadonlyArray<{ readonly affinityEntityId: string; readonly rankKey: string }>;
}

/** One input the benefits read, and whether the sample supplied it (and if not, what the evaluation used instead). */
export interface SkillBenefitSampleInput {
  readonly input: "LEVEL" | "STAT" | "SKILL_RANK" | "AFFINITY_RANK";
  readonly subject: ProwessDefinitionRef | null;
  readonly stat: ProwessStat | null;
  readonly supplied: boolean;
  /** What an unsupplied input is read as — exactly what a Character without it would have. */
  readonly readAs: "UNTRAINED_FIRST_RANK" | "NOT_OWNED" | null;
}

export interface SkillBenefitSampleResult {
  readonly benefits: readonly SkillBenefitSummary[];
  readonly inputs: readonly SkillBenefitSampleInput[];
  /** Sample entries that name nothing this Release pins (never silently dropped). */
  readonly problems: readonly string[];
  /** The profile the evaluation read (the sheet's own shape; nothing else is derived from it). */
  readonly profile: CharacterMechanicalProfile;
}

/**
 * Evaluates every Skill benefit for a SAMPLE Character with exactly the function the Character sheet uses
 * (`skillBenefitsForCharacter`): the sample becomes the mechanical-profile facts that function reads (Level, final Stat
 * scores, Skill ranks, owned Affinities and their ranks). A Skill the sample omits is read as the Release ladder's first
 * rank, an Affinity it omits as not owned — exactly as for a Character — and each such input is reported. Pure.
 */
export function skillBenefitsForSample(request: { readonly bundle: ProwessDefinitionBundle; readonly sample: SkillBenefitSample }): SkillBenefitSampleResult {
  const { bundle, sample } = request;
  const problems: string[] = [];
  const core = indexCoreDefinitions(bundle);
  const affinityIndex = indexAffinityDefinitions(bundle);
  const ladder = core.ok ? [...core.value.skillLadder.payload.ranks].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)) : [];
  const skills = bundle.definitions.filter((d) => d.definitionKind === "SKILL");
  const stats: ProfileStat[] = core.ok
    ? PROWESS_STATS.map((stat) => {
        const entry = core.value.stats[stat];
        const final = sample.stats[stat] ?? 0;
        return { stat, baseline: final, ancestry: 0, creation: 0, advancement: 0, final, minimum: entry.payload.minimum, maximum: entry.payload.maximum, mastery: null, definition: entry.ref };
      })
    : [];
  const profileSkills: ProfileSkill[] = [];
  for (const s of sample.skillRanks) {
    const envelope = skills.find((d) => d.entityId === s.skillEntityId);
    if (envelope === undefined) problems.push(`the sample names Skill ${s.skillEntityId}, which this Release does not pin`);
    else if (!ladder.some((r) => r.rankKey === s.rankKey)) problems.push(`${s.rankKey} is not a rank of this Release's Skill rank ladder`);
    else profileSkills.push({ skill: definitionRefOf(envelope), rankKey: s.rankKey, source: { kind: "FREE", grantKey: null, level: sample.level }, history: [] });
  }
  const owned: OwnedAffinity[] = [];
  for (const a of sample.affinityRanks) {
    const entry = affinityIndex.ok ? affinityIndex.value.affinities.find((e) => e.ref.entityId === a.affinityEntityId) : undefined;
    if (entry === undefined) problems.push(`the sample names Affinity ${a.affinityEntityId}, which this Release does not pin as an executable Affinity`);
    else if (!(AFFINITY_RANKS as readonly string[]).includes(a.rankKey)) problems.push(`${a.rankKey} is not an Affinity rank`);
    // The role is not read by any benefit prerequisite; the first listed Affinity is recorded as the primary one.
    else owned.push({ affinity: entry.ref, identity: entry.affinity, rank: a.rankKey as AffinityRank, role: owned.length === 0 ? AFFINITY_ROLES[0] : AFFINITY_ROLES[1], acquisition: null });
  }
  const affinityProfile = { primaryAffinity: owned[0]?.affinity ?? null, affinities: owned } as unknown as CharacterAffinityProfile;
  const statScores = Object.fromEntries(stats.map((s) => [s.stat, s.final])) as Partial<Record<ProwessStat, number>>;
  const profile = {
    level: sample.level,
    maximumLevel: releaseMaximumLevel(bundle) ?? sample.level,
    characterDie: { dieKey: "", faces: 0 },
    baseHp: 0,
    baseMp: 0,
    stats,
    skills: profileSkills,
    affinities: owned.map((o) => ({ affinity: o.affinity, identity: o.identity, role: o.role, rank: o.rank, acquisition: { level: sample.level, optionKey: "" }, history: [] })),
    affinityProfile,
    derivedStatistics: [],
    signatureCapacity: null,
    constructionContext: { stats: statScores, skillRanks: profileSkills.map((s) => ({ skillKey: s.skill.canonicalKey, rankKey: s.rankKey })), affinityProfile },
    provenance: { rulesetId: bundle.rulesetProvenance.rulesetId, manifestId: bundle.rulesetProvenance.manifestId, advancementRule: null, characterDieProgression: core.ok ? core.value.progression.ref : null, skillLadder: core.ok ? core.value.skillLadder.ref : null, affinityProgression: null },
  } as unknown as CharacterMechanicalProfile;
  const benefits = skillBenefitsForCharacter({ bundle, profile });

  // Which inputs the benefits read, and whether the sample supplied each one.
  const inputs: SkillBenefitSampleInput[] = [];
  const seen = new Set<string>();
  const add = (key: string, input: SkillBenefitSampleInput) => {
    if (!seen.has(key)) {
      seen.add(key);
      inputs.push(input);
    }
  };
  for (const b of benefits) {
    add(`skill:${b.skill.entityId}`, { input: "SKILL_RANK", subject: b.skill, stat: null, supplied: profileSkills.some((s) => s.skill.entityId === b.skill.entityId), readAs: profileSkills.some((s) => s.skill.entityId === b.skill.entityId) ? null : "UNTRAINED_FIRST_RANK" });
    for (const g of b.groups)
      for (const q of g.prerequisites) {
        if (q.kind === "LEVEL_AT_LEAST") add("level", { input: "LEVEL", subject: null, stat: null, supplied: true, readAs: null });
        else if (q.kind === "STAT_AT_LEAST" && q.required.stat !== null) add(`stat:${q.required.stat}`, { input: "STAT", subject: null, stat: q.required.stat as ProwessStat, supplied: sample.stats[q.required.stat as ProwessStat] !== undefined, readAs: null });
        else if (q.kind === "AFFINITY_RANK_AT_LEAST" && q.required.affinity !== null) {
          const a = q.required.affinity;
          const has = owned.some((o) => o.affinity.entityId === a.entityId);
          add(`affinity:${a.entityId}`, { input: "AFFINITY_RANK", subject: a, stat: null, supplied: has, readAs: has ? null : "NOT_OWNED" });
        } else if (q.kind === "SKILL_RANK_AT_LEAST" && q.required.skillKey !== null) {
          const envelope = skills.find((d) => d.canonicalKey === q.required.skillKey);
          const ref = envelope === undefined ? null : definitionRefOf(envelope);
          const has = profileSkills.some((s) => s.skill.canonicalKey === q.required.skillKey);
          add(`skillkey:${q.required.skillKey}`, { input: "SKILL_RANK", subject: ref, stat: null, supplied: has, readAs: has ? null : "UNTRAINED_FIRST_RANK" });
        }
      }
  }
  return deepFreeze({ benefits, inputs, problems, profile });
}
