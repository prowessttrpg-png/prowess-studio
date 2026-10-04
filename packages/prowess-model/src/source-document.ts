import type { SourceDocumentId } from "./ids.js";
import type { SourceAuthorityStatus } from "./source-authority-status.js";
import type { SourceDocumentType } from "./source-document-type.js";

/**
 * SourceDocument — a provenance record for where Prowess content
 * originated (PAS-10 M1-WO7 §2).
 *
 * ```
 * SourceDocument
 *       |
 *       v
 * SourceReference
 *       |
 *       v
 * EntityVersion
 * ```
 *
 * A foundation for answering "where did this particular representation of
 * the Prowess rule/content come from?" — nothing more. M1-WO7 does NOT
 * implement source parsing, automatic import, field-level provenance,
 * SourceSection/SourceBlock, Canon authority resolution, book publishing,
 * or document uploads. Those all come later.
 *
 * `title` is human-facing display metadata — never relational identity.
 * There is no canonical-key system for Sources in this Work Order.
 */
export interface SourceDocument {
  id: SourceDocumentId;
  title: string;
  sourceType: SourceDocumentType;
  versionLabel: string | null;
  /**
   * Descriptive provenance metadata ONLY — see
   * `./source-authority-status.js`'s doc comment. Does not determine
   * Canon, choose a current rule, override a Ruleset, or automatically
   * supersede another document. `null` if not supplied; `UNRESOLVED` is
   * the recommended default when a caller wants a non-null value without
   * yet knowing the real answer.
   */
  authorityStatus: SourceAuthorityStatus | null;
  /**
   * An opaque external locator — a Project file identifier, a document
   * URI, a connector/document identifier, an application storage key.
   * NOT assumed to be a local filesystem path, a permanent URL, or an
   * uploaded binary; no particular storage provider is assumed, and
   * nothing in this Work Order opens, reads, or parses whatever it
   * references.
   */
  fileReference: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface CreateSourceDocumentInput {
  title: string;
  sourceType: string;
  versionLabel?: string | null;
  authorityStatus?: string | null;
  fileReference?: string | null;
  notes?: string | null;
}

/** Documented limit for `SourceDocument.title`. */
export const MAX_SOURCE_DOCUMENT_TITLE_LENGTH = 300;

/**
 * Whether `value` is a valid `SourceDocument.title`: non-empty once
 * trimmed, within the documented length limit. Deliberately NOT
 * CanonicalKey syntax — a title is free-form human-facing text, not a
 * machine identifier.
 */
export function isValidSourceDocumentTitle(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length > MAX_SOURCE_DOCUMENT_TITLE_LENGTH) {
    return false;
  }
  return value.trim().length > 0;
}
