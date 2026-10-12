import { isValidCanonicalKey, type CanonicalKey, type JsonObject, type KeywordCategoryId, type KeywordDefinitionId } from "@prowess/model";
import { isValidContextKey } from "../context/context-key.js";
import { evaluate } from "../evaluation/evaluate.js";
import { canonicalJson } from "../internal/canonical-json.js";
import { InputProblems, readUuid } from "../internal/input-reader.js";
import { inspectPlainData, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { stringValue } from "../result/evaluation-value.js";
import { readProvenance, type RuleProvenance } from "../result/provenance.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import type { TraceStepInput } from "../trace/calculation-trace.js";
import { validationMessage, type ValidationMessageDraft } from "../validation/validation-message.js";

/**
 * Keyword Resolution (PAS-10 M4-WO4).
 *
 * A Keyword is metadata — a rule hook. It does nothing mechanically unless another explicit rule references it. This
 * module only answers "which exact Keywords are present, and why": it aggregates exact Keyword contributions into one
 * deduplicated, ordered, immutable set that keeps every contributor. It never assigns a meaning, a number, a stack
 * count, a priority, an implication or a removal to any Keyword, and it never looks a Keyword up anywhere — M1 remains
 * the Keyword authority, and the caller supplies exact, already-resolved Keyword metadata.
 */

/**
 * An exact Keyword, as M1 defines it (`KeywordDefinition`). `keywordId` is the identity. `canonicalKey` follows M1's
 * canonical-key grammar and is compared exactly (never re-normalized). `categoryId` is the definition's zero-or-one
 * category, carried as organizational metadata only. A display name, description or alias is never part of it.
 * Supply all three fields verbatim from the KeywordDefinition: the same Keyword supplied with different metadata is an
 * integrity failure.
 */
export interface KeywordReference {
  readonly keywordId: KeywordDefinitionId;
  readonly canonicalKey: CanonicalKey;
  readonly categoryId: KeywordCategoryId | null;
}

/**
 * Where a contribution comes from. Generic: `sourceType` is a caller-chosen context key (e.g. `entity_version`,
 * `runtime.effect`) that this module never interprets. Source identity is exactly (`sourceType`, `sourceKey`);
 * `sourceId` (an opaque persisted id, when there is one) and `provenance` describe it but are not identity.
 */
export interface KeywordContributionSource {
  readonly sourceType: string;
  readonly sourceKey: string;
  readonly sourceId: string | null;
  readonly provenance: RuleProvenance | null;
}

/**
 * One exact statement "this source contributes this Keyword". `ordinal` is optional: supply it only when contributor
 * order is semantically meaningful; otherwise contributors are ordered by source identity.
 */
export interface KeywordContribution {
  readonly keyword: KeywordReference;
  readonly source: KeywordContributionSource;
  readonly ordinal: number | null;
}

/** One contributor of a resolved Keyword. */
export interface KeywordContributor {
  readonly source: KeywordContributionSource;
  readonly ordinal: number | null;
}

/** One unique exact Keyword with every source that contributed it. */
export interface ResolvedKeyword {
  readonly keyword: KeywordReference;
  readonly contributors: readonly KeywordContributor[];
}

/**
 * The immutable result of Keyword resolution: each exact Keyword once, ordered by `canonicalKey` then `keywordId`
 * (UTF-16 code-unit order — locale-independent). Produced only by `resolveKeywords`.
 */
export interface ResolvedKeywordSet {
  readonly keywords: readonly ResolvedKeyword[];
}

/**
 * Keyword-resolution diagnostics: malformed or contradictory caller input, surfaced as VALIDATION messages (category
 * STRUCTURE). Namespaced `KEYWORD_RESOLUTION.*` so they can never be confused with M1's `KEYWORD.*` DomainError codes.
 */
export const KEYWORD_RESOLUTION_DIAGNOSTIC_CODES = {
  /** A Keyword reference is malformed: missing / non-UUID id, invalid canonical key, invalid category id. */
  INVALID_REFERENCE: "KEYWORD_RESOLUTION.INVALID_REFERENCE",
  /** A contribution or its source is malformed, or one source is described / contributes inconsistently. */
  INVALID_CONTRIBUTION: "KEYWORD_RESOLUTION.INVALID_CONTRIBUTION",
  /** One keywordId arrives with different canonical key or category metadata. */
  IDENTITY_CONFLICT: "KEYWORD_RESOLUTION.IDENTITY_CONFLICT",
  /** Two different keywordIds claim one canonical key. */
  CANONICAL_KEY_CONFLICT: "KEYWORD_RESOLUTION.CANONICAL_KEY_CONFLICT",
} as const;

export type KeywordResolutionDiagnosticCode = (typeof KEYWORD_RESOLUTION_DIAGNOSTIC_CODES)[keyof typeof KEYWORD_RESOLUTION_DIAGNOSTIC_CODES];

/** The evaluation kind `resolveKeywords` uses on the M4-WO1 boundary. */
export const KEYWORD_RESOLUTION_KIND = "keyword.resolve";

const MAX_SOURCE_KEY_LENGTH = 200;
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isSourceText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_SOURCE_KEY_LENGTH && v.trim() === v;

interface Problem {
  readonly code: KeywordResolutionDiagnosticCode;
  readonly message: string;
  readonly path: string | null;
  readonly details: JsonObject | null;
}

/** UUID identity via the M4-WO1 reader (case-insensitive, normalized there); null when malformed. */
function uuid(value: unknown): string | null {
  return readUuid(value, [], new InputProblems());
}

function readContribution(value: unknown, index: number, out: Problem[]): KeywordContribution | null {
  const at = (...rest: (string | number)[]) => jsonPointer([index, ...rest]);
  const bad = (code: KeywordResolutionDiagnosticCode, message: string, path: string) => {
    out.push({ code, message, path, details: null });
    return null;
  };
  if (!isPlainObject(value)) return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, "a contribution must be a plain object", at());
  const extra = Object.keys(value).filter((k) => !["keyword", "source", "ordinal"].includes(k));
  if (extra.length > 0) return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, `unknown field "${extra.sort(byCodeUnit)[0]}"`, at(extra[0] as string));

  const k = value.keyword;
  if (!isPlainObject(k) || Object.keys(k).some((f) => !["keywordId", "canonicalKey", "categoryId"].includes(f))) {
    return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_REFERENCE, "keyword must be { keywordId, canonicalKey, categoryId }", at("keyword"));
  }
  const keywordId = uuid(k.keywordId);
  if (keywordId === null) return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_REFERENCE, "keywordId must be a KeywordDefinition UUID", at("keyword", "keywordId"));
  if (typeof k.canonicalKey !== "string" || !isValidCanonicalKey(k.canonicalKey)) {
    return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_REFERENCE, "canonicalKey must be a valid M1 canonical key (compared exactly, never normalized)", at("keyword", "canonicalKey"));
  }
  const categoryId = k.categoryId === undefined || k.categoryId === null ? null : uuid(k.categoryId);
  if (k.categoryId !== undefined && k.categoryId !== null && categoryId === null) {
    return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_REFERENCE, "categoryId must be a KeywordCategory UUID or null", at("keyword", "categoryId"));
  }

  const s = value.source;
  if (!isPlainObject(s) || Object.keys(s).some((f) => !["sourceType", "sourceKey", "sourceId", "provenance"].includes(f))) {
    return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, "source must be { sourceType, sourceKey, sourceId?, provenance? }", at("source"));
  }
  if (!isValidContextKey(s.sourceType)) return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, "sourceType must be a context key", at("source", "sourceType"));
  if (!isSourceText(s.sourceKey)) return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, "sourceKey must be a non-empty string without leading or trailing whitespace, at most 200 characters", at("source", "sourceKey"));
  const sourceId = s.sourceId === undefined || s.sourceId === null ? null : s.sourceId;
  if (sourceId !== null && !isSourceText(sourceId)) return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, "sourceId must be a non-empty string or null", at("source", "sourceId"));
  const provenanceProblems = new InputProblems();
  const provenance = readProvenance(s.provenance, ["source", "provenance"], provenanceProblems);
  if (provenanceProblems.count > 0) return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, "source provenance is malformed", at("source", "provenance"));

  const ordinal = value.ordinal === undefined || value.ordinal === null ? null : value.ordinal;
  if (ordinal !== null && (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0)) {
    return bad(KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, "ordinal must be a whole number of at least 0, or null", at("ordinal"));
  }
  return {
    keyword: { keywordId: keywordId as KeywordDefinitionId, canonicalKey: k.canonicalKey as CanonicalKey, categoryId: categoryId as KeywordCategoryId | null },
    source: { sourceType: s.sourceType, sourceKey: s.sourceKey, sourceId: sourceId as string | null, provenance },
    ordinal: ordinal as number | null,
  };
}

/** Groups items by a key and returns groups whose members disagree on `variant`, in key order. */
function disagreements<T>(items: readonly T[], key: (t: T) => string, variant: (t: T) => string): Array<[string, string[]]> {
  const groups = new Map<string, Set<string>>();
  for (const item of items) {
    const k = key(item);
    const set = groups.get(k) ?? new Set<string>();
    set.add(variant(item));
    groups.set(k, set);
  }
  return [...groups.entries()]
    .filter(([, variants]) => variants.size > 1)
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([k, variants]) => [k, [...variants].sort(byCodeUnit)]);
}

const sourceIdentity = (c: KeywordContribution) => canonicalJson([c.source.sourceType, c.source.sourceKey]);
const contributorOrder = (a: KeywordContributor, b: KeywordContributor) => {
  if (a.ordinal !== b.ordinal) return a.ordinal === null ? 1 : b.ordinal === null ? -1 : a.ordinal - b.ordinal;
  return byCodeUnit(a.source.sourceType, b.source.sourceType) || byCodeUnit(a.source.sourceKey, b.source.sourceKey);
};

/**
 * Reads, checks and aggregates contributions. Returns the set, or every problem — structural problems in input
 * order, then consistency conflicts grouped and sorted by identity, so conflict reporting never depends on input order.
 */
export function aggregateKeywordContributions(input: unknown): { ok: true; set: ResolvedKeywordSet } | { ok: false; problems: Problem[] } {
  if (!Array.isArray(input)) return { ok: false, problems: [{ code: KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: "contributions must be an array", path: "", details: null }] };
  const plain = inspectPlainData(input);
  if (plain.length > 0) {
    return { ok: false, problems: plain.map((p) => ({ code: KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: p.reason, path: p.path, details: null })) };
  }
  const problems: Problem[] = [];
  const contributions = input.map((c, i) => readContribution(c, i, problems)).filter((c): c is KeywordContribution => c !== null);
  if (problems.length > 0) return { ok: false, problems };

  for (const [keywordId, variants] of disagreements(contributions, (c) => c.keyword.keywordId, (c) => canonicalJson([c.keyword.canonicalKey, c.keyword.categoryId]))) {
    problems.push({ code: KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.IDENTITY_CONFLICT, message: `Keyword ${keywordId} is supplied with conflicting canonical key / category metadata`, path: null, details: { keywordId, variants } });
  }
  for (const [canonicalKey, ids] of disagreements(contributions, (c) => c.keyword.canonicalKey, (c) => c.keyword.keywordId)) {
    problems.push({ code: KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.CANONICAL_KEY_CONFLICT, message: `canonical key ${canonicalKey} is claimed by different Keyword ids`, path: null, details: { canonicalKey, keywordIds: ids } });
  }
  for (const [source, variants] of disagreements(contributions, sourceIdentity, (c) => canonicalJson([c.source.sourceId, c.source.provenance]))) {
    problems.push({ code: KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: `source ${source} is described inconsistently (sourceId / provenance)`, path: null, details: { source, variants } });
  }
  for (const [pair, variants] of disagreements(contributions, (c) => canonicalJson([c.keyword.keywordId, c.source.sourceType, c.source.sourceKey]), (c) => canonicalJson(c.ordinal))) {
    problems.push({ code: KEYWORD_RESOLUTION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: `one source contributes one Keyword with conflicting ordinals ${pair}`, path: null, details: { contribution: pair, variants } });
  }
  if (problems.length > 0) return { ok: false, problems };

  // Aggregate: one entry per keywordId; identical (keyword, source) contributions collapse into one contributor.
  const byKeyword = new Map<string, { keyword: KeywordReference; contributors: Map<string, KeywordContributor> }>();
  for (const c of contributions) {
    const entry = byKeyword.get(c.keyword.keywordId) ?? { keyword: c.keyword, contributors: new Map<string, KeywordContributor>() };
    entry.contributors.set(sourceIdentity(c), { source: c.source, ordinal: c.ordinal });
    byKeyword.set(c.keyword.keywordId, entry);
  }
  const keywords: ResolvedKeyword[] = [...byKeyword.values()]
    .map((e) => ({ keyword: e.keyword, contributors: [...e.contributors.values()].sort(contributorOrder) }))
    .sort((a, b) => byCodeUnit(a.keyword.canonicalKey, b.keyword.canonicalKey) || byCodeUnit(a.keyword.keywordId, b.keyword.keywordId));
  return { ok: true, set: { keywords } };
}

function toMessages(problems: readonly Problem[]): ValidationMessageDraft[] {
  return problems.map((p) =>
    validationMessage({ severity: "ERROR", category: "STRUCTURE", code: p.code, message: p.message, path: p.path, details: p.details }),
  );
}

/** A machine-readable trace: one step per resolved Keyword (set order), one child per contributor (contributor order). */
function traceOf(set: ResolvedKeywordSet): TraceStepInput[] {
  return [
    {
      key: "keywords",
      operation: KEYWORD_RESOLUTION_KIND,
      // Step keys are positional: M1 canonical keys have no length limit, trace step keys do.
      children: set.keywords.map((k, index) => ({
        key: `keyword.${index}`,
        operation: "keyword.present",
        inputs: [
          { name: "keyword_id", value: stringValue(k.keyword.keywordId) },
          { name: "canonical_key", value: stringValue(k.keyword.canonicalKey) },
        ],
        children: k.contributors.map((c, i) => ({
          key: `contributor.${i}`,
          operation: "keyword.contribution",
          inputs: [
            { name: "source_type", value: stringValue(c.source.sourceType) },
            { name: "source_key", value: stringValue(c.source.sourceKey) },
          ],
          provenance: c.source.provenance,
        })),
      })),
    },
  ];
}

export interface ResolveKeywordsOptions {
  /** The exact RulesetContext the resolution runs under; recorded as response provenance, never searched. */
  readonly ruleset?: unknown;
}

/**
 * Aggregates exact Keyword contributions into a `ResolvedKeywordSet` (§48), returned in the M4-WO1
 * `RuleEngineResponse`: SUCCESS with the set and a contribution trace, or INVALID with KEYWORD_RESOLUTION.*
 * messages. Pure and read-only; an empty list is a valid empty set. Input order never changes a successful result.
 */
export function resolveKeywords(contributions: unknown, options: ResolveKeywordsOptions = {}): RuleEngineResponse<ResolvedKeywordSet> {
  return evaluate<ResolvedKeywordSet | null>(
    {
      kind: KEYWORD_RESOLUTION_KIND,
      evaluate: () => {
        const result = aggregateKeywordContributions(contributions);
        if (!result.ok) return { data: null, messages: toMessages(result.problems) };
        return { data: result.set, trace: traceOf(result.set) };
      },
    },
    { kind: KEYWORD_RESOLUTION_KIND, ruleset: options.ruleset ?? null },
  ) as RuleEngineResponse<ResolvedKeywordSet>;
}
