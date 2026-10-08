import { DomainError, SOURCE_REFERENCE_ERROR_CODES } from "@prowess/model";

/**
 * M2-WO12 F2 — translates exactly ONE known refusal of SourceReference removal into a controlled error: a P2003
 * foreign-key violation on `rule_conflict_candidates_source_reference_fkey`, i.e. the reference is historical
 * conflict evidence. The RESTRICT key itself is unchanged and remains the authority. Every other error — including
 * any other P2003 — is returned UNCHANGED so it keeps failing closed through the generic 500 boundary.
 * Pure (no database access) so it can be unit-tested.
 */
export const SOURCE_REFERENCE_EVIDENCE_CONSTRAINTS = ["rule_conflict_candidates_source_reference_fkey"] as const;

export function mapSourceReferenceRemovalError(error: unknown, id: string): unknown {
  if (typeof error !== "object" || error === null || (error as { code?: unknown }).code !== "P2003") return error;
  const e = error as { message?: unknown; meta?: unknown };
  let haystack = typeof e.message === "string" ? e.message : "";
  try {
    haystack += ` ${JSON.stringify(e.meta ?? null)}`;
  } catch {
    // diagnostic only
  }
  if (!SOURCE_REFERENCE_EVIDENCE_CONSTRAINTS.some((c) => haystack.includes(c))) return error;
  return new DomainError(SOURCE_REFERENCE_ERROR_CODES.IN_USE, `SourceReference ${id} is historical evidence (a rule conflict candidate cites it) and cannot be removed`);
}
