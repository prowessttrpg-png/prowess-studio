import {
  DomainError,
  SOURCE_REFERENCE_ERROR_CODES,
  type CreateSourceReferenceInput,
  type CreateSourceStructuralLocationInput,
  type SourceReference,
} from "@prowess/model";
import { selectSourceSnapshotById } from "../source-snapshot/repository.js";
import { selectBlockById, selectSectionById, selectTableById } from "../source-structure/repository.js";
import { getEntityVersion } from "../entity-version/service.js";
import { getSourceDocument } from "../source-document/service.js";
import {
  deleteSourceReference,
  insertSourceReference,
  selectSourceReferenceById,
  selectSourceReferencesForDocument,
  selectSourceReferencesForVersion,
} from "./repository.js";
import { mapSourceReferenceRemovalError } from "./removal-errors.js";

/**
 * SourceReference service — the application/domain boundary for
 * SourceReference operations (PAS-10 M1-WO7 §16).
 *
 * **Lifecycle independence, by deliberate design (PAS-10 M1-WO7 §11):**
 * unlike `updateDraftEntityVersion`/Keyword assignment's content-mutation
 * rules, creating or removing a SourceReference is NOT gated by the
 * target EntityVersion's status. Attaching provenance to a `CANON`
 * Version succeeds — it is separately-managed audit metadata, not
 * authored mechanical content, and it never touches `rulesText`,
 * `structuredData`, `displayName`, `status`, or `revisionNumber`. M1-WO3's
 * lifecycle semantics are NOT implicitly expanded to cover this; a later
 * Canon/import governance system may impose stricter controls, but this
 * Work Order does not anticipate what those should be.
 */

/**
 * Creates a SourceReference linking `entityVersionId` to
 * `input.sourceDocumentId`.
 *
 * Validates, before anything reaches Prisma:
 *   - the EntityVersion exists (`ENTITY_VERSION.NOT_FOUND`, reused from
 *     M1-WO2 — not a redundant `SOURCE_REFERENCE.INVALID_VERSION`)
 *   - the SourceDocument exists (`SOURCE_DOCUMENT.NOT_FOUND`)
 *
 * No duplicate-prevention check — multiple References from the same
 * Version to the same Document, with different section/page locators, are
 * explicitly legitimate (PAS-10 M1-WO7 §24).
 */
export async function createSourceReference(
  entityVersionId: string,
  input: CreateSourceReferenceInput,
): Promise<SourceReference> {
  await getEntityVersion(entityVersionId);
  await getSourceDocument(input.sourceDocumentId);
  const location = await validateStructuralLocation(input.sourceDocumentId, input.structuralLocation ?? null);

  return insertSourceReference({
    sourceDocumentId: input.sourceDocumentId,
    entityVersionId,
    sectionLabel: input.sectionLabel ?? null,
    pageReference: input.pageReference ?? null,
    sourceExcerptNote: input.sourceExcerptNote ?? null,
    sourceSnapshotId: location?.sourceSnapshotId ?? null,
    sourceSectionId: location?.sourceSectionId ?? null,
    sourceBlockId: location?.sourceBlockId ?? null,
    sourceTableId: location?.sourceTableId ?? null,
  });
}

/**
 * M3-WO1: validates an optional exact structural location. Absent/null keeps the M1 behaviour exactly. When
 * present, the Snapshot must be a Snapshot OF the referenced SourceDocument, and every finer locator must belong to
 * that Snapshot — otherwise `SOURCE_REFERENCE.INVALID_INPUT` (the reserved M1 code, now used). The database's
 * composite foreign keys and CHECK constraint enforce the same rules independently.
 */
async function validateStructuralLocation(
  sourceDocumentId: string,
  location: CreateSourceStructuralLocationInput | null,
): Promise<{ sourceSnapshotId: string; sourceSectionId: string | null; sourceBlockId: string | null; sourceTableId: string | null } | null> {
  if (location === null) return null;
  const invalid = (message: string) => new DomainError(SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT, message);
  if (typeof location !== "object" || typeof location.sourceSnapshotId !== "string") {
    throw invalid("structuralLocation.sourceSnapshotId is required when a structural location is given");
  }
  const snapshot = await selectSourceSnapshotById(location.sourceSnapshotId);
  if (!snapshot) throw invalid(`structuralLocation: SourceSnapshot ${location.sourceSnapshotId} does not exist`);
  if (snapshot.sourceDocumentId !== sourceDocumentId) {
    throw invalid(`structuralLocation: SourceSnapshot ${snapshot.id} is not a Snapshot of SourceDocument ${sourceDocumentId}`);
  }
  const check = async (id: string | null | undefined, what: string, load: (id: string) => Promise<{ sourceSnapshotId: string } | null>) => {
    if (id === undefined || id === null) return null;
    const found = typeof id === "string" ? await load(id) : null;
    if (!found) throw invalid(`structuralLocation: ${what} ${String(id)} does not exist`);
    if (found.sourceSnapshotId !== snapshot.id) throw invalid(`structuralLocation: ${what} ${id} belongs to a different Snapshot`);
    return id;
  };
  return {
    sourceSnapshotId: snapshot.id,
    sourceSectionId: await check(location.sourceSectionId, "SourceSection", selectSectionById),
    sourceBlockId: await check(location.sourceBlockId, "SourceBlock", selectBlockById),
    sourceTableId: await check(location.sourceTableId, "SourceTable", selectTableById),
  };
}

/** Retrieves a SourceReference by its explicit UUID identity. */
export async function getSourceReference(id: string): Promise<SourceReference> {
  const reference = await selectSourceReferenceById(id);
  if (!reference) {
    throw new DomainError(
      SOURCE_REFERENCE_ERROR_CODES.NOT_FOUND,
      `SourceReference not found: ${id}`,
    );
  }
  return reference;
}

/**
 * All SourceReferences for an EntityVersion, ordered `createdAt ASC, id
 * ASC` (PAS-10 M1-WO7 §38). Returns an empty array, not an error, for a
 * Version with none.
 */
export async function listSourceReferencesForVersion(
  entityVersionId: string,
): Promise<SourceReference[]> {
  return selectSourceReferencesForVersion(entityVersionId);
}

/**
 * All SourceReferences pointing at a SourceDocument, same deterministic
 * ordering as the Version-scoped list above.
 */
export async function listSourceReferencesForDocument(
  sourceDocumentId: string,
): Promise<SourceReference[]> {
  return selectSourceReferencesForDocument(sourceDocumentId);
}

/**
 * Removes a SourceReference. Throws `SOURCE_REFERENCE.NOT_FOUND` if no
 * reference exists with that id. Removes only the reference row — never
 * the SourceDocument, Entity, EntityVersion, aliases, Keywords, or
 * EntityRelationships.
 */
export async function removeSourceReference(id: string): Promise<void> {
  let deleted: Awaited<ReturnType<typeof deleteSourceReference>>;
  try {
    deleted = await deleteSourceReference(id);
  } catch (error) {
    // M2-WO12 F2: only the known evidence-reference refusal becomes SOURCE_REFERENCE.IN_USE; anything else rethrows.
    throw mapSourceReferenceRemovalError(error, id);
  }
  if (!deleted) {
    throw new DomainError(
      SOURCE_REFERENCE_ERROR_CODES.NOT_FOUND,
      `SourceReference not found: ${id}`,
    );
  }
}
