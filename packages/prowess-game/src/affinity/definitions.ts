import type { RuleProvenance } from "@prowess/rules";
import { deepFreeze } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactCanonicalKey, isExactUuid, own, readRecord, type ProwessOutcome } from "../internal/problems.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { AFFINITY_ERROR_CODES as A, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { AffinityDefinitionV2Payload, AffinityProgressionPayload, AffinityRankEntry, AffinityRankRulePayload, AffinityWeaknessSeverityPayload } from "../definition/affinity-payload.js";
import type { CoreEntry } from "../core/definitions.js";
import type { AffinityRank } from "../vocabulary/affinity.js";
import type { CanonicalAffinity } from "../vocabulary/construction.js";

/**
 * Role index of the exact M5-WO4 Affinity Definitions in ONE bundle (§26–§27, §137–§141). Exact identity only: an
 * Affinity is found by its exact Definition ref, never by display name, canonical key alone or "newest version". Two
 * Definitions claiming one role fail closed. Pure; reads nothing outside the bundle — there is no Affinity registry,
 * cache or "current Affinity" anywhere (§168, M5-I150).
 */
export interface AffinityDefinitionIndex {
  /** Every executable (version-2) AFFINITY Definition of the bundle, in bundle (Entity id) order. */
  readonly affinities: readonly AffinityEntry[];
  readonly rankRule: CoreEntry<AffinityRankRulePayload>;
  readonly severity: CoreEntry<AffinityWeaknessSeverityPayload> | null;
  readonly progression: CoreEntry<AffinityProgressionPayload> | null;
}

export interface AffinityEntry extends CoreEntry<AffinityDefinitionV2Payload> {
  readonly affinity: CanonicalAffinity;
}

function entryOf<P>(bundle: ProwessDefinitionBundle, envelope: ProwessDefinitionEnvelope): CoreEntry<P> {
  return {
    ref: definitionRefOf(envelope),
    payload: envelope.payload as unknown as P,
    provenance: {
      entityId: envelope.entityId,
      entityVersionId: envelope.entityVersionId,
      canonicalKey: envelope.canonicalKey,
      rulesetId: bundle.rulesetProvenance.rulesetId,
      manifestId: bundle.rulesetProvenance.manifestId,
    } as RuleProvenance,
  };
}

export function indexAffinityDefinitions(bundle: ProwessDefinitionBundle): ProwessOutcome<AffinityDefinitionIndex> {
  const p = new Problems();
  const single = (kind: string) => bundle.definitions.filter((d) => d.definitionKind === kind);
  const affinities: AffinityEntry[] = [];
  for (const envelope of bundle.definitions) {
    if (envelope.definitionKind !== "AFFINITY" || envelope.schemaVersion !== 2) continue;
    const entry = entryOf<AffinityDefinitionV2Payload>(bundle, envelope);
    if (affinities.some((a) => a.affinity === entry.payload.affinity)) {
      p.add(A.AMBIGUOUS_AFFINITY_DEFINITION, ["definitions"], `two executable AFFINITY Definitions claim ${entry.payload.affinity}; exactly one is pinned per Ruleset`);
      continue;
    }
    affinities.push({ ...entry, affinity: entry.payload.affinity });
  }
  const rankRules = single("AFFINITY_RANK_RULE");
  const severities = single("AFFINITY_WEAKNESS_SEVERITY");
  const progressions = single("AFFINITY_PROGRESSION");
  if (rankRules.length !== 1) p.add(rankRules.length === 0 ? A.MISSING_AFFINITY_DEFINITION : A.AMBIGUOUS_AFFINITY_DEFINITION, ["definitions"], "exactly one AFFINITY_RANK_RULE Definition is required");
  if (severities.length > 1) p.add(A.AMBIGUOUS_AFFINITY_DEFINITION, ["definitions"], "at most one AFFINITY_WEAKNESS_SEVERITY Definition");
  if (progressions.length > 1) p.add(A.AMBIGUOUS_AFFINITY_DEFINITION, ["definitions"], "at most one AFFINITY_PROGRESSION Definition");
  return finish(p, () =>
    deepFreeze({
      affinities,
      rankRule: entryOf<AffinityRankRulePayload>(bundle, rankRules[0] as ProwessDefinitionEnvelope),
      severity: severities[0] === undefined ? null : entryOf<AffinityWeaknessSeverityPayload>(bundle, severities[0]),
      progression: progressions[0] === undefined ? null : entryOf<AffinityProgressionPayload>(bundle, progressions[0]),
    }),
  );
}

/** The exact executable Affinity a ref names — never a canonical-key-only or latest-version lookup (§139). */
export function findAffinityEntry(index: AffinityDefinitionIndex, ref: ProwessDefinitionRef): AffinityEntry | null {
  return index.affinities.find((a) => a.ref.entityId === ref.entityId && a.ref.entityVersionId === ref.entityVersionId && a.ref.canonicalKey === ref.canonicalKey && a.ref.definitionKind === ref.definitionKind) ?? null;
}

/** One rank's authored meaning from the exact rank rule. Every rank is defined exactly once (validated by the payload reader). */
export function rankEntry(index: AffinityDefinitionIndex, rank: AffinityRank): AffinityRankEntry {
  return index.rankRule.payload.ranks.find((r) => r.rank === rank) as AffinityRankEntry;
}

/**
 * An exact M1 Keyword reference (KeywordDefinition id, canonical key, category id) — the identity M4 Keyword
 * Resolution consumes (§67, §124). Affinity content names Keywords by canonical key; the caller supplies the exact
 * M1 references, and a key with no reference fails closed (no alias, display name or case folding — §68).
 */
export interface AffinityKeywordReference {
  readonly keywordId: string;
  readonly canonicalKey: string;
  readonly categoryId: string | null;
}

export interface KeywordCatalog {
  readonly references: readonly AffinityKeywordReference[];
}

/** Validates the caller's exact Keyword references: lowercase UUID ids, exact canonical keys, both unique. */
export function readKeywordCatalog(value: unknown, at: readonly (string | number)[], p: Problems): KeywordCatalog | null {
  if (!checkPlainData(value, at, p, C.NOT_PLAIN_DATA)) return null;
  if (!Array.isArray(value)) {
    p.add(A.INVALID_KEYWORD_CATALOG, at, "keywords is an array of exact M1 Keyword references { keywordId, canonicalKey, categoryId }");
    return null;
  }
  const before = p.count;
  const references: AffinityKeywordReference[] = [];
  value.forEach((raw: unknown, i: number) => {
    const r = readRecord(raw, [...at, i], p, A.INVALID_KEYWORD_CATALOG, ["keywordId", "canonicalKey", "categoryId"], ["keywordId", "canonicalKey", "categoryId"]);
    if (r === null) return;
    const keywordId = own(r, "keywordId");
    const canonicalKey = own(r, "canonicalKey");
    const categoryId = own(r, "categoryId");
    if (!isExactUuid(keywordId)) p.add(A.INVALID_KEYWORD_CATALOG, [...at, i, "keywordId"], "keywordId is the exact lowercase KeywordDefinition UUID");
    if (!isExactCanonicalKey(canonicalKey)) p.add(A.INVALID_KEYWORD_CATALOG, [...at, i, "canonicalKey"], "canonicalKey is an exact M1 canonical key");
    if (categoryId !== null && !isExactUuid(categoryId)) p.add(A.INVALID_KEYWORD_CATALOG, [...at, i, "categoryId"], "categoryId is a KeywordCategory UUID or null");
    if (isExactUuid(keywordId) && isExactCanonicalKey(canonicalKey) && (categoryId === null || isExactUuid(categoryId))) references.push({ keywordId, canonicalKey, categoryId });
  });
  if (new Set(references.map((r) => r.keywordId)).size !== references.length || new Set(references.map((r) => r.canonicalKey)).size !== references.length) {
    p.add(A.INVALID_KEYWORD_CATALOG, at, "each Keyword id and each canonical key appears once (one exact identity per Keyword)");
  }
  return p.count > before ? null : { references };
}

/** The exact reference for a canonical key, or null. Exact code-unit equality only. */
export function keywordReference(catalog: KeywordCatalog, canonicalKey: string): AffinityKeywordReference | null {
  return catalog.references.find((r) => r.canonicalKey === canonicalKey) ?? null;
}
