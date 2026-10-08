import type {
  EntityVersionId,
  SourceBlockId,
  SourceDocumentId,
  SourceReferenceId,
  SourceSectionId,
  SourceSnapshotId,
  SourceTableId,
} from "./ids.js";

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
  /**
   * M3-WO1: an exact location inside the structured source layer, or `null`. Every M1-era reference is `null`
   * here and stays exactly as readable as before — the free-text locators above are untouched and remain valid.
   * When present, the Snapshot is guaranteed (by composite foreign keys) to be a Snapshot of `sourceDocumentId`,
   * and the section / block / table to belong to that Snapshot.
   */
  structuralLocation: SourceStructuralLocation | null;
  createdAt: Date;
}

/**
 * An exact place in ONE SourceSnapshot (PAS-10 M3-WO1). `sourceSnapshotId` is always present; the finer locators
 * are optional and independent (a block may be cited with or without its section). Pointing at structure records
 * WHERE a source says something — never whether that source is Canon.
 */
export interface SourceStructuralLocation {
  sourceSnapshotId: SourceSnapshotId;
  sourceSectionId: SourceSectionId | null;
  sourceBlockId: SourceBlockId | null;
  sourceTableId: SourceTableId | null;
}

export interface CreateSourceReferenceInput {
  sourceDocumentId: string;
  sectionLabel?: string | null;
  pageReference?: string | null;
  sourceExcerptNote?: string | null;
  /** M3-WO1: optional exact structural location. Omitted / null keeps M1 behavior exactly. */
  structuralLocation?: CreateSourceStructuralLocationInput | null;
}

export interface CreateSourceStructuralLocationInput {
  sourceSnapshotId: string;
  sourceSectionId?: string | null;
  sourceBlockId?: string | null;
  sourceTableId?: string | null;
}
