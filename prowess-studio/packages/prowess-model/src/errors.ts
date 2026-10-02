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
