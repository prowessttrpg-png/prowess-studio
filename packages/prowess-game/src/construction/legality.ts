import type { JsonObject } from "@prowess/model";
import {
  createRulesetContext,
  type EvaluationPlan,
  type EvaluationStep,
  type RuleEngineResponse,
  type RuleProvenance,
  type RulesetContext,
  type EvaluationRun,
} from "@prowess/rules";
import { createProwessDefinitionBundle, bundleMatchesRuleset, findBundleDefinition, type ProwessDefinitionBundle, type ProwessRulesetProvenance } from "../bundle/bundle.js";
import { assembleFragments, compiledStepKey, type SubjectComponents } from "../compilation/assemble.js";
import type { CompilationFragment, ProwessCompilationSourceMap } from "../compilation/model.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION, SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS, type ProwessCompilationContractVersion } from "../contract-version.js";
import { validateAbilityComposition, compositionComponents, type AbilityComposition, type OrderedComponentUse } from "./composition.js";
import { ABILITY_CONSTRUCTION_ERROR_CODES as A, COMPILATION_ERROR_CODES as X, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import { indexAffinityDefinitions, findAffinityEntry, keywordReference, rankEntry as affinityRankEntry, readKeywordCatalog, type AffinityDefinitionIndex, type KeywordCatalog } from "../affinity/definitions.js";
import { ownedAffinity, validateAffinityProfile, type CharacterAffinityProfile } from "../affinity/profile.js";
import type { AffinityRank } from "../vocabulary/affinity.js";
import { SPELL_CONSTRUCTION_AUTHORITIES, type SpellConstructionAuthority } from "../vocabulary/affinity.js";
import { SKILL_RANK_LADDER_KEY } from "../vocabulary/core.js";
import {
  ABILITY_CONSTRUCTION_CAPACITY_BY_RANK,
  ABILITY_CONSTRUCTION_SKILL_RANKS,
  ARCANA_SKILL_KEY,
  MARTIAL_SKILL_KEY,
  type AbilityConstructionSkillRank,
} from "../vocabulary/ability-construction.js";
import { PROWESS_DEFINITION_KINDS } from "../vocabulary/families.js";
import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import {
  Problems,
  checkPlainData,
  finish,
  isExactCanonicalKey,
  isExactLabel,
  own,
  readEnum,
  readRecord,
  readSafeInteger,
  type ProwessOutcome,
} from "../internal/problems.js";

/**
 * M5-WO5 — Shared Modular Ability Construction Framework.
 *
 * This compiler answers construction LEGALITY only: access, capacity, explicit stack limits and Signature-slot use.
 * It never calculates Spell/Maneuver costs, targeting geometry, Effect outcomes or runtime resolution. Every numeric
 * comparison and every capacity transformation is emitted as an M4 FORMULA / REQUIREMENT operation. @prowess/game
 * chooses the authored Prowess rule and wires exact inputs; M4 does the arithmetic and comparison.
 */

export interface AbilityConstructionSkillState {
  readonly skillKey: string;
  readonly rank: AbilityConstructionSkillRank;
}

export interface CharacterAbilityConstructionProfile {
  /** Current Prowess Score; Signature Ability capacity equals this score. */
  readonly prowess: number;
  /** Number of Signature Ability slots already occupied before the candidate Ability is added. */
  readonly signatureSlotsUsed: number;
  /** Exact Skill ranks. Arcane Rank is `skill.arcana`; Martial Rank is `skill.martial`. */
  readonly skills: readonly AbilityConstructionSkillState[];
  /** Exact WO4 Affinity profile, or null for a character with no usable Affinity profile. */
  readonly affinityProfile: CharacterAffinityProfile | null;
}

export interface AbilityConstructionSignaturePolicy {
  /** Null means the normal player-created/known Ability consumes exactly one slot. */
  readonly exemption: { readonly sourceKey: string } | null;
}

export interface AbilityConstructionAccessGrant {
  /** Exact componentKey of this composition. */
  readonly componentKey: string;
  /** Exact canonical key of the authored rule granting otherwise-neutral Affinity Authority access. */
  readonly sourceKey: string;
}

export interface AbilityConstructionSubject {
  readonly kind: "ABILITY_CONSTRUCTION";
  readonly subjectKey: string;
  readonly composition: AbilityComposition;
  readonly character: CharacterAbilityConstructionProfile;
  readonly signature: AbilityConstructionSignaturePolicy;
  readonly accessGrants: readonly AbilityConstructionAccessGrant[];
}

export interface AbilityConstructionCompilationRequest {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: AbilityConstructionSubject;
  readonly definitions: ProwessDefinitionBundle;
  readonly ruleset: RulesetContext;
  /** Exact M1 Keyword references. Required when Affinity Authority evaluates component access. */
  readonly keywords: readonly { readonly keywordId: string; readonly canonicalKey: string; readonly categoryId: string | null }[];
}

export interface AbilityConstructionCapacityOutput {
  readonly authority: SpellConstructionAuthority | "MARTIAL";
  readonly authorityRank: AbilityConstructionSkillRank | AffinityRank;
  readonly baseEffectCapacity: number;
  readonly baseTraitCapacity: number;
  readonly traitTrades: number;
  readonly effectSlotsUsed: number;
  readonly traitSlotsUsed: number;
  readonly conditionSlotsUsed: number;
  readonly castingConditionCapacity: number;
  readonly maneuverConditionCapacity: number | null;
  readonly effectiveEffectCapacityStepKey: string | null;
  readonly effectiveTraitCapacityStepKey: string | null;
}

export interface AbilityConstructionStackGroup {
  readonly definition: ProwessDefinitionRef;
  readonly componentKeys: readonly string[];
  readonly stackable: boolean;
  readonly slotCount: number;
  readonly limit: number | null;
  readonly requirementStepKey: string | null;
}

export interface AbilityConstructionCompiledOutputs {
  readonly authorityStepKey: string;
  readonly minimumEffectStepKey: string;
  readonly effectCapacityStepKey: string;
  readonly traitCapacityStepKey: string;
  readonly conditionCapacityStepKey: string;
  readonly signatureStepKey: string;
  readonly requirementStepKeys: readonly string[];
  readonly capacity: AbilityConstructionCapacityOutput;
  readonly stackGroups: readonly AbilityConstructionStackGroup[];
  readonly componentRequirementStepKeys: readonly { readonly componentKey: string; readonly stepKey: string }[];
  readonly affinityAccessStepKeys: readonly { readonly componentKey: string; readonly keywordStepKey: string; readonly requirementStepKey: string }[];
  readonly signatureSlotUse: 0 | 1;
}

export interface ProwessAbilityConstructionCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: { readonly kind: "ABILITY_CONSTRUCTION"; readonly subjectKey: string; readonly abilityKind: AbilityComposition["abilityKind"]; readonly compositionKey: string };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly outputs: AbilityConstructionCompiledOutputs;
}

export interface AbilityConstructionRequirementReading {
  readonly stepKey: string;
  readonly satisfied: boolean;
}

export interface AbilityConstructionRunReading {
  readonly legal: boolean;
  readonly requirements: readonly AbilityConstructionRequirementReading[];
}

const REQUEST_FIELDS = ["contractVersion", "subject", "definitions", "ruleset", "keywords"];
const SUBJECT_FIELDS = ["kind", "subjectKey", "composition", "character", "signature", "accessGrants"];
const PROFILE_FIELDS = ["prowess", "signatureSlotsUsed", "skills", "affinityProfile"];
const SKILL_FIELDS = ["skillKey", "rank"];
const SIGNATURE_FIELDS = ["exemption"];
const EXEMPTION_FIELDS = ["sourceKey"];
const GRANT_FIELDS = ["componentKey", "sourceKey"];
const AUTHORITY_FIELDS = ["authority", "traitTrades"];

const CONSTRUCTION_RULE = "construction.rule";
const GOVERNING_AFFINITY = "construction.governing_affinity";
const AFFINITY_RANK_RULE = "construction.affinity_rank_rule";
const GRANTS_FACT = "construction.affinity_access_grants";

const ORDER = deepFreeze({
  FORMULA: 100,
  ACCESS: 200,
  COMPONENT_REQUIREMENT: 300,
  CAPACITY: 400,
  STACK: 500,
  SIGNATURE: 600,
} as const);

const EMPTY_FACTS = () => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: [], keywords: null });

function provenanceOf(bundle: ProwessDefinitionBundle, envelope: ProwessDefinitionEnvelope): RuleProvenance {
  return {
    entityId: envelope.entityId,
    entityVersionId: envelope.entityVersionId,
    canonicalKey: envelope.canonicalKey,
    rulesetId: bundle.rulesetProvenance.rulesetId,
    manifestId: bundle.rulesetProvenance.manifestId,
  } as RuleProvenance;
}

function provenanceJson(provenance: RuleProvenance): JsonObject {
  return clonePlainData(provenance) as unknown as JsonObject;
}

function skillRank(profile: CharacterAbilityConstructionProfile, skillKey: string): AbilityConstructionSkillRank {
  return profile.skills.find((s) => s.skillKey === skillKey)?.rank ?? "UNTRAINED";
}

function rankOrder(ladder: ProwessDefinitionEnvelope, rank: AbilityConstructionSkillRank): number {
  const ranks = (ladder.payload as { ranks: readonly { rankKey: string; order: number }[] }).ranks;
  return ranks.find((r) => r.rankKey === rank)?.order ?? -1;
}

function rankFactFor(ladder: ProwessDefinitionEnvelope, profile: CharacterAbilityConstructionProfile, skillKey: string) {
  const rank = skillRank(profile, skillKey);
  return { key: `skill-rank:${skillKey}`, rankKey: rank, order: rankOrder(ladder, rank), provenance: null };
}

function findSkillLadder(bundle: ProwessDefinitionBundle, p: Problems): ProwessDefinitionEnvelope | null {
  const found = bundle.definitions.filter(
    (d) => d.definitionKind === "RANK_LADDER" && (d.payload as { ladderKey?: unknown }).ladderKey === SKILL_RANK_LADDER_KEY,
  );
  if (found.length !== 1) {
    p.add(A.INVALID_REQUEST, ["definitions"], `Ability Construction requires exactly one ${SKILL_RANK_LADDER_KEY} RANK_LADDER Definition (found ${found.length})`);
    return null;
  }
  const ladder = found[0] as ProwessDefinitionEnvelope;
  for (const rank of ABILITY_CONSTRUCTION_SKILL_RANKS) {
    if (rankOrder(ladder, rank) < 0) p.add(A.UNKNOWN_SKILL_RANK, ["definitions"], `the exact Skill rank ladder has no ${rank} rank`);
  }
  return ladder;
}

function readProfile(value: unknown, p: Problems): CharacterAbilityConstructionProfile | null {
  const r = readRecord(value, ["subject", "character"], p, A.INVALID_PROFILE, PROFILE_FIELDS, PROFILE_FIELDS);
  if (r === null) return null;
  const prowess = readSafeInteger(own(r, "prowess"), ["subject", "character", "prowess"], p, A.INVALID_PROFILE, "Prowess Score");
  if (prowess !== null && (prowess < 1 || prowess > 10)) p.add(A.INVALID_PROFILE, ["subject", "character", "prowess"], "Prowess Score is 1–10 unless an exact future override is supplied");
  const signatureSlotsUsed = readSafeInteger(own(r, "signatureSlotsUsed"), ["subject", "character", "signatureSlotsUsed"], p, A.INVALID_PROFILE, "signatureSlotsUsed");
  if (signatureSlotsUsed !== null && signatureSlotsUsed < 0) p.add(A.INVALID_PROFILE, ["subject", "character", "signatureSlotsUsed"], "signatureSlotsUsed cannot be negative");

  const rawSkills = own(r, "skills");
  const skills: AbilityConstructionSkillState[] = [];
  if (!Array.isArray(rawSkills)) p.add(A.INVALID_PROFILE, ["subject", "character", "skills"], "skills is an array of exact { skillKey, rank } records");
  else
    rawSkills.forEach((raw: unknown, i: number) => {
      const sr = readRecord(raw, ["subject", "character", "skills", i], p, A.INVALID_PROFILE, SKILL_FIELDS, SKILL_FIELDS);
      if (sr === null) return;
      const skillKey = own(sr, "skillKey");
      const rank = readEnum(own(sr, "rank"), ABILITY_CONSTRUCTION_SKILL_RANKS, ["subject", "character", "skills", i, "rank"], p, A.UNKNOWN_SKILL_RANK, "Skill rank");
      if (!isExactCanonicalKey(skillKey)) p.add(A.INVALID_PROFILE, ["subject", "character", "skills", i, "skillKey"], "skillKey is an exact canonical key");
      if (typeof skillKey === "string" && rank !== null) {
        const prior = skills.find((s) => s.skillKey === skillKey);
        if (prior !== undefined) p.add(A.INVALID_PROFILE, ["subject", "character", "skills", i], `skill ${skillKey} is supplied twice; one exact rank is required`);
        else skills.push({ skillKey, rank });
      }
    });
  const affinityProfile = own(r, "affinityProfile");
  if (affinityProfile !== null && !isPlainObject(affinityProfile)) p.add(A.INVALID_PROFILE, ["subject", "character", "affinityProfile"], "affinityProfile is an exact WO4 CharacterAffinityProfile or null");

  if (p.count > 0 || prowess === null || signatureSlotsUsed === null) return null;
  return { prowess, signatureSlotsUsed, skills, affinityProfile: affinityProfile as unknown as CharacterAffinityProfile | null };
}

function readSignature(value: unknown, p: Problems): AbilityConstructionSignaturePolicy | null {
  const r = readRecord(value, ["subject", "signature"], p, A.INVALID_SIGNATURE_EXEMPTION, SIGNATURE_FIELDS, SIGNATURE_FIELDS);
  if (r === null) return null;
  const raw = own(r, "exemption");
  if (raw === null) return { exemption: null };
  const er = readRecord(raw, ["subject", "signature", "exemption"], p, A.INVALID_SIGNATURE_EXEMPTION, EXEMPTION_FIELDS, EXEMPTION_FIELDS);
  if (er === null) return null;
  const sourceKey = own(er, "sourceKey");
  if (!isExactCanonicalKey(sourceKey)) {
    p.add(A.INVALID_SIGNATURE_EXEMPTION, ["subject", "signature", "exemption", "sourceKey"], "a slot exemption cites one explicit authored canonical rule key");
    return null;
  }
  return { exemption: { sourceKey } };
}

function readGrants(value: unknown, composition: AbilityComposition, p: Problems): AbilityConstructionAccessGrant[] {
  if (!Array.isArray(value)) {
    p.add(A.INVALID_REQUEST, ["subject", "accessGrants"], "accessGrants is an array");
    return [];
  }
  const keys = new Set(compositionComponents(composition).map((c) => c.use.componentKey));
  const grants: AbilityConstructionAccessGrant[] = [];
  value.forEach((raw: unknown, i: number) => {
    const r = readRecord(raw, ["subject", "accessGrants", i], p, A.INVALID_REQUEST, GRANT_FIELDS, GRANT_FIELDS);
    if (r === null) return;
    const componentKey = own(r, "componentKey");
    const sourceKey = own(r, "sourceKey");
    if (!isExactLabel(componentKey) || !keys.has(componentKey as string)) p.add(A.INVALID_REQUEST, ["subject", "accessGrants", i, "componentKey"], "grant componentKey names one exact component of this composition");
    if (!isExactCanonicalKey(sourceKey)) p.add(A.INVALID_REQUEST, ["subject", "accessGrants", i, "sourceKey"], "sourceKey is an exact authored canonical rule key");
    if (typeof componentKey === "string" && typeof sourceKey === "string" && grants.some((g) => g.componentKey === componentKey)) p.add(A.INVALID_REQUEST, ["subject", "accessGrants", i, "componentKey"], "at most one explicit access grant per component");
    if (isExactLabel(componentKey) && keys.has(componentKey) && isExactCanonicalKey(sourceKey)) grants.push({ componentKey, sourceKey });
  });
  return grants;
}

function readAuthority(composition: AbilityComposition, p: Problems): { authority: SpellConstructionAuthority; traitTrades: number } | null {
  const raw = composition.authority;
  const r = readRecord(raw, ["subject", "composition", "authority"], p, A.AUTHORITY_REQUIRED, AUTHORITY_FIELDS, ["authority"]);
  if (r === null) return null;
  const authority = readEnum(own(r, "authority"), SPELL_CONSTRUCTION_AUTHORITIES, ["subject", "composition", "authority", "authority"], p, A.INVALID_AUTHORITY, "Spell construction Authority");
  const rawTrades = own(r, "traitTrades");
  const traitTrades = rawTrades === undefined ? 0 : readSafeInteger(rawTrades, ["subject", "composition", "authority", "traitTrades"], p, A.INVALID_TRAIT_TRADE, "traitTrades");
  if (traitTrades !== null && traitTrades < 0) p.add(A.INVALID_TRAIT_TRADE, ["subject", "composition", "authority", "traitTrades"], "traitTrades cannot be negative");
  return authority === null || traitTrades === null ? null : { authority, traitTrades };
}

function affinityProfileFor(
  profile: CharacterAbilityConstructionProfile,
  bundle: ProwessDefinitionBundle,
  index: AffinityDefinitionIndex,
  p: Problems,
): CharacterAffinityProfile | null {
  if (profile.affinityProfile === null) return null;
  const out = validateAffinityProfile(profile.affinityProfile, bundle, index);
  if (!out.ok) {
    for (const problem of out.problems) p.list.push({ ...problem, path: `/subject/character/affinityProfile${problem.path}` });
    return null;
  }
  return out.value;
}

function componentEnvelope(bundle: ProwessDefinitionBundle, use: { definition: ProwessDefinitionRef }, p: Problems, at: readonly (string | number)[]): ProwessDefinitionEnvelope | null {
  const e = findBundleDefinition(bundle, use.definition);
  if (e === null) p.add(A.INVALID_REQUEST, at, "component Definition must be an exact Definition of this Ruleset bundle");
  return e;
}

function stackRule(envelope: ProwessDefinitionEnvelope, p: Problems): { stackable: boolean; limit: unknown } | null {
  const rules = (envelope.payload as { rules?: unknown }).rules;
  if (!isPlainObject(rules) || own(rules, "stacking") === undefined) return { stackable: false, limit: null };
  const stacking = readRecord(own(rules, "stacking"), ["definitions", envelope.canonicalKey, "rules", "stacking"], p, A.INVALID_STACK_RULE, ["stackable", "limit"], ["stackable", "limit"]);
  if (stacking === null) return null;
  const stackable = own(stacking, "stackable");
  if (typeof stackable !== "boolean") {
    p.add(A.INVALID_STACK_RULE, ["definitions", envelope.canonicalKey, "rules", "stacking", "stackable"], "stackable is boolean");
    return null;
  }
  const limit = own(stacking, "limit");
  if (stackable && !isPlainObject(limit)) {
    p.add(A.INVALID_STACK_RULE, ["definitions", envelope.canonicalKey, "rules", "stacking", "limit"], "a stackable Effect explicitly authors a stack-limit rule");
    return null;
  }
  if (!stackable && limit !== null) {
    p.add(A.INVALID_STACK_RULE, ["definitions", envelope.canonicalKey, "rules", "stacking", "limit"], "a non-stackable Effect has no stack limit");
    return null;
  }
  return { stackable, limit };
}

function resolveStackLimit(
  raw: unknown,
  character: CharacterAbilityConstructionProfile,
  ladder: ProwessDefinitionEnvelope,
  affinityIndex: AffinityDefinitionIndex | null,
  affinityProfile: CharacterAffinityProfile | null,
  governingAffinity: ProwessDefinitionRef | null,
  p: Problems,
  at: readonly (string | number)[],
): number | null {
  const r = readRecord(raw, at, p, A.INVALID_STACK_RULE, ["kind", "maximum", "skillKey"], ["kind"]);
  if (r === null) return null;
  const kind = own(r, "kind");
  if (kind === "FIXED") {
    const maximum = readSafeInteger(own(r, "maximum"), [...at, "maximum"], p, A.INVALID_STACK_RULE, "fixed stack maximum");
    if (maximum !== null && maximum < 1) p.add(A.INVALID_STACK_RULE, [...at, "maximum"], "fixed stack maximum is at least 1");
    return maximum !== null && maximum >= 1 ? maximum : null;
  }
  if (kind === "SKILL_RANK_VALUE") {
    const skillKey = own(r, "skillKey");
    if (!isExactCanonicalKey(skillKey)) {
      p.add(A.INVALID_STACK_RULE, [...at, "skillKey"], "SKILL_RANK_VALUE names the exact Skill canonical key; Rank Value is never an implicit default");
      return null;
    }
    const rank = skillRank(character, skillKey);
    return ABILITY_CONSTRUCTION_CAPACITY_BY_RANK[rank].rankValue;
  }
  if (kind === "GOVERNING_AFFINITY_RANK_VALUE") {
    if (governingAffinity === null || affinityIndex === null || affinityProfile === null) {
      p.add(A.INVALID_STACK_RULE, at, "GOVERNING_AFFINITY_RANK_VALUE requires an exact owned governing Affinity");
      return null;
    }
    const owned = ownedAffinity(affinityProfile, governingAffinity);
    if (owned === null) {
      p.add(A.INVALID_STACK_RULE, at, "governing Affinity is not owned");
      return null;
    }
    return affinityRankEntry(affinityIndex, owned.rank).order;
  }
  p.add(A.INVALID_STACK_RULE, [...at, "kind"], `unknown stack-limit rule ${JSON.stringify(kind)}; Rank Value is never a fallback`);
  return null;
}

/**
 * Slot counting groups repeated exact Effect Definitions only when the Definition explicitly opts into stacking.
 * Non-stackable repetitions remain separate Effect slots. Stack limits become M4 Requirement results; malformed
 * authored stack rules fail compilation rather than being guessed.
 */
function effectSlots(
  composition: AbilityComposition,
  bundle: ProwessDefinitionBundle,
  character: CharacterAbilityConstructionProfile,
  ladder: ProwessDefinitionEnvelope,
  affinityIndex: AffinityDefinitionIndex | null,
  affinityProfile: CharacterAffinityProfile | null,
  governingAffinity: ProwessDefinitionRef | null,
  p: Problems,
): { slots: number; groups: Array<{ definition: ProwessDefinitionRef; uses: readonly OrderedComponentUse[]; stackable: boolean; limit: number | null }> } {
  const groups: Array<{ definition: ProwessDefinitionRef; uses: OrderedComponentUse[]; stackable: boolean; limit: number | null }> = [];
  for (const use of composition.effects) {
    let g = groups.find((x) => x.definition.entityId === use.definition.entityId && x.definition.entityVersionId === use.definition.entityVersionId);
    if (g === undefined) {
      const e = componentEnvelope(bundle, use, p, ["subject", "composition", "effects", use.componentKey]);
      if (e === null) continue;
      const sr = stackRule(e, p);
      if (sr === null) continue;
      let limit: number | null = null;
      if (sr.stackable) limit = resolveStackLimit(sr.limit, character, ladder, affinityIndex, affinityProfile, governingAffinity, p, ["definitions", e.canonicalKey, "rules", "stacking", "limit"]);
      g = { definition: use.definition, uses: [], stackable: sr.stackable, limit };
      groups.push(g);
    }
    g.uses.push(use);
  }
  return { slots: groups.reduce((n, g) => n + (g.stackable ? 1 : g.uses.length), 0), groups };
}

interface ParsedPrerequisite {
  readonly node: JsonObject;
  readonly facts: { numeric: JsonObject[]; ranks: JsonObject[]; sets: JsonObject[]; ownedEntityIds: string[]; keywords: null };
  readonly definitions: ProwessDefinitionRef[];
}

function mergeFacts(into: ParsedPrerequisite["facts"], from: ParsedPrerequisite["facts"]): void {
  for (const fact of from.ranks) if (!into.ranks.some((x) => x.key === fact.key)) into.ranks.push(fact);
  for (const fact of from.numeric) if (!into.numeric.some((x) => x.key === fact.key)) into.numeric.push(fact);
  for (const fact of from.sets) if (!into.sets.some((x) => x.key === fact.key)) into.sets.push(fact);
  for (const id of from.ownedEntityIds) if (!into.ownedEntityIds.includes(id)) into.ownedEntityIds.push(id);
}

function componentPrerequisite(
  value: unknown,
  character: CharacterAbilityConstructionProfile,
  ladder: ProwessDefinitionEnvelope,
  bundle: ProwessDefinitionBundle,
  affinityIndex: AffinityDefinitionIndex | null,
  affinityProfile: CharacterAffinityProfile | null,
  p: Problems,
  at: readonly (string | number)[],
): ParsedPrerequisite | null {
  const r = readRecord(value, at, p, A.INVALID_COMPONENT_REQUIREMENT, ["kind", "children", "skillKey", "minimumRank", "affinityKey"], ["kind"]);
  if (r === null) return null;
  const kind = own(r, "kind");
  const empty = (): ParsedPrerequisite["facts"] => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: [], keywords: null });
  if (kind === "ALL" || kind === "ANY") {
    const rawChildren = own(r, "children");
    if (!Array.isArray(rawChildren) || rawChildren.length === 0) {
      p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "children"], `${kind} prerequisite has at least one child`);
      return null;
    }
    const children: JsonObject[] = [];
    const facts = empty();
    const definitions: ProwessDefinitionRef[] = [];
    rawChildren.forEach((child: unknown, i: number) => {
      const parsed = componentPrerequisite(child, character, ladder, bundle, affinityIndex, affinityProfile, p, [...at, "children", i]);
      if (parsed === null) return;
      children.push(parsed.node);
      mergeFacts(facts, parsed.facts);
      for (const d of parsed.definitions) if (!definitions.some((x) => x.entityVersionId === d.entityVersionId)) definitions.push(d);
    });
    return { node: { kind, children, provenance: provenanceJson(provenanceOf(bundle, ladder)) }, facts, definitions };
  }
  if (kind === "SKILL_RANK") {
    const skillKey = own(r, "skillKey");
    const minimumRank = readEnum(own(r, "minimumRank"), ABILITY_CONSTRUCTION_SKILL_RANKS, [...at, "minimumRank"], p, A.INVALID_COMPONENT_REQUIREMENT, "minimum Skill rank");
    if (!isExactCanonicalKey(skillKey)) p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "skillKey"], "skillKey is an exact canonical key");
    if (!isExactCanonicalKey(skillKey) || minimumRank === null) return null;
    const actual = rankFactFor(ladder, character, skillKey);
    const requiredOrder = rankOrder(ladder, minimumRank);
    return {
      node: { kind: "RANK_AT_LEAST", factKey: actual.key, requiredRankKey: minimumRank, requiredOrder, provenance: provenanceJson(provenanceOf(bundle, ladder)) },
      facts: { ...empty(), ranks: [actual as unknown as JsonObject] },
      definitions: [definitionRefOf(ladder)],
    };
  }
  if (kind === "AFFINITY_RANK") {
    const affinityKey = own(r, "affinityKey");
    const minimumRank = own(r, "minimumRank");
    if (!isExactCanonicalKey(affinityKey)) p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "affinityKey"], "affinityKey is the exact canonical key in this Ruleset");
    if (!(["NONE", "TRAINED", "EXPERT", "MASTER"] as const).includes(minimumRank as AffinityRank)) p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "minimumRank"], "minimumRank is NONE, TRAINED, EXPERT or MASTER");
    if (!isExactCanonicalKey(affinityKey) || !(typeof minimumRank === "string") || affinityIndex === null) return null;
    const entry = affinityIndex.affinities.find((a) => a.ref.canonicalKey === affinityKey) ?? null;
    if (entry === null) {
      p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "affinityKey"], "Affinity prerequisite must resolve inside this exact Ruleset bundle");
      return null;
    }
    const owned = affinityProfile === null ? null : ownedAffinity(affinityProfile, entry.ref);
    const children: JsonObject[] = [{ kind: "ENTITY_OWNED", entityId: entry.ref.entityId, provenance: provenanceJson(entry.provenance) }];
    const facts = empty();
    facts.ownedEntityIds = affinityProfile === null ? [] : affinityProfile.affinities.map((a) => a.affinity.entityId);
    if (owned !== null) {
      const actual = affinityRankEntry(affinityIndex, owned.rank);
      const required = affinityRankEntry(affinityIndex, minimumRank as AffinityRank);
      const key = `affinity-rank:${entry.ref.entityVersionId}`;
      facts.ranks.push({ key, rankKey: owned.rank, order: actual.order, provenance: provenanceJson(affinityIndex.rankRule.provenance) });
      children.push({ kind: "RANK_AT_LEAST", factKey: key, requiredRankKey: minimumRank, requiredOrder: required.order, provenance: provenanceJson(affinityIndex.rankRule.provenance) });
    }
    return {
      node: { kind: "ALL", children, provenance: provenanceJson(entry.provenance) },
      facts,
      definitions: [entry.ref, affinityIndex.rankRule.ref],
    };
  }
  p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "kind"], `unsupported component prerequisite kind ${JSON.stringify(kind)}`);
  return null;
}

function requirementFromDefinition(
  envelope: ProwessDefinitionEnvelope,
  character: CharacterAbilityConstructionProfile,
  ladder: ProwessDefinitionEnvelope,
  bundle: ProwessDefinitionBundle,
  affinityIndex: AffinityDefinitionIndex | null,
  affinityProfile: CharacterAffinityProfile | null,
  p: Problems,
): ParsedPrerequisite | null {
  const rules = (envelope.payload as { rules?: unknown }).rules;
  if (!isPlainObject(rules)) return null;
  const raw = own(rules, "accessRequirements");
  if (raw === undefined || raw === null) return null;
  return componentPrerequisite(raw, character, ladder, bundle, affinityIndex, affinityProfile, p, ["definitions", envelope.canonicalKey, "rules", "accessRequirements"]);
}

function keywordContributionJson(
  componentKey: string,
  envelope: ProwessDefinitionEnvelope,
  catalog: KeywordCatalog,
  bundle: ProwessDefinitionBundle,
  p: Problems,
): JsonObject[] {
  const keywords = (envelope.payload as { keywords?: readonly string[] }).keywords ?? [];
  const sourceType = PROWESS_DEFINITION_KINDS[envelope.definitionKind].contract === null ? "prowess.component" : `prowess.${String(PROWESS_DEFINITION_KINDS[envelope.definitionKind].contract).toLowerCase()}`;
  const provenance = provenanceJson(provenanceOf(bundle, envelope));
  const out: JsonObject[] = [];
  keywords.forEach((key, ordinal) => {
    const ref = keywordReference(catalog, key);
    if (ref === null) {
      p.add(A.INVALID_COMPONENT_REQUIREMENT, ["definitions", envelope.canonicalKey, "keywords", ordinal], `${key} has no exact M1 Keyword reference in the supplied catalog`);
      return;
    }
    out.push({
      keyword: { keywordId: ref.keywordId, canonicalKey: ref.canonicalKey, categoryId: ref.categoryId },
      source: { sourceType, sourceKey: componentKey, sourceId: envelope.entityVersionId, provenance },
      ordinal,
    });
  });
  return out;
}

function keywordRuleAny(index: AffinityDefinitionIndex, governing: ReturnType<typeof findAffinityEntry>, catalog: KeywordCatalog, p: Problems): JsonObject[] {
  if (governing === null) return [];
  const out: JsonObject[] = [];
  const add = (keys: readonly string[], provenance: RuleProvenance) => {
    const children: JsonObject[] = [];
    for (const key of keys) {
      const ref = keywordReference(catalog, key);
      if (ref === null) {
        p.add(A.INVALID_COMPONENT_REQUIREMENT, ["definitions", governing.ref.canonicalKey], `${key} has no exact M1 Keyword reference in the supplied catalog`);
        continue;
      }
      children.push({ kind: "KEYWORD_PRESENT", keywordId: ref.keywordId, canonicalKey: null, provenance: provenanceJson(provenance) });
    }
    if (children.length === 1) out.push(children[0] as JsonObject);
    else if (children.length > 1) out.push({ kind: "ANY", children, provenance: provenanceJson(provenance) });
  };
  governing.payload.strengths.forEach((rule) => add(rule.matchAny, governing.provenance));
  governing.payload.weaknesses.forEach((rule) => add(rule.matchAny, governing.provenance));
  return out;
}

/** Compiles one character + one Spell/Maneuver Composition into exact M4 construction-legality checks. */
export function compileAbilityConstruction(request: unknown): ProwessOutcome<ProwessAbilityConstructionCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, X.INVALID_REQUEST, REQUEST_FIELDS, REQUEST_FIELDS);
  if (r === null) return finish(p, () => null as never);
  const contractVersion = own(r, "contractVersion");
  if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) {
    p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], `supported Prowess compilation contract versions: ${SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.join(", ")}`);
  }
  const ruleset = createRulesetContext(own(r, "ruleset"));
  const rawBundle = own(r, "definitions");
  let bundle: ProwessDefinitionBundle | null = null;
  if (!ruleset.ok) p.add(X.INVALID_REQUEST, ["ruleset"], "an exact, valid M4 RulesetContext is required");
  else if (!isPlainObject(rawBundle)) p.add(X.INVALID_REQUEST, ["definitions"], "definitions is the exact ProwessDefinitionBundle of this RulesetContext");
  else {
    const rebuilt = createProwessDefinitionBundle({ ruleset: own(r, "ruleset"), definitions: own(rawBundle, "definitions") ?? null });
    if (!rebuilt.ok) for (const problem of rebuilt.problems) p.list.push({ ...problem, path: `/definitions${problem.path}` });
    else if (!bundleMatchesRuleset({ rulesetProvenance: own(rawBundle, "rulesetProvenance") as ProwessRulesetProvenance, definitions: [] }, ruleset.value)) {
      p.add(X.BUNDLE_RULESET_MISMATCH, ["definitions", "rulesetProvenance"], "the Definition bundle belongs to a different exact Ruleset");
    } else bundle = rebuilt.value;
  }
  const subjectRaw = readRecord(own(r, "subject"), ["subject"], p, A.INVALID_REQUEST, SUBJECT_FIELDS, SUBJECT_FIELDS);
  const keywordCatalog = readKeywordCatalog(own(r, "keywords"), ["keywords"], p);
  if (bundle === null || !ruleset.ok || subjectRaw === null || keywordCatalog === null || p.count > 0) return finish(p, () => null as never);
  if (own(subjectRaw, "kind") !== "ABILITY_CONSTRUCTION") p.add(A.INVALID_REQUEST, ["subject", "kind"], "kind is ABILITY_CONSTRUCTION");
  const subjectKey = own(subjectRaw, "subjectKey");
  if (!isExactLabel(subjectKey)) p.add(A.INVALID_REQUEST, ["subject", "subjectKey"], "subjectKey is an exact label");

  const compositionOutcome = validateAbilityComposition(own(subjectRaw, "composition"), { bundle });
  if (!compositionOutcome.ok) {
    for (const problem of compositionOutcome.problems) p.list.push({ ...problem, path: `/subject/composition${problem.path}` });
  }
  const character = readProfile(own(subjectRaw, "character"), p);
  const signature = readSignature(own(subjectRaw, "signature"), p);
  if (!compositionOutcome.ok || character === null || signature === null || !isExactLabel(subjectKey) || p.count > 0) return finish(p, () => null as never);
  const composition = compositionOutcome.value;
  const grants = readGrants(own(subjectRaw, "accessGrants"), composition, p);
  const ladder = findSkillLadder(bundle, p);
  if (ladder === null || p.count > 0) return finish(p, () => null as never);
  const ladderRef = definitionRefOf(ladder);
  const ladderProv = provenanceOf(bundle, ladder);

  let affinityIndex: AffinityDefinitionIndex | null = null;
  let affinityProfile: CharacterAffinityProfile | null = null;
  const indexedAffinity = indexAffinityDefinitions(bundle);
  if (indexedAffinity.ok) {
    affinityIndex = indexedAffinity.value;
    affinityProfile = affinityProfileFor(character, bundle, affinityIndex, p);
  } else if (composition.abilityKind === "SPELL" && composition.affinity !== null) {
    for (const problem of indexedAffinity.problems) p.list.push(problem);
  }
  if (p.count > 0) return finish(p, () => null as never);

  const fragments: CompilationFragment[] = [];
  const components: Map<string, readonly ProwessDefinitionRef[]> = new Map();
  components.set(CONSTRUCTION_RULE, [ladderRef]);
  for (const c of compositionComponents(composition)) components.set(c.use.componentKey, [c.use.definition]);
  if (affinityIndex !== null) components.set(AFFINITY_RANK_RULE, [affinityIndex.rankRule.ref]);

  const emit = (f: CompilationFragment) => fragments.push(f);
  const req = (
    fragmentKey: string,
    order: number,
    requirement: JsonObject,
    facts: JsonObject,
    role: string,
    componentKeys: readonly string[],
    definitions: readonly ProwessDefinitionRef[],
    bindings: CompilationFragment["bindings"] = [],
  ) => {
    emit({ fragmentKey, order, operation: "REQUIREMENT", input: { requirement, facts }, bindings, role, componentKeys, definitions });
    return fragmentKey;
  };
  const formula = (fragmentKey: string, expression: string, variables: Record<string, number>, role: string) => {
    emit({
      fragmentKey,
      order: ORDER.FORMULA,
      operation: "FORMULA",
      input: { program: { expression, rounding: "NONE", minimum: null, maximum: null, unit: null, provenance: provenanceJson(ladderProv) }, variables },
      bindings: [],
      role,
      componentKeys: [CONSTRUCTION_RULE],
      definitions: [ladderRef],
    });
    return fragmentKey;
  };

  let authorityStep = "";
  let effectCapacity = 0;
  let traitCapacity = 0;
  let traitTrades = 0;
  let authorityRank: AbilityConstructionSkillRank | AffinityRank = "UNTRAINED";
  let authority: SpellConstructionAuthority | "MARTIAL" = "MARTIAL";
  let governingAffinity: ProwessDefinitionRef | null = null;
  const affinityAccess: Array<{ componentKey: string; keywordStepKey: string; requirementStepKey: string }> = [];

  if (composition.abilityKind === "SPELL") {
    const parsedAuthority = readAuthority(composition, p);
    if (parsedAuthority === null) return finish(p, () => null as never);
    authority = parsedAuthority.authority;
    traitTrades = parsedAuthority.traitTrades;
    if (authority === "ARCANE_AUTHORITY") {
      authorityRank = skillRank(character, ARCANA_SKILL_KEY);
      const actual = rankFactFor(ladder, character, ARCANA_SKILL_KEY);
      authorityStep = req(
        "authority.arcane",
        ORDER.ACCESS,
        { kind: "RANK_AT_LEAST", factKey: actual.key, requiredRankKey: "TRAINED", requiredOrder: rankOrder(ladder, "TRAINED"), provenance: provenanceJson(ladderProv) },
        { ...EMPTY_FACTS(), ranks: [actual] },
        "spell-arcane-authority-access",
        [CONSTRUCTION_RULE],
        [ladderRef],
      );
      const capacity = ABILITY_CONSTRUCTION_CAPACITY_BY_RANK[authorityRank as AbilityConstructionSkillRank];
      effectCapacity = capacity.effectCapacity;
      traitCapacity = capacity.traitCapacity;
    } else {
      if (composition.affinity === null || affinityIndex === null) {
        p.add(A.GOVERNING_AFFINITY_REQUIRED, ["subject", "composition", "affinity"], "Affinity Authority requires one explicit exact governing Affinity");
        return finish(p, () => null as never);
      }
      if (affinityProfile === null) {
        p.add(A.AFFINITY_PROFILE_REQUIRED, ["subject", "character", "affinityProfile"], "Affinity Authority requires the character's exact Affinity profile");
        return finish(p, () => null as never);
      }
      governingAffinity = composition.affinity.definition;
      const entry = findAffinityEntry(affinityIndex, governingAffinity);
      const owned = entry === null ? null : ownedAffinity(affinityProfile, governingAffinity);
      if (entry === null) p.add(A.GOVERNING_AFFINITY_REQUIRED, ["subject", "composition", "affinity"], "governing Affinity must be executable in this exact Ruleset");
      if (entry !== null && owned === null) p.add(A.GOVERNING_AFFINITY_NOT_OWNED, ["subject", "composition", "affinity"], "governing Affinity must be exactly owned by the character");
      if (entry === null || owned === null) return finish(p, () => null as never);
      components.set(GOVERNING_AFFINITY, [entry.ref]);
      authorityRank = owned.rank;
      const actual = affinityRankEntry(affinityIndex, owned.rank);
      const trained = affinityRankEntry(affinityIndex, "TRAINED");
      const factKey = `affinity-rank:${entry.ref.entityVersionId}`;
      authorityStep = req(
        "authority.affinity",
        ORDER.ACCESS,
        { kind: "RANK_AT_LEAST", factKey, requiredRankKey: "TRAINED", requiredOrder: trained.order, provenance: provenanceJson(affinityIndex.rankRule.provenance) },
        { ...EMPTY_FACTS(), ranks: [{ key: factKey, rankKey: owned.rank, order: actual.order, provenance: provenanceJson(affinityIndex.rankRule.provenance) }] },
        "spell-affinity-authority-access",
        [GOVERNING_AFFINITY, AFFINITY_RANK_RULE],
        [entry.ref, affinityIndex.rankRule.ref],
      );
      effectCapacity = actual.authority?.effectCapacity ?? 0;
      traitCapacity = actual.authority?.traitCapacity ?? 0;

      // Designer ruling: under Affinity Authority EVERY Ability component must fit the Affinity's explicit access.
      // Strength or Weakness alignment is access; otherwise a specific authored access grant is required.
      const accessRules = keywordRuleAny(affinityIndex, entry, keywordCatalog, p);
      const grantMembers = grants.map((g) => g.componentKey);
      for (const c of compositionComponents(composition)) {
        if (c.slot === "affinity") continue;
        const envelope = componentEnvelope(bundle, c.use, p, ["subject", "composition", c.use.componentKey]);
        if (envelope === null) continue;
        const contributions = keywordContributionJson(c.use.componentKey, envelope, keywordCatalog, bundle, p);
        const keywordFragment = `affinity.component_keywords.${c.use.componentKey}`;
        emit({
          fragmentKey: keywordFragment,
          order: ORDER.ACCESS,
          operation: "KEYWORD",
          input: { contributions },
          bindings: [],
          role: "affinity-authority-component-keywords",
          componentKeys: [c.use.componentKey],
          definitions: [c.use.definition],
        });
        const grantNode: JsonObject = { kind: "SET_CONTAINS", factKey: GRANTS_FACT, member: c.use.componentKey, provenance: provenanceJson(entry.provenance) };
        const children = [...accessRules, grantNode];
        const accessFragment = `affinity.component_access.${c.use.componentKey}`;
        req(
          accessFragment,
          ORDER.ACCESS + 1,
          { kind: "ANY", children, provenance: provenanceJson(entry.provenance) },
          { ...EMPTY_FACTS(), sets: [{ key: GRANTS_FACT, members: grantMembers, provenance: null }] },
          "affinity-authority-component-access",
          [GOVERNING_AFFINITY, c.use.componentKey],
          [entry.ref, c.use.definition],
          [{ target: "/facts/keywords", source: { kind: "FRAGMENT", fragmentKey: keywordFragment, pointer: "/data" } }],
        );
        affinityAccess.push({ componentKey: c.use.componentKey, keywordStepKey: keywordFragment, requirementStepKey: accessFragment });
      }
    }
  } else {
    authority = "MARTIAL";
    authorityRank = skillRank(character, MARTIAL_SKILL_KEY);
    const actual = rankFactFor(ladder, character, MARTIAL_SKILL_KEY);
    authorityStep = req(
      "authority.martial",
      ORDER.ACCESS,
      { kind: "RANK_AT_LEAST", factKey: actual.key, requiredRankKey: "TRAINED", requiredOrder: rankOrder(ladder, "TRAINED"), provenance: provenanceJson(ladderProv) },
      { ...EMPTY_FACTS(), ranks: [actual] },
      "maneuver-martial-access",
      [CONSTRUCTION_RULE],
      [ladderRef],
    );
    const capacity = ABILITY_CONSTRUCTION_CAPACITY_BY_RANK[authorityRank as AbilityConstructionSkillRank];
    effectCapacity = capacity.effectCapacity;
    traitCapacity = capacity.traitCapacity;
  }
  if (p.count > 0) return finish(p, () => null as never);

  const stack = effectSlots(composition, bundle, character, ladder, affinityIndex, affinityProfile, governingAffinity, p);
  if (p.count > 0) return finish(p, () => null as never);
  const effectSlotsUsed = stack.slots;
  const traitSlotsUsed = composition.traits.length;
  const conditionSlotsUsed = composition.conditions.length;
  const arcaneRank = skillRank(character, ARCANA_SKILL_KEY);
  const castingConditionCapacity = ABILITY_CONSTRUCTION_CAPACITY_BY_RANK[arcaneRank].castingConditionCapacity;
  const maneuverConditionCapacity = composition.abilityKind === "MANEUVER" ? ABILITY_CONSTRUCTION_CAPACITY_BY_RANK[authorityRank as AbilityConstructionSkillRank].rankValue : null;

  // Trait exchange is Spell-only. M4 computes effective capacities. A Spell must always retain >= 1 Effect.
  const maxTrades = composition.abilityKind === "SPELL" ? Math.max(0, effectCapacity - 1) : 0;
  // The exact locked table independently pins this rule and protects against a future base-capacity change silently
  // altering exchange policy. This is lookup-only domain content; all arithmetic remains in M4 below.
  const declaredMaxTrades = composition.abilityKind === "SPELL"
    ? authorityRank === "NONE"
      ? 0
      : ABILITY_CONSTRUCTION_CAPACITY_BY_RANK[authorityRank as AbilityConstructionSkillRank].maximumTraitTrades
    : 0;
  if (composition.abilityKind === "MANEUVER" && traitTrades !== 0) p.add(A.INVALID_TRAIT_TRADE, ["subject", "composition", "authority", "traitTrades"], "Effect→Trait exchange is a Spell construction option only");
  if (maxTrades !== declaredMaxTrades) p.add(A.INVALID_TRAIT_TRADE, ["subject", "composition", "authority", "traitTrades"], "authority capacity and locked Trait-exchange table disagree; fail closed rather than infer a new trade rule");
  if (p.count > 0) return finish(p, () => null as never);

  const effectCapacityFormula = formula("capacity.effective_effects", "base - trades", { base: effectCapacity, trades: traitTrades }, "effective-effect-capacity");
  const traitCapacityFormula = formula("capacity.effective_traits", "base + trades", { base: traitCapacity, trades: traitTrades }, "effective-trait-capacity");

  const minimumEffectStep = req(
    "capacity.minimum_effect",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "effect_slots_used", operator: ">=", expected: 1, provenance: provenanceJson(ladderProv) },
    { ...EMPTY_FACTS(), numeric: [{ key: "effect_slots_used", value: effectSlotsUsed, provenance: null }] },
    "minimum-one-effect",
    [CONSTRUCTION_RULE],
    [ladderRef],
  );
  const tradeStep = req(
    "capacity.trait_trades",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "trait_trades", operator: "<=", expected: declaredMaxTrades, provenance: provenanceJson(ladderProv) },
    { ...EMPTY_FACTS(), numeric: [{ key: "trait_trades", value: traitTrades, provenance: null }] },
    "spell-trait-exchange-limit",
    [CONSTRUCTION_RULE],
    [ladderRef],
  );
  const effectCapacityStep = req(
    "capacity.effects",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "effect_slots_used", operator: "<=", expected: 0, provenance: provenanceJson(ladderProv) },
    { ...EMPTY_FACTS(), numeric: [{ key: "effect_slots_used", value: effectSlotsUsed, provenance: null }] },
    "effect-capacity",
    [CONSTRUCTION_RULE],
    [ladderRef],
    [{ target: "/requirement/expected", source: { kind: "FRAGMENT", fragmentKey: effectCapacityFormula, pointer: "/data/finalValue" } }],
  );
  const traitCapacityStep = req(
    "capacity.traits",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "trait_slots_used", operator: "<=", expected: 0, provenance: provenanceJson(ladderProv) },
    { ...EMPTY_FACTS(), numeric: [{ key: "trait_slots_used", value: traitSlotsUsed, provenance: null }] },
    "trait-capacity",
    [CONSTRUCTION_RULE],
    [ladderRef],
    [{ target: "/requirement/expected", source: { kind: "FRAGMENT", fragmentKey: traitCapacityFormula, pointer: "/data/finalValue" } }],
  );
  const conditionCapacity = composition.abilityKind === "SPELL" ? castingConditionCapacity : (maneuverConditionCapacity as number);
  const conditionCapacityStep = req(
    "capacity.conditions",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "condition_slots_used", operator: "<=", expected: conditionCapacity, provenance: provenanceJson(ladderProv) },
    { ...EMPTY_FACTS(), numeric: [{ key: "condition_slots_used", value: conditionSlotsUsed, provenance: null }] },
    composition.abilityKind === "SPELL" ? "casting-condition-capacity-from-arcane-rank" : "maneuver-condition-capacity-from-martial-rank",
    [CONSTRUCTION_RULE],
    [ladderRef],
  );

  const stackGroups: AbilityConstructionStackGroup[] = [];
  const stackRequirementKeys: string[] = [];
  stack.groups.forEach((g, index) => {
    let requirementStepKey: string | null = null;
    if (g.stackable && g.limit !== null) {
      const key = `stack.${index}`;
      const componentKey = `construction.stack.${index}`;
      components.set(componentKey, [g.definition]);
      requirementStepKey = req(
        key,
        ORDER.STACK,
        { kind: "NUMERIC_COMPARE", factKey: `stack_count_${index}`, operator: "<=", expected: g.limit, provenance: provenanceJson(ladderProv) },
        { ...EMPTY_FACTS(), numeric: [{ key: `stack_count_${index}`, value: g.uses.length, provenance: null }] },
        "explicit-effect-stack-limit",
        [componentKey],
        [g.definition],
      );
      stackRequirementKeys.push(key);
    }
    stackGroups.push({ definition: g.definition, componentKeys: g.uses.map((u) => u.componentKey), stackable: g.stackable, slotCount: g.stackable ? 1 : g.uses.length, limit: g.limit, requirementStepKey });
  });

  const componentRequirementKeys: Array<{ componentKey: string; stepKey: string }> = [];
  for (const c of compositionComponents(composition)) {
    if (c.slot === "affinity") continue;
    const envelope = componentEnvelope(bundle, c.use, p, ["subject", "composition", c.use.componentKey]);
    if (envelope === null) continue;
    const parsed = requirementFromDefinition(envelope, character, ladder, bundle, affinityIndex, affinityProfile, p);
    if (parsed === null) continue;
    const definitions = [c.use.definition, ...parsed.definitions.filter((d) => d.entityVersionId !== c.use.definition.entityVersionId)];
    const sourceKey = `construction.prerequisite.${c.use.componentKey}`;
    components.set(sourceKey, definitions);
    const key = `prerequisite.${c.use.componentKey}`;
    req(key, ORDER.COMPONENT_REQUIREMENT, parsed.node, parsed.facts as unknown as JsonObject, "component-access-prerequisite", [sourceKey], definitions);
    componentRequirementKeys.push({ componentKey: c.use.componentKey, stepKey: key });
  }
  if (p.count > 0) return finish(p, () => null as never);

  // Every permanent player-created/known Ability consumes one Signature Ability slot unless one explicit written rule
  // exempts it. No complexity-based multi-slot consumption exists in WO5.
  const slotUse: 0 | 1 = signature.exemption === null ? 1 : 0;
  const signatureFormula = formula("signature.projected", "used + candidate", { used: character.signatureSlotsUsed, candidate: slotUse }, "projected-signature-slot-use");
  const signatureStep = req(
    "signature.capacity",
    ORDER.SIGNATURE,
    { kind: "NUMERIC_COMPARE", factKey: "projected_signature_slots", operator: "<=", expected: character.prowess, provenance: provenanceJson(ladderProv) },
    { ...EMPTY_FACTS(), numeric: [{ key: "projected_signature_slots", value: 0, provenance: null }] },
    "signature-ability-capacity",
    [CONSTRUCTION_RULE],
    [ladderRef],
    [{ target: "/facts/numeric/0/value", source: { kind: "FRAGMENT", fragmentKey: signatureFormula, pointer: "/data/finalValue" } }],
  );

  const assembled = assembleFragments({ subjectKind: "ABILITY_CONSTRUCTION", subjectKey: subjectKey as string, components: components as SubjectComponents, bundle, fragments }, p);
  if (p.count > 0) return finish(p, () => null as never);
  const sk = (fragmentKey: string) => compiledStepKey("ABILITY_CONSTRUCTION", subjectKey as string, fragmentKey);
  const requirementFragments = [authorityStep, minimumEffectStep, tradeStep, effectCapacityStep, traitCapacityStep, conditionCapacityStep, ...stackRequirementKeys, ...componentRequirementKeys.map((x) => x.stepKey), ...affinityAccess.map((x) => x.requirementStepKey), signatureStep];

  return finish(p, () =>
    deepFreeze({
      contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
      subject: { kind: "ABILITY_CONSTRUCTION" as const, subjectKey: subjectKey as string, abilityKind: composition.abilityKind, compositionKey: composition.compositionKey },
      rulesetProvenance: bundle.rulesetProvenance,
      evaluationPlan: { steps: assembled.steps, primaryStepKey: sk(signatureStep), validationStepKey: null, explanationStepKey: null },
      sourceMap: { entries: assembled.entries },
      outputs: {
        authorityStepKey: sk(authorityStep),
        minimumEffectStepKey: sk(minimumEffectStep),
        effectCapacityStepKey: sk(effectCapacityStep),
        traitCapacityStepKey: sk(traitCapacityStep),
        conditionCapacityStepKey: sk(conditionCapacityStep),
        signatureStepKey: sk(signatureStep),
        requirementStepKeys: requirementFragments.map(sk),
        capacity: {
          authority,
          authorityRank,
          baseEffectCapacity: effectCapacity,
          baseTraitCapacity: traitCapacity,
          traitTrades,
          effectSlotsUsed,
          traitSlotsUsed,
          conditionSlotsUsed,
          castingConditionCapacity,
          maneuverConditionCapacity,
          effectiveEffectCapacityStepKey: sk(effectCapacityFormula),
          effectiveTraitCapacityStepKey: sk(traitCapacityFormula),
        },
        stackGroups: stackGroups.map((g) => ({ ...g, requirementStepKey: g.requirementStepKey === null ? null : sk(g.requirementStepKey) })),
        componentRequirementStepKeys: componentRequirementKeys.map((x) => ({ componentKey: x.componentKey, stepKey: sk(x.stepKey) })),
        affinityAccessStepKeys: affinityAccess.map((x) => ({ componentKey: x.componentKey, keywordStepKey: sk(x.keywordStepKey), requirementStepKey: sk(x.requirementStepKey) })),
        signatureSlotUse: slotUse,
      },
    }),
  );
}

/**
 * Reads one completed M4 run. It never re-evaluates a Requirement: `legal` is true only when every exact Requirement
 * response produced by the compiled plan says `satisfied: true`. Missing / blocked / invalid steps fail closed.
 */
export function readAbilityConstructionRun(plan: ProwessAbilityConstructionCompiledPlan, run: EvaluationRun): ProwessOutcome<AbilityConstructionRunReading> {
  const p = new Problems();
  if (!checkPlainData(run, ["run"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const readings: AbilityConstructionRequirementReading[] = [];
  for (const stepKey of plan.outputs.requirementStepKeys) {
    const step = run.steps.find((x) => x.stepKey === stepKey);
    if (step === undefined || step.executionStatus !== "EXECUTED" || step.response === null || step.response.status === "INVALID") {
      p.add(A.INCOMPLETE_RUN, ["run", "steps"], `required construction step ${stepKey} did not execute to a valid Requirement response`);
      continue;
    }
    const data = step.response.data as { satisfied?: unknown } | null;
    if (data === null || typeof data.satisfied !== "boolean") {
      p.add(A.INCOMPLETE_RUN, ["run", "steps"], `step ${stepKey} is not an M4 Requirement response`);
      continue;
    }
    readings.push({ stepKey, satisfied: data.satisfied });
  }
  return finish(p, () => ({ legal: readings.every((x) => x.satisfied), requirements: readings }));
}
