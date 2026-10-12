import type { JsonObject } from "@prowess/model";
import { evaluate } from "../evaluation/evaluate.js";
import { jsonPointer } from "../internal/plain-data.js";
import { hasKeywordByCanonicalKey, hasKeywordById } from "../keyword/query.js";
import { booleanValue, numberValue, stringValue } from "../result/evaluation-value.js";
import type { RuleProvenance } from "../result/provenance.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import type { TraceInput, TraceStepInput } from "../trace/calculation-trace.js";
import { validationMessage } from "../validation/validation-message.js";
import { createRequirementFacts, type RequirementFacts } from "./facts.js";
import {
  REQUIREMENT_DIAGNOSTIC_CODES,
  type RequirementDiagnostic,
  type RequirementEvaluation,
  type RequirementGroup,
  type RequirementNode,
  type RequirementOutcome,
  type RequirementPredicate,
} from "./model.js";
import { validateRequirement } from "./validate.js";

/**
 * Requirement evaluation (PAS-10 M4-WO5 §3, §33–57, §84–88).
 *
 * EVERY child of every group is evaluated before the group is combined — the combination counts satisfied children
 * of a fully evaluated list. Nothing short-circuits, so a decided sibling (a true child of ANY, a false child of ALL)
 * can never hide an invalid one. Any node that cannot be evaluated (missing fact, type mismatch) makes the whole
 * evaluation INVALID; an evaluable node that is simply false is a normal result.
 *
 * Read-only: facts, the KeywordSet and the Requirement are never changed, and no fact is computed. Keyword presence is
 * M4-WO4's exact membership; nothing here matches Keywords itself.
 */

/** Trace operation names, an explicit table (no case conversion). */
const OPERATIONS: Readonly<Record<RequirementNode["kind"], string>> = {
  ALL: "requirement.all",
  ANY: "requirement.any",
  NONE: "requirement.none",
  NUMERIC_COMPARE: "requirement.numeric_compare",
  RANK_AT_LEAST: "requirement.rank_at_least",
  KEYWORD_PRESENT: "requirement.keyword_present",
  SET_CONTAINS: "requirement.set_contains",
  ENTITY_OWNED: "requirement.entity_owned",
};

/** Internal fact indexes, built once per evaluation from the normalized facts; never exposed. */
interface FactIndex {
  readonly numeric: ReadonlyMap<string, { value: number; provenance: RuleProvenance | null }>;
  readonly ranks: ReadonlyMap<string, { rankKey: string; order: number; provenance: RuleProvenance | null }>;
  readonly sets: ReadonlyMap<string, { members: ReadonlySet<string>; provenance: RuleProvenance | null }>;
  readonly owned: ReadonlySet<string> | null;
  readonly facts: RequirementFacts;
}

function indexFacts(facts: RequirementFacts): FactIndex {
  return {
    numeric: new Map(facts.numeric.map((f) => [f.key, { value: f.value, provenance: f.provenance }])),
    ranks: new Map(facts.ranks.map((f) => [f.key, { rankKey: f.rankKey, order: f.order, provenance: f.provenance }])),
    sets: new Map(facts.sets.map((f) => [f.key, { members: new Set(f.members), provenance: f.provenance }])),
    owned: facts.ownedEntityIds === null ? null : new Set(facts.ownedEntityIds),
    facts,
  };
}

/** What one node produced: an outcome and trace step, or (for an invalid node) null outcome and a null-output step. */
interface NodeResult {
  readonly outcome: RequirementOutcome | null;
  readonly step: TraceStepInput;
}

const compare = (actual: number, operator: string, expected: number): boolean => {
  switch (operator) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    case ">":
      return actual > expected;
    default:
      return actual >= expected;
  }
};

function evaluatePredicate(
  node: RequirementPredicate,
  key: string,
  nodePath: string,
  at: readonly (string | number)[],
  index: FactIndex,
  diagnostics: RequirementDiagnostic[],
): NodeResult {
  const operation = OPERATIONS[node.kind];
  const unusable = (code: RequirementDiagnostic["code"], message: string): NodeResult => {
    diagnostics.push({ code, message, path: jsonPointer(["requirement", ...at]), nodePath, provenance: node.provenance });
    return { outcome: null, step: { key, operation, output: null, provenance: node.provenance } };
  };
  const kindHolding = (factKey: string) => (index.numeric.has(factKey) ? "numeric" : index.ranks.has(factKey) ? "rank" : index.sets.has(factKey) ? "set" : null);
  const missingOrMismatch = (factKey: string, wanted: string): NodeResult => {
    const held = kindHolding(factKey);
    return held === null
      ? unusable(REQUIREMENT_DIAGNOSTIC_CODES.MISSING_FACT, `no ${wanted} fact "${factKey}" was supplied`)
      : unusable(REQUIREMENT_DIAGNOSTIC_CODES.TYPE_MISMATCH, `fact "${factKey}" is a ${held} fact, not a ${wanted} fact`);
  };
  const leaf = (satisfied: boolean, expected: JsonObject, actual: JsonObject, factProvenance: RuleProvenance | null, inputs: TraceInput[]): NodeResult => ({
    outcome: { nodePath, kind: node.kind, satisfied, expected, actual, provenance: node.provenance, factProvenance },
    step: { key, operation, inputs, output: booleanValue(satisfied), provenance: node.provenance },
  });

  switch (node.kind) {
    case "NUMERIC_COMPARE": {
      const fact = index.numeric.get(node.factKey);
      if (fact === undefined) return missingOrMismatch(node.factKey, "numeric");
      return leaf(compare(fact.value, node.operator, node.expected), { operator: node.operator, value: node.expected }, { value: fact.value }, fact.provenance, [
        { name: "fact_key", value: stringValue(node.factKey) },
        { name: "actual", value: numberValue(fact.value) },
        { name: "operator", value: stringValue(node.operator) },
        { name: "expected", value: numberValue(node.expected) },
      ]);
    }
    case "RANK_AT_LEAST": {
      const fact = index.ranks.get(node.factKey);
      if (fact === undefined) return missingOrMismatch(node.factKey, "rank");
      return leaf(
        fact.order >= node.requiredOrder,
        { rankKey: node.requiredRankKey, order: node.requiredOrder },
        { rankKey: fact.rankKey, order: fact.order },
        fact.provenance,
        [
          { name: "fact_key", value: stringValue(node.factKey) },
          { name: "actual_rank", value: stringValue(fact.rankKey) },
          { name: "actual_order", value: numberValue(fact.order) },
          { name: "required_rank", value: stringValue(node.requiredRankKey) },
          { name: "required_order", value: numberValue(node.requiredOrder) },
        ],
      );
    }
    case "KEYWORD_PRESENT": {
      const set = index.facts.keywords;
      if (set === null) return unusable(REQUIREMENT_DIAGNOSTIC_CODES.MISSING_FACT, "a Keyword requirement needs a ResolvedKeywordSet, and none was supplied");
      const present = node.keywordId !== null ? hasKeywordById(set, node.keywordId) : hasKeywordByCanonicalKey(set, node.canonicalKey as string);
      const identity = node.keywordId !== null ? { name: "keyword_id", value: stringValue(node.keywordId) } : { name: "canonical_key", value: stringValue(node.canonicalKey as string) };
      return leaf(present, { keywordId: node.keywordId, canonicalKey: node.canonicalKey }, { present }, null, [identity]);
    }
    case "SET_CONTAINS": {
      const fact = index.sets.get(node.factKey);
      if (fact === undefined) return missingOrMismatch(node.factKey, "set");
      const present = fact.members.has(node.member);
      return leaf(present, { member: node.member }, { present }, fact.provenance, [
        { name: "fact_key", value: stringValue(node.factKey) },
        { name: "member", value: stringValue(node.member) },
      ]);
    }
    default: {
      if (index.owned === null) return unusable(REQUIREMENT_DIAGNOSTIC_CODES.MISSING_FACT, "an Entity-ownership requirement needs ownedEntityIds, and none were supplied");
      const owned = index.owned.has(node.entityId);
      return leaf(owned, { entityId: node.entityId }, { owned }, null, [{ name: "entity_id", value: stringValue(node.entityId) }]);
    }
  }
}

const isGroup = (node: RequirementNode): node is RequirementGroup => node.kind === "ALL" || node.kind === "ANY" || node.kind === "NONE";

function evaluateNode(
  node: RequirementNode,
  key: string,
  nodePath: string,
  at: readonly (string | number)[],
  index: FactIndex,
  diagnostics: RequirementDiagnostic[],
): NodeResult {
  if (!isGroup(node)) return evaluatePredicate(node, key, nodePath, at, index, diagnostics);

  // Every child, in authored order, before combining — no short-circuit.
  const results = node.children.map((child, i) => evaluateNode(child, `child.${i}`, `${nodePath}.${i}`, [...at, "children", i], index, diagnostics));
  const outcomes = results.map((r) => r.outcome);
  const operation = OPERATIONS[node.kind];
  const steps = results.map((r) => r.step);
  const valid = outcomes.filter((o): o is RequirementOutcome => o !== null);
  if (valid.length !== outcomes.length) return { outcome: null, step: { key, operation, output: null, provenance: node.provenance, children: steps } };

  const satisfiedCount = valid.filter((o) => o.satisfied).length;
  const satisfied = node.kind === "ALL" ? satisfiedCount === valid.length : node.kind === "ANY" ? satisfiedCount > 0 : satisfiedCount === 0;
  return {
    outcome: { nodePath, kind: node.kind, satisfied, children: valid, provenance: node.provenance },
    step: { key, operation, inputs: [{ name: "satisfied_children", value: numberValue(satisfiedCount) }], output: booleanValue(satisfied), provenance: node.provenance, children: steps },
  };
}

function toMessages(diagnostics: readonly RequirementDiagnostic[]) {
  return diagnostics.map((d) =>
    validationMessage({ severity: "ERROR", category: "REQUIREMENT", code: d.code, message: d.message, path: d.path, provenance: d.provenance, details: { nodePath: d.nodePath } }),
  );
}

export interface EvaluateRequirementOptions {
  /** The exact RulesetContext the evaluation runs under; recorded as response provenance, never searched. */
  readonly ruleset?: unknown;
}

/** The evaluation kind `evaluateRequirement` uses on the M4-WO1 boundary. */
export const REQUIREMENT_EVALUATION_KIND = "requirement.evaluate";

/**
 * Evaluates one Requirement tree against explicit facts (§57). SUCCESS carries `{ satisfied, outcome }` — satisfied
 * may be false, with no error, warning or info. INVALID carries REQUIREMENT.* diagnostics in authored order (definition
 * problems, then fact problems, then unusable nodes) and, when the tree and facts were well-formed, a trace of what was
 * inspected. Malformed authored data and incomplete facts are never engine errors.
 */
export function evaluateRequirement(requirement: unknown, facts: unknown, options: EvaluateRequirementOptions = {}): RuleEngineResponse<RequirementEvaluation> {
  return evaluate<RequirementEvaluation | null>(
    {
      kind: REQUIREMENT_EVALUATION_KIND,
      evaluate: () => {
        const tree = validateRequirement(requirement, ["requirement"]);
        const normalized = createRequirementFacts(facts, ["facts"]);
        const early = [...(tree.ok ? [] : tree.diagnostics), ...(normalized.ok ? [] : normalized.diagnostics)];
        if (!tree.ok || !normalized.ok) return { data: null, messages: toMessages(early) };

        const diagnostics: RequirementDiagnostic[] = [];
        const result = evaluateNode(tree.requirement, "requirement", "root", [], indexFacts(normalized.facts), diagnostics);
        const trace = [result.step];
        if (result.outcome === null) return { data: null, messages: toMessages(diagnostics), trace };
        return { data: { satisfied: result.outcome.satisfied, outcome: result.outcome }, trace };
      },
    },
    { kind: REQUIREMENT_EVALUATION_KIND, ruleset: options.ruleset ?? null },
  ) as RuleEngineResponse<RequirementEvaluation>;
}
