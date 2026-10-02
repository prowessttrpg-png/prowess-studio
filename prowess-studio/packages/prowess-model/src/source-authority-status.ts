/**
 * Controlled SourceDocument authority classification (PAS-10 M1-WO7 §4),
 * matching the PAS-08 Canon Manager's established vocabulary exactly (see
 * `claude_canon-manager-version-control-ruleset-publishing-specification-v0_1.md`)
 * — not an independently-invented parallel one.
 *
 * **In M1-WO7, this field is descriptive only.** Setting it does NOT:
 *   - determine Canon;
 *   - choose a current rule;
 *   - override a Ruleset;
 *   - automatically supersede another document.
 *
 * Actual source-authority *governance* — the behavior that would make any
 * of the above true — belongs to PAS-08/M2's Canon Manager, which does not
 * exist yet. Nothing in `@prowess/model` or `@prowess/db` reads this field
 * to make any decision; it is recorded, not acted on.
 */
export const SOURCE_AUTHORITY_STATUSES = [
  "GOVERNING",
  "CURRENT_PRIMARY",
  "CURRENT_SUPPLEMENTAL",
  "PLAYTEST_REFERENCE",
  "HISTORICAL",
  "SUPERSEDED",
  "REFERENCE_ONLY",
  "UNRESOLVED",
] as const;

export type SourceAuthorityStatus = (typeof SOURCE_AUTHORITY_STATUSES)[number];

export function isSourceAuthorityStatus(value: string): value is SourceAuthorityStatus {
  return (SOURCE_AUTHORITY_STATUSES as readonly string[]).includes(value);
}
