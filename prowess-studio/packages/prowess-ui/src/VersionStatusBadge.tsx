import { formatEnumLabel } from "./EntityTypeBadge.js";

export interface VersionStatusBadgeProps {
  status: string;
}

/**
 * A small, readable label for an `EntityVersionStatus` value. The status
 * word itself is always shown — a background tint is layered on for quick
 * visual scanning, but the text label is what actually communicates the
 * status (PAS-10 M1-WO9 §32: never color-only). This badge never implies
 * Canon/Ruleset authority — it shows exactly the lifecycle status PAS-10
 * M1-WO3 defined, nothing more.
 */
export function VersionStatusBadge({ status }: VersionStatusBadgeProps) {
  const toneClass = `prowess-badge--status-${status.toLowerCase().replace(/_/g, "-")}`;
  return (
    <span
      className={`prowess-badge prowess-badge--status ${toneClass}`}
      data-testid="version-status-badge"
    >
      {formatEnumLabel(status)}
    </span>
  );
}
