import type { EntityId, KeywordDefinitionId } from "@prowess/model";
import { isValidCanonicalKey } from "@prowess/model";
import { InputProblems, readUuid } from "../internal/input-reader.js";
import { deepFreeze, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { readProvenance, type RuleProvenance } from "../result/provenance.js";
import { isValidFormulaIdentifier } from "../formula/ast.js";
import {
  REQUIREMENT_DIAGNOSTIC_CODES,
  REQUIREMENT_GROUP_KINDS,
  REQUIREMENT_LIMITS,
  REQUIREMENT_NUMERIC_OPERATORS,
  REQUIREMENT_PREDICATE_KINDS,
  type RequirementDiagnostic,
  type RequirementDiagnosticCode,
  type RequirementGroupKind,
  type RequirementNode,
  type RequirementPredicate,
} from "./model.js";

/**
 * Requirement-definition validation (PAS-10 M4-WO5 §36, §40, §58, §90–92), local to Requirement correctness — not the
 * M4-WO8 Validation Engine.
 *
 * Phase 1 walks the caller's tree ITERATIVELY with an explicit stack: shape, limits (nodes, depth, children per group)
 * and cycles (an object that is its own ancestor) are checked before anything recursive touches untrusted depth.
 * Diagnostics are produced in authored pre-order. Phase 2 (only when phase 1 found nothing) builds the detached,
 * deep-frozen normalized tree; its recursion is bounded by MAX_DEPTH.
 */

/**
 * Fact keys use the Formula identifier grammar (M4-WO3): exact, case-sensitive, dotted, locale-free, never
 * `__proto__` / `constructor` / `prototype`. A Formula result can therefore be supplied as a numeric fact under its own
 * variable key. Rank keys and set members are exact labels: non-empty, at most 200 code units, no surrounding space.
 */
export const isValidFactKey = (value: unknown): value is string => isValidFormulaIdentifier(value);
const MAX_LABEL_LENGTH = 200;
export const isExactLabel = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_LABEL_LENGTH && value.trim() === value;

const PREDICATE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  NUMERIC_COMPARE: ["kind", "factKey", "operator", "expected", "provenance"],
  RANK_AT_LEAST: ["kind", "factKey", "requiredRankKey", "requiredOrder", "provenance"],
  KEYWORD_PRESENT: ["kind", "keywordId", "canonicalKey", "provenance"],
  SET_CONTAINS: ["kind", "factKey", "member", "provenance"],
  ENTITY_OWNED: ["kind", "entityId", "provenance"],
};
const GROUP_FIELDS: readonly string[] = ["kind", "children", "provenance"];

export type RequirementValidation =
  | { readonly ok: true; readonly requirement: RequirementNode }
  | { readonly ok: false; readonly diagnostics: readonly RequirementDiagnostic[] };

/** Own data properties only — an accessor or symbol key makes the node non-plain (getters are never invoked). */
function plainNode(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.keys(value).every((k) => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return d !== undefined && d.get === undefined && d.set === undefined;
  });
}

const zero = (n: number) => (Object.is(n, -0) ? 0 : n);

/** Reads one predicate, appending diagnostics; returns the normalized predicate or null. */
function readPredicate(
  node: Record<string, unknown>,
  at: readonly (string | number)[],
  report: (code: RequirementDiagnosticCode, message: string, path: readonly (string | number)[]) => void,
): RequirementPredicate | null {
  const kind = node.kind as string;
  const before = { count: 0 };
  const fail = (message: string, field: string) => {
    before.count += 1;
    report(REQUIREMENT_DIAGNOSTIC_CODES.INVALID_DEFINITION, message, [...at, field]);
  };
  for (const key of Object.keys(node).sort()) {
    if (!(PREDICATE_FIELDS[kind] as readonly string[]).includes(key)) fail(`unknown field "${key}" on ${kind}`, key);
  }
  const problems = new InputProblems();
  const provenance: RuleProvenance | null = readProvenance(node.provenance, [], problems);
  if (problems.count > 0) fail("provenance is malformed", "provenance");

  const factKey = () => {
    if (!isValidFactKey(node.factKey)) fail("factKey must be an exact fact identifier", "factKey");
    return node.factKey as string;
  };
  let predicate: RequirementPredicate | null = null;
  switch (kind) {
    case "NUMERIC_COMPARE": {
      const key = factKey();
      if (!(REQUIREMENT_NUMERIC_OPERATORS as readonly unknown[]).includes(node.operator)) fail(`operator must be one of ${REQUIREMENT_NUMERIC_OPERATORS.join(" ")}`, "operator");
      if (typeof node.expected !== "number" || !Number.isFinite(node.expected)) fail("expected must be a finite number", "expected");
      predicate = { kind, factKey: key, operator: node.operator as "==", expected: zero(node.expected as number), provenance };
      break;
    }
    case "RANK_AT_LEAST": {
      const key = factKey();
      if (!isExactLabel(node.requiredRankKey)) fail("requiredRankKey must be an exact non-empty label", "requiredRankKey");
      if (typeof node.requiredOrder !== "number" || !Number.isSafeInteger(node.requiredOrder)) fail("requiredOrder must be a finite integer", "requiredOrder");
      predicate = { kind, factKey: key, requiredRankKey: node.requiredRankKey as string, requiredOrder: zero(node.requiredOrder as number), provenance };
      break;
    }
    case "KEYWORD_PRESENT": {
      const hasId = node.keywordId !== undefined && node.keywordId !== null;
      const hasKey = node.canonicalKey !== undefined && node.canonicalKey !== null;
      if (hasId === hasKey) fail("exactly one of keywordId or canonicalKey is required", hasId ? "canonicalKey" : "keywordId");
      const keywordId = hasId ? readUuid(node.keywordId, [], new InputProblems()) : null;
      if (hasId && keywordId === null) fail("keywordId must be a KeywordDefinition UUID", "keywordId");
      if (hasKey && (typeof node.canonicalKey !== "string" || !isValidCanonicalKey(node.canonicalKey))) fail("canonicalKey must be a valid M1 canonical key", "canonicalKey");
      predicate = { kind, keywordId: keywordId as KeywordDefinitionId | null, canonicalKey: hasKey ? (node.canonicalKey as string) : null, provenance };
      break;
    }
    case "SET_CONTAINS": {
      const key = factKey();
      if (!isExactLabel(node.member)) fail("member must be an exact non-empty label", "member");
      predicate = { kind, factKey: key, member: node.member as string, provenance };
      break;
    }
    default: {
      const entityId = readUuid(node.entityId, [], new InputProblems());
      if (entityId === null) fail("entityId must be an Entity UUID", "entityId");
      predicate = { kind: "ENTITY_OWNED", entityId: entityId as EntityId, provenance };
    }
  }
  return before.count === 0 ? predicate : null;
}

export function validateRequirement(requirement: unknown, base: readonly (string | number)[] = []): RequirementValidation {
  const diagnostics: RequirementDiagnostic[] = [];
  const leaves = new Map<object, RequirementPredicate>();
  const groupProvenance = new Map<object, RuleProvenance | null>();
  let current: { nodePath: string; provenance: RuleProvenance | null } = { nodePath: "root", provenance: null };
  const report = (code: RequirementDiagnosticCode, message: string, path: readonly (string | number)[]) => {
    diagnostics.push({ code, message, path: jsonPointer([...base, ...path]), nodePath: current.nodePath, provenance: current.provenance });
  };

  type Frame = { kind: "enter"; value: unknown; at: (string | number)[]; nodePath: string; depth: number } | { kind: "exit"; value: object };
  const stack: Frame[] = [{ kind: "enter", value: requirement, at: [], nodePath: "root", depth: 1 }];
  const ancestors = new Set<object>();
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    if (frame.kind === "exit") {
      ancestors.delete(frame.value);
      continue;
    }
    current = { nodePath: frame.nodePath, provenance: null };
    nodes += 1;
    if (nodes > REQUIREMENT_LIMITS.MAX_NODES) {
      report(REQUIREMENT_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `a Requirement tree may have at most ${REQUIREMENT_LIMITS.MAX_NODES} nodes`, frame.at);
      break;
    }
    if (frame.depth > REQUIREMENT_LIMITS.MAX_DEPTH) {
      report(REQUIREMENT_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `a Requirement tree may be at most ${REQUIREMENT_LIMITS.MAX_DEPTH} deep`, frame.at);
      break;
    }
    const node = frame.value;
    if (node !== null && typeof node === "object" && ancestors.has(node)) {
      report(REQUIREMENT_DIAGNOSTIC_CODES.INVALID_DEFINITION, "a Requirement tree must not contain itself (cycle)", frame.at);
      continue;
    }
    if (!plainNode(node)) {
      report(REQUIREMENT_DIAGNOSTIC_CODES.INVALID_DEFINITION, "a Requirement node must be a plain data object (no functions, accessors or class instances)", frame.at);
      continue;
    }
    const kind = node.kind;
    if ((REQUIREMENT_GROUP_KINDS as readonly unknown[]).includes(kind)) {
      for (const key of Object.keys(node).sort()) {
        if (!GROUP_FIELDS.includes(key)) report(REQUIREMENT_DIAGNOSTIC_CODES.INVALID_DEFINITION, `unknown field "${key}" on ${String(kind)}`, [...frame.at, key]);
      }
      const problems = new InputProblems();
      const provenance = readProvenance(node.provenance, [], problems);
      if (problems.count > 0) report(REQUIREMENT_DIAGNOSTIC_CODES.INVALID_DEFINITION, "provenance is malformed", [...frame.at, "provenance"]);
      groupProvenance.set(node, provenance);
      const children = node.children;
      if (!Array.isArray(children) || children.length === 0) {
        report(REQUIREMENT_DIAGNOSTIC_CODES.INVALID_DEFINITION, `${String(kind)} needs a non-empty children array (empty groups are rejected, never vacuously true)`, [...frame.at, "children"]);
        continue;
      }
      if (children.length > REQUIREMENT_LIMITS.MAX_CHILDREN_PER_GROUP) {
        report(REQUIREMENT_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, `a group may have at most ${REQUIREMENT_LIMITS.MAX_CHILDREN_PER_GROUP} children`, [...frame.at, "children"]);
        break;
      }
      ancestors.add(node);
      stack.push({ kind: "exit", value: node });
      for (let i = children.length - 1; i >= 0; i -= 1) {
        if (!(i in children)) {
          report(REQUIREMENT_DIAGNOSTIC_CODES.INVALID_DEFINITION, "children must not have holes", [...frame.at, "children", i]);
          continue;
        }
        stack.push({ kind: "enter", value: children[i], at: [...frame.at, "children", i], nodePath: `${frame.nodePath}.${i}`, depth: frame.depth + 1 });
      }
      continue;
    }
    if (!(REQUIREMENT_PREDICATE_KINDS as readonly unknown[]).includes(kind)) {
      report(
        REQUIREMENT_DIAGNOSTIC_CODES.UNSUPPORTED_PREDICATE,
        `unsupported predicate kind ${JSON.stringify(typeof kind === "string" ? kind : String(kind))} (CUSTOM predicates are never executed)`,
        [...frame.at, "kind"],
      );
      continue;
    }
    const predicate = readPredicate(node, frame.at, report);
    if (predicate !== null) leaves.set(node, predicate);
  }

  if (diagnostics.length > 0) {
    // Diagnostics are already in authored pre-order: each node reports its own problems before its children's.
    return deepFreeze({ ok: false as const, diagnostics });
  }

  const build = (value: Record<string, unknown>): RequirementNode => {
    const leaf = leaves.get(value);
    if (leaf !== undefined) return { ...leaf };
    return {
      kind: value.kind as RequirementGroupKind,
      children: (value.children as Record<string, unknown>[]).map(build),
      provenance: groupProvenance.get(value) ?? null,
    };
  };
  return deepFreeze({ ok: true as const, requirement: build(requirement as Record<string, unknown>) });
}
