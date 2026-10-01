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
