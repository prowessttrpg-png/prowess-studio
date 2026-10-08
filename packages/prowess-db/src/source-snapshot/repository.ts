import {
  SourceDocumentId,
  SourceSnapshotId,
  type SourceSnapshot,
} from "@prowess/model";
import { prisma } from "../client.js";
import type { SourceSnapshot as SnapshotRow } from "../../generated/prisma/client.js";
import { isUniqueViolation } from "../prisma-errors.js";

/**
 * SourceSnapshot repository (PAS-10 M3-WO1). Internal to @prowess/db. WRITES exactly one thing — a new
 * `source_snapshots` row — and never updates or deletes one. Reads only its own table.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Constraint names fixed by migration 20261011010000_add_source_structure. */
export const SNAPSHOT_CONTENT_HASH_UNIQUE = "source_snapshots_document_content_hash_key";

export function toDomainSourceSnapshot(row: SnapshotRow): SourceSnapshot {
  return {
    id: SourceSnapshotId.of(row.id),
    sourceDocumentId: SourceDocumentId.of(row.sourceDocumentId),
    label: row.label,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    contentHash: row.contentHash,
    byteSize: row.byteSize,
    pageCount: row.pageCount,
    declaredVersion: row.declaredVersion,
    declaredDraftState: row.declaredDraftState,
    createdAt: row.createdAt,
  };
}

export interface InsertSourceSnapshotInput {
  sourceDocumentId: string;
  label: string;
  originalFilename: string;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  pageCount: number | null;
  declaredVersion: string | null;
  declaredDraftState: string | null;
}

/** Inserts a Snapshot, or returns `"DUPLICATE_CONTENT"` when the document already has one for these exact bytes. */
export async function insertSourceSnapshot(input: InsertSourceSnapshotInput): Promise<SourceSnapshot | "DUPLICATE_CONTENT"> {
  try {
    return toDomainSourceSnapshot(await prisma.sourceSnapshot.create({ data: input }));
  } catch (error) {
    if (isUniqueViolation(error, { constraint: SNAPSHOT_CONTENT_HASH_UNIQUE, fields: ["source_document_id", "content_hash"] })) {
      return "DUPLICATE_CONTENT";
    }
    throw error;
  }
}

export async function selectSourceSnapshotById(id: string): Promise<SourceSnapshot | null> {
  if (!isUuid(id)) return null;
  const row = await prisma.sourceSnapshot.findUnique({ where: { id } });
  return row ? toDomainSourceSnapshot(row) : null;
}

export async function selectSourceSnapshotByContent(sourceDocumentId: string, contentHash: string): Promise<SourceSnapshot | null> {
  const row = await prisma.sourceSnapshot.findUnique({
    where: { sourceDocumentId_contentHash: { sourceDocumentId, contentHash } },
  });
  return row ? toDomainSourceSnapshot(row) : null;
}

/** A document's Snapshots in creation order (`createdAt ASC, id ASC`) — history order, never a "latest" pick. */
export async function selectSourceSnapshotsForDocument(sourceDocumentId: string): Promise<SourceSnapshot[]> {
  const rows = await prisma.sourceSnapshot.findMany({
    where: { sourceDocumentId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDomainSourceSnapshot);
}
