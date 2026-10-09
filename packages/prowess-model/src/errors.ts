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
  /** M2-WO12 F2: the reference is historical evidence (e.g. a RuleConflictCandidate cites it); it cannot be removed. */
  IN_USE: "SOURCE_REFERENCE.IN_USE",
} as const;

export type SourceReferenceErrorCode =
  (typeof SOURCE_REFERENCE_ERROR_CODES)[keyof typeof SOURCE_REFERENCE_ERROR_CODES];

/**
 * Ruleset error codes (PAS-10 M2-WO1 §13).
 *
 * `INVALID_PARENT` and `PARENT_CYCLE` are kept distinct because they carry
 * different diagnostics and call for different fixes: INVALID_PARENT means the
 * named parent does not exist (a bad reference — pick another id);
 * PARENT_CYCLE means the parent exists but the assignment would make a lineage
 * loop, including a Ruleset parenting itself (the lineage itself is the
 * problem). Collapsing them would force callers to parse a message to tell
 * which.
 */
export const RULESET_ERROR_CODES = {
  NOT_FOUND: "RULESET.NOT_FOUND",
  CANONICAL_KEY_CONFLICT: "RULESET.CANONICAL_KEY_CONFLICT",
  INVALID_INPUT: "RULESET.INVALID_INPUT",
  INVALID_PARENT: "RULESET.INVALID_PARENT",
  PARENT_CYCLE: "RULESET.PARENT_CYCLE",
  /** M2-WO8: the requested review transition is not allowed from the current status (or the status changed concurrently). */
  INVALID_STATUS_TRANSITION: "RULESET.INVALID_STATUS_TRANSITION",
} as const;

export type RulesetErrorCode = (typeof RULESET_ERROR_CODES)[keyof typeof RULESET_ERROR_CODES];

/**
 * RulesetManifest error codes (PAS-10 M2-WO2 §18).
 *
 * One consistent approach: every failure of manifest creation or retrieval
 * lives in this namespace — including a missing Ruleset, Entity, or
 * EntityVersion — rather than reusing RULESET.NOT_FOUND / ENTITY.NOT_FOUND /
 * ENTITY_VERSION.NOT_FOUND. Reasons: (1) the same word means different things
 * here: NOT_FOUND is "the manifest you asked for does not exist" (a missing
 * URL-style resource), whereas ENTITY_NOT_FOUND / VERSION_NOT_FOUND mean "a
 * thing your request body REFERENCES does not exist" — callers (and the HTTP
 * map) need to tell them apart; (2) one namespace lets a caller handle every
 * manifest outcome without importing four vocabularies.
 */
export const RULESET_MANIFEST_ERROR_CODES = {
  /** The manifest asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "RULESET_MANIFEST.NOT_FOUND",
  /** The Ruleset the manifest is for (or is being listed under) does not exist. */
  RULESET_NOT_FOUND: "RULESET_MANIFEST.RULESET_NOT_FOUND",
  INVALID_INPUT: "RULESET_MANIFEST.INVALID_INPUT",
  /** manifest_version could not be allocated after bounded retries; safe to retry the request. */
  VERSION_CONFLICT: "RULESET_MANIFEST.VERSION_CONFLICT",
  /** An entry references an Entity that does not exist. */
  ENTITY_NOT_FOUND: "RULESET_MANIFEST.ENTITY_NOT_FOUND",
  /** An entry references an EntityVersion that does not exist. */
  VERSION_NOT_FOUND: "RULESET_MANIFEST.VERSION_NOT_FOUND",
  /** An entry pairs an Entity with a Version that belongs to a different Entity. */
  VERSION_ENTITY_MISMATCH: "RULESET_MANIFEST.VERSION_ENTITY_MISMATCH",
  /** One manifest names the same Entity twice. */
  DUPLICATE_ENTITY: "RULESET_MANIFEST.DUPLICATE_ENTITY",
  /**
   * The parent manifest a new manifest tried to inherit from is unusable: it does
   * not exist, it belongs to a Ruleset other than this Ruleset's DIRECT parent
   * (including a grandparent's — inheritance climbs one Ruleset at a time), or this
   * Ruleset has no parent at all. One code, because every case means "that is not a
   * valid thing to inherit from"; the message says which.
   */
  INVALID_PARENT_MANIFEST: "RULESET_MANIFEST.INVALID_PARENT_MANIFEST",
  /**
   * Resolution met a loop in the stored parent_manifest_id chain. Supported
   * operations cannot create one (each hop climbs the acyclic Ruleset lineage), so
   * this signals corrupt data; the resolver stops with this error rather than recurse forever.
   */
  INHERITANCE_CYCLE: "RULESET_MANIFEST.INHERITANCE_CYCLE",
} as const;

export type RulesetManifestErrorCode = (typeof RULESET_MANIFEST_ERROR_CODES)[keyof typeof RULESET_MANIFEST_ERROR_CODES];

/**
 * CanonPolicy error codes (PAS-10 M2-WO4 §29).
 *
 * `RULESET_NOT_FOUND` is the Ruleset a policy is being created or listed for
 * (the resource the request is addressed to); `NOT_FOUND` is a policy asked for
 * by id. `INVALID_INPUT` also covers an unrecognized authority status or a
 * blank name. `VERSION_CONFLICT` means policy_version allocation lost a race
 * repeatedly; the request is safe to retry.
 */
export const CANON_POLICY_ERROR_CODES = {
  NOT_FOUND: "CANON_POLICY.NOT_FOUND",
  RULESET_NOT_FOUND: "CANON_POLICY.RULESET_NOT_FOUND",
  INVALID_INPUT: "CANON_POLICY.INVALID_INPUT",
  VERSION_CONFLICT: "CANON_POLICY.VERSION_CONFLICT",
} as const;

export type CanonPolicyErrorCode = (typeof CANON_POLICY_ERROR_CODES)[keyof typeof CANON_POLICY_ERROR_CODES];

/**
 * SourceAuthorityRecord error codes (PAS-10 M2-WO4 §29).
 *
 * A missing SourceDocument uses this namespace's `SOURCE_NOT_FOUND` rather than
 * reusing `SOURCE_DOCUMENT.NOT_FOUND`, for the same reason RulesetManifest has
 * its own `ENTITY_NOT_FOUND`: the document is referenced INSIDE a request body,
 * so "the thing you referenced does not exist" (a bad request) must be told apart
 * from "the resource you addressed does not exist" (a 404), and one namespace
 * covers every policy-creation failure.
 */
export const SOURCE_AUTHORITY_ERROR_CODES = {
  /** An authority record references a SourceDocument that does not exist. */
  SOURCE_NOT_FOUND: "SOURCE_AUTHORITY.SOURCE_NOT_FOUND",
  /** A scope key is malformed (see isValidSourceAuthorityScopeKey), or a lookup used an invalid one. */
  INVALID_SCOPE: "SOURCE_AUTHORITY.INVALID_SCOPE",
  /** One policy declares the same SourceDocument + scope twice. */
  DUPLICATE_SOURCE_SCOPE: "SOURCE_AUTHORITY.DUPLICATE_SOURCE_SCOPE",
} as const;

export type SourceAuthorityErrorCode = (typeof SOURCE_AUTHORITY_ERROR_CODES)[keyof typeof SOURCE_AUTHORITY_ERROR_CODES];

/**
 * RuleConflict error codes (PAS-10 M2-WO5 §33).
 *
 * One namespace for every conflict outcome, following RulesetManifest's precedent: a
 * caller handles conflict creation without importing four vocabularies, and the codes
 * keep "the resource you ADDRESSED does not exist" (NOT_FOUND, RULESET_NOT_FOUND)
 * apart from "something your request REFERENCES does not exist" (ENTITY_NOT_FOUND,
 * VERSION_NOT_FOUND) — the HTTP map gives them different statuses.
 *
 * Deliberately absent: any code for a status transition, a winner, or a resolution.
 * Those belong to M2-WO6 (Canon Decisions).
 */
export const RULE_CONFLICT_ERROR_CODES = {
  /** The conflict asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "RULE_CONFLICT.NOT_FOUND",
  /** The Ruleset the conflict is created or listed under does not exist. */
  RULESET_NOT_FOUND: "RULE_CONFLICT.RULESET_NOT_FOUND",
  /** The conflict's Entity (named in the request) does not exist. */
  ENTITY_NOT_FOUND: "RULE_CONFLICT.ENTITY_NOT_FOUND",
  /** Shape problems: a blank or over-long title, an unknown type or severity, too many candidates, a bad field. */
  INVALID_INPUT: "RULE_CONFLICT.INVALID_INPUT",
  /** Fewer than two candidates: with zero or one there is no represented disagreement. */
  INSUFFICIENT_CANDIDATES: "RULE_CONFLICT.INSUFFICIENT_CANDIDATES",
  /** The same EntityVersion appears more than once in one conflict. */
  DUPLICATE_CANDIDATE: "RULE_CONFLICT.DUPLICATE_CANDIDATE",
  /** A candidate names an EntityVersion that does not exist. */
  VERSION_NOT_FOUND: "RULE_CONFLICT.VERSION_NOT_FOUND",
  /** A candidate's EntityVersion belongs to a different Entity than the conflict's. */
  VERSION_ENTITY_MISMATCH: "RULE_CONFLICT.VERSION_ENTITY_MISMATCH",
  /** A candidate's SourceReference does not exist, or belongs to a different EntityVersion than the candidate's. */
  INVALID_SOURCE_REFERENCE: "RULE_CONFLICT.INVALID_SOURCE_REFERENCE",
} as const;

export type RuleConflictErrorCode = (typeof RULE_CONFLICT_ERROR_CODES)[keyof typeof RULE_CONFLICT_ERROR_CODES];

/**
 * CanonDecision error codes (PAS-10 M2-WO6 §55).
 *
 * Addressed vs referenced, as everywhere in M2: the RuleConflict a decision is created for (or
 * listed under) and the Ruleset decisions are listed under are the ADDRESSED resources
 * (CONFLICT_NOT_FOUND, RULESET_NOT_FOUND -> 404), while the CanonPolicy, candidates and merge
 * result are REFERENCED in the request body (-> 400). RULESET_NOT_FOUND is not in the WO's list;
 * it is added for `listCanonDecisions`, following CANON_POLICY / RULE_CONFLICT precedent.
 *
 * CONFLICT_ALREADY_DECIDED: the conflict is (or concurrently became) terminal. DECISION_CONFLICT:
 * the database aborted the write because of a concurrent transaction (deadlock / write conflict)
 * — nothing was written and the request is safe to retry.
 */
export const CANON_DECISION_ERROR_CODES = {
  /** The decision asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "CANON_DECISION.NOT_FOUND",
  /** The RuleConflict being decided (or listed) does not exist. */
  CONFLICT_NOT_FOUND: "CANON_DECISION.CONFLICT_NOT_FOUND",
  /** The Ruleset being listed does not exist. */
  RULESET_NOT_FOUND: "CANON_DECISION.RULESET_NOT_FOUND",
  /** The conflict is already RESOLVED / ACCEPTED_DIVERGENCE / DISMISSED (or another decision won the race). */
  CONFLICT_ALREADY_DECIDED: "CANON_DECISION.CONFLICT_ALREADY_DECIDED",
  /** The referenced CanonPolicy does not exist. */
  POLICY_NOT_FOUND: "CANON_DECISION.POLICY_NOT_FOUND",
  /** The CanonPolicy belongs to a different Ruleset than the conflict. */
  INVALID_POLICY_CONTEXT: "CANON_DECISION.INVALID_POLICY_CONTEXT",
  /** Shape problems, an invalid type/disposition combination, a wrong selection count, a duplicate selection, a missing MERGE result. */
  INVALID_INPUT: "CANON_DECISION.INVALID_INPUT",
  /** A selected candidate does not exist or belongs to a different RuleConflict. */
  INVALID_CANDIDATE: "CANON_DECISION.INVALID_CANDIDATE",
  /** The MERGE result Version does not exist or belongs to a different Entity than the conflict's. */
  INVALID_RESULT_VERSION: "CANON_DECISION.INVALID_RESULT_VERSION",
  /** A concurrent transaction aborted the write; nothing was written and it is safe to retry. */
  DECISION_CONFLICT: "CANON_DECISION.DECISION_CONFLICT",
} as const;

export type CanonDecisionErrorCode = (typeof CANON_DECISION_ERROR_CODES)[keyof typeof CANON_DECISION_ERROR_CODES];

/**
 * ChangeSet error codes (PAS-10 M2-WO7 §38).
 *
 * The Ruleset a ChangeSet is created or listed under is the ADDRESSED resource (RULESET_NOT_FOUND ->
 * 404); the CanonDecision, Entities, Versions and Manifests are REFERENCED in the request body
 * (-> 400). OPERATION_CONFLICT describes contradictory operations inside ONE request, so it is a bad
 * request (400) like RULE_CONFLICT.DUPLICATE_CANDIDATE — not a clash with stored state.
 * Deliberately absent: any code for applying, executing, or transitioning a ChangeSet.
 */
export const CHANGE_SET_ERROR_CODES = {
  /** The ChangeSet asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "CHANGE_SET.NOT_FOUND",
  /** The Ruleset the ChangeSet is created or listed under does not exist. */
  RULESET_NOT_FOUND: "CHANGE_SET.RULESET_NOT_FOUND",
  /** The referenced CanonDecision does not exist. */
  DECISION_NOT_FOUND: "CHANGE_SET.DECISION_NOT_FOUND",
  /** The CanonDecision belongs to a different Ruleset than the ChangeSet. */
  INVALID_DECISION_CONTEXT: "CHANGE_SET.INVALID_DECISION_CONTEXT",
  /** Shape problems: name, description, operation count. */
  INVALID_INPUT: "CHANGE_SET.INVALID_INPUT",
  /** One operation breaks its type's rules (a required id missing, a forbidden id present, from = to). */
  INVALID_OPERATION: "CHANGE_SET.INVALID_OPERATION",
  /** Operations in one request contradict each other (e.g. two REPLACEs for one Entity, NO_CHANGE mixed with changes). */
  OPERATION_CONFLICT: "CHANGE_SET.OPERATION_CONFLICT",
  /** An operation's target Entity does not exist. */
  ENTITY_NOT_FOUND: "CHANGE_SET.ENTITY_NOT_FOUND",
  /** An operation's from/to EntityVersion does not exist. */
  VERSION_NOT_FOUND: "CHANGE_SET.VERSION_NOT_FOUND",
  /** An operation's from/to EntityVersion belongs to a different Entity than its target. */
  VERSION_ENTITY_MISMATCH: "CHANGE_SET.VERSION_ENTITY_MISMATCH",
  /** An operation's target RulesetManifest does not exist. */
  MANIFEST_NOT_FOUND: "CHANGE_SET.MANIFEST_NOT_FOUND",
  /** An operation's target RulesetManifest belongs to a different Ruleset than the ChangeSet. */
  INVALID_MANIFEST_CONTEXT: "CHANGE_SET.INVALID_MANIFEST_CONTEXT",
  /** M2-WO8: the requested review transition is not allowed from the current status (or the status changed concurrently). */
  INVALID_STATUS_TRANSITION: "CHANGE_SET.INVALID_STATUS_TRANSITION",
} as const;

export type ChangeSetErrorCode = (typeof CHANGE_SET_ERROR_CODES)[keyof typeof CHANGE_SET_ERROR_CODES];

/**
 * RulesetRelease / publication error codes (PAS-10 M2-WO8 §51). Two codes beyond the WO's list:
 * INVALID_INPUT (request shape) and INVALID_CHANGE_SET_CONTEXT (a ChangeSet of another Ruleset).
 * Statuses: addressed resources 404; body references 400; conflicts with stored state 409 — including
 * UNRESOLVED_CREATE_OPERATION, because the request is well-formed but the APPROVED proposal is not yet
 * publishable in its current state.
 */
export const RULESET_RELEASE_ERROR_CODES = {
  /** The release asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "RULESET_RELEASE.NOT_FOUND",
  /** The Ruleset being published or listed does not exist. */
  RULESET_NOT_FOUND: "RULESET_RELEASE.RULESET_NOT_FOUND",
  /** The Ruleset is not APPROVED or PUBLISHED. */
  RULESET_NOT_PUBLISHABLE: "RULESET_RELEASE.RULESET_NOT_PUBLISHABLE",
  /** Request shape problems. */
  INVALID_INPUT: "RULESET_RELEASE.INVALID_INPUT",
  /** The base manifest does not exist. */
  MANIFEST_NOT_FOUND: "RULESET_RELEASE.MANIFEST_NOT_FOUND",
  /** The base manifest belongs to another Ruleset, is not the latest release's manifest, or an operation targets another manifest. */
  INVALID_MANIFEST_CONTEXT: "RULESET_RELEASE.INVALID_MANIFEST_CONTEXT",
  /** The CanonPolicy does not exist. */
  POLICY_NOT_FOUND: "RULESET_RELEASE.POLICY_NOT_FOUND",
  /** The CanonPolicy belongs to another Ruleset. */
  INVALID_POLICY_CONTEXT: "RULESET_RELEASE.INVALID_POLICY_CONTEXT",
  /** The ChangeSet does not exist. */
  CHANGE_SET_NOT_FOUND: "RULESET_RELEASE.CHANGE_SET_NOT_FOUND",
  /** The ChangeSet belongs to another Ruleset. */
  INVALID_CHANGE_SET_CONTEXT: "RULESET_RELEASE.INVALID_CHANGE_SET_CONTEXT",
  /** The ChangeSet is not APPROVED. */
  CHANGE_SET_NOT_APPROVED: "RULESET_RELEASE.CHANGE_SET_NOT_APPROVED",
  /** The ChangeSet already backs a release (one release per ChangeSet in Phase 1). */
  CHANGE_SET_ALREADY_PUBLISHED: "RULESET_RELEASE.CHANGE_SET_ALREADY_PUBLISHED",
  /** The version label is already used by a release of this Ruleset. */
  VERSION_LABEL_CONFLICT: "RULESET_RELEASE.VERSION_LABEL_CONFLICT",
  /** A ChangeSet operation's expectations no longer match the base composition. */
  STALE_CHANGE_SET: "RULESET_RELEASE.STALE_CHANGE_SET",
  /** The ChangeSet still contains CREATE_ENTITY_VERSION, which publishing never materializes. */
  UNRESOLVED_CREATE_OPERATION: "RULESET_RELEASE.UNRESOLVED_CREATE_OPERATION",
  /** An operation cannot be applied (e.g. DEPRECATE of a Version whose lifecycle does not allow it). */
  INVALID_OPERATION: "RULESET_RELEASE.INVALID_OPERATION",
  /** A concurrent publication changed the release history first; nothing was written, re-check and retry. */
  RELEASE_CONFLICT: "RULESET_RELEASE.RELEASE_CONFLICT",
  /**
   * M2-WO12 F1: the final composition pins an EntityVersion whose content is still editable — DRAFT, or a status
   * from which the M1 lifecycle can return it to DRAFT (derived from ENTITY_VERSION_TRANSITIONS; today IN_REVIEW).
   * Mutable content may not cross the immutable publication boundary. Nothing is promoted or written.
   */
  MUTABLE_VERSION_PINNED: "RULESET_RELEASE.MUTABLE_VERSION_PINNED",
} as const;

export type RulesetReleaseErrorCode = (typeof RULESET_RELEASE_ERROR_CODES)[keyof typeof RULESET_RELEASE_ERROR_CODES];

/**
 * MigrationPlan error codes (PAS-10 M2-WO11 §22). The two Releases are REFERENCED in the request body (-> 400 when
 * missing); a hash that fails verification, or a write the database rejects, clashes with stored state (-> 409).
 * Deliberately absent: any code for applying, executing, or upgrading — no migration execution exists.
 */
export const MIGRATION_PLAN_ERROR_CODES = {
  /** The plan asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "MIGRATION_PLAN.NOT_FOUND",
  /** The source Release does not exist. */
  SOURCE_RELEASE_NOT_FOUND: "MIGRATION_PLAN.SOURCE_RELEASE_NOT_FOUND",
  /** The target Release does not exist. */
  TARGET_RELEASE_NOT_FOUND: "MIGRATION_PLAN.TARGET_RELEASE_NOT_FOUND",
  /** Shape problems: missing/identical Release ids, name, description, filters. */
  INVALID_INPUT: "MIGRATION_PLAN.INVALID_INPUT",
  /** A Release's stored manifest hash does not verify against its published composition; nothing is planned. */
  MANIFEST_INTEGRITY_FAILURE: "MIGRATION_PLAN.MANIFEST_INTEGRITY_FAILURE",
  /** The database rejected an item's Entity/Version reference (Version not of that Entity, or missing). */
  INVALID_VERSION_REFERENCE: "MIGRATION_PLAN.INVALID_VERSION_REFERENCE",
  /** The database rejected the plan as a whole (e.g. a concurrent change); nothing was written. */
  PLAN_CONFLICT: "MIGRATION_PLAN.PLAN_CONFLICT",
} as const;

export type MigrationPlanErrorCode = (typeof MIGRATION_PLAN_ERROR_CODES)[keyof typeof MIGRATION_PLAN_ERROR_CODES];

/**
 * SourceSnapshot error codes (PAS-10 M3-WO1). A Snapshot is one exact revision of a source's bytes; it is
 * immutable once its structure has been ingested.
 */
export const SOURCE_SNAPSHOT_ERROR_CODES = {
  /** The Snapshot asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "SOURCE_SNAPSHOT.NOT_FOUND",
  /** An explicit create named bytes (contentHash) this SourceDocument already has a Snapshot for. */
  DUPLICATE_CONTENT: "SOURCE_SNAPSHOT.DUPLICATE_CONTENT",
  /** The Snapshot already has an ingested structure, and the new structure differs from it. Nothing was written. */
  IMMUTABLE: "SOURCE_SNAPSHOT.IMMUTABLE",
  /** Shape problems with Snapshot metadata (hash format, byte size, filename, mime type, …). */
  INVALID_INPUT: "SOURCE_SNAPSHOT.INVALID_INPUT",
} as const;

export type SourceSnapshotErrorCode = (typeof SOURCE_SNAPSHOT_ERROR_CODES)[keyof typeof SOURCE_SNAPSHOT_ERROR_CODES];

/**
 * Source structure error codes (PAS-10 M3-WO1): sections, blocks, tables, asset placements and the ordered
 * content flow of ONE Snapshot. Structure never crosses Snapshots.
 */
export const SOURCE_STRUCTURE_ERROR_CODES = {
  /** A section / block / table / placement / content node asked for by id does not exist. */
  NOT_FOUND: "SOURCE_STRUCTURE.NOT_FOUND",
  /** A section's parent is missing, is itself, or does not precede it in document order. */
  INVALID_PARENT: "SOURCE_STRUCTURE.INVALID_PARENT",
  /** Ordinals are not unique, contiguous non-negative integers starting at 0. */
  INVALID_ORDER: "SOURCE_STRUCTURE.INVALID_ORDER",
  /** A content node's target does not match its nodeType, or names something absent from this structure. */
  INVALID_NODE_TARGET: "SOURCE_STRUCTURE.INVALID_NODE_TARGET",
  /** Any other shape problem (block type, text, table structure, page location fields, keys). */
  INVALID_INPUT: "SOURCE_STRUCTURE.INVALID_INPUT",
} as const;

export type SourceStructureErrorCode = (typeof SOURCE_STRUCTURE_ERROR_CODES)[keyof typeof SOURCE_STRUCTURE_ERROR_CODES];

/** SourceAsset error codes (PAS-10 M3-WO1). */
export const SOURCE_ASSET_ERROR_CODES = {
  /** The asset asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "SOURCE_ASSET.NOT_FOUND",
} as const;

export type SourceAssetErrorCode = (typeof SOURCE_ASSET_ERROR_CODES)[keyof typeof SOURCE_ASSET_ERROR_CODES];

/**
 * Structural source parsing error codes (PAS-10 M3-WO1). The parser reads document STRUCTURE only; it never
 * interprets prose into rules, so there is no "could not understand the rule" error here by design.
 */
export const SOURCE_PARSE_ERROR_CODES = {
  /** No structural parser exists for this mime type / format. */
  UNSUPPORTED_FORMAT: "SOURCE_PARSE.UNSUPPORTED_FORMAT",
  /** The bytes are not a well-formed instance of the declared format (e.g. a corrupt DOCX container). */
  MALFORMED_SOURCE: "SOURCE_PARSE.MALFORMED_SOURCE",
} as const;

export type SourceParseErrorCode = (typeof SOURCE_PARSE_ERROR_CODES)[keyof typeof SOURCE_PARSE_ERROR_CODES];

/**
 * ImportBatch error codes (PAS-10 M3-WO2). The Batch is the addressed resource (NOT_FOUND -> 404); the Snapshot,
 * scope section and comparison context are REFERENCED in the request (-> 400); a Snapshot whose structure is not yet
 * ingested, or a write the database rejects, clashes with stored state (-> 409).
 */
export const IMPORT_BATCH_ERROR_CODES = {
  /** The Batch asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "IMPORT_BATCH.NOT_FOUND",
  /** The referenced SourceSnapshot does not exist. */
  SOURCE_SNAPSHOT_NOT_FOUND: "IMPORT_BATCH.SOURCE_SNAPSHOT_NOT_FOUND",
  /** The SourceSnapshot exists but its WO1 structural ingestion has not completed. Nothing is triggered. */
  SOURCE_STRUCTURE_NOT_READY: "IMPORT_BATCH.SOURCE_STRUCTURE_NOT_READY",
  /** Scope type / section mismatch, or a scope section that is not a section of the Batch's Snapshot. */
  INVALID_SCOPE: "IMPORT_BATCH.INVALID_SCOPE",
  /** A comparison Manifest without its Ruleset, an unknown Ruleset / Manifest, or a Manifest of another Ruleset. */
  INVALID_COMPARISON_CONTEXT: "IMPORT_BATCH.INVALID_COMPARISON_CONTEXT",
  /** Any other shape problem, including a forbidden server-controlled field (status, fingerprint, hash). */
  INVALID_INPUT: "IMPORT_BATCH.INVALID_INPUT",
  /** The database rejected the Batch in a way that is not an idempotent duplicate; nothing was written. */
  CONFLICT: "IMPORT_BATCH.CONFLICT",
} as const;

export type ImportBatchErrorCode = (typeof IMPORT_BATCH_ERROR_CODES)[keyof typeof IMPORT_BATCH_ERROR_CODES];

/**
 * ExtractionCandidate error codes (PAS-10 M3-WO2). A rejected call records NOTHING (the whole group is atomic).
 */
export const EXTRACTION_CANDIDATE_ERROR_CODES = {
  /** The Candidate asked for by id does not exist (including a malformed id). */
  NOT_FOUND: "EXTRACTION_CANDIDATE.NOT_FOUND",
  /** Shape problems, including a forbidden server-controlled field (status, fingerprint, sourceSnapshotId). */
  INVALID_INPUT: "EXTRACTION_CANDIDATE.INVALID_INPUT",
  /** An anchor names a section / content node that does not exist or belongs to another Snapshot, or an excerpt that is not verbatim source text. */
  INVALID_SOURCE_ANCHOR: "EXTRACTION_CANDIDATE.INVALID_SOURCE_ANCHOR",
  /** An anchor is a real part of the Snapshot but lies outside the Batch's section-subtree scope. */
  OUTSIDE_BATCH_SCOPE: "EXTRACTION_CANDIDATE.OUTSIDE_BATCH_SCOPE",
  /** The ordinal is already owned by a DIFFERENT Candidate of the Batch. Nothing is renumbered. */
  ORDINAL_CONFLICT: "EXTRACTION_CANDIDATE.ORDINAL_CONFLICT",
  /** The same extracted content (fingerprint) is already recorded with a different ordinal or summary. */
  CANDIDATE_CONFLICT: "EXTRACTION_CANDIDATE.CANDIDATE_CONFLICT",
} as const;

export type ExtractionCandidateErrorCode = (typeof EXTRACTION_CANDIDATE_ERROR_CODES)[keyof typeof EXTRACTION_CANDIDATE_ERROR_CODES];
