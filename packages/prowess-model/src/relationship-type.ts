/**
 * Controlled EntityRelationship type values (see PAS-10 §19, M1-WO6).
 *
 * A single authoritative direction is stored per relationship; inverse
 * language ("Required By") is a UI-layer presentation concern, not a second
 * stored relationship.
 */
export const RELATIONSHIP_TYPES = [
  "REQUIRES",
  "MODIFIES",
  "USES",
  "COMPATIBLE_WITH",
  "INCOMPATIBLE_WITH",
  "PART_OF",
  "BELONGS_TO",
  "SEE_ALSO",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}
