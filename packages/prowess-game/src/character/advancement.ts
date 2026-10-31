import { evaluateModifiers, orchestrateRulesEvaluation, type RulesetContext } from "@prowess/rules";
import { validateAffinityProfile, validateAffinityProgression, type CharacterAffinityProfile } from "../affinity/profile.js";
import { findAffinityEntry, indexAffinityDefinitions, type AffinityDefinitionIndex } from "../affinity/definitions.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION } from "../contract-version.js";
import { resolveCharacterDie } from "../core/character.js";
import { buildCoreResolutionContexts, compileCoreResolution } from "../core/compile.js";
import { indexCoreDefinitions, type CoreDefinitionIndex, type CoreEntry } from "../core/definitions.js";
import type { CharacterAdvancementLevel, CharacterAdvancementRulePayload } from "../definition/advancement-payload.js";
import type { AffinityAdvancementOption, AffinityProgressionLevel, AffinityProgressionPayload } from "../definition/affinity-payload.js";
import type { SkillDefinitionPayload } from "../definition/character-payload.js";
import type { StatMasteryPayload } from "../definition/core-payload.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import { deepFreeze } from "../internal/plain-data.js";
import type { AffinityRank, AffinityRole } from "../vocabulary/affinity.js";
import { DERIVED_STATISTICS, PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import { getCharacterCreationCapability, validateCharacterCreation, type CharacterCreationCandidate, type CharacterCreationCapability, type CharacterDerivedValue } from "./creation.js";
import { numericCompare, requirementMet } from "./requirements.js";
import { accessChanges, type AccessChanges } from "./eligibility.js";

/**
 * Character advancement (PAS-10 M6-WO4) — pure, deterministic, side-effect free.
 *
 * A Character's mechanical state is REBUILT, never stored: its Level-1 creation choices (WO3) plus its ordered
 * advancement history, resolved against the ONE exact Release bundle it is pinned to. The Release owns every number:
 *
 *   CHARACTER_ADVANCEMENT_RULE   Stat Points and Skill advancements per Level (and so which Levels can be reached)
 *   CHARACTER_DIE_PROGRESSION    the Character Die of each Level (and the declared Character Levels)
 *   RANK_LADDER (SKILL)          Skill ranks, their order and the top rank
 *   AFFINITY_PROGRESSION         when Affinities rank up or are gained, and which options a Level offers
 *   STAT / DERIVED_STAT          Stat bounds and every derived statistic (M5 core compiler + frozen M4)
 *   CORE_RESOLUTION STAT_MASTERY the Stat Mastery thresholds (a derived signal, never stored)
 *
 * Totals are M4 Modifier evaluations; every "at least" question is an M4 Requirement (./requirements.ts). The Affinity
 * profile is validated by the existing M5 validators (validateAffinityProfile / validateAffinityProgression).
 */

export const CHARACTER_ADVANCEMENT_ERROR_CODES = deepFreeze({
  MISSING_ADVANCEMENT_CONTENT: "PROWESS_ADVANCEMENT.MISSING_ADVANCEMENT_CONTENT",
  INCOHERENT_PROGRESSION: "PROWESS_ADVANCEMENT.INCOHERENT_PROGRESSION",
  CORE_CREATION_INCOMPLETE: "PROWESS_ADVANCEMENT.CORE_CREATION_INCOMPLETE",
  HISTORY_INVALID: "PROWESS_ADVANCEMENT.HISTORY_INVALID",
  MAX_LEVEL: "PROWESS_ADVANCEMENT.MAX_LEVEL",
  INVALID_CHOICES: "PROWESS_ADVANCEMENT.INVALID_CHOICES",
  INVALID_STAT_ALLOCATION: "PROWESS_ADVANCEMENT.INVALID_STAT_ALLOCATION",
  STAT_POINTS_UNSPENT: "PROWESS_ADVANCEMENT.STAT_POINTS_UNSPENT",
  STAT_POINTS_EXCEEDED: "PROWESS_ADVANCEMENT.STAT_POINTS_EXCEEDED",
  STAT_OUT_OF_RANGE: "PROWESS_ADVANCEMENT.STAT_OUT_OF_RANGE",
  SKILL_ADVANCEMENT_REQUIRED: "PROWESS_ADVANCEMENT.SKILL_ADVANCEMENT_REQUIRED",
  SKILL_ADVANCEMENT_EXCEEDED: "PROWESS_ADVANCEMENT.SKILL_ADVANCEMENT_EXCEEDED",
  SKILL_ALREADY_TRAINED: "PROWESS_ADVANCEMENT.SKILL_ALREADY_TRAINED",
  SKILL_NOT_TRAINED: "PROWESS_ADVANCEMENT.SKILL_NOT_TRAINED",
  SKILL_ALREADY_MASTER: "PROWESS_ADVANCEMENT.SKILL_ALREADY_MASTER",
  DUPLICATE_SKILL_ADVANCEMENT: "PROWESS_ADVANCEMENT.DUPLICATE_SKILL_ADVANCEMENT",
  CROSS_RELEASE_SELECTION: "PROWESS_ADVANCEMENT.CROSS_RELEASE_SELECTION",
  WRONG_DEFINITION_KIND: "PROWESS_ADVANCEMENT.WRONG_DEFINITION_KIND",
  AFFINITY_CHOICE_REQUIRED: "PROWESS_ADVANCEMENT.AFFINITY_CHOICE_REQUIRED",
  AFFINITY_CHOICE_NOT_ALLOWED: "PROWESS_ADVANCEMENT.AFFINITY_CHOICE_NOT_ALLOWED",
  AFFINITY_OPTION_ILLEGAL: "PROWESS_ADVANCEMENT.AFFINITY_OPTION_ILLEGAL",
  AFFINITY_OPTION_UNRESOLVED: "PROWESS_ADVANCEMENT.AFFINITY_OPTION_UNRESOLVED",
  AFFINITY_NOT_EXECUTABLE: "PROWESS_ADVANCEMENT.AFFINITY_NOT_EXECUTABLE",
  AFFINITY_ALREADY_OWNED: "PROWESS_ADVANCEMENT.AFFINITY_ALREADY_OWNED",
  AFFINITY_PROFILE_INVALID: "PROWESS_ADVANCEMENT.AFFINITY_PROFILE_INVALID",
  DERIVED_PREVIEW_FAILED: "PROWESS_ADVANCEMENT.DERIVED_PREVIEW_FAILED",
} as const);
const E = CHARACTER_ADVANCEMENT_ERROR_CODES;

export const SKILL_ADVANCEMENT_ACTIONS = deepFreeze(["TRAIN_NEW", "UPGRADE"] as const);
export type SkillAdvancementAction = (typeof SKILL_ADVANCEMENT_ACTIONS)[number];

// ---- Public contracts ----------------------------------------------------------------------------------------------

export interface AdvancementSelection {
  readonly entityId: string;
  readonly entityVersionId: string;
}

/** The player's choices for ONE advancement — never a resulting Level, rank, die or derived value. */
export interface AdvancementChoices {
  readonly statAllocations: Readonly<Record<string, unknown>>;
  readonly skillAdvancements: readonly { readonly action: string; readonly skill: AdvancementSelection }[];
  /** Only when the Level's AFFINITY_PROGRESSION step needs a choice: the authored option and its exact Affinity. */
  readonly affinityChoice: { readonly optionKey: string; readonly affinity: AdvancementSelection | null } | null;
}

/** One committed advancement, as persisted (its Level is where it took the Character). */
export interface CommittedAdvancement extends AdvancementChoices {
  readonly toLevel: number;
}

/** The persisted Character the profile is rebuilt from. */
export interface CharacterProgressionState {
  readonly creation: CharacterCreationCandidate;
  /** The committed Level (Character.level). */
  readonly level: number;
  /** Ordered by Level. */
  readonly history: readonly CommittedAdvancement[];
}

export interface AdvancementIssue {
  readonly code: string;
  readonly severity: "ERROR" | "INCOMPLETE";
  readonly path: string;
  readonly message: string;
  readonly source: { readonly canonicalKey: string; readonly entityVersionId: string } | null;
}

export interface AdvancementCapability {
  readonly status: "ADVANCEMENT_READY" | "MISSING_REQUIRED_CONTENT";
  readonly missing: readonly { readonly requirement: string; readonly message: string }[];
}

export interface CharacterCapability {
  readonly creation: CharacterCreationCapability;
  readonly advancement: AdvancementCapability;
}

export interface ProfileStat {
  readonly stat: ProwessStat;
  readonly baseline: number;
  readonly ancestry: number;
  readonly creation: number;
  readonly advancement: number;
  readonly final: number;
  readonly minimum: number;
  readonly maximum: number;
  /** The Release's STAT_MASTERY signal for this Stat at this Level (null when the Release authors no Stat Mastery). */
  readonly mastery: boolean | null;
  readonly definition: ProwessDefinitionRef;
}

export interface ProfileSkill {
  readonly skill: ProwessDefinitionRef;
  readonly rankKey: string;
  /** How the Character first gained the Skill: creation (ANCESTRY / FREE) or an advancement (TRAIN_NEW at a Level). */
  readonly source: { readonly kind: "ANCESTRY" | "FREE" | "ADVANCEMENT"; readonly grantKey: string | null; readonly level: number };
  readonly history: readonly { readonly level: number; readonly action: string; readonly fromRankKey: string; readonly toRankKey: string }[];
}

export interface ProfileAffinity {
  readonly affinity: ProwessDefinitionRef;
  readonly identity: string;
  readonly role: AffinityRole;
  readonly rank: AffinityRank;
  readonly acquisition: { readonly level: number; readonly optionKey: string };
  readonly history: readonly { readonly level: number; readonly optionKey: string; readonly from: AffinityRank; readonly to: AffinityRank }[];
}

/**
 * The ONE projection of a Character's present mechanical state (§49–§50, §101): every downstream system (Character
 * page, access, future Spell / Maneuver / Equipment builders) reads this — none reconstructs Character rules itself.
 */
export interface CharacterMechanicalProfile {
  readonly level: number;
  readonly maximumLevel: number;
  readonly characterDie: { readonly dieKey: string; readonly faces: number };
  readonly baseHp: number;
  readonly baseMp: number;
  readonly stats: readonly ProfileStat[];
  readonly skills: readonly ProfileSkill[];
  readonly affinities: readonly ProfileAffinity[];
  readonly affinityProfile: CharacterAffinityProfile;
  readonly derivedStatistics: readonly CharacterDerivedValue[];
  readonly signatureCapacity: number | null;
  /** The exact input M5 Ability construction reads (stats, Skill ranks by Skill canonical key, Affinity profile). */
  readonly constructionContext: {
    readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
    readonly skillRanks: readonly { readonly skillKey: string; readonly rankKey: string }[];
    readonly affinityProfile: CharacterAffinityProfile;
  };
  readonly provenance: {
    readonly rulesetId: string;
    readonly manifestId: string;
    readonly advancementRule: ProwessDefinitionRef | null;
    readonly characterDieProgression: ProwessDefinitionRef;
    readonly skillLadder: ProwessDefinitionRef;
    readonly affinityProgression: ProwessDefinitionRef | null;
  };
}

export interface ProfileResult {
  readonly profile: CharacterMechanicalProfile | null;
  readonly issues: readonly AdvancementIssue[];
}

/** What reaching the next Level grants, read from the exact Release. */
export interface AdvancementEntitlements {
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly statPoints: number;
  readonly skillAdvancements: number;
  readonly characterDie: { readonly before: { readonly dieKey: string; readonly faces: number }; readonly after: { readonly dieKey: string; readonly faces: number } };
  /** The AFFINITY_PROGRESSION step at this Level: automatic (one required deterministic option) or a choice. */
  readonly affinity: { readonly mode: string; readonly automatic: boolean; readonly options: readonly AffinityAdvancementOption[]; readonly source: ProwessDefinitionRef } | null;
  readonly source: ProwessDefinitionRef;
}

/** The Level's Stat Points: granted by the rule, spent by the choices, remaining (M4 totals). */
export interface StatPointsReading {
  readonly granted: number;
  readonly spent: number;
  readonly remaining: number;
}

export type AdvancementPreviewStatus = "READY" | "INCOMPLETE" | "INVALID" | "MAX_LEVEL";

export interface AdvancementPreview {
  readonly status: AdvancementPreviewStatus;
  readonly issues: readonly AdvancementIssue[];
  readonly fromLevel: number | null;
  readonly toLevel: number | null;
  readonly entitlements: AdvancementEntitlements | null;
  readonly before: CharacterMechanicalProfile | null;
  readonly after: CharacterMechanicalProfile | null;
  /** What the advancement changes in construction access (read-only projection; nothing is granted or stored). */
  readonly accessChanges: AccessChanges | null;
  /** The Level's Stat Points as the choices stand (null when the choices could not be applied). */
  readonly statPoints: StatPointsReading | null;
  /** The committed record this preview would persist (normalized choices), when READY. */
  readonly record: CommittedAdvancement | null;
}

// ---- Content -------------------------------------------------------------------------------------------------------

interface Ladder {
  readonly ref: ProwessDefinitionRef;
  readonly ladderKey: string;
  /** In authored order (ascending `order`). */
  readonly ranks: readonly { readonly rankKey: string; readonly order: number }[];
}

interface AdvancementContent {
  readonly core: CoreDefinitionIndex;
  readonly affinity: AffinityDefinitionIndex;
  readonly rule: { readonly ref: ProwessDefinitionRef; readonly payload: CharacterAdvancementRulePayload };
  readonly progression: CoreEntry<AffinityProgressionPayload>;
  readonly ladder: Ladder;
  /** Every Character Level from the creation Level to the maximum, in order. */
  readonly levels: readonly number[];
  readonly startingLevel: number;
  readonly startingSkillRankKey: string;
}

const sourceOf = (ref: ProwessDefinitionRef | null | undefined) => (ref ? { canonicalKey: ref.canonicalKey, entityVersionId: ref.entityVersionId } : null);
const of = <P>(e: ProwessDefinitionEnvelope) => ({ ref: definitionRefOf(e), payload: e.payload as unknown as P });
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const NO_POINTS = 0;

function orderedLadder(core: CoreDefinitionIndex): Ladder {
  const ranks = [...core.skillLadder.payload.ranks].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return { ref: core.skillLadder.ref, ladderKey: core.skillLadder.payload.ladderKey, ranks };
}

/**
 * Reads and cross-checks the advancement content of one exact bundle (§8, §91–§92). Every incoherence is reported; the
 * content is returned only when the whole progression is coherent (fail closed).
 */
function readAdvancementContent(bundle: ProwessDefinitionBundle): { content: AdvancementContent | null; capability: CharacterCapability } {
  const creation = getCharacterCreationCapability(bundle);
  const missing: { requirement: string; message: string }[] = [];
  const add = (requirement: string, message: string) => missing.push({ requirement, message });
  const rules = bundle.definitions.filter((d) => d.definitionKind === "CHARACTER_ADVANCEMENT_RULE");
  if (rules.length !== 1) add("CHARACTER_ADVANCEMENT_RULE", rules.length === 0 ? "the Release pins no Character Advancement Rule" : `the Release pins ${rules.length} Character Advancement Rules; exactly one is required`);
  const creationRules = bundle.definitions.filter((d) => d.definitionKind === "CHARACTER_CREATION_RULE");
  if (creationRules.length !== 1) add("CHARACTER_CREATION_RULE", "advancement starts from the Release's one Character Creation Rule");
  const coreOut = indexCoreDefinitions(bundle);
  if (!coreOut.ok) for (const problem of coreOut.problems) add("CORE_CHARACTER_CONTENT", problem.message);
  const affinityOut = indexAffinityDefinitions(bundle);
  if (!affinityOut.ok) for (const problem of affinityOut.problems) add("AFFINITY_CONTENT", problem.message);
  else if (affinityOut.value.progression === null) add("AFFINITY_PROGRESSION", "the Release pins no Affinity Progression Definition");
  const result = (content: AdvancementContent | null) => ({
    content: missing.length === 0 ? content : null,
    capability: deepFreeze({ creation, advancement: { status: missing.length === 0 ? ("ADVANCEMENT_READY" as const) : ("MISSING_REQUIRED_CONTENT" as const), missing } }),
  });
  if (rules.length !== 1 || creationRules.length !== 1 || !coreOut.ok || !affinityOut.ok || affinityOut.value.progression === null) return result(null);

  const core = coreOut.value;
  const rule = of<CharacterAdvancementRulePayload>(rules[0] as ProwessDefinitionEnvelope);
  const creationRule = (creationRules[0] as ProwessDefinitionEnvelope).payload as unknown as { startingLevel: number; startingSkillRankKey: string };
  const progression = affinityOut.value.progression;
  const ladder = orderedLadder(core);
  const startingLevel = creationRule.startingLevel;
  const declared = core.progression.payload.levels;
  if (!declared.includes(startingLevel)) add("CHARACTER_DIE_PROGRESSION", `the creation Level ${startingLevel} is not a Character Level of ${core.progression.ref.canonicalKey}`);
  // The legal Levels: the creation Level, then exactly the Levels the advancement rule authors, in order (§8–§9).
  const authored = rule.payload.levels.map((l) => l.level);
  const later = declared.filter((l) => startingLevel < l);
  if (JSON.stringify(authored) !== JSON.stringify(later)) {
    add("CHARACTER_ADVANCEMENT_RULE", `the advancement rule authors Levels ${authored.join(", ")}; the Character Die progression declares Levels ${later.join(", ")} after the creation Level ${startingLevel} — they must be the same Levels`);
  }
  const levels = [startingLevel, ...authored];
  for (const level of levels) if (resolveCharacterDie(core.progression.payload, level) === null) add("CHARACTER_DIE_PROGRESSION", `no Character Die is declared for Level ${level}`);
  if (!ladder.ranks.some((r) => r.rankKey === creationRule.startingSkillRankKey)) add("SKILL_RANK", `${creationRule.startingSkillRankKey} is not a rank of the Skill rank ladder`);
  for (const step of progression.payload.levels) {
    if (!levels.includes(step.level)) add("AFFINITY_PROGRESSION", `Affinity progression Level ${step.level} is not a Character Level of this Release`);
  }
  const first = progression.payload.levels.find((s) => s.level === startingLevel);
  if (first === undefined || !first.options.some((o) => o.action === "CHOOSE_PRIMARY_AFFINITY")) add("AFFINITY_PROGRESSION", `the Affinity progression must choose the Primary Affinity at the creation Level ${startingLevel}`);
  return result({ core, affinity: affinityOut.value, rule, progression, ladder, levels, startingLevel, startingSkillRankKey: creationRule.startingSkillRankKey });
}

/** Whether one exact Release can create and advance Characters (§91–§93). Every missing requirement is listed. */
export function getCharacterCapability(bundle: ProwessDefinitionBundle): CharacterCapability {
  return readAdvancementContent(bundle).capability;
}

// ---- Totals through M4 ---------------------------------------------------------------------------------------------

interface Contribution {
  readonly target: string;
  readonly amount: number;
  readonly sourceType: string;
  readonly sourceKey: string;
}

function totals(targets: ReadonlyArray<{ readonly key: string; readonly base: number }>, contributions: readonly Contribution[], subtract: ReadonlySet<string> = new Set()): Map<string, number> | null {
  const response = evaluateModifiers({
    targets: targets.map((t) => ({ targetKey: t.key, kind: "NUMERIC", value: t.base })),
    modifiers: contributions.map((c, order) => ({
      modifierKey: `advancement.${String(order).padStart(4, "0")}`,
      targetKey: c.target,
      operation: subtract.has(c.target) ? "SUBTRACT" : "ADD",
      operand: c.amount,
      phase: { phaseKey: "character-advancement", phaseOrder: 0 },
      priority: 0,
      order,
      condition: null,
      stacking: { policy: "STACK" },
      source: { sourceType: c.sourceType, sourceKey: c.sourceKey, sourceId: null },
      provenance: null,
    })),
  });
  if (!response.success || response.data === null) return null;
  const out = new Map<string, number>();
  for (const t of response.data.finalTargets) if (t.kind === "NUMERIC") out.set(t.targetKey, t.value);
  return out;
}
const statTarget = (stat: ProwessStat) => `stat.${stat.toLowerCase()}`;

// ---- Progression state ---------------------------------------------------------------------------------------------

interface SkillState {
  readonly skill: ProwessDefinitionRef;
  readonly rankKey: string;
  readonly source: ProfileSkill["source"];
  readonly history: ProfileSkill["history"];
}

interface AffinityState {
  readonly affinity: ProwessDefinitionRef;
  readonly identity: string;
  readonly role: AffinityRole;
  readonly rank: AffinityRank;
  readonly acquisition: { readonly level: number; readonly optionKey: string };
  readonly history: ProfileAffinity["history"];
}

interface ProgressionState {
  readonly level: number;
  readonly creationStats: readonly { readonly stat: ProwessStat; readonly baseline: number; readonly ancestry: number; readonly creation: number; readonly final: number; readonly minimum: number; readonly maximum: number; readonly definition: ProwessDefinitionRef }[];
  readonly statAdvancements: readonly Contribution[];
  readonly skills: readonly SkillState[];
  readonly affinities: readonly AffinityState[];
  readonly baseHp: number;
  readonly baseMp: number;
}

type IssueSink = (code: string, severity: "ERROR" | "INCOMPLETE", path: string, message: string, source?: ProwessDefinitionRef | null) => void;

/** Level-1 state from the completed WO3 creation choices (they are never rewritten). */
function initialState(bundle: ProwessDefinitionBundle, ruleset: RulesetContext, c: AdvancementContent, creation: CharacterCreationCandidate, add: IssueSink): ProgressionState | null {
  const created = validateCharacterCreation({ bundle, ruleset, candidate: creation });
  if (created.status !== "READY" || created.resolved.ancestry === null || created.resolved.primaryAffinity === null || created.resolved.baseHp === null || created.resolved.baseMp === null) {
    add(E.CORE_CREATION_INCOMPLETE, "ERROR", "", `core creation is not complete for this Release (${created.issues.map((i) => i.code).join(", ") || created.status})`);
    return null;
  }
  const primary = findAffinityEntry(c.affinity, created.resolved.primaryAffinity);
  const choose = c.progression.payload.levels.find((s) => s.level === c.startingLevel)?.options.find((o) => o.action === "CHOOSE_PRIMARY_AFFINITY");
  if (primary === null || choose === undefined || choose.action !== "CHOOSE_PRIMARY_AFFINITY") {
    add(E.AFFINITY_PROFILE_INVALID, "ERROR", "primaryAffinity", "the Primary Affinity cannot be resolved against this Release's Affinity progression", created.resolved.primaryAffinity);
    return null;
  }
  return {
    level: c.startingLevel,
    creationStats: created.resolved.stats.map((s) => ({ stat: s.stat, baseline: s.baseline, ancestry: s.ancestry, creation: s.allocated, final: s.final, minimum: s.minimum, maximum: s.maximum, definition: s.definition })),
    statAdvancements: [],
    skills: created.resolved.skills.map((s) => ({ skill: s.skill, rankKey: s.rankKey, source: { kind: s.sourceKind, grantKey: s.sourceGrantKey, level: c.startingLevel }, history: [] })),
    affinities: [{ affinity: primary.ref, identity: primary.affinity, role: "PRIMARY", rank: choose.startingRank, acquisition: { level: c.startingLevel, optionKey: choose.optionKey }, history: [] }],
    baseHp: created.resolved.baseHp,
    baseMp: created.resolved.baseMp,
  };
}

/** Final Stats of a state (Level-1 final + every advancement point), through M4. */
function statFinals(state: ProgressionState): Map<ProwessStat, number> | null {
  const out = totals(
    state.creationStats.map((s) => ({ key: statTarget(s.stat), base: s.final })),
    state.statAdvancements,
  );
  if (out === null) return null;
  return new Map(state.creationStats.map((s) => [s.stat, out.get(statTarget(s.stat)) as number]));
}

/** The Level reached by advancing once from `level`, or null at the maximum Level. */
function levelAfter(c: AdvancementContent, level: number): number | null {
  return c.levels.find((l) => level < l) ?? null;
}

function entitlementsFor(c: AdvancementContent, fromLevel: number, toLevel: number): AdvancementEntitlements {
  const step = c.rule.payload.levels.find((l) => l.level === toLevel) as CharacterAdvancementLevel;
  const before = resolveCharacterDie(c.core.progression.payload, fromLevel);
  const after = resolveCharacterDie(c.core.progression.payload, toLevel);
  const affinityStep = c.progression.payload.levels.find((s) => s.level === toLevel);
  return deepFreeze({
    fromLevel,
    toLevel,
    statPoints: step.statPoints,
    skillAdvancements: step.skillAdvancements,
    characterDie: { before: { dieKey: before?.dieKey ?? "", faces: before?.faces ?? NO_POINTS }, after: { dieKey: after?.dieKey ?? "", faces: after?.faces ?? NO_POINTS } },
    affinity: affinityStep === undefined ? null : { mode: affinityStep.mode, automatic: isAutomatic(affinityStep), options: affinityStep.options, source: c.progression.ref },
    source: c.rule.ref,
  });
}

/** A required step with exactly one deterministic option (a Primary rank-up) happens without a player choice (§29). */
function isAutomatic(step: AffinityProgressionLevel): boolean {
  const only = step.options.length === 1 ? step.options[0] : undefined;
  return step.mode === "REQUIRED" && only !== undefined && only.action === "RANK_UP" && only.target === "PRIMARY";
}

const sameSelection = (a: AdvancementSelection, b: { readonly entityId: string; readonly entityVersionId: string }) => a.entityId === b.entityId && a.entityVersionId === b.entityVersionId;

/** The bundle envelope an exact selection names, checked against the Release pin and the kind. */
function pinnedSelection(bundle: ProwessDefinitionBundle, sel: unknown, kind: string, path: string, add: IssueSink): ProwessDefinitionEnvelope | null {
  if (!isRecord(sel) || typeof sel.entityId !== "string" || typeof sel.entityVersionId !== "string") {
    add(E.INVALID_CHOICES, "ERROR", path, "a selection is an exact { entityId, entityVersionId }");
    return null;
  }
  const envelope = bundle.definitions.find((d) => d.entityId === sel.entityId) ?? null;
  if (envelope === null || envelope.entityVersionId !== sel.entityVersionId) {
    add(E.CROSS_RELEASE_SELECTION, "ERROR", path, envelope === null ? "this Entity is not part of the Character's Release" : `the Character's Release pins revision ${envelope.entityVersionId}, not ${String(sel.entityVersionId)} — a matching canonical key or another revision is never accepted`);
    return null;
  }
  if (envelope.definitionKind !== kind) {
    add(E.WRONG_DEFINITION_KIND, "ERROR", path, `expected a ${kind} Definition, found ${envelope.definitionKind}`, definitionRefOf(envelope));
    return null;
  }
  return envelope;
}

/** Normalizes raw choices (shape only). */
function readChoices(raw: unknown, add: IssueSink): AdvancementChoices | null {
  if (!isRecord(raw)) {
    add(E.INVALID_CHOICES, "ERROR", "", "choices is { statAllocations, skillAdvancements, affinityChoice }");
    return null;
  }
  for (const k of Object.keys(raw)) if (!["statAllocations", "skillAdvancements", "affinityChoice"].includes(k)) add(E.INVALID_CHOICES, "ERROR", k, `${k} is not an advancement choice (Level, ranks, die and derived values are decided by the server)`);
  const statAllocations = raw.statAllocations ?? {};
  const skillAdvancements = raw.skillAdvancements ?? [];
  const affinityChoice = raw.affinityChoice ?? null;
  if (!isRecord(statAllocations)) add(E.INVALID_CHOICES, "ERROR", "statAllocations", "statAllocations is { STAT: points }");
  if (!Array.isArray(skillAdvancements)) add(E.INVALID_CHOICES, "ERROR", "skillAdvancements", "skillAdvancements is an array of { action, skill }");
  if (affinityChoice !== null && (!isRecord(affinityChoice) || typeof affinityChoice.optionKey !== "string" || !("affinity" in affinityChoice))) add(E.INVALID_CHOICES, "ERROR", "affinityChoice", "affinityChoice is null or { optionKey, affinity }");
  if (!isRecord(statAllocations) || !Array.isArray(skillAdvancements) || (affinityChoice !== null && (!isRecord(affinityChoice) || typeof affinityChoice.optionKey !== "string"))) return null;
  return {
    statAllocations: statAllocations as Record<string, unknown>,
    skillAdvancements: skillAdvancements as AdvancementChoices["skillAdvancements"],
    affinityChoice: affinityChoice as AdvancementChoices["affinityChoice"],
  };
}

/**
 * Applies ONE advancement (from `state.level` to the next Level) with `choices`, validating every choice against the
 * exact Release. Returns the next state (also when only INCOMPLETE issues exist, so a preview can show it) or null on
 * an ERROR that leaves no coherent state.
 */
function applyAdvancement(bundle: ProwessDefinitionBundle, c: AdvancementContent, state: ProgressionState, toLevel: number, choices: AdvancementChoices, add: IssueSink): { state: ProgressionState; record: CommittedAdvancement; points: StatPointsReading } | null {
  const step = c.rule.payload.levels.find((l) => l.level === toLevel) as CharacterAdvancementLevel;
  let failed = false;
  const fail: IssueSink = (code, severity, path, message, source) => {
    if (severity === "ERROR") failed = true;
    add(code, severity, path, message, source);
  };

  // ---- Stat Points (§17–§18) -----------------------------------------------------------------------------------------
  const contributions: Contribution[] = [];
  const allocations: Record<string, number> = {};
  for (const key of Object.keys(choices.statAllocations).sort()) {
    const value = choices.statAllocations[key];
    const stat = PROWESS_STATS.find((s) => s === key);
    if (stat === undefined) {
      fail(E.INVALID_STAT_ALLOCATION, "ERROR", `statAllocations.${key}`, `${key} is not a Stat`);
      continue;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < NO_POINTS) {
      fail(E.INVALID_STAT_ALLOCATION, "ERROR", `statAllocations.${key}`, "Stat Points are non-negative whole numbers");
      continue;
    }
    if (value === NO_POINTS) continue;
    allocations[stat] = value;
    contributions.push({ target: statTarget(stat), amount: value, sourceType: "character.level_advancement", sourceKey: `level_${toLevel}` });
  }
  const spentTotals = totals(
    [
      { key: "points.spent", base: NO_POINTS },
      { key: "points.remaining", base: step.statPoints },
    ],
    [...contributions.map((x) => ({ ...x, target: "points.spent" })), ...contributions.map((x) => ({ ...x, target: "points.remaining" }))],
    new Set(["points.remaining"]),
  );
  const spent = spentTotals?.get("points.spent") ?? null;
  const remaining = spentTotals?.get("points.remaining") ?? null;
  if (spent === null) fail(E.INVALID_STAT_ALLOCATION, "ERROR", "statAllocations", "the Stat Points could not be evaluated");
  else if (numericCompare("advancement.points", spent, ">=", step.statPoints) === false) fail(E.STAT_POINTS_UNSPENT, "INCOMPLETE", "statAllocations", `${spent} of ${step.statPoints} Stat Point(s) allocated`, c.rule.ref);
  else if (numericCompare("advancement.points", spent, "<=", step.statPoints) === false) fail(E.STAT_POINTS_EXCEEDED, "ERROR", "statAllocations", `${spent} Stat Points allocated; Level ${toLevel} grants ${step.statPoints}`, c.rule.ref);
  const nextStatAdvancements = [...state.statAdvancements, ...contributions];
  const finals = statFinals({ ...state, statAdvancements: nextStatAdvancements });
  if (finals === null) fail(E.INVALID_STAT_ALLOCATION, "ERROR", "statAllocations", "the Stat totals could not be evaluated");
  else
    for (const s of state.creationStats) {
      const final = finals.get(s.stat) as number;
      if (numericCompare("stat.final", final, "<=", s.maximum) === false) fail(E.STAT_OUT_OF_RANGE, "ERROR", `statAllocations.${s.stat}`, `${s.stat} would be ${final}; ${s.definition.canonicalKey} allows at most ${s.maximum}`, s.definition);
    }

  // ---- Skill advancements (§20–§27) --------------------------------------------------------------------------------
  let skills = [...state.skills];
  const skillChoices: CommittedAdvancement["skillAdvancements"][number][] = [];
  if (choices.skillAdvancements.length < step.skillAdvancements) fail(E.SKILL_ADVANCEMENT_REQUIRED, "INCOMPLETE", "skillAdvancements", `Level ${toLevel} grants ${step.skillAdvancements} Skill advancement(s); ${choices.skillAdvancements.length} chosen`, c.rule.ref);
  if (step.skillAdvancements < choices.skillAdvancements.length) fail(E.SKILL_ADVANCEMENT_EXCEEDED, "ERROR", "skillAdvancements", `Level ${toLevel} grants ${step.skillAdvancements} Skill advancement(s)`, c.rule.ref);
  const touched: string[] = [];
  choices.skillAdvancements.forEach((choice, i) => {
    const path = `skillAdvancements[${i}]`;
    if (!isRecord(choice)) return fail(E.INVALID_CHOICES, "ERROR", path, "a Skill advancement is { action, skill }");
    const action = SKILL_ADVANCEMENT_ACTIONS.find((a) => a === choice.action);
    if (action === undefined) return fail(E.INVALID_CHOICES, "ERROR", `${path}.action`, `action is one of ${SKILL_ADVANCEMENT_ACTIONS.join(", ")}`);
    const envelope = pinnedSelection(bundle, choice.skill, "SKILL", `${path}.skill`, fail);
    if (envelope === null) return;
    const ref = definitionRefOf(envelope);
    if ((envelope.payload as unknown as SkillDefinitionPayload).ladderKey !== c.ladder.ladderKey) return fail(E.WRONG_DEFINITION_KIND, "ERROR", `${path}.skill`, `${ref.canonicalKey} is not trained on the ${c.ladder.ladderKey} rank ladder`, ref);
    if (touched.includes(ref.entityId)) return fail(E.DUPLICATE_SKILL_ADVANCEMENT, "ERROR", path, `${ref.canonicalKey} is advanced once per Level at most`, ref);
    touched.push(ref.entityId);
    const owned = skills.find((s) => s.skill.entityId === ref.entityId);
    if (action === "TRAIN_NEW") {
      if (owned !== undefined) return fail(E.SKILL_ALREADY_TRAINED, "ERROR", path, `${ref.canonicalKey} is already trained (${owned.rankKey}); use UPGRADE — training never stacks`, ref);
      const untrained = c.ladder.ranks[0] as Ladder["ranks"][number];
      skills = [...skills, { skill: ref, rankKey: c.startingSkillRankKey, source: { kind: "ADVANCEMENT", grantKey: null, level: toLevel }, history: [{ level: toLevel, action, fromRankKey: untrained.rankKey, toRankKey: c.startingSkillRankKey }] }];
    } else {
      if (owned === undefined) return fail(E.SKILL_NOT_TRAINED, "ERROR", path, `${ref.canonicalKey} is untrained; use TRAIN_NEW`, ref);
      const at = c.ladder.ranks.find((r) => r.rankKey === owned.rankKey);
      const next = at === undefined ? undefined : c.ladder.ranks.find((r) => at.order < r.order);
      if (next === undefined) return fail(E.SKILL_ALREADY_MASTER, "ERROR", path, `${ref.canonicalKey} is already at the top rank (${owned.rankKey}) of ${c.ladder.ref.canonicalKey}`, ref);
      skills = skills.map((s) => (s === owned ? { ...s, rankKey: next.rankKey, history: [...s.history, { level: toLevel, action, fromRankKey: owned.rankKey, toRankKey: next.rankKey }] } : s));
    }
    skillChoices.push({ action, skill: { entityId: ref.entityId, entityVersionId: ref.entityVersionId } });
  });

  // ---- Affinity progression (§28–§34) -------------------------------------------------------------------------------
  let affinities = [...state.affinities];
  const affinityStep = c.progression.payload.levels.find((s) => s.level === toLevel);
  let affinityChoice: CommittedAdvancement["affinityChoice"] = null;
  const rankUp = (target: AffinityState, option: Extract<AffinityAdvancementOption, { action: "RANK_UP" }>) =>
    affinities.map((a) => (a === target ? { ...a, rank: option.to, history: [...a.history, { level: toLevel, optionKey: option.optionKey, from: option.from, to: option.to }] } : a));
  if (affinityStep === undefined) {
    if (choices.affinityChoice !== null) fail(E.AFFINITY_CHOICE_NOT_ALLOWED, "ERROR", "affinityChoice", `Level ${toLevel} has no Affinity progression step`, c.progression.ref);
  } else if (isAutomatic(affinityStep)) {
    if (choices.affinityChoice !== null) fail(E.AFFINITY_CHOICE_NOT_ALLOWED, "ERROR", "affinityChoice", `Level ${toLevel}'s Affinity progression is automatic`, c.progression.ref);
    const option = affinityStep.options[0] as Extract<AffinityAdvancementOption, { action: "RANK_UP" }>;
    const primary = affinities.find((a) => a.role === "PRIMARY");
    if (primary === undefined || primary.rank !== option.from) fail(E.AFFINITY_PROFILE_INVALID, "ERROR", "affinityChoice", `${option.optionKey} raises the Primary Affinity from ${option.from}; it is ${primary?.rank ?? "absent"}`, c.progression.ref);
    else affinities = rankUp(primary, option);
  } else if (choices.affinityChoice === null) {
    fail(E.AFFINITY_CHOICE_REQUIRED, "INCOMPLETE", "affinityChoice", `Level ${toLevel} requires an Affinity progression choice: ${affinityStep.options.map((o) => o.optionKey).join(" or ")}`, c.progression.ref);
  } else {
    const chosen = choices.affinityChoice;
    const option = affinityStep.options.find((o) => o.optionKey === chosen.optionKey);
    if (option === undefined) fail(E.AFFINITY_OPTION_ILLEGAL, "ERROR", "affinityChoice.optionKey", `${chosen.optionKey} is not an option of Level ${toLevel} (${affinityStep.options.map((o) => o.optionKey).join(", ")})`, c.progression.ref);
    else if (option.action === "CHOOSE_PRIMARY_AFFINITY") fail(E.AFFINITY_OPTION_ILLEGAL, "ERROR", "affinityChoice.optionKey", "the Primary Affinity is chosen at creation only", c.progression.ref);
    else if (option.action === "RANK_UP") {
      let target: AffinityState | undefined;
      if (option.target === "PRIMARY") {
        if (chosen.affinity !== null) fail(E.AFFINITY_OPTION_ILLEGAL, "ERROR", "affinityChoice.affinity", `${option.optionKey} always raises the Primary Affinity; it names no Affinity`, c.progression.ref);
        target = affinities.find((a) => a.role === "PRIMARY");
      } else if (chosen.affinity === null) fail(E.AFFINITY_CHOICE_REQUIRED, "INCOMPLETE", "affinityChoice.affinity", `${option.optionKey} names the owned Affinity it raises`, c.progression.ref);
      else {
        const pick = chosen.affinity;
        target = affinities.find((a) => sameSelection(pick, a.affinity));
        if (target === undefined) fail(E.AFFINITY_OPTION_ILLEGAL, "ERROR", "affinityChoice.affinity", `${option.optionKey} raises an Affinity the Character owns (exact revision)`, c.progression.ref);
      }
      if (target !== undefined) {
        if (target.rank !== option.from) fail(E.AFFINITY_OPTION_ILLEGAL, "ERROR", "affinityChoice", `${option.optionKey} raises an Affinity from ${option.from}; ${target.affinity.canonicalKey} is ${target.rank}`, c.progression.ref);
        else {
          affinities = rankUp(target, option);
          affinityChoice = { optionKey: option.optionKey, affinity: chosen.affinity === null ? null : { entityId: target.affinity.entityId, entityVersionId: target.affinity.entityVersionId } };
        }
      }
    } else {
      // GAIN_AFFINITY — an unresolved starting rank (open canon) is never executed (fail closed).
      if (option.startingRank === null || option.conflictKey !== null) fail(E.AFFINITY_OPTION_UNRESOLVED, "ERROR", "affinityChoice.optionKey", `${option.optionKey} depends on unresolved canon${option.conflictKey === null ? "" : ` (${option.conflictKey})`}; it is never guessed`, c.progression.ref);
      else if (chosen.affinity === null) fail(E.AFFINITY_CHOICE_REQUIRED, "INCOMPLETE", "affinityChoice.affinity", `${option.optionKey} names the Affinity gained`, c.progression.ref);
      else {
        const envelope = pinnedSelection(bundle, chosen.affinity, "AFFINITY", "affinityChoice.affinity", fail);
        const entry = envelope === null ? null : findAffinityEntry(c.affinity, definitionRefOf(envelope));
        if (envelope !== null && entry === null) fail(E.AFFINITY_NOT_EXECUTABLE, "ERROR", "affinityChoice.affinity", `${envelope.canonicalKey} is not an executable Affinity`, definitionRefOf(envelope));
        else if (entry !== null && affinities.some((a) => a.affinity.entityId === entry.ref.entityId)) fail(E.AFFINITY_ALREADY_OWNED, "ERROR", "affinityChoice.affinity", `${entry.ref.canonicalKey} is already owned`, entry.ref);
        else if (entry !== null) {
          affinities = [...affinities, { affinity: entry.ref, identity: entry.affinity, role: option.role, rank: option.startingRank, acquisition: { level: toLevel, optionKey: option.optionKey }, history: [] }];
          affinityChoice = { optionKey: option.optionKey, affinity: { entityId: entry.ref.entityId, entityVersionId: entry.ref.entityVersionId } };
        }
      }
    }
  }
  if (failed) return null;
  return {
    state: { ...state, level: toLevel, statAdvancements: nextStatAdvancements, skills, affinities },
    record: { toLevel, statAllocations: allocations, skillAdvancements: skillChoices, affinityChoice },
    points: { granted: step.statPoints, spent: spent ?? NO_POINTS, remaining: remaining ?? step.statPoints },
  };
}

// ---- Profile -------------------------------------------------------------------------------------------------------

function affinityProfileOf(state: ProgressionState): unknown {
  return { affinities: state.affinities.map((a) => ({ affinity: a.affinity, rank: a.rank, role: a.role, acquisition: a.acquisition })) };
}

/** Builds the profile of a coherent state: Stats, Skills, Affinity profile (M5-validated), die, derived values. */
function profileOf(bundle: ProwessDefinitionBundle, ruleset: RulesetContext, c: AdvancementContent, state: ProgressionState, add: IssueSink): CharacterMechanicalProfile | null {
  const die = resolveCharacterDie(c.core.progression.payload, state.level);
  if (die === null) {
    add(E.INCOHERENT_PROGRESSION, "ERROR", "", `no Character Die is declared for Level ${state.level}`, c.core.progression.ref);
    return null;
  }
  // The Affinity profile is checked by the existing M5 validators — persisted choices alone are never proof (§116).
  const profileOut = validateAffinityProfile(affinityProfileOf(state), bundle, c.affinity);
  if (!profileOut.ok) {
    add(E.AFFINITY_PROFILE_INVALID, "ERROR", "affinityChoice", profileOut.problems.map((p) => p.message).join("; "), c.progression.ref);
    return null;
  }
  const progressionOut = validateAffinityProgression({ definitions: bundle, profile: affinityProfileOf(state), characterLevel: state.level });
  if (!progressionOut.ok || progressionOut.value.status !== "VALID") {
    add(E.AFFINITY_PROFILE_INVALID, "ERROR", "affinityChoice", progressionOut.ok ? `the Affinity profile is ${progressionOut.value.status} under ${c.progression.ref.canonicalKey} at Level ${state.level}` : progressionOut.problems.map((p) => p.message).join("; "), c.progression.ref);
    return null;
  }
  const finals = statFinals(state);
  if (finals === null) {
    add(E.INVALID_STAT_ALLOCATION, "ERROR", "", "the Stat totals could not be evaluated");
    return null;
  }
  const advancementTotals = totals(
    state.creationStats.map((s) => ({ key: statTarget(s.stat), base: NO_POINTS })),
    state.statAdvancements,
  );
  const mastery = c.core.procedures.STAT_MASTERY as CoreEntry<StatMasteryPayload> | undefined;
  const stats: ProfileStat[] = state.creationStats.map((s) => {
    const final = finals.get(s.stat) as number;
    const signal =
      mastery === undefined
        ? null
        : requirementMet(
            {
              kind: "ALL",
              children: [
                { kind: "NUMERIC_COMPARE", factKey: "character.level", operator: ">=", expected: mastery.payload.mastery.levelAtLeast, provenance: null },
                { kind: "NUMERIC_COMPARE", factKey: "stat.score", operator: ">=", expected: mastery.payload.mastery.statAtLeast, provenance: null },
              ],
              provenance: null,
            },
            { numeric: [{ key: "character.level", value: state.level }, { key: "stat.score", value: final }] },
          );
    return { stat: s.stat, baseline: s.baseline, ancestry: s.ancestry, creation: s.creation, advancement: advancementTotals?.get(statTarget(s.stat)) ?? NO_POINTS, final, minimum: s.minimum, maximum: s.maximum, mastery: signal, definition: s.definition };
  });
  const skillRanks = state.skills.map((s) => ({ skillKey: s.skill.canonicalKey, rankKey: s.rankKey }));
  const statScores = Object.fromEntries(stats.map((s) => [s.stat, s.final])) as Partial<Record<ProwessStat, number>>;
  const character = { level: state.level, characterDie: { dieKey: die.dieKey }, stats: statScores, baseHp: state.baseHp, baseMp: state.baseMp, skillRanks, explicitBonuses: [] };
  const plan = compileCoreResolution({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subject: { kind: "DERIVED_STATISTICS", subjectKey: "character-profile" }, definitions: bundle, ruleset, character });
  const contexts = plan.ok ? buildCoreResolutionContexts({ definitions: bundle, character, plan: plan.value }) : null;
  const response = plan.ok && contexts !== null && contexts.ok ? orchestrateRulesEvaluation({ evaluationKey: "m6-wo4.character-profile", contexts: { ruleset, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: plan.value.evaluationPlan }) : null;
  if (!plan.ok || contexts === null || !contexts.ok || response === null || !response.success || response.data === null) {
    const detail = !plan.ok ? plan.problems.map((p) => `${p.code} ${p.path}`).join("; ") : contexts !== null && !contexts.ok ? contexts.problems.map((p) => p.code).join("; ") : "the M4 evaluation did not succeed";
    add(E.DERIVED_PREVIEW_FAILED, "ERROR", "", `the derived statistics could not be evaluated: ${detail}`);
    return null;
  }
  const derived: CharacterDerivedValue[] = [];
  for (const statistic of DERIVED_STATISTICS) {
    const stepKey = plan.value.outputs.derived[statistic];
    const entry = c.core.derived[statistic];
    if (stepKey === undefined || entry === undefined) continue;
    const step = response.data.steps.find((s) => s.stepKey === stepKey);
    const data = step?.response?.data as { finalValue?: unknown } | null | undefined;
    if (step?.executionStatus !== "EXECUTED" || typeof data?.finalValue !== "number") {
      add(E.DERIVED_PREVIEW_FAILED, "ERROR", "", `${statistic} did not evaluate`, entry.ref);
      return null;
    }
    derived.push({ statistic, value: data.finalValue, unit: entry.payload.formula.unit ?? null, definition: entry.ref });
  }
  const signature = derived.find((d) => d.statistic === "SIGNATURE_ABILITY_SLOTS");
  return deepFreeze({
    level: state.level,
    maximumLevel: c.levels.at(-1) as number,
    characterDie: { dieKey: die.dieKey, faces: die.faces },
    baseHp: state.baseHp,
    baseMp: state.baseMp,
    stats,
    skills: state.skills.map((s) => ({ skill: s.skill, rankKey: s.rankKey, source: s.source, history: s.history })),
    affinities: profileOut.value.affinities.map((o) => {
      const s = state.affinities.find((a) => a.affinity.entityId === o.affinity.entityId) as AffinityState;
      return { affinity: o.affinity, identity: o.identity, role: o.role, rank: o.rank, acquisition: s.acquisition, history: s.history };
    }),
    affinityProfile: profileOut.value,
    derivedStatistics: derived,
    signatureCapacity: signature?.value ?? null,
    constructionContext: { stats: statScores, skillRanks, affinityProfile: profileOut.value },
    provenance: { rulesetId: bundle.rulesetProvenance.rulesetId, manifestId: bundle.rulesetProvenance.manifestId, advancementRule: c.rule.ref, characterDieProgression: c.core.progression.ref, skillLadder: c.ladder.ref, affinityProgression: c.progression.ref },
  });
}

/** Replays the committed history (each record exactly one Level, in order) — the stored Level must be where it ends. */
function replay(bundle: ProwessDefinitionBundle, ruleset: RulesetContext, c: AdvancementContent, character: CharacterProgressionState, add: IssueSink): ProgressionState | null {
  let state = initialState(bundle, ruleset, c, character.creation, add);
  if (state === null) return null;
  for (const [i, record] of character.history.entries()) {
    const expected = levelAfter(c, state.level);
    if (expected === null || record.toLevel !== expected) {
      add(E.HISTORY_INVALID, "ERROR", `history[${i}]`, `advancement ${i} reaches Level ${record.toLevel}; the next Level after ${state.level} is ${expected ?? "none (maximum)"}`);
      return null;
    }
    const issues: AdvancementIssue[] = [];
    const sink: IssueSink = (code, severity, path, message, source = null) => issues.push({ code, severity, path, message, source: sourceOf(source) });
    const applied = applyAdvancement(bundle, c, state, record.toLevel, record, sink);
    if (applied === null || issues.length > 0) {
      for (const issue of issues) add(E.HISTORY_INVALID, "ERROR", `history[${i}].${issue.path}`, `${issue.code}: ${issue.message}`);
      if (issues.length === 0) add(E.HISTORY_INVALID, "ERROR", `history[${i}]`, "the advancement could not be replayed");
      return null;
    }
    state = applied.state;
  }
  if (state.level !== character.level) {
    add(E.HISTORY_INVALID, "ERROR", "level", `the Character is Level ${character.level}; its history reaches Level ${state.level}`);
    return null;
  }
  return state;
}

/**
 * The Character's present mechanical profile, rebuilt from its creation choices and committed advancement history
 * against its exact Release (§49–§50). Pure and deterministic.
 */
export function buildCharacterMechanicalProfile(request: { readonly bundle: ProwessDefinitionBundle; readonly ruleset: RulesetContext; readonly character: CharacterProgressionState }): ProfileResult {
  const issues: AdvancementIssue[] = [];
  const add: IssueSink = (code, severity, path, message, source = null) => issues.push({ code, severity, path, message, source: sourceOf(source) });
  const { content, capability } = readAdvancementContent(request.bundle);
  if (content === null) {
    for (const m of capability.advancement.missing) add(E.MISSING_ADVANCEMENT_CONTENT, "ERROR", "", `${m.requirement}: ${m.message}`);
    return deepFreeze({ profile: null, issues });
  }
  const state = replay(request.bundle, request.ruleset, content, request.character, add);
  const profile = state === null ? null : profileOf(request.bundle, request.ruleset, content, state, add);
  return deepFreeze({ profile, issues });
}

/**
 * Previews advancing the Character ONE Level with `choices` (§39–§41): validates every choice against the exact Release
 * and returns the before / after profiles and the normalized record a commit would persist. Never persists anything.
 */
export function previewCharacterAdvancement(request: { readonly bundle: ProwessDefinitionBundle; readonly ruleset: RulesetContext; readonly character: CharacterProgressionState; readonly choices: unknown }): AdvancementPreview {
  const issues: AdvancementIssue[] = [];
  const add: IssueSink = (code, severity, path, message, source = null) => issues.push({ code, severity, path, message, source: sourceOf(source) });
  const done = (status: AdvancementPreviewStatus, rest: Partial<AdvancementPreview> = {}): AdvancementPreview =>
    deepFreeze({ status, issues, fromLevel: null, toLevel: null, entitlements: null, before: null, after: null, accessChanges: null, statPoints: null, record: null, ...rest });
  const { content, capability } = readAdvancementContent(request.bundle);
  if (content === null) {
    for (const m of capability.advancement.missing) add(E.MISSING_ADVANCEMENT_CONTENT, "ERROR", "", `${m.requirement}: ${m.message}`);
    return done("INVALID");
  }
  const state = replay(request.bundle, request.ruleset, content, request.character, add);
  const before = state === null ? null : profileOf(request.bundle, request.ruleset, content, state, add);
  if (state === null || before === null) return done("INVALID");
  const toLevel = levelAfter(content, state.level);
  if (toLevel === null) {
    add(E.MAX_LEVEL, "ERROR", "", `Level ${state.level} is the maximum Level of this Release`, content.rule.ref);
    return done("MAX_LEVEL", { fromLevel: state.level, before });
  }
  const entitlements = entitlementsFor(content, state.level, toLevel);
  const choices = readChoices(request.choices, add);
  if (choices === null) return done("INVALID", { fromLevel: state.level, toLevel, entitlements, before });
  const applied = applyAdvancement(request.bundle, content, state, toLevel, choices, add);
  // An incomplete advancement (an unspent point, a missing choice) is shown as far as it goes; the Level it would reach
  // is not yet a legal profile, so its profile checks are not reported as errors of the choices made so far.
  const incomplete = issues.some((i) => i.severity === "INCOMPLETE");
  const quiet: IssueSink = () => undefined;
  const after = applied === null ? null : profileOf(request.bundle, request.ruleset, content, applied.state, incomplete ? quiet : add);
  const status: AdvancementPreviewStatus = issues.some((i) => i.severity === "ERROR") ? "INVALID" : issues.length > 0 ? "INCOMPLETE" : "READY";
  const shown = status === "INVALID" ? null : after;
  return done(status, {
    fromLevel: state.level,
    toLevel,
    entitlements,
    before,
    after: shown,
    accessChanges: shown === null ? null : accessChanges({ bundle: request.bundle, before, after: shown }),
    statPoints: applied?.points ?? null,
    record: status === "READY" && applied !== null ? applied.record : null,
  });
}
