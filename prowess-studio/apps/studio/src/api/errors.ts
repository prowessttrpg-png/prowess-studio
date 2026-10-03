import { DomainError } from "@prowess/model";
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
 * Centralized `DomainError.code` -> HTTP status mapping (PAS-10 M1-WO8
 * §5). The ONE place this decision is made — route handlers never choose
 * a status code themselves.
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
const DOMAIN_ERROR_STATUS_MAP: Record<string, number> = {
  // --- 404: explicit resource not found (named by the request's own URL) ---
  "ENTITY.NOT_FOUND": 404,
  "ENTITY_VERSION.NOT_FOUND": 404,
  "ENTITY_ALIAS.NOT_FOUND": 404,
  "KEYWORD_CATEGORY.NOT_FOUND": 404,
  "KEYWORD.NOT_FOUND": 404,
  "RELATIONSHIP.NOT_FOUND": 404,
  "SOURCE_DOCUMENT.NOT_FOUND": 404,
  "SOURCE_REFERENCE.NOT_FOUND": 404,

  // --- 409: conflict with current state / duplicate ---
  "ENTITY.CANONICAL_KEY_CONFLICT": 409,
  "ENTITY_VERSION.REVISION_CONFLICT": 409,
  "ENTITY_VERSION.INVALID_STATUS_TRANSITION": 409,
  "ENTITY_VERSION.IMMUTABLE": 409,
  "ENTITY_ALIAS.DUPLICATE": 409,
  "KEYWORD_CATEGORY.CANONICAL_KEY_CONFLICT": 409,
  "KEYWORD.CANONICAL_KEY_CONFLICT": 409,
  "KEYWORD_ASSIGNMENT.DUPLICATE": 409,
  "RELATIONSHIP.DUPLICATE": 409,

  // --- 400: invalid input / invalid transition request / invalid reference in body ---
  "ENTITY.INVALID_TYPE": 400,
  "ENTITY.INVALID_CANONICAL_KEY": 400,
  "ENTITY_VERSION.INVALID_INPUT": 400,
  "ENTITY_VERSION.INVALID_PARENT": 400,
  "ENTITY_ALIAS.INVALID_INPUT": 400,
  "KEYWORD_CATEGORY.INVALID_INPUT": 400,
  "KEYWORD.INVALID_INPUT": 400,
  "KEYWORD_ASSIGNMENT.INVALID_SOURCE": 400,
  "RELATIONSHIP.INVALID_SOURCE": 400,
  "RELATIONSHIP.INVALID_TARGET": 400,
  "RELATIONSHIP.INVALID_TYPE": 400,
  "RELATIONSHIP.SELF_REFERENCE": 400,
  "SOURCE_DOCUMENT.INVALID_INPUT": 400,
  "SOURCE_REFERENCE.INVALID_INPUT": 400,
};

/** Looks up the documented status for a `DomainError.code`; 400 for any unmapped code. */
export function statusForDomainErrorCode(code: string): number {
  return DOMAIN_ERROR_STATUS_MAP[code] ?? 400;
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

/**
 * The one place every route's catch block sends its caught error — never
 * duplicated per route. Translates `DomainError` and `ApiError` into the
 * stable `{ code, message, field, details }` response shape at the
 * correct documented status; anything else (a genuine, unexpected bug) is
 * logged server-side and returned as an opaque 500 — no Prisma error
 * shape, no stack trace, no internal path ever reaches the response body.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    const status = statusForDomainErrorCode(error.code);
    return NextResponse.json(errorBody(error.code, error.message), { status });
  }

  if (error instanceof ApiError) {
    return NextResponse.json(errorBody(error.code, error.message, error.field), {
      status: error.status,
    });
  }

  // Intentional server-side-only log; nothing from this reaches the response body.
  console.error("Unhandled API error:", error);
  return NextResponse.json(
    errorBody("INTERNAL.UNEXPECTED_ERROR", "An unexpected server error occurred."),
    { status: 500 },
  );
}
