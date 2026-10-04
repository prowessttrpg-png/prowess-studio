import {
  EntityVersionId,
  SourceDocumentId,
  SourceReferenceId,
  type SourceReference,
} from "@prowess/model";
import { prisma } from "../client.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { SourceReference as PrismaSourceReferenceRow } from "../../generated/prisma/client.js";

/**
 * SourceReference repository — the only place in this package that speaks
 * Prisma's `sourceReference` query API directly. Internal implementation
 * detail of the source-reference service (not re-exported from
 * `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 */

function toDomainSourceReference(row: PrismaSourceReferenceRow): SourceReference {
  return {
    id: SourceReferenceId.of(row.id),
    sourceDocumentId: SourceDocumentId.of(row.sourceDocumentId),
    entityVersionId: EntityVersionId.of(row.entityVersionId),
    sectionLabel: row.sectionLabel,
    pageReference: row.pageReference,
    sourceExcerptNote: row.sourceExcerptNote,
    createdAt: row.createdAt,
  };
}

export interface InsertSourceReferenceInput {
  sourceDocumentId: string;
  entityVersionId: string;
  sectionLabel: string | null;
  pageReference: string | null;
  sourceExcerptNote: string | null;
}

/**
 * Inserts a new SourceReference row. Does not catch or translate errors —
 * a nonexistent `sourceDocumentId`/`entityVersionId` surfaces as a
 * foreign-key violation; the service layer validates both exist
 * beforehand instead, so this should not occur through the supported
 * service boundary.
 */
export async function insertSourceReference(
  input: InsertSourceReferenceInput,
): Promise<SourceReference> {
  const row = await prisma.sourceReference.create({
    data: {
      sourceDocumentId: input.sourceDocumentId,
      entityVersionId: input.entityVersionId,
      sectionLabel: input.sectionLabel,
      pageReference: input.pageReference,
      sourceExcerptNote: input.sourceExcerptNote,
    },
  });
  return toDomainSourceReference(row);
}

export async function selectSourceReferenceById(id: string): Promise<SourceReference | null> {
  try {
    const row = await prisma.sourceReference.findUnique({ where: { id } });
    return row ? toDomainSourceReference(row) : null;
  } catch {
    return null;
  }
}

/** Ordered `createdAt ASC, id ASC` — deterministic (PAS-10 M1-WO7 §38). */
export async function selectSourceReferencesForVersion(
  entityVersionId: string,
): Promise<SourceReference[]> {
  const rows = await prisma.sourceReference.findMany({
    where: { entityVersionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDomainSourceReference);
}

/**
 * All References pointing at a given SourceDocument — the caller already
 * knows the document (they supplied its id); each returned
 * `SourceReference` carries the `entityVersionId` it points at. Same
 * deterministic ordering as the version-scoped list above.
 */
export async function selectSourceReferencesForDocument(
  sourceDocumentId: string,
): Promise<SourceReference[]> {
  const rows = await prisma.sourceReference.findMany({
    where: { sourceDocumentId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDomainSourceReference);
}

/**
 * Deletes a SourceReference by id. Returns `true` if a row was deleted,
 * `false` if no row with that id existed.
 */
export async function deleteSourceReference(id: string): Promise<boolean> {
  try {
    await prisma.sourceReference.delete({ where: { id } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return false;
    }
    throw error;
  }
}
