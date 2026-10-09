import {
  EXACT_IMPORT_MATCH_BASES,
  IMPORT_MATCH_BASES,
  IMPORT_MATCH_OUTCOMES,
  normalizeEntityAlias,
  type CandidateDuplicateBasis,
  type ExtractionCandidateKind,
  type ImportMatchBasis,
  type ImportMatcherConfig,
  type ImportMatchOutcome,
} from "@prowess/model";
import { canonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./fingerprint.js";

/**
 * Pure identity matching (PAS-10 M3-WO4). Decides only which existing Entity, if any, a Candidate could REPRESENT,
 * from identity data: canonical keys, aliases, and — when the Batch pins a comparison Manifest — the display name of
 * each Entity's EXACT effective Version there. No database, network, AI, clock, randomness or locale-dependent
 * operation. Label normalization is M1's `normalizeEntityAlias` (NFC, trim, collapse whitespace, locale-INDEPENDENT
 * lowercase) — reused, never reimplemented.
 */

// ---------------------------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------------------------

export interface MatchCandidateInput {
  candidateId: string;
  ordinal: number;
  candidateKind: ExtractionCandidateKind;
  proposedEntityType: string | null;
  proposedCanonicalKey: string | null;
  displayLabel: string;
}

/** Exactly the identity data the matcher consults about one Entity. */
export interface EntityIdentityRecord {
  entityId: string;
  entityType: string;
  canonicalKey: string;
  aliases: ReadonlyArray<{ normalizedAlias: string; normalizedContext: string }>;
  /** The Entity's exact effective Version in the Batch's comparison Manifest, or null (absent / no Manifest). */
  comparisonEntityVersionId: string | null;
  /** That Version's displayName — present only with a comparison Version. Never a "latest" Version's name. */
  comparisonDisplayLabel: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------------------------

export interface MatchSuggestionOutput {
  entityId: string;
  rank: number;
  score: number;
  basis: ImportMatchBasis;
  comparisonEntityVersionId: string | null;
}

export interface MatchAssessmentOutput {
  candidateId: string;
  outcome: ImportMatchOutcome;
  matchedEntityId: string | null;
  matchedBy: ImportMatchBasis;
  normalizedCandidateLabel: string | null;
  normalizedProposedCanonicalKey: string | null;
  comparisonEntityVersionId: string | null;
  suggestions: MatchSuggestionOutput[];
}

export interface DuplicateGroupOutput {
  basis: CandidateDuplicateBasis;
  identityKey: string;
  /** In Candidate ordinal order. */
  memberCandidateIds: string[];
}

export interface MatcherOutput {
  assessments: MatchAssessmentOutput[];
  duplicateGroups: DuplicateGroupOutput[];
}

export interface MatcherDefinition {
  key: string;
  version: string;
  description: string;
  defaultConfig: ImportMatcherConfig;
  match(input: { candidates: readonly MatchCandidateInput[]; catalog: readonly EntityIdentityRecord[]; config: ImportMatcherConfig }): MatcherOutput;
}

export type MatchingErrorKind = "MATCHER_NOT_FOUND" | "INVALID_INPUT" | "INVALID_MATCHER_OUTPUT";
export class MatchingError extends Error {
  constructor(readonly kind: MatchingErrorKind, message: string) {
    super(message);
    this.name = "MatchingError";
  }
}

export class MatcherRegistry {
  private readonly byKey = new Map<string, MatcherDefinition>();
  constructor(definitions: readonly MatcherDefinition[]) {
    for (const d of definitions) {
      const k = `${d.key}@${d.version}`;
      if (this.byKey.has(k)) throw new Error(`duplicate matcher registration ${k}`);
      this.byKey.set(k, d);
    }
  }
  /** Exact lookup. Never falls forward to another version. */
  find(key: string, version: string): MatcherDefinition | null {
    return this.byKey.get(`${key}@${version}`) ?? null;
  }
  keys(): string[] {
    return [...this.byKey.keys()].sort();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Versioned hashes
// ---------------------------------------------------------------------------------------------------------------

export const ENTITY_CATALOG_HASH_VERSION = "PROWESS_ENTITY_CATALOG_V1";
export const IMPORT_MATCH_RUN_FINGERPRINT_VERSION = "PROWESS_IMPORT_MATCH_RUN_V1";
export const IMPORT_MATCH_RESULT_HASH_VERSION = "PROWESS_IMPORT_MATCH_RESULT_V1";

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `PROWESS_ENTITY_CATALOG_V1\n` + canonical JSON of the records sorted by entity id, each with its aliases sorted by
 * (normalizedAlias, normalizedContext). Covers exactly what the matcher consults: id, type, canonical key, normalized
 * aliases + contexts, and the exact comparison Version id + display name. No timestamps, no read order.
 */
export function entityCatalogHash(catalog: readonly EntityIdentityRecord[]): string {
  const records = [...catalog]
    .sort((a, b) => byString(a.entityId, b.entityId))
    .map((r) => ({
      entityId: r.entityId.toLowerCase(),
      entityType: r.entityType,
      canonicalKey: r.canonicalKey,
      aliases: [...r.aliases].map((a) => ({ normalizedAlias: a.normalizedAlias, normalizedContext: a.normalizedContext })).sort((x, y) => byString(x.normalizedAlias, y.normalizedAlias) || byString(x.normalizedContext, y.normalizedContext)),
      comparisonEntityVersionId: r.comparisonEntityVersionId === null ? null : r.comparisonEntityVersionId.toLowerCase(),
      comparisonDisplayLabel: r.comparisonDisplayLabel,
    }));
  return sha256Hex(`${ENTITY_CATALOG_HASH_VERSION}\n${canonicalJson(records)}`);
}

export interface ImportMatchRunFingerprintInput {
  importBatchId: string;
  candidateSetHash: string;
  entityCatalogHash: string;
  comparisonManifestId: string | null;
  matcherKey: string;
  matcherVersion: string;
  matcherConfigHash: string;
}

/** Lines joined by "\n": version, importBatch, candidateSet, entityCatalog, comparisonManifest, matcherKey, matcherVersion, configHash. */
export function importMatchRunFingerprint(i: ImportMatchRunFingerprintInput): string {
  const id = (v: string | null) => (v === null ? "null" : v.toLowerCase());
  return sha256Hex(
    [
      IMPORT_MATCH_RUN_FINGERPRINT_VERSION,
      `importBatch=${id(i.importBatchId)}`,
      `candidateSet=${i.candidateSetHash}`,
      `entityCatalog=${i.entityCatalogHash}`,
      `comparisonManifest=${id(i.comparisonManifestId)}`,
      `matcherKey=${i.matcherKey}`,
      `matcherVersion=${i.matcherVersion}`,
      `configHash=${i.matcherConfigHash}`,
    ].join("\n"),
  );
}

export const matcherConfigHash = (config: ImportMatcherConfig): string => sha256Hex(canonicalJson(config));

/** Canonical JSON hash of the complete result (assessments in candidate order, groups in identity-key order). */
export function importMatchResultHash(output: MatcherOutput): string {
  return sha256Hex(`${IMPORT_MATCH_RESULT_HASH_VERSION}\n${canonicalJson(output)}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Runner: exact lookup, config validation, output validation
// ---------------------------------------------------------------------------------------------------------------

export function resolveMatcherConfig(definition: MatcherDefinition, override: Partial<ImportMatcherConfig> | undefined): ImportMatcherConfig {
  const config = { ...definition.defaultConfig, ...(override ?? {}) };
  const keys = Object.keys(config).sort().join(",");
  if (keys !== "maxSuggestions,suggestionThreshold") throw new MatchingError("INVALID_INPUT", `matcher config accepts exactly suggestionThreshold and maxSuggestions (got ${keys})`);
  if (typeof config.suggestionThreshold !== "number" || !(config.suggestionThreshold > 0 && config.suggestionThreshold <= 1)) throw new MatchingError("INVALID_INPUT", "suggestionThreshold must be a number in (0, 1]");
  if (!Number.isInteger(config.maxSuggestions) || config.maxSuggestions < 1 || config.maxSuggestions > 50) throw new MatchingError("INVALID_INPUT", "maxSuggestions must be an integer in 1..50");
  return { suggestionThreshold: config.suggestionThreshold, maxSuggestions: config.maxSuggestions };
}

export interface MatchingRun {
  definition: MatcherDefinition;
  config: ImportMatcherConfig;
  configHash: string;
  catalogHash: string;
  output: MatcherOutput;
  resultHash: string;
}

export function runMatching(
  registry: MatcherRegistry,
  matcherKey: string,
  matcherVersion: string,
  configOverride: Partial<ImportMatcherConfig> | undefined,
  candidates: readonly MatchCandidateInput[],
  catalog: readonly EntityIdentityRecord[],
): MatchingRun {
  const definition = registry.find(matcherKey, matcherVersion);
  if (!definition) throw new MatchingError("MATCHER_NOT_FOUND", `no matcher is registered as exactly ${matcherKey}@${matcherVersion} (registered: ${registry.keys().join(", ") || "none"})`);
  const config = resolveMatcherConfig(definition, configOverride);
  const sortedCandidates = [...candidates].sort((a, b) => a.ordinal - b.ordinal || byString(a.candidateId, b.candidateId));
  const sortedCatalog = [...catalog].sort((a, b) => byString(a.entityId, b.entityId));
  let output: MatcherOutput;
  try {
    output = definition.match({ candidates: sortedCandidates, catalog: sortedCatalog, config });
  } catch (error) {
    throw new MatchingError("INVALID_MATCHER_OUTPUT", `${definition.key}@${definition.version} failed: ${(error as Error).message}`);
  }
  validateMatcherOutput(definition, output, sortedCandidates, sortedCatalog, config);
  return { definition, config, configHash: matcherConfigHash(config), catalogHash: entityCatalogHash(catalog), output, resultHash: importMatchResultHash(output) };
}

function validateMatcherOutput(definition: MatcherDefinition, output: MatcherOutput, candidates: readonly MatchCandidateInput[], catalog: readonly EntityIdentityRecord[], config: ImportMatcherConfig): void {
  const bad = (m: string) => new MatchingError("INVALID_MATCHER_OUTPUT", `${definition.key}@${definition.version}: ${m}`);
  if (typeof output !== "object" || output === null || !Array.isArray(output.assessments) || !Array.isArray(output.duplicateGroups)) throw bad("output must be { assessments[], duplicateGroups[] }");
  const entities = new Map(catalog.map((e) => [e.entityId, e]));
  const candidateIds = candidates.map((c) => c.candidateId);
  if (output.assessments.length !== candidates.length || output.assessments.some((a, i) => a.candidateId !== candidateIds[i])) throw bad("exactly one assessment per candidate, in candidate order");
  for (const a of output.assessments) {
    if (!(IMPORT_MATCH_OUTCOMES as readonly string[]).includes(a.outcome) || !(IMPORT_MATCH_BASES as readonly string[]).includes(a.matchedBy)) throw bad(`candidate ${a.candidateId}: unknown outcome / basis`);
    if ((a.outcome === "EXACT_MATCH") !== (a.matchedEntityId !== null)) throw bad(`candidate ${a.candidateId}: matchedEntityId is required for, and only for, EXACT_MATCH`);
    if (a.outcome === "EXACT_MATCH" && !(EXACT_IMPORT_MATCH_BASES as readonly string[]).includes(a.matchedBy)) throw bad(`candidate ${a.candidateId}: only an exact canonical-key or alias basis can establish EXACT_MATCH`);
    if (a.matchedEntityId !== null && !entities.has(a.matchedEntityId)) throw bad(`candidate ${a.candidateId}: matched entity is not in the catalog`);
    const expectedVersion = a.matchedEntityId === null ? null : (entities.get(a.matchedEntityId)?.comparisonEntityVersionId ?? null);
    if (a.comparisonEntityVersionId !== expectedVersion) throw bad(`candidate ${a.candidateId}: comparison Version must be the matched Entity's exact comparison-Manifest Version`);
    if (["NO_MATCH", "INSUFFICIENT_IDENTITY", "NOT_APPLICABLE"].includes(a.outcome) && (a.matchedBy !== "NONE" || a.suggestions.length > 0)) throw bad(`candidate ${a.candidateId}: ${a.outcome} carries no basis and no suggestions`);
    if (a.outcome === "POTENTIAL_MATCH" && a.suggestions.length === 0) throw bad(`candidate ${a.candidateId}: POTENTIAL_MATCH needs at least one suggestion`);
    if (a.suggestions.length > config.maxSuggestions) throw bad(`candidate ${a.candidateId}: more than ${config.maxSuggestions} suggestions`);
    const seen = new Set<string>();
    a.suggestions.forEach((s, i) => {
      if (s.rank !== i + 1) throw bad(`candidate ${a.candidateId}: suggestion ranks must be 1..n`);
      if (!entities.has(s.entityId) || seen.has(s.entityId)) throw bad(`candidate ${a.candidateId}: suggested entity unknown or repeated`);
      seen.add(s.entityId);
      if (typeof s.score !== "number" || !(s.score >= 0 && s.score <= 1) || s.basis === "NONE" || !(IMPORT_MATCH_BASES as readonly string[]).includes(s.basis)) throw bad(`candidate ${a.candidateId}: invalid suggestion score / basis`);
      if (s.comparisonEntityVersionId !== (entities.get(s.entityId)?.comparisonEntityVersionId ?? null)) throw bad(`candidate ${a.candidateId}: suggestion comparison Version must come from the comparison Manifest`);
    });
  }
  const seenKeys = new Set<string>();
  const ordinal = new Map(candidates.map((c) => [c.candidateId, c.ordinal]));
  for (const g of output.duplicateGroups) {
    if (!["PROPOSED_CANONICAL_KEY", "NORMALIZED_LABEL"].includes(g.basis) || typeof g.identityKey !== "string" || g.identityKey.length === 0) throw bad("invalid duplicate group basis / identity key");
    if (seenKeys.has(`${g.basis}|${g.identityKey}`)) throw bad(`duplicate group ${g.identityKey} appears twice`);
    seenKeys.add(`${g.basis}|${g.identityKey}`);
    if (g.memberCandidateIds.length < 2 || new Set(g.memberCandidateIds).size !== g.memberCandidateIds.length || g.memberCandidateIds.some((id) => !ordinal.has(id))) throw bad(`duplicate group ${g.identityKey}: needs two or more distinct candidates of this set`);
    for (let i = 1; i < g.memberCandidateIds.length; i += 1) if ((ordinal.get(g.memberCandidateIds[i] as string) as number) < (ordinal.get(g.memberCandidateIds[i - 1] as string) as number)) throw bad(`duplicate group ${g.identityKey}: members must be in candidate ordinal order`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// prowess.entity-matcher@1
// ---------------------------------------------------------------------------------------------------------------

export const ENTITY_MATCHER_KEY = "prowess.entity-matcher";
export const ENTITY_MATCHER_VERSION = "1";
export const ENTITY_MATCHER_V1_DEFAULT_CONFIG: ImportMatcherConfig = { suggestionThreshold: 0.85, maxSuggestions: 5 };

const BASIS_RANK: Record<ImportMatchBasis, number> = { CANONICAL_KEY_EXACT: 0, ALIAS_EXACT: 1, DISPLAY_LABEL_EXACT: 2, NORMALIZED_LABEL: 3, FUZZY_LABEL: 4, NONE: 5 };
/** A label is usable identity only if it contains at least one letter or digit. */
const usable = (normalized: string) => /[\p{L}\p{N}]/u.test(normalized);
const roundScore = (x: number) => Math.round(x * 1_000_000) / 1_000_000;

/**
 * Normalized Levenshtein similarity: 1 - distance / max(length) over UTF-16 code units of the two NORMALIZED strings.
 * Explainable, deterministic, locale-free. Advisory only.
 */
export function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return roundScore(1 - (prev[b.length] as number) / max);
}

/** Whether a Candidate is an Entity-identity Candidate this matcher should analyse. */
export function isIdentityCandidate(c: MatchCandidateInput): boolean {
  if (c.candidateKind === "ENTITY") return true;
  return c.candidateKind === "ENTITY_FIELD" && (c.proposedCanonicalKey !== null || c.proposedEntityType !== null);
}

function buildIndex(catalog: readonly EntityIdentityRecord[]) {
  const byKey = new Map<string, EntityIdentityRecord>();
  const byAlias = new Map<string, Array<{ entity: EntityIdentityRecord; normalizedContext: string }>>();
  const byDisplayRaw = new Map<string, EntityIdentityRecord[]>();
  const byDisplayNormalized = new Map<string, EntityIdentityRecord[]>();
  // Fuzzy pool, pre-grouped by first and by last character of each normalized identity string.
  const byFirst = new Map<string, Array<{ entity: EntityIdentityRecord; text: string }>>();
  const byLast = new Map<string, Array<{ entity: EntityIdentityRecord; text: string }>>();
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const e of catalog) {
    byKey.set(e.canonicalKey, e);
    const texts = new Set<string>();
    for (const a of e.aliases) {
      push(byAlias, a.normalizedAlias, { entity: e, normalizedContext: a.normalizedContext });
      texts.add(a.normalizedAlias);
    }
    if (e.comparisonDisplayLabel !== null) {
      push(byDisplayRaw, e.comparisonDisplayLabel, e);
      const n = normalizeEntityAlias(e.comparisonDisplayLabel);
      push(byDisplayNormalized, n, e);
      texts.add(n);
    }
    for (const text of texts) {
      if (text.length === 0) continue;
      push(byFirst, text[0] as string, { entity: e, text });
      push(byLast, text[text.length - 1] as string, { entity: e, text });
    }
  }
  return { byKey, byAlias, byDisplayRaw, byDisplayNormalized, byFirst, byLast };
}

export const entityMatcherV1: MatcherDefinition = {
  key: ENTITY_MATCHER_KEY,
  version: ENTITY_MATCHER_VERSION,
  description: "Deterministic identity matcher: exact canonical key / context-free alias establish identity; display-label equality and normalized edit similarity are suggestions only.",
  defaultConfig: ENTITY_MATCHER_V1_DEFAULT_CONFIG,
  match({ candidates, catalog, config }) {
    const index = buildIndex(catalog);
    const assessments = candidates.map((c): MatchAssessmentOutput => {
      const base = { candidateId: c.candidateId, matchedEntityId: null, comparisonEntityVersionId: null, suggestions: [] as MatchSuggestionOutput[] };
      if (!isIdentityCandidate(c)) return { ...base, outcome: "NOT_APPLICABLE", matchedBy: "NONE", normalizedCandidateLabel: null, normalizedProposedCanonicalKey: null };
      const key = c.proposedCanonicalKey;
      const label = normalizeEntityAlias(c.displayLabel);
      const labelUsable = c.candidateKind === "ENTITY" && usable(label); // an ENTITY_FIELD's label names a field, not the Entity
      const identity = { normalizedCandidateLabel: labelUsable ? label : null, normalizedProposedCanonicalKey: key };
      if (key === null && !labelUsable) return { ...base, ...identity, outcome: "INSUFFICIENT_IDENTITY", matchedBy: "NONE" };

      const compatible = (e: EntityIdentityRecord) => c.proposedEntityType === null || e.entityType === c.proposedEntityType;
      const found = new Map<string, { entity: EntityIdentityRecord; basis: ImportMatchBasis; score: number }>();
      const offer = (entity: EntityIdentityRecord, basis: ImportMatchBasis, score: number) => {
        const prior = found.get(entity.entityId);
        if (!prior || BASIS_RANK[basis] < BASIS_RANK[prior.basis] || (basis === prior.basis && score > prior.score)) found.set(entity.entityId, { entity, basis, score });
      };
      let exact: { entity: EntityIdentityRecord; basis: ImportMatchBasis } | null = null;

      // 1. Exact canonical key (M1: keys are globally unique and already canonical — never fuzzy, never transformed).
      if (key !== null) {
        const owner = index.byKey.get(key);
        if (owner) {
          offer(owner, "CANONICAL_KEY_EXACT", 1); // a key owned by another type is still shown — but never auto-matched
          if (compatible(owner)) exact = { entity: owner, basis: "CANONICAL_KEY_EXACT" };
        }
      }
      if (labelUsable) {
        // 2. Exact normalized alias. EXACT only if exactly one type-compatible Entity carries it as a context-FREE alias
        //    (a context-scoped alias cannot be satisfied by a Candidate that has no context).
        const aliasHits = (index.byAlias.get(label) ?? []).filter((h) => compatible(h.entity));
        for (const h of aliasHits) offer(h.entity, "ALIAS_EXACT", 1);
        const aliasEntities = [...new Set(aliasHits.map((h) => h.entity.entityId))];
        if (exact === null && aliasEntities.length === 1 && aliasHits.every((h) => h.normalizedContext === "")) exact = { entity: aliasHits[0]!.entity, basis: "ALIAS_EXACT" };
        // 3. Display label of the exact comparison Version: raw equality, then normalized equality — suggestions only.
        for (const e of index.byDisplayRaw.get(c.displayLabel) ?? []) if (compatible(e)) offer(e, "DISPLAY_LABEL_EXACT", 1);
        for (const e of index.byDisplayNormalized.get(label) ?? []) if (compatible(e)) offer(e, "NORMALIZED_LABEL", 1);
        // 4. Fuzzy: normalized edit similarity over a pre-reduced pool (same first OR last character, length within
        //    the threshold's tolerance, type-compatible). Suggestions only.
        const maxDelta = Math.floor(label.length * (1 - config.suggestionThreshold)) + 1;
        const pool = [...(index.byFirst.get(label[0] as string) ?? []), ...(index.byLast.get(label[label.length - 1] as string) ?? [])];
        for (const p of pool) {
          if (!compatible(p.entity) || Math.abs(p.text.length - label.length) > maxDelta) continue;
          const score = editSimilarity(label, p.text);
          if (score >= config.suggestionThreshold && score < 1) offer(p.entity, "FUZZY_LABEL", score);
        }
      }

      const ranked = [...found.values()].sort(
        (a, b) =>
          (exact && a.entity.entityId === exact.entity.entityId ? -1 : 0) - (exact && b.entity.entityId === exact.entity.entityId ? -1 : 0) ||
          BASIS_RANK[a.basis] - BASIS_RANK[b.basis] ||
          b.score - a.score ||
          byString(a.entity.canonicalKey, b.entity.canonicalKey) ||
          byString(a.entity.entityId, b.entity.entityId),
      );
      const suggestions = ranked.slice(0, config.maxSuggestions).map((s, i) => ({ entityId: s.entity.entityId, rank: i + 1, score: s.score, basis: s.basis, comparisonEntityVersionId: s.entity.comparisonEntityVersionId }));
      if (exact) return { ...base, ...identity, outcome: "EXACT_MATCH", matchedEntityId: exact.entity.entityId, matchedBy: exact.basis, comparisonEntityVersionId: exact.entity.comparisonEntityVersionId, suggestions };
      if (suggestions.length > 0) return { ...base, ...identity, outcome: "POTENTIAL_MATCH", matchedBy: suggestions[0]!.basis, suggestions };
      return { ...base, ...identity, outcome: "NO_MATCH", matchedBy: "NONE" };
    });

    // Advisory duplicate groups among ENTITY candidates only. Never from fuzzy similarity; never cross-type.
    const groups = new Map<string, DuplicateGroupOutput>();
    const add = (basis: CandidateDuplicateBasis, identityKey: string, candidateId: string) => {
      const k = `${basis}|${identityKey}`;
      const g = groups.get(k) ?? { basis, identityKey, memberCandidateIds: [] };
      g.memberCandidateIds.push(candidateId);
      groups.set(k, g);
    };
    for (const c of candidates) {
      if (c.candidateKind !== "ENTITY") continue;
      if (c.proposedCanonicalKey !== null) add("PROPOSED_CANONICAL_KEY", `${c.proposedEntityType ?? "*"}|${c.proposedCanonicalKey}`, c.candidateId);
      else if (c.proposedEntityType !== null) {
        const label = normalizeEntityAlias(c.displayLabel);
        if (usable(label)) add("NORMALIZED_LABEL", `${c.proposedEntityType}|${label}`, c.candidateId);
      }
    }
    const duplicateGroups = [...groups.values()].filter((g) => g.memberCandidateIds.length > 1).sort((a, b) => byString(a.basis, b.basis) || byString(a.identityKey, b.identityKey));
    return { assessments, duplicateGroups };
  },
};

export const OFFICIAL_MATCHERS = [entityMatcherV1] as const;
export const defaultMatcherRegistry = new MatcherRegistry(OFFICIAL_MATCHERS);
