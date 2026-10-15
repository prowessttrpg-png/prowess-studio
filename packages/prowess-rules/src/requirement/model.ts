import { deepFreeze } from "../internal/plain-data.js";
import type { EntityId, JsonObject, KeywordDefinitionId } from "@prowess/model";
import type { RuleProvenance } from "../result/provenance.js";

/**
 * The Requirement model (PAS-10 M4-WO5 §10–24, §32–54, §90).
 *
 * A Requirement is explicit structured data: a tree of known predicate kinds combined by ALL / ANY / NONE groups. It
 * is never prose, never an expression string and never a callback. Evaluation answers one question — "given these
 * explicit facts, is this prerequisite satisfied?" — and keeps three states apart:
 *
 *   A. satisfied                  → SUCCESS, satisfied: true
 *   B. evaluated, not satisfied   → SUCCESS, satisfied: false   (a normal result: no error, warning or info)
 *   C. cannot be evaluated        → INVALID with REQUIREMENT.* diagnostics, data null
 *
 * The engine knows no game vocabulary: fact keys, rank keys and set members are opaque exact strings supplied by
 * content and context.
 */

/** Numeric comparison operators: standard comparison of finite numbers, no epsilon. */
export const REQUIREMENT_NUMERIC_OPERATORS = deepFreeze(["==", "!=", "<", "<=", ">", ">="] as const);
export type RequirementNumericOperator = (typeof REQUIREMENT_NUMERIC_OPERATORS)[number];

export const REQUIREMENT_PREDICATE_KINDS = deepFreeze(["NUMERIC_COMPARE", "RANK_AT_LEAST", "KEYWORD_PRESENT", "SET_CONTAINS", "ENTITY_OWNED"] as const);
export type RequirementPredicateKind = (typeof REQUIREMENT_PREDICATE_KINDS)[number];

export const REQUIREMENT_GROUP_KINDS = deepFreeze(["ALL", "ANY", "NONE"] as const);
export type RequirementGroupKind = (typeof REQUIREMENT_GROUP_KINDS)[number];

/** A numeric fact compared with a finite expected value. */
export interface NumericComparePredicate {
  readonly kind: "NUMERIC_COMPARE";
  readonly factKey: string;
  readonly operator: RequirementNumericOperator;
  readonly expected: number;
  readonly provenance: RuleProvenance | null;
}

/**
 * An ordered rank at least the required one: `actual.order >= requiredOrder`. The order is DATA supplied by content —
 * no rank ladder exists in the engine. `requiredRankKey` is an exact label carried as metadata; it is never compared.
 */
export interface RankAtLeastPredicate {
  readonly kind: "RANK_AT_LEAST";
  readonly factKey: string;
  readonly requiredRankKey: string;
  readonly requiredOrder: number;
  readonly provenance: RuleProvenance | null;
}

/** Exact Keyword presence, through M4-WO4's exact membership. Exactly one of `keywordId` / `canonicalKey`. */
export interface KeywordPresentPredicate {
  readonly kind: "KEYWORD_PRESENT";
  readonly keywordId: KeywordDefinitionId | null;
  readonly canonicalKey: string | null;
  readonly provenance: RuleProvenance | null;
}

/** Exact membership of `member` in the set fact `factKey`. */
export interface SetContainsPredicate {
  readonly kind: "SET_CONTAINS";
  readonly factKey: string;
  readonly member: string;
  readonly provenance: RuleProvenance | null;
}

/** Exact Entity ownership against the supplied owned-Entity collection. */
export interface EntityOwnedPredicate {
  readonly kind: "ENTITY_OWNED";
  readonly entityId: EntityId;
  readonly provenance: RuleProvenance | null;
}

export type RequirementPredicate = NumericComparePredicate | RankAtLeastPredicate | KeywordPresentPredicate | SetContainsPredicate | EntityOwnedPredicate;

/**
 * ALL: every child satisfied. ANY: at least one. NONE: zero. Never empty. Children keep their authored order and are
 * ALWAYS all evaluated — there is no short-circuit, so an invalid child can never hide behind a decided sibling.
 */
export interface RequirementGroup {
  readonly kind: RequirementGroupKind;
  readonly children: readonly RequirementNode[];
  readonly provenance: RuleProvenance | null;
}

export type RequirementNode = RequirementPredicate | RequirementGroup;

/**
 * A structured outcome mirroring the Requirement tree. `nodePath` is the authored position: `root`, `root.0`,
 * `root.1.0`. Leaves record actual vs expected as data; groups record their ordered child outcomes.
 */
export interface RequirementLeafOutcome {
  readonly nodePath: string;
  readonly kind: RequirementPredicateKind;
  readonly satisfied: boolean;
  readonly expected: JsonObject;
  readonly actual: JsonObject;
  /** Where the Requirement node came from, when supplied. */
  readonly provenance: RuleProvenance | null;
  /** Where the fact it read came from, when supplied. */
  readonly factProvenance: RuleProvenance | null;
}

export interface RequirementGroupOutcome {
  readonly nodePath: string;
  readonly kind: RequirementGroupKind;
  readonly satisfied: boolean;
  readonly children: readonly RequirementOutcome[];
  readonly provenance: RuleProvenance | null;
}

export type RequirementOutcome = RequirementLeafOutcome | RequirementGroupOutcome;

/** The data of a valid evaluation — satisfied or not. */
export interface RequirementEvaluation {
  readonly satisfied: boolean;
  readonly outcome: RequirementOutcome;
}

/**
 * Requirement diagnostics: the Requirement or the facts cannot be evaluated. Never used for a normal false result —
 * there is deliberately no "not met" code.
 */
export const REQUIREMENT_DIAGNOSTIC_CODES = deepFreeze({
  /** Malformed node: unknown field, bad key, non-finite threshold, empty group, cyclic or non-plain data. */
  INVALID_DEFINITION: "REQUIREMENT.INVALID_DEFINITION",
  /** A predicate kind the engine does not execute — including CUSTOM, which never runs code. */
  UNSUPPORTED_PREDICATE: "REQUIREMENT.UNSUPPORTED_PREDICATE",
  /** Node, depth or children-per-group limit exceeded. */
  LIMIT_EXCEEDED: "REQUIREMENT.LIMIT_EXCEEDED",
  /** Malformed facts: bad key, non-finite / non-number value, bad rank order, bad member, not a resolved KeywordSet. */
  INVALID_FACTS: "REQUIREMENT.INVALID_FACTS",
  /** One fact key supplied with conflicting values (or as two fact kinds). Never "last one wins". */
  FACT_CONFLICT: "REQUIREMENT.FACT_CONFLICT",
  /** A predicate needs a fact, the owned-Entity collection or the KeywordSet, and it was not supplied. */
  MISSING_FACT: "REQUIREMENT.MISSING_FACT",
  /** A predicate reads a fact key that exists as a different fact kind. */
  TYPE_MISMATCH: "REQUIREMENT.TYPE_MISMATCH",
} as const);

export type RequirementDiagnosticCode = (typeof REQUIREMENT_DIAGNOSTIC_CODES)[keyof typeof REQUIREMENT_DIAGNOSTIC_CODES];

export interface RequirementDiagnostic {
  readonly code: RequirementDiagnosticCode;
  readonly message: string;
  /** RFC 6901 JSON Pointer into the evaluation input (`/requirement/children/1`, `/facts/numeric/0/value`). */
  readonly path: string;
  /** Authored Requirement position (`root.1`), when the diagnostic concerns a node. */
  readonly nodePath: string | null;
  readonly provenance: RuleProvenance | null;
}

/** Deterministic complexity limits (§90). */
export const REQUIREMENT_LIMITS = deepFreeze({
  MAX_NODES: 2048,
  MAX_DEPTH: 64,
  MAX_CHILDREN_PER_GROUP: 512,
} as const);
