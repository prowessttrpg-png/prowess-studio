import type { JsonObject } from "@prowess/model";
import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationPlan, type EvaluationRun, type RuleProvenance } from "@prowess/rules";
import { AffinityEmitter } from "../affinity/compile.js";
import { findAffinityEntry, indexAffinityDefinitions, rankEntry, readKeywordCatalog, type AffinityDefinitionIndex, type AffinityEntry } from "../affinity/definitions.js";
import { ownedAffinity, validateAffinityProfile, type CharacterAffinityProfile } from "../affinity/profile.js";
import { bundleMatchesRuleset, createProwessDefinitionBundle, findBundleDefinition, type ProwessDefinitionBundle, type ProwessRulesetProvenance } from "../bundle/bundle.js";
import { assembleFragments, compiledStepKey } from "../compilation/assemble.js";
import type { CompilationFragmentBinding, ProwessCompilationSourceMap } from "../compilation/model.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION, SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS, type ProwessCompilationContractVersion } from "../contract-version.js";
import { program } from "../core/compile.js";
import { indexCoreDefinitions, type CoreDefinitionIndex, type CoreEntry } from "../core/definitions.js";
import { readComponentConstructionRules, type AbilityConstructionRulePayload, type ComponentConstructionRules, type TraitExchangeRule, type ConstructionFormulaSlot } from "../definition/ability-construction-payload.js";
import { AFFINITY_ERROR_CODES as A, COMPILATION_ERROR_CODES as X, CONSTRUCTION_ERROR_CODES as K, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { definitionRefOf, type ProwessDefinitionRef } from "../definition/envelope.js";
import { CONSTRUCTION_ORDER } from "../internal/order.js";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isExactLabel, isToken, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { SIGNATURE_SLOT_USES, type ConstructionAccessPath, type ConstructionRuleFamily, type ConstructionSkillTrack, type SignatureSlotUse } from "../vocabulary/ability-construction.js";
import { AFFINITY_RANKS, SPELL_CONSTRUCTION_AUTHORITIES, type AffinityRank } from "../vocabulary/affinity.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import type { AbilityKind } from "../vocabulary/families.js";
import { compositionComponents, validateAbilityComposition, type AbilityComposition } from "./composition.js";

/**
 * Shared Ability Construction LEGALITY (PAS-10 M5-WO5). WO1's `validateAbilityComposition` answers "is this a
 * well-formed Spell / Maneuver?" (shape, exact branch kinds, keys, order, Trait scope). This module answers "can THIS
 * character legally construct THIS Ability under THIS exact Ruleset?" (§90):
 *
 *   access      — a Spell's ONE explicit Authority (Arcane Rank TRAINED+ or the governing Affinity TRAINED+), or a
 *                 Maneuver's Martial Rank TRAINED+ (§6.1, §12, M5-I156, M5-I158)
 *   capacity    — Effect / Trait / Condition slots from the selected track only, the explicit Spell Trait exchange,
 *                 minimum Effects (§9–§15, §59–§63, M5-I157)
 *   structure   — one Targeting slot; a Maneuver names its Foundation (§16, §28)
 *   components  — explicit structured prerequisites, explicit stacking within the Definition's own limit, and Affinity
 *                 Authority's specialised component access (§24, §36–§41, §52–§58)
 *   signature   — Signature slots (= the WO2 SIGNATURE_ABILITY_SLOTS statistic): 1 slot by default, 0 only through an
 *                 authored exemption (§45–§51)
 *
 * Every number comes from versioned content (ABILITY_CONSTRUCTION_RULE, the WO4 AFFINITY_RANK_RULE, the WO2 Signature
 * statistic). The compiler ASSEMBLES M4 Formula and Requirement steps; M4 does the arithmetic and every comparison
 * (§96–§97). Nothing here persists, mutates its inputs, costs, resolves or targets anything (§51, §98–§103, §112).
 */

// ---- Public contracts ----------------------------------------------------------------------------------------------

/** The minimal pure character context WO5 reads (§42). Arcane / Martial Rank come ONLY from `skillRanks` (§43–§44). */
export interface AbilityConstructionCharacterContext {
  /** The Stats the Signature capacity Formula reads (PRO in Core Playtest V0.1). */
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
  /** Exact Skill ranks on the SKILL ladder. A Skill not listed is at the ladder's first rank (UNTRAINED, s29). */
  readonly skillRanks: readonly { readonly skillKey: string; readonly rankKey: string }[];
  /** The WO4 CharacterAffinityProfile, or null for a character who owns no Affinity. */
  readonly affinityProfile: unknown;
}

export type SignatureCandidate = { readonly slotUse: "DEFAULT" } | { readonly slotUse: "EXEMPT"; readonly exemptionKey: string | null };

export interface AbilityConstructionRequest {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subjectKey: string;
  /** The exact WO1 Ability Composition. A Spell names its Authority in `authority: { authority }` (§21). */
  readonly composition: unknown;
  readonly definitions: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  readonly character: AbilityConstructionCharacterContext;
  /** Exact M1 Keyword references for Affinity Authority access (the WO4 catalog contract). */
  readonly keywords: unknown;
  /** Explicit construction choices. A Spell Trait exchange is never inferred from unused capacity (§61). */
  readonly options?: { readonly effectSlotsTradedForTraits?: number };
  /** The character's Signature slot state and how the candidate uses slots (§45–§50). */
  readonly signature: { readonly usedSlots: number; readonly candidate: SignatureCandidate };
  /** Explicit Affinity Authority access rules for components (WO4 §110–§112), each with its exact rule key. */
  readonly accessGrants?: readonly { readonly componentKey: string; readonly sourceKey: string }[];
}

/** One compiled legality rule: which family, which component (if any), which M4 step decides it. */
export interface ConstructionCompiledRule {
  readonly ruleKey: string;
  readonly family: ConstructionRuleFamily;
  readonly componentKey: string | null;
  readonly stepKey: string;
}

export interface ConstructionCompiledOutputs {
  readonly abilityKind: AbilityKind;
  readonly access: {
    readonly path: ConstructionAccessPath;
    /** The rank the selected path reads: the Skill rank (ARCANE / MARTIAL) or the governing Affinity's rank. */
    readonly rankSource: { readonly kind: "SKILL"; readonly track: ConstructionSkillTrack; readonly skillKey: string } | { readonly kind: "AFFINITY"; readonly affinity: ProwessDefinitionRef };
    readonly rank: string;
    readonly minimumRank: string;
    readonly martialRankValue: number | null;
  };
  readonly capacity: {
    readonly baseEffects: number;
    readonly baseTraits: number;
    readonly conditions: number;
    readonly conditionSource: { readonly track: ConstructionSkillTrack; readonly rank: string };
    readonly exchange: TraitExchangeRule | null;
    readonly tradesRequested: number;
    readonly remainingEffectsStep: string;
    readonly effectiveTraitsStep: string;
    /** Null when the track has no exchange rule: no trade is available (NO_EXCHANGE_TRADES). */
    readonly maximumTradesStep: string | null;
  };
  readonly usage: { readonly effects: number; readonly traits: number; readonly conditions: number };
  readonly stacking: readonly { readonly componentKey: string; readonly stacks: number; readonly limit: number; readonly limitSource: "NOT_STACKABLE" | "FIXED" | "TRACK_RANK_VALUE" }[];
  readonly signature: {
    readonly usedBefore: number;
    readonly slotUse: SignatureSlotUse;
    readonly candidateCost: number;
    readonly exemption: { readonly exemptionKey: string | null; readonly rule: ProwessDefinitionRef } | null;
    readonly capacityStep: string;
    readonly projectedStep: string;
    readonly availableStep: string;
  };
  readonly rules: readonly ConstructionCompiledRule[];
}

export interface ProwessConstructionCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: { readonly kind: "ABILITY_CONSTRUCTION"; readonly subjectKey: string; readonly abilityKind: AbilityKind; readonly compositionKey: string };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly outputs: ConstructionCompiledOutputs;
}

// ---- Plan-local names (fixed labels; never derived from a rank, an Ability kind or an Affinity identity) -------------

const SUBJECT_KIND = "ABILITY_CONSTRUCTION";
const RULE = "construction.rule";
const LADDER = "core.skill_ladder";
const SIGNATURE_STAT = "core.signature_capacity";
const AFFINITY_RULE = "construction.affinity_rank_rule";
const GOVERNING = "construction.governing_affinity";
const GRANTS_FACT = "construction.access_grants";
const COMPONENT_ACCESS_FACT = "construction.component_affinity_access";
const EXEMPTIONS_FACT = "construction.signature_exemptions";
/** A member that never names an authored exemption token (tokens are SCREAMING_SNAKE): an EXEMPT candidate naming none. */
const NO_EXEMPTION_NAMED = "none";
/** WO1 structure: every Ability Composition has exactly one Targeting slot (§28). */
const ONE_TARGETING_SLOT = 1;
/** A Foundation is present (§16). */
const FOUNDATION_PRESENT = 1;
/** An Effect that does not explicitly authorize stacking has exactly one stack (§53). */
const SINGLE_STACK = 1;
/** WO4: an Affinity Rank without Authority (NONE) grants no Authority capacity (WO4 §38). */
const NO_AUTHORITY_CAPACITY = 0;
/** An unowned Affinity is held at the first rank of the WO4 Affinity ladder (NONE), whose authority capacity is null. */
const UNOWNED_AFFINITY_RANK: AffinityRank = AFFINITY_RANKS[0];
/** A track without an exchange rule exchanges 0 slots and allows 0 trades (§14). */
const NO_EXCHANGE_SLOTS = 0;
const NO_EXCHANGE_TRADES = 0;
const REQUEST_FIELDS = ["contractVersion", "subjectKey", "composition", "definitions", "ruleset", "character", "keywords", "options", "signature", "accessGrants"];
const REQUEST_REQUIRED = ["contractVersion", "subjectKey", "composition", "definitions", "ruleset", "character", "keywords", "signature"];

const emptyFacts = (): JsonObject => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: null, keywords: null });
const fromFragment = (target: string, fragmentKey: string, pointer = "/data/finalValue"): CompilationFragmentBinding => ({ target, source: { kind: "FRAGMENT", fragmentKey, pointer } });
const provenanceJson = (p: RuleProvenance): JsonObject => ({ ...p }) as unknown as JsonObject;
const skillFactKey = (skillKey: string) => `skill_rank.${skillKey}`;
const affinityFactKey = (ref: ProwessDefinitionRef) => `affinity_rank.${ref.canonicalKey}`;

interface LadderRank {
  readonly rankKey: string;
  readonly order: number;
}

interface ConstructionRule {
  readonly entry: CoreEntry<AbilityConstructionRulePayload>;
  readonly ladder: CoreEntry<{ ladderKey: string; ranks: readonly LadderRank[] }>;
}

// ---- Reading the request -------------------------------------------------------------------------------------------

function readConstructionRule(bundle: ProwessDefinitionBundle, core: CoreDefinitionIndex, p: Problems): ConstructionRule | null {
  const rules = bundle.definitions.filter((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  if (rules.length !== 1) {
    p.add(rules.length === 0 ? K.MISSING_CONSTRUCTION_DEFINITION : K.AMBIGUOUS_CONSTRUCTION_DEFINITION, ["definitions"], "exactly one ABILITY_CONSTRUCTION_RULE Definition is pinned by the Ruleset");
    return null;
  }
  const envelope = rules[0] as (typeof rules)[number];
  const entry: CoreEntry<AbilityConstructionRulePayload> = {
    ref: definitionRefOf(envelope),
    payload: envelope.payload as unknown as AbilityConstructionRulePayload,
    provenance: { entityId: envelope.entityId, entityVersionId: envelope.entityVersionId, canonicalKey: envelope.canonicalKey, rulesetId: bundle.rulesetProvenance.rulesetId, manifestId: bundle.rulesetProvenance.manifestId } as RuleProvenance,
  };
  const ladder = core.skillLadder as unknown as ConstructionRule["ladder"];
  const rule = entry.payload;
  if (rule.rankLadder !== ladder.payload.ladderKey) {
    p.add(K.CONSTRUCTION_RULE_UNRESOLVED, ["definitions"], `the construction rule reads the ${rule.rankLadder} ladder; the Ruleset's Skill ladder is ${ladder.payload.ladderKey}`);
    return null;
  }
  // Every rank table authors exactly the ladder's ranks — no implicit zero row, no row for an unknown rank (fail closed).
  const ladderKeys = ladder.payload.ranks.map((r) => r.rankKey);
  const tables: [string, readonly { rankKey: string }[], string][] = [
    ["spell.arcaneAuthority.ranks", rule.spell.arcaneAuthority.ranks, rule.spell.arcaneAuthority.minimumRank],
    ["spell.castingConditions.ranks", rule.spell.castingConditions.ranks, ladderKeys[0] as string],
    ["maneuver.martial.ranks", rule.maneuver.martial.ranks, rule.maneuver.martial.minimumRank],
  ];
  for (const [name, rows, minimum] of tables) {
    const keys = rows.map((r) => r.rankKey);
    if (keys.length !== ladderKeys.length || !ladderKeys.every((k) => keys.includes(k))) {
      p.add(K.CONSTRUCTION_RULE_UNRESOLVED, ["definitions", entry.ref.canonicalKey, name], `${name} must author exactly the ${ladder.payload.ladderKey} ranks (${ladderKeys.join(", ")}); construction never assumes a missing row`);
    }
    if (!ladderKeys.includes(minimum)) p.add(K.CONSTRUCTION_RULE_UNRESOLVED, ["definitions", entry.ref.canonicalKey, name], `minimum rank ${minimum} is not a ${ladder.payload.ladderKey} rank`);
  }
  return p.count > 0 ? null : { entry, ladder };
}

interface CharacterRanks {
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
  readonly skillRanks: ReadonlyMap<string, string>;
  readonly profile: CharacterAffinityProfile | null;
}

/** A non-negative safe integer (a count or a score); anything else is reported under `code`. */
function readCount(value: unknown, at: readonly (string | number)[], p: Problems, code: string, what: string): number | null {
  const n = readSafeInteger(value, at, p, code, what);
  if (n !== null && n < 0) {
    p.add(code, at, `${what} is a non-negative safe integer`);
    return null;
  }
  return n;
}

function readCharacter(value: unknown, bundle: ProwessDefinitionBundle, index: AffinityDefinitionIndex, ladder: readonly LadderRank[], p: Problems): CharacterRanks | null {
  const at = ["character"];
  const r = readRecord(value, at, p, K.INVALID_CONSTRUCTION_CONTEXT, ["stats", "skillRanks", "affinityProfile"], ["stats", "skillRanks", "affinityProfile"]);
  if (r === null) return null;
  const before = p.count;
  const stats: Partial<Record<ProwessStat, number>> = {};
  const rawStats = own(r, "stats");
  if (!isPlainObject(rawStats)) p.add(K.INVALID_CONSTRUCTION_CONTEXT, [...at, "stats"], "stats is a plain object of Stat → score");
  else
    for (const key of Object.keys(rawStats).sort()) {
      const stat = readEnum(key, PROWESS_STATS, [...at, "stats", key], p, K.INVALID_CONSTRUCTION_CONTEXT, "Stat");
      const score = readCount(own(rawStats, key), [...at, "stats", key], p, K.INVALID_CONSTRUCTION_CONTEXT, "a Stat score");
      if (stat !== null && score !== null) stats[stat] = score;
    }
  const skillRanks = new Map<string, string>();
  const rawRanks = own(r, "skillRanks");
  if (!Array.isArray(rawRanks)) p.add(K.INVALID_CONSTRUCTION_CONTEXT, [...at, "skillRanks"], "skillRanks is an array of { skillKey, rankKey }");
  else
    rawRanks.forEach((x: unknown, i: number) => {
      const e = readRecord(x, [...at, "skillRanks", i], p, K.INVALID_CONSTRUCTION_CONTEXT, ["skillKey", "rankKey"], ["skillKey", "rankKey"]);
      if (e === null) return;
      const skillKey = own(e, "skillKey");
      const rankKey = own(e, "rankKey");
      if (!isExactCanonicalKey(skillKey) || skillRanks.has(skillKey)) p.add(K.INVALID_CONSTRUCTION_CONTEXT, [...at, "skillRanks", i, "skillKey"], "skillKey is an exact Skill canonical key, listed once");
      else if (typeof rankKey !== "string" || !ladder.some((l) => l.rankKey === rankKey)) p.add(K.INVALID_CONSTRUCTION_CONTEXT, [...at, "skillRanks", i, "rankKey"], `rankKey is a SKILL-ladder rank (${ladder.map((l) => l.rankKey).join(", ")})`);
      else skillRanks.set(skillKey, rankKey);
    });
  let profile: CharacterAffinityProfile | null = null;
  const rawProfile = own(r, "affinityProfile");
  if (rawProfile !== null) {
    const out = validateAffinityProfile(rawProfile, bundle, index);
    if (!out.ok) for (const problem of out.problems) p.list.push({ ...problem, path: `/character/affinityProfile${problem.path}` });
    else profile = out.value;
  }
  return p.count > before ? null : { stats, skillRanks, profile };
}

// ---- Compilation ---------------------------------------------------------------------------------------------------

/** Compiles one construction-legality request into ONE M4 EvaluationPlan. Pure and deterministic; never mutates input. */
export function compileAbilityConstruction(request: unknown): ProwessOutcome<ProwessConstructionCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, K.INVALID_CONSTRUCTION_REQUEST, REQUEST_FIELDS, REQUEST_REQUIRED);
  if (r === null) return finish(p, () => null as never);
  const contractVersion = own(r, "contractVersion");
  if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) {
    p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], `supported Prowess compilation contract versions: ${SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.join(", ")}`);
  }
  const subjectKey = own(r, "subjectKey");
  if (!isExactLabel(subjectKey)) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["subjectKey"], "subjectKey is an exact label");

  // The exact Ruleset: the bundle is re-validated against the exact RulesetContext, never trusted as supplied (§107).
  const ruleset = createRulesetContext(own(r, "ruleset"));
  const rawBundle = own(r, "definitions");
  let bundle: ProwessDefinitionBundle | null = null;
  if (!ruleset.ok) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["ruleset"], "an exact, valid M4 RulesetContext is required");
  else if (!isPlainObject(rawBundle)) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["definitions"], "definitions is the exact ProwessDefinitionBundle of the request's RulesetContext");
  else {
    const rebuilt = createProwessDefinitionBundle({ ruleset: own(r, "ruleset"), definitions: own(rawBundle, "definitions") ?? null });
    if (!rebuilt.ok) for (const problem of rebuilt.problems) p.list.push({ ...problem, path: `/definitions${problem.path}` });
    else if (!bundleMatchesRuleset({ rulesetProvenance: own(rawBundle, "rulesetProvenance") as ProwessRulesetProvenance, definitions: [] }, ruleset.value)) {
      p.add(X.BUNDLE_RULESET_MISMATCH, ["definitions", "rulesetProvenance"], "the Definition bundle was materialized for a different exact Ruleset; Rulesets are never mixed");
    } else bundle = rebuilt.value;
  }
  const catalog = readKeywordCatalog(own(r, "keywords"), ["keywords"], p);
  if (p.count > 0 || bundle === null || catalog === null) return finish(p, () => null as never);

  const coreOut = indexCoreDefinitions(bundle);
  if (!coreOut.ok) return coreOut as ProwessOutcome<never>;
  const affinityOut = indexAffinityDefinitions(bundle);
  if (!affinityOut.ok) return affinityOut as ProwessOutcome<never>;
  const index = affinityOut.value;
  const rule = readConstructionRule(bundle, coreOut.value, p);
  if (rule === null) return finish(p, () => null as never);
  const R = rule.entry.payload;
  const ladder = rule.ladder.payload.ranks;
  const ladderRank = (rankKey: string) => ladder.find((l) => l.rankKey === rankKey) as LadderRank;
  const character = readCharacter(own(r, "character"), bundle, index, ladder, p);

  const compositionOut = validateAbilityComposition(own(r, "composition"), { bundle });
  if (!compositionOut.ok) for (const problem of compositionOut.problems) p.list.push({ ...problem, path: `/composition${problem.path}` });
  if (p.count > 0 || character === null || !compositionOut.ok) return finish(p, () => null as never);
  const composition: AbilityComposition = compositionOut.value;

  // Explicit construction options and Signature state (plain safe integers; never inferred — §61, §113).
  const options = own(r, "options");
  let trades = 0;
  if (options !== undefined) {
    const o = readRecord(options, ["options"], p, K.INVALID_CONSTRUCTION_REQUEST, ["effectSlotsTradedForTraits"], []);
    const t = o === null ? undefined : own(o, "effectSlotsTradedForTraits");
    if (t !== undefined) {
      const n = readSafeInteger(t, ["options", "effectSlotsTradedForTraits"], p, K.INVALID_CONSTRUCTION_REQUEST, "effectSlotsTradedForTraits");
      if (n !== null && n < 0) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["options", "effectSlotsTradedForTraits"], "a trade count is a non-negative safe integer");
      else if (n !== null) trades = n;
    }
  }
  const sig = readRecord(own(r, "signature"), ["signature"], p, K.INVALID_CONSTRUCTION_REQUEST, ["usedSlots", "candidate"], ["usedSlots", "candidate"]);
  let usedSlots = 0;
  let slotUse: SignatureSlotUse = "DEFAULT";
  let exemptionKey: string | null = null;
  if (sig !== null) {
    const used = readSafeInteger(own(sig, "usedSlots"), ["signature", "usedSlots"], p, K.INVALID_CONSTRUCTION_REQUEST, "usedSlots");
    if (used !== null && used < 0) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["signature", "usedSlots"], "usedSlots is a non-negative safe integer");
    else if (used !== null) usedSlots = used;
    const c = own(sig, "candidate");
    const kind = isPlainObject(c) ? readEnum(own(c, "slotUse"), SIGNATURE_SLOT_USES, ["signature", "candidate", "slotUse"], p, K.INVALID_CONSTRUCTION_REQUEST, "Signature slot use") : null;
    if (!isPlainObject(c)) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["signature", "candidate"], "candidate is { slotUse: DEFAULT } or { slotUse: EXEMPT, exemptionKey }");
    else if (kind === "DEFAULT") readRecord(c, ["signature", "candidate"], p, K.INVALID_CONSTRUCTION_REQUEST, ["slotUse"], ["slotUse"]);
    else if (kind === "EXEMPT") {
      const e = readRecord(c, ["signature", "candidate"], p, K.INVALID_CONSTRUCTION_REQUEST, ["slotUse", "exemptionKey"], ["slotUse"]);
      const key = e === null ? undefined : own(e, "exemptionKey");
      if (key !== undefined && key !== null && !isToken(key)) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["signature", "candidate", "exemptionKey"], "exemptionKey is null or the exact SCREAMING_SNAKE key of an authored exemption");
      slotUse = "EXEMPT";
      exemptionKey = typeof key === "string" ? key : null;
    }
  }
  const grants: { componentKey: string; sourceKey: string }[] = [];
  const rawGrants = own(r, "accessGrants");
  if (rawGrants !== undefined) {
    if (!Array.isArray(rawGrants)) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["accessGrants"], "accessGrants is an array of { componentKey, sourceKey }");
    else
      rawGrants.forEach((raw: unknown, i: number) => {
        const g = readRecord(raw, ["accessGrants", i], p, K.INVALID_CONSTRUCTION_REQUEST, ["componentKey", "sourceKey"], ["componentKey", "sourceKey"]);
        if (g === null) return;
        const componentKey = own(g, "componentKey");
        const sourceKey = own(g, "sourceKey");
        if (!compositionComponents(composition).some((c) => c.slot !== "affinity" && c.use.componentKey === componentKey)) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["accessGrants", i, "componentKey"], "an access grant names a component of this composition");
        else if (!isExactCanonicalKey(sourceKey)) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["accessGrants", i, "sourceKey"], "sourceKey is the exact canonical key of the access rule");
        else grants.push({ componentKey: componentKey as string, sourceKey });
      });
  }

  // Component construction sub-contracts (§38) — malformed ones are Definition defects (§41).
  const componentRules = new Map<string, ComponentConstructionRules>();
  for (const c of compositionComponents(composition)) {
    if (c.slot === "affinity") continue;
    const envelope = findBundleDefinition(bundle, c.use.definition);
    const rules = envelope === null ? {} : ((envelope.payload as { rules?: JsonObject }).rules ?? {});
    const read = readComponentConstructionRules(rules, ["definitions", c.use.definition.canonicalKey, "payload", "rules"], p);
    if (read !== null) componentRules.set(c.use.componentKey, read);
  }

  // Spell Authority / Maneuver track (§21, §A2). Authority is explicit; it is never selected for the character.
  const abilityKind = composition.abilityKind;
  let path: ConstructionAccessPath = "MARTIAL";
  let governing: AffinityEntry | null = null;
  if (abilityKind === "SPELL") {
    const a = composition.authority === null ? null : readRecord(composition.authority, ["composition", "authority"], p, K.AUTHORITY_REQUIRED, ["authority"], ["authority"]);
    const chosen = a === null ? null : readEnum(own(a, "authority"), SPELL_CONSTRUCTION_AUTHORITIES, ["composition", "authority", "authority"], p, K.AUTHORITY_REQUIRED, "Spell construction Authority");
    if (composition.authority === null) p.add(K.AUTHORITY_REQUIRED, ["composition", "authority"], "a Spell names exactly one explicit construction Authority { authority: ARCANE_AUTHORITY | AFFINITY_AUTHORITY }; it is never inferred");
    if (chosen !== null) path = chosen;
    if (chosen === "AFFINITY_AUTHORITY") {
      if (composition.affinity === null) p.add(K.AUTHORITY_REQUIRED, ["composition", "affinity"], "Affinity Authority names its governing Affinity explicitly through the composition's affinity component");
      else {
        governing = findAffinityEntry(index, composition.affinity.definition);
        if (governing === null) p.add(A.AFFINITY_NOT_EXECUTABLE, ["composition", "affinity"], "the governing Affinity is an executable (payload version 2) AFFINITY Definition of this exact Ruleset");
      }
    }
  } else if (composition.authority !== null) {
    p.add(K.AUTHORITY_NOT_APPLICABLE, ["composition", "authority"], "a Maneuver is constructed through Martial training (Martial Skill rank); it carries no Spell Authority, and Affinity never substitutes for Martial training");
  }
  if (p.count > 0) return finish(p, () => null as never);

  const e = new AffinityEmitter(index, catalog, p);
  const cite = (key: string, refs: readonly ProwessDefinitionRef[]) => {
    const existing = e.components.get(key) ?? [];
    e.components.set(key, [...existing, ...refs.filter((x) => !existing.some((y) => y.entityVersionId === x.entityVersionId))]);
  };
  cite(RULE, [rule.entry.ref]);
  cite(LADDER, [rule.ladder.ref]);
  for (const c of compositionComponents(composition)) cite(c.use.componentKey, [c.use.definition]);
  const ruleProv = provenanceJson(rule.entry.provenance);
  const ladderProv = provenanceJson(rule.ladder.provenance);
  const affinityProv = provenanceJson(index.rankRule.provenance);
  const rules: ConstructionCompiledRule[] = [];
  const requirement = (fragmentKey: string, family: ConstructionRuleFamily, componentKey: string | null, order: number, input: JsonObject, bindings: CompilationFragmentBinding[], componentKeys: string[], definitions: ProwessDefinitionRef[]) => {
    e.emit({ fragmentKey, order, operation: "REQUIREMENT", input, bindings, role: `construction-${family.toLowerCase().replace(/_/g, "-")}`, componentKeys, definitions });
    rules.push({ ruleKey: fragmentKey, family, componentKey, stepKey: fragmentKey });
  };
  // Every construction Formula program is authored in the construction rule (content); code only names the inputs.
  const formula = (fragmentKey: string, slot: ConstructionFormulaSlot, inputs: Partial<Record<string, number>>, role: string, componentKeys: string[], definitions: ProwessDefinitionRef[], bindings: CompilationFragmentBinding[] = [], order: number = CONSTRUCTION_ORDER.FORMULAS) => {
    const f = R.formulas[slot];
    const variables: Record<string, number> = {};
    for (const v of f.variables) {
      const bound = bindings.some((b) => b.target === `/variables/${v}`);
      const value = inputs[v];
      if (!bound && value === undefined) throw new Error(`construction formula ${slot} reads ${v}, which the compiler does not supply`);
      if (!bound) variables[v] = value as number;
    }
    return e.emit({
      fragmentKey,
      order,
      operation: "FORMULA",
      input: { program: { expression: f.expression, rounding: f.rounding, ...(f.minimum === null ? {} : { minimum: f.minimum }), provenance: ruleProv }, variables },
      bindings,
      role,
      componentKeys,
      definitions,
    });
  };
  const numeric = (factKey: string, value: number) => ({ ...emptyFacts(), numeric: [{ key: factKey, value, provenance: null }] });
  const compare = (factKey: string, operator: "<=" | ">=" | "==", expected: number, provenance: JsonObject | null) => ({ kind: "NUMERIC_COMPARE", factKey, operator, expected, provenance });
  const skillRankOf = (skillKey: string) => character.skillRanks.get(skillKey) ?? (ladder[0] as LadderRank).rankKey;
  const skillFact = (skillKey: string) => {
    const rankKey = skillRankOf(skillKey);
    return { key: skillFactKey(skillKey), rankKey, order: ladderRank(rankKey).order, provenance: ladderProv };
  };
  const owned = (ref: ProwessDefinitionRef) => (character.profile === null ? null : ownedAffinity(character.profile, ref));
  const ownedIds = character.profile === null ? [] : character.profile.affinities.map((o) => o.affinity.entityId);

  // ---- Access (§6.1, §12, §22–§23, §A2) ----------------------------------------------------------------------------
  const arcane = R.spell.arcaneAuthority;
  const martial = R.maneuver.martial;
  const arcaneRank = skillRankOf(arcane.skillKey);
  const martialRank = skillRankOf(martial.skillKey);
  const martialRow = martial.ranks.find((x) => x.rankKey === martialRank) as (typeof martial.ranks)[number];
  let access: ConstructionCompiledOutputs["access"];
  let baseEffects: number;
  let baseTraits: number;
  if (path === "ARCANE_AUTHORITY") {
    const floor = ladderRank(arcane.minimumRank);
    requirement("access", "ACCESS", null, CONSTRUCTION_ORDER.ACCESS, { requirement: { kind: "RANK_AT_LEAST", factKey: skillFactKey(arcane.skillKey), requiredRankKey: floor.rankKey, requiredOrder: floor.order, provenance: ruleProv }, facts: { ...emptyFacts(), ranks: [skillFact(arcane.skillKey)] } }, [], [RULE, LADDER], [rule.entry.ref, rule.ladder.ref]);
    const row = arcane.ranks.find((x) => x.rankKey === arcaneRank) as (typeof arcane.ranks)[number];
    baseEffects = row.effectCapacity;
    baseTraits = row.traitCapacity;
    access = { path, rankSource: { kind: "SKILL", track: "ARCANE", skillKey: arcane.skillKey }, rank: arcaneRank, minimumRank: arcane.minimumRank, martialRankValue: null };
  } else if (path === "AFFINITY_AUTHORITY") {
    const g = governing as AffinityEntry;
    cite(GOVERNING, [g.ref]);
    cite(AFFINITY_RULE, [index.rankRule.ref]);
    const o = owned(g.ref);
    const floor = rankEntry(index, index.rankRule.payload.authorityMinimumRank);
    const children: JsonObject[] = [{ kind: "ENTITY_OWNED", entityId: g.ref.entityId, provenance: provenanceJson(g.provenance) }];
    if (o !== null) children.push({ kind: "RANK_AT_LEAST", factKey: affinityFactKey(g.ref), requiredRankKey: floor.rank, requiredOrder: floor.order, provenance: affinityProv });
    const ranks = o === null ? [] : [{ key: affinityFactKey(g.ref), rankKey: o.rank, order: rankEntry(index, o.rank).order, provenance: affinityProv }];
    requirement("access", "ACCESS", null, CONSTRUCTION_ORDER.ACCESS, { requirement: { kind: "ALL", children, provenance: provenanceJson(g.provenance) }, facts: { ...emptyFacts(), ranks, ownedEntityIds: ownedIds } }, [], [GOVERNING, AFFINITY_RULE, RULE], [g.ref, index.rankRule.ref, rule.entry.ref]);
    // Affinity Authority capacity IS the WO4 rank-rule table (§122). An unowned Affinity is held at no rank at all.
    const rank: AffinityRank = o === null ? UNOWNED_AFFINITY_RANK : o.rank;
    const authority = rankEntry(index, rank).authority;
    baseEffects = authority === null ? NO_AUTHORITY_CAPACITY : authority.effectCapacity;
    baseTraits = authority === null ? NO_AUTHORITY_CAPACITY : authority.traitCapacity;
    access = { path, rankSource: { kind: "AFFINITY", affinity: g.ref }, rank, minimumRank: floor.rank, martialRankValue: null };
  } else {
    const floor = ladderRank(martial.minimumRank);
    requirement("access", "ACCESS", null, CONSTRUCTION_ORDER.ACCESS, { requirement: { kind: "RANK_AT_LEAST", factKey: skillFactKey(martial.skillKey), requiredRankKey: floor.rankKey, requiredOrder: floor.order, provenance: ruleProv }, facts: { ...emptyFacts(), ranks: [skillFact(martial.skillKey)] } }, [], [RULE, LADDER], [rule.entry.ref, rule.ladder.ref]);
    baseEffects = martialRow.effectCapacity;
    baseTraits = martialRow.traitCapacity;
    access = { path, rankSource: { kind: "SKILL", track: "MARTIAL", skillKey: martial.skillKey }, rank: martialRank, minimumRank: martial.minimumRank, martialRankValue: martialRow.martialRankValue };
  }

  // ---- Capacity (§9–§15, §59–§63) — M4 Formulas compute, M4 Requirements compare --------------------------------------
  const spell = abilityKind === "SPELL";
  const exchange: TraitExchangeRule | null = spell ? R.spell.traitExchange : R.maneuver.traitExchange;
  const minimumEffects = spell ? R.spell.minimumEffects : R.maneuver.minimumEffects;
  const conditionCapacity = spell ? (R.spell.castingConditions.ranks.find((x) => x.rankKey === arcaneRank) as { capacity: number }).capacity : martialRow.conditionCapacity;
  const conditionSource = { track: (spell ? "ARCANE" : "MARTIAL") as ConstructionSkillTrack, rank: spell ? arcaneRank : martialRank };
  const capacityKeys = path === "AFFINITY_AUTHORITY" ? [RULE, AFFINITY_RULE] : [RULE];
  const capacityDefs = path === "AFFINITY_AUTHORITY" ? [rule.entry.ref, index.rankRule.ref] : [rule.entry.ref];
  // No exchange rule (every Maneuver in WO5 — §14): an exchange of 0 slots, and no trade is available at all.
  const perEffect = exchange === null ? NO_EXCHANGE_SLOTS : exchange.effectSlotsPerExchange;
  const perTrait = exchange === null ? NO_EXCHANGE_SLOTS : exchange.traitSlotsPerExchange;
  const remainingStep = formula("capacity.remaining_effects", "remainingEffects", { base_effects: baseEffects, trades, effect_slots_per_exchange: perEffect }, "construction-capacity-formula", capacityKeys, capacityDefs);
  const effectiveStep = formula("capacity.effective_traits", "effectiveTraits", { base_traits: baseTraits, trades, trait_slots_per_exchange: perTrait }, "construction-capacity-formula", capacityKeys, capacityDefs);
  // The most trades that still leave the authored minimum Effect capacity (the content Formula bounds it at zero).
  const maxTradesStep =
    exchange === null ? null : formula("capacity.maximum_trades", "maximumTrades", { base_effects: baseEffects, minimum_effects_remaining: exchange.minimumEffectsRemaining, effect_slots_per_exchange: exchange.effectSlotsPerExchange }, "construction-capacity-formula", capacityKeys, capacityDefs);
  const effectSlots = composition.effects.length; // §59–§60: one slot per Effect use, whatever its stack count
  const traitSlots = composition.traits.length;
  const conditionSlots = composition.conditions.length;
  requirement("capacity.trades", "TRADE_LIMIT", null, CONSTRUCTION_ORDER.CAPACITY, { requirement: compare("construction.trades", "<=", NO_EXCHANGE_TRADES, ruleProv), facts: numeric("construction.trades", trades) }, maxTradesStep === null ? [] : [fromFragment("/requirement/expected", maxTradesStep)], [RULE], [rule.entry.ref]);
  requirement("capacity.effects", "EFFECT_CAPACITY", null, CONSTRUCTION_ORDER.CAPACITY, { requirement: compare("construction.effect_slots", "<=", 0, ruleProv), facts: numeric("construction.effect_slots", effectSlots) }, [fromFragment("/requirement/expected", remainingStep)], capacityKeys, capacityDefs);
  requirement("capacity.minimum_effects", "MINIMUM_EFFECTS", null, CONSTRUCTION_ORDER.CAPACITY, { requirement: compare("construction.effect_slots", ">=", minimumEffects, ruleProv), facts: numeric("construction.effect_slots", effectSlots) }, [], [RULE], [rule.entry.ref]);
  requirement("capacity.traits", "TRAIT_CAPACITY", null, CONSTRUCTION_ORDER.CAPACITY, { requirement: compare("construction.trait_slots", "<=", 0, ruleProv), facts: numeric("construction.trait_slots", traitSlots) }, [fromFragment("/requirement/expected", effectiveStep)], capacityKeys, capacityDefs);
  requirement("capacity.conditions", "CONDITION_CAPACITY", null, CONSTRUCTION_ORDER.CAPACITY, { requirement: compare("construction.condition_slots", "<=", conditionCapacity, ruleProv), facts: numeric("construction.condition_slots", conditionSlots) }, [], [RULE, LADDER], [rule.entry.ref, rule.ladder.ref]);

  // ---- Structure (§16, §28) ----------------------------------------------------------------------------------------
  requirement("structure.targeting", "TARGETING_STRUCTURE", composition.targeting.componentKey, CONSTRUCTION_ORDER.STRUCTURE, { requirement: compare("construction.targeting_slots", "==", ONE_TARGETING_SLOT, ruleProv), facts: numeric("construction.targeting_slots", 1) }, [], [RULE, composition.targeting.componentKey], [rule.entry.ref, composition.targeting.definition]);
  if (!spell && R.maneuver.foundationRequired) {
    const foundation = composition.branch.kind === "MANEUVER" ? composition.branch.foundation : null;
    requirement("structure.foundation", "FOUNDATION", foundation === null ? null : foundation.componentKey, CONSTRUCTION_ORDER.STRUCTURE, { requirement: compare("construction.foundations", ">=", FOUNDATION_PRESENT, ruleProv), facts: numeric("construction.foundations", foundation === null ? 0 : 1) }, [], foundation === null ? [RULE] : [RULE, foundation.componentKey], foundation === null ? [rule.entry.ref] : [rule.entry.ref, foundation.definition]);
  }

  // ---- Component prerequisites (§36–§41, §A8–§A9): one Requirement per authored prerequisite --------------------------
  for (const c of compositionComponents(composition)) {
    if (c.slot === "affinity") continue;
    const cr = componentRules.get(c.use.componentKey) ?? null;
    if (cr === null) continue;
    for (const q of cr.prerequisites) {
      const key = `prerequisite.${c.use.componentKey}.${q.prerequisiteKey.toLowerCase()}`;
      if (q.kind === "SKILL_RANK_AT_LEAST") {
        if (!ladder.some((l) => l.rankKey === q.minimumRank)) {
          p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, ["definitions", c.use.definition.canonicalKey, "payload", "rules", "construction", "prerequisites"], `${q.minimumRank} is not a ${rule.ladder.payload.ladderKey} rank`);
          continue;
        }
        const floor = ladderRank(q.minimumRank);
        requirement(key, "PREREQUISITE", c.use.componentKey, CONSTRUCTION_ORDER.PREREQUISITES, { requirement: { kind: "RANK_AT_LEAST", factKey: skillFactKey(q.skillKey), requiredRankKey: floor.rankKey, requiredOrder: floor.order, provenance: null }, facts: { ...emptyFacts(), ranks: [skillFact(q.skillKey)] } }, [], [c.use.componentKey, LADDER], [c.use.definition, rule.ladder.ref]);
      } else {
        const entry = findAffinityEntry(index, q.affinity);
        if (entry === null) {
          p.add(K.INVALID_COMPONENT_CONSTRUCTION_RULES, ["definitions", c.use.definition.canonicalKey, "payload", "rules", "construction", "prerequisites"], "an Affinity prerequisite names an exact executable AFFINITY Definition of this Ruleset");
          continue;
        }
        const affinityKey = `${key}.affinity`;
        cite(affinityKey, [entry.ref]);
        cite(AFFINITY_RULE, [index.rankRule.ref]);
        const o = owned(entry.ref);
        const required = rankEntry(index, q.minimumRank);
        const children: JsonObject[] = [{ kind: "ENTITY_OWNED", entityId: entry.ref.entityId, provenance: provenanceJson(entry.provenance) }];
        if (o !== null) children.push({ kind: "RANK_AT_LEAST", factKey: affinityFactKey(entry.ref), requiredRankKey: required.rank, requiredOrder: required.order, provenance: affinityProv });
        const ranks = o === null ? [] : [{ key: affinityFactKey(entry.ref), rankKey: o.rank, order: rankEntry(index, o.rank).order, provenance: affinityProv }];
        requirement(key, "PREREQUISITE", c.use.componentKey, CONSTRUCTION_ORDER.PREREQUISITES, { requirement: { kind: "ALL", children, provenance: null }, facts: { ...emptyFacts(), ranks, ownedEntityIds: ownedIds } }, [], [c.use.componentKey, affinityKey, AFFINITY_RULE], [c.use.definition, entry.ref, index.rankRule.ref]);
      }
    }
  }

  // ---- Stacking (§52–§58): explicit permission, the Definition's own limit, one Effect slot ---------------------------
  const stacking: { componentKey: string; stacks: number; limit: number; limitSource: "NOT_STACKABLE" | "FIXED" | "TRACK_RANK_VALUE" }[] = [];
  const stackUses = [...composition.effects, ...composition.traits.filter(t => { const d = findBundleDefinition(bundle, t.definition); return d !== null && (d.payload.rules as JsonObject).trait !== undefined; })];
  stackUses.forEach((use) => {
    const slot = composition.traits.some(t => t.componentKey === use.componentKey) ? "traits" : "effects";
    const index = composition[slot].findIndex(c => c.componentKey === use.componentKey);
    const raw = own(use.parameters as Record<string, unknown>, "stacks");
    let stacks = SINGLE_STACK;
    if (raw !== undefined) {
      const n = readSafeInteger(raw, ["composition", slot, index, "parameters", "stacks"], p, K.INVALID_CONSTRUCTION_REQUEST, "stacks");
      if (n !== null && n < 1) p.add(K.INVALID_CONSTRUCTION_REQUEST, ["composition", slot, index, "parameters", "stacks"], "stacks is a positive safe integer (default 1)");
      else if (n !== null) stacks = n;
    }
    const cr = componentRules.get(use.componentKey);
    if (cr === undefined) return;
    let limit = SINGLE_STACK;
    let limitSource: "NOT_STACKABLE" | "FIXED" | "TRACK_RANK_VALUE" = "NOT_STACKABLE";
    const keys = [use.componentKey];
    const defs = [use.definition];
    if (cr.stacking.stackable) {
      const l = cr.stacking.limit;
      limitSource = l.kind;
      if (l.kind === "FIXED") limit = l.maximum;
      else if (l.track === "MARTIAL") {
        limit = martialRow.martialRankValue; // the Rank Value the rule authors for the character's Martial rank (§20, §83)
        keys.push(RULE);
        defs.push(rule.entry.ref);
      } else {
        // The construction rule authors no Rank Value for the Arcane track: nothing is guessed (§20, §55–§56).
        p.add(K.CONSTRUCTION_RULE_UNRESOLVED, ["definitions", use.definition.canonicalKey, "payload", "rules", "construction", "stacking"], `the construction rule authors no Rank Value for the ${l.track} track`);
        return;
      }
    }
    requirement(`stacking.${use.componentKey}`, "STACK_LIMIT", use.componentKey, CONSTRUCTION_ORDER.STACKING, { requirement: compare("construction.stacks", "<=", limit, null), facts: numeric("construction.stacks", stacks) }, [], keys, defs);
    stacking.push({ componentKey: use.componentKey, stacks, limit, limitSource });
  });

  // ---- Affinity Authority specialisation (§24–§25): every component must have exact access through the Affinity ----
  if (path === "AFFINITY_AUTHORITY") {
    const g = governing as AffinityEntry;
    for (const c of compositionComponents(composition)) {
      if (c.slot === "affinity") continue;
      const target = c.use.componentKey;
      const applies = (key: string) => key === target || composition.traits.some((t) => t.componentKey === key && t.appliesTo.componentKey === target);
      const { contributors, json } = e.contributions(composition, bundle, applies);
      const keywordStep = e.keywordStep(`affinity_keywords.${target}`, CONSTRUCTION_ORDER.KEYWORDS, "construction-component-keywords", contributors, json, [GOVERNING]);
      const children: JsonObject[] = [];
      g.payload.strengths.forEach((s, i) => {
        const node = e.ruleCondition(s.matchAny, g.provenance, ["definitions", g.ref.canonicalKey, "strengths", i]);
        if (node !== null) children.push(node);
      });
      g.payload.weaknesses.forEach((w, i) => {
        const node = e.ruleCondition(w.matchAny, g.provenance, ["definitions", g.ref.canonicalKey, "weaknesses", i]);
        if (node !== null) children.push(node);
      });
      children.push({ kind: "SET_CONTAINS", factKey: COMPONENT_ACCESS_FACT, member: target, provenance: null });
      children.push({ kind: "SET_CONTAINS", factKey: GRANTS_FACT, member: target, provenance: null });
      const componentAccess = (componentRules.get(target)?.affinityAccess ?? []).some((ref) => ref.entityId === g.ref.entityId && ref.entityVersionId === g.ref.entityVersionId) ? [target] : [];
      const granted = grants.filter((x) => x.componentKey === target).map((x) => x.componentKey);
      requirement(
        `affinity_access.${target}`,
        "AFFINITY_ACCESS",
        target,
        CONSTRUCTION_ORDER.AFFINITY_ACCESS,
        {
          requirement: { kind: "ANY", children, provenance: provenanceJson(g.provenance) },
          facts: { ...emptyFacts(), sets: [{ key: COMPONENT_ACCESS_FACT, members: componentAccess, provenance: null }, { key: GRANTS_FACT, members: granted, provenance: null }] },
        },
        [fromFragment("/facts/keywords", keywordStep, "/data")],
        [GOVERNING, ...contributors.map((x) => x.componentKey).filter((k, i, all) => all.indexOf(k) === i)],
        [g.ref, ...contributors.map((x) => x.definition)],
      );
    }
  }

  // ---- Signature slots (§45–§50) — capacity from the WO2 statistic; projected use computed by M4 -----------------------
  const statEntry = coreOut.value.derived[R.signature.capacityStatistic];
  if (statEntry === undefined) {
    p.add(K.MISSING_CONSTRUCTION_DEFINITION, ["definitions"], `the bundle has no DERIVED_STAT for ${R.signature.capacityStatistic}; Signature capacity comes from it`);
    return finish(p, () => null as never);
  }
  cite(SIGNATURE_STAT, [statEntry.ref]);
  const literals: Record<string, number> = {};
  for (const v of statEntry.payload.formula.variables) {
    const score = v.source.kind === "STAT" ? character.stats[v.source.stat] : undefined;
    if (v.source.kind !== "STAT") p.add(K.UNSUPPORTED_SIGNATURE_FORMULA, ["definitions", statEntry.ref.canonicalKey, "payload", "formula"], `Signature capacity reads ${v.source.kind}; the construction context carries Stats only`);
    else if (score === undefined) p.add(K.INVALID_CONSTRUCTION_CONTEXT, ["character", "stats", v.source.stat], `Signature capacity reads ${v.source.stat}; the construction context must state it`);
    else literals[v.variable] = score;
  }
  if (p.count > 0) return finish(p, () => null as never);
  const capacityStep = e.emit({
    fragmentKey: "signature.capacity_formula",
    order: CONSTRUCTION_ORDER.FORMULAS,
    operation: "FORMULA",
    input: { program: program(statEntry.payload.formula, statEntry.provenance), variables: literals },
    bindings: [],
    role: "construction-signature-capacity",
    componentKeys: [SIGNATURE_STAT],
    definitions: [statEntry.ref],
  });
  const candidateCost = slotUse === "EXEMPT" ? R.signature.exemptSlotCost : R.signature.defaultSlotCost;
  const projectedStep = formula("signature.projected_formula", "signatureProjected", { used_slots: usedSlots, candidate_slots: candidateCost }, "construction-signature-projected", [RULE], [rule.entry.ref]);
  if (slotUse === "EXEMPT") {
    requirement("signature.exemption", "SIGNATURE_EXEMPTION", null, CONSTRUCTION_ORDER.SIGNATURE, { requirement: { kind: "SET_CONTAINS", factKey: EXEMPTIONS_FACT, member: exemptionKey ?? NO_EXEMPTION_NAMED, provenance: ruleProv }, facts: { ...emptyFacts(), sets: [{ key: EXEMPTIONS_FACT, members: R.signature.exemptions.map((x) => x.exemptionKey), provenance: ruleProv }] } }, [], [RULE], [rule.entry.ref]);
  }
  requirement(
    "signature.capacity",
    "SIGNATURE_CAPACITY",
    null,
    CONSTRUCTION_ORDER.SIGNATURE,
    { requirement: compare("construction.signature_slots", "<=", 0, ruleProv), facts: numeric("construction.signature_slots", 0) },
    [fromFragment("/requirement/expected", capacityStep), fromFragment("/facts/numeric/0/value", projectedStep)],
    [RULE, SIGNATURE_STAT],
    [rule.entry.ref, statEntry.ref],
  );
  // Slots left after construction — M4 subtracts; the reader never re-computes it (§93–§94).
  const availableStep = formula("signature.available_formula", "signatureAvailable", {}, "construction-signature-available", [RULE, SIGNATURE_STAT], [rule.entry.ref, statEntry.ref], [fromFragment("/variables/capacity", capacityStep), fromFragment("/variables/projected", projectedStep)], CONSTRUCTION_ORDER.SIGNATURE);
  if (p.count > 0) return finish(p, () => null as never);

  const subject = own(r, "subjectKey") as string;
  const assembled = assembleFragments({ subjectKind: SUBJECT_KIND, subjectKey: subject, components: e.components, bundle, fragments: e.fragments }, p);
  if (p.count > 0) return finish(p, () => null as never);
  const stepKeyOf = (fragmentKey: string) => compiledStepKey(SUBJECT_KIND, subject, fragmentKey);
  return finish(p, () =>
    deepFreeze({
      contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
      subject: { kind: SUBJECT_KIND, subjectKey: subject, abilityKind, compositionKey: composition.compositionKey },
      rulesetProvenance: bundle.rulesetProvenance,
      evaluationPlan: { steps: assembled.steps, primaryStepKey: null, validationStepKey: null, explanationStepKey: null },
      sourceMap: { entries: assembled.entries },
      outputs: {
        abilityKind,
        access,
        capacity: {
          baseEffects,
          baseTraits,
          conditions: conditionCapacity,
          conditionSource,
          exchange,
          tradesRequested: trades,
          remainingEffectsStep: stepKeyOf(remainingStep),
          effectiveTraitsStep: stepKeyOf(effectiveStep),
          maximumTradesStep: maxTradesStep === null ? null : stepKeyOf(maxTradesStep),
        },
        usage: { effects: effectSlots, traits: traitSlots, conditions: conditionSlots },
        stacking,
        signature: {
          usedBefore: usedSlots,
          slotUse,
          candidateCost,
          exemption: slotUse === "EXEMPT" ? { exemptionKey, rule: rule.entry.ref } : null,
          capacityStep: stepKeyOf(capacityStep),
          projectedStep: stepKeyOf(projectedStep),
          availableStep: stepKeyOf(availableStep),
        },
        rules: rules.map((x) => ({ ...x, stepKey: stepKeyOf(x.stepKey) })),
      },
    }),
  );
}

// ---- Reading a run -------------------------------------------------------------------------------------------------

export interface ConstructionRuleResult {
  readonly ruleKey: string;
  readonly family: ConstructionRuleFamily;
  readonly componentKey: string | null;
  readonly satisfied: boolean;
  /** M4's own Requirement outcome tree (expected / actual per leaf, with provenance) — the explanation source (§93). */
  readonly outcome: JsonObject;
}

/** The structured, explainable construction-legality result (§92–§94). Every number was produced by M4. */
export interface AbilityConstructionResult {
  readonly abilityKind: AbilityKind;
  readonly compositionKey: string;
  readonly status: "VALID" | "INVALID";
  readonly valid: boolean;
  readonly access: ConstructionCompiledOutputs["access"] & { readonly satisfied: boolean };
  readonly capacity: {
    readonly effects: { readonly base: number; readonly remaining: number };
    readonly traits: { readonly base: number; readonly effective: number };
    readonly conditions: { readonly capacity: number; readonly source: { readonly track: ConstructionSkillTrack; readonly rank: string } };
    readonly trades: { readonly requested: number; readonly maximum: number; readonly exchangeAvailable: boolean };
  };
  readonly usage: ConstructionCompiledOutputs["usage"];
  readonly prerequisites: readonly { readonly componentKey: string; readonly ruleKey: string; readonly satisfied: boolean }[];
  readonly stacking: readonly (ConstructionCompiledOutputs["stacking"][number] & { readonly satisfied: boolean })[];
  readonly affinityAccess: readonly { readonly componentKey: string; readonly satisfied: boolean }[];
  readonly signature: {
    readonly capacity: number;
    readonly usedBefore: number;
    readonly slotUse: SignatureSlotUse;
    readonly candidateUse: number;
    readonly projected: number;
    readonly availableAfter: number;
    readonly exemption: ConstructionCompiledOutputs["signature"]["exemption"];
    readonly satisfied: boolean;
  };
  readonly rules: readonly ConstructionRuleResult[];
  /** The rule keys that are not satisfied, in plan order. Empty exactly when the construction is VALID. */
  readonly problems: readonly string[];
}

/** Reads an M4 EvaluationRun of a construction plan back into the result contract. Reads; never re-computes. */
export function readAbilityConstructionRun(input: { readonly plan: ProwessConstructionCompiledPlan; readonly run: unknown }): ProwessOutcome<AbilityConstructionResult> {
  const p = new Problems();
  if (!checkPlainData(input.run, ["run"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const steps = isPlainObject(input.run) ? own(input.run, "steps") : undefined;
  if (!Array.isArray(steps)) {
    p.add(K.INCOMPLETE_RUN, ["run"], "an EvaluationRun has a steps array");
    return finish(p, () => null as never);
  }
  const planned = new Set(input.plan.evaluationPlan.steps.map((s) => s.stepKey));
  const ran = new Set(steps.map((s: unknown) => (isPlainObject(s) ? own(s, "stepKey") : null)));
  if (planned.size !== ran.size || ![...planned].every((k) => ran.has(k))) {
    p.add(K.INCOMPLETE_RUN, ["run", "steps"], "the run is not an evaluation of exactly this plan");
    return finish(p, () => null as never);
  }
  const data = (stepKey: string): Record<string, unknown> | null => {
    const step = steps.find((s: unknown) => isPlainObject(s) && own(s, "stepKey") === stepKey) as Record<string, unknown> | undefined;
    const response = step === undefined ? undefined : own(step, "response");
    const value = isPlainObject(response) && own(response, "success") === true ? own(response, "data") : undefined;
    if (step === undefined || own(step, "executionStatus") !== "EXECUTED" || !isPlainObject(value)) {
      p.add(K.INCOMPLETE_RUN, ["run", "steps"], `step ${stepKey} did not execute successfully`);
      return null;
    }
    return value as Record<string, unknown>;
  };
  const value = (stepKey: string): number => {
    const d = data(stepKey);
    const v = d === null ? undefined : own(d, "finalValue");
    return typeof v === "number" ? v : Number.NaN;
  };
  const o = input.plan.outputs;
  const rules: ConstructionRuleResult[] = o.rules.map((rule) => {
    const d = data(rule.stepKey);
    return { ruleKey: rule.ruleKey, family: rule.family, componentKey: rule.componentKey, satisfied: d !== null && own(d, "satisfied") === true, outcome: ((d === null ? null : own(d, "outcome")) ?? {}) as JsonObject };
  });
  const remaining = value(o.capacity.remainingEffectsStep);
  const effective = value(o.capacity.effectiveTraitsStep);
  const maximum = o.capacity.maximumTradesStep === null ? NO_EXCHANGE_TRADES : value(o.capacity.maximumTradesStep);
  const capacity = value(o.signature.capacityStep);
  const projected = value(o.signature.projectedStep);
  const availableAfter = value(o.signature.availableStep);
  if (p.count > 0) return finish(p, () => null as never);
  const of = (family: ConstructionRuleFamily) => rules.filter((x) => x.family === family);
  const satisfied = (family: ConstructionRuleFamily) => of(family).every((x) => x.satisfied);
  const valid = rules.every((x) => x.satisfied);
  return finish(p, () =>
    deepFreeze({
      abilityKind: o.abilityKind,
      compositionKey: input.plan.subject.compositionKey,
      status: valid ? ("VALID" as const) : ("INVALID" as const),
      valid,
      access: { ...o.access, satisfied: satisfied("ACCESS") },
      capacity: {
        effects: { base: o.capacity.baseEffects, remaining },
        traits: { base: o.capacity.baseTraits, effective },
        conditions: { capacity: o.capacity.conditions, source: o.capacity.conditionSource },
        trades: { requested: o.capacity.tradesRequested, maximum, exchangeAvailable: o.capacity.exchange !== null },
      },
      usage: o.usage,
      prerequisites: of("PREREQUISITE").map((x) => ({ componentKey: x.componentKey as string, ruleKey: x.ruleKey, satisfied: x.satisfied })),
      stacking: o.stacking.map((s) => ({ ...s, satisfied: rules.some((x) => x.family === "STACK_LIMIT" && x.componentKey === s.componentKey && x.satisfied) })),
      affinityAccess: of("AFFINITY_ACCESS").map((x) => ({ componentKey: x.componentKey as string, satisfied: x.satisfied })),
      signature: {
        capacity,
        usedBefore: o.signature.usedBefore,
        slotUse: o.signature.slotUse,
        candidateUse: o.signature.candidateCost,
        projected,
        availableAfter,
        exemption: o.signature.exemption,
        satisfied: satisfied("SIGNATURE_CAPACITY") && satisfied("SIGNATURE_EXEMPTION"),
      },
      rules,
      problems: rules.filter((x) => !x.satisfied).map((x) => x.ruleKey),
    }),
  );
}

/**
 * Validates one Ability construction end to end (§91): compile with @prowess/game, evaluate with the frozen M4
 * orchestrator under the request's exact RulesetContext, read the run back. Pure; nothing is persisted (§51).
 */
export function evaluateAbilityConstruction(request: unknown): ProwessOutcome<AbilityConstructionResult> {
  const plan = compileAbilityConstruction(request);
  if (!plan.ok) return plan as ProwessOutcome<never>;
  const response = orchestrateRulesEvaluation({ evaluationKey: `construction.${plan.value.subject.subjectKey}`, contexts: { ruleset: own(request as Record<string, unknown>, "ruleset") }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) {
    const p = new Problems();
    p.add(K.INCOMPLETE_RUN, ["run"], `M4 could not evaluate the construction plan: ${JSON.stringify(response.errors)}`);
    return finish(p, () => null as never);
  }
  return readAbilityConstructionRun({ plan: plan.value, run: response.data as unknown as EvaluationRun });
}
