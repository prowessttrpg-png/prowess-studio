import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import type { ActionDefinitionPayload } from "../definition/runtime-payload.js";
import type { SkillBenefitPayload } from "../definition/rules-authoring-payload.js";
import { definitionRefOf, type ProwessDefinitionRef } from "../definition/envelope.js";
import { deepFreeze } from "../internal/plain-data.js";
import { evaluatePrerequisiteList, type ActionImprovementPrerequisiteResult } from "./action-improvement.js";
import type { CharacterMechanicalProfile } from "./advancement.js";

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
