import type { EntityId, EntityVersionId, KeywordDefinitionId } from "./ids.js";
import type { KeywordAssignmentSource } from "./keyword-assignment-source.js";

/**
 * EntityKeyword — a statement that a stable Entity identity carries a
 * given Keyword (PAS-10 M1-WO5 §5–6).
 *
 * "Entity-level assignment means: this Keyword describes the stable
 * identity itself" — e.g. a creature classification, an organization
 * type, a Spell Effect's identity classification. Contrast with
 * `EntityVersionKeyword` below for Keywords whose applicability can change
 * by revision.
 *
 * Identity is the composite `(entityId, keywordId)` pair itself — there is
 * no separate synthetic id column; the natural key both IS the identity
 * and enforces "a target must not contain the same Keyword twice" (PAS-10
 * M1-WO5 §8) as a single database constraint, not an application-level
 * check layered on top of a separate id.
 *
 * Relational by design, not polymorphic: `EntityKeyword` and
 * `EntityVersionKeyword` are two separate, explicitly-typed assignment
 * models (each with real foreign keys PostgreSQL can enforce) rather than
 * one `target_type` + `target_id` table — see
 * `docs/architecture/keyword-model.md` for the full reasoning.
 */
export interface EntityKeyword {
  entityId: EntityId;
  keywordId: KeywordDefinitionId;
  sourceType: KeywordAssignmentSource;
  createdAt: Date;
}

/**
 * EntityVersionKeyword — a statement that a specific historical
 * EntityVersion carries a given Keyword (PAS-10 M1-WO5 §5–6).
 *
 * "EntityVersion-level assignment means: this Keyword applies to this
 * specific historical/versioned representation" — e.g. Fire, Ongoing,
 * Zone, Sustained: mechanical classifications capable of changing between
 * revisions. **Version-level assignment is the preferred location for any
 * Keyword describing mechanics that might change by revision** — Entity-
 * level is for the stable identity itself, not for anything that could
 * differ between Revision 1 and Revision 2.
 *
 * Identity is the composite `(entityVersionId, keywordId)` pair — same
 * reasoning as `EntityKeyword` above.
 *
 * **Lifecycle interaction (PAS-10 M1-WO5 §19):** since this describes the
 * *content* of a specific Version, authored assignment/removal follows the
 * same DRAFT-only mutability rule M1-WO3 established for every other
 * authored field — see `@prowess/db`'s
 * `assignKeywordToEntityVersion`/`removeKeywordFromEntityVersion` for the
 * enforcement, and `docs/architecture/keyword-model.md` for the full
 * explanation of why.
 */
export interface EntityVersionKeyword {
  entityVersionId: EntityVersionId;
  keywordId: KeywordDefinitionId;
  sourceType: KeywordAssignmentSource;
  createdAt: Date;
}
