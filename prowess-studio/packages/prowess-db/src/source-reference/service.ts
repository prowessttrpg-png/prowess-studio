import {
  DomainError,
  SOURCE_REFERENCE_ERROR_CODES,
  type CreateSourceReferenceInput,
  type SourceReference,
} from "@prowess/model";
import { getEntityVersion } from "../entity-version/service.js";
import { getSourceDocument } from "../source-document/service.js";
import {
  deleteSourceReference,
  insertSourceReference,
  selectSourceReferenceById,
  selectSourceReferencesForDocument,
  selectSourceReferencesForVersion,
} from "./repository.js";

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

  return insertSourceReference({
    sourceDocumentId: input.sourceDocumentId,
    entityVersionId,
    sectionLabel: input.sectionLabel ?? null,
    pageReference: input.pageReference ?? null,
    sourceExcerptNote: input.sourceExcerptNote ?? null,
  });
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
  const deleted = await deleteSourceReference(id);
  if (!deleted) {
    throw new DomainError(
      SOURCE_REFERENCE_ERROR_CODES.NOT_FOUND,
      `SourceReference not found: ${id}`,
    );
  }
}
