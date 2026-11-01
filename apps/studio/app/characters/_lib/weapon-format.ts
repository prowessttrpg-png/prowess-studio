import { formatEnumLabel } from "@prowess/ui";
import type { CharacterAttackDto, DamagePreviewDto, TraitUseDto } from "./character-client";

/**
 * Weapon & Attack DISPLAY helpers (PAS-10 M6-WO6). They only format what the server decided: dice expressions arrive
 * already built (`final.expression`), ranges arrive already evaluated for the Character (`rangeFeet`). Nothing here
 * scales damage, applies Power, steps a die or computes a range.
 */

/** "2d10 Slashing" — or the authored base and the reason when the preview failed closed. */
export function damageText(d: DamagePreviewDto): string {
  const type = formatEnumLabel(d.damageType);
  return d.final !== null ? `${d.final.expression} ${type}` : `${d.base.expression} ${type} (not previewed)`;
}

/** All selectable profiles of one Attack ("1d4 Slashing / 1d4 Bludgeoning") — never auto-selected. */
export const damageListText = (a: CharacterAttackDto) => a.damage.map(damageText).join(" / ");

/** Range / reach as the server evaluated it for this Character. */
export function rangeText(a: CharacterAttackDto): string {
  const r = a.range;
  switch (r.mode) {
    case "MELEE":
      return r.reachFeet === null ? "Melee" : `${r.reachFeet} ft`;
    case "CLOSE":
      return r.reachFeet === null ? "Close" : `Close (${r.reachFeet} ft)`;
    case "RANGED_MULTIPLIER": {
      const blast = r.area === null ? "" : `, Blast ${r.area.radiusFeet} ft`;
      const basis = r.basis === null ? "" : ` (${r.basis.feetPerPoint} ft × ${r.basis.stat})`;
      return `${r.rangeFeet ?? "—"} ft${basis}${blast}`;
    }
    case "LINE":
      return `${r.lengthFeet ?? "—"}-ft Line`;
    case "CONE":
      return `${r.lengthFeet ?? "—"}-ft Cone`;
    default:
      return formatEnumLabel(r.mode);
  }
}

/** "Pierce 1", "Loud 200", "Close" — a property's display label with its authored parameters. */
export function propertyText(u: { traitKey: string; parameters: Record<string, number> }): string {
  const values = Object.keys(u.parameters)
    .sort()
    .map((k) => u.parameters[k]);
  return values.length === 0 ? formatEnumLabel(u.traitKey) : `${formatEnumLabel(u.traitKey)} ${values.join("/")}`;
}

/** The Move's own properties (Weapon properties are shown with the Weapon). */
export const movePropertiesText = (a: CharacterAttackDto) => (a.moveProperties.length === 0 ? "—" : a.moveProperties.map((u: TraitUseDto) => propertyText(u)).join(", "));

/** "Attack Roll", "AGI Save (half on success)" … */
export function resolutionText(a: CharacterAttackDto): string {
  const r = a.resolution;
  if (r.mode === "SAVING_THROW") return `${r.savingThrowStat ?? ""} Save vs Character DC (${formatEnumLabel(r.onFailure ?? "")} / ${formatEnumLabel(r.onSuccess ?? "")})`;
  if (r.mode === "ATTACK_ROLL") return r.onMiss !== undefined && r.onMiss !== "NO_DAMAGE" ? `Attack Roll (${formatEnumLabel(r.onMiss)} on a miss)` : "Attack Roll";
  return "Resolution not yet defined";
}

/** A signed Accuracy adjustment ("Accuracy −2"), or null when there is none. */
export const accuracyText = (a: CharacterAttackDto) => (a.accuracyModifier === 0 ? null : `Accuracy ${a.accuracyModifier > 0 ? `+${a.accuracyModifier}` : String(a.accuracyModifier).replace("-", "−")}`);
