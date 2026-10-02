import type { CanonicalKey } from "./canonical-key.js";
import type { KeywordCategoryId } from "./ids.js";

/**
 * KeywordCategory — an organizational grouping for `KeywordDefinition`s
 * (PAS-10 M1-WO5 §2). Purely organizational metadata; a Category carries
 * no mechanical meaning any more than a Keyword itself does.
 *
 * Uses the same `CanonicalKey` grammar/validation as every other canonical
 * key in this platform — no parallel key format exists for Keywords.
 * Future category keys might conceptually resemble
 * `keyword.category.effect` or `keyword.category.damage`, but none are
 * seeded by this Work Order.
 */
export interface KeywordCategory {
  id: KeywordCategoryId;
  canonicalKey: CanonicalKey;
  /** Human-facing name — e.g. "Effect", "Damage", "Affinity". */
  name: string;
  description: string | null;
  createdAt: Date;
  // Deliberately no `updatedAt`: M1-WO5 exposes no update operation for
  // KeywordCategory at all (create/get/find-by-key only — see
  // docs/architecture/keyword-model.md), so there is nothing yet for an
  // `updatedAt` column to track. Same reasoning M1-WO2 used to justify
  // initially omitting `EntityVersion.updatedAt` until a mutation policy
  // existed.
}

export interface CreateKeywordCategoryInput {
  canonicalKey: string;
  name: string;
  description?: string | null;
}
