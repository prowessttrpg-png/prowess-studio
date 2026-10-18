import type { EvaluationPlan, RuleProvenance } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isExactLabel, isToken, own, readEnum, readRecord, type ProwessOutcome } from "../internal/problems.js";
import { AFFINITY_ORDER } from "../internal/order.js";
import { AFFINITY_ERROR_CODES as A, COMPILATION_ERROR_CODES as X, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { AffinityStrengthRule, AffinityWeaknessRule } from "../definition/affinity-payload.js";
import { bundleMatchesRuleset, createProwessDefinitionBundle, findBundleDefinition, type ProwessDefinitionBundle, type ProwessRulesetProvenance } from "../bundle/bundle.js";
import { compositionComponents, validateAbilityComposition, type AbilityComposition } from "../construction/composition.js";
import { assembleFragments, compiledStepKey } from "../compilation/assemble.js";
import type { CompilationFragment, CompilationFragmentBinding, ProwessCompilationSourceMap } from "../compilation/model.js";
import { SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS, PROWESS_COMPILATION_CONTRACT_VERSION, type ProwessCompilationContractVersion } from "../contract-version.js";
import { createRulesetContext } from "@prowess/rules";
import { PROWESS_DEFINITION_KINDS, type AbilityComponentContract, type AbilityKind } from "../vocabulary/families.js";
import {
  AFFINITY_COST_TARGETS,
  AFFINITY_RANKS,
  AFFINITY_SUBJECT_KINDS,
  SPELL_CONSTRUCTION_AUTHORITIES,
  type AffinityCostTarget,
  type AffinityRank,
  type AffinityRole,
  type AffinitySubjectKind,
  type AffinityWeaknessSeverity,
  type SpellConstructionAuthority,
} from "../vocabulary/affinity.js";
import type { CanonicalAffinity } from "../vocabulary/construction.js";
import { findAffinityEntry, indexAffinityDefinitions, keywordReference, rankEntry, readKeywordCatalog, type AffinityDefinitionIndex, type AffinityEntry, type KeywordCatalog } from "./definitions.js";
import { ownedAffinity, validateAffinityProfile, type CharacterAffinityProfile, type OwnedAffinity } from "./profile.js";

/**
 * Affinity compilation (PAS-10 M5-WO4 §3, §122–§131, §276–§280). Exact Affinity Definitions + the exact Affinity Rank
 * rule + a CharacterAffinityProfile + an Ability Composition's exact component Keyword contributions → ONE M4
 * EvaluationPlan built only from existing M4 primitives:
 *
 *   KEYWORD      — every explicit component Keyword contribution, with its exact source Definition (§61–§67)
 *   REQUIREMENT  — one per Strength rule and per Weakness rule: ANY exact Keyword present (§86, §90)
 *   MODIFIER     — Weakness selection: one MAX per Weakness, each conditioned on its own Keywords (§126, §130)
 *   MODIFIER     — the listed cost: Strength REDUCE_PERCENT (phase 1), then Weakness INCREASE_PERCENT (phase 2) (§97, §125)
 *   REQUIREMENT  — Affinity Authority rank floor / Effect & Trait capacity / Effect specialization; access prerequisites
 *
 * The compiler ASSEMBLES conditions, Keyword references, modifier definitions, bindings and ordering. M4 performs every
 * percentage, every max selection and every comparison (§127, M5-I149). Nothing here rounds (§99), nets percentages
 * (§96), branches on an Affinity name (§3), picks a governing Affinity (§81), stacks Affinities (§82), touches AP (§135)
 * or ME (§134), persists anything (§173) or reads anything but its inputs (§169).
 */

/** AFFINITY_ALIGNMENT: Strength / Weakness alignment of one Ability (Spell OR Maneuver) to its governing Affinity. */
export interface AffinityAlignmentSubject {
  readonly kind: "AFFINITY_ALIGNMENT";
  readonly subjectKey: string;
  readonly composition: unknown;
}

/** SPELL_AFFINITY_COST: the reusable Spell MP Affinity fragment over an already-constructed cost (§7, §79, §132). */
export interface SpellAffinityCostSubject {
  readonly kind: "SPELL_AFFINITY_COST";
  readonly subjectKey: string;
  readonly composition: unknown;
  readonly costTarget: AffinityCostTarget;
  /** The constructed component cost the later Spell cost pipeline supplies. Finite, non-negative; never rounded here. */
  readonly baseCost: number;
}

/** AFFINITY_AUTHORITY: Spell construction under the composition's explicit Authority (§105–§118). */
export interface AffinityAuthoritySubject {
  readonly kind: "AFFINITY_AUTHORITY";
  readonly subjectKey: string;
  readonly composition: unknown;
  /** Explicit valid Affinity access rules authorizing a non-Strength Effect (§110, §112). Never inferred. */
  readonly accessGrants?: readonly { readonly componentKey: string; readonly sourceKey: string }[];
}

/** AFFINITY_ACCESS: reusable Affinity prerequisites (Trait / Effect / Maneuver access — §119–§122). */
export interface AffinityAccessSubject {
  readonly kind: "AFFINITY_ACCESS";
  readonly subjectKey: string;
  readonly requirements: readonly { readonly requirementKey: string; readonly affinity: ProwessDefinitionRef; readonly minimumRank: AffinityRank; readonly requiredKeywords: readonly string[] }[];
  /** Needed only when a requirement names Keywords: the Ability whose explicit Keywords are checked. */
  readonly composition?: unknown;
}

export type AffinityCompilationSubject = AffinityAlignmentSubject | SpellAffinityCostSubject | AffinityAuthoritySubject | AffinityAccessSubject;

export interface AffinityCompilationRequest {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: AffinityCompilationSubject;
  readonly definitions: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  readonly profile: unknown;
  /** Exact M1 Keyword references for every Keyword the evaluation touches (§67, §146). */
  readonly keywords: unknown;
}

/** One component's explicit Keyword contribution (§66): which component, which exact Definition, which Keywords. */
export interface AffinityKeywordContributor {
  readonly componentKey: string;
  readonly contract: AbilityComponentContract;
  readonly definition: ProwessDefinitionRef;
  readonly keywords: readonly string[];
}

export interface AffinityCompiledRule {
  readonly ruleKey: string;
  readonly matchAny: readonly string[];
  readonly stepKey: string;
}

export interface AffinityCompiledWeakness extends AffinityCompiledRule {
  readonly activationPenaltyPercent: number;
  readonly severity: AffinityWeaknessSeverity | null;
}

/** Which compiled step holds which result. Pure naming plus the authored values the steps were built from. */
export interface AffinityCompiledOutputs {
  readonly governing: { readonly affinity: ProwessDefinitionRef; readonly identity: CanonicalAffinity; readonly rank: AffinityRank; readonly role: AffinityRole; readonly rankRule: ProwessDefinitionRef } | null;
  readonly keywords: string | null;
  readonly contributors: readonly AffinityKeywordContributor[];
  readonly strengths: readonly AffinityCompiledRule[];
  readonly weaknesses: readonly AffinityCompiledWeakness[];
  readonly weaknessSelection: string | null;
  readonly cost: {
    readonly costTarget: AffinityCostTarget;
    readonly targetKey: string;
    readonly baseCost: number;
    readonly stepKey: string;
    /** The rank-authored discount the Strength modifier carries (0 at NONE — §89). */
    readonly strengthDiscountPercent: number;
    readonly strengthModifierKey: string | null;
    readonly weaknessModifierKey: string | null;
  } | null;
  readonly authority: {
    readonly authority: SpellConstructionAuthority;
    readonly minimumRank: AffinityRank;
    readonly rankStep: string;
    readonly effectCapacity: { readonly stepKey: string; readonly capacity: number; readonly count: number } | null;
    readonly traitCapacity: { readonly stepKey: string; readonly capacity: number; readonly count: number } | null;
    readonly effectAccess: readonly { readonly componentKey: string; readonly keywordStep: string; readonly stepKey: string; readonly granted: string | null }[];
  } | null;
  readonly access: readonly { readonly requirementKey: string; readonly affinity: ProwessDefinitionRef; readonly minimumRank: AffinityRank; readonly requiredKeywords: readonly string[]; readonly stepKey: string }[];
}

export interface ProwessAffinityCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: { readonly kind: AffinitySubjectKind; readonly subjectKey: string; readonly abilityKind: AbilityKind | null; readonly compositionKey: string | null };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly outputs: AffinityCompiledOutputs;
}

const REQUEST_FIELDS = ["contractVersion", "subject", "definitions", "ruleset", "profile", "keywords"];
const SUBJECT_FIELDS: Readonly<Record<AffinitySubjectKind, readonly string[]>> = {
  AFFINITY_ALIGNMENT: ["kind", "subjectKey", "composition"],
  SPELL_AFFINITY_COST: ["kind", "subjectKey", "composition", "costTarget", "baseCost"],
  AFFINITY_AUTHORITY: ["kind", "subjectKey", "composition", "accessGrants"],
  AFFINITY_ACCESS: ["kind", "subjectKey", "requirements", "composition"],
};
const SUBJECT_REQUIRED: Readonly<Record<AffinitySubjectKind, readonly string[]>> = {
  AFFINITY_ALIGNMENT: ["kind", "subjectKey", "composition"],
  SPELL_AFFINITY_COST: ["kind", "subjectKey", "composition", "costTarget", "baseCost"],
  AFFINITY_AUTHORITY: ["kind", "subjectKey", "composition"],
  AFFINITY_ACCESS: ["kind", "subjectKey", "requirements"],
};

/** Plan-local names. Fixed labels — never derived from an Affinity identity. */
const GOVERNING = "affinity";
const RANK_RULE = "affinity.rank_rule";
const WEAKNESS_TARGET = "affinity.weakness_percent";
const COST_TARGET_KEYS: Readonly<Record<AffinityCostTarget, string>> = { LISTED_MP_COST: "spell.listed_mp_cost" };
const STRENGTH_MODIFIER = "affinity.strength_discount";
const WEAKNESS_MODIFIER = "affinity.weakness_penalty";
const GRANTS_FACT = "affinity.access_grants";
const EFFECT_COUNT_FACT = "ability.effect_count";
const TRAIT_COUNT_FACT = "ability.trait_count";
/** The neutral start of Weakness selection: no Weakness matched → 0% (the M4 MAX modifiers raise it). */
const NO_WEAKNESS_PERCENT = 0;
const rankFactKey = (affinity: ProwessDefinitionRef) => `affinity_rank.${affinity.canonicalKey}`;
/** M4 Keyword contribution source types (context-key grammar), one per Ability component contract. Fixed labels. */
const CONTRIBUTION_SOURCE_TYPES: Readonly<Record<AbilityComponentContract, string>> = {
  TARGETING: "prowess.targeting",
  EFFECT: "prowess.effect",
  TRAIT: "prowess.trait",
  DURATION: "prowess.duration",
  ABILITY_CONDITION: "prowess.ability_condition",
  FOUNDATION: "prowess.foundation",
};
const emptyFacts = (): JsonObject => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: null, keywords: null });
const fromFragment = (target: string, fragmentKey: string, pointer: string): CompilationFragmentBinding => ({ target, source: { kind: "FRAGMENT", fragmentKey, pointer } });
const provenanceJson = (p: RuleProvenance): JsonObject => ({ ...p }) as unknown as JsonObject;

function readSubject(value: unknown, p: Problems): (AffinityCompilationSubject & Record<string, unknown>) | null {
  if (!isPlainObject(value)) {
    p.add(X.INVALID_REQUEST, ["subject"], `subject is { kind: ${AFFINITY_SUBJECT_KINDS.join(" | ")}, subjectKey, … }`);
    return null;
  }
  const kind = readEnum(own(value, "kind"), AFFINITY_SUBJECT_KINDS, ["subject", "kind"], p, X.INVALID_REQUEST, "Affinity subject kind");
  if (kind === null) return null;
  const r = readRecord(value, ["subject"], p, X.INVALID_REQUEST, SUBJECT_FIELDS[kind], SUBJECT_REQUIRED[kind]);
  if (r === null) return null;
  if (!isExactLabel(own(r, "subjectKey"))) p.add(X.INVALID_REQUEST, ["subject", "subjectKey"], "subjectKey is an exact label");
  return r as unknown as AffinityCompilationSubject & Record<string, unknown>;
}

/** Shared compilation state: the fragments emitted so far and the subject's components → exact Definitions. */
class AffinityEmitter {
  readonly fragments: CompilationFragment[] = [];
  readonly components = new Map<string, ProwessDefinitionRef[]>();
  constructor(readonly index: AffinityDefinitionIndex, readonly catalog: KeywordCatalog, readonly p: Problems) {
    this.components.set(RANK_RULE, [index.rankRule.ref]);
  }

  emit(fragment: CompilationFragment): string {
    this.fragments.push(fragment);
    return fragment.fragmentKey;
  }

  /** The exact KEYWORD_PRESENT predicate for a canonical key — by KeywordDefinition id, never by text (§68, §123). */
  keywordPresent(canonicalKey: string, provenance: RuleProvenance, at: readonly (string | number)[]): JsonObject | null {
    const ref = keywordReference(this.catalog, canonicalKey);
    if (ref === null) {
      this.p.add(A.UNKNOWN_KEYWORD, at, `${canonicalKey} has no exact M1 Keyword reference in the supplied catalog; Keywords are never matched by text`);
      return null;
    }
    return { kind: "KEYWORD_PRESENT", keywordId: ref.keywordId, provenance: provenanceJson(provenance) };
  }

  /** ANY exact Keyword of one rule (§148): a structural grouping — never a new Effect category (§149). */
  ruleCondition(matchAny: readonly string[], provenance: RuleProvenance, at: readonly (string | number)[]): JsonObject | null {
    const children = matchAny.map((k) => this.keywordPresent(k, provenance, at));
    return children.some((c) => c === null) ? null : { kind: "ANY", children: children as JsonObject[], provenance: provenanceJson(provenance) };
  }

  /**
   * The explicit Keyword contributions of a set of component uses (§61–§66). Each contribution keeps its exact source:
   * the component key, its exact Definition version and that Definition's M4 rule provenance. Keywords come ONLY from
   * the Definition's authored `keywords` — never from a display name, a semantic shape or targeting geometry (§64).
   */
  contributions(composition: AbilityComposition, bundle: ProwessDefinitionBundle, include: (componentKey: string) => boolean): { contributors: AffinityKeywordContributor[]; json: JsonObject[] } {
    const contributors: AffinityKeywordContributor[] = [];
    const json: JsonObject[] = [];
    compositionComponents(composition).forEach((c, ordinal) => {
      if (c.slot === "affinity" || !include(c.use.componentKey)) return;
      const envelope = findBundleDefinition(bundle, c.use.definition);
      const contract = PROWESS_DEFINITION_KINDS[c.use.definition.definitionKind].contract;
      if (envelope === null || contract === null) return; // validated by the composition reader against this bundle
      const keywords = (envelope.payload as { keywords?: readonly string[] }).keywords ?? [];
      this.components.set(c.use.componentKey, [c.use.definition]);
      contributors.push({ componentKey: c.use.componentKey, contract, definition: c.use.definition, keywords: [...keywords] });
      const provenance: RuleProvenance = {
        entityId: envelope.entityId,
        entityVersionId: envelope.entityVersionId,
        canonicalKey: envelope.canonicalKey,
        rulesetId: bundle.rulesetProvenance.rulesetId,
        manifestId: bundle.rulesetProvenance.manifestId,
      } as RuleProvenance;
      for (const k of keywords) {
        const ref = keywordReference(this.catalog, k);
        if (ref === null) {
          this.p.add(A.UNKNOWN_KEYWORD, ["subject", "composition", c.use.componentKey], `${k} (contributed by ${envelope.canonicalKey}) has no exact M1 Keyword reference in the supplied catalog`);
          continue;
        }
        json.push({
          keyword: { keywordId: ref.keywordId, canonicalKey: ref.canonicalKey, categoryId: ref.categoryId },
          source: { sourceType: CONTRIBUTION_SOURCE_TYPES[contract], sourceKey: c.use.componentKey, sourceId: envelope.entityVersionId, provenance: provenanceJson(provenance) },
          ordinal,
        });
      }
    });
    return { contributors, json };
  }

  keywordStep(fragmentKey: string, order: number, role: string, contributors: readonly AffinityKeywordContributor[], json: readonly JsonObject[], extraComponents: readonly string[]): string {
    const componentKeys = [...extraComponents, ...contributors.map((c) => c.componentKey)];
    return this.emit({ fragmentKey, order, operation: "KEYWORD", input: { contributions: [...json] }, bindings: [], role, componentKeys, definitions: contributors.map((c) => c.definition) });
  }
}

interface Governing {
  readonly entry: AffinityEntry;
  readonly owned: OwnedAffinity;
}

/** The composition's explicit Affinity — required, exact, executable and OWNED by this exact profile (§80–§85, §135–§139). */
function governingOf(composition: AbilityComposition, index: AffinityDefinitionIndex, profile: CharacterAffinityProfile, p: Problems): Governing | null {
  if (composition.affinity === null) {
    p.add(A.GOVERNING_AFFINITY_REQUIRED, ["subject", "composition", "affinity"], "executable Affinity evaluation needs one explicit governing Affinity; none is ever auto-selected (Primary, highest rank, first match or newest)");
    return null;
  }
  const ref = composition.affinity.definition;
  const entry = findAffinityEntry(index, ref);
  if (entry === null) {
    p.add(A.AFFINITY_NOT_EXECUTABLE, ["subject", "composition", "affinity"], "the governing Affinity must be an executable (payload version 2) AFFINITY Definition of this exact Ruleset");
    return null;
  }
  const owned = ownedAffinity(profile, ref);
  if (owned === null) {
    p.add(A.GOVERNING_AFFINITY_NOT_OWNED, ["subject", "composition", "affinity"], "the governing Affinity must be the character's exact owned Affinity Version; its rank always comes from the profile");
    return null;
  }
  return { entry, owned };
}

/** Strength and Weakness REQUIREMENT steps over the Ability's resolved Keyword set (§86, §90, §151–§152). */
function emitRules(e: AffinityEmitter, g: Governing, keywords: string) {
  const strengths: { rule: AffinityStrengthRule; fragmentKey: string; condition: JsonObject }[] = [];
  const weaknesses: { rule: AffinityWeaknessRule; fragmentKey: string; condition: JsonObject }[] = [];
  const binding = [fromFragment("/facts/keywords", keywords, "/data")];
  g.entry.payload.strengths.forEach((rule, i) => {
    const condition = e.ruleCondition(rule.matchAny, g.entry.provenance, ["definitions", "strengths", i]);
    if (condition === null) return;
    const fragmentKey = `strength.${rule.strengthKey}`;
    e.emit({ fragmentKey, order: AFFINITY_ORDER.STRENGTHS, operation: "REQUIREMENT", input: { requirement: condition, facts: emptyFacts() }, bindings: binding, role: "affinity-strength-match", componentKeys: [GOVERNING], definitions: [g.entry.ref] });
    strengths.push({ rule, fragmentKey, condition });
  });
  g.entry.payload.weaknesses.forEach((rule, i) => {
    const condition = e.ruleCondition(rule.matchAny, g.entry.provenance, ["definitions", "weaknesses", i]);
    if (condition === null) return;
    const fragmentKey = `weakness.${rule.weaknessKey}`;
    e.emit({ fragmentKey, order: AFFINITY_ORDER.WEAKNESSES, operation: "REQUIREMENT", input: { requirement: condition, facts: emptyFacts() }, bindings: binding, role: "affinity-weakness-match", componentKeys: [GOVERNING], definitions: [g.entry.ref] });
    weaknesses.push({ rule, fragmentKey, condition });
  });
  return { strengths, weaknesses };
}

function readComposition(value: unknown, bundle: ProwessDefinitionBundle, p: Problems): AbilityComposition | null {
  const out = validateAbilityComposition(value, { bundle });
  if (!out.ok) {
    for (const problem of out.problems) p.list.push({ ...problem, path: `/subject/composition${problem.path}` });
    return null;
  }
  return out.value;
}

/** Compiles one Affinity subject into an M4 EvaluationPlan. Pure, deterministic; never mutates or retains its inputs. */
export function compileAffinity(request: unknown): ProwessOutcome<ProwessAffinityCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, X.INVALID_REQUEST, REQUEST_FIELDS, REQUEST_FIELDS);
  if (r === null) return finish(p, () => null as never);
  const contractVersion = own(r, "contractVersion");
  if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) {
    p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], `supported Prowess compilation contract versions: ${SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.join(", ")}`);
  }
  const subject = readSubject(own(r, "subject"), p);
  // The bundle is re-validated against the exact RulesetContext (the WO2 / WO3 rule): never trusted as supplied.
  const ruleset = createRulesetContext(own(r, "ruleset"));
  const rawBundle = own(r, "definitions");
  let bundle: ProwessDefinitionBundle | null = null;
  if (!ruleset.ok) p.add(X.INVALID_REQUEST, ["ruleset"], "an exact, valid M4 RulesetContext is required");
  else if (!isPlainObject(rawBundle)) p.add(X.INVALID_REQUEST, ["definitions"], "definitions is the exact ProwessDefinitionBundle of the request's RulesetContext");
  else {
    const rebuilt = createProwessDefinitionBundle({ ruleset: own(r, "ruleset"), definitions: own(rawBundle, "definitions") ?? null });
    if (!rebuilt.ok) for (const problem of rebuilt.problems) p.list.push({ ...problem, path: `/definitions${problem.path}` });
    else if (!bundleMatchesRuleset({ rulesetProvenance: own(rawBundle, "rulesetProvenance") as ProwessRulesetProvenance, definitions: [] }, ruleset.value)) {
      p.add(X.BUNDLE_RULESET_MISMATCH, ["definitions", "rulesetProvenance"], "the Definition bundle was materialized for a different exact Ruleset; Rulesets are never mixed");
    } else bundle = rebuilt.value;
  }
  const catalog = readKeywordCatalog(own(r, "keywords"), ["keywords"], p);
  if (p.count > 0 || subject === null || catalog === null || bundle === null) return finish(p, () => null as never);
  const indexed = indexAffinityDefinitions(bundle);
  if (!indexed.ok) return indexed as ProwessOutcome<never>;
  const index = indexed.value;
  const profileOutcome = validateAffinityProfile(own(r, "profile"), bundle, index);
  if (!profileOutcome.ok) {
    for (const problem of profileOutcome.problems) p.list.push({ ...problem, path: `/profile${problem.path}` });
    return finish(p, () => null as never);
  }
  const profile = profileOutcome.value;
  const e = new AffinityEmitter(index, catalog, p);
  const subjectKey = own(subject, "subjectKey") as string;
  let composition: AbilityComposition | null = null;
  const outputs: { -readonly [K in keyof AffinityCompiledOutputs]: AffinityCompiledOutputs[K] } = {
    governing: null,
    keywords: null,
    contributors: [],
    strengths: [],
    weaknesses: [],
    weaknessSelection: null,
    cost: null,
    authority: null,
    access: [],
  };
  const governingOutput = (g: Governing) => ({ affinity: g.entry.ref, identity: g.entry.affinity, rank: g.owned.rank, role: g.owned.role, rankRule: index.rankRule.ref });

  switch (subject.kind) {
    case "AFFINITY_ALIGNMENT":
    case "SPELL_AFFINITY_COST": {
      composition = readComposition(own(subject, "composition"), bundle, p);
      if (composition === null) break;
      if (subject.kind === "SPELL_AFFINITY_COST" && composition.abilityKind !== "SPELL") {
        // Spell MP Affinity economics never apply to a Maneuver's AP or other costs (§8, §121, M5-I144). Maneuvers
        // still use AFFINITY_ALIGNMENT and AFFINITY_ACCESS; their cost application is the later Maneuver cost WO.
        p.add(A.SPELL_AFFINITY_COST_SPELL_ONLY, ["subject", "composition", "abilityKind"], "the Spell MP Affinity fragment applies to SPELL compositions only; a Maneuver using an Affinity stays a Maneuver (M5-I039)");
        break;
      }
      const g = governingOf(composition, index, profile, p);
      if (g === null) break;
      e.components.set(GOVERNING, [g.entry.ref]);
      const { contributors, json } = e.contributions(composition, bundle, () => true);
      if (p.count > 0) break;
      const keywords = e.keywordStep("keywords", AFFINITY_ORDER.KEYWORDS, "ability-keywords", contributors, json, [GOVERNING]);
      const rules = emitRules(e, g, keywords);
      if (p.count > 0) break;
      outputs.governing = governingOutput(g);
      outputs.contributors = contributors;
      outputs.strengths = rules.strengths.map((s) => ({ ruleKey: s.rule.strengthKey, matchAny: s.rule.matchAny, stepKey: s.fragmentKey }));
      outputs.weaknesses = rules.weaknesses.map((w) => ({ ruleKey: w.rule.weaknessKey, matchAny: w.rule.matchAny, activationPenaltyPercent: w.rule.activationPenaltyPercent, severity: w.rule.severity, stepKey: w.fragmentKey }));
      outputs.keywords = keywords;
      if (subject.kind === "AFFINITY_ALIGNMENT") break;

      // ---- SPELL_AFFINITY_COST ------------------------------------------------------------------------------------
      const costTarget = readEnum(own(subject, "costTarget"), AFFINITY_COST_TARGETS, ["subject", "costTarget"], p, X.INVALID_REQUEST, "Affinity cost target");
      const baseCost = own(subject, "baseCost");
      if (typeof baseCost !== "number" || !Number.isFinite(baseCost) || baseCost < 0) p.add(X.INVALID_REQUEST, ["subject", "baseCost"], "baseCost is the finite, non-negative constructed cost (never rounded here)");
      if (p.count > 0 || costTarget === null) break;
      const factsBinding = (target: string) => fromFragment(target, keywords, "/data");
      const facts = { ...emptyFacts() };

      // Highest matched Weakness — selected by M4: one MAX per Weakness rule, each conditioned on its own exact Keywords
      // (§91, §126, §130). The compiler never compares or pre-selects a percentage.
      let selection: string | null = null;
      if (rules.weaknesses.length > 0) {
        selection = e.emit({
          fragmentKey: "weakness-selection",
          order: AFFINITY_ORDER.WEAKNESS_SELECTION,
          operation: "MODIFIER",
          input: {
            request: {
              targets: [{ targetKey: WEAKNESS_TARGET, kind: "NUMERIC", value: NO_WEAKNESS_PERCENT }],
              modifiers: rules.weaknesses.map((w) => ({
                modifierKey: `weakness.${w.rule.weaknessKey}`,
                targetKey: WEAKNESS_TARGET,
                operation: "MAX",
                operand: w.rule.activationPenaltyPercent,
                phase: { phaseKey: "affinity.weakness_selection", phaseOrder: 1 },
                priority: 0,
                order: 0,
                condition: w.condition,
                stacking: { policy: "STACK" },
                source: { sourceType: "prowess.affinity", sourceKey: g.entry.ref.canonicalKey, sourceId: g.entry.ref.entityVersionId },
                provenance: provenanceJson(g.entry.provenance),
              })),
              facts,
            },
          },
          bindings: [factsBinding("/request/facts/keywords")],
          role: "affinity-weakness-selection",
          componentKeys: [GOVERNING],
          definitions: [g.entry.ref],
        });
      }

      // The listed cost: Strength discount ONCE (phase 1) then the selected Weakness penalty ONCE (phase 2) — M4 applies
      // them sequentially, never netted (§87–§88, §94–§97). Rank discount is the exact rank-rule value (0 at NONE).
      const rank = rankEntry(index, g.owned.rank);
      const targetKey = COST_TARGET_KEYS[costTarget];
      const modifiers: JsonObject[] = [];
      const bindings: CompilationFragmentBinding[] = [factsBinding("/request/facts/keywords")];
      const strengthConditions = rules.strengths.map((s) => s.condition);
      const weaknessConditions = rules.weaknesses.map((w) => w.condition);
      if (strengthConditions.length > 0) {
        modifiers.push({
          modifierKey: STRENGTH_MODIFIER,
          targetKey,
          operation: "REDUCE_PERCENT",
          operand: rank.strengthDiscountPercent,
          phase: { phaseKey: "affinity.strength", phaseOrder: 1 },
          priority: 0,
          order: 0,
          condition: { kind: "ANY", children: strengthConditions, provenance: provenanceJson(g.entry.provenance) },
          stacking: { policy: "UNIQUE", stackingKey: STRENGTH_MODIFIER },
          source: { sourceType: "prowess.affinity_rank_rule", sourceKey: index.rankRule.ref.canonicalKey, sourceId: index.rankRule.ref.entityVersionId },
          provenance: provenanceJson(index.rankRule.provenance),
        });
      }
      if (selection !== null) {
        const weakness: JsonObject = {
          modifierKey: WEAKNESS_MODIFIER,
          targetKey,
          operation: "INCREASE_PERCENT",
          operand: NO_WEAKNESS_PERCENT, // replaced by M4's selected highest Weakness (binding below)
          phase: { phaseKey: "affinity.weakness", phaseOrder: 2 },
          priority: 0,
          order: 0,
          condition: { kind: "ANY", children: weaknessConditions, provenance: provenanceJson(g.entry.provenance) },
          stacking: { policy: "UNIQUE", stackingKey: WEAKNESS_MODIFIER },
          source: { sourceType: "prowess.affinity", sourceKey: g.entry.ref.canonicalKey, sourceId: g.entry.ref.entityVersionId },
          provenance: provenanceJson(g.entry.provenance),
        };
        modifiers.push(weakness);
        bindings.push(fromFragment(`/request/modifiers/${String(modifiers.indexOf(weakness))}/operand`, selection, "/data/finalTargets/0/value"));
      }
      const costStep = e.emit({
        fragmentKey: "cost",
        order: AFFINITY_ORDER.COST,
        operation: "MODIFIER",
        input: { request: { targets: [{ targetKey, kind: "NUMERIC", value: baseCost as number }], modifiers, facts: { ...emptyFacts() } } },
        bindings,
        role: "spell-affinity-listed-mp",
        componentKeys: [GOVERNING, RANK_RULE],
        definitions: [g.entry.ref, index.rankRule.ref],
      });
      outputs.weaknessSelection = selection;
      outputs.cost = {
        costTarget,
        targetKey,
        baseCost: baseCost as number,
        stepKey: costStep,
        strengthDiscountPercent: rank.strengthDiscountPercent,
        strengthModifierKey: strengthConditions.length > 0 ? STRENGTH_MODIFIER : null,
        weaknessModifierKey: selection !== null ? WEAKNESS_MODIFIER : null,
      };
      break;
    }

    case "AFFINITY_AUTHORITY": {
      composition = readComposition(own(subject, "composition"), bundle, p);
      if (composition === null) break;
      if (composition.abilityKind !== "SPELL") {
        p.add(A.SPELL_AFFINITY_COST_SPELL_ONLY, ["subject", "composition", "abilityKind"], "Arcane / Affinity Authority governs Spell construction; Maneuver access uses AFFINITY_ACCESS");
        break;
      }
      // Authority is explicit (§106): the composition names it. Capacities never add (§114–§115): one Authority governs.
      const authority = composition.authority === null ? undefined : own(composition.authority, "authority");
      if (authority === undefined) {
        p.add(A.AUTHORITY_REQUIRED, ["subject", "composition", "authority"], "Spell construction names one explicit Authority { authority: ARCANE_AUTHORITY | AFFINITY_AUTHORITY }; it is never inferred");
        break;
      }
      const chosen = readEnum(authority, SPELL_CONSTRUCTION_AUTHORITIES, ["subject", "composition", "authority", "authority"], p, A.AUTHORITY_REQUIRED, "Spell construction Authority");
      if (chosen === "ARCANE_AUTHORITY") p.add(A.ARCANE_AUTHORITY_NOT_IN_SCOPE, ["subject", "composition", "authority"], "Arcane Authority capacity (Arcane Rank) belongs to the later Spell Creation Work Order (§113)");
      if (chosen !== "AFFINITY_AUTHORITY") break;
      const g = governingOf(composition, index, profile, p);
      if (g === null) break;
      e.components.set(GOVERNING, [g.entry.ref]);
      const grants: { componentKey: string; sourceKey: string }[] = [];
      const rawGrants = own(subject, "accessGrants");
      if (rawGrants !== undefined) {
        if (!Array.isArray(rawGrants)) p.add(X.INVALID_REQUEST, ["subject", "accessGrants"], "accessGrants is an array of { componentKey, sourceKey }");
        else
          rawGrants.forEach((raw: unknown, i: number) => {
            const gr = readRecord(raw, ["subject", "accessGrants", i], p, X.INVALID_REQUEST, ["componentKey", "sourceKey"], ["componentKey", "sourceKey"]);
            if (gr === null) return;
            const componentKey = own(gr, "componentKey");
            const sourceKey = own(gr, "sourceKey");
            if (!(composition as AbilityComposition).effects.some((x) => x.componentKey === componentKey)) p.add(X.INVALID_REQUEST, ["subject", "accessGrants", i, "componentKey"], "an access grant names an Effect component of this composition");
            if (!isExactCanonicalKey(sourceKey)) p.add(X.INVALID_REQUEST, ["subject", "accessGrants", i, "sourceKey"], "sourceKey is the exact canonical key of the access rule");
            if (typeof componentKey === "string" && isExactCanonicalKey(sourceKey)) grants.push({ componentKey, sourceKey });
          });
      }
      if (p.count > 0) break;
      const rank = rankEntry(index, g.owned.rank);
      const floor = rankEntry(index, index.rankRule.payload.authorityMinimumRank);
      const rankFact = { key: rankFactKey(g.entry.ref), rankKey: g.owned.rank, order: rank.order, provenance: provenanceJson(index.rankRule.provenance) };
      const rankStep = e.emit({
        fragmentKey: "authority.rank",
        order: AFFINITY_ORDER.AUTHORITY,
        operation: "REQUIREMENT",
        input: {
          requirement: { kind: "RANK_AT_LEAST", factKey: rankFact.key, requiredRankKey: floor.rank, requiredOrder: floor.order, provenance: provenanceJson(index.rankRule.provenance) },
          facts: { ...emptyFacts(), ranks: [rankFact] },
        },
        bindings: [],
        role: "affinity-authority-rank",
        componentKeys: [GOVERNING, RANK_RULE],
        definitions: [g.entry.ref, index.rankRule.ref],
      });
      // Capacity is compared by M4 — never truncated (§193). NONE grants no capacity (§38): no capacity step exists.
      const capacityStep = (fragmentKey: string, factKey: string, count: number, capacity: number, role: string) =>
        e.emit({
          fragmentKey,
          order: AFFINITY_ORDER.AUTHORITY,
          operation: "REQUIREMENT",
          input: {
            requirement: { kind: "NUMERIC_COMPARE", factKey, operator: "<=", expected: capacity, provenance: provenanceJson(index.rankRule.provenance) },
            facts: { ...emptyFacts(), numeric: [{ key: factKey, value: count, provenance: null }] },
          },
          bindings: [],
          role,
          componentKeys: [GOVERNING, RANK_RULE],
          definitions: [g.entry.ref, index.rankRule.ref],
        });
      const effectCount = composition.effects.length;
      const traitCount = composition.traits.length;
      const effectCapacity = rank.authority === null ? null : { stepKey: capacityStep("authority.effect_capacity", EFFECT_COUNT_FACT, effectCount, rank.authority.effectCapacity, "affinity-authority-effect-capacity"), capacity: rank.authority.effectCapacity, count: effectCount };
      const traitCapacity = rank.authority === null ? null : { stepKey: capacityStep("authority.trait_capacity", TRAIT_COUNT_FACT, traitCount, rank.authority.traitCapacity, "affinity-authority-trait-capacity"), capacity: rank.authority.traitCapacity, count: traitCount };

      // Specialization (§110–§112): each Effect must fit a Strength, accept a Weakness penalty, or hold an explicit grant.
      const effectAccess: { componentKey: string; keywordStep: string; stepKey: string; granted: string | null }[] = [];
      for (const effect of composition.effects) {
        const comp = composition;
        const applies = (key: string) => key === effect.componentKey || comp.traits.some((t) => t.componentKey === key && t.appliesTo.componentKey === effect.componentKey);
        const { contributors, json } = e.contributions(composition, bundle, applies);
        const keywordStep = e.keywordStep(`effect_keywords.${effect.componentKey}`, AFFINITY_ORDER.EFFECT_KEYWORDS, "effect-keywords", contributors, json, [GOVERNING]);
        const children: JsonObject[] = [];
        g.entry.payload.strengths.forEach((s, i) => {
          const c = e.ruleCondition(s.matchAny, g.entry.provenance, ["definitions", "strengths", i]);
          if (c !== null) children.push(c);
        });
        g.entry.payload.weaknesses.forEach((w, i) => {
          const c = e.ruleCondition(w.matchAny, g.entry.provenance, ["definitions", "weaknesses", i]);
          if (c !== null) children.push(c);
        });
        children.push({ kind: "SET_CONTAINS", factKey: GRANTS_FACT, member: effect.componentKey, provenance: null });
        const grant = grants.find((x) => x.componentKey === effect.componentKey) ?? null;
        const stepKey = e.emit({
          fragmentKey: `effect_access.${effect.componentKey}`,
          order: AFFINITY_ORDER.EFFECT_ACCESS,
          operation: "REQUIREMENT",
          input: {
            requirement: { kind: "ANY", children, provenance: provenanceJson(g.entry.provenance) },
            facts: { ...emptyFacts(), sets: [{ key: GRANTS_FACT, members: grants.map((x) => x.componentKey), provenance: null }] },
          },
          bindings: [fromFragment("/facts/keywords", keywordStep, "/data")],
          role: "affinity-authority-effect-access",
          componentKeys: [GOVERNING, ...contributors.map((c) => c.componentKey)],
          definitions: [g.entry.ref, ...contributors.map((c) => c.definition)],
        });
        effectAccess.push({ componentKey: effect.componentKey, keywordStep, stepKey, granted: grant === null ? null : grant.sourceKey });
      }
      if (p.count > 0) break;
      outputs.governing = governingOutput(g);
      outputs.authority = { authority: chosen, minimumRank: floor.rank, rankStep, effectCapacity, traitCapacity, effectAccess };
      break;
    }

    case "AFFINITY_ACCESS": {
      const rawComposition = own(subject, "composition");
      if (rawComposition !== undefined) composition = readComposition(rawComposition, bundle, p);
      const raw = own(subject, "requirements");
      if (!Array.isArray(raw) || raw.length === 0) {
        p.add(X.INVALID_REQUEST, ["subject", "requirements"], "requirements is a non-empty array of { requirementKey, affinity, minimumRank, requiredKeywords }");
        break;
      }
      const fields = ["requirementKey", "affinity", "minimumRank", "requiredKeywords"];
      const read: { requirementKey: string; entry: AffinityEntry; minimumRank: AffinityRank; requiredKeywords: string[] }[] = [];
      raw.forEach((item: unknown, i: number) => {
        const at = ["subject", "requirements", i];
        const q = readRecord(item, at, p, X.INVALID_REQUEST, fields, fields);
        if (q === null) return;
        const before = p.count;
        const requirementKey = own(q, "requirementKey");
        if (!isToken(requirementKey) || read.some((x) => x.requirementKey === requirementKey)) p.add(X.INVALID_REQUEST, [...at, "requirementKey"], "requirementKey is a unique SCREAMING_SNAKE token");
        const ref = readDefinitionRef(own(q, "affinity"), [...at, "affinity"], p, X.INVALID_REQUEST);
        const minimumRank = readEnum(own(q, "minimumRank"), AFFINITY_RANKS, [...at, "minimumRank"], p, X.INVALID_REQUEST, "Affinity Rank");
        const rk = own(q, "requiredKeywords");
        if (!Array.isArray(rk) || !rk.every((k: unknown) => isExactCanonicalKey(k)) || new Set(rk).size !== rk.length) p.add(X.INVALID_REQUEST, [...at, "requiredKeywords"], "requiredKeywords is a duplicate-free array of exact Keyword canonical keys");
        if (Array.isArray(rk) && rk.length > 0 && rawComposition === undefined) p.add(X.INVALID_REQUEST, [...at, "requiredKeywords"], "a Keyword prerequisite is checked against an explicit composition");
        const entry = ref === null ? null : findAffinityEntry(index, ref);
        if (ref !== null && entry === null) p.add(A.AFFINITY_NOT_EXECUTABLE, [...at, "affinity"], "an Affinity prerequisite names an exact executable AFFINITY Definition of this Ruleset");
        if (p.count > before || entry === null || minimumRank === null || !isToken(requirementKey)) return;
        read.push({ requirementKey, entry, minimumRank, requiredKeywords: [...(rk as string[])] });
      });
      if (p.count > 0 || (rawComposition !== undefined && composition === null)) break;
      let keywordStep: string | null = null;
      if (composition !== null) {
        const { contributors, json } = e.contributions(composition, bundle, () => true);
        if (p.count > 0) break;
        keywordStep = e.keywordStep("keywords", AFFINITY_ORDER.KEYWORDS, "ability-keywords", contributors, json, [RANK_RULE]);
        outputs.contributors = contributors;
        outputs.keywords = keywordStep;
      }
      const ownedIds = profile.affinities.map((a) => a.affinity.entityId);
      for (const q of read) {
        const componentKey = `access.${q.requirementKey}`;
        e.components.set(componentKey, [q.entry.ref]);
        const required = rankEntry(index, q.minimumRank);
        const owned = ownedAffinity(profile, q.entry.ref);
        const prov = provenanceJson(q.entry.provenance);
        // Ownership, rank and Keywords — each an M4 predicate (§122). An unowned Affinity has no rank fact, so its
        // Requirement asks M4 the ownership question (which M4 answers "not satisfied" — never an engine error, §196).
        const children: JsonObject[] = [{ kind: "ENTITY_OWNED", entityId: q.entry.ref.entityId, provenance: prov }];
        if (owned !== null) children.push({ kind: "RANK_AT_LEAST", factKey: rankFactKey(q.entry.ref), requiredRankKey: required.rank, requiredOrder: required.order, provenance: provenanceJson(index.rankRule.provenance) });
        for (const k of q.requiredKeywords) {
          const node = e.keywordPresent(k, q.entry.provenance, ["subject", "requirements"]);
          if (node !== null) children.push(node);
        }
        const ranks = owned === null ? [] : [{ key: rankFactKey(q.entry.ref), rankKey: owned.rank, order: rankEntry(index, owned.rank).order, provenance: provenanceJson(index.rankRule.provenance) }];
        const stepKey = e.emit({
          fragmentKey: componentKey,
          order: AFFINITY_ORDER.ACCESS,
          operation: "REQUIREMENT",
          input: { requirement: { kind: "ALL", children, provenance: prov }, facts: { ...emptyFacts(), ranks, ownedEntityIds: ownedIds } },
          bindings: q.requiredKeywords.length > 0 && keywordStep !== null ? [fromFragment("/facts/keywords", keywordStep, "/data")] : [],
          role: "affinity-access-requirement",
          componentKeys: [componentKey, RANK_RULE],
          definitions: [q.entry.ref, index.rankRule.ref],
        });
        outputs.access = [...outputs.access, { requirementKey: q.requirementKey, affinity: q.entry.ref, minimumRank: q.minimumRank, requiredKeywords: q.requiredKeywords, stepKey }];
      }
      break;
    }
  }
  if (p.count > 0) return finish(p, () => null as never);

  const assembled = assembleFragments({ subjectKind: subject.kind, subjectKey, components: e.components, bundle, fragments: e.fragments }, p);
  const stepKeyOf = (fragmentKey: string) => compiledStepKey(subject.kind, subjectKey, fragmentKey);
  const o = outputs;
  return finish(p, () =>
    deepFreeze({
      contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
      subject: { kind: subject.kind, subjectKey, abilityKind: composition === null ? null : composition.abilityKind, compositionKey: composition === null ? null : composition.compositionKey },
      rulesetProvenance: bundle.rulesetProvenance,
      evaluationPlan: { steps: assembled.steps, primaryStepKey: o.cost !== null ? stepKeyOf(o.cost.stepKey) : null, validationStepKey: null, explanationStepKey: null },
      sourceMap: { entries: assembled.entries },
      outputs: {
        governing: o.governing,
        keywords: o.keywords === null ? null : stepKeyOf(o.keywords),
        contributors: o.contributors,
        strengths: o.strengths.map((s) => ({ ...s, stepKey: stepKeyOf(s.stepKey) })),
        weaknesses: o.weaknesses.map((w) => ({ ...w, stepKey: stepKeyOf(w.stepKey) })),
        weaknessSelection: o.weaknessSelection === null ? null : stepKeyOf(o.weaknessSelection),
        cost: o.cost === null ? null : { ...o.cost, stepKey: stepKeyOf(o.cost.stepKey) },
        authority:
          o.authority === null
            ? null
            : {
                ...o.authority,
                rankStep: stepKeyOf(o.authority.rankStep),
                effectCapacity: o.authority.effectCapacity === null ? null : { ...o.authority.effectCapacity, stepKey: stepKeyOf(o.authority.effectCapacity.stepKey) },
                traitCapacity: o.authority.traitCapacity === null ? null : { ...o.authority.traitCapacity, stepKey: stepKeyOf(o.authority.traitCapacity.stepKey) },
                effectAccess: o.authority.effectAccess.map((x) => ({ ...x, keywordStep: stepKeyOf(x.keywordStep), stepKey: stepKeyOf(x.stepKey) })),
              },
        access: o.access.map((x) => ({ ...x, stepKey: stepKeyOf(x.stepKey) })),
      },
    }),
  );
}
