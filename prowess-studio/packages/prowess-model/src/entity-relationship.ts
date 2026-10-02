import type { JsonObject } from "./json.js";
import type { EntityId, EntityRelationshipId } from "./ids.js";
import type { RelationshipType } from "./relationship-type.js";

/**
 * EntityRelationship — a stable, directed, structural relationship
 * between two Entity identities (PAS-10 M1-WO6).
 *
 * ```
 * Entity A
 *     |
 *     v  RELATIONSHIP
 * Entity B
 * ```
 *
 * e.g. `Direct Damage REQUIRES Arcana`, `Silver Company BELONGS_TO Silver
 * City`, `Rule A SEE_ALSO Rule B` — conceptual examples only; this Work
 * Order seeds no official Prowess relationships.
 *
 * **Scope: stable Entity identity, not EntityVersion.** This models
 * editorial/structural relationships between the identities themselves —
 * "Direct Damage relates to Arcana" as a durable fact about those two
 * concepts, independent of either one's current rules text. It does NOT
 * model version-sensitive or calculation-bearing relationships (e.g. "in
 * Revision 3 specifically, this costs 2 fewer MP because of that
 * relationship") — those belong to dedicated version-scoped models,
 * `RequirementDefinition`, typed subsystem joins, or Ruleset-specific
 * structures, none of which exist yet and none of which this generic
 * table should be stretched to simulate.
 *
 * **No unstated mechanics (PAS-10 M1-WO6 §2), same principle as
 * Keywords:** an EntityRelationship states that a relationship exists. It
 * does NOT automatically modify MP, modify AP, change damage, grant a
 * Trait, satisfy a Requirement, determine targeting, alter Character
 * statistics, or activate a rule — including when the `relationshipType`
 * is literally `MODIFIES`. The name of the type is descriptive, not
 * executable. Future systems may explicitly *query* a relationship;
 * nothing here ever acts on one automatically.
 *
 * **Directional, stored once.** `A REQUIRES B` is one row. It does not
 * imply or automatically create `B REQUIRED_BY A`, and it is a distinct
 * fact from `B REQUIRES A` (which may or may not also exist, deliberately
 * authored). See `docs/architecture/entity-relationship-model.md` for the
 * full reasoning.
 */
export interface EntityRelationship {
  id: EntityRelationshipId;
  sourceEntityId: EntityId;
  targetEntityId: EntityId;
  relationshipType: RelationshipType;
  /**
   * Lightweight, non-authoritative structured context — editorial
   * qualifiers, notes, future display information. Defaults to `{}`.
   *
   * **Must never encode actual Prowess rule calculations** — e.g. a
   * `{ "mp_discount": 2 }` that some mechanical system then reads and
   * acts on. `metadata` is descriptive only; calculation-bearing
   * structures receive dedicated typed models in a later Work Order, not
   * a home in this JSON field.
   */
  metadata: JsonObject;
  createdAt: Date;
}

/** Input shape for creating a new EntityRelationship. */
export interface CreateEntityRelationshipInput {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  metadata?: JsonObject;
}
