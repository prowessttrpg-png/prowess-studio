import {
  DomainError,
  SOURCE_SNAPSHOT_ERROR_CODES,
  validateCreateSourceSnapshotInput,
  type CreateSourceSnapshotInput,
  type SourceSnapshot,
} from "@prowess/model";
import { getSourceDocument } from "../source-document/service.js";
import {
  insertSourceSnapshot,
  selectSourceSnapshotByContent,
  selectSourceSnapshotById,
  selectSourceSnapshotsForDocument,
} from "./repository.js";

/**
 * SourceSnapshot service (PAS-10 M3-WO1) — the public boundary for exact source revisions.
 *
 * A SourceDocument is the stable conceptual identity; a Snapshot is one exact revision of its bytes, identified by
 * (sourceDocumentId, contentHash). Snapshots are never updated or deleted: changed bytes are always a NEW Snapshot,
 * so an older revision reads back identically forever. Declared version / draft state are what the source says
 * about itself — descriptive only; nothing here reads them, the filename, or the document's `authorityStatus` to
 * infer authority or Canon.
 */

/**
 * Creates a Snapshot for `sourceDocumentId`.
 *
 *   - the SourceDocument must exist                                  -> SOURCE_DOCUMENT.NOT_FOUND
 *   - metadata must be well-formed                                    -> SOURCE_SNAPSHOT.INVALID_INPUT
 *   - the document must not already have a Snapshot of these bytes    -> SOURCE_SNAPSHOT.DUPLICATE_CONTENT
 *     (race-safe: decided by the database's unique (document, hash) key, not by a prior read)
 *
 * For the idempotent "same bytes → same Snapshot" behaviour use `ingestDocxSourceSnapshot`, which returns the
 * existing Snapshot instead of failing.
 */
export async function createSourceSnapshot(sourceDocumentId: string, input: CreateSourceSnapshotInput): Promise<SourceSnapshot> {
  await getSourceDocument(sourceDocumentId);
  validateCreateSourceSnapshotInput(input);
  const created = await insertSourceSnapshot({
    sourceDocumentId,
    label: input.label,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    contentHash: input.contentHash,
    byteSize: input.byteSize,
    pageCount: input.pageCount ?? null,
    declaredVersion: input.declaredVersion ?? null,
    declaredDraftState: input.declaredDraftState ?? null,
  });
  if (created === "DUPLICATE_CONTENT") {
    throw new DomainError(
      SOURCE_SNAPSHOT_ERROR_CODES.DUPLICATE_CONTENT,
      `SourceDocument ${sourceDocumentId} already has a Snapshot with contentHash ${input.contentHash}`,
    );
  }
  return created;
}

/** Retrieves a Snapshot by id. A malformed id is NOT_FOUND. */
export async function getSourceSnapshot(id: string): Promise<SourceSnapshot> {
  const snapshot = await selectSourceSnapshotById(id);
  if (!snapshot) throw new DomainError(SOURCE_SNAPSHOT_ERROR_CODES.NOT_FOUND, `SourceSnapshot not found: ${id}`);
  return snapshot;
}

/** The Snapshot of `sourceDocumentId` with exactly these bytes, or null. */
export async function findSourceSnapshotByContentHash(sourceDocumentId: string, contentHash: string): Promise<SourceSnapshot | null> {
  await getSourceDocument(sourceDocumentId);
  return selectSourceSnapshotByContent(sourceDocumentId, contentHash);
}

/** Every Snapshot of a document, in creation (history) order. The document must exist. */
export async function listSourceSnapshots(sourceDocumentId: string): Promise<SourceSnapshot[]> {
  await getSourceDocument(sourceDocumentId);
  return selectSourceSnapshotsForDocument(sourceDocumentId);
}
