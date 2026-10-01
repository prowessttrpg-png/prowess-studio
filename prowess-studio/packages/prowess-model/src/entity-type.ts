/**
 * Controlled Entity type values.
 *
 * Per PAS-10 §14 (M1-WO1), this set is deliberately minimal for Phase 1 and
 * must remain extensible — new domains (Spell Effects, Traits, etc.) will
 * register additional types without requiring structural changes here.
 */
export const ENTITY_TYPES = [
  "GENERIC_RULE",
  "SYSTEM",
  "RESOURCE",
  "SPELL_EFFECT",
  "SPELL_TRAIT",
  "TARGETING",
  "KEYWORD",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}
