import { InputProblems, readUuid } from "../internal/input-reader.js";
import type { ResolvedKeyword, ResolvedKeywordSet } from "./resolve.js";

/**
 * Exact membership queries on an already-resolved KeywordSet (PAS-10 M4-WO4 §18–22, §50, §73, §80). Pure, read-only,
 * no trace. Exact identity only: a Keyword id, or an exact M1 canonical key. There is no alias, display-name,
 * case-folding, prefix or fuzzy matching, no category or parent implication, and no fallback: `null` / `false` means
 * exactly "this Keyword is not in this set".
 *
 * These are the primitives M4-WO5 (Requirements) and M4-WO6 (Modifiers) will build on. They answer membership only;
 * what membership MEANS is always an explicit later rule.
 */

/** The resolved Keyword with exactly this KeywordDefinition id, or null. UUIDs compare case-insensitively. */
export function findResolvedKeywordById(set: ResolvedKeywordSet, keywordId: string): ResolvedKeyword | null {
  const id = readUuid(keywordId, [], new InputProblems()); // the M4-WO1 UUID reader; null when not a UUID
  if (id === null) return null;
  return set.keywords.find((k) => k.keyword.keywordId === id) ?? null;
}

/**
 * The resolved Keyword with exactly this canonical key, or null. Exact code-unit comparison — never normalized.
 * Binary search: the set is ordered by canonical key, and canonical keys are unique within it.
 */
export function findResolvedKeywordByCanonicalKey(set: ResolvedKeywordSet, canonicalKey: string): ResolvedKeyword | null {
  if (typeof canonicalKey !== "string") return null;
  let lo = 0;
  let hi = set.keywords.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const entry = set.keywords[mid] as ResolvedKeyword;
    const key = entry.keyword.canonicalKey;
    if (key === canonicalKey) return entry;
    if (key < canonicalKey) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export function hasKeywordById(set: ResolvedKeywordSet, keywordId: string): boolean {
  return findResolvedKeywordById(set, keywordId) !== null;
}

export function hasKeywordByCanonicalKey(set: ResolvedKeywordSet, canonicalKey: string): boolean {
  return findResolvedKeywordByCanonicalKey(set, canonicalKey) !== null;
}
