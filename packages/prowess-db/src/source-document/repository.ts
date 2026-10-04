import {
  SourceDocumentId,
  type SourceAuthorityStatus,
  type SourceDocument,
  type SourceDocumentType,
} from "@prowess/model";
import { prisma } from "../client.js";
import type { SourceDocument as PrismaSourceDocumentRow } from "../../generated/prisma/client.js";

/**
 * SourceDocument repository — the only place in this package that speaks
 * Prisma's `sourceDocument` query API directly. Internal implementation
 * detail of the source-document service (not re-exported from
 * `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 */

/**
 * Exported (unlike most of this module's internals) so
 * `../source-reference/repository.ts`'s list-for-document query can reuse
 * the exact same row mapping — same same-package-only convenience as
 * `entity/repository.ts`'s `toDomainEntity`.
 */
export function toDomainSourceDocument(row: PrismaSourceDocumentRow): SourceDocument {
  return {
    id: SourceDocumentId.of(row.id),
    title: row.title,
    sourceType: row.sourceType as SourceDocumentType,
    versionLabel: row.versionLabel,
    authorityStatus: row.authorityStatus as SourceAuthorityStatus | null,
    fileReference: row.fileReference,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

export interface InsertSourceDocumentInput {
  title: string;
  sourceType: SourceDocumentType;
  versionLabel: string | null;
  authorityStatus: SourceAuthorityStatus | null;
  fileReference: string | null;
  notes: string | null;
}

export async function insertSourceDocument(
  input: InsertSourceDocumentInput,
): Promise<SourceDocument> {
  const row = await prisma.sourceDocument.create({
    data: {
      title: input.title,
      sourceType: input.sourceType,
      versionLabel: input.versionLabel,
      authorityStatus: input.authorityStatus,
      fileReference: input.fileReference,
      notes: input.notes,
    },
  });
  return toDomainSourceDocument(row);
}

export async function selectSourceDocumentById(id: string): Promise<SourceDocument | null> {
  try {
    const row = await prisma.sourceDocument.findUnique({ where: { id } });
    return row ? toDomainSourceDocument(row) : null;
  } catch {
    return null;
  }
}

/** Ordered `title ASC, id ASC` — deterministic (PAS-10 M1-WO7 §15). */
export async function selectSourceDocuments(): Promise<SourceDocument[]> {
  const rows = await prisma.sourceDocument.findMany({
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  return rows.map(toDomainSourceDocument);
}
