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
  RULE_CONFLICT_ERROR_CODES,
  CANON_DECISION_ERROR_CODES,
  CHANGE_SET_ERROR_CODES,
  RULESET_RELEASE_ERROR_CODES,
  MIGRATION_PLAN_ERROR_CODES,
  SOURCE_DOCUMENT_ERROR_CODES,
  SOURCE_REFERENCE_ERROR_CODES,
  SOURCE_SNAPSHOT_ERROR_CODES,
  SOURCE_STRUCTURE_ERROR_CODES,
  SOURCE_ASSET_ERROR_CODES,
  SOURCE_PARSE_ERROR_CODES,
  IMPORT_BATCH_ERROR_CODES,
  EXTRACTION_CANDIDATE_ERROR_CODES,
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
  type RuleConflictErrorCode,
  type CanonDecisionErrorCode,
  type ChangeSetErrorCode,
  type RulesetReleaseErrorCode,
  type MigrationPlanErrorCode,
  type SourceDocumentErrorCode,
  type SourceReferenceErrorCode,
  type SourceSnapshotErrorCode,
  type SourceStructureErrorCode,
  type SourceAssetErrorCode,
  type SourceParseErrorCode,
  type ImportBatchErrorCode,
  type ExtractionCandidateErrorCode,
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
  | RuleConflictErrorCode
  | CanonDecisionErrorCode
  | ChangeSetErrorCode
  | RulesetReleaseErrorCode
  | MigrationPlanErrorCode
  | SourceDocumentErrorCode
  | SourceReferenceErrorCode
  | SourceSnapshotErrorCode
  | SourceStructureErrorCode
  | SourceAssetErrorCode
  | SourceParseErrorCode
  | ImportBatchErrorCode
  | ExtractionCandidateErrorCode;

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
  [RULE_CONFLICT_ERROR_CODES.NOT_FOUND]: 404,
  // The Ruleset is the resource a conflict request is addressed to (it is the createRuleConflict /
  // listRuleConflicts subject, not a body field), so a missing one is a 404 — the same convention as
  // RULESET_MANIFEST.RULESET_NOT_FOUND and CANON_POLICY.RULESET_NOT_FOUND.
  [RULE_CONFLICT_ERROR_CODES.RULESET_NOT_FOUND]: 404,
  [CANON_DECISION_ERROR_CODES.NOT_FOUND]: 404,
  // The RuleConflict is the subject a decision is created for / listed under (createCanonDecision's first
  // argument, not a body field), and the Ruleset is the subject of listCanonDecisions: both are ADDRESSED
  // resources, so a missing one is a 404 — the same convention as RULE_CONFLICT.RULESET_NOT_FOUND.
  [CANON_DECISION_ERROR_CODES.CONFLICT_NOT_FOUND]: 404,
  [CANON_DECISION_ERROR_CODES.RULESET_NOT_FOUND]: 404,
  [CHANGE_SET_ERROR_CODES.NOT_FOUND]: 404,
  // The Ruleset a ChangeSet is created / listed under is the addressed resource (createChangeSet's first argument).
  [CHANGE_SET_ERROR_CODES.RULESET_NOT_FOUND]: 404,
  // M2-WO8 review transitions: a disallowed or concurrently-lost transition clashes with stored state (as for
  // ENTITY_VERSION.INVALID_STATUS_TRANSITION).
  [CHANGE_SET_ERROR_CODES.INVALID_STATUS_TRANSITION]: 409,
  [RULESET_ERROR_CODES.INVALID_STATUS_TRANSITION]: 409,
  // RulesetRelease (M2-WO8): addressed resources 404; body references 400; clashes with stored state 409.
  [RULESET_RELEASE_ERROR_CODES.NOT_FOUND]: 404,
  [RULESET_RELEASE_ERROR_CODES.RULESET_NOT_FOUND]: 404,
  [RULESET_RELEASE_ERROR_CODES.INVALID_INPUT]: 400,
  [RULESET_RELEASE_ERROR_CODES.MANIFEST_NOT_FOUND]: 400,
  [RULESET_RELEASE_ERROR_CODES.INVALID_MANIFEST_CONTEXT]: 400,
  [RULESET_RELEASE_ERROR_CODES.POLICY_NOT_FOUND]: 400,
  [RULESET_RELEASE_ERROR_CODES.INVALID_POLICY_CONTEXT]: 400,
  [RULESET_RELEASE_ERROR_CODES.CHANGE_SET_NOT_FOUND]: 400,
  [RULESET_RELEASE_ERROR_CODES.INVALID_CHANGE_SET_CONTEXT]: 400,
  [RULESET_RELEASE_ERROR_CODES.INVALID_OPERATION]: 400,
  [RULESET_RELEASE_ERROR_CODES.RULESET_NOT_PUBLISHABLE]: 409,
  [RULESET_RELEASE_ERROR_CODES.CHANGE_SET_NOT_APPROVED]: 409,
  [RULESET_RELEASE_ERROR_CODES.CHANGE_SET_ALREADY_PUBLISHED]: 409,
  [RULESET_RELEASE_ERROR_CODES.VERSION_LABEL_CONFLICT]: 409,
  [RULESET_RELEASE_ERROR_CODES.STALE_CHANGE_SET]: 409,
  // Well-formed request, but the APPROVED proposal is not publishable in its current state: 409, not 400.
  [RULESET_RELEASE_ERROR_CODES.UNRESOLVED_CREATE_OPERATION]: 409,
  [RULESET_RELEASE_ERROR_CODES.RELEASE_CONFLICT]: 409,
  // M2-WO12 F1: editable Versions may not be published — a clash with stored lifecycle state.
  [RULESET_RELEASE_ERROR_CODES.MUTABLE_VERSION_PINNED]: 409,
  // MigrationPlan (M2-WO11): the plan is the addressed resource (404); both Releases are referenced in the body (400);
  // an integrity failure or a database rejection clashes with stored state (409).
  [MIGRATION_PLAN_ERROR_CODES.NOT_FOUND]: 404,
  [MIGRATION_PLAN_ERROR_CODES.SOURCE_RELEASE_NOT_FOUND]: 400,
  [MIGRATION_PLAN_ERROR_CODES.TARGET_RELEASE_NOT_FOUND]: 400,
  [MIGRATION_PLAN_ERROR_CODES.INVALID_INPUT]: 400,
  [MIGRATION_PLAN_ERROR_CODES.MANIFEST_INTEGRITY_FAILURE]: 409,
  [MIGRATION_PLAN_ERROR_CODES.INVALID_VERSION_REFERENCE]: 409,
  [MIGRATION_PLAN_ERROR_CODES.PLAN_CONFLICT]: 409,

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
  // The conflict is already terminal: a clash with stored state, exactly like INVALID_STATUS_TRANSITION.
  [CANON_DECISION_ERROR_CODES.CONFLICT_ALREADY_DECIDED]: 409,
  // A concurrent transaction aborted the write; nothing was written and the request is safe to retry.
  [CANON_DECISION_ERROR_CODES.DECISION_CONFLICT]: 409,

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
  // M2-WO12 F2: the reference is historical evidence and cannot be removed.
  [SOURCE_REFERENCE_ERROR_CODES.IN_USE]: 409,
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
  // RuleConflict (M2-WO5): every one of these describes the request BODY — its shape, its candidate
  // list, or an Entity / Version / SourceReference it names — so each is a bad request, never a missing
  // URL resource (the same reasoning as RULESET_MANIFEST.ENTITY_NOT_FOUND / DUPLICATE_ENTITY -> 400).
  // DUPLICATE_CANDIDATE is 400, not 409: the duplicate is inside one request, not a clash with stored
  // state (two separate conflicts may legitimately share candidates).
  [RULE_CONFLICT_ERROR_CODES.INVALID_INPUT]: 400,
  [RULE_CONFLICT_ERROR_CODES.ENTITY_NOT_FOUND]: 400,
  [RULE_CONFLICT_ERROR_CODES.INSUFFICIENT_CANDIDATES]: 400,
  [RULE_CONFLICT_ERROR_CODES.DUPLICATE_CANDIDATE]: 400,
  [RULE_CONFLICT_ERROR_CODES.VERSION_NOT_FOUND]: 400,
  [RULE_CONFLICT_ERROR_CODES.VERSION_ENTITY_MISMATCH]: 400,
  [RULE_CONFLICT_ERROR_CODES.INVALID_SOURCE_REFERENCE]: 400,
  // CanonDecision (M2-WO6): the policy, candidates and merge result are REFERENCED in the request body, so a
  // missing or mismatched one is a bad request (RULESET_MANIFEST.ENTITY_NOT_FOUND precedent), as are shape and
  // type/disposition/selection-count problems.
  [CANON_DECISION_ERROR_CODES.POLICY_NOT_FOUND]: 400,
  [CANON_DECISION_ERROR_CODES.INVALID_POLICY_CONTEXT]: 400,
  [CANON_DECISION_ERROR_CODES.INVALID_INPUT]: 400,
  [CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE]: 400,
  [CANON_DECISION_ERROR_CODES.INVALID_RESULT_VERSION]: 400,
  // ChangeSet (M2-WO7): the decision, Entities, Versions and manifests are REFERENCED (request body / decision
  // translation input), so missing or mismatched ones are bad requests. OPERATION_CONFLICT is a contradiction
  // INSIDE one request, not a clash with stored state — 400, like RULE_CONFLICT.DUPLICATE_CANDIDATE.
  [CHANGE_SET_ERROR_CODES.DECISION_NOT_FOUND]: 400,
  [CHANGE_SET_ERROR_CODES.INVALID_DECISION_CONTEXT]: 400,
  [CHANGE_SET_ERROR_CODES.INVALID_INPUT]: 400,
  [CHANGE_SET_ERROR_CODES.INVALID_OPERATION]: 400,
  [CHANGE_SET_ERROR_CODES.OPERATION_CONFLICT]: 400,
  [CHANGE_SET_ERROR_CODES.ENTITY_NOT_FOUND]: 400,
  [CHANGE_SET_ERROR_CODES.VERSION_NOT_FOUND]: 400,
  [CHANGE_SET_ERROR_CODES.VERSION_ENTITY_MISMATCH]: 400,
  [CHANGE_SET_ERROR_CODES.MANIFEST_NOT_FOUND]: 400,
  [CHANGE_SET_ERROR_CODES.INVALID_MANIFEST_CONTEXT]: 400,
  // Corrupt stored data, not anything the caller did: supported operations cannot create an inheritance
  // loop. An integrity failure on the server is a 500 by design, mapped explicitly so it is a decision
  // and not merely the fail-closed default for an unmapped code.
  [RULESET_MANIFEST_ERROR_CODES.INHERITANCE_CYCLE]: 500,

  // Structured source layer (M3-WO1). No HTTP routes expose these yet (services only in WO1); each code still gets a
  // deliberate status now so the exhaustive map stays exhaustive and a later API Work Order inherits the decision.
  // Addressed resources 404; shape problems 400; clashes with stored state 409; unparseable uploads 422.
  [SOURCE_SNAPSHOT_ERROR_CODES.NOT_FOUND]: 404,
  [SOURCE_SNAPSHOT_ERROR_CODES.INVALID_INPUT]: 400,
  // The document already has a Snapshot of exactly these bytes — a clash with stored state.
  [SOURCE_SNAPSHOT_ERROR_CODES.DUPLICATE_CONTENT]: 409,
  // A Snapshot's structure is immutable once ingested — the same category as ENTITY_VERSION.IMMUTABLE.
  [SOURCE_SNAPSHOT_ERROR_CODES.IMMUTABLE]: 409,
  [SOURCE_STRUCTURE_ERROR_CODES.NOT_FOUND]: 404,
  // Every remaining structure code describes the submitted structure itself (a bad request).
  [SOURCE_STRUCTURE_ERROR_CODES.INVALID_PARENT]: 400,
  [SOURCE_STRUCTURE_ERROR_CODES.INVALID_ORDER]: 400,
  [SOURCE_STRUCTURE_ERROR_CODES.INVALID_NODE_TARGET]: 400,
  [SOURCE_STRUCTURE_ERROR_CODES.INVALID_INPUT]: 400,
  [SOURCE_ASSET_ERROR_CODES.NOT_FOUND]: 404,
  // Well-formed request, but the payload is not a processable instance of its declared format.
  [SOURCE_PARSE_ERROR_CODES.UNSUPPORTED_FORMAT]: 415,
  [SOURCE_PARSE_ERROR_CODES.MALFORMED_SOURCE]: 422,

  // Import Batches & Extraction Candidates (M3-WO2). No routes yet (the Import API is M3-WO7); each code still gets a
  // deliberate status now. Addressed resources 404; referenced Snapshot / section / Ruleset / Manifest and every shape
  // problem 400; clashes with stored state 409.
  [IMPORT_BATCH_ERROR_CODES.NOT_FOUND]: 404,
  [IMPORT_BATCH_ERROR_CODES.SOURCE_SNAPSHOT_NOT_FOUND]: 400,
  // The Snapshot exists but is not ingested yet — a clash with its current state, not a malformed request.
  [IMPORT_BATCH_ERROR_CODES.SOURCE_STRUCTURE_NOT_READY]: 409,
  [IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE]: 400,
  [IMPORT_BATCH_ERROR_CODES.INVALID_COMPARISON_CONTEXT]: 400,
  [IMPORT_BATCH_ERROR_CODES.INVALID_INPUT]: 400,
  [IMPORT_BATCH_ERROR_CODES.CONFLICT]: 409,
  [EXTRACTION_CANDIDATE_ERROR_CODES.NOT_FOUND]: 404,
  [EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT]: 400,
  [EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_SOURCE_ANCHOR]: 400,
  [EXTRACTION_CANDIDATE_ERROR_CODES.OUTSIDE_BATCH_SCOPE]: 400,
  [EXTRACTION_CANDIDATE_ERROR_CODES.ORDINAL_CONFLICT]: 409,
  [EXTRACTION_CANDIDATE_ERROR_CODES.CANDIDATE_CONFLICT]: 409,
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
