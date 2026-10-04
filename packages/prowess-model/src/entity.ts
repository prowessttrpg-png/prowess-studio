import type { CanonicalKey } from "./canonical-key.js";
import type { EntityId } from "./ids.js";
import type { EntityType } from "./entity-type.js";

/**
 * Entity — the stable identity object used throughout Prowess (PAS-10
 * M1-WO1).
 *
 * An Entity represents *what a Prowess concept is*, independent of any
 * particular historical rules/lore version of that concept. It is
 * deliberately minimal and deliberately almost never changes after
 * creation.
 *
 * Conceptual example:
 *
 * ```
 * Entity
 *   id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *   entityType: SPELL_EFFECT
 *   canonicalKey: spell.effect.damage.direct
 * ```
 *
 * This type intentionally does NOT, and must never, include:
 *   - a display name
 *   - a description
 *   - rules text
 *   - mechanical values
 *   - lore text
 *   - a status
 *   - a version number
 *   - Spell configuration or any other balance data
 *
 * All of the above belong on `EntityVersion` (M1-WO2), which represents
 * changing/versioned content *about* a stable Entity. "Direct Damage" the
 * visible name, its description, and its current rules text all live on
 * some `EntityVersion` that points back at this Entity's `id` — never here.
 */
export interface Entity {
  id: EntityId;
  entityType: EntityType;
  canonicalKey: CanonicalKey;
  createdAt: Date;
  updatedAt: Date;
}
