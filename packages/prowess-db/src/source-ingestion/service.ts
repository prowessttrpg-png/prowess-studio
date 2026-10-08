import { createHash } from "node:crypto";
import {
  DomainError,
  SOURCE_PARSE_ERROR_CODES,
  SOURCE_SNAPSHOT_ERROR_CODES,
  type SourceSnapshot,
  type SourceSnapshotIngestion,
  type SourceStructureInput,
} from "@prowess/model";
import { getSourceDocument } from "../source-document/service.js";
import { createSourceSnapshot, findSourceSnapshotByContentHash } from "../source-snapshot/service.js";
import { ingestSourceStructure } from "../source-structure/service.js";
import { DOCX_MIME_TYPE, parseDocxStructure, type DocxDeclaredMetadata } from "./docx/parse.js";

/**
 * Structural source ingestion (PAS-10 M3-WO1) — bytes in, immutable Snapshot + structure out.
 *
 * Idempotent and safely repeatable:
 *   - same SourceDocument + same exact bytes  -> the SAME Snapshot (no duplicate Snapshot or structure)
 *   - changed bytes                            -> a NEW Snapshot; earlier Snapshots are never touched
 * Bytes are parsed BEFORE anything is written, so malformed or unsupported input writes nothing. The structure is
 * written atomically (see ingestSourceStructure). If a run is interrupted after the Snapshot row but before its
 * structure, repeating the call completes it.
 *
 * This is STRUCTURE only. It never creates an ExtractionCandidate or ImportBatch, never interprets prose, never
 * creates or changes an Entity / EntityVersion, and never touches Canon, Rulesets, conflicts, decisions,
 * ChangeSets or Releases.
 */
export interface IngestSourceSnapshotInput {
  label: string;
  originalFilename: string;
  mimeType: string;
  /** What the source says about its own version (e.g. "V0.1"). Descriptive only. */
  declaredVersion?: string | null;
  /** What the source says about its own draft state (e.g. "Playtest"). Descriptive only — never Canon status. */
  declaredDraftState?: string | null;
}

export interface IngestSourceSnapshotResult {
  snapshot: SourceSnapshot;
  ingestion: SourceSnapshotIngestion;
  /** false when a Snapshot of these exact bytes already existed for the document. */
  createdSnapshot: boolean;
  /** false when the Snapshot's structure was already ingested (identically). */
  createdStructure: boolean;
}

/** Structural parsers by mime type. Only DOCX exists in WO1. */
function parseStructure(mimeType: string, bytes: Buffer): { structure: SourceStructureInput; declared: DocxDeclaredMetadata } {
  if (mimeType === DOCX_MIME_TYPE) return parseDocxStructure(bytes);
  throw new DomainError(SOURCE_PARSE_ERROR_CODES.UNSUPPORTED_FORMAT, `No structural parser for mime type ${JSON.stringify(mimeType)}`);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function ingestSourceSnapshot(sourceDocumentId: string, bytes: Buffer, input: IngestSourceSnapshotInput): Promise<IngestSourceSnapshotResult> {
  await getSourceDocument(sourceDocumentId);
  if (!Buffer.isBuffer(bytes)) throw new DomainError(SOURCE_SNAPSHOT_ERROR_CODES.INVALID_INPUT, "source bytes must be a Buffer");
  const contentHash = sha256Hex(bytes);
  const { structure, declared } = parseStructure(input.mimeType, bytes);

  let snapshot = await findSourceSnapshotByContentHash(sourceDocumentId, contentHash);
  let createdSnapshot = false;
  if (!snapshot) {
    try {
      snapshot = await createSourceSnapshot(sourceDocumentId, {
        label: input.label,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        contentHash,
        byteSize: bytes.length,
        pageCount: declared.pageCount,
        declaredVersion: input.declaredVersion ?? null,
        declaredDraftState: input.declaredDraftState ?? null,
      });
      createdSnapshot = true;
    } catch (error) {
      // A concurrent ingestion of the same bytes won the race: use its Snapshot.
      if (!(error instanceof DomainError) || error.code !== SOURCE_SNAPSHOT_ERROR_CODES.DUPLICATE_CONTENT) throw error;
      snapshot = await findSourceSnapshotByContentHash(sourceDocumentId, contentHash);
      if (!snapshot) throw error;
    }
  }
  const { ingestion, created } = await ingestSourceStructure(snapshot.id, structure);
  return { snapshot, ingestion, createdSnapshot, createdStructure: created };
}
