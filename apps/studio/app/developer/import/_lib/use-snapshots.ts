"use client";

import { listSourceDocuments, listSourceSnapshots, type SourceDocumentDto, type SourceSnapshotDto } from "../../../../src/api-client";

export interface RegisteredSnapshot {
  document: SourceDocumentDto;
  snapshot: SourceSnapshotDto;
}

/**
 * Registered Source Snapshots, grouped by Source Document, in API order. Phase 1: the WO7 snapshot list is per
 * document, so this reads the document list and then each document's snapshots (no new aggregate endpoint).
 */
export async function loadRegisteredSnapshots(): Promise<RegisteredSnapshot[]> {
  const documents = await listSourceDocuments();
  const perDocument = await Promise.all(documents.map(async (document) => (await listSourceSnapshots(document.id, { pageSize: 100 })).items.map((snapshot) => ({ document, snapshot }))));
  return perDocument.flat();
}
