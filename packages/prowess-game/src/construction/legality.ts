import type { JsonObject } from "@prowess/model";
import {
  createRulesetContext,
  type EvaluationPlan,
  type EvaluationRun,
  type RuleProvenance,
  type RulesetContext,
} from "@prowess/rules";
import {
  bundleMatchesRuleset,
  createProwessDefinitionBundle,
  findBundleDefinition,
  type ProwessDefinitionBundle,
  type ProwessRulesetProvenance,
} from "../bundle/bundle.js";
import { assembleFragments, compiledStepKey, type SubjectComponents } from "../compilation/assemble.js";
import type { CompilationFragment, ProwessCompilationSourceMap } from "../compilation/model.js";
import {
  PROWESS_COMPILATION_CONTRACT_VERSION,
  SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS,
  type ProwessCompilationContractVersion,
} from "../contract-version.js";
import {
  compositionComponents,
  validateAbilityComposition,
  type AbilityComposition,
  type OrderedComponentUse,
} from "./composition.js";
import {
  ABILITY_CONSTRUCTION_ERROR_CODES as A,
  COMPILATION_ERROR_CODES as X,
  DEFINITION_ERROR_CODES as C,
} from "../definition/codes.js";
import {
  definitionRefOf,
  type ProwessDefinitionEnvelope,
  type ProwessDefinitionRef,
} from "../definition/envelope.js";
import type {
  AbilityConstructionRankRule,
  AbilityConstructionRulePayload,
} from "../definition/ability-construction-payload.js";
import {
  findAffinityEntry,
  indexAffinityDefinitions,
  keywordReference,
  rankEntry as affinityRankEntry,
  readKeywordCatalog,
  type AffinityDefinitionIndex,
  type AffinityEntry,
  type KeywordCatalog,
} from "../affinity/definitions.js";
import {
  ownedAffinity,
  validateAffinityProfile,
  type CharacterAffinityProfile,
} from "../affinity/profile.js";
import {
  SPELL_CONSTRUCTION_AUTHORITIES,
  type AffinityRank,
  type SpellConstructionAuthority,
} from "../vocabulary/affinity.js";
import { SKILL_RANK_LADDER_KEY } from "../vocabulary/core.js";
import {
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

/** M5-WO5 compiles construction legality only. Costs and runtime resolution remain later Work Orders. */
export interface AbilityConstructionSkillState {
  readonly skillKey: string;
  readonly rank: AbilityConstructionSkillRank;
}

export interface CharacterAbilityConstructionProfile {
  readonly prowess: number;
  readonly signatureSlotsUsed: number;
  readonly skills: readonly AbilityConstructionSkillState[];
  readonly affinityProfile: CharacterAffinityProfile | null;
}

export interface AbilityConstructionSignaturePolicy {
  readonly exemption: { readonly sourceKey: string } | null;
}

export interface AbilityConstructionAccessGrant {
  readonly componentKey: string;
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
  readonly keywords: readonly {
    readonly keywordId: string;
    readonly canonicalKey: string;
    readonly categoryId: string | null;
  }[];
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
  readonly effectiveEffectCapacityStepKey: string;
  readonly effectiveTraitCapacityStepKey: string;
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
  readonly traitTradeStepKey: string;
  readonly effectCapacityStepKey: string;
  readonly traitCapacityStepKey: string;
  readonly conditionCapacityStepKey: string;
  readonly signatureStepKey: string;
  readonly requirementStepKeys: readonly string[];
  readonly capacity: AbilityConstructionCapacityOutput;
  readonly stackGroups: readonly AbilityConstructionStackGroup[];
  readonly componentRequirementStepKeys: readonly { readonly componentKey: string; readonly stepKey: string }[];
  readonly affinityAccessStepKeys: readonly {
    readonly componentKey: string;
    readonly keywordStepKey: string;
    readonly requirementStepKey: string;
  }[];
  readonly signatureSlotUse: number;
  readonly constructionRule: ProwessDefinitionRef;
}

export interface ProwessAbilityConstructionCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: {
    readonly kind: "ABILITY_CONSTRUCTION";
    readonly subjectKey: string;
    readonly abilityKind: AbilityComposition["abilityKind"];
    readonly compositionKey: string;
  };
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

interface ConstructionRuleEntry {
  readonly ref: ProwessDefinitionRef;
  readonly payload: AbilityConstructionRulePayload;
  readonly provenance: RuleProvenance;
}

interface ConstructionRankFact extends JsonObject {
  readonly key: string;
  readonly rankKey: AbilityConstructionSkillRank;
  readonly order: number;
  readonly provenance: null;
}

interface ParsedPrerequisite {
  readonly node: JsonObject;
  readonly facts: JsonObject;
  readonly definitions: readonly ProwessDefinitionRef[];
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
const ORDER = deepFreeze({ FORMULA: 100, ACCESS: 200, COMPONENT_REQUIREMENT: 300, CAPACITY: 400, STACK: 500, SIGNATURE: 600 } as const);

const emptyFacts = () => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: [], keywords: null });
const provenanceJson = (value: RuleProvenance): JsonObject => clonePlainData(value) as unknown as JsonObject;

function provenanceOf(bundle: ProwessDefinitionBundle, envelope: ProwessDefinitionEnvelope): RuleProvenance {
  return {
    entityId: envelope.entityId,
    entityVersionId: envelope.entityVersionId,
    canonicalKey: envelope.canonicalKey,
    rulesetId: bundle.rulesetProvenance.rulesetId,
    manifestId: bundle.rulesetProvenance.manifestId,
  } as RuleProvenance;
}

function skillRank(profile: CharacterAbilityConstructionProfile, skillKey: string): AbilityConstructionSkillRank {
  return profile.skills.find((s) => s.skillKey === skillKey)?.rank ?? "UNTRAINED";
}

function constructionRank(rule: ConstructionRuleEntry, rank: AbilityConstructionSkillRank): AbilityConstructionRankRule {
  const row = rule.payload.ranks.find((r) => r.rank === rank);
  if (row === undefined) throw new Error(`Validated construction rule lost rank ${rank}`);
  return row;
}

function rankOrder(ladder: ProwessDefinitionEnvelope, rank: AbilityConstructionSkillRank): number {
  const rows = (ladder.payload as unknown as { ranks: readonly { rankKey: string; order: number }[] }).ranks;
  return rows.find((r) => r.rankKey === rank)?.order ?? -1;
}

function rankFact(ladder: ProwessDefinitionEnvelope, profile: CharacterAbilityConstructionProfile, skillKey: string): ConstructionRankFact {
  const rank = skillRank(profile, skillKey);
  return { key: `skill-rank:${skillKey}`, rankKey: rank, order: rankOrder(ladder, rank), provenance: null };
}

function findSkillLadder(bundle: ProwessDefinitionBundle, p: Problems): ProwessDefinitionEnvelope | null {
  const found = bundle.definitions.filter(
    (d) => d.definitionKind === "RANK_LADDER" && (d.payload as { ladderKey?: unknown }).ladderKey === SKILL_RANK_LADDER_KEY,
  );
  if (found.length !== 1) {
    p.add(A.INVALID_REQUEST, ["definitions"], `exactly one ${SKILL_RANK_LADDER_KEY} RANK_LADDER Definition is required (found ${found.length})`);
    return null;
  }
  const ladder = found[0] as ProwessDefinitionEnvelope;
  for (const rank of ABILITY_CONSTRUCTION_SKILL_RANKS) {
    if (rankOrder(ladder, rank) < 0) p.add(A.UNKNOWN_SKILL_RANK, ["definitions"], `the exact Skill rank ladder has no ${rank} rank`);
  }
  return ladder;
}

function findConstructionRule(bundle: ProwessDefinitionBundle, p: Problems): ConstructionRuleEntry | null {
  const found = bundle.definitions.filter((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  if (found.length !== 1) {
    p.add(A.INVALID_REQUEST, ["definitions"], `exactly one ABILITY_CONSTRUCTION_RULE Definition is required (found ${found.length})`);
    return null;
  }
  const envelope = found[0] as ProwessDefinitionEnvelope;
  return {
    ref: definitionRefOf(envelope),
    payload: envelope.payload as unknown as AbilityConstructionRulePayload,
    provenance: provenanceOf(bundle, envelope),
  };
}

function readProfile(value: unknown, p: Problems): CharacterAbilityConstructionProfile | null {
  const r = readRecord(value, ["subject", "character"], p, A.INVALID_PROFILE, PROFILE_FIELDS, PROFILE_FIELDS);
  if (r === null) return null;
  const prowess = readSafeInteger(own(r, "prowess"), ["subject", "character", "prowess"], p, A.INVALID_PROFILE, "Prowess Score");
  const signatureSlotsUsed = readSafeInteger(own(r, "signatureSlotsUsed"), ["subject", "character", "signatureSlotsUsed"], p, A.INVALID_PROFILE, "signatureSlotsUsed");
  if (prowess !== null && (prowess < 1 || prowess > 10)) p.add(A.INVALID_PROFILE, ["subject", "character", "prowess"], "Prowess Score is 1–10 unless an exact override exists");
  if (signatureSlotsUsed !== null && signatureSlotsUsed < 0) p.add(A.INVALID_PROFILE, ["subject", "character", "signatureSlotsUsed"], "signatureSlotsUsed cannot be negative");

  const skills: AbilityConstructionSkillState[] = [];
  const rawSkills = own(r, "skills");
  if (!Array.isArray(rawSkills)) p.add(A.INVALID_PROFILE, ["subject", "character", "skills"], "skills is an array");
  else rawSkills.forEach((raw: unknown, i: number) => {
    const sr = readRecord(raw, ["subject", "character", "skills", i], p, A.INVALID_PROFILE, SKILL_FIELDS, SKILL_FIELDS);
    if (sr === null) return;
    const skillKey = own(sr, "skillKey");
    const rank = readEnum(own(sr, "rank"), ABILITY_CONSTRUCTION_SKILL_RANKS, ["subject", "character", "skills", i, "rank"], p, A.UNKNOWN_SKILL_RANK, "Skill rank");
    if (!isExactCanonicalKey(skillKey)) p.add(A.INVALID_PROFILE, ["subject", "character", "skills", i, "skillKey"], "skillKey is exact");
    if (typeof skillKey === "string" && rank !== null) {
      if (skills.some((s) => s.skillKey === skillKey)) p.add(A.INVALID_PROFILE, ["subject", "character", "skills", i], `skill ${skillKey} is supplied twice`);
      else skills.push({ skillKey, rank });
    }
  });

  const affinityProfile = own(r, "affinityProfile");
  if (affinityProfile !== null && !isPlainObject(affinityProfile)) p.add(A.INVALID_PROFILE, ["subject", "character", "affinityProfile"], "affinityProfile is an exact WO4 profile or null");
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
    p.add(A.INVALID_SIGNATURE_EXEMPTION, ["subject", "signature", "exemption", "sourceKey"], "a slot exemption cites one explicit authored rule key");
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
    if (!isExactLabel(componentKey) || !keys.has(componentKey as string)) p.add(A.INVALID_REQUEST, ["subject", "accessGrants", i, "componentKey"], "componentKey names one exact component");
    if (!isExactCanonicalKey(sourceKey)) p.add(A.INVALID_REQUEST, ["subject", "accessGrants", i, "sourceKey"], "sourceKey is exact");
    if (typeof componentKey === "string" && grants.some((g) => g.componentKey === componentKey)) p.add(A.INVALID_REQUEST, ["subject", "accessGrants", i, "componentKey"], "one grant per component");
    if (isExactLabel(componentKey) && keys.has(componentKey) && isExactCanonicalKey(sourceKey)) grants.push({ componentKey, sourceKey });
  });
  return grants;
}

function readSpellAuthority(composition: AbilityComposition, p: Problems): { authority: SpellConstructionAuthority; traitTrades: number } | null {
  const r = readRecord(composition.authority, ["subject", "composition", "authority"], p, A.AUTHORITY_REQUIRED, AUTHORITY_FIELDS, ["authority"]);
  if (r === null) return null;
  const authority = readEnum(own(r, "authority"), SPELL_CONSTRUCTION_AUTHORITIES, ["subject", "composition", "authority", "authority"], p, A.INVALID_AUTHORITY, "Spell Authority");
  const rawTrades = own(r, "traitTrades");
  const traitTrades = rawTrades === undefined ? 0 : readSafeInteger(rawTrades, ["subject", "composition", "authority", "traitTrades"], p, A.INVALID_TRAIT_TRADE, "traitTrades");
  if (traitTrades !== null && traitTrades < 0) p.add(A.INVALID_TRAIT_TRADE, ["subject", "composition", "authority", "traitTrades"], "traitTrades cannot be negative");
  return authority === null || traitTrades === null ? null : { authority, traitTrades };
}

function validatedAffinityProfile(
  raw: CharacterAffinityProfile | null,
  bundle: ProwessDefinitionBundle,
  index: AffinityDefinitionIndex,
  p: Problems,
): CharacterAffinityProfile | null {
  if (raw === null) return null;
  const out = validateAffinityProfile(raw, bundle, index);
  if (!out.ok) {
    for (const problem of out.problems) p.list.push({ ...problem, path: `/subject/character/affinityProfile${problem.path}` });
    return null;
  }
  return out.value;
}

function componentEnvelope(bundle: ProwessDefinitionBundle, definition: ProwessDefinitionRef, p: Problems, at: readonly (string | number)[]): ProwessDefinitionEnvelope | null {
  const envelope = findBundleDefinition(bundle, definition);
  if (envelope === null) p.add(A.INVALID_REQUEST, at, "component Definition must resolve exactly in this Ruleset");
  return envelope;
}

function stackRule(envelope: ProwessDefinitionEnvelope, p: Problems): { stackable: boolean; limit: unknown } | null {
  const rules = (envelope.payload as { rules?: unknown }).rules;
  if (!isPlainObject(rules) || own(rules, "stacking") === undefined) return { stackable: false, limit: null };
  const r = readRecord(own(rules, "stacking"), ["definitions", envelope.canonicalKey, "rules", "stacking"], p, A.INVALID_STACK_RULE, ["stackable", "limit"], ["stackable", "limit"]);
  if (r === null) return null;
  const stackable = own(r, "stackable");
  const limit = own(r, "limit");
  if (typeof stackable !== "boolean") p.add(A.INVALID_STACK_RULE, ["definitions", envelope.canonicalKey, "rules", "stacking", "stackable"], "stackable is boolean");
  if (stackable === true && !isPlainObject(limit)) p.add(A.INVALID_STACK_RULE, ["definitions", envelope.canonicalKey, "rules", "stacking", "limit"], "a stackable Effect explicitly authors its stack-limit rule");
  if (stackable === false && limit !== null) p.add(A.INVALID_STACK_RULE, ["definitions", envelope.canonicalKey, "rules", "stacking", "limit"], "a non-stackable Effect has no stack limit");
  return typeof stackable === "boolean" ? { stackable, limit } : null;
}

function resolveStackLimit(
  raw: unknown,
  character: CharacterAbilityConstructionProfile,
  rule: ConstructionRuleEntry,
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
      p.add(A.INVALID_STACK_RULE, [...at, "skillKey"], "SKILL_RANK_VALUE names the exact Skill key; Rank Value is never a default");
      return null;
    }
    return constructionRank(rule, skillRank(character, skillKey)).rankValue;
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
  p.add(A.INVALID_STACK_RULE, [...at, "kind"], `unknown stack-limit rule ${JSON.stringify(kind)}; no default is inferred`);
  return null;
}

function effectSlotGroups(
  composition: AbilityComposition,
  bundle: ProwessDefinitionBundle,
  character: CharacterAbilityConstructionProfile,
  rule: ConstructionRuleEntry,
  affinityIndex: AffinityDefinitionIndex | null,
  affinityProfile: CharacterAffinityProfile | null,
  governingAffinity: ProwessDefinitionRef | null,
  p: Problems,
): { slots: number; groups: Array<{ definition: ProwessDefinitionRef; uses: OrderedComponentUse[]; stackable: boolean; limit: number | null }> } {
  const groups: Array<{ definition: ProwessDefinitionRef; uses: OrderedComponentUse[]; stackable: boolean; limit: number | null }> = [];
  for (const use of composition.effects) {
    let group = groups.find((g) => g.definition.entityId === use.definition.entityId && g.definition.entityVersionId === use.definition.entityVersionId);
    if (group === undefined) {
      const envelope = componentEnvelope(bundle, use.definition, p, ["subject", "composition", "effects", use.componentKey]);
      if (envelope === null) continue;
      const stacking = stackRule(envelope, p);
      if (stacking === null) continue;
      const limit = stacking.stackable
        ? resolveStackLimit(stacking.limit, character, rule, affinityIndex, affinityProfile, governingAffinity, p, ["definitions", envelope.canonicalKey, "rules", "stacking", "limit"])
        : null;
      group = { definition: use.definition, uses: [], stackable: stacking.stackable, limit };
      groups.push(group);
    }
    group.uses.push(use);
  }
  return { slots: groups.reduce((count, group) => count + (group.stackable ? 1 : group.uses.length), 0), groups };
}

function mergeJsonFacts(target: { ranks: JsonObject[]; ownedEntityIds: string[] }, source: JsonObject): void {
  const ranks = source.ranks;
  if (Array.isArray(ranks)) {
    for (const raw of ranks) {
      if (!isPlainObject(raw)) continue;
      const fact = raw as JsonObject;
      const key = fact.key;
      if (typeof key === "string" && !target.ranks.some((x) => x.key === key)) target.ranks.push(fact);
    }
  }
  const ids = source.ownedEntityIds;
  if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string" && !target.ownedEntityIds.includes(id)) target.ownedEntityIds.push(id);
}

function componentPrerequisite(
  value: unknown,
  character: CharacterAbilityConstructionProfile,
  ladder: ProwessDefinitionEnvelope,
  affinityIndex: AffinityDefinitionIndex | null,
  affinityProfile: CharacterAffinityProfile | null,
  p: Problems,
  at: readonly (string | number)[],
): ParsedPrerequisite | null {
  const r = readRecord(value, at, p, A.INVALID_COMPONENT_REQUIREMENT, ["kind", "children", "skillKey", "minimumRank", "affinityKey"], ["kind"]);
  if (r === null) return null;
  const kind = own(r, "kind");
  if (kind === "ALL" || kind === "ANY") {
    const rawChildren = own(r, "children");
    if (!Array.isArray(rawChildren) || rawChildren.length === 0) {
      p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "children"], `${kind} prerequisite has at least one child`);
      return null;
    }
    const children: JsonObject[] = [];
    const merged = { ranks: [] as JsonObject[], ownedEntityIds: [] as string[] };
    const definitions: ProwessDefinitionRef[] = [];
    rawChildren.forEach((child: unknown, i: number) => {
      const parsed = componentPrerequisite(child, character, ladder, affinityIndex, affinityProfile, p, [...at, "children", i]);
      if (parsed === null) return;
      children.push(parsed.node);
      mergeJsonFacts(merged, parsed.facts);
      for (const d of parsed.definitions) if (!definitions.some((x) => x.entityVersionId === d.entityVersionId)) definitions.push(d);
    });
    return { node: { kind, children, provenance: null }, facts: { ...emptyFacts(), ranks: merged.ranks, ownedEntityIds: merged.ownedEntityIds }, definitions };
  }
  if (kind === "SKILL_RANK") {
    const skillKey = own(r, "skillKey");
    const minimumRank = readEnum(own(r, "minimumRank"), ABILITY_CONSTRUCTION_SKILL_RANKS, [...at, "minimumRank"], p, A.INVALID_COMPONENT_REQUIREMENT, "minimum Skill rank");
    if (!isExactCanonicalKey(skillKey)) p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "skillKey"], "skillKey is exact");
    if (!isExactCanonicalKey(skillKey) || minimumRank === null) return null;
    const actual = rankFact(ladder, character, skillKey);
    return {
      node: { kind: "RANK_AT_LEAST", factKey: actual.key, requiredRankKey: minimumRank, requiredOrder: rankOrder(ladder, minimumRank), provenance: null },
      facts: { ...emptyFacts(), ranks: [actual] },
      definitions: [definitionRefOf(ladder)],
    };
  }
  if (kind === "AFFINITY_RANK") {
    const affinityKey = own(r, "affinityKey");
    const affinityRanks = ["NONE", "TRAINED", "EXPERT", "MASTER"] as const;
    const minimumRank = readEnum(own(r, "minimumRank"), affinityRanks, [...at, "minimumRank"], p, A.INVALID_COMPONENT_REQUIREMENT, "minimum Affinity Rank");
    if (!isExactCanonicalKey(affinityKey)) p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "affinityKey"], "affinityKey is exact");
    if (!isExactCanonicalKey(affinityKey) || minimumRank === null || affinityIndex === null) return null;
    const entry = affinityIndex.affinities.find((a) => a.ref.canonicalKey === affinityKey) ?? null;
    if (entry === null) {
      p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "affinityKey"], "Affinity must resolve in this exact Ruleset");
      return null;
    }
    const owned = affinityProfile === null ? null : ownedAffinity(affinityProfile, entry.ref);
    const ownedIds = affinityProfile?.affinities.map((a) => a.affinity.entityId) ?? [];
    const children: JsonObject[] = [{ kind: "ENTITY_OWNED", entityId: entry.ref.entityId, provenance: provenanceJson(entry.provenance) }];
    const rankFacts: JsonObject[] = [];
    if (owned !== null) {
      const actual = affinityRankEntry(affinityIndex, owned.rank);
      const required = affinityRankEntry(affinityIndex, minimumRank);
      const factKey = `affinity-rank:${entry.ref.entityVersionId}`;
      rankFacts.push({ key: factKey, rankKey: owned.rank, order: actual.order, provenance: provenanceJson(affinityIndex.rankRule.provenance) });
      children.push({ kind: "RANK_AT_LEAST", factKey, requiredRankKey: minimumRank, requiredOrder: required.order, provenance: provenanceJson(affinityIndex.rankRule.provenance) });
    }
    return {
      node: { kind: "ALL", children, provenance: provenanceJson(entry.provenance) },
      facts: { ...emptyFacts(), ranks: rankFacts, ownedEntityIds: ownedIds },
      definitions: [entry.ref, affinityIndex.rankRule.ref],
    };
  }
  p.add(A.INVALID_COMPONENT_REQUIREMENT, [...at, "kind"], `unsupported prerequisite kind ${JSON.stringify(kind)}`);
  return null;
}

function requirementFromDefinition(
  envelope: ProwessDefinitionEnvelope,
  character: CharacterAbilityConstructionProfile,
  ladder: ProwessDefinitionEnvelope,
  affinityIndex: AffinityDefinitionIndex | null,
  affinityProfile: CharacterAffinityProfile | null,
  p: Problems,
): ParsedPrerequisite | null {
  const rules = (envelope.payload as { rules?: unknown }).rules;
  if (!isPlainObject(rules)) return null;
  const raw = own(rules, "accessRequirements");
  return raw === undefined || raw === null ? null : componentPrerequisite(raw, character, ladder, affinityIndex, affinityProfile, p, ["definitions", envelope.canonicalKey, "rules", "accessRequirements"]);
}

function keywordContributions(
  componentKey: string,
  envelope: ProwessDefinitionEnvelope,
  catalog: KeywordCatalog,
  bundle: ProwessDefinitionBundle,
  p: Problems,
): JsonObject[] {
  const keys = (envelope.payload as { keywords?: readonly string[] }).keywords ?? [];
  const provenance = provenanceJson(provenanceOf(bundle, envelope));
  const contract = PROWESS_DEFINITION_KINDS[envelope.definitionKind].contract;
  const sourceType = contract === null ? "prowess.component" : `prowess.${contract.toLowerCase()}`;
  const out: JsonObject[] = [];
  keys.forEach((key, ordinal) => {
    const ref = keywordReference(catalog, key);
    if (ref === null) {
      p.add(A.INVALID_COMPONENT_REQUIREMENT, ["definitions", envelope.canonicalKey, "keywords", ordinal], `${key} has no exact M1 Keyword reference`);
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

function affinityAlignmentNodes(entry: AffinityEntry, catalog: KeywordCatalog, p: Problems): JsonObject[] {
  const nodes: JsonObject[] = [];
  const appendAny = (keys: readonly string[]) => {
    const children: JsonObject[] = [];
    for (const key of keys) {
      const ref = keywordReference(catalog, key);
      if (ref === null) {
        p.add(A.INVALID_COMPONENT_REQUIREMENT, ["definitions", entry.ref.canonicalKey], `${key} has no exact M1 Keyword reference`);
        continue;
      }
      children.push({ kind: "KEYWORD_PRESENT", keywordId: ref.keywordId, canonicalKey: null, provenance: provenanceJson(entry.provenance) });
    }
    if (children.length === 1) nodes.push(children[0] as JsonObject);
    else if (children.length > 1) nodes.push({ kind: "ANY", children, provenance: provenanceJson(entry.provenance) });
  };
  entry.payload.strengths.forEach((r) => appendAny(r.matchAny));
  entry.payload.weaknesses.forEach((r) => appendAny(r.matchAny));
  return nodes;
}

export function compileAbilityConstruction(request: unknown): ProwessOutcome<ProwessAbilityConstructionCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, X.INVALID_REQUEST, REQUEST_FIELDS, REQUEST_FIELDS);
  if (r === null) return finish(p, () => null as never);

  const contractVersion = own(r, "contractVersion");
  if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], "unsupported Prowess compilation contract version");

  const ruleset = createRulesetContext(own(r, "ruleset"));
  const rawBundle = own(r, "definitions");
  let bundle: ProwessDefinitionBundle | null = null;
  if (!ruleset.ok) p.add(X.INVALID_REQUEST, ["ruleset"], "an exact valid RulesetContext is required");
  else if (!isPlainObject(rawBundle)) p.add(X.INVALID_REQUEST, ["definitions"], "definitions is the exact ProwessDefinitionBundle");
  else {
    const rebuilt = createProwessDefinitionBundle({ ruleset: own(r, "ruleset"), definitions: own(rawBundle, "definitions") ?? null });
    if (!rebuilt.ok) for (const problem of rebuilt.problems) p.list.push({ ...problem, path: `/definitions${problem.path}` });
    else if (!bundleMatchesRuleset({ rulesetProvenance: own(rawBundle, "rulesetProvenance") as ProwessRulesetProvenance, definitions: [] }, ruleset.value)) p.add(X.BUNDLE_RULESET_MISMATCH, ["definitions", "rulesetProvenance"], "bundle belongs to a different Ruleset");
    else bundle = rebuilt.value;
  }

  const subjectRaw = readRecord(own(r, "subject"), ["subject"], p, A.INVALID_REQUEST, SUBJECT_FIELDS, SUBJECT_FIELDS);
  const catalog = readKeywordCatalog(own(r, "keywords"), ["keywords"], p);
  if (bundle === null || !ruleset.ok || subjectRaw === null || catalog === null || p.count > 0) return finish(p, () => null as never);

  if (own(subjectRaw, "kind") !== "ABILITY_CONSTRUCTION") p.add(A.INVALID_REQUEST, ["subject", "kind"], "kind is ABILITY_CONSTRUCTION");
  const subjectKey = own(subjectRaw, "subjectKey");
  if (!isExactLabel(subjectKey)) p.add(A.INVALID_REQUEST, ["subject", "subjectKey"], "subjectKey is an exact label");
  const compositionOutcome = validateAbilityComposition(own(subjectRaw, "composition"), { bundle });
  if (!compositionOutcome.ok) for (const problem of compositionOutcome.problems) p.list.push({ ...problem, path: `/subject/composition${problem.path}` });
  const character = readProfile(own(subjectRaw, "character"), p);
  const signature = readSignature(own(subjectRaw, "signature"), p);
  if (!compositionOutcome.ok || character === null || signature === null || !isExactLabel(subjectKey) || p.count > 0) return finish(p, () => null as never);

  const composition = compositionOutcome.value;
  const grants = readGrants(own(subjectRaw, "accessGrants"), composition, p);
  const ladder = findSkillLadder(bundle, p);
  const constructionRule = findConstructionRule(bundle, p);
  if (ladder === null || constructionRule === null || p.count > 0) return finish(p, () => null as never);

  let affinityIndex: AffinityDefinitionIndex | null = null;
  let affinityProfile: CharacterAffinityProfile | null = null;
  const indexed = indexAffinityDefinitions(bundle);
  if (indexed.ok) {
    affinityIndex = indexed.value;
    affinityProfile = validatedAffinityProfile(character.affinityProfile, bundle, affinityIndex, p);
  } else if (composition.abilityKind === "SPELL" && composition.authority !== null && own(composition.authority, "authority") === "AFFINITY_AUTHORITY") {
    for (const problem of indexed.problems) p.list.push(problem);
  }
  if (p.count > 0) return finish(p, () => null as never);

  const fragments: CompilationFragment[] = [];
  const components = new Map<string, readonly ProwessDefinitionRef[]>();
  components.set(CONSTRUCTION_RULE, [constructionRule.ref]);
  for (const c of compositionComponents(composition)) components.set(c.use.componentKey, [c.use.definition]);
  if (affinityIndex !== null) components.set(AFFINITY_RANK_RULE, [affinityIndex.rankRule.ref]);

  const emit = (fragment: CompilationFragment) => fragments.push(fragment);
  const emitRequirement = (
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
  const emitFormula = (fragmentKey: string, expression: string, variables: Record<string, number>, role: string) => {
    emit({
      fragmentKey,
      order: ORDER.FORMULA,
      operation: "FORMULA",
      input: { program: { expression, rounding: "NONE", minimum: null, maximum: null, unit: null, provenance: provenanceJson(constructionRule.provenance) }, variables },
      bindings: [],
      role,
      componentKeys: [CONSTRUCTION_RULE],
      definitions: [constructionRule.ref],
    });
    return fragmentKey;
  };

  let authority: SpellConstructionAuthority | "MARTIAL" = "MARTIAL";
  let authorityRank: AbilityConstructionSkillRank | AffinityRank = "UNTRAINED";
  let baseEffects = 0;
  let baseTraits = 0;
  let traitTrades = 0;
  let maximumTraitTrades = 0;
  let maneuverConditionCapacity: number | null = null;
  let governingAffinity: ProwessDefinitionRef | null = null;
  let authorityStep = "";
  const affinityAccess: Array<{ componentKey: string; keywordStepKey: string; requirementStepKey: string }> = [];

  if (composition.abilityKind === "SPELL") {
    const parsed = readSpellAuthority(composition, p);
    if (parsed === null) return finish(p, () => null as never);
    authority = parsed.authority;
    traitTrades = parsed.traitTrades;

    if (authority === "ARCANE_AUTHORITY") {
      authorityRank = skillRank(character, ARCANA_SKILL_KEY);
      const row = constructionRank(constructionRule, authorityRank);
      baseEffects = row.arcane.effectCapacity;
      baseTraits = row.arcane.traitCapacity;
      maximumTraitTrades = row.arcane.maximumTraitTrades;
      const fact = rankFact(ladder, character, ARCANA_SKILL_KEY);
      authorityStep = emitRequirement(
        "authority.arcane",
        ORDER.ACCESS,
        { kind: "RANK_AT_LEAST", factKey: fact.key, requiredRankKey: constructionRule.payload.spellAccess.minimumArcaneRank, requiredOrder: rankOrder(ladder, constructionRule.payload.spellAccess.minimumArcaneRank), provenance: provenanceJson(constructionRule.provenance) },
        { ...emptyFacts(), ranks: [fact] },
        "spell-arcane-authority-access",
        [CONSTRUCTION_RULE],
        [constructionRule.ref],
      );
    } else {
      if (composition.affinity === null || affinityIndex === null) {
        p.add(A.GOVERNING_AFFINITY_REQUIRED, ["subject", "composition", "affinity"], "Affinity Authority requires one governing Affinity");
        return finish(p, () => null as never);
      }
      if (affinityProfile === null) {
        p.add(A.AFFINITY_PROFILE_REQUIRED, ["subject", "character", "affinityProfile"], "Affinity Authority requires the exact Affinity profile");
        return finish(p, () => null as never);
      }
      governingAffinity = composition.affinity.definition;
      const entry = findAffinityEntry(affinityIndex, governingAffinity);
      const owned = entry === null ? null : ownedAffinity(affinityProfile, governingAffinity);
      if (entry === null) p.add(A.GOVERNING_AFFINITY_REQUIRED, ["subject", "composition", "affinity"], "governing Affinity must be executable in this Ruleset");
      if (entry !== null && owned === null) p.add(A.GOVERNING_AFFINITY_NOT_OWNED, ["subject", "composition", "affinity"], "governing Affinity must be owned exactly");
      if (entry === null || owned === null) return finish(p, () => null as never);

      components.set(GOVERNING_AFFINITY, [entry.ref]);
      authorityRank = owned.rank;
      const row = affinityRankEntry(affinityIndex, owned.rank);
      const minimum = affinityRankEntry(affinityIndex, constructionRule.payload.spellAccess.minimumAffinityRank);
      baseEffects = row.authority?.effectCapacity ?? 0;
      baseTraits = row.authority?.traitCapacity ?? 0;
      maximumTraitTrades = constructionRank(constructionRule, owned.rank === "NONE" ? "UNTRAINED" : owned.rank).arcane.maximumTraitTrades;
      const factKey = `affinity-rank:${entry.ref.entityVersionId}`;
      authorityStep = emitRequirement(
        "authority.affinity",
        ORDER.ACCESS,
        { kind: "RANK_AT_LEAST", factKey, requiredRankKey: constructionRule.payload.spellAccess.minimumAffinityRank, requiredOrder: minimum.order, provenance: provenanceJson(affinityIndex.rankRule.provenance) },
        { ...emptyFacts(), ranks: [{ key: factKey, rankKey: owned.rank, order: row.order, provenance: provenanceJson(affinityIndex.rankRule.provenance) }] },
        "spell-affinity-authority-access",
        [GOVERNING_AFFINITY, AFFINITY_RANK_RULE, CONSTRUCTION_RULE],
        [entry.ref, affinityIndex.rankRule.ref, constructionRule.ref],
      );

      const alignmentNodes = affinityAlignmentNodes(entry, catalog, p);
      const grantMembers = grants.map((g) => g.componentKey);
      for (const c of compositionComponents(composition)) {
        if (c.slot === "affinity") continue;
        const envelope = componentEnvelope(bundle, c.use.definition, p, ["subject", "composition", c.use.componentKey]);
        if (envelope === null) continue;
        const keywordStep = `affinity.component_keywords.${c.use.componentKey}`;
        emit({
          fragmentKey: keywordStep,
          order: ORDER.ACCESS,
          operation: "KEYWORD",
          input: { contributions: keywordContributions(c.use.componentKey, envelope, catalog, bundle, p) },
          bindings: [],
          role: "affinity-authority-component-keywords",
          componentKeys: [c.use.componentKey],
          definitions: [c.use.definition],
        });
        const requirementStep = `affinity.component_access.${c.use.componentKey}`;
        emitRequirement(
          requirementStep,
          ORDER.ACCESS + 1,
          { kind: "ANY", children: [...alignmentNodes, { kind: "SET_CONTAINS", factKey: GRANTS_FACT, member: c.use.componentKey, provenance: provenanceJson(entry.provenance) }], provenance: provenanceJson(entry.provenance) },
          { ...emptyFacts(), sets: [{ key: GRANTS_FACT, members: grantMembers, provenance: null }] },
          "affinity-authority-component-access",
          [GOVERNING_AFFINITY, c.use.componentKey],
          [entry.ref, c.use.definition],
          [{ target: "/facts/keywords", source: { kind: "FRAGMENT", fragmentKey: keywordStep, pointer: "/data" } }],
        );
        affinityAccess.push({ componentKey: c.use.componentKey, keywordStepKey: keywordStep, requirementStepKey: requirementStep });
      }
    }
  } else {
    authority = "MARTIAL";
    authorityRank = skillRank(character, MARTIAL_SKILL_KEY);
    const row = constructionRank(constructionRule, authorityRank);
    baseEffects = row.martial.effectCapacity;
    baseTraits = row.martial.traitCapacity;
    maneuverConditionCapacity = row.martial.maneuverConditionCapacity;
    const fact = rankFact(ladder, character, MARTIAL_SKILL_KEY);
    authorityStep = emitRequirement(
      "authority.martial",
      ORDER.ACCESS,
      { kind: "RANK_AT_LEAST", factKey: fact.key, requiredRankKey: "TRAINED", requiredOrder: rankOrder(ladder, "TRAINED"), provenance: provenanceJson(constructionRule.provenance) },
      { ...emptyFacts(), ranks: [fact] },
      "maneuver-martial-access",
      [CONSTRUCTION_RULE],
      [constructionRule.ref],
    );
  }
  if (p.count > 0) return finish(p, () => null as never);

  const groups = effectSlotGroups(composition, bundle, character, constructionRule, affinityIndex, affinityProfile, governingAffinity, p);
  if (p.count > 0) return finish(p, () => null as never);
  const effectSlotsUsed = groups.slots;
  const traitSlotsUsed = composition.traits.length;
  const conditionSlotsUsed = composition.conditions.length;
  const arcaneRank = skillRank(character, ARCANA_SKILL_KEY);
  const castingConditionCapacity = constructionRank(constructionRule, arcaneRank).arcane.castingConditionCapacity;

  const effectiveEffectsFormula = emitFormula("capacity.effective_effects", "base - trades", { base: baseEffects, trades: traitTrades }, "effective-effect-capacity");
  const effectiveTraitsFormula = emitFormula("capacity.effective_traits", "base + trades", { base: baseTraits, trades: traitTrades }, "effective-trait-capacity");
  const minimumEffectStep = emitRequirement(
    "capacity.minimum_effect",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "effect_slots_used", operator: ">=", expected: constructionRule.payload.spellAccess.minimumEffects, provenance: provenanceJson(constructionRule.provenance) },
    { ...emptyFacts(), numeric: [{ key: "effect_slots_used", value: effectSlotsUsed, provenance: null }] },
    "minimum-one-effect",
    [CONSTRUCTION_RULE],
    [constructionRule.ref],
  );
  const traitTradeStep = emitRequirement(
    "capacity.trait_trades",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "trait_trades", operator: "<=", expected: composition.abilityKind === "SPELL" ? maximumTraitTrades : 0, provenance: provenanceJson(constructionRule.provenance) },
    { ...emptyFacts(), numeric: [{ key: "trait_trades", value: traitTrades, provenance: null }] },
    "spell-only-trait-exchange-limit",
    [CONSTRUCTION_RULE],
    [constructionRule.ref],
  );
  const effectCapacityStep = emitRequirement(
    "capacity.effects",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "effect_slots_used", operator: "<=", expected: 0, provenance: provenanceJson(constructionRule.provenance) },
    { ...emptyFacts(), numeric: [{ key: "effect_slots_used", value: effectSlotsUsed, provenance: null }] },
    "effect-capacity",
    [CONSTRUCTION_RULE],
    [constructionRule.ref],
    [{ target: "/requirement/expected", source: { kind: "FRAGMENT", fragmentKey: effectiveEffectsFormula, pointer: "/data/finalValue" } }],
  );
  const traitCapacityStep = emitRequirement(
    "capacity.traits",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "trait_slots_used", operator: "<=", expected: 0, provenance: provenanceJson(constructionRule.provenance) },
    { ...emptyFacts(), numeric: [{ key: "trait_slots_used", value: traitSlotsUsed, provenance: null }] },
    "trait-capacity",
    [CONSTRUCTION_RULE],
    [constructionRule.ref],
    [{ target: "/requirement/expected", source: { kind: "FRAGMENT", fragmentKey: effectiveTraitsFormula, pointer: "/data/finalValue" } }],
  );
  const conditionCapacity = composition.abilityKind === "SPELL" ? castingConditionCapacity : (maneuverConditionCapacity ?? 0);
  const conditionCapacityStep = emitRequirement(
    "capacity.conditions",
    ORDER.CAPACITY,
    { kind: "NUMERIC_COMPARE", factKey: "condition_slots_used", operator: "<=", expected: conditionCapacity, provenance: provenanceJson(constructionRule.provenance) },
    { ...emptyFacts(), numeric: [{ key: "condition_slots_used", value: conditionSlotsUsed, provenance: null }] },
    composition.abilityKind === "SPELL" ? "casting-condition-capacity-from-arcane-rank" : "maneuver-condition-capacity-from-martial-rank",
    [CONSTRUCTION_RULE],
    [constructionRule.ref],
  );

  const stackGroups: AbilityConstructionStackGroup[] = [];
  const stackRequirementFragments: string[] = [];
  groups.groups.forEach((group, index) => {
    let requirementStepKey: string | null = null;
    if (group.stackable && group.limit !== null) {
      const sourceKey = `construction.stack.${index}`;
      components.set(sourceKey, [group.definition]);
      const fragmentKey = `stack.${index}`;
      requirementStepKey = emitRequirement(
        fragmentKey,
        ORDER.STACK,
        { kind: "NUMERIC_COMPARE", factKey: `stack_count_${index}`, operator: "<=", expected: group.limit, provenance: null },
        { ...emptyFacts(), numeric: [{ key: `stack_count_${index}`, value: group.uses.length, provenance: null }] },
        "explicit-effect-stack-limit",
        [sourceKey],
        [group.definition],
      );
      stackRequirementFragments.push(fragmentKey);
    }
    stackGroups.push({
      definition: group.definition,
      componentKeys: group.uses.map((u) => u.componentKey),
      stackable: group.stackable,
      slotCount: group.stackable ? 1 : group.uses.length,
      limit: group.limit,
      requirementStepKey,
    });
  });

  const componentRequirementFragments: Array<{ componentKey: string; stepKey: string }> = [];
  for (const c of compositionComponents(composition)) {
    if (c.slot === "affinity") continue;
    const envelope = componentEnvelope(bundle, c.use.definition, p, ["subject", "composition", c.use.componentKey]);
    if (envelope === null) continue;
    const parsed = requirementFromDefinition(envelope, character, ladder, affinityIndex, affinityProfile, p);
    if (parsed === null) continue;
    const definitions = [c.use.definition, ...parsed.definitions.filter((d) => d.entityVersionId !== c.use.definition.entityVersionId)];
    const sourceKey = `construction.prerequisite.${c.use.componentKey}`;
    components.set(sourceKey, definitions);
    const fragmentKey = `prerequisite.${c.use.componentKey}`;
    emitRequirement(fragmentKey, ORDER.COMPONENT_REQUIREMENT, parsed.node, parsed.facts, "component-access-prerequisite", [sourceKey], definitions);
    componentRequirementFragments.push({ componentKey: c.use.componentKey, stepKey: fragmentKey });
  }
  if (p.count > 0) return finish(p, () => null as never);

  const signatureSlotUse = signature.exemption === null ? constructionRule.payload.signature.defaultSlotsPerAbility : 0;
  const signatureFormula = emitFormula("signature.projected", "used + candidate", { used: character.signatureSlotsUsed, candidate: signatureSlotUse }, "projected-signature-slot-use");
  const signatureStep = emitRequirement(
    "signature.capacity",
    ORDER.SIGNATURE,
    { kind: "NUMERIC_COMPARE", factKey: "projected_signature_slots", operator: "<=", expected: character.prowess, provenance: provenanceJson(constructionRule.provenance) },
    { ...emptyFacts(), numeric: [{ key: "projected_signature_slots", value: 0, provenance: null }] },
    "signature-ability-capacity",
    [CONSTRUCTION_RULE],
    [constructionRule.ref],
    [{ target: "/facts/numeric/0/value", source: { kind: "FRAGMENT", fragmentKey: signatureFormula, pointer: "/data/finalValue" } }],
  );

  const assembled = assembleFragments({ subjectKind: "ABILITY_CONSTRUCTION", subjectKey, components: components as SubjectComponents, bundle, fragments }, p);
  if (p.count > 0) return finish(p, () => null as never);
  const stepKey = (fragmentKey: string) => compiledStepKey("ABILITY_CONSTRUCTION", subjectKey, fragmentKey);
  const requirementFragments = [
    authorityStep,
    minimumEffectStep,
    traitTradeStep,
    effectCapacityStep,
    traitCapacityStep,
    conditionCapacityStep,
    ...stackRequirementFragments,
    ...componentRequirementFragments.map((x) => x.stepKey),
    ...affinityAccess.map((x) => x.requirementStepKey),
    signatureStep,
  ];

  return finish(p, () => deepFreeze({
    contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION,
    subject: { kind: "ABILITY_CONSTRUCTION" as const, subjectKey, abilityKind: composition.abilityKind, compositionKey: composition.compositionKey },
    rulesetProvenance: bundle.rulesetProvenance,
    evaluationPlan: { steps: assembled.steps, primaryStepKey: stepKey(signatureStep), validationStepKey: null, explanationStepKey: null },
    sourceMap: { entries: assembled.entries },
    outputs: {
      authorityStepKey: stepKey(authorityStep),
      minimumEffectStepKey: stepKey(minimumEffectStep),
      traitTradeStepKey: stepKey(traitTradeStep),
      effectCapacityStepKey: stepKey(effectCapacityStep),
      traitCapacityStepKey: stepKey(traitCapacityStep),
      conditionCapacityStepKey: stepKey(conditionCapacityStep),
      signatureStepKey: stepKey(signatureStep),
      requirementStepKeys: requirementFragments.map(stepKey),
      capacity: {
        authority,
        authorityRank,
        baseEffectCapacity: baseEffects,
        baseTraitCapacity: baseTraits,
        traitTrades,
        effectSlotsUsed,
        traitSlotsUsed,
        conditionSlotsUsed,
        castingConditionCapacity,
        maneuverConditionCapacity,
        effectiveEffectCapacityStepKey: stepKey(effectiveEffectsFormula),
        effectiveTraitCapacityStepKey: stepKey(effectiveTraitsFormula),
      },
      stackGroups: stackGroups.map((g) => ({ ...g, requirementStepKey: g.requirementStepKey === null ? null : stepKey(g.requirementStepKey) })),
      componentRequirementStepKeys: componentRequirementFragments.map((x) => ({ componentKey: x.componentKey, stepKey: stepKey(x.stepKey) })),
      affinityAccessStepKeys: affinityAccess.map((x) => ({ componentKey: x.componentKey, keywordStepKey: stepKey(x.keywordStepKey), requirementStepKey: stepKey(x.requirementStepKey) })),
      signatureSlotUse,
      constructionRule: constructionRule.ref,
    },
  }));
}

export function readAbilityConstructionRun(plan: ProwessAbilityConstructionCompiledPlan, run: EvaluationRun): ProwessOutcome<AbilityConstructionRunReading> {
  const p = new Problems();
  if (!checkPlainData(run, ["run"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const requirements: AbilityConstructionRequirementReading[] = [];
  for (const requiredStepKey of plan.outputs.requirementStepKeys) {
    const step = run.steps.find((x) => x.stepKey === requiredStepKey);
    if (step === undefined || step.executionStatus !== "EXECUTED" || step.response === null || step.response.status === "INVALID") {
      p.add(A.INCOMPLETE_RUN, ["run", "steps"], `required construction step ${requiredStepKey} did not execute to a valid Requirement response`);
      continue;
    }
    const data = step.response.data as { satisfied?: unknown } | null;
    if (data === null || typeof data.satisfied !== "boolean") {
      p.add(A.INCOMPLETE_RUN, ["run", "steps"], `step ${requiredStepKey} is not an M4 Requirement response`);
      continue;
    }
    requirements.push({ stepKey: requiredStepKey, satisfied: data.satisfied });
  }
  return finish(p, () => ({ legal: requirements.every((x) => x.satisfied), requirements }));
}
