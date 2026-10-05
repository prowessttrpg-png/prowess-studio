import {
  DomainError,
  ENTITY_ALIAS_ERROR_CODES,
  ENTITY_ERROR_CODES,
  ENTITY_VERSION_ERROR_CODES,
  KEYWORD_ASSIGNMENT_ERROR_CODES,
  KEYWORD_CATEGORY_ERROR_CODES,
  KEYWORD_ERROR_CODES,
  RELATIONSHIP_ERROR_CODES,
  RULESET_ERROR_CODES,
  RULESET_MANIFEST_ERROR_CODES,
  CANON_POLICY_ERROR_CODES,
  SOURCE_AUTHORITY_ERROR_CODES,
  SOURCE_DOCUMENT_ERROR_CODES,
  SOURCE_REFERENCE_ERROR_CODES,
  type EntityAliasErrorCode,
  type EntityErrorCode,
  type EntityVersionErrorCode,
  type KeywordAssignmentErrorCode,
  type KeywordCategoryErrorCode,
  type KeywordErrorCode,
  type RelationshipErrorCode,
  type RulesetErrorCode,
  type RulesetManifestErrorCode,
  type CanonPolicyErrorCode,
  type SourceAuthorityErrorCode,
  type SourceDocumentErrorCode,
  type SourceReferenceErrorCode,
} from "@prowess/model";
import { NextResponse } from "next/server";

/**
 * API-level validation error (PAS-10 M1-WO8 §24–25) — distinct from
 * `DomainError` (which comes from `@prowess/model` and represents a
 * business-rule violation below the HTTP layer). An `ApiError` represents
 * malformed HTTP input itself: a malformed UUID route param, an
 * unparseable query parameter, a request body that isn't valid JSON. Both
 * error types are handled by the same central `toErrorResponse` below, so
 * every route's catch block looks identical regardless of which kind of
 * error it's translating.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | null;

  constructor(code: string, message: string, status: number, field: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

/**
 * The code returned for any server-side failure that isn't a recognized,
 * mapped `DomainError` or an `ApiError` — a genuinely unexpected bug, OR
 * (M1-WO8 patch) a `DomainError` whose code has no entry in
 * `DOMAIN_ERROR_STATUS_MAP` below. The latter is an application contract/
 * configuration omission (a new error code shipped without a deliberately
 * chosen HTTP status), not client input, and must never be misclassified
 * as a 400 — it fails closed to 500 instead, same as any other
 * unanticipated failure. This is the one internal-server-error code this
 * project uses, established in M1-WO8 and intentionally unchanged by this
 * patch (not renamed to match an external example) for consistency with
 * what's already shipped and approved.
 */
const INTERNAL_ERROR_CODE = "INTERNAL.UNEXPECTED_ERROR";
const INTERNAL_ERROR_MESSAGE = "An unexpected server error occurred.";

/**
 * Every currently-controlled `DomainError` code, as a union of the exact
 * string-literal types `@prowess/model`'s own `*_ERROR_CODES` objects
 * produce — not a hand-maintained list of string literals that could
 * silently drift from the real vocabulary.
 */
type KnownDomainErrorCode =
  | EntityErrorCode
  | EntityVersionErrorCode
  | EntityAliasErrorCode
  | KeywordCategoryErrorCode
  | KeywordErrorCode
  | KeywordAssignmentErrorCode
  | RelationshipErrorCode
  | RulesetErrorCode
  | RulesetManifestErrorCode
  | CanonPolicyErrorCode
  | SourceAuthorityErrorCode
  | SourceDocumentErrorCode
  | SourceReferenceErrorCode;

/**
 * Centralized `DomainError.code` -> HTTP status mapping (PAS-10 M1-WO8
 * §5, hardened by a later patch). The ONE place this decision is made —
 * route handlers never choose a status code themselves.
 *
 * **Exhaustive at compile time** via `satisfies Record<KnownDomainErrorCode,
 * number>`: every key is a computed property off the real `*_ERROR_CODES`
 * constants (so a typo or stale literal can't silently compile), and
 * `satisfies` requires every member of `KnownDomainErrorCode` to be
 * present. Adding a new code to any `*_ERROR_CODES` object in
 * `@prowess/model` without adding a matching entry here is a compile
 * error — "deliberately choose a status for every new error code" is
 * enforced by the type checker, not left to reviewer memory. See
 * `tests/unit/api-helpers.test.ts` for a runtime-level version of the same
 * guarantee (iterates every known code and asserts it has a *numeric*,
 * explicit mapping) plus a companion test for the reverse case.
 *
 * Reasoning for a few less-obvious choices, documented explicitly per the
 * Work Order's instruction:
 *   - `ENTITY_VERSION.INVALID_STATUS_TRANSITION` -> 409, not 400: this
 *     also covers a transition that was valid when checked but lost a
 *     race against a concurrent status change (PAS-10 M1-WO3 §13) — a
 *     conflict with the resource's current state, the same category as
 *     `ENTITY_VERSION.REVISION_CONFLICT`, not a malformed-request
 *     category.
 *   - `ENTITY_VERSION.IMMUTABLE` -> 409: "conflicting lifecycle
 *     operation" per the Work Order's own example list.
 *   - `RELATIONSHIP.INVALID_SOURCE` / `INVALID_TARGET` -> 400, not 404:
 *     unlike a resource looked up directly by its own URL segment (which
 *     gets 404 when absent), these identify a referenced id *within a
 *     request body* that turned out to be invalid — the same category as
 *     any other malformed request input, which is why the Work Order's
 *     own regression-test list names 400 for this one specifically
 *     (contrast with `ENTITY.NOT_FOUND`, which DOES map to 404, because
 *     that's the primary resource the URL itself names).
 */
const DOMAIN_ERROR_STATUS_MAP = {
  // --- 404: explicit resource not found (named by the request's own URL) ---
  [ENTITY_ERROR_CODES.NOT_FOUND]: 404,
  [ENTITY_VERSION_ERROR_CODES.NOT_FOUND]: 404,
  [ENTITY_ALIAS_ERROR_CODES.NOT_FOUND]: 404,
  [KEYWORD_CATEGORY_ERROR_CODES.NOT_FOUND]: 404,
  [KEYWORD_ERROR_CODES.NOT_FOUND]: 404,
  [RELATIONSHIP_ERROR_CODES.NOT_FOUND]: 404,
  [SOURCE_DOCUMENT_ERROR_CODES.NOT_FOUND]: 404,
  [SOURCE_REFERENCE_ERROR_CODES.NOT_FOUND]: 404,
  [RULESET_ERROR_CODES.NOT_FOUND]: 404,
  [RULESET_MANIFEST_ERROR_CODES.NOT_FOUND]: 404,
  // The Ruleset is the resource a manifest request is addressed to, so a missing one is a 404.
  [RULESET_MANIFEST_ERROR_CODES.RULESET_NOT_FOUND]: 404,
  [CANON_POLICY_ERROR_CODES.NOT_FOUND]: 404,
  // The Ruleset is the resource a policy request is addressed to, so a missing one is a 404.
  [CANON_POLICY_ERROR_CODES.RULESET_NOT_FOUND]: 404,

  // --- 409: conflict with current state / duplicate ---
  [ENTITY_ERROR_CODES.CANONICAL_KEY_CONFLICT]: 409,
  [ENTITY_VERSION_ERROR_CODES.REVISION_CONFLICT]: 409,
  [ENTITY_VERSION_ERROR_CODES.INVALID_STATUS_TRANSITION]: 409,
  [ENTITY_VERSION_ERROR_CODES.IMMUTABLE]: 409,
  [ENTITY_ALIAS_ERROR_CODES.DUPLICATE]: 409,
  [KEYWORD_CATEGORY_ERROR_CODES.CANONICAL_KEY_CONFLICT]: 409,
  [KEYWORD_ERROR_CODES.CANONICAL_KEY_CONFLICT]: 409,
  [KEYWORD_ASSIGNMENT_ERROR_CODES.DUPLICATE]: 409,
  [RELATIONSHIP_ERROR_CODES.DUPLICATE]: 409,
  [RULESET_ERROR_CODES.CANONICAL_KEY_CONFLICT]: 409,
  // A cycle depends on the lineage that already exists (state), not on the shape of the
  // request — the same reasoning as INVALID_STATUS_TRANSITION -> 409.
  [RULESET_ERROR_CODES.PARENT_CYCLE]: 409,
  // Version allocation lost a race repeatedly; nothing is wrong with the request and it is safe to retry.
  [RULESET_MANIFEST_ERROR_CODES.VERSION_CONFLICT]: 409,
  // policy_version allocation lost a race repeatedly; nothing is wrong with the request and it is safe to retry.
  [CANON_POLICY_ERROR_CODES.VERSION_CONFLICT]: 409,

  // --- 400: invalid input / invalid reference within a request body ---
  [ENTITY_ERROR_CODES.INVALID_TYPE]: 400,
  [ENTITY_ERROR_CODES.INVALID_CANONICAL_KEY]: 400,
  [ENTITY_VERSION_ERROR_CODES.INVALID_INPUT]: 400,
  [ENTITY_VERSION_ERROR_CODES.INVALID_PARENT]: 400,
  [ENTITY_ALIAS_ERROR_CODES.INVALID_INPUT]: 400,
  [KEYWORD_CATEGORY_ERROR_CODES.INVALID_INPUT]: 400,
  [KEYWORD_ERROR_CODES.INVALID_INPUT]: 400,
  [KEYWORD_ASSIGNMENT_ERROR_CODES.INVALID_SOURCE]: 400,
  [RELATIONSHIP_ERROR_CODES.INVALID_SOURCE]: 400,
  [RELATIONSHIP_ERROR_CODES.INVALID_TARGET]: 400,
  [RELATIONSHIP_ERROR_CODES.INVALID_TYPE]: 400,
  [RELATIONSHIP_ERROR_CODES.SELF_REFERENCE]: 400,
  [SOURCE_DOCUMENT_ERROR_CODES.INVALID_INPUT]: 400,
  [SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT]: 400,
  [RULESET_ERROR_CODES.INVALID_INPUT]: 400,
  // A bad reference inside a request body — the same reasoning as RELATIONSHIP.INVALID_SOURCE -> 400.
  [RULESET_ERROR_CODES.INVALID_PARENT]: 400,
  [RULESET_MANIFEST_ERROR_CODES.INVALID_INPUT]: 400,
  // Entities and Versions are referenced INSIDE the request body, so a missing one — or a Version that
  // belongs to a different Entity, or the same Entity twice — is a bad request, not a missing URL
  // resource (the same reasoning as RELATIONSHIP.INVALID_SOURCE -> 400).
  [RULESET_MANIFEST_ERROR_CODES.ENTITY_NOT_FOUND]: 400,
  [RULESET_MANIFEST_ERROR_CODES.VERSION_NOT_FOUND]: 400,
  [RULESET_MANIFEST_ERROR_CODES.VERSION_ENTITY_MISMATCH]: 400,
  [RULESET_MANIFEST_ERROR_CODES.DUPLICATE_ENTITY]: 400,
  // The parent manifest is named INSIDE the request body, so an unusable one (missing, wrong Ruleset,
  // or a Ruleset with no parent) is a bad request — the same reasoning as ENTITY_NOT_FOUND above.
  [RULESET_MANIFEST_ERROR_CODES.INVALID_PARENT_MANIFEST]: 400,
  [CANON_POLICY_ERROR_CODES.INVALID_INPUT]: 400,
  // SourceDocuments and scope keys are named INSIDE the request body, so a missing document, a malformed
  // scope, or the same document + scope twice is a bad request, not a missing URL resource (the same
  // reasoning as RULESET_MANIFEST.ENTITY_NOT_FOUND -> 400).
  [SOURCE_AUTHORITY_ERROR_CODES.SOURCE_NOT_FOUND]: 400,
  [SOURCE_AUTHORITY_ERROR_CODES.INVALID_SCOPE]: 400,
  [SOURCE_AUTHORITY_ERROR_CODES.DUPLICATE_SOURCE_SCOPE]: 400,
  // Corrupt stored data, not anything the caller did: supported operations cannot create an inheritance
  // loop. An integrity failure on the server is a 500 by design, mapped explicitly so it is a decision
  // and not merely the fail-closed default for an unmapped code.
  [RULESET_MANIFEST_ERROR_CODES.INHERITANCE_CYCLE]: 500,
} satisfies Record<KnownDomainErrorCode, number>;

/**
 * Looks up the documented status for a `DomainError.code`. Returns
 * `undefined` — NOT a default of 400 — when `code` has no explicit entry,
 * so the caller (`toErrorResponse`) can fail closed to 500 rather than
 * misclassifying an unmapped server-side contract gap as bad client input.
 */
export function statusForDomainErrorCode(code: string): number | undefined {
  return (DOMAIN_ERROR_STATUS_MAP as Record<string, number | undefined>)[code];
}

interface ApiErrorBody {
  code: string;
  message: string;
  field: string | null;
  details: unknown;
}

function errorBody(code: string, message: string, field: string | null = null): ApiErrorBody {
  return { code, message, field, details: null };
}

function internalErrorResponse(): NextResponse {
  return NextResponse.json(errorBody(INTERNAL_ERROR_CODE, INTERNAL_ERROR_MESSAGE), {
    status: 500,
  });
}

/**
 * The one place every route's catch block sends its caught error — never
 * duplicated per route. Translates `DomainError` and `ApiError` into the
 * stable `{ code, message, field, details }` response shape at the
 * correct documented status.
 *
 * Two distinct failure-closed-to-500 paths, both logged server-side only:
 *   - a `DomainError` whose `code` has no entry in `DOMAIN_ERROR_STATUS_MAP`
 *     (should be unreachable given the compile-time exhaustiveness check
 *     above, but defended at runtime too — e.g. if a future refactor ever
 *     bypasses the `satisfies` guarantee);
 *   - anything that isn't a `DomainError` or `ApiError` at all (a genuine,
 *     unexpected bug — a raw Prisma error, a thrown string, a null
 *     dereference, ...).
 * Neither path ever includes the original code, message, Prisma shape,
 * stack trace, or internal path in the response body — only the generic
 * `INTERNAL.UNEXPECTED_ERROR` / "An unexpected server error occurred."
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    const status = statusForDomainErrorCode(error.code);
    if (status === undefined) {
      console.error(
        `DomainError code "${error.code}" has no HTTP status mapping — ` +
          "failing closed to 500 rather than misclassifying it as a 400. " +
          "Add this code to DOMAIN_ERROR_STATUS_MAP in apps/studio/src/api/errors.ts.",
        error,
      );
      return internalErrorResponse();
    }
    return NextResponse.json(errorBody(error.code, error.message), { status });
  }

  if (error instanceof ApiError) {
    return NextResponse.json(errorBody(error.code, error.message, error.field), {
      status: error.status,
    });
  }

  // Intentional server-side-only log; nothing from this reaches the response body.
  console.error("Unhandled API error:", error);
  return internalErrorResponse();
}
