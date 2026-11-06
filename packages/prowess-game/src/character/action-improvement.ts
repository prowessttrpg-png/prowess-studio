import type { RequirementNode } from "@prowess/rules";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ConstructionPrerequisite } from "../definition/ability-construction-payload.js";
import type { ActionImprovementModification, ActionImprovementPayload, ActionImprovementPrerequisite } from "../definition/action-improvement-payload.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { ActionDefinitionPayload } from "../definition/runtime-payload.js";
import { deepFreeze } from "../internal/plain-data.js";
import type { CharacterMechanicalProfile } from "./advancement.js";
import { evaluateRankPrerequisites, type EligibilityStatus, type RequirementResult } from "./eligibility.js";
import { numericCompare } from "./requirements.js";

/**
 * Action Improvement evaluation (PAS-10 M6-WO9 Phase B, approved decision C1) — read-only, pure, deterministic.
 *
 * For ONE exact ACTION_IMPROVEMENT pinned by the Character's Release it reports, separately:
 * - the PARENT: whether the exact ACTION EntityVersion it names is the one this Release pins;
 * - ELIGIBILITY: each structured prerequisite evaluated independently through an M4 Requirement (Level and Stat via
 *   NUMERIC_COMPARE; Skill and Affinity ranks via the one M6-WO4 rank-prerequisite evaluation);
 * - APPLICABILITY: each modification judged against the EXISTING ACTION contract only — an explicit FIXED AP cost is
 *   applicable exactly where the parent already permits an explicit-rule cost override; an additional use case is
 *   presented, never executed; any other operation is UNSUPPORTED (never invented);
 * - the progression STATUS: ACTIVE / CONDITIONAL / FUTURE / UNAVAILABLE / UNRESOLVED.
 *
 * Progression is never guessed. FUTURE needs authoritative evidence that every unmet prerequisite is reachable — today
 * only a Level within the Release's Level range (CHARACTER_ADVANCEMENT_RULE / Character Die progression, via the
 * profile's maximumLevel). UNAVAILABLE needs authoritative evidence that one is NOT reachable — a Level above that range,
 * or a Stat score above the Stat's own authored maximum. Anything else unmet is UNRESOLVED (path undetermined): no
 * Stat-point or rank pathway is inferred, and nothing is excluded without evidence.
 */

export const ACTION_PROGRESSION_STATUSES = Object.freeze(["ACTIVE", "CONDITIONAL", "FUTURE", "UNAVAILABLE", "UNRESOLVED"] as const);
export type ActionProgressionStatus = (typeof ACTION_PROGRESSION_STATUSES)[number];

/** Per-prerequisite progression evidence. */
export type PrerequisiteProgression = "MET" | "REACHABLE" | "UNREACHABLE" | "UNDETERMINED" | "UNRESOLVED";

export interface ActionImprovementPrerequisiteResult {
  readonly prerequisiteKey: string;
  readonly kind: ActionImprovementPrerequisite["kind"];
  /** What the Definition requires (exact authored values). */
  readonly required: { readonly level: number | null; readonly stat: string | null; readonly minimum: number | null; readonly skillKey: string | null; readonly affinity: ProwessDefinitionRef | null; readonly rankKey: string | null };
  /** What the Character has, from its authoritative mechanical profile. */
  readonly actual: { readonly value: number | null; readonly rankKey: string | null; readonly owned: boolean | null };
  /** M4's verdict; null when it could not be evaluated. */
  readonly satisfied: boolean | null;
  readonly progression: PrerequisiteProgression;
  readonly reason: string | null;
}

export type ModificationSupport = "APPLIED" | "REFERENCE" | "UNSUPPORTED";

export interface ActionImprovementModificationResult {
  readonly modificationKey: string;
  readonly kind: ActionImprovementModification["kind"];
  /** APPLIED: evaluable by an existing rule; REFERENCE: presented, never executed; UNSUPPORTED: no existing rule. */
  readonly support: ModificationSupport;
  readonly reason: string | null;
  readonly rulesText: string;
  readonly condition: RequirementNode | null;
  /** The explicit improved AP cost (ACTION_POINT_COST only) — the authored value, applied as an explicit-rule override. */
  readonly actionPointCost: { readonly model: "FIXED"; readonly amount: number } | null;
  readonly useCaseKey: string | null;
  readonly operationKey: string | null;
}

export type ParentActionState = "PINNED" | "REVISION_MISMATCH" | "NOT_IN_RELEASE";

export interface ActionImprovementEvaluation {
  readonly improvement: ProwessDefinitionRef;
  readonly improvementKey: string;
  readonly rulesText: string;
  /** The exact parent ACTION the improvement names, and whether this Release pins exactly that revision. */
  readonly parent: { readonly action: ProwessDefinitionRef; readonly state: ParentActionState; readonly pinned: ProwessDefinitionRef | null };
  readonly eligibility: { readonly status: EligibilityStatus; readonly prerequisites: readonly ActionImprovementPrerequisiteResult[]; readonly unresolved: readonly string[] };
  readonly applicability: { readonly status: "APPLICABLE" | "PARTIAL" | "UNSUPPORTED"; readonly modifications: readonly ActionImprovementModificationResult[] };
  readonly status: ActionProgressionStatus;
  readonly reasons: readonly { readonly code: string; readonly message: string }[];
  readonly source: ActionImprovementPayload["source"];
  readonly provenance: { readonly rulesetId: string; readonly manifestId: string };
}

export const ACTION_IMPROVEMENT_REASON_CODES = Object.freeze({
  PARENT_NOT_IN_RELEASE: "ACTION_IMPROVEMENT.PARENT_NOT_IN_RELEASE",
  PARENT_REVISION_MISMATCH: "ACTION_IMPROVEMENT.PARENT_REVISION_MISMATCH",
  PREREQUISITE_UNRESOLVED: "ACTION_IMPROVEMENT.PREREQUISITE_UNRESOLVED",
  PREREQUISITE_UNREACHABLE: "ACTION_IMPROVEMENT.PREREQUISITE_UNREACHABLE",
  PROGRESSION_UNDETERMINED: "ACTION_IMPROVEMENT.PROGRESSION_UNDETERMINED",
  PREREQUISITES_UNMET: "ACTION_IMPROVEMENT.PREREQUISITES_UNMET",
  OPERATION_UNSUPPORTED: "ACTION_IMPROVEMENT.OPERATION_UNSUPPORTED",
  CONDITIONAL_MODIFICATION: "ACTION_IMPROVEMENT.CONDITIONAL_MODIFICATION",
} as const);
const R = ACTION_IMPROVEMENT_REASON_CODES;

const LEVEL_FACT = "character.level";

function levelResult(q: Extract<ActionImprovementPrerequisite, { kind: "LEVEL_AT_LEAST" }>, profile: CharacterMechanicalProfile): ActionImprovementPrerequisiteResult {
  const satisfied = numericCompare(LEVEL_FACT, profile.level, ">=", q.minimum);
  // The Release's Level range is authoritative progression: a Level within it is reached by advancement; above it, never.
  const withinRange = numericCompare("character.maximum_level", profile.maximumLevel, ">=", q.minimum);
  const progression: PrerequisiteProgression = satisfied === null || withinRange === null ? "UNRESOLVED" : satisfied ? "MET" : withinRange ? "REACHABLE" : "UNREACHABLE";
  const reason =
    progression === "UNRESOLVED" ? "the Level comparison could not be evaluated" : progression === "REACHABLE" ? `reached by advancing to Level ${q.minimum}` : progression === "UNREACHABLE" ? `this Release's Levels end at ${profile.maximumLevel}` : null;
  return { prerequisiteKey: q.prerequisiteKey, kind: q.kind, required: { level: q.minimum, stat: null, minimum: q.minimum, skillKey: null, affinity: null, rankKey: null }, actual: { value: profile.level, rankKey: null, owned: null }, satisfied, progression, reason };
}

function statResult(q: Extract<ActionImprovementPrerequisite, { kind: "STAT_AT_LEAST" }>, profile: CharacterMechanicalProfile): ActionImprovementPrerequisiteResult {
  const row = profile.stats.find((s) => s.stat === q.stat);
  const required = { level: null, stat: q.stat, minimum: q.minimum, skillKey: null, affinity: null, rankKey: null };
  if (row === undefined) return { prerequisiteKey: q.prerequisiteKey, kind: q.kind, required, actual: { value: null, rankKey: null, owned: null }, satisfied: null, progression: "UNRESOLVED", reason: `the Character profile has no ${q.stat} score` };
  const satisfied = numericCompare(`stat.${q.stat}`, row.final, ">=", q.minimum);
  // The Stat's own authored maximum is authoritative: a requirement above it can never be met. Below it, no Stat-point
  // pathway is inferred — whether advancement can raise this Stat that far is not decided by any authored rule.
  const withinMaximum = numericCompare(`stat.${q.stat}.maximum`, row.maximum, ">=", q.minimum);
  const progression: PrerequisiteProgression = satisfied === null || withinMaximum === null ? "UNRESOLVED" : satisfied ? "MET" : withinMaximum ? "UNDETERMINED" : "UNREACHABLE";
  const reason =
    progression === "UNRESOLVED"
      ? "the Stat comparison could not be evaluated"
      : progression === "UNDETERMINED"
        ? `no authored rule decides whether ${q.stat} can reach ${q.minimum}`
        : progression === "UNREACHABLE"
          ? `${q.stat} is at most ${row.maximum} in this Release`
          : null;
  return { prerequisiteKey: q.prerequisiteKey, kind: q.kind, required, actual: { value: row.final, rankKey: null, owned: null }, satisfied, progression, reason };
}

function rankResult(q: ConstructionPrerequisite, r: RequirementResult | undefined, unresolved: readonly string[]): ActionImprovementPrerequisiteResult {
  const own = unresolved.filter((u) => u.startsWith(`${q.prerequisiteKey}:`));
  const satisfied = r === undefined || own.length > 0 ? null : r.satisfied;
  const progression: PrerequisiteProgression = satisfied === null ? "UNRESOLVED" : satisfied ? "MET" : "UNDETERMINED";
  const reason = progression === "UNRESOLVED" ? (own[0] ?? unresolved[0] ?? "the rank comparison could not be evaluated") : progression === "UNDETERMINED" ? "no authored progression rule decides when this rank is reached" : null;
  return {
    prerequisiteKey: q.prerequisiteKey,
    kind: q.kind,
    required: { level: null, stat: null, minimum: null, skillKey: q.kind === "SKILL_RANK_AT_LEAST" ? q.skillKey : null, affinity: q.kind === "AFFINITY_RANK_AT_LEAST" ? q.affinity : null, rankKey: q.minimumRank },
    actual: { value: null, rankKey: r?.actual.rankKey ?? null, owned: r?.actual.owned ?? null },
    satisfied,
    progression,
    reason,
  };
}

function modificationResult(m: ActionImprovementModification, parent: ActionDefinitionPayload | null): ActionImprovementModificationResult {
  const base = { modificationKey: m.modificationKey, kind: m.kind, rulesText: m.rulesText, condition: m.condition, actionPointCost: null, useCaseKey: null, operationKey: null };
  if (m.kind === "ADDITIONAL_USE_CASE") return { ...base, useCaseKey: m.useCaseKey, support: "REFERENCE", reason: "an additional use case is presented with the Action; the Studio never executes it" };
  if (m.kind === "RULE_OPERATION") return { ...base, operationKey: m.operationKey, support: "UNSUPPORTED", reason: `no existing rule evaluates the operation ${m.operationKey}; it is shown, never executed` };
  // The ACTION contract's own override hook (M5-WO3: costOverride of a FIXED cost, only where explicitly overridable).
  const overridable = parent !== null && parent.costOverridableByExplicitRule && parent.actionPointCost.model === "FIXED";
  return {
    ...base,
    actionPointCost: m.actionPointCost,
    support: overridable ? "APPLIED" : "UNSUPPORTED",
    reason: overridable ? null : parent === null ? "the parent ACTION is not pinned by this Release" : "the parent ACTION's cost is not a FIXED cost overridable by an explicit rule",
  };
}

/**
 * Evaluates one ACTION_IMPROVEMENT envelope (already validated by the bundle) for this Character. Nothing is applied,
 * spent or persisted; the result is deep-frozen.
 */
export function evaluateActionImprovement(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile; readonly improvement: ProwessDefinitionEnvelope }): ActionImprovementEvaluation {
  const { bundle, profile } = request;
  const envelope = request.improvement;
  const ref = definitionRefOf(envelope);
  const payload = envelope.payload as unknown as ActionImprovementPayload;
  const reasons: { code: string; message: string }[] = [];

  // ---- the exact parent ACTION -------------------------------------------------------------------------------------
  const pinnedEnvelope = bundle.definitions.find((d) => d.entityId === payload.action.entityId && d.definitionKind === "ACTION") ?? null;
  const state: ParentActionState = pinnedEnvelope === null ? "NOT_IN_RELEASE" : pinnedEnvelope.entityVersionId === payload.action.entityVersionId ? "PINNED" : "REVISION_MISMATCH";
  if (state === "NOT_IN_RELEASE") reasons.push({ code: R.PARENT_NOT_IN_RELEASE, message: `the parent ACTION ${payload.action.canonicalKey} is not pinned by this Release` });
  if (state === "REVISION_MISMATCH") reasons.push({ code: R.PARENT_REVISION_MISMATCH, message: `the improvement names ACTION revision ${payload.action.entityVersionId}; this Release pins ${pinnedEnvelope?.entityVersionId ?? ""}` });
  const parentPayload = state === "PINNED" && pinnedEnvelope !== null ? (pinnedEnvelope.payload as unknown as ActionDefinitionPayload) : null;

  // ---- eligibility: each prerequisite independently ----------------------------------------------------------------
  const rankPrerequisites = payload.prerequisites.filter((q): q is Extract<ActionImprovementPrerequisite, { kind: "SKILL_RANK_AT_LEAST" | "AFFINITY_RANK_AT_LEAST" }> => q.kind === "SKILL_RANK_AT_LEAST" || q.kind === "AFFINITY_RANK_AT_LEAST");
  const ranks = evaluateRankPrerequisites({ bundle, profile, prerequisites: rankPrerequisites, source: ref });
  const prerequisites = payload.prerequisites.map((q) => {
    if (q.kind === "LEVEL_AT_LEAST") return levelResult(q, profile);
    if (q.kind === "STAT_AT_LEAST") return statResult(q, profile);
    return rankResult(q, ranks.requirements.find((r) => r.prerequisiteKey === q.prerequisiteKey), ranks.unresolved);
  });
  const unresolved = [...ranks.unresolved];
  const eligibilityStatus: EligibilityStatus = unresolved.length > 0 || prerequisites.some((x) => x.satisfied === null) ? "UNRESOLVED" : prerequisites.every((x) => x.satisfied === true) ? "ELIGIBLE" : "INELIGIBLE";

  // ---- applicability: against the existing ACTION contract ----------------------------------------------------------
  const modifications = payload.modifications.map((m) => modificationResult(m, parentPayload));
  const supported = modifications.filter((m) => m.support !== "UNSUPPORTED");
  const applicabilityStatus = supported.length === modifications.length ? ("APPLICABLE" as const) : supported.length === 0 ? ("UNSUPPORTED" as const) : ("PARTIAL" as const);
  for (const m of modifications) if (m.support === "UNSUPPORTED") reasons.push({ code: R.OPERATION_UNSUPPORTED, message: `${m.modificationKey}: ${m.reason ?? "unsupported"}` });

  // ---- progression status --------------------------------------------------------------------------------------------
  let status: ActionProgressionStatus;
  if (state !== "PINNED") status = "UNRESOLVED";
  else if (eligibilityStatus === "UNRESOLVED") {
    status = "UNRESOLVED";
    for (const x of prerequisites) if (x.progression === "UNRESOLVED") reasons.push({ code: R.PREREQUISITE_UNRESOLVED, message: `${x.prerequisiteKey}: ${x.reason ?? "could not be evaluated"}` });
    for (const u of unresolved) if (!reasons.some((r) => r.message.endsWith(u))) reasons.push({ code: R.PREREQUISITE_UNRESOLVED, message: u });
  } else if (eligibilityStatus === "INELIGIBLE") {
    const unmet = prerequisites.filter((x) => x.progression !== "MET");
    for (const x of unmet) reasons.push({ code: x.progression === "UNREACHABLE" ? R.PREREQUISITE_UNREACHABLE : x.progression === "REACHABLE" ? R.PREREQUISITES_UNMET : R.PROGRESSION_UNDETERMINED, message: `${x.prerequisiteKey}: ${x.reason ?? "unmet"}` });
    status = unmet.some((x) => x.progression === "UNREACHABLE") ? "UNAVAILABLE" : unmet.every((x) => x.progression === "REACHABLE") ? "FUTURE" : "UNRESOLVED";
  } else if (applicabilityStatus === "UNSUPPORTED") status = "UNRESOLVED";
  else if (supported.some((m) => m.condition !== null)) {
    status = "CONDITIONAL";
    reasons.push({ code: R.CONDITIONAL_MODIFICATION, message: "at least one modification applies only when its authored condition holds (decided at use, never here)" });
  } else status = "ACTIVE";

  return deepFreeze({
    improvement: ref,
    improvementKey: payload.improvementKey,
    rulesText: payload.rulesText,
    parent: { action: payload.action, state, pinned: pinnedEnvelope === null ? null : definitionRefOf(pinnedEnvelope) },
    eligibility: { status: eligibilityStatus, prerequisites, unresolved },
    applicability: { status: applicabilityStatus, modifications },
    status,
    reasons,
    source: payload.source,
    provenance: { rulesetId: bundle.rulesetProvenance.rulesetId, manifestId: bundle.rulesetProvenance.manifestId },
  });
}

/** Every ACTION_IMPROVEMENT the Release pins for one exact parent ACTION Entity, evaluated; ordered by canonical key. */
export function actionImprovementsFor(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile; readonly action: ProwessDefinitionRef }): readonly ActionImprovementEvaluation[] {
  const envelopes = request.bundle.definitions.filter((d) => d.definitionKind === "ACTION_IMPROVEMENT" && (d.payload as unknown as ActionImprovementPayload).action.entityId === request.action.entityId);
  const ordered = [...envelopes].sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0));
  return deepFreeze(ordered.map((improvement) => evaluateActionImprovement({ bundle: request.bundle, profile: request.profile, improvement })));
}
