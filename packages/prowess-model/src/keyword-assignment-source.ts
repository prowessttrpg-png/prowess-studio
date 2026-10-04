/**
 * Controlled source classification for a Keyword assignment (PAS-10
 * M1-WO5 §7).
 *
 * - `AUTHORED` — a manually-created assignment. The only kind M1-WO5
 *   actually creates.
 * - `INHERITED` — reserved for a future system that derives an assignment
 *   from something else (e.g. a parent Entity, a template). Establishes
 *   the architecture only; nothing in this Work Order ever produces an
 *   `INHERITED` row.
 * - `CALCULATED` — reserved for a future system that computes an
 *   assignment from rules/content. Same caveat: architecture only, not
 *   implemented.
 */
export const KEYWORD_ASSIGNMENT_SOURCES = ["AUTHORED", "INHERITED", "CALCULATED"] as const;

export type KeywordAssignmentSource = (typeof KEYWORD_ASSIGNMENT_SOURCES)[number];

export function isKeywordAssignmentSource(value: string): value is KeywordAssignmentSource {
  return (KEYWORD_ASSIGNMENT_SOURCES as readonly string[]).includes(value);
}
