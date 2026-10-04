/** Converts a SCREAMING_SNAKE_CASE enum value into a readable label — "SPELL_EFFECT" -> "Spell Effect". */
export function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

export interface EntityTypeBadgeProps {
  entityType: string;
}

/**
 * A small, readable label for an `EntityType` value. Always renders the
 * text itself (never a color-only swatch) — status/type must never be
 * distinguishable by color alone (PAS-10 M1-WO9 §32).
 */
export function EntityTypeBadge({ entityType }: EntityTypeBadgeProps) {
  return (
    <span className="prowess-badge prowess-badge--entity-type" data-testid="entity-type-badge">
      {formatEnumLabel(entityType)}
    </span>
  );
}
