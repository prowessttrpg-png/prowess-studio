/**
 * Shared domain error vocabulary (PAS-10 M1-WO1 §10–12).
 *
 * `DomainError` is a plain, framework-independent error carrying a stable
 * machine-readable `code` (e.g. `"ENTITY.NOT_FOUND"`). It exists so that a
 * controlled, documented error vocabulary can be thrown from
 * `@prowess/db`'s service layer and recognized by any future caller
 * (an HTTP API, a CLI, a test) without either side depending on Prisma or
 * any other persistence detail — an opaque Prisma error (e.g. a raw
 * `P2002` unique-constraint violation) must never leak past the service
 * boundary; it gets mapped to one of these instead.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
  }
}

/**
 * Entity-specific error codes. Namespaced (`ENTITY.*`) so future domains
 * (EntityVersion, Keyword, ...) can introduce their own codes under their
 * own namespace without colliding with these.
 */
export const ENTITY_ERROR_CODES = {
  /** Lookup by explicit identity (e.g. `getEntityById`) found nothing. */
  NOT_FOUND: "ENTITY.NOT_FOUND",
  /** `canonicalKey` is already registered to a different Entity. */
  CANONICAL_KEY_CONFLICT: "ENTITY.CANONICAL_KEY_CONFLICT",
  /** The supplied `entityType` is not a recognized `EntityType`. */
  INVALID_TYPE: "ENTITY.INVALID_TYPE",
  /** The supplied `canonicalKey` fails canonical-key validation. */
  INVALID_CANONICAL_KEY: "ENTITY.INVALID_CANONICAL_KEY",
} as const;

export type EntityErrorCode = (typeof ENTITY_ERROR_CODES)[keyof typeof ENTITY_ERROR_CODES];

/**
 * EntityVersion-specific error codes (PAS-10 M1-WO2 §16–19).
 *
 * Deliberate choice, documented per M1-WO2's instruction to pick one
 * approach consistently: **missing-parent-Entity reuses
 * `ENTITY_ERROR_CODES.NOT_FOUND` rather than minting a parallel
 * `ENTITY_VERSION.ENTITY_NOT_FOUND` code.** Attempting to create a Version
 * for an Entity that doesn't exist is exactly the same condition
 * `ENTITY.NOT_FOUND` already names — an Entity lookup by id found nothing
 * — so reusing it avoids two codes for one condition. A genuinely
 * EntityVersion-specific "not found" (looking up a Version, not an Entity)
 * gets its own code below.
 */
export const ENTITY_VERSION_ERROR_CODES = {
  /** Explicit lookup of an EntityVersion by id found nothing. */
  NOT_FOUND: "ENTITY_VERSION.NOT_FOUND",
  /** The (entityId, revisionNumber) pair is already in use. */
  REVISION_CONFLICT: "ENTITY_VERSION.REVISION_CONFLICT",
  /**
   * `parentVersionId` doesn't exist, belongs to a different Entity, or
   * (defensively) would make a Version its own parent.
   */
  INVALID_PARENT: "ENTITY_VERSION.INVALID_PARENT",
  /**
   * Basic input validation failed — e.g. an empty/missing `displayName`,
   * or an explicitly-supplied `status`/`changeType` that isn't one of the
   * controlled values. Not explicitly named in PAS-10 M1-WO2's error-code
   * list (which only named NOT_FOUND/REVISION_CONFLICT/INVALID_PARENT) —
   * added here for consistency with Entity's own INVALID_TYPE/
   * INVALID_CANONICAL_KEY pattern (validate at the service boundary,
   * before anything reaches Prisma) rather than leaving basic input
   * validation unclassified or throwing a plain, uncoded error.
   */
  INVALID_INPUT: "ENTITY_VERSION.INVALID_INPUT",
  /**
   * An attempted content mutation targets a Version whose current status
   * does not permit it. Phase 1 policy: only `DRAFT` content is mutable
   * (PAS-10 M1-WO3 §1) — every other status throws this.
   */
  IMMUTABLE: "ENTITY_VERSION.IMMUTABLE",
  /**
   * The requested status transition isn't represented in the lifecycle
   * graph (`@prowess/model`'s `ENTITY_VERSION_TRANSITIONS`) — either
   * because it was never a valid transition from the status the caller
   * checked against, OR because the status changed concurrently between
   * that check and the atomic conditional update actually committing
   * (PAS-10 M1-WO3 §13). Deliberately reused for both cases rather than
   * minting a parallel "transition conflict" code — from the caller's
   * perspective both mean the same thing: the transition they asked for
   * is not valid for the Version's actual current status.
   */
  INVALID_STATUS_TRANSITION: "ENTITY_VERSION.INVALID_STATUS_TRANSITION",
} as const;

export type EntityVersionErrorCode =
  (typeof ENTITY_VERSION_ERROR_CODES)[keyof typeof ENTITY_VERSION_ERROR_CODES];

/**
 * EntityAlias-specific error codes (PAS-10 M1-WO4 §14–16).
 *
 * **Missing parent Entity reuses `ENTITY_ERROR_CODES.NOT_FOUND`**, not a
 * parallel `ENTITY_ALIAS.ENTITY_NOT_FOUND` — the same reasoning as
 * `EntityVersion`'s reuse above: attempting to create an alias for an
 * Entity that doesn't exist is exactly the Entity-lookup-found-nothing
 * condition `ENTITY.NOT_FOUND` already names.
 */
export const ENTITY_ALIAS_ERROR_CODES = {
  /** Explicit lookup/deletion of an EntityAlias by id found nothing. */
  NOT_FOUND: "ENTITY_ALIAS.NOT_FOUND",
  /** The same (entityId, normalizedAlias, normalizedContext) already exists. */
  DUPLICATE: "ENTITY_ALIAS.DUPLICATE",
  /**
   * Basic input validation failed — e.g. an alias that's empty/
   * whitespace-only after normalization, or longer than
   * `MAX_ENTITY_ALIAS_LENGTH`. Not explicitly named in PAS-10 M1-WO4's
   * error-code list (which only named NOT_FOUND/DUPLICATE) — added for
   * consistency with Entity's and EntityVersion's own INVALID_* pattern
   * (validate at the service boundary, before anything reaches Prisma)
   * rather than leaving basic input validation uncoded.
   */
  INVALID_INPUT: "ENTITY_ALIAS.INVALID_INPUT",
} as const;

export type EntityAliasErrorCode =
  (typeof ENTITY_ALIAS_ERROR_CODES)[keyof typeof ENTITY_ALIAS_ERROR_CODES];

/** KeywordCategory-specific error codes (PAS-10 M1-WO5 §13). */
export const KEYWORD_CATEGORY_ERROR_CODES = {
  NOT_FOUND: "KEYWORD_CATEGORY.NOT_FOUND",
  CANONICAL_KEY_CONFLICT: "KEYWORD_CATEGORY.CANONICAL_KEY_CONFLICT",
  INVALID_INPUT: "KEYWORD_CATEGORY.INVALID_INPUT",
} as const;

export type KeywordCategoryErrorCode =
  (typeof KEYWORD_CATEGORY_ERROR_CODES)[keyof typeof KEYWORD_CATEGORY_ERROR_CODES];

/** KeywordDefinition-specific error codes (PAS-10 M1-WO5 §13). */
export const KEYWORD_ERROR_CODES = {
  NOT_FOUND: "KEYWORD.NOT_FOUND",
  CANONICAL_KEY_CONFLICT: "KEYWORD.CANONICAL_KEY_CONFLICT",
  INVALID_INPUT: "KEYWORD.INVALID_INPUT",
} as const;

export type KeywordErrorCode = (typeof KEYWORD_ERROR_CODES)[keyof typeof KEYWORD_ERROR_CODES];

/**
 * Keyword-assignment-specific error codes (PAS-10 M1-WO5 §13).
 *
 * Missing-target errors are deliberately NOT duplicated here: a missing
 * Entity reuses `ENTITY_ERROR_CODES.NOT_FOUND` and a missing EntityVersion
 * reuses `ENTITY_VERSION_ERROR_CODES.NOT_FOUND` (both already established
 * conventions from M1-WO1/M1-WO2), and a missing KeywordDefinition reuses
 * `KEYWORD_ERROR_CODES.NOT_FOUND` above — each is exactly the condition
 * that code already names. The version-protected case also reuses
 * `ENTITY_VERSION_ERROR_CODES.IMMUTABLE` (M1-WO3) rather than a parallel
 * code, per PAS-10 M1-WO5 §19/§30's explicit instruction to use "the same
 * lifecycle semantics established in M1-WO3."
 */
export const KEYWORD_ASSIGNMENT_ERROR_CODES = {
  /** The same Keyword is already assigned at this target/level. */
  DUPLICATE: "KEYWORD_ASSIGNMENT.DUPLICATE",
  /** The supplied source type isn't a recognized `KeywordAssignmentSource`. */
  INVALID_SOURCE: "KEYWORD_ASSIGNMENT.INVALID_SOURCE",
} as const;

export type KeywordAssignmentErrorCode =
  (typeof KEYWORD_ASSIGNMENT_ERROR_CODES)[keyof typeof KEYWORD_ASSIGNMENT_ERROR_CODES];

/**
 * EntityRelationship-specific error codes (PAS-10 M1-WO6 §14–19).
 *
 * Missing-source and missing-target are deliberately two distinct codes,
 * not collapsed into one generic "not found" — a caller should know which
 * side of the relationship is invalid without having to inspect the
 * relationship's own fields to figure it out.
 */
export const RELATIONSHIP_ERROR_CODES = {
  /** Explicit lookup/removal of an EntityRelationship by id found nothing. */
  NOT_FOUND: "RELATIONSHIP.NOT_FOUND",
  /** The source Entity doesn't exist. */
  INVALID_SOURCE: "RELATIONSHIP.INVALID_SOURCE",
  /** The target Entity doesn't exist. */
  INVALID_TARGET: "RELATIONSHIP.INVALID_TARGET",
  /** The exact (source, target, relationshipType) triple already exists. */
  DUPLICATE: "RELATIONSHIP.DUPLICATE",
  /** The supplied relationshipType isn't a recognized `RelationshipType`. */
  INVALID_TYPE: "RELATIONSHIP.INVALID_TYPE",
  /** `sourceEntityId === targetEntityId` — rejected, not persisted. */
  SELF_REFERENCE: "RELATIONSHIP.SELF_REFERENCE",
} as const;

export type RelationshipErrorCode =
  (typeof RELATIONSHIP_ERROR_CODES)[keyof typeof RELATIONSHIP_ERROR_CODES];

/** SourceDocument-specific error codes (PAS-10 M1-WO7 §20). */
export const SOURCE_DOCUMENT_ERROR_CODES = {
  NOT_FOUND: "SOURCE_DOCUMENT.NOT_FOUND",
  INVALID_INPUT: "SOURCE_DOCUMENT.INVALID_INPUT",
} as const;

export type SourceDocumentErrorCode =
  (typeof SOURCE_DOCUMENT_ERROR_CODES)[keyof typeof SOURCE_DOCUMENT_ERROR_CODES];

/**
 * SourceReference-specific error codes (PAS-10 M1-WO7 §21).
 *
 * A missing parent EntityVersion deliberately reuses
 * `ENTITY_VERSION_ERROR_CODES.NOT_FOUND` rather than a redundant
 * `SOURCE_REFERENCE.INVALID_VERSION` — the same already-established reuse
 * pattern from M1-WO2 onward. A missing parent SourceDocument uses
 * `SOURCE_DOCUMENT_ERROR_CODES.NOT_FOUND` for the same reason.
 */
export const SOURCE_REFERENCE_ERROR_CODES = {
  NOT_FOUND: "SOURCE_REFERENCE.NOT_FOUND",
  INVALID_INPUT: "SOURCE_REFERENCE.INVALID_INPUT",
} as const;

export type SourceReferenceErrorCode =
  (typeof SOURCE_REFERENCE_ERROR_CODES)[keyof typeof SOURCE_REFERENCE_ERROR_CODES];
