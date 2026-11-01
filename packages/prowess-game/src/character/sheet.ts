import { evaluateModifiers, orchestrateRulesEvaluation, type RulesetContext } from "@prowess/rules";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION } from "../contract-version.js";
import { buildCoreResolutionContexts, compileCoreResolution } from "../core/compile.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import type { AffinityStrengthRule, AffinityWeaknessRule } from "../definition/affinity-payload.js";
import { definitionRefOf, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { ResourceDefinitionPayload } from "../definition/runtime-payload.js";
import { deepFreeze } from "../internal/plain-data.js";
import { PROWESS_STATS, type DerivedStatistic, type ProwessStat } from "../vocabulary/core.js";
import type { CharacterMechanicalProfile } from "./advancement.js";
import { characterAccessSummary } from "./eligibility.js";
import { numericCompare, rankAtLeast } from "./requirements.js";

/**
 * PAS-10 M6-WO5 — the mechanical half of the Digital Character Sheet, read from the ONE CharacterMechanicalProfile
 * (M6-WO4) and the Character's exact Release bundle. Nothing here is a new rule:
 *
 *   - Stat totals, Character Die, Character DC, Accuracy, Dodge, Strength Armor, Movement and Range are the profile's
 *     derived values (published DERIVED_STAT Formulas, run by M4);
 *   - Save and Initiative modifiers are the Release's SAVING_THROW / INITIATIVE totals compiled and run by M4, read as
 *     (total − the natural die result of that same run) — the part of the published total that is not the die;
 *   - Skill scores are the Release's SKILL_RANK bonus for the Character's exact rank;
 *   - resource maximums come from each RESOURCE Definition's own maximum source;
 *   - Affinity Strengths / Weaknesses are the exact pinned AFFINITY payloads; Authority comes from the access summary.
 *
 * A value the Release does not define is UNAVAILABLE with a reason — never guessed (Concentration, Attunement, Carry).
 * Play-state validation checks a submitted current value against the RESOURCE minimum and its derived maximum and
 * fails closed (no clamping, no overflow, no carry-over is invented).
 */

export const CHARACTER_SHEET_ERROR_CODES = deepFreeze({
  NOT_A_SHEET_RESOURCE: "PROWESS_SHEET.NOT_A_SHEET_RESOURCE",
  NOT_A_WHOLE_NUMBER: "PROWESS_SHEET.NOT_A_WHOLE_NUMBER",
  BELOW_MINIMUM: "PROWESS_SHEET.BELOW_MINIMUM",
  ABOVE_MAXIMUM: "PROWESS_SHEET.ABOVE_MAXIMUM",
  MAXIMUM_UNAVAILABLE: "PROWESS_SHEET.MAXIMUM_UNAVAILABLE",
  EVALUATION_FAILED: "PROWESS_SHEET.EVALUATION_FAILED",
} as const);
const E = CHARACTER_SHEET_ERROR_CODES;

export interface SheetValue {
  /** null when the Release defines no rule for it (see `unavailable`). */
  readonly value: number | null;
  readonly unit: string | null;
  readonly unavailable: string | null;
  readonly source: ProwessDefinitionRef | null;
}

export interface SheetSkill {
  readonly skill: ProwessDefinitionRef;
  readonly rankKey: string;
  /** The Release's SKILL_RANK bonus for this exact rank. */
  readonly score: number | null;
  /** Whether a Skill Check may be attempted at this rank without explicit permission (SKILL_RANK `attemptAllowed`). */
  readonly attemptAllowed: boolean | null;
  /** Each rank of the ladder after the first, and whether the Character holds it (T / E / M markers). */
  readonly ranks: readonly { readonly rankKey: string; readonly held: boolean }[];
}

export interface SheetResource {
  readonly resourceKey: string;
  readonly definition: ProwessDefinitionRef;
  readonly minimum: number;
  readonly maximum: number | null;
  readonly maximumSource: DerivedStatistic | null;
  readonly refresh: readonly { readonly timing: string; readonly target: string }[];
}

export interface SheetAffinity {
  readonly affinity: ProwessDefinitionRef;
  readonly identity: string;
  readonly role: string;
  readonly rank: string;
  readonly authority: { readonly minimumRank: string; readonly eligible: boolean | null } | null;
  readonly strengths: readonly AffinityStrengthRule[];
  readonly weaknesses: readonly AffinityWeaknessRule[];
}

export interface CharacterSheetMechanics {
  readonly stats: readonly { readonly stat: ProwessStat; readonly total: number; readonly savingThrow: SheetValue; readonly definition: ProwessDefinitionRef }[];
  readonly combat: {
    readonly characterDie: { readonly dieKey: string; readonly faces: number };
    readonly characterDc: SheetValue;
    readonly accuracy: SheetValue;
    readonly armor: SheetValue;
    readonly dodge: SheetValue;
    readonly initiative: SheetValue;
    readonly movement: SheetValue;
    readonly range: SheetValue;
    readonly concentration: { readonly maximum: SheetValue };
  };
  readonly resources: readonly SheetResource[];
  readonly skills: readonly SheetSkill[];
  readonly affinities: readonly SheetAffinity[];
  readonly attunement: { readonly maximum: SheetValue; readonly used: SheetValue };
  readonly carry: { readonly currentWeight: SheetValue; readonly maximumLoad: SheetValue };
  readonly signatureCapacity: number | null;
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

const unavailable = (reason: string): SheetValue => ({ value: null, unit: null, unavailable: reason, source: null });

/** The input @prowess/game's core resolution takes, rebuilt from the profile (the profile is the only source). */
function characterOf(profile: CharacterMechanicalProfile) {
  return {
    level: profile.level,
    characterDie: { dieKey: profile.characterDie.dieKey },
    stats: profile.constructionContext.stats,
    baseHp: profile.baseHp,
    baseMp: profile.baseMp,
    skillRanks: profile.constructionContext.skillRanks,
    explicitBonuses: [],
  };
}

/**
 * The non-die part of a published roll total: compile the procedure, run it in M4 with a valid natural result, and
 * take (total − natural) through M4's modifier engine. Null when the Release defines no such procedure.
 */
function rollModifier(bundle: ProwessDefinitionBundle, ruleset: RulesetContext, profile: CharacterMechanicalProfile, procedure: "SAVING_THROW" | "INITIATIVE", stat: ProwessStat | null): number | null {
  const character = characterOf(profile);
  const subject = { kind: "CORE_RESOLUTION" as const, subjectKey: `sheet.${procedure.toLowerCase()}${stat === null ? "" : `.${stat.toLowerCase()}`}`, procedure, mode: "NORMAL" as const, ...(stat === null ? {} : { stat }) };
  const plan = compileCoreResolution({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subject, definitions: bundle, ruleset, character });
  if (!plan.ok) return null;
  const roll = { die: { dieKey: profile.characterDie.dieKey, faces: profile.characterDie.faces }, mode: "NORMAL", rolls: [profile.characterDie.faces] };
  const contexts = buildCoreResolutionContexts({ definitions: bundle, character, plan: plan.value, roll, difficultyClass: profile.characterDie.faces });
  if (!contexts.ok) return null;
  const response = orchestrateRulesEvaluation({ evaluationKey: `m6-wo5.${subject.subjectKey}`, contexts: { ruleset, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) return null;
  const read = (stepKey: string | null): number | null => {
    const step = stepKey === null ? undefined : response.data?.steps.find((s) => s.stepKey === stepKey);
    const data = step?.response?.data as { finalValue?: unknown } | null | undefined;
    return step?.executionStatus === "EXECUTED" && typeof data?.finalValue === "number" ? data.finalValue : null;
  };
  const total = read(plan.value.outputs.total);
  const natural = read(plan.value.outputs.natural);
  if (total === null || natural === null) return null;
  const out = evaluateModifiers({
    targets: [{ targetKey: "roll.modifier", kind: "NUMERIC", value: total }],
    modifiers: [
      {
        modifierKey: "sheet.natural",
        targetKey: "roll.modifier",
        operation: "SUBTRACT",
        operand: natural,
        phase: { phaseKey: "character-sheet", phaseOrder: 0 },
        priority: 0,
        order: 0,
        condition: null,
        stacking: { policy: "STACK" },
        source: { sourceType: "character.sheet", sourceKey: "natural", sourceId: null },
        provenance: null,
      },
    ],
  });
  const target = out.success && out.data !== null ? out.data.finalTargets.find((t) => t.targetKey === "roll.modifier") : undefined;
  return target !== undefined && target.kind === "NUMERIC" ? target.value : null;
}

/** The mechanical sheet of one Character, from its profile and exact Release. Pure and deterministic. */
export function buildCharacterSheetMechanics(request: { readonly bundle: ProwessDefinitionBundle; readonly ruleset: RulesetContext; readonly profile: CharacterMechanicalProfile }): CharacterSheetMechanics {
  const { bundle, ruleset, profile } = request;
  const issues: { code: string; path: string; message: string }[] = [];
  const core = indexCoreDefinitions(bundle);
  const derived = (statistic: DerivedStatistic): SheetValue => {
    const d = profile.derivedStatistics.find((x) => x.statistic === statistic);
    return d === undefined ? unavailable(`this Release defines no ${statistic} statistic`) : { value: d.value, unit: d.unit, unavailable: null, source: d.definition };
  };
  const procedureSource = (procedure: "SAVING_THROW" | "INITIATIVE") => (core.ok ? (core.value.procedures[procedure]?.ref ?? null) : null);
  const modifier = (procedure: "SAVING_THROW" | "INITIATIVE", stat: ProwessStat | null): SheetValue => {
    const source = procedureSource(procedure);
    if (source === null) return unavailable(`this Release defines no ${procedure} procedure`);
    const value = rollModifier(bundle, ruleset, profile, procedure, stat);
    if (value === null) {
      issues.push({ code: E.EVALUATION_FAILED, path: `${procedure}${stat === null ? "" : `.${stat}`}`, message: `${source.canonicalKey} could not be evaluated for this Character` });
      return unavailable(`${source.canonicalKey} could not be evaluated`);
    }
    return { value, unit: null, unavailable: null, source };
  };

  const stats = PROWESS_STATS.flatMap((stat) => {
    const s = profile.stats.find((x) => x.stat === stat);
    return s === undefined ? [] : [{ stat, total: s.final, savingThrow: modifier("SAVING_THROW", stat), definition: s.definition }];
  });

  // Skills: every SKILL the Release pins on the Skill ladder, with the Character's exact rank (the ladder's first rank
  // when untrained) and that rank's published bonus.
  const skills: SheetSkill[] = [];
  if (core.ok) {
    const ladder = [...core.value.skillLadder.payload.ranks].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    const first = ladder[0];
    const bonuses = core.value.skillRanks.payload.entries;
    for (const envelope of bundle.definitions.filter((d) => d.definitionKind === "SKILL")) {
      const owned = profile.skills.find((s) => s.skill.entityId === envelope.entityId);
      const rankKey = owned?.rankKey ?? first?.rankKey ?? "";
      const at = ladder.find((r) => r.rankKey === rankKey);
      const entry = bonuses.find((b) => b.rankKey === rankKey);
      skills.push({
        skill: definitionRefOf(envelope),
        rankKey,
        score: entry?.bonus ?? null,
        attemptAllowed: entry?.attemptAllowed ?? null,
        ranks: ladder.slice(1).map((r) => ({ rankKey: r.rankKey, held: at !== undefined && rankAtLeast(`skill_rank.${envelope.canonicalKey}`, at, r) === true })),
      });
    }
  }

  // Resources with a derived maximum (the Character's spendable pools, slots and actions).
  const resources: SheetResource[] = [];
  for (const envelope of bundle.definitions.filter((d) => d.definitionKind === "RESOURCE")) {
    const payload = envelope.payload as unknown as ResourceDefinitionPayload;
    if (payload.maximum.source !== "DERIVED") continue;
    const statistic = payload.maximum.statistic as DerivedStatistic;
    const max = profile.derivedStatistics.find((d) => d.statistic === statistic);
    resources.push({
      resourceKey: payload.resourceKey,
      definition: definitionRefOf(envelope),
      minimum: payload.minimum,
      maximum: max?.value ?? null,
      maximumSource: statistic,
      refresh: payload.refresh.map((r) => ({ timing: r.timing, target: r.target })),
    });
  }

  // Affinities: exact pinned payloads + Authority from the access summary.
  const access = characterAccessSummary({ bundle, profile });
  const affinities: SheetAffinity[] = profile.affinities.map((a) => {
    const envelope = bundle.definitions.find((d) => d.entityId === a.affinity.entityId && d.entityVersionId === a.affinity.entityVersionId);
    const payload = (envelope?.payload ?? {}) as { strengths?: readonly AffinityStrengthRule[]; weaknesses?: readonly AffinityWeaknessRule[] };
    const authority = access.spell.affinityAuthorities.find((x) => x.affinity.entityId === a.affinity.entityId);
    return {
      affinity: a.affinity,
      identity: a.identity,
      role: a.role,
      rank: a.rank,
      authority: authority === undefined ? null : { minimumRank: authority.minimumRank, eligible: authority.eligible },
      strengths: payload.strengths ?? [],
      weaknesses: payload.weaknesses ?? [],
    };
  });

  const none = "this Release defines no rule for it yet";
  return deepFreeze({
    stats,
    combat: {
      characterDie: profile.characterDie,
      characterDc: derived("CHARACTER_DC"),
      accuracy: derived("ACCURACY"),
      armor: derived("STRENGTH_ARMOR"),
      dodge: derived("DODGE"),
      initiative: modifier("INITIATIVE", null),
      movement: derived("MOVEMENT"),
      range: derived("BASE_RANGE"),
      concentration: { maximum: unavailable(`Concentration capacity: ${none}`) },
    },
    resources,
    skills,
    affinities,
    attunement: { maximum: unavailable(`Attunement: ${none}`), used: unavailable(`Attunement: ${none}`) },
    carry: { currentWeight: unavailable(`Carry & Weight: ${none}`), maximumLoad: unavailable(`Carry & Weight: ${none}`) },
    signatureCapacity: profile.signatureCapacity,
    issues,
  });
}

/**
 * Validates submitted CURRENT resource values against the sheet's resources: whole numbers, at least the RESOURCE
 * minimum, at most its derived maximum. Nothing is clamped or carried over; an out-of-range value is refused.
 */
export function validateSheetPlayState(request: { readonly resources: readonly SheetResource[]; readonly values: unknown }): readonly { readonly code: string; readonly path: string; readonly message: string }[] {
  const issues: { code: string; path: string; message: string }[] = [];
  const values = request.values;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return [{ code: E.NOT_A_SHEET_RESOURCE, path: "resources", message: "resources is { RESOURCE_KEY: current value }" }];
  for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
    const r = request.resources.find((x) => x.resourceKey === key);
    if (r === undefined) {
      issues.push({ code: E.NOT_A_SHEET_RESOURCE, path: `resources.${key}`, message: `${key} is not a current-value resource of this Character's Release` });
      continue;
    }
    if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
      issues.push({ code: E.NOT_A_WHOLE_NUMBER, path: `resources.${key}`, message: `${key} is a whole number` });
      continue;
    }
    if (r.maximum === null) {
      issues.push({ code: E.MAXIMUM_UNAVAILABLE, path: `resources.${key}`, message: `${key} has no derived maximum for this Character` });
      continue;
    }
    if (numericCompare(`resource.${key}`, raw, ">=", r.minimum) !== true) issues.push({ code: E.BELOW_MINIMUM, path: `resources.${key}`, message: `${key} cannot be below ${r.minimum}` });
    else if (numericCompare(`resource.${key}`, raw, "<=", r.maximum) !== true) issues.push({ code: E.ABOVE_MAXIMUM, path: `resources.${key}`, message: `${key} cannot exceed its maximum ${r.maximum}` });
  }
  return deepFreeze(issues);
}
