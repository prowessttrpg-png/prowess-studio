/**
 * Controlled change-type values for EntityVersion change metadata (PAS-10
 * M1-WO2 §12).
 *
 * These are the already-defined PAS-08 architectural change-governance
 * values, reused here directly rather than inventing a parallel vocabulary
 * — M1-WO2 only needs a controlled, nullable classification for
 * `changeType`/`changeSummary`; the full PAS-08 ChangeSet/Canon governance
 * system itself is not implemented here.
 */
export const CHANGE_TYPES = [
  "EDITORIAL",
  "CLARIFICATION",
  "PRESENTATION",
  "MECHANICAL_PATCH",
  "MECHANICAL_CHANGE",
  "BREAKING_CHANGE",
  "CONTENT_ADDITION",
  "REMOVAL",
  "RENAME",
  "RESTRUCTURE",
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export function isChangeType(value: string): value is ChangeType {
  return (CHANGE_TYPES as readonly string[]).includes(value);
}
