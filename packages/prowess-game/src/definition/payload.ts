import type { JsonObject } from "@prowess/model";
import { isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isExactCanonicalKey, isExactLabel, isToken, own, readEnum, readRecord } from "../internal/problems.js";
import { ABILITY_COMPONENT_CONTRACTS, isProwessDefinitionKind, type AbilityComponentContract, type ProwessDefinitionKind } from "../vocabulary/families.js";
import {
  CANONICAL_AFFINITIES,
  COST_CURRENCIES,
  DURATION_CONCEPTS,
  RESOLUTION_MODES,
  TARGETING_SEMANTIC_SHAPES,
  TRAIT_SCOPES,
  type CanonicalAffinity,
  type CostCurrency,
  type DurationConcept,
  type ResolutionMode,
  type TargetingSemanticShape,
  type TraitScope,
} from "../vocabulary/construction.js";
import { legacyTermFor } from "../vocabulary/terminology.js";
import { DEFINITION_ERROR_CODES } from "./codes.js";

/**
 * Version-1 payload contracts of the SHARED Ability Construction components (PAS-10 M5-WO1 §25–53, §83).
 *
 * These are STRUCTURAL contracts: they name what a Definition is made of so later Work Orders can compile it. They
 * deliberately hold no executable rule: cost contributions, parameters, outcomes and branch rules are authored plain
 * data that WO1 validates for shape and never interprets (§58, §107, §144). Branch-specific Definition kinds
 * (SPELL_EFFECT / MANEUVER_EFFECT …) implement the same contract and stay separate kinds (§83, M5-I033–I034).
 */

/** A cost contribution names a currency and carries authored data. No amount is computed here (§58–61). */
export interface CostContribution {
  readonly contributionKey: string;
  readonly currency: CostCurrency;
  readonly data: JsonObject;
}

/** Structural compatibility metadata (§115). The full compatibility catalog is a later Work Order. */
export interface CompatibilityRule {
  readonly relation: AbilityComponentContract | "AFFINITY" | "ABILITY_KIND" | "KEYWORD";
  readonly allow: readonly string[];
}

interface ComponentCommon {
  readonly keywords: readonly string[];
  readonly parameters: JsonObject;
  readonly compatibility: readonly CompatibilityRule[];
  readonly costContributions: readonly CostContribution[];
  /** Branch-specific authored rule data reserved for the owning later Work Order. Opaque to WO1. */
  readonly rules: JsonObject;
}

/** Targeting answers WHERE / WHO / HOW FAR / WHAT SHAPE / HOW MANY / FROM WHERE — never WHAT HAPPENS (§26). */
export interface TargetingDefinitionPayload extends ComponentCommon {
  readonly semanticShape: TargetingSemanticShape;
  /** Named geometry / delivery / placement parameters (origin, range, area, target count …), authored data only. */
  readonly geometry: JsonObject;
}

/** An Effect describes an outcome (§32). Resolution is metadata the branch rules interpret later (§57). */
export interface EffectDefinitionPayload extends ComponentCommon {
  readonly effectFamily: string;
  readonly resolution: { readonly mode: ResolutionMode; readonly data: JsonObject } | null;
  readonly outcomes: readonly { readonly outcomeKey: string; readonly data: JsonObject }[];
}

/** A Trait MODIFIES an explicitly scoped part of an Ability (§43–46). It never creates unstated mechanics. */
export interface TraitDefinitionPayload extends ComponentCommon {
  readonly traitFamily: string;
  readonly scope: TraitScope;
}

export interface DurationDefinitionPayload extends ComponentCommon {
  readonly durationConcept: DurationConcept;
}

/**
 * An Ability Condition is an authored restriction-for-tradeoff on USING an Ability (§50, §53). It is never a state
 * applied to a target (§125, M5-I040): a payload that tries to apply a status is rejected.
 */
export interface AbilityConditionDefinitionPayload extends ComponentCommon {
  readonly restriction: { readonly restrictionKey: string; readonly data: JsonObject };
  readonly tradeoff: JsonObject;
}

export interface AffinityDefinitionPayload {
  readonly affinity: CanonicalAffinity;
}

const COMMON_FIELDS = ["keywords", "parameters", "compatibility", "costContributions", "rules"];
const PAYLOAD_FIELDS: Readonly<Record<AbilityComponentContract, readonly string[]>> = {
  TARGETING: [...COMMON_FIELDS, "semanticShape", "geometry"],
  EFFECT: [...COMMON_FIELDS, "effectFamily", "resolution", "outcomes"],
  TRAIT: [...COMMON_FIELDS, "traitFamily", "scope"],
  DURATION: [...COMMON_FIELDS, "durationConcept"],
  ABILITY_CONDITION: [...COMMON_FIELDS, "restriction", "tradeoff"],
  FOUNDATION: [],
};
const PAYLOAD_REQUIRED: Readonly<Record<AbilityComponentContract, readonly string[]>> = {
  TARGETING: ["semanticShape"],
  EFFECT: ["effectFamily"],
  TRAIT: ["traitFamily", "scope"],
  DURATION: ["durationConcept"],
  ABILITY_CONDITION: ["restriction"],
  FOUNDATION: [],
};

/**
 * Keys a TARGETING payload may never carry at any depth: Targeting decides delivery, never the outcome or the
 * resolution (§26–27, §135, M5-I022). A Radius cannot smuggle in Damage or an Agility Save.
 */
export const TARGETING_FORBIDDEN_KEYS = Object.freeze([
  "effect",
  "effects",
  "outcome",
  "outcomes",
  "resolution",
  "save",
  "saves",
  "saveStat",
  "savingThrow",
  "attackRoll",
  "damage",
  "healing",
  "condition",
  "conditions",
  "status",
  "statuses",
  "movement",
]);

/** Keys an Ability Condition may never carry: a construction restriction does not apply a status (§125, §230). */
export const ABILITY_CONDITION_FORBIDDEN_KEYS = Object.freeze(["appliesStatus", "applyStatus", "appliedStatus", "statusEffect", "statusCondition", "inflicts", "inflictsStatus"]);

const C = DEFINITION_ERROR_CODES;

function readJsonObject(value: unknown, at: readonly PathSegment[], p: Problems, fallback: JsonObject | null = {}): JsonObject | null {
  if (value === undefined && fallback !== null) return fallback;
  if (!isPlainObject(value)) {
    p.add(C.INVALID_PAYLOAD, at, "expected a plain object of authored data");
    return null;
  }
  return value as JsonObject;
}

function readKeywords(value: unknown, at: readonly PathSegment[], p: Problems): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    p.add(C.INVALID_PAYLOAD, at, "keywords is an array of exact Keyword canonical keys");
    return [];
  }
  const out = new Set<string>();
  value.forEach((k: unknown, i: number) => {
    if (!isExactCanonicalKey(k)) p.add(C.INVALID_PAYLOAD, [...at, i], "a Keyword is referenced by its exact canonical key");
    else if (out.has(k)) p.add(C.INVALID_PAYLOAD, [...at, i], `duplicate Keyword ${k}`);
    else out.add(k);
  });
  return [...out].sort();
}

function readCompatibility(value: unknown, at: readonly PathSegment[], p: Problems): CompatibilityRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    p.add(C.INVALID_PAYLOAD, at, "compatibility is an array of { relation, allow } rules");
    return [];
  }
  const relations = [...ABILITY_COMPONENT_CONTRACTS, "AFFINITY", "ABILITY_KIND", "KEYWORD"] as const;
  return value.flatMap((item: unknown, i: number) => {
    const r = readRecord(item, [...at, i], p, C.INVALID_PAYLOAD, ["relation", "allow"], ["relation", "allow"]);
    if (r === null) return [];
    const relation = readEnum(own(r, "relation"), relations, [...at, i, "relation"], p, C.INVALID_PAYLOAD, "compatibility relation");
    const allow = own(r, "allow");
    if (!Array.isArray(allow) || !allow.every((a: unknown) => isExactLabel(a))) {
      p.add(C.INVALID_PAYLOAD, [...at, i, "allow"], "allow is an array of exact labels (canonical keys or vocabulary tokens)");
      return [];
    }
    return relation === null ? [] : [{ relation, allow: [...(allow as string[])].sort() }];
  });
}

function readCostContributions(value: unknown, at: readonly PathSegment[], p: Problems): CostContribution[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    p.add(C.INVALID_PAYLOAD, at, "costContributions is an array of { contributionKey, currency, data }");
    return [];
  }
  const keys = new Set<string>();
  const out = value.flatMap((item: unknown, i: number) => {
    const r = readRecord(item, [...at, i], p, C.INVALID_PAYLOAD, ["contributionKey", "currency", "data"], ["contributionKey", "currency"]);
    if (r === null) return [];
    const contributionKey = own(r, "contributionKey");
    if (!isExactLabel(contributionKey) || keys.has(contributionKey)) {
      p.add(C.INVALID_PAYLOAD, [...at, i, "contributionKey"], "contributionKey is an exact label, unique within the Definition");
      return [];
    }
    keys.add(contributionKey);
    const currency = readEnum(own(r, "currency"), COST_CURRENCIES, [...at, i, "currency"], p, C.INVALID_PAYLOAD, "cost currency");
    const data = readJsonObject(own(r, "data"), [...at, i, "data"], p);
    return currency === null || data === null ? [] : [{ contributionKey, currency, data }];
  });
  // Authored order is not semantic for a set of named contributions: canonical order is by key.
  return out.sort((a, b) => (a.contributionKey < b.contributionKey ? -1 : a.contributionKey > b.contributionKey ? 1 : 0));
}

function readToken(value: unknown, at: readonly PathSegment[], p: Problems, what: string): string | null {
  if (isToken(value)) return value;
  p.add(C.INVALID_PAYLOAD, at, `${what} is an explicit SCREAMING_SNAKE token`);
  return null;
}

/** Every key path in `value` whose key is in `forbidden` (depth-first, sorted keys — deterministic). */
function forbiddenKeyPaths(value: unknown, forbidden: readonly string[], at: readonly PathSegment[]): PathSegment[][] {
  if (Array.isArray(value)) return value.flatMap((v: unknown, i: number) => forbiddenKeyPaths(v, forbidden, [...at, i]));
  if (!isPlainObject(value)) return [];
  return Object.keys(value)
    .sort()
    .flatMap((k) => [...(forbidden.includes(k) ? [[...at, k]] : []), ...forbiddenKeyPaths(value[k], forbidden, [...at, k])]);
}

/**
 * Every string value or canonical-key segment in `value` that is a LEGACY source term (§7, §218): canonical structured
 * content uses the canonical term. Provenance (envelope `legacyTerms`) is the only place a legacy term is recorded.
 */
export function legacyTermUses(value: unknown, at: readonly PathSegment[]): { path: PathSegment[]; term: string; canonical: string }[] {
  if (typeof value === "string") {
    const hits = [value, ...value.split(".")]
      .map((candidate) => legacyTermFor(candidate))
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
    return hits.length === 0 ? [] : [{ path: [...at], term: hits[0]!.term, canonical: hits[0]!.canonicalTerm }];
  }
  if (Array.isArray(value)) return value.flatMap((v: unknown, i: number) => legacyTermUses(v, [...at, i]));
  if (!isPlainObject(value)) return [];
  return Object.keys(value)
    .sort()
    .flatMap((k) => legacyTermUses(value[k], [...at, k]));
}

function readCommon(r: Record<string, unknown>, at: readonly PathSegment[], p: Problems) {
  return {
    keywords: readKeywords(own(r, "keywords"), [...at, "keywords"], p),
    parameters: readJsonObject(own(r, "parameters"), [...at, "parameters"], p) ?? {},
    compatibility: readCompatibility(own(r, "compatibility"), [...at, "compatibility"], p),
    costContributions: readCostContributions(own(r, "costContributions"), [...at, "costContributions"], p),
    rules: readJsonObject(own(r, "rules"), [...at, "rules"], p) ?? {},
  };
}

/** Validates a version-1 payload of `contract` (structure only). Returns the canonicalized payload, or null. */
function readComponentPayload(contract: AbilityComponentContract, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const r = readRecord(value, at, p, C.INVALID_PAYLOAD, PAYLOAD_FIELDS[contract], PAYLOAD_REQUIRED[contract]);
  if (r === null) return null;
  const before = p.count;
  let payload: object | null = null;
  switch (contract) {
    case "TARGETING": {
      for (const path of forbiddenKeyPaths(r, TARGETING_FORBIDDEN_KEYS, at)) {
        p.add(C.TARGETING_IMPLIES_OUTCOME, path, "Targeting defines delivery geometry and placement only; Effects decide what happens and how it resolves");
      }
      const semanticShape = readEnum(own(r, "semanticShape"), TARGETING_SEMANTIC_SHAPES, [...at, "semanticShape"], p, C.INVALID_PAYLOAD, "targeting semantic shape");
      const geometry = readJsonObject(own(r, "geometry"), [...at, "geometry"], p);
      payload = { ...readCommon(r, at, p), semanticShape, geometry } satisfies Record<keyof TargetingDefinitionPayload, unknown>;
      break;
    }
    case "EFFECT": {
      const effectFamily = readToken(own(r, "effectFamily"), [...at, "effectFamily"], p, "effectFamily");
      let resolution: EffectDefinitionPayload["resolution"] = null;
      const rawResolution = own(r, "resolution");
      if (rawResolution !== undefined && rawResolution !== null) {
        const rr = readRecord(rawResolution, [...at, "resolution"], p, C.INVALID_PAYLOAD, ["mode", "data"], ["mode"]);
        if (rr !== null) {
          const mode = readEnum(own(rr, "mode"), RESOLUTION_MODES, [...at, "resolution", "mode"], p, C.INVALID_PAYLOAD, "resolution mode");
          const data = readJsonObject(own(rr, "data"), [...at, "resolution", "data"], p);
          if (mode !== null && data !== null) resolution = { mode, data };
        }
      }
      const rawOutcomes = own(r, "outcomes") ?? [];
      const outcomeKeys = new Set<string>();
      const outcomes = Array.isArray(rawOutcomes)
        ? rawOutcomes.flatMap((o: unknown, i: number) => {
            const ro = readRecord(o, [...at, "outcomes", i], p, C.INVALID_PAYLOAD, ["outcomeKey", "data"], ["outcomeKey"]);
            const key = ro === null ? null : own(ro, "outcomeKey");
            if (ro === null || !isExactLabel(key) || outcomeKeys.has(key)) {
              if (ro !== null) p.add(C.INVALID_PAYLOAD, [...at, "outcomes", i, "outcomeKey"], "outcomeKey is an exact label, unique within the Effect");
              return [];
            }
            outcomeKeys.add(key);
            const data = readJsonObject(own(ro, "data"), [...at, "outcomes", i, "data"], p);
            return data === null ? [] : [{ outcomeKey: key, data }];
          })
        : (p.add(C.INVALID_PAYLOAD, [...at, "outcomes"], "outcomes is an array"), []);
      payload = { ...readCommon(r, at, p), effectFamily, resolution, outcomes } satisfies Record<keyof EffectDefinitionPayload, unknown>;
      break;
    }
    case "TRAIT": {
      const traitFamily = readToken(own(r, "traitFamily"), [...at, "traitFamily"], p, "traitFamily");
      const scope = readEnum(own(r, "scope"), TRAIT_SCOPES, [...at, "scope"], p, C.INVALID_PAYLOAD, "trait scope");
      payload = { ...readCommon(r, at, p), traitFamily, scope } satisfies Record<keyof TraitDefinitionPayload, unknown>;
      break;
    }
    case "DURATION": {
      const durationConcept = readEnum(own(r, "durationConcept"), DURATION_CONCEPTS, [...at, "durationConcept"], p, C.INVALID_PAYLOAD, "duration concept");
      payload = { ...readCommon(r, at, p), durationConcept } satisfies Record<keyof DurationDefinitionPayload, unknown>;
      break;
    }
    case "ABILITY_CONDITION": {
      for (const path of forbiddenKeyPaths(r, ABILITY_CONDITION_FORBIDDEN_KEYS, at)) {
        p.add(C.CONDITION_APPLIES_STATUS, path, "an Ability Condition restricts USING an Ability; it never applies a status to a target");
      }
      const rr = readRecord(own(r, "restriction"), [...at, "restriction"], p, C.INVALID_PAYLOAD, ["restrictionKey", "data"], ["restrictionKey"]);
      const restrictionKey = rr === null ? null : readToken(own(rr, "restrictionKey"), [...at, "restriction", "restrictionKey"], p, "restrictionKey");
      const restrictionData = rr === null ? null : readJsonObject(own(rr, "data"), [...at, "restriction", "data"], p);
      const tradeoff = readJsonObject(own(r, "tradeoff"), [...at, "tradeoff"], p);
      payload = { ...readCommon(r, at, p), restriction: { restrictionKey, data: restrictionData }, tradeoff } satisfies Record<keyof AbilityConditionDefinitionPayload, unknown>;
      break;
    }
    case "FOUNDATION":
      p.add(C.UNSUPPORTED_SCHEMA_VERSION, at, "Maneuver Foundation payloads are defined by a later M5 Work Order");
      break;
  }
  return p.count > before ? null : (payload as JsonObject);
}

/**
 * Validates `value` as the version-`schemaVersion` payload of `kind`. The caller has already checked that the kind
 * supports that version. Legacy terminology anywhere in a canonical payload is rejected (M5-I037).
 */
export function readDefinitionPayload(kind: ProwessDefinitionKind, contract: AbilityComponentContract | null, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  if (!isProwessDefinitionKind(kind)) return null;
  const before = p.count;
  for (const use of legacyTermUses(value, at)) {
    p.add(C.LEGACY_TERM_AS_CANONICAL, use.path, `"${use.term}" is legacy source terminology; canonical structured content uses ${use.canonical}`);
  }
  let payload: JsonObject | null = null;
  if (contract !== null) payload = readComponentPayload(contract, value, at, p);
  else if (kind === "AFFINITY") {
    const r = readRecord(value, at, p, C.INVALID_PAYLOAD, ["affinity"], ["affinity"]);
    const affinity = r === null ? null : own(r, "affinity");
    if (r !== null && legacyTermFor(String(affinity)) === null) {
      if (readEnum(affinity, CANONICAL_AFFINITIES, [...at, "affinity"], p, C.INVALID_PAYLOAD, "canonical Affinity") !== null) payload = { affinity: affinity as string };
    }
  }
  return p.count > before ? null : payload;
}
