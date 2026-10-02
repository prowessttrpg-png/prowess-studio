import type { EntityVersionId, SourceDocumentId, SourceReferenceId } from "./ids.js";

/**
 * SourceReference — a link from a specific `EntityVersion` to the
 * `SourceDocument` it was derived from (PAS-10 M1-WO7 §6).
 *
 * **Attaches to `EntityVersion`, not stable `Entity` — deliberately (PAS-10
 * M1-WO7 §1).** Different revisions of the same Entity may derive from
 * different sources:
 *
 * ```
 * Entity: spell.effect.damage.direct
 *   Revision 1 -> Old Spellcasting Draft
 *   Revision 2 -> Core Playtest Spellcasting
 * ```
 *
 * A SourceReference attached to Revision 1 is never inferred to apply to
 * Revision 2 — creating a new Version never automatically copies the
 * previous Version's SourceReferences (PAS-10 M1-WO7 §10). Each Version's
 * provenance is independently, explicitly recorded.
 *
 * Not gated by DRAFT/CANON lifecycle status — see
 * `docs/architecture/source-provenance-model.md`'s "Lifecycle
 * independence" section for why attaching provenance to a protected
 * Version is allowed and does not count as authored content mutation.
 *
 * Not a document-copying system: `sourceExcerptNote` is a short editorial
 * annotation, never the full source text. Full raw-source preservation
 * and section/block-level extraction belong to a later M3 Work Order.
 */
export interface SourceReference {
  id: SourceReferenceId;
  sourceDocumentId: SourceDocumentId;
  entityVersionId: EntityVersionId;
  /** Free text, e.g. "Spell AP Cost", "Direct Damage", "Character Creation". */
  sectionLabel: string | null;
  /**
   * Stored as text, not an integer — deliberately, so values like `"14"`,
   * `"14-16"`, `"iv"`, or `"Appendix A"` are all representable. No page-
   * number arithmetic is ever performed on this field.
   */
  pageReference: string | null;
  /** A short editorial/provenance annotation — NOT the full source text. */
  sourceExcerptNote: string | null;
  createdAt: Date;
}

export interface CreateSourceReferenceInput {
  sourceDocumentId: string;
  sectionLabel?: string | null;
  pageReference?: string | null;
  sourceExcerptNote?: string | null;
}
