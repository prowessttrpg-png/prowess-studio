import type { JsonObject } from "@prowess/model";
import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationPlan, type EvaluationRun, type RuleProvenance } from "@prowess/rules";
import { keywordReference, readKeywordCatalog } from "../affinity/definitions.js";
import { bundleMatchesRuleset, createProwessDefinitionBundle, findBundleDefinition, type ProwessDefinitionBundle, type ProwessRulesetProvenance } from "../bundle/bundle.js";
import { assembleFragments, compiledStepKey } from "../compilation/assemble.js";
import type { CompilationFragment, CompilationFragmentBinding, ProwessCompilationSourceMap } from "../compilation/model.js";
import { compositionComponents, validateAbilityComposition, type AbilityComposition } from "../construction/composition.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION, SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS, type ProwessCompilationContractVersion } from "../contract-version.js";
import { program } from "../core/compile.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import { COMPILATION_ERROR_CODES as X, DEFINITION_ERROR_CODES as C, TARGETING_ERROR_CODES as T } from "../definition/codes.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { CompatibilityRule } from "../definition/payload.js";
import { readTargetingCosts, readTargetingRules, type TargetingCostRule, type TargetingFormula, type TargetingParameterRule, type TargetingRules } from "../definition/targeting-payload.js";
import { TARGETING_ORDER } from "../internal/order.js";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isExactLabel, isToken, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import type { TargetingSemanticShape } from "../vocabulary/construction.js";
import { PROWESS_STATS, type DerivedStatistic, type ProwessStat } from "../vocabulary/core.js";
import { PROWESS_DEFINITION_KINDS, type AbilityKind, type ProwessDefinitionKind } from "../vocabulary/families.js";
import {
  HISTORICAL_ADD_ON_SHAPES,
  type AuraSource,
  type CoverPolicy,
  type DeliveryFamily,
  type SightPolicy,
  type TargetCategory,
  type TargetingCompatibilityStatus,
  type TargetingMeasure,
  type TargetingOriginMode,
  type TargetingParameterKind,
  type TargetingPlacementModel,
  type TargetingRangeModel,
} from "../vocabulary/targeting.js";

/**
 * Shared TARGETING evaluation (PAS-10 M5-WO6). Reads the composition's ONE exact branch-specific Targeting Definition
 * (SPELL_TARGETING or MANEUVER_TARGETING — never interchangeable, M5-I162) and its typed `rules.targeting` sub-contract,
 * and answers WHERE / WHO / HOW FAR / WHAT SHAPE / HOW MANY / FROM WHERE / PLACEMENT (§4):
 *
 *   range      — the explicit range model; default Spell Range reuses the WO2 BASE_RANGE statistic (15 ft × PER, §24)
 *   geometry   — area measures as authored M4 Formulas (Spell 5 × PRO, Maneuver Rank Base × STR …), or explicit
 *                DEFERRED_PENDING_CANON (Spell Line width, M5-SC-040) / EFFECT_DEFINED entries — never a guessed number
 *   cardinality, valid targets, origin, placement, Line of Sight / Effect and cover policy (classifications only)
 *   cost       — the LISTED Targeting contributions (base, deferred base — Projectile M5-SC-039 — and scaling selections),
 *                REPORTED only: no final Spell / Maneuver cost, no payment (M5-I177)
 *   compatibility — each component's explicit TARGETING compatibility rule, by exact identity or semantic token (M5-I171)
 *
 * Targeting never selects an Attack Roll, a Saving Throw, a Save Stat or an outcome (M5-I159, M5-I160). Every number is
 * computed by M4 FORMULA steps; every bound and compatibility decision is an M4 REQUIREMENT; Keywords are an M4 KEYWORD
 * step. Nothing here persists, mutates its inputs, spends a resource or selects battlefield targets (§121–§126).
 */

// ---- Public contracts ----------------------------------------------------------------------------------------------

export interface AbilityTargetingCharacterContext {
  /** The Stats Targeting Formulas read (PER for Spell Range, PRO for Spell areas, STR for Maneuver Radius). */
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
  /** Exact Skill ranks on the SKILL ladder (Martial Rank for the Maneuver Radius base). Unlisted → the ladder's first rank. */
  readonly skillRanks: readonly { readonly skillKey: string; readonly rankKey: string }[];
}

export interface AbilityTargetingRequest {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subjectKey: string;
  /** The exact WO1 Ability Composition. Its ONE `targeting` use carries the Targeting parameters. */
  readonly composition: unknown;
  readonly definitions: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  readonly character: AbilityTargetingCharacterContext;
  /** Exact M1 Keyword references (the WO4 catalog contract) for the Targeting Definition's Keyword contributions. */
  readonly keywords: unknown;
  /** Explicit rules (a Trait, Metamagic or special rule — later Work Orders) that let a component use this Targeting. */
  readonly targetingModifiers?: readonly { readonly componentKey: string; readonly sourceKey: string }[];
}

export type TargetingParameterValue = number | boolean | string;

export interface TargetingCompiledMeasure {
  readonly measure: TargetingMeasure;
  readonly status: "FORMULA" | "DEFERRED_PENDING_CANON" | "EFFECT_DEFINED" | "NOT_AUTHORED_AT_RANK";
  readonly stepKey: string | null;
  readonly unit: "ft" | null;
  readonly conflictKey: string | null;
  readonly ruleText: string | null;
}

export interface TargetingCompiledOutputs {
  readonly abilityKind: AbilityKind;
  readonly targeting: { readonly componentKey: string; readonly definition: ProwessDefinitionRef; readonly definitionKind: ProwessDefinitionKind; readonly semanticShape: TargetingSemanticShape };
  readonly deliveryFamily: DeliveryFamily;
  readonly range: { readonly model: TargetingRangeModel; readonly stepKey: string | null; readonly baseRangeStepKey: string | null; readonly unit: "ft" | null; readonly ruleText: string | null };
  readonly measures: readonly TargetingCompiledMeasure[];
  readonly cardinality: { readonly kind: "ONE" | "SELECTED" | "AREA" | "CHAIN"; readonly count: number | null; readonly minimum: number | null; readonly stepKey: string | null };
  readonly validTargets: readonly TargetCategory[];
  readonly origin: { readonly mode: TargetingOriginMode | null; readonly selection: "EXPLICIT" | "DEFAULT" | "EFFECT_DECIDED"; readonly allowed: readonly TargetingOriginMode[] };
  readonly source: { readonly source: AuraSource; readonly selection: "EXPLICIT" | "DEFAULT"; readonly allowed: readonly AuraSource[] } | null;
  readonly placement: TargetingPlacementModel;
  readonly lineOfSight: SightPolicy;
  readonly lineOfEffect: SightPolicy;
  readonly cover: CoverPolicy;
  readonly radiusCapable: boolean;
  readonly parameters: readonly { readonly parameter: string; readonly kind: TargetingParameterKind; readonly value: TargetingParameterValue | null; readonly explicit: boolean }[];
  readonly parameterRules: readonly { readonly ruleKey: string; readonly parameter: string; readonly stepKey: string }[];
  readonly cost: TargetingCostReport;
  readonly keywordsStepKey: string | null;
  readonly compatibility: readonly { readonly componentKey: string; readonly definition: ProwessDefinitionRef; readonly allow: readonly string[]; readonly modifier: string | null; readonly stepKey: string }[];
  readonly undeclaredCompatibility: readonly string[];
}

/** The LISTED Targeting contributions, REPORTED — never totalled, never paid (§61–§62, M5-I177). */
export interface TargetingCostReport {
  readonly base: { readonly status: "LISTED"; readonly currency: string; readonly amount: number; readonly contributionKey: string } | { readonly status: "DEFERRED_PENDING_CANON"; readonly currency: string; readonly conflictKey: string; readonly contributionKey: string } | { readonly status: "NOT_APPLICABLE" };
  readonly scaling: readonly {
    readonly contributionKey: string;
    readonly kind: "PER_STEP" | "PER_ADDITIONAL_TARGET" | "PER_SELECTION";
    readonly currency: string;
    readonly parameter: string;
    readonly amount: number;
    readonly step: { readonly size: number; readonly unit: string } | null;
    readonly values: readonly (string | boolean)[] | null;
    /** The use's value for the scaled parameter (or its default) — the selection WO10 will price. */
    readonly selected: TargetingParameterValue | null;
  }[];
}

export interface ProwessTargetingCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: { readonly kind: "ABILITY_TARGETING"; readonly subjectKey: string; readonly abilityKind: AbilityKind; readonly compositionKey: string };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly outputs: TargetingCompiledOutputs;
}

export interface AbilityTargetingResult {
  readonly abilityKind: AbilityKind;
  readonly compositionKey: string;
  readonly status: "VALID" | "INVALID";
  readonly valid: boolean;
  readonly targeting: TargetingCompiledOutputs["targeting"];
  readonly deliveryFamily: DeliveryFamily;
  readonly range: { readonly model: TargetingRangeModel; readonly value: number | null; readonly baseRange: number | null; readonly unit: "ft" | null; readonly ruleText: string | null };
  readonly geometry: readonly { readonly measure: TargetingMeasure; readonly status: TargetingCompiledMeasure["status"]; readonly value: number | null; readonly unit: "ft" | null; readonly conflictKey: string | null; readonly ruleText: string | null }[];
  readonly targetCount: { readonly kind: TargetingCompiledOutputs["cardinality"]["kind"]; readonly count: number | null; readonly minimum: number | null; readonly status: "FIXED" | "SELECTED" | "NOT_SELECTED" | "AREA" | "CHAIN"; readonly satisfied: boolean };
  readonly validTargets: readonly TargetCategory[];
  readonly origin: TargetingCompiledOutputs["origin"];
  readonly source: TargetingCompiledOutputs["source"];
  readonly placement: TargetingPlacementModel;
  readonly lineOfSight: SightPolicy;
  readonly lineOfEffect: SightPolicy;
  readonly cover: CoverPolicy;
  readonly radiusCapable: boolean;
  readonly parameters: TargetingCompiledOutputs["parameters"];
  readonly cost: TargetingCostReport;
  /** Every known-unresolved value, explicitly (§119): never 0, null-as-zero or NaN. */
  readonly deferred: readonly { readonly field: string; readonly status: "DEFERRED_PENDING_CANON"; readonly conflictKey: string }[];
  readonly keywords: readonly { readonly keywordId: string; readonly canonicalKey: string; readonly sources: readonly JsonObject[] }[];
  readonly compatibility: readonly { readonly componentKey: string; readonly definition: ProwessDefinitionRef | null; readonly status: TargetingCompatibilityStatus; readonly allow: readonly string[]; readonly modifier: string | null }[];
  readonly rules: readonly { readonly ruleKey: string; readonly satisfied: boolean; readonly outcome: JsonObject }[];
  /** The failing rule keys, in plan order (empty when VALID). */
  readonly problems: readonly string[];
}

// ---- Constants ------------------------------------------------------------------------------------------------------

const SUBJECT_KIND = "ABILITY_TARGETING";
const LADDER = "core.skill_ladder";
const IDENTITY_FACT = "targeting.identity";
const MODIFIER_FACT = "targeting.modifiers";
const KEYWORD_SOURCE_TYPE = "prowess.targeting";
const REQUEST_FIELDS = ["contractVersion", "subjectKey", "composition", "definitions", "ruleset", "character", "keywords", "targetingModifiers"];
const REQUEST_REQUIRED = ["contractVersion", "subjectKey", "composition", "definitions", "ruleset", "character", "keywords"];
const derivedKey = (statistic: DerivedStatistic) => `core.derived.${statistic.toLowerCase()}`;
const emptyFacts = (): JsonObject => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: null, keywords: null });
const fromFragment = (target: string, fragmentKey: string, pointer = "/data/finalValue"): CompilationFragmentBinding => ({ target, source: { kind: "FRAGMENT", fragmentKey, pointer } });
const provenanceJson = (p: RuleProvenance): JsonObject => ({ ...p }) as unknown as JsonObject;

// ---- Compilation ----------------------------------------------------------------------------------------------------

/** Compiles the composition's Targeting into ONE M4 EvaluationPlan. Pure and deterministic; never mutates its input. */
export function compileAbilityTargeting(request: unknown): ProwessOutcome<ProwessTargetingCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, T.INVALID_TARGETING_REQUEST, REQUEST_FIELDS, REQUEST_REQUIRED);
  if (r === null) return finish(p, () => null as never);
  const contractVersion = own(r, "contractVersion");
  if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) {
    p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], `supported Prowess compilation contract versions: ${SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.join(", ")}`);
  }
  const subjectKey = own(r, "subjectKey");
  if (!isExactLabel(subjectKey)) p.add(T.INVALID_TARGETING_REQUEST, ["subjectKey"], "subjectKey is an exact label");

  // The exact Ruleset: the bundle is re-validated against the exact RulesetContext, never trusted as supplied (§112–§116).
  const ruleset = createRulesetContext(own(r, "ruleset"));
  const rawBundle = own(r, "definitions");
  let bundle: ProwessDefinitionBundle | null = null;
  if (!ruleset.ok) p.add(T.INVALID_TARGETING_REQUEST, ["ruleset"], "an exact, valid M4 RulesetContext is required");
  else if (!isPlainObject(rawBundle)) p.add(T.INVALID_TARGETING_REQUEST, ["definitions"], "definitions is the exact ProwessDefinitionBundle of the request's RulesetContext");
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
  const core = coreOut.value;
  const ladder = core.skillLadder.payload.ranks;

  // The WO1 structure check runs first: one exact Targeting slot, branch-correct kinds (CROSS_BRANCH_DEFINITION, M5-I161–I162).
  const compositionOut = validateAbilityComposition(own(r, "composition"), { bundle });
  if (!compositionOut.ok) for (const problem of compositionOut.problems) p.list.push({ ...problem, path: `/composition${problem.path}` });
  if (p.count > 0 || !compositionOut.ok) return finish(p, () => null as never);
  const composition: AbilityComposition = compositionOut.value;
  const use = composition.targeting;
  const envelope = findBundleDefinition(bundle, use.definition);
  if (envelope === null) return finish(p, () => null as never); // validated by WO1 against this bundle
  const branch = PROWESS_DEFINITION_KINDS[envelope.definitionKind].branch;
  const payload = envelope.payload as Record<string, unknown>;
  const semanticShape = own(payload, "semanticShape") as TargetingSemanticShape;
  const tAt = ["definitions", envelope.canonicalKey, "payload"];

  // The executable Targeting rule: a WO1-era payload without one is not evaluable; an add-on is never a base type (§13–§16).
  const rawRules = own((own(payload, "rules") ?? {}) as Record<string, unknown>, "targeting");
  if ((HISTORICAL_ADD_ON_SHAPES as readonly string[]).includes(semanticShape)) {
    p.add(T.TARGETING_ADD_ON_AS_BASE, [...tAt, "semanticShape"], `${semanticShape} is a Targeting ADD-ON applied to a completed Spell (designer ruling M5-SC-029), never a base Targeting Type`);
    return finish(p, () => null as never);
  }
  if (rawRules === undefined) {
    p.add(T.TARGETING_RULE_MISSING, [...tAt, "rules", "targeting"], "the Targeting Definition authors no executable `rules.targeting` sub-contract");
    return finish(p, () => null as never);
  }
  const rules = readTargetingRules(rawRules, semanticShape, branch, [...tAt, "rules", "targeting"], p);
  const costs = rules === null ? null : readTargetingCosts((own(payload, "costContributions") ?? []) as never, rules, branch, [...tAt, "costContributions"], p);
  if (rules === null || costs === null) return finish(p, () => null as never);

  // Character context: Stats and Skill ranks only (§42 of WO5 — the same exact shape).
  const character = readCharacter(own(r, "character"), ladder, p);
  // Targeting parameters: only those the exact Definition declares (§51–§52).
  const params = readParameters(use.parameters as Record<string, unknown>, rules, p);
  const modifiers = readModifiers(own(r, "targetingModifiers"), composition, p);
  for (const table of rules.rankTables) {
    for (const entry of table.entries) {
      if (!ladder.some((l) => l.rankKey === entry.rankKey)) p.add(T.TARGETING_RULE_UNRESOLVED, [...tAt, "rules", "targeting", "rankTables", table.tableKey], `${entry.rankKey} is not a ${core.skillLadder.payload.ladderKey} rank`);
    }
  }
  if (p.count > 0 || character === null || params === null || modifiers === null) return finish(p, () => null as never);

  // ---- Emission ------------------------------------------------------------------------------------------------------
  const fragments: CompilationFragment[] = [];
  const components = new Map<string, ProwessDefinitionRef[]>([[use.componentKey, [use.definition]]]);
  const emit = (f: CompilationFragment) => {
    fragments.push(f);
    return f.fragmentKey;
  };
  const targetingProv: RuleProvenance = { entityId: envelope.entityId, entityVersionId: envelope.entityVersionId, canonicalKey: envelope.canonicalKey, rulesetId: bundle.rulesetProvenance.rulesetId, manifestId: bundle.rulesetProvenance.manifestId } as RuleProvenance;
  const valueOf = (rule: TargetingParameterRule): TargetingParameterValue | null => (params.has(rule.parameter) ? (params.get(rule.parameter) as TargetingParameterValue) : rule.default);
  const rankOf = (skillKey: string) => character.skillRanks.get(skillKey) ?? (ladder[0] as { rankKey: string }).rankKey;

  // WO2 derived statistics (BASE_RANGE) — the statistic's own content Formula, emitted once, cited exactly (§202).
  const derivedSteps = new Map<DerivedStatistic, string>();
  const derived = (statistic: DerivedStatistic, at: readonly (string | number)[]): string | null => {
    const existing = derivedSteps.get(statistic);
    if (existing !== undefined) return existing;
    const entry = core.derived[statistic];
    if (entry === undefined) {
      p.add(T.TARGETING_RULE_UNRESOLVED, at, `the Ruleset pins no ${statistic} statistic`);
      return null;
    }
    const literals: Record<string, number> = {};
    for (const v of entry.payload.formula.variables) {
      const score = v.source.kind === "STAT" ? character.stats[v.source.stat] : undefined;
      if (v.source.kind !== "STAT") p.add(T.TARGETING_RULE_UNRESOLVED, at, `${statistic} reads ${v.source.kind}; Targeting evaluation carries Stats only`);
      else if (score === undefined) p.add(T.INVALID_TARGETING_CONTEXT, ["character", "stats", v.source.stat], `${statistic} reads ${v.source.stat}; the Targeting context must state it`);
      else literals[v.variable] = score;
    }
    if (p.count > 0) return null;
    const key = derivedKey(statistic);
    components.set(key, [entry.ref]);
    const fragmentKey = emit({ fragmentKey: `derived.${statistic.toLowerCase()}`, order: TARGETING_ORDER.DERIVED, operation: "FORMULA", input: { program: program(entry.payload.formula, entry.provenance), variables: literals }, bindings: [], role: "targeting-derived-statistic", componentKeys: [key], definitions: [entry.ref] });
    derivedSteps.set(statistic, fragmentKey);
    return fragmentKey;
  };

  // One content Formula → one M4 FORMULA step. Variables: Stat literals, parameter values, rank-table rows (a lookup of
  // the authored row for the character's exact rank — no arithmetic), and bindings to WO2 derived steps.
  const formula = (fragmentKey: string, f: TargetingFormula, role: string, at: readonly (string | number)[]): string | "NOT_AUTHORED_AT_RANK" | null => {
    const variables: Record<string, number> = {};
    const bindings: CompilationFragmentBinding[] = [];
    const keys = [use.componentKey];
    const defs = [use.definition];
    for (const v of f.variables) {
      const s = v.source;
      if (s.kind === "STAT") {
        const score = character.stats[s.stat];
        if (score === undefined) p.add(T.INVALID_TARGETING_CONTEXT, ["character", "stats", s.stat], `the Targeting Formula reads ${s.stat}; the Targeting context must state it`);
        else variables[v.variable] = score;
      } else if (s.kind === "PARAMETER") {
        const rule = rules.parameters.find((x) => x.parameter === s.parameter) as TargetingParameterRule;
        variables[v.variable] = valueOf(rule) as number;
      } else if (s.kind === "SKILL_RANK_TABLE") {
        const table = rules.rankTables.find((t) => t.tableKey === s.table);
        const row = table?.entries.find((e) => e.rankKey === rankOf(table.skillKey));
        if (table === undefined || row === undefined) return "NOT_AUTHORED_AT_RANK";
        variables[v.variable] = row.value;
        components.set(LADDER, [core.skillLadder.ref]);
        keys.push(LADDER);
        defs.push(core.skillLadder.ref);
      } else {
        const step = derived(s.statistic, at);
        if (step === null) return null;
        bindings.push(fromFragment(`/variables/${v.variable}`, step));
        keys.push(derivedKey(s.statistic));
        defs.push((core.derived[s.statistic] as { ref: ProwessDefinitionRef }).ref);
      }
    }
    if (p.count > 0) return null;
    return emit({
      fragmentKey,
      order: TARGETING_ORDER.FORMULAS,
      operation: "FORMULA",
      input: { program: { expression: f.expression, rounding: f.rounding, ...(f.minimum === null ? {} : { minimum: f.minimum }), unit: f.unit, provenance: provenanceJson(targetingProv) }, variables },
      bindings,
      role,
      componentKeys: keys,
      definitions: defs,
    });
  };

  // Range (§24–§27) — never collapsed with area (M5-I166): a separate step, a separate output.
  let rangeStep: string | null = null;
  if (rules.range.formula !== null) {
    const out = formula("range", rules.range.formula, "targeting-range", [...tAt, "rules", "targeting", "range"]);
    rangeStep = out === "NOT_AUTHORED_AT_RANK" ? null : out;
  }
  const baseRangeStep = derivedSteps.get("BASE_RANGE") ?? null;

  // Area measures (§28–§35, §88–§95).
  const measures: TargetingCompiledMeasure[] = rules.measures.map((m) => {
    if (m.valueStatus === "DEFERRED_PENDING_CANON") return { measure: m.measure, status: m.valueStatus, stepKey: null, unit: null, conflictKey: m.conflictKey, ruleText: m.ruleText };
    if (m.valueStatus === "EFFECT_DEFINED") return { measure: m.measure, status: m.valueStatus, stepKey: null, unit: null, conflictKey: null, ruleText: null };
    const out = formula(`geometry.${m.measure.toLowerCase()}`, m.formula, "targeting-geometry", [...tAt, "rules", "targeting", "measures"]);
    if (out === "NOT_AUTHORED_AT_RANK") return { measure: m.measure, status: "NOT_AUTHORED_AT_RANK", stepKey: null, unit: null, conflictKey: null, ruleText: null };
    return { measure: m.measure, status: "FORMULA", stepKey: out, unit: "ft", conflictKey: null, ruleText: null };
  });
  if (p.count > 0) return finish(p, () => null as never);

  // Cardinality and parameter bounds (§40–§42, §104) — M4 REQUIREMENTs, never TypeScript comparisons.
  const parameterRules: { ruleKey: string; parameter: string; stepKey: string }[] = [];
  const bound = (ruleKey: string, parameter: string, value: number, minimum: number) => {
    emit({
      fragmentKey: ruleKey,
      order: TARGETING_ORDER.PARAMETERS,
      operation: "REQUIREMENT",
      input: { requirement: { kind: "NUMERIC_COMPARE", factKey: `targeting.parameter.${parameter}`, operator: ">=", expected: minimum, provenance: provenanceJson(targetingProv) }, facts: { ...emptyFacts(), numeric: [{ key: `targeting.parameter.${parameter}`, value, provenance: null }] } },
      bindings: [],
      role: "targeting-parameter-bound",
      componentKeys: [use.componentKey],
      definitions: [use.definition],
    });
    parameterRules.push({ ruleKey, parameter, stepKey: ruleKey });
  };
  let cardinality: TargetingCompiledOutputs["cardinality"];
  if (rules.cardinality.kind === "SELECTED") {
    const count = params.get(rules.cardinality.parameter);
    const stepKey = typeof count === "number" ? `cardinality.${rules.cardinality.parameter}` : null;
    if (typeof count === "number") bound(`cardinality.${rules.cardinality.parameter}`, rules.cardinality.parameter, count, rules.cardinality.minimum);
    cardinality = { kind: "SELECTED", count: typeof count === "number" ? count : null, minimum: rules.cardinality.minimum, stepKey };
  } else cardinality = { kind: rules.cardinality.kind, count: rules.cardinality.kind === "ONE" ? 1 : null, minimum: null, stepKey: null };
  for (const rule of rules.parameters) {
    const v = params.get(rule.parameter);
    const isCardinality = rules.cardinality.kind === "SELECTED" && rules.cardinality.parameter === rule.parameter;
    if (typeof v === "number" && rule.minimum !== null && !isCardinality) bound(`parameter.${rule.parameter}`, rule.parameter, v, rule.minimum);
  }

  // Origin and Aura source (§36, §46–§50, §92): an explicit selection, the authored default, or the owning Effect decides.
  const originParam = rules.parameters.find((x) => x.parameter === "originMode");
  const originChosen = originParam === undefined ? undefined : params.get("originMode");
  const origin: TargetingCompiledOutputs["origin"] =
    typeof originChosen === "string"
      ? { mode: originChosen as TargetingOriginMode, selection: "EXPLICIT", allowed: rules.origin.modes }
      : rules.origin.default !== null
        ? { mode: rules.origin.default, selection: "DEFAULT", allowed: rules.origin.modes }
        : { mode: null, selection: "EFFECT_DECIDED", allowed: rules.origin.modes };
  const sourceChosen = params.get("sourceRef");
  const source: TargetingCompiledOutputs["source"] =
    rules.origin.defaultSource === null ? null : { source: (typeof sourceChosen === "string" ? sourceChosen : rules.origin.defaultSource) as AuraSource, selection: typeof sourceChosen === "string" ? "EXPLICIT" : "DEFAULT", allowed: rules.origin.sources };

  // Keywords (§105–§107): ONLY the Definition's authored Keywords, each with its exact Targeting source.
  let keywordsStepKey: string | null = null;
  const keywords = ((own(payload, "keywords") ?? []) as string[]).slice();
  if (keywords.length > 0) {
    const contributions: JsonObject[] = [];
    for (const k of keywords) {
      const ref = keywordReference(catalog, k);
      if (ref === null) {
        p.add(T.TARGETING_RULE_UNRESOLVED, [...tAt, "keywords"], `${k} has no exact M1 Keyword reference in the supplied catalog; Keywords are never matched by text`);
        continue;
      }
      contributions.push({ keyword: { keywordId: ref.keywordId, canonicalKey: ref.canonicalKey, categoryId: ref.categoryId }, source: { sourceType: KEYWORD_SOURCE_TYPE, sourceKey: use.componentKey, sourceId: envelope.entityVersionId, provenance: provenanceJson(targetingProv) }, ordinal: 0 });
    }
    if (p.count > 0) return finish(p, () => null as never);
    keywordsStepKey = emit({ fragmentKey: "keywords", order: TARGETING_ORDER.KEYWORDS, operation: "KEYWORD", input: { contributions }, bindings: [], role: "targeting-keywords", componentKeys: [use.componentKey], definitions: [use.definition] });
  }

  // Compatibility (§72–§77, M5-I171): each component's explicit TARGETING rule, by exact canonical key or semantic token.
  const compatibility: TargetingCompiledOutputs["compatibility"][number][] = [];
  const undeclared: string[] = [];
  const identity = [envelope.canonicalKey, semanticShape];
  for (const c of compositionComponents(composition)) {
    if (c.slot === "affinity" || c.slot === "targeting") continue;
    const ce = findBundleDefinition(bundle, c.use.definition);
    const declared = ((ce === null ? [] : ((ce.payload as { compatibility?: CompatibilityRule[] }).compatibility ?? [])) as CompatibilityRule[]).filter((x) => x.relation === "TARGETING");
    if (declared.length === 0) {
      undeclared.push(c.use.componentKey);
      continue;
    }
    const allow = [...new Set(declared.flatMap((x) => x.allow))].sort();
    const modifier = modifiers.find((m) => m.componentKey === c.use.componentKey)?.sourceKey ?? null;
    components.set(c.use.componentKey, [c.use.definition]);
    const stepKey = emit({
      fragmentKey: `compatibility.${c.use.componentKey}`,
      order: TARGETING_ORDER.COMPATIBILITY,
      operation: "REQUIREMENT",
      input: {
        requirement: {
          kind: "ANY",
          children: [
            { kind: "ANY", children: allow.map((member) => ({ kind: "SET_CONTAINS", factKey: IDENTITY_FACT, member, provenance: null })), provenance: null },
            { kind: "SET_CONTAINS", factKey: MODIFIER_FACT, member: c.use.componentKey, provenance: null },
          ],
          provenance: null,
        },
        facts: {
          ...emptyFacts(),
          sets: [
            { key: IDENTITY_FACT, members: identity, provenance: provenanceJson(targetingProv) },
            { key: MODIFIER_FACT, members: modifier === null ? [] : [c.use.componentKey], provenance: null },
          ],
        },
      },
      bindings: [],
      role: "targeting-compatibility",
      componentKeys: [c.use.componentKey, use.componentKey],
      definitions: [c.use.definition, use.definition],
    });
    compatibility.push({ componentKey: c.use.componentKey, definition: c.use.definition, allow, modifier, stepKey });
  }

  // Cost: LISTED contributions REPORTED with the use's selections; WO10 prices them (M5-I177).
  const base = costs.find((x) => x.kind === "BASE" || x.kind === "BASE_DEFERRED");
  const cost: TargetingCostReport = {
    base:
      base === undefined
        ? { status: "NOT_APPLICABLE" }
        : base.kind === "BASE"
          ? { status: "LISTED", currency: base.currency, amount: base.amount, contributionKey: base.contributionKey }
          : { status: "DEFERRED_PENDING_CANON", currency: base.currency, conflictKey: (base as Extract<TargetingCostRule, { kind: "BASE_DEFERRED" }>).conflictKey, contributionKey: base.contributionKey },
    scaling: costs
      .filter((x): x is Extract<TargetingCostRule, { kind: "PER_STEP" | "PER_ADDITIONAL_TARGET" | "PER_SELECTION" }> => x.kind !== "BASE" && x.kind !== "BASE_DEFERRED")
      .map((x) => {
        const rule = rules.parameters.find((q) => q.parameter === x.parameter) as TargetingParameterRule;
        return { contributionKey: x.contributionKey, kind: x.kind, currency: x.currency, parameter: x.parameter, amount: x.amount, step: x.kind === "PER_STEP" ? x.step : null, values: x.kind === "PER_SELECTION" ? x.values : null, selected: valueOf(rule) };
      }),
  };

  if (p.count > 0) return finish(p, () => null as never);
  const subject = subjectKey as string;
  const assembled = assembleFragments({ subjectKind: SUBJECT_KIND, subjectKey: subject, components, bundle, fragments }, p);
  if (p.count > 0) return finish(p, () => null as never);
  const stepKeyOf = (fragmentKey: string | null) => (fragmentKey === null ? null : compiledStepKey(SUBJECT_KIND, subject, fragmentKey));
  const outputs: TargetingCompiledOutputs = {
    abilityKind: composition.abilityKind,
    targeting: { componentKey: use.componentKey, definition: use.definition, definitionKind: envelope.definitionKind, semanticShape },
    deliveryFamily: rules.deliveryFamily,
    range: { model: rules.range.model, stepKey: stepKeyOf(rangeStep), baseRangeStepKey: stepKeyOf(baseRangeStep), unit: rangeStep === null ? null : "ft", ruleText: rules.range.ruleText },
    measures: measures.map((m) => ({ ...m, stepKey: stepKeyOf(m.stepKey) })),
    cardinality: { ...cardinality, stepKey: stepKeyOf(cardinality.stepKey) },
    validTargets: rules.validTargets,
    origin,
    source,
    placement: rules.placement,
    lineOfSight: rules.lineOfSight,
    lineOfEffect: rules.lineOfEffect,
    cover: rules.cover,
    radiusCapable: rules.radiusCapable,
    parameters: rules.parameters.map((q) => ({ parameter: q.parameter, kind: q.kind, value: valueOf(q), explicit: params.has(q.parameter) })),
    parameterRules: parameterRules.map((x) => ({ ...x, stepKey: stepKeyOf(x.stepKey) as string })),
    cost,
    keywordsStepKey: stepKeyOf(keywordsStepKey),
    compatibility: compatibility.map((x) => ({ ...x, stepKey: stepKeyOf(x.stepKey) as string })),
    undeclaredCompatibility: undeclared,
  };
  return finish(p, () =>
    deepFreeze({
      contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
      subject: { kind: SUBJECT_KIND, subjectKey: subject, abilityKind: composition.abilityKind, compositionKey: composition.compositionKey },
      rulesetProvenance: bundle.rulesetProvenance,
      evaluationPlan: { steps: assembled.steps, primaryStepKey: null, validationStepKey: null, explanationStepKey: null },
      sourceMap: { entries: assembled.entries },
      outputs,
    }) as ProwessTargetingCompiledPlan,
  );
}

// ---- Request readers ------------------------------------------------------------------------------------------------

interface CharacterContext {
  readonly stats: Readonly<Partial<Record<ProwessStat, number>>>;
  readonly skillRanks: ReadonlyMap<string, string>;
}

function readCount(value: unknown, at: readonly (string | number)[], p: Problems, code: string, what: string): number | null {
  const n = readSafeInteger(value, at, p, code, what);
  if (n !== null && n < 0) {
    p.add(code, at, `${what} is a non-negative safe integer`);
    return null;
  }
  return n;
}

function readCharacter(value: unknown, ladder: readonly { rankKey: string }[], p: Problems): CharacterContext | null {
  const at = ["character"];
  const r = readRecord(value, at, p, T.INVALID_TARGETING_CONTEXT, ["stats", "skillRanks"], ["stats", "skillRanks"]);
  if (r === null) return null;
  const before = p.count;
  const stats: Partial<Record<ProwessStat, number>> = {};
  const rawStats = own(r, "stats");
  if (!isPlainObject(rawStats)) p.add(T.INVALID_TARGETING_CONTEXT, [...at, "stats"], "stats is a plain object of Stat → score");
  else
    for (const key of Object.keys(rawStats).sort()) {
      const stat = readEnum(key, PROWESS_STATS, [...at, "stats", key], p, T.INVALID_TARGETING_CONTEXT, "Stat");
      const score = readCount(own(rawStats, key), [...at, "stats", key], p, T.INVALID_TARGETING_CONTEXT, "a Stat score");
      if (stat !== null && score !== null) stats[stat] = score;
    }
  const skillRanks = new Map<string, string>();
  const rawRanks = own(r, "skillRanks");
  if (!Array.isArray(rawRanks)) p.add(T.INVALID_TARGETING_CONTEXT, [...at, "skillRanks"], "skillRanks is an array of { skillKey, rankKey }");
  else
    rawRanks.forEach((x: unknown, i: number) => {
      const e = readRecord(x, [...at, "skillRanks", i], p, T.INVALID_TARGETING_CONTEXT, ["skillKey", "rankKey"], ["skillKey", "rankKey"]);
      if (e === null) return;
      const skillKey = own(e, "skillKey");
      const rankKey = own(e, "rankKey");
      if (!isExactCanonicalKey(skillKey) || skillRanks.has(skillKey)) p.add(T.INVALID_TARGETING_CONTEXT, [...at, "skillRanks", i, "skillKey"], "skillKey is an exact Skill canonical key, listed once");
      else if (typeof rankKey !== "string" || !ladder.some((l) => l.rankKey === rankKey)) p.add(T.INVALID_TARGETING_CONTEXT, [...at, "skillRanks", i, "rankKey"], "rankKey is a SKILL-ladder rank");
      else skillRanks.set(skillKey, rankKey);
    });
  return p.count > before ? null : { stats, skillRanks };
}

/** The use's Targeting parameters: declared by the exact Definition, of the declared kind (§51–§52, §125). */
function readParameters(raw: Record<string, unknown>, rules: TargetingRules, p: Problems): Map<string, TargetingParameterValue> | null {
  const before = p.count;
  const out = new Map<string, TargetingParameterValue>();
  for (const name of Object.keys(raw).sort()) {
    const at = ["composition", "targeting", "parameters", name];
    const rule = rules.parameters.find((x) => x.parameter === name);
    const value = own(raw, name);
    if (rule === undefined) {
      p.add(T.UNDECLARED_TARGETING_PARAMETER, at, `${name} is not a parameter of this exact Targeting Definition; parameters never create mechanics (§52)`);
      continue;
    }
    if (rule.kind === "COUNT" || rule.kind === "STEPS") {
      const n = readCount(value, at, p, T.INVALID_TARGETING_PARAMETER, `${name}`);
      if (n !== null) out.set(name, n);
    } else if (rule.kind === "FLAG") {
      if (typeof value !== "boolean") p.add(T.INVALID_TARGETING_PARAMETER, at, `${name} is an explicit boolean`);
      else out.set(name, value);
    } else if (!isToken(value) || !rule.allowed.includes(value)) p.add(T.INVALID_TARGETING_PARAMETER, at, `${name} is one of ${rule.allowed.join(", ")}`);
    else out.set(name, value);
  }
  // A selected origin / Aura source must be one the Definition authors (§36, §92).
  const origin = out.get("originMode");
  if (typeof origin === "string" && !(rules.origin.modes as readonly string[]).includes(origin)) p.add(T.INVALID_TARGETING_PARAMETER, ["composition", "targeting", "parameters", "originMode"], `origin ${origin} is not authored by this Definition`);
  const source = out.get("sourceRef");
  if (typeof source === "string" && !(rules.origin.sources as readonly string[]).includes(source)) p.add(T.INVALID_TARGETING_PARAMETER, ["composition", "targeting", "parameters", "sourceRef"], `source ${source} is not authored by this Definition`);
  return p.count > before ? null : out;
}

function readModifiers(raw: unknown, composition: AbilityComposition, p: Problems): { componentKey: string; sourceKey: string }[] | null {
  if (raw === undefined) return [];
  const before = p.count;
  const out: { componentKey: string; sourceKey: string }[] = [];
  if (!Array.isArray(raw)) {
    p.add(T.INVALID_TARGETING_REQUEST, ["targetingModifiers"], "targetingModifiers is an array of { componentKey, sourceKey }");
    return null;
  }
  raw.forEach((x: unknown, i: number) => {
    const m = readRecord(x, ["targetingModifiers", i], p, T.INVALID_TARGETING_REQUEST, ["componentKey", "sourceKey"], ["componentKey", "sourceKey"]);
    if (m === null) return;
    const componentKey = own(m, "componentKey");
    const sourceKey = own(m, "sourceKey");
    if (!compositionComponents(composition).some((c) => c.slot !== "affinity" && c.slot !== "targeting" && c.use.componentKey === componentKey)) p.add(T.INVALID_TARGETING_REQUEST, ["targetingModifiers", i, "componentKey"], "a Targeting modifier names a non-Targeting component of this composition");
    else if (!isExactCanonicalKey(sourceKey)) p.add(T.INVALID_TARGETING_REQUEST, ["targetingModifiers", i, "sourceKey"], "sourceKey is the exact canonical key of the explicit modifying rule");
    else if (out.some((o) => o.componentKey === componentKey)) p.add(T.INVALID_TARGETING_REQUEST, ["targetingModifiers", i, "componentKey"], "one explicit modifier per component");
    else out.push({ componentKey: componentKey as string, sourceKey });
  });
  return p.count > before ? null : out;
}

// ---- Reading the run ------------------------------------------------------------------------------------------------

/** Reads an M4 EvaluationRun of a Targeting plan. Every number and every satisfied flag comes from M4 (M5-I175). */
export function readAbilityTargetingRun(input: { readonly plan: ProwessTargetingCompiledPlan; readonly run: unknown }): ProwessOutcome<AbilityTargetingResult> {
  const p = new Problems();
  if (!checkPlainData(input.run, ["run"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const steps = isPlainObject(input.run) ? own(input.run, "steps") : undefined;
  if (!Array.isArray(steps)) {
    p.add(T.INCOMPLETE_RUN, ["run"], "an EvaluationRun has a steps array");
    return finish(p, () => null as never);
  }
  const planned = new Set(input.plan.evaluationPlan.steps.map((s) => s.stepKey));
  const ran = new Set(steps.map((s: unknown) => (isPlainObject(s) ? own(s, "stepKey") : null)));
  if (planned.size !== ran.size || ![...planned].every((k) => ran.has(k))) {
    p.add(T.INCOMPLETE_RUN, ["run", "steps"], "the run is not an evaluation of exactly this plan");
    return finish(p, () => null as never);
  }
  const data = (stepKey: string): Record<string, unknown> | null => {
    const step = steps.find((s: unknown) => isPlainObject(s) && own(s, "stepKey") === stepKey) as Record<string, unknown> | undefined;
    const response = step === undefined ? undefined : own(step, "response");
    const value = isPlainObject(response) && own(response, "success") === true ? own(response, "data") : undefined;
    if (step === undefined || own(step, "executionStatus") !== "EXECUTED" || !isPlainObject(value)) {
      p.add(T.INCOMPLETE_RUN, ["run", "steps"], `step ${stepKey} did not execute successfully`);
      return null;
    }
    return value as Record<string, unknown>;
  };
  const value = (stepKey: string | null): number | null => {
    if (stepKey === null) return null;
    const d = data(stepKey);
    const v = d === null ? undefined : own(d, "finalValue");
    return typeof v === "number" ? v : null;
  };
  const o = input.plan.outputs;
  const rules: { ruleKey: string; satisfied: boolean; outcome: JsonObject }[] = [];
  const requirement = (ruleKey: string, stepKey: string) => {
    const d = data(stepKey);
    const satisfied = d !== null && own(d, "satisfied") === true;
    const outcome = ((d === null ? null : own(d, "outcome")) ?? {}) as JsonObject;
    rules.push({ ruleKey, satisfied, outcome });
    return { satisfied, outcome };
  };
  for (const pr of o.parameterRules) requirement(pr.ruleKey, pr.stepKey);
  const compatibility = o.compatibility.map((c) => {
    const { satisfied, outcome } = requirement(`compatibility.${c.componentKey}`, c.stepKey);
    const identity = ((outcome as { children?: { satisfied?: boolean }[] }).children ?? [])[0]?.satisfied === true;
    const status: TargetingCompatibilityStatus = !satisfied ? "INCOMPATIBLE" : identity ? "COMPATIBLE" : "MODIFIED_BY_EXPLICIT_RULE";
    return { componentKey: c.componentKey, definition: c.definition, status, allow: c.allow, modifier: c.modifier };
  });
  const keywordsData = o.keywordsStepKey === null ? null : data(o.keywordsStepKey);
  const keywords = ((keywordsData === null ? [] : (own(keywordsData, "keywords") ?? [])) as { keyword: { keywordId: string; canonicalKey: string }; contributors?: JsonObject[] }[]).map((k) => ({ keywordId: k.keyword.keywordId, canonicalKey: k.keyword.canonicalKey, sources: [...(k.contributors ?? [])] }));
  const rangeValue = value(o.range.stepKey);
  const baseRange = value(o.range.baseRangeStepKey);
  const geometry = o.measures.map((m) => ({ measure: m.measure, status: m.status, value: value(m.stepKey), unit: m.unit, conflictKey: m.conflictKey, ruleText: m.ruleText }));
  if (p.count > 0) return finish(p, () => null as never);
  const cardinalityRule = rules.find((x) => x.ruleKey.startsWith("cardinality."));
  const deferred = [
    ...(o.cost.base.status === "DEFERRED_PENDING_CANON" ? [{ field: "cost.base", status: "DEFERRED_PENDING_CANON" as const, conflictKey: o.cost.base.conflictKey }] : []),
    ...o.measures.filter((m) => m.status === "DEFERRED_PENDING_CANON").map((m) => ({ field: `geometry.${m.measure.toLowerCase()}`, status: "DEFERRED_PENDING_CANON" as const, conflictKey: m.conflictKey as string })),
  ];
  const valid = rules.every((x) => x.satisfied);
  const statusOf = (): AbilityTargetingResult["targetCount"]["status"] => {
    if (o.cardinality.kind === "ONE") return "FIXED";
    if (o.cardinality.kind === "SELECTED") return o.cardinality.count === null ? "NOT_SELECTED" : "SELECTED";
    return o.cardinality.kind;
  };
  return finish(p, () =>
    deepFreeze({
      abilityKind: o.abilityKind,
      compositionKey: input.plan.subject.compositionKey,
      status: valid ? "VALID" : "INVALID",
      valid,
      targeting: o.targeting,
      deliveryFamily: o.deliveryFamily,
      range: { model: o.range.model, value: rangeValue, baseRange, unit: o.range.unit, ruleText: o.range.ruleText },
      geometry,
      targetCount: { kind: o.cardinality.kind, count: o.cardinality.count, minimum: o.cardinality.minimum, status: statusOf(), satisfied: cardinalityRule === undefined || cardinalityRule.satisfied },
      validTargets: o.validTargets,
      origin: o.origin,
      source: o.source,
      placement: o.placement,
      lineOfSight: o.lineOfSight,
      lineOfEffect: o.lineOfEffect,
      cover: o.cover,
      radiusCapable: o.radiusCapable,
      parameters: o.parameters,
      cost: o.cost,
      deferred,
      keywords,
      compatibility: [...compatibility, ...o.undeclaredCompatibility.map((componentKey) => ({ componentKey, definition: null, status: "NOT_DECLARED" as const, allow: [], modifier: null }))],
      rules,
      problems: rules.filter((x) => !x.satisfied).map((x) => x.ruleKey),
    }) as AbilityTargetingResult,
  );
}

/** compile → M4 → read, in one pure call. */
export function evaluateAbilityTargeting(request: unknown): ProwessOutcome<AbilityTargetingResult> {
  const plan = compileAbilityTargeting(request);
  if (!plan.ok) return plan as ProwessOutcome<never>;
  const response = orchestrateRulesEvaluation({ evaluationKey: `targeting.${plan.value.subject.subjectKey}`, contexts: { ruleset: own(request as Record<string, unknown>, "ruleset") }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) {
    const p = new Problems();
    p.add(T.INCOMPLETE_RUN, ["run"], `M4 could not evaluate the Targeting plan: ${JSON.stringify(response.errors)}`);
    return finish(p, () => null as never);
  }
  return readAbilityTargetingRun({ plan: plan.value, run: response.data as unknown as EvaluationRun });
}
