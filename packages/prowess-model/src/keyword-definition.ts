import type { CanonicalKey } from "./canonical-key.js";
import type { KeywordCategoryId, KeywordDefinitionId } from "./ids.js";

/**
 * KeywordDefinition — the reusable Keyword concept itself (PAS-10 M1-WO5
 * §3–4).
 *
 * **Core rule, impossible to overstate (PAS-10 M1-WO5 §1): a Keyword means
 * only "this object is tagged with this defined concept." It does NOT
 * implicitly mean** add damage, change MP, modify AP, trigger a Trait,
 * grant resistance, change targeting, or invoke any other mechanical
 * behavior. Mechanical systems may explicitly query Keywords later — no
 * Keyword may acquire unstated mechanical behavior as a side effect of
 * this Work Order.
 *
 * A `KeywordDefinition` is NOT the same thing as an assignment of that
 * Keyword to something:
 *
 * ```
 * KeywordDefinition:
 *   keyword.damage
 *
 * EntityVersion:
 *   Direct Damage Revision 2
 *
 * Assignment:
 *   Direct Damage Revision 2 -> keyword.damage
 * ```
 *
 * There is exactly one `KeywordDefinition` row per concept, reused by
 * every Entity/EntityVersion that gets tagged with it — never duplicated
 * per target. See `./entity-keyword.js` for the separate assignment
 * record types.
 *
 * Also distinct from `EntityType.KEYWORD` (M1-WO1): no `Entity` row is
 * automatically created for a `KeywordDefinition` in this Work Order.
 * `KeywordDefinition.id` is the one clear source of Keyword identity for
 * now; whether some Keywords should later also be represented as broader
 * Entities (for Canon/content-unification purposes) is an explicit future
 * decision, not something this Work Order decides by accident.
 */
export interface KeywordDefinition {
  id: KeywordDefinitionId;
  canonicalKey: CanonicalKey;
  /** Human-facing name — e.g. "Damage", "Fire", "Sustained". */
  name: string;
  /** Zero or one Category. A Keyword may exist uncategorized. */
  categoryId: KeywordCategoryId | null;
  description: string | null;
  /**
   * Descriptive metadata ONLY in M1-WO5 (§33) — defaults to `false` at
   * creation. Setting this `true` does not automatically delete existing
   * assignments, does not prevent new assignments, and has no other
   * behavioral effect. Actual deprecation governance belongs to a later
   * Canon system.
   */
  deprecated: boolean;
  createdAt: Date;
  // Deliberately no `updatedAt` — same reasoning as KeywordCategory: no
  // update operation exists for KeywordDefinition in M1-WO5.
}

export interface CreateKeywordDefinitionInput {
  canonicalKey: string;
  name: string;
  categoryId?: string | null;
  description?: string | null;
}

/** Documented limit for `KeywordCategory.name` / `KeywordDefinition.name`. */
export const MAX_KEYWORD_NAME_LENGTH = 200;

/**
 * Whether `value` is a valid human-facing name for a KeywordCategory or
 * KeywordDefinition: non-empty once trimmed, and within
 * `MAX_KEYWORD_NAME_LENGTH`. Shared by both, since the same "non-empty
 * name" requirement applies identically to each (PAS-10 M1-WO5 §12) — one
 * function rather than duplicating the check.
 */
export function isValidKeywordName(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length > MAX_KEYWORD_NAME_LENGTH) {
    return false;
  }
  return value.trim().length > 0;
}
