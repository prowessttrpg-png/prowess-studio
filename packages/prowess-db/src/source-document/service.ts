import {
  DomainError,
  isSourceAuthorityStatus,
  isSourceDocumentType,
  isValidSourceDocumentTitle,
  SOURCE_DOCUMENT_ERROR_CODES,
  type CreateSourceDocumentInput,
  type SourceDocument,
} from "@prowess/model";
import {
  insertSourceDocument,
  selectSourceDocumentById,
  selectSourceDocuments,
} from "./repository.js";

/**
 * SourceDocument service — the application/domain boundary for
 * SourceDocument operations (PAS-10 M1-WO7 §15). No canonical-key system
 * exists for Sources in this Work Order — `title` is human-facing display
 * metadata, never relational identity.
 */

/**
 * Creates a new SourceDocument.
 *
 * Validates, before anything reaches Prisma:
 *   - `title` is non-empty and within the documented length limit
 *   - `sourceType` is a recognized `SourceDocumentType`
 *   - `authorityStatus`, if supplied, is a recognized `SourceAuthorityStatus`
 *     — this is descriptive metadata validation only; it has no bearing on
 *     Canon, Rulesets, or any other document's authority (see
 *     `@prowess/model`'s `source-authority-status.ts`)
 */
export async function createSourceDocument(
  input: CreateSourceDocumentInput,
): Promise<SourceDocument> {
  if (!isValidSourceDocumentTitle(input.title)) {
    throw new DomainError(
      SOURCE_DOCUMENT_ERROR_CODES.INVALID_INPUT,
      "title is required and must not be empty",
    );
  }
  if (!isSourceDocumentType(input.sourceType)) {
    throw new DomainError(
      SOURCE_DOCUMENT_ERROR_CODES.INVALID_INPUT,
      `Not a recognized SourceDocumentType: ${JSON.stringify(input.sourceType)}`,
    );
  }
  if (input.authorityStatus != null && !isSourceAuthorityStatus(input.authorityStatus)) {
    throw new DomainError(
      SOURCE_DOCUMENT_ERROR_CODES.INVALID_INPUT,
      `Not a recognized SourceAuthorityStatus: ${JSON.stringify(input.authorityStatus)}`,
    );
  }

  return insertSourceDocument({
    title: input.title,
    sourceType: input.sourceType,
    versionLabel: input.versionLabel ?? null,
    authorityStatus: input.authorityStatus ?? null,
    fileReference: input.fileReference ?? null,
    notes: input.notes ?? null,
  });
}

/** Retrieves a SourceDocument by its explicit UUID identity. */
export async function getSourceDocument(id: string): Promise<SourceDocument> {
  const document = await selectSourceDocumentById(id);
  if (!document) {
    throw new DomainError(SOURCE_DOCUMENT_ERROR_CODES.NOT_FOUND, `SourceDocument not found: ${id}`);
  }
  return document;
}

/** All SourceDocuments, ordered `title ASC, id ASC` (PAS-10 M1-WO7 §15). */
export async function listSourceDocuments(): Promise<SourceDocument[]> {
  return selectSourceDocuments();
}
