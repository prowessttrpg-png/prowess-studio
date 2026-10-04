/**
 * Controlled SourceDocument type classification (PAS-10 M1-WO7 §3).
 *
 * Deliberately broad — NOT coupled to file extensions or formats. A
 * reasonable Phase 1 vocabulary only; file format parsing belongs to a
 * later M3 Work Order. `source_type` is descriptive metadata only — it
 * creates no authority or import behavior of its own.
 */
export const SOURCE_DOCUMENT_TYPES = ["DOCUMENT", "WEB", "OTHER"] as const;

export type SourceDocumentType = (typeof SOURCE_DOCUMENT_TYPES)[number];

export function isSourceDocumentType(value: string): value is SourceDocumentType {
  return (SOURCE_DOCUMENT_TYPES as readonly string[]).includes(value);
}
