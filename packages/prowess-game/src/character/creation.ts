import { evaluateModifiers, orchestrateRulesEvaluation, type RulesetContext } from "@prowess/rules";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { buildCoreResolutionContexts, compileCoreResolution } from "../core/compile.js";
import { indexCoreDefinitions, type CoreDefinitionIndex } from "../core/definitions.js";
import { resolveCharacterDie } from "../core/character.js";
import { deepFreeze } from "../internal/plain-data.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { AncestryChoiceStatGrant, AncestryDefinitionPayload, AncestrySkillGrant, CharacterCreationRulePayload, SkillDefinitionPayload } from "../definition/character-payload.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION } from "../contract-version.js";
import { DERIVED_STATISTICS, PROWESS_STATS, SKILL_RANK_LADDER_KEY, type DerivedStatistic, type ProwessStat } from "../vocabulary/core.js";
import { CHARACTER_CREATION_REQUIRED_DERIVED_STATISTICS, CHARACTER_SKILL_SOURCE_KINDS, EXECUTABLE_AFFINITY_SCHEMA_VERSIONS, type CharacterSkillSourceKind } from "../vocabulary/character.js";

/**
 * Character creation (PAS-10 M6-WO3) — pure, deterministic, side-effect free.
 *
 * Everything a Level-1 Character is built from is read from ONE exact Definition bundle (the Character's Release):
 * the CHARACTER_CREATION_RULE (budget, free Skill count, starting rank, starting Level), the six STAT Definitions
 * (baseline = minimum, bounds), the CHARACTER_DIE_PROGRESSION, the Skill rank ladder, the ANCESTRY (Base HP / MP,
 * Stat and Skill grants), the SKILL catalog and the executable AFFINITY Definitions. A selection is legal only when it
 * names the EXACT EntityVersion the bundle pins — a matching canonical key or a newer revision is never accepted.
 *
 * Derived statistics are never computed here: the preview compiles the bundle's own DERIVED_STAT Definitions with the
 * M5 core compiler and runs them through the frozen M4 orchestrator. Nothing is persisted, cached or mutated.
 */

export const CHARACTER_CREATION_ERROR_CODES = deepFreeze({
  MISSING_REQUIRED_CONTENT: "PROWESS_CHARACTER.MISSING_REQUIRED_CONTENT",
  INVALID_CANDIDATE: "PROWESS_CHARACTER.INVALID_CANDIDATE",
  NOT_IN_RELEASE: "PROWESS_CHARACTER.NOT_IN_RELEASE",
  WRONG_DEFINITION_KIND: "PROWESS_CHARACTER.WRONG_DEFINITION_KIND",
  ANCESTRY_REQUIRED: "PROWESS_CHARACTER.ANCESTRY_REQUIRED",
  INVALID_STAT_CHOICE: "PROWESS_CHARACTER.INVALID_STAT_CHOICE",
  STAT_CHOICE_INCOMPLETE: "PROWESS_CHARACTER.STAT_CHOICE_INCOMPLETE",
  INVALID_STAT_ALLOCATION: "PROWESS_CHARACTER.INVALID_STAT_ALLOCATION",
  STAT_BUDGET_EXCEEDED: "PROWESS_CHARACTER.STAT_BUDGET_EXCEEDED",
  STAT_BUDGET_UNSPENT: "PROWESS_CHARACTER.STAT_BUDGET_UNSPENT",
  STAT_OUT_OF_RANGE: "PROWESS_CHARACTER.STAT_OUT_OF_RANGE",
  DUPLICATE_SKILL: "PROWESS_CHARACTER.DUPLICATE_SKILL",
  INVALID_SKILL_SOURCE: "PROWESS_CHARACTER.INVALID_SKILL_SOURCE",
  SKILL_NOT_OFFERED: "PROWESS_CHARACTER.SKILL_NOT_OFFERED",
  SKILL_GRANT_EXCEEDED: "PROWESS_CHARACTER.SKILL_GRANT_EXCEEDED",
  SKILL_GRANT_INCOMPLETE: "PROWESS_CHARACTER.SKILL_GRANT_INCOMPLETE",
  FREE_SKILLS_EXCEEDED: "PROWESS_CHARACTER.FREE_SKILLS_EXCEEDED",
  FREE_SKILLS_INCOMPLETE: "PROWESS_CHARACTER.FREE_SKILLS_INCOMPLETE",
  UNKNOWN_SKILL_RANK: "PROWESS_CHARACTER.UNKNOWN_SKILL_RANK",
  PRIMARY_AFFINITY_REQUIRED: "PROWESS_CHARACTER.PRIMARY_AFFINITY_REQUIRED",
  AFFINITY_NOT_EXECUTABLE: "PROWESS_CHARACTER.AFFINITY_NOT_EXECUTABLE",
  DERIVED_PREVIEW_FAILED: "PROWESS_CHARACTER.DERIVED_PREVIEW_FAILED",
} as const);
const E = CHARACTER_CREATION_ERROR_CODES;

/** ERROR: illegal in any state. INCOMPLETE: acceptable in a Draft, refused at finalization. */
export type CharacterCreationIssueSeverity = "ERROR" | "INCOMPLETE";

export interface CharacterCreationIssue {
  readonly code: string;
  readonly severity: CharacterCreationIssueSeverity;
  /** Dotted candidate path, e.g. `statAllocations.STR`, `skills[2]`. Empty for the whole Character. */
  readonly path: string;
  readonly message: string;
  /** The exact Definition the rule came from, when one did. */
  readonly source: { readonly canonicalKey: string; readonly entityVersionId: string } | null;
}

export interface CharacterCreationSelection {
  readonly entityId: string;
  readonly entityVersionId: string;
}

export interface CharacterCreationCandidate {
  readonly ancestry: CharacterCreationSelection | null;
  readonly ancestryStatChoices: readonly { readonly grantKey: string; readonly stat: string }[];
  readonly statAllocations: Readonly<Record<string, unknown>>;
  readonly skills: readonly { readonly skill: CharacterCreationSelection; readonly sourceKind: string; readonly sourceGrantKey: string | null }[];
  readonly primaryAffinity: CharacterCreationSelection | null;
}

export type CharacterCreationCapabilityStatus = "READY" | "MISSING_REQUIRED_CONTENT";

export interface CharacterCreationCapability {
  readonly status: CharacterCreationCapabilityStatus;
  readonly missing: readonly { readonly requirement: string; readonly message: string }[];
}

export interface ResolvedCharacterStat {
  readonly stat: ProwessStat;
  readonly baseline: number;
  readonly ancestry: number;
  readonly allocated: number;
  readonly final: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly definition: ProwessDefinitionRef;
}

export interface ResolvedCharacterSkill {
  readonly skill: ProwessDefinitionRef;
  readonly rankKey: string;
  readonly sourceKind: CharacterSkillSourceKind;
  readonly sourceGrantKey: string | null;
}

export interface CharacterDerivedValue {
  readonly statistic: DerivedStatistic;
  readonly value: number;
  readonly unit: string | null;
  readonly definition: ProwessDefinitionRef;
}

export interface CharacterCreationResult {
  readonly status: "READY" | "INCOMPLETE" | "INVALID";
  readonly issues: readonly CharacterCreationIssue[];
  readonly capability: CharacterCreationCapability;
  readonly resolved: {
    readonly level: number | null;
    readonly characterDie: { readonly dieKey: string; readonly faces: number } | null;
    readonly creationRule: ProwessDefinitionRef | null;
    readonly ancestry: ProwessDefinitionRef | null;
    readonly baseHp: number | null;
    readonly baseMp: number | null;
    readonly pointBudget: number | null;
    readonly pointsSpent: number;
    readonly pointsRemaining: number | null;
    readonly stats: readonly ResolvedCharacterStat[];
    readonly skills: readonly ResolvedCharacterSkill[];
    readonly freeSkillCount: number | null;
    readonly primaryAffinity: ProwessDefinitionRef | null;
  };
  readonly derivedPreview: readonly CharacterDerivedValue[] | null;
}

/** The Release-pinned content Character creation reads, located by Definition KIND only (never by name). */
export interface CharacterCreationContent {
  readonly creationRule: { readonly ref: ProwessDefinitionRef; readonly payload: CharacterCreationRulePayload } | null;
  readonly core: CoreDefinitionIndex | null;
  readonly ancestries: readonly { readonly ref: ProwessDefinitionRef; readonly payload: AncestryDefinitionPayload }[];
  readonly skills: readonly { readonly ref: ProwessDefinitionRef; readonly payload: SkillDefinitionPayload }[];
  readonly affinities: readonly { readonly ref: ProwessDefinitionRef; readonly schemaVersion: number; readonly executable: boolean }[];
}

const of = <P>(e: ProwessDefinitionEnvelope) => ({ ref: definitionRefOf(e), payload: e.payload as unknown as P });
const sourceOf = (ref: ProwessDefinitionRef | null | undefined) => (ref ? { canonicalKey: ref.canonicalKey, entityVersionId: ref.entityVersionId } : null);

/** Indexes the character-facing content of one exact bundle. Pure. */
export function characterCreationContent(bundle: ProwessDefinitionBundle): CharacterCreationContent {
  const kind = (k: string) => bundle.definitions.filter((d) => d.definitionKind === k);
  const rules = kind("CHARACTER_CREATION_RULE");
  const core = indexCoreDefinitions(bundle);
  return deepFreeze({
    creationRule: rules.length === 1 ? of<CharacterCreationRulePayload>(rules[0] as ProwessDefinitionEnvelope) : null,
    core: core.ok ? core.value : null,
    ancestries: kind("ANCESTRY").map((e) => of<AncestryDefinitionPayload>(e)),
    skills: kind("SKILL").map((e) => of<SkillDefinitionPayload>(e)),
    affinities: kind("AFFINITY").map((e) => ({ ref: definitionRefOf(e), schemaVersion: e.schemaVersion, executable: (EXECUTABLE_AFFINITY_SCHEMA_VERSIONS as readonly number[]).includes(e.schemaVersion) })),
  });
}

/** Whether one exact Release bundle holds everything WO3 Character creation needs. Lists every missing requirement. */
export function getCharacterCreationCapability(bundle: ProwessDefinitionBundle): CharacterCreationCapability {
  const missing: { requirement: string; message: string }[] = [];
  const add = (requirement: string, message: string) => missing.push({ requirement, message });
  const rules = bundle.definitions.filter((d) => d.definitionKind === "CHARACTER_CREATION_RULE");
  if (rules.length !== 1) add("CHARACTER_CREATION_RULE", rules.length === 0 ? "the Release pins no Character Creation Rule" : `the Release pins ${rules.length} Character Creation Rules; exactly one is required`);
  const core = indexCoreDefinitions(bundle);
  if (!core.ok) for (const problem of core.problems) add("CORE_CHARACTER_CONTENT", problem.message);
  const content = characterCreationContent(bundle);
  if (core.ok) {
    for (const statistic of CHARACTER_CREATION_REQUIRED_DERIVED_STATISTICS) if (core.value.derived[statistic] === undefined) add(`DERIVED_STAT:${statistic}`, `the Release pins no ${statistic} Derived Stat Definition`);
    const rule = content.creationRule?.payload;
    if (rule !== undefined) {
      if (resolveCharacterDie(core.value.progression.payload, rule.startingLevel) === null) add("CHARACTER_DIE_PROGRESSION", `the Character Die progression declares no die for Level ${rule.startingLevel}`);
      if (!core.value.skillLadder.payload.ranks.some((r) => r.rankKey === rule.startingSkillRankKey)) add("SKILL_RANK", `${rule.startingSkillRankKey} is not a rank of the Skill rank ladder`);
    }
  }
  if (content.ancestries.length === 0) add("ANCESTRY", "the Release pins no Ancestry");
  const skills = content.skills.filter((s) => s.payload.ladderKey === SKILL_RANK_LADDER_KEY);
  if (skills.length === 0) add("SKILL", "the Release pins no selectable Skill");
  if (!content.affinities.some((a) => a.executable)) add("AFFINITY", "the Release pins no executable Affinity");
  return deepFreeze({ status: missing.length === 0 ? "READY" : "MISSING_REQUIRED_CONTENT", missing });
}

/** One additive contribution to a creation total (a Stat, the points spent), with where it came from. */
interface Contribution {
  readonly target: string;
  readonly amount: number;
  readonly sourceType: string;
  readonly sourceKey: string;
}

/**
 * Creation totals through the M4 Modifier engine (M4-WO6): each total is a NUMERIC target with its base value and every
 * Ancestry grant / allocated point an explicit ADD (or SUBTRACT) modifier with its source — never arithmetic here.
 * Returns the final value of every target, or null when M4 refuses the request.
 */
function totals(targets: ReadonlyArray<{ readonly key: string; readonly base: number }>, contributions: readonly Contribution[], subtract: ReadonlySet<string> = new Set()): Map<string, number> | null {
  const response = evaluateModifiers({
    targets: targets.map((t) => ({ targetKey: t.key, kind: "NUMERIC", value: t.base })),
    modifiers: contributions.map((c, order) => ({
      modifierKey: `creation.${String(order).padStart(4, "0")}`,
      targetKey: c.target,
      operation: subtract.has(c.target) ? "SUBTRACT" : "ADD",
      operand: c.amount,
      phase: { phaseKey: "character-creation", phaseOrder: 0 },
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validates a Character creation candidate against one exact Release bundle and, when the build is coherent, previews
 * its derived statistics through M5 / M4. Pure: same inputs, same deep-frozen result; no input is mutated.
 */
export function validateCharacterCreation(request: { readonly bundle: ProwessDefinitionBundle; readonly ruleset: RulesetContext; readonly candidate: CharacterCreationCandidate }): CharacterCreationResult {
  const { bundle, ruleset, candidate } = request;
  const issues: CharacterCreationIssue[] = [];
  const add = (code: string, severity: CharacterCreationIssueSeverity, path: string, message: string, source: ProwessDefinitionRef | null = null) => issues.push({ code, severity, path, message, source: sourceOf(source) });
  const capability = getCharacterCreationCapability(bundle);
  const content = characterCreationContent(bundle);
  const rule = content.creationRule;
  const core = content.core;
  if (capability.status !== "READY" || rule === null || core === null) {
    for (const m of capability.missing) add(E.MISSING_REQUIRED_CONTENT, "ERROR", "", `${m.requirement}: ${m.message}`);
    return deepFreeze({ status: "INVALID", issues, capability, resolved: { level: null, characterDie: null, creationRule: rule?.ref ?? null, ancestry: null, baseHp: null, baseMp: null, pointBudget: null, pointsSpent: 0, pointsRemaining: null, stats: [], skills: [], freeSkillCount: null, primaryAffinity: null }, derivedPreview: null });
  }

  /** The bundle envelope of an exact selection, checked against the Release pin and the expected kind. */
  const pinned = (sel: unknown, path: string, kind: string): ProwessDefinitionEnvelope | null => {
    if (!isRecord(sel) || typeof sel.entityId !== "string" || typeof sel.entityVersionId !== "string") {
      add(E.INVALID_CANDIDATE, "ERROR", path, "a selection is an exact { entityId, entityVersionId }");
      return null;
    }
    const envelope = bundle.definitions.find((d) => d.entityId === sel.entityId) ?? null;
    if (envelope === null || envelope.entityVersionId !== sel.entityVersionId) {
      add(E.NOT_IN_RELEASE, "ERROR", path, envelope === null ? "this Entity is not part of the Character's Release" : `the Character's Release pins revision ${envelope.entityVersionId}, not ${String(sel.entityVersionId)} — selections are exact; a matching canonical key or a newer revision is never accepted`);
      return null;
    }
    if (envelope.definitionKind !== kind) {
      add(E.WRONG_DEFINITION_KIND, "ERROR", path, `expected a ${kind} Definition, found ${envelope.definitionKind}`, definitionRefOf(envelope));
      return null;
    }
    return envelope;
  };

  // ---- Ancestry ----------------------------------------------------------------------------------------------------
  let ancestry: { ref: ProwessDefinitionRef; payload: AncestryDefinitionPayload } | null = null;
  if (candidate.ancestry === null || candidate.ancestry === undefined) add(E.ANCESTRY_REQUIRED, "INCOMPLETE", "ancestry", "choose an Ancestry");
  else {
    const e = pinned(candidate.ancestry, "ancestry", "ANCESTRY");
    if (e !== null) ancestry = of<AncestryDefinitionPayload>(e);
  }

  // ---- Ancestry Stat choices ---------------------------------------------------------------------------------------
  // Every Stat adjustment is an explicit contribution (Ancestry grant or allocated point) — totalled by M4, below.
  const ancestryContributions: Contribution[] = [];
  const choices = Array.isArray(candidate.ancestryStatChoices) ? candidate.ancestryStatChoices : [];
  if (!Array.isArray(candidate.ancestryStatChoices)) add(E.INVALID_CANDIDATE, "ERROR", "ancestryStatChoices", "ancestryStatChoices is an array");
  if (ancestry !== null) {
    for (const g of ancestry.payload.statGrants) if (g.kind === "FIXED") ancestryContributions.push({ target: statTarget(g.stat), amount: g.amount, sourceType: "ancestry.stat_grant", sourceKey: g.grantKey });
    const byGrant = new Map<string, ProwessStat[]>();
    choices.forEach((c, i) => {
      const path = `ancestryStatChoices[${i}]`;
      const grant = ancestry!.payload.statGrants.find((g): g is AncestryChoiceStatGrant => g.kind === "CHOOSE_DISTINCT" && isRecord(c) && g.grantKey === c.grantKey);
      if (!isRecord(c) || grant === undefined) return add(E.INVALID_STAT_CHOICE, "ERROR", path, `${isRecord(c) ? String(c.grantKey) : "?"} is not a Stat choice of this Ancestry`, ancestry!.ref);
      const stat = c.stat as ProwessStat;
      if (!grant.allowedStats.includes(stat)) return add(E.INVALID_STAT_CHOICE, "ERROR", path, `${String(c.stat)} is not an allowed Stat for ${grant.grantKey} (${grant.allowedStats.join(", ")})`, ancestry!.ref);
      const chosen = byGrant.get(grant.grantKey) ?? [];
      if (chosen.includes(stat)) return add(E.INVALID_STAT_CHOICE, "ERROR", path, `${grant.grantKey} requires different Stats; ${stat} is chosen twice`, ancestry!.ref);
      if (chosen.length >= grant.count) return add(E.INVALID_STAT_CHOICE, "ERROR", path, `${grant.grantKey} allows exactly ${grant.count} choice(s)`, ancestry!.ref);
      chosen.push(stat);
      byGrant.set(grant.grantKey, chosen);
      ancestryContributions.push({ target: statTarget(stat), amount: grant.amount, sourceType: "ancestry.stat_choice", sourceKey: grant.grantKey });
    });
    for (const g of ancestry.payload.statGrants) {
      if (g.kind !== "CHOOSE_DISTINCT") continue;
      const n = byGrant.get(g.grantKey)?.length ?? 0;
      if (n < g.count) add(E.STAT_CHOICE_INCOMPLETE, "INCOMPLETE", `ancestryStatChoices.${g.grantKey}`, `${g.grantKey}: choose ${g.count} different Stats (${n} chosen; ${g.amount} each)`, ancestry.ref);
    }
  } else if (choices.length > 0) add(E.INVALID_STAT_CHOICE, "ERROR", "ancestryStatChoices", "Stat choices need an Ancestry");

  // ---- Stats -------------------------------------------------------------------------------------------------------
  const allocations = isRecord(candidate.statAllocations) ? candidate.statAllocations : {};
  if (!isRecord(candidate.statAllocations)) add(E.INVALID_CANDIDATE, "ERROR", "statAllocations", "statAllocations is an object keyed by Stat");
  for (const key of Object.keys(allocations)) if (!(PROWESS_STATS as readonly string[]).includes(key)) add(E.INVALID_STAT_ALLOCATION, "ERROR", `statAllocations.${key}`, `${key} is not a Stat`);
  let statsValid = true;
  const allocated: Partial<Record<ProwessStat, number>> = {};
  for (const stat of PROWESS_STATS) {
    const raw = allocations[stat] ?? 0;
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      add(E.INVALID_STAT_ALLOCATION, "ERROR", `statAllocations.${stat}`, "points spent are a whole number, zero or more");
      statsValid = false;
    } else allocated[stat] = raw;
  }
  const budget = rule.payload.statPointBudget;
  const allocationContributions: Contribution[] = PROWESS_STATS.filter((stat) => Boolean(allocated[stat])).map((stat) => ({ target: statTarget(stat), amount: allocated[stat] as number, sourceType: "character.stat_allocation", sourceKey: stat }));
  const statTotals = totals(
    [...PROWESS_STATS.map((stat) => ({ key: statTarget(stat), base: core.stats[stat].payload.minimum })), { key: "points.spent", base: 0 }, { key: "points.remaining", base: budget }, ...PROWESS_STATS.map((stat) => ({ key: `ancestry.${stat.toLowerCase()}`, base: 0 }))],
    [
      ...ancestryContributions,
      ...allocationContributions,
      ...ancestryContributions.map((c) => ({ ...c, target: c.target.replace("stat.", "ancestry.") })),
      ...allocationContributions.map((c) => ({ ...c, target: "points.spent" })),
      ...allocationContributions.map((c) => ({ ...c, target: "points.remaining" })),
    ],
    new Set(["points.remaining"]),
  );
  if (statTotals === null) {
    add(E.INVALID_STAT_ALLOCATION, "ERROR", "statAllocations", "the Stat totals could not be evaluated");
    statsValid = false;
  }
  const pointsSpent = statTotals?.get("points.spent") ?? 0;
  const pointsRemaining = statTotals?.get("points.remaining") ?? null;
  const stats: ResolvedCharacterStat[] = PROWESS_STATS.map((stat) => {
    const def = core.stats[stat];
    const final = statTotals?.get(statTarget(stat)) ?? def.payload.minimum;
    if (final < def.payload.minimum || final > def.payload.maximum) {
      add(E.STAT_OUT_OF_RANGE, "ERROR", `statAllocations.${stat}`, `${stat} would be ${final}; ${def.ref.canonicalKey} allows ${def.payload.minimum}–${def.payload.maximum}`, def.ref);
      statsValid = false;
    }
    return { stat, baseline: def.payload.minimum, ancestry: statTotals?.get(`ancestry.${stat.toLowerCase()}`) ?? 0, allocated: allocated[stat] ?? 0, final, minimum: def.payload.minimum, maximum: def.payload.maximum, definition: def.ref };
  });
  if (pointsSpent > budget) {
    add(E.STAT_BUDGET_EXCEEDED, "ERROR", "statAllocations", `${pointsSpent} points spent; the budget is ${budget}`, rule.ref);
    statsValid = false;
  } else if (pointsSpent < budget) add(E.STAT_BUDGET_UNSPENT, "INCOMPLETE", "statAllocations", `${pointsSpent} of ${budget} points spent (${String(pointsRemaining)} remaining)`, rule.ref);

  // ---- Skills ------------------------------------------------------------------------------------------------------
  const ladder = core.skillLadder;
  const onLadder = (rankKey: string) => ladder.payload.ranks.some((r) => r.rankKey === rankKey);
  const skills: ResolvedCharacterSkill[] = [];
  const perGrant = new Map<string, ProwessDefinitionRef[]>();
  const free: ProwessDefinitionRef[] = [];
  const rawSkills = Array.isArray(candidate.skills) ? candidate.skills : [];
  if (!Array.isArray(candidate.skills)) add(E.INVALID_CANDIDATE, "ERROR", "skills", "skills is an array");
  rawSkills.forEach((s, i) => {
    const path = `skills[${i}]`;
    if (!isRecord(s)) return add(E.INVALID_CANDIDATE, "ERROR", path, "a Skill selection is { skill, sourceKind, sourceGrantKey }");
    const e = pinned(s.skill, `${path}.skill`, "SKILL");
    if (e === null) return;
    const ref = definitionRefOf(e);
    if ((e.payload as unknown as SkillDefinitionPayload).ladderKey !== ladder.payload.ladderKey) return add(E.UNKNOWN_SKILL_RANK, "ERROR", path, `${ref.canonicalKey} is not trained on the ${ladder.payload.ladderKey} rank ladder`, ref);
    if (skills.some((x) => x.skill.entityId === ref.entityId)) return add(E.DUPLICATE_SKILL, "ERROR", path, `${ref.canonicalKey} is already a starting Skill — starting training never stacks; choose another Skill`, ref);
    if (!(CHARACTER_SKILL_SOURCE_KINDS as readonly string[]).includes(String(s.sourceKind))) return add(E.INVALID_SKILL_SOURCE, "ERROR", path, `sourceKind is one of ${CHARACTER_SKILL_SOURCE_KINDS.join(", ")}`);
    if (s.sourceKind === "FREE") {
      if (s.sourceGrantKey !== null && s.sourceGrantKey !== undefined) return add(E.INVALID_SKILL_SOURCE, "ERROR", path, "a free Skill names no grant");
      if (free.length >= rule.payload.freeTrainedSkillCount) return add(E.FREE_SKILLS_EXCEEDED, "ERROR", path, `exactly ${rule.payload.freeTrainedSkillCount} free trained Skill(s)`, rule.ref);
      free.push(ref);
      skills.push({ skill: ref, rankKey: rule.payload.startingSkillRankKey, sourceKind: "FREE", sourceGrantKey: null });
      return;
    }
    const grant: AncestrySkillGrant | undefined = ancestry?.payload.skillGrants.find((g) => g.grantKey === s.sourceGrantKey);
    if (grant === undefined) return add(E.INVALID_SKILL_SOURCE, "ERROR", path, `${String(s.sourceGrantKey)} is not a Skill grant of the chosen Ancestry`, ancestry?.ref ?? null);
    if (grant.selectionKind !== "CHOOSE_ANY" && !grant.options.some((o) => o.entityId === ref.entityId && o.entityVersionId === ref.entityVersionId)) {
      return add(E.SKILL_NOT_OFFERED, "ERROR", path, `${ref.canonicalKey} (this exact revision) is not an option of ${grant.grantKey}`, ancestry!.ref);
    }
    const used = perGrant.get(grant.grantKey) ?? [];
    if (used.length >= grant.count) return add(E.SKILL_GRANT_EXCEEDED, "ERROR", path, `${grant.grantKey} grants exactly ${grant.count} Skill(s)`, ancestry!.ref);
    if (!onLadder(grant.rankKey)) return add(E.UNKNOWN_SKILL_RANK, "ERROR", path, `${grant.rankKey} is not a rank of ${ladder.ref.canonicalKey}`, ancestry!.ref);
    perGrant.set(grant.grantKey, [...used, ref]);
    skills.push({ skill: ref, rankKey: grant.rankKey, sourceKind: "ANCESTRY", sourceGrantKey: grant.grantKey });
  });
  if (ancestry !== null) {
    for (const g of ancestry.payload.skillGrants) {
      const used = perGrant.get(g.grantKey) ?? [];
      if (used.length < g.count) add(E.SKILL_GRANT_INCOMPLETE, "INCOMPLETE", `skills.${g.grantKey}`, `${g.grantKey}: choose ${g.count} Skill(s) (${used.length} chosen)`, ancestry.ref);
      // An option the Ancestry names but the Release does not pin exactly can never be selected (fail closed).
      for (const o of g.options) {
        const e = bundle.definitions.find((d) => d.entityId === o.entityId);
        if (e === undefined || e.entityVersionId !== o.entityVersionId) add(E.NOT_IN_RELEASE, g.selectionKind === "FIXED" ? "ERROR" : "INCOMPLETE", `ancestry.skillGrants.${g.grantKey}`, `${o.canonicalKey} (the revision the Ancestry names) is not pinned by this Release`, ancestry.ref);
      }
    }
  }
  if (free.length < rule.payload.freeTrainedSkillCount) add(E.FREE_SKILLS_INCOMPLETE, "INCOMPLETE", "skills", `choose ${rule.payload.freeTrainedSkillCount} free trained Skills (${free.length} chosen)`, rule.ref);
  if (!onLadder(rule.payload.startingSkillRankKey)) add(E.UNKNOWN_SKILL_RANK, "ERROR", "skills", `${rule.payload.startingSkillRankKey} is not a rank of ${ladder.ref.canonicalKey}`, rule.ref);

  // ---- Primary Affinity --------------------------------------------------------------------------------------------
  let primaryAffinity: ProwessDefinitionRef | null = null;
  if (candidate.primaryAffinity === null || candidate.primaryAffinity === undefined) add(E.PRIMARY_AFFINITY_REQUIRED, "INCOMPLETE", "primaryAffinity", "choose one Primary Affinity");
  else {
    const e = pinned(candidate.primaryAffinity, "primaryAffinity", "AFFINITY");
    if (e !== null) {
      if (!(EXECUTABLE_AFFINITY_SCHEMA_VERSIONS as readonly number[]).includes(e.schemaVersion)) add(E.AFFINITY_NOT_EXECUTABLE, "ERROR", "primaryAffinity", `${e.canonicalKey} is AFFINITY schema version ${e.schemaVersion}, which is not executable`, definitionRefOf(e));
      else primaryAffinity = definitionRefOf(e);
    }
  }

  // ---- Level, Character Die and the M5 / M4 derived preview --------------------------------------------------------
  const level = rule.payload.startingLevel;
  const die = resolveCharacterDie(core.progression.payload, level);
  let derivedPreview: CharacterDerivedValue[] | null = null;
  if (ancestry !== null && statsValid && die !== null && !issues.some((i) => i.severity === "ERROR")) {
    const character = {
      level,
      characterDie: { dieKey: die.dieKey },
      stats: Object.fromEntries(stats.map((s) => [s.stat, s.final])),
      baseHp: ancestry.payload.baseHp,
      baseMp: ancestry.payload.baseMp,
      skillRanks: skills.map((s) => ({ skillKey: s.skill.canonicalKey, rankKey: s.rankKey })),
      explicitBonuses: [],
    };
    const plan = compileCoreResolution({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subject: { kind: "DERIVED_STATISTICS", subjectKey: "character-creation-preview" }, definitions: bundle, ruleset, character });
    const contexts = plan.ok ? buildCoreResolutionContexts({ definitions: bundle, character, plan: plan.value }) : null;
    const response = plan.ok && contexts !== null && contexts.ok ? orchestrateRulesEvaluation({ evaluationKey: "m6-wo3.character-creation", contexts: { ruleset, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: plan.value.evaluationPlan }) : null;
    if (!plan.ok || contexts === null || !contexts.ok || response === null || !response.success || response.data === null) {
      const detail = !plan.ok ? plan.problems.map((p) => `${p.code} ${p.path}`).join("; ") : contexts !== null && !contexts.ok ? contexts.problems.map((p) => p.code).join("; ") : "the M4 evaluation did not succeed";
      add(E.DERIVED_PREVIEW_FAILED, "ERROR", "", `the derived statistics of this Release could not be evaluated for this Character: ${detail}`);
    } else {
      const run = response.data;
      derivedPreview = [];
      for (const statistic of DERIVED_STATISTICS) {
        const stepKey = plan.value.outputs.derived[statistic];
        const entry = core.derived[statistic];
        if (stepKey === undefined || entry === undefined) continue;
        const step = run.steps.find((s) => s.stepKey === stepKey);
        const data = step?.response?.data as { finalValue?: unknown } | null | undefined;
        if (step?.executionStatus !== "EXECUTED" || typeof data?.finalValue !== "number") {
          add(E.DERIVED_PREVIEW_FAILED, "ERROR", "", `${statistic} did not evaluate`, entry.ref);
          derivedPreview = null;
          break;
        }
        derivedPreview.push({ statistic, value: data.finalValue, unit: entry.payload.formula.unit ?? null, definition: entry.ref });
      }
    }
  }

  const status = issues.some((i) => i.severity === "ERROR") ? "INVALID" : issues.length > 0 ? "INCOMPLETE" : "READY";
  return deepFreeze({
    status,
    issues,
    capability,
    resolved: {
      level,
      characterDie: die === null ? null : { dieKey: die.dieKey, faces: die.faces },
      creationRule: rule.ref,
      ancestry: ancestry?.ref ?? null,
      baseHp: ancestry?.payload.baseHp ?? null,
      baseMp: ancestry?.payload.baseMp ?? null,
      pointBudget: budget,
      pointsSpent,
      pointsRemaining,
      stats,
      skills,
      freeSkillCount: rule.payload.freeTrainedSkillCount,
      primaryAffinity,
    },
    derivedPreview: status === "INVALID" ? null : derivedPreview,
  });
}
