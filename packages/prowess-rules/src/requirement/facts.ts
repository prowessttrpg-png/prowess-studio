import type { EntityId } from "@prowess/model";
import { canonicalJson } from "../internal/canonical-json.js";
import { InputProblems, readUuid } from "../internal/input-reader.js";
import { deepFreeze, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { aggregateKeywordContributions, type ResolvedKeywordSet } from "../keyword/resolve.js";
import { readProvenance, type RuleProvenance } from "../result/provenance.js";
import { REQUIREMENT_DIAGNOSTIC_CODES, type RequirementDiagnostic, type RequirementDiagnosticCode } from "./model.js";
import { isExactLabel, isValidFactKey } from "./validate.js";

/**
 * RequirementFacts (PAS-10 M4-WO5 §13, §22–30, §59, §76–77, §82): the explicit facts a Requirement is evaluated
 * against. The engine never computes a fact — no stat, level, rank, resource or ownership is derived here; each is
 * read exactly as supplied.
 *
 *  - `numeric`         finite numbers only (no coercion of "5", true, null; NaN / ±Infinity rejected; -0 → 0)
 *  - `ranks`           ordered ranks: an exact `rankKey` label plus an integer `order` supplied by content
 *  - `sets`            exact string members (duplicates collapse; member order is irrelevant)
 *  - `ownedEntityIds`  exact Entity ids, or null when the ownership collection is NOT supplied
 *  - `keywords`        an M4-WO4 ResolvedKeywordSet, or null when not supplied
 *
 * Fact keys are exact (the Formula identifier grammar). One key belongs to one fact kind. The same key supplied twice
 * with identical content collapses; with different content (value, rank, members or provenance) it is a FACT_CONFLICT —
 * never "last one wins". Fact collections are normalized into code-unit key order, so input order never matters.
 */
export interface NumericFact {
  readonly key: string;
  readonly value: number;
  readonly provenance: RuleProvenance | null;
}

export interface RankFact {
  readonly key: string;
  readonly rankKey: string;
  readonly order: number;
  readonly provenance: RuleProvenance | null;
}

export interface SetFact {
  readonly key: string;
  readonly members: readonly string[];
  readonly provenance: RuleProvenance | null;
}

export interface RequirementFacts {
  readonly numeric: readonly NumericFact[];
  readonly ranks: readonly RankFact[];
  readonly sets: readonly SetFact[];
  readonly ownedEntityIds: readonly EntityId[] | null;
  readonly keywords: ResolvedKeywordSet | null;
}

export type RequirementFactsOutcome =
  | { readonly ok: true; readonly facts: RequirementFacts }
  | { readonly ok: false; readonly diagnostics: readonly RequirementDiagnostic[] };

const FACT_FIELDS = ["numeric", "ranks", "sets", "ownedEntityIds", "keywords"];
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const zero = (n: number) => (Object.is(n, -0) ? 0 : n);

/** A plain object whose keys are all own data properties within `allowed` (getters are never invoked). */
function ownRecord(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.keys(value).every((k) => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return allowed.includes(k) && d !== undefined && d.get === undefined && d.set === undefined;
  });
}
const isList = (value: unknown): value is unknown[] => Array.isArray(value);
const scalarOrNull = (v: unknown) => v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/**
 * Shallow shape check of a ResolvedKeywordSet (fixed depth, no recursion on untrusted data), then a rebuild through
 * M4-WO4's own aggregation: a supplied set is accepted only if WO4 would produce exactly it. A hand-built, reordered or
 * internally inconsistent set is rejected — WO4's exact lookup relies on its ordering.
 */
function readKeywordSet(value: unknown): ResolvedKeywordSet | null {
  if (!ownRecord(value, ["keywords"]) || !isList(value.keywords)) return null;
  const contributions: unknown[] = [];
  for (const entry of value.keywords) {
    if (!ownRecord(entry, ["keyword", "contributors"]) || !isList(entry.contributors) || entry.contributors.length === 0) return null;
    if (!ownRecord(entry.keyword, ["keywordId", "canonicalKey", "categoryId"]) || !Object.values(entry.keyword).every(scalarOrNull)) return null;
    for (const c of entry.contributors) {
      if (!ownRecord(c, ["source", "ordinal"]) || !scalarOrNull(c.ordinal ?? null)) return null;
      if (!ownRecord(c.source, ["sourceType", "sourceKey", "sourceId", "provenance"])) return null;
      const p = c.source.provenance;
      if (p !== null && p !== undefined && (!ownRecord(p, ["entityId", "entityVersionId", "canonicalKey", "rulesetId", "manifestId"]) || !Object.values(p).every(scalarOrNull))) return null;
      if (![c.source.sourceType, c.source.sourceKey, c.source.sourceId ?? null].every(scalarOrNull)) return null;
      contributions.push({ keyword: entry.keyword, source: c.source, ordinal: c.ordinal ?? null });
    }
  }
  const rebuilt = aggregateKeywordContributions(contributions);
  if (!rebuilt.ok || canonicalJson(rebuilt.set) !== canonicalJson(value)) return null;
  return rebuilt.set;
}

export function createRequirementFacts(input: unknown, base: readonly (string | number)[] = []): RequirementFactsOutcome {
  const diagnostics: RequirementDiagnostic[] = [];
  const report = (code: RequirementDiagnosticCode, message: string, path: readonly (string | number)[]) =>
    diagnostics.push({ code, message, path: jsonPointer([...base, ...path]), nodePath: null, provenance: null });
  const invalid = (message: string, ...path: (string | number)[]) => report(REQUIREMENT_DIAGNOSTIC_CODES.INVALID_FACTS, message, path);

  const facts = input === undefined ? {} : input;
  if (!ownRecord(facts, FACT_FIELDS)) {
    invalid(`facts must be a plain object with only ${FACT_FIELDS.join(", ")}`);
    return deepFreeze({ ok: false as const, diagnostics });
  }
  const provenanceOf = (value: unknown, ...path: (string | number)[]): RuleProvenance | null | undefined => {
    const problems = new InputProblems();
    const p = readProvenance(value, [], problems);
    if (problems.count > 0) {
      invalid("provenance is malformed", ...path, "provenance");
      return undefined;
    }
    return p;
  };

  // 1. Structure, in input order per collection.
  const read = <T>(field: string, allowed: readonly string[], parse: (entry: Record<string, unknown>, i: number) => T | null): T[] => {
    const list = facts[field];
    if (list === undefined || list === null) return [];
    if (!isList(list)) {
      invalid(`${field} must be an array`, field);
      return [];
    }
    const out: T[] = [];
    list.forEach((entry, i) => {
      if (!ownRecord(entry, allowed)) {
        invalid(`each ${field} entry must be a plain object with only ${allowed.join(", ")}`, field, i);
        return;
      }
      if (!isValidFactKey(entry.key)) {
        invalid("key must be an exact fact identifier", field, i, "key");
        return;
      }
      const parsed = parse(entry, i);
      if (parsed !== null) out.push(parsed);
    });
    return out;
  };

  const numeric = read<NumericFact>("numeric", ["key", "value", "provenance"], (e, i) => {
    if (typeof e.value !== "number" || !Number.isFinite(e.value)) return (invalid("value must be a finite number (no coercion)", "numeric", i, "value"), null);
    const provenance = provenanceOf(e.provenance, "numeric", i);
    return provenance === undefined ? null : { key: e.key as string, value: zero(e.value), provenance };
  });
  const ranks = read<RankFact>("ranks", ["key", "rankKey", "order", "provenance"], (e, i) => {
    if (!isExactLabel(e.rankKey)) return (invalid("rankKey must be an exact non-empty label", "ranks", i, "rankKey"), null);
    if (typeof e.order !== "number" || !Number.isSafeInteger(e.order)) return (invalid("order must be a finite integer", "ranks", i, "order"), null);
    const provenance = provenanceOf(e.provenance, "ranks", i);
    return provenance === undefined ? null : { key: e.key as string, rankKey: e.rankKey, order: zero(e.order), provenance };
  });
  const sets = read<SetFact>("sets", ["key", "members", "provenance"], (e, i) => {
    if (!isList(e.members)) return (invalid("members must be an array of exact labels", "sets", i, "members"), null);
    const bad = e.members.findIndex((m) => !isExactLabel(m));
    if (bad >= 0) return (invalid("members must be exact non-empty labels", "sets", i, "members", bad), null);
    const provenance = provenanceOf(e.provenance, "sets", i);
    return provenance === undefined ? null : { key: e.key as string, members: [...new Set(e.members as string[])].sort(byCodeUnit), provenance };
  });

  let ownedEntityIds: EntityId[] | null = null;
  const owned = facts.ownedEntityIds;
  if (owned !== undefined && owned !== null) {
    if (!isList(owned)) invalid("ownedEntityIds must be an array of Entity UUIDs or null", "ownedEntityIds");
    else {
      const ids: string[] = [];
      owned.forEach((v, i) => {
        const id = readUuid(v, [], new InputProblems());
        if (id === null) invalid("each owned Entity id must be a UUID", "ownedEntityIds", i);
        else ids.push(id);
      });
      ownedEntityIds = [...new Set(ids)].sort(byCodeUnit) as EntityId[];
    }
  }

  let keywords: ResolvedKeywordSet | null = null;
  if (facts.keywords !== undefined && facts.keywords !== null) {
    keywords = readKeywordSet(facts.keywords);
    if (keywords === null) invalid("keywords must be a ResolvedKeywordSet exactly as M4-WO4's resolveKeywords produces it", "keywords");
  }
  if (diagnostics.length > 0) return deepFreeze({ ok: false as const, diagnostics });

  // 2. Conflicts, grouped and sorted by key so reporting never depends on input order.
  const collapse = <T extends { key: string }>(field: string, list: readonly T[]): T[] => {
    const byKey = new Map<string, T[]>();
    for (const f of list) byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]);
    const out: T[] = [];
    for (const key of [...byKey.keys()].sort(byCodeUnit)) {
      const variants = byKey.get(key) as T[];
      if (new Set(variants.map((v) => canonicalJson(v))).size > 1) {
        report(REQUIREMENT_DIAGNOSTIC_CODES.FACT_CONFLICT, `fact "${key}" is supplied with conflicting ${field} content`, [field]);
        continue;
      }
      out.push(variants[0] as T);
    }
    return out;
  };
  const numericFacts = collapse("numeric", numeric);
  const rankFacts = collapse("ranks", ranks);
  const setFacts = collapse("sets", sets);
  const kindOf = new Map<string, string[]>();
  for (const [field, list] of [["numeric", numericFacts], ["ranks", rankFacts], ["sets", setFacts]] as const) {
    for (const f of list) kindOf.set(f.key, [...(kindOf.get(f.key) ?? []), field]);
  }
  for (const key of [...kindOf.keys()].sort(byCodeUnit)) {
    const kinds = kindOf.get(key) as string[];
    if (kinds.length > 1) report(REQUIREMENT_DIAGNOSTIC_CODES.FACT_CONFLICT, `fact "${key}" is supplied as more than one fact kind (${kinds.join(", ")})`, []);
  }
  if (diagnostics.length > 0) return deepFreeze({ ok: false as const, diagnostics });

  return deepFreeze({ ok: true as const, facts: { numeric: numericFacts, ranks: rankFacts, sets: setFacts, ownedEntityIds, keywords } });
}
