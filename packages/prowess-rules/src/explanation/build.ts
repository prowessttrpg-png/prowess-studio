import type { JsonValue } from "@prowess/model";
import { evaluate } from "../evaluation/evaluate.js";
import { canonicalJson } from "../internal/canonical-json.js";
import { InputProblems, readUuid } from "../internal/input-reader.js";
import { clonePlainData, deepFreeze, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { numberValue, readEvaluationValue, stringValue, type EvaluationValue } from "../result/evaluation-value.js";
import { readProvenance, type RuleProvenance, type RulesetProvenance } from "../result/provenance.js";
import type { RuleEngineResponse, RuleMessage } from "../result/rule-engine-response.js";
import type { TraceInput, TraceStepInput } from "../trace/calculation-trace.js";
import { validationMessage, type ValidationMessageDraft } from "../validation/validation-message.js";
import { isExactLabel } from "../requirement/validate.js";
import { readSourceResponse } from "../validation-engine/source.js";
import {
  EXPLANATION_CONTRIBUTION_KINDS,
  EXPLANATION_DIAGNOSTIC_CODES,
  EXPLANATION_LIMITS,
  EXPLANATION_STATUS_LABELS,
  type ExplanationContributionKind,
  type ExplanationDocument,
  type ExplanationFact,
  type ExplanationNode,
  type ExplanationSection,
  type ExplanationStatus,
} from "./model.js";

/**
 * buildExplanation (PAS-10 M4-WO9 §10–79, §132–138): the canonical DETAILED explanation of exact completed results.
 *
 * Per contribution, in explicit order (order, then contributionKey — input array order never matters):
 *  - the response is verified as a genuine M4-WO1 response (M4-WO8's reader) whose evaluationKind matches the declared
 *    kind (a mislabelled response is rejected, never re-interpreted);
 *  - its WO1 CalculationTrace is projected node by node, ITERATIVELY (untrusted depth), keeping each step's path and
 *    ordinal verbatim; a path inconsistent with its position is an invalid trace reference;
 *  - presentation statuses come only from explicit fields (a Requirement step's BOOLEAN output, a Modifier step's
 *    `status` input, the Resource `applied` / `canPay` fields, a Validation check's `outcome`);
 *  - facts are COPIED from the result's own typed fields — never computed. A response without data (INVALID / ERROR)
 *    has no facts: no result is invented; its partial trace and diagnostics are still shown.
 * Nothing is re-evaluated, rounded, formatted or converted; no unit is inferred; source objects are never changed.
 */

type Problem = { code: (typeof EXPLANATION_DIAGNOSTIC_CODES)[keyof typeof EXPLANATION_DIAGNOSTIC_CODES]; message: string; path: readonly (string | number)[] };
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const MAX_TEXT = 2000;

/** A plain object whose keys are all own data properties within `allowed` (getters are never invoked). */
function ownRecord(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  const disallowed = Object.keys(value).filter((k) => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return !allowed.includes(k) || d === undefined || d.get !== undefined || d.set !== undefined;
  });
  return disallowed.length === 0;
}
const hasExactly = (value: unknown, fields: readonly string[]): value is Record<string, unknown> => ownRecord(value, fields) && Object.keys(value).length === fields.length;
const optionalText = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.length <= MAX_TEXT);

/** The response's evaluationKind each contribution kind must carry. GENERIC accepts any. */
const EVALUATION_KINDS: Readonly<Record<ExplanationContributionKind, (k: unknown) => boolean>> = {
  FORMULA: (k) => k === "formula.evaluate",
  KEYWORD: (k) => k === "keyword.resolve",
  REQUIREMENT: (k) => k === "requirement.evaluate",
  MODIFIER: (k) => k === "modifier.evaluate",
  RESOURCE: (k) => typeof k === "string" && k.startsWith("resource."),
  VALIDATION: (k) => k === "validation.evaluate",
  GENERIC: (k) => typeof k === "string" && k.length > 0,
};

const TRACE_STEP_FIELDS = ["ordinal", "path", "key", "operation", "phase", "inputs", "output", "provenance", "modifierSource", "explanation", "children"];

/** Presentation status of one step — from explicit fields only, scoped to the contribution kind. */
function nodeStatus(kind: ExplanationContributionKind, operation: string, inputs: readonly TraceInput[], output: EvaluationValue | null): ExplanationStatus | null {
  const input = (name: string) => inputs.find((i) => i.name === name)?.value;
  if (kind === "REQUIREMENT" && operation.startsWith("requirement.")) {
    if (output === null) return "INVALID"; // WO5 marks a node that could not be evaluated with a null output
    return output.type === "BOOLEAN" ? (output.value ? "SATISFIED" : "NOT_SATISFIED") : null;
  }
  if (kind === "MODIFIER") {
    const status = input("status");
    if (status?.type === "STRING") return status.value === "APPLIED" ? "APPLIED" : status.value === "SKIPPED_CONDITION" ? "SKIPPED" : status.value === "DEDUPLICATED" ? "DEDUPLICATED" : null;
    return null;
  }
  if (kind === "RESOURCE") {
    if (operation === "resource.payment.settlement" && output?.type === "BOOLEAN") return output.value ? "PAYABLE" : "PAYMENT_UNAVAILABLE";
    const applied = input("applied");
    return applied?.type === "BOOLEAN" ? (applied.value ? "APPLIED" : "NOT_APPLIED") : null;
  }
  if (kind === "VALIDATION" && operation === "validation.check") {
    const outcome = input("outcome");
    return outcome?.type === "STRING" && (outcome.value === "PASS" || outcome.value === "FAIL" || outcome.value === "NOT_APPLICABLE") ? outcome.value : null;
  }
  return null;
}

interface MutableNode extends Omit<ExplanationNode, "children"> {
  children: MutableNode[];
}

/** Iterative projection of a WO1 CalculationTrace. Returns the nodes, or a problem. */
function projectTrace(
  trace: unknown,
  contributionKey: string,
  sectionPosition: number,
  kind: ExplanationContributionKind,
  diagnosticOrdinals: ReadonlySet<number>,
  at: readonly (string | number)[],
): { nodes: MutableNode[]; count: number } | Problem {
  if (!hasExactly(trace, ["steps", "stepCount"]) || !Array.isArray(trace.steps)) {
    return { code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_TRACE_REFERENCE, message: "the response trace is not an M4-WO1 CalculationTrace", path: [...at, "trace"] };
  }
  const roots: MutableNode[] = [];
  type Frame = { step: unknown; parentPath: string | null; index: number; depth: number; into: MutableNode[]; at: (string | number)[] };
  const stack: Frame[] = (trace.steps as unknown[]).map((step, index) => ({ step, parentPath: null, index, depth: 1, into: roots, at: [...at, "trace", "steps", index] })).reverse();
  const ordinals = new Set<number>();
  let count = 0;
  const bad = (message: string, path: readonly (string | number)[]): Problem => ({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_TRACE_REFERENCE, message, path });

  while (stack.length > 0) {
    const f = stack.pop() as Frame;
    count += 1;
    if (count > EXPLANATION_LIMITS.MAX_TRACE_NODES_PER_CONTRIBUTION) return { code: EXPLANATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, message: `a contribution trace may have at most ${EXPLANATION_LIMITS.MAX_TRACE_NODES_PER_CONTRIBUTION} steps`, path: [...at, "trace"] };
    if (f.depth > EXPLANATION_LIMITS.MAX_TRACE_DEPTH) return { code: EXPLANATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, message: `a contribution trace may nest at most ${EXPLANATION_LIMITS.MAX_TRACE_DEPTH} levels`, path: f.at };
    const s = f.step;
    if (!hasExactly(s, TRACE_STEP_FIELDS)) return bad("a trace step must have exactly the M4-WO1 TraceStep fields", f.at);
    const expectedPath = f.parentPath === null ? `${f.index + 1}` : `${f.parentPath}.${f.index + 1}`;
    if (s.path !== expectedPath) return bad(`trace step path "${String(s.path)}" does not match its position (${expectedPath})`, [...f.at, "path"]);
    if (typeof s.ordinal !== "number" || !Number.isSafeInteger(s.ordinal) || s.ordinal < 0 || ordinals.has(s.ordinal)) return bad("trace step ordinals must be unique non-negative integers", [...f.at, "ordinal"]);
    ordinals.add(s.ordinal);
    if (typeof s.key !== "string" || typeof s.operation !== "string" || !(s.phase === null || typeof s.phase === "string") || !(s.explanation === null || typeof s.explanation === "string")) {
      return bad("malformed trace step key / operation / phase / explanation", f.at);
    }
    if (!Array.isArray(s.inputs) || !Array.isArray(s.children)) return bad("trace step inputs and children must be arrays", f.at);
    const problems = new InputProblems();
    const inputs: TraceInput[] = [];
    for (const [i, input] of (s.inputs as unknown[]).entries()) {
      if (!hasExactly(input, ["name", "value"]) || typeof input.name !== "string") return bad("malformed trace input", [...f.at, "inputs", i]);
      const value = readEvaluationValue(input.value, [], problems);
      if (value === null) return bad("malformed trace input value", [...f.at, "inputs", i, "value"]);
      inputs.push({ name: input.name, value });
    }
    const output = s.output === null ? null : readEvaluationValue(s.output, [], problems);
    const provenance = readProvenance(s.provenance, [], problems);
    const modifierSource = readProvenance(s.modifierSource, [], problems);
    if (problems.count > 0 || (s.output !== null && output === null)) return bad("malformed trace output or provenance", f.at);

    const related: number[] = [];
    if (kind === "VALIDATION") {
      const ordinal = inputs.find((i) => i.name === "final_ordinal")?.value;
      if (ordinal !== undefined) {
        if (ordinal.type !== "NUMBER" || !diagnosticOrdinals.has(ordinal.value)) return bad("a validation trace step references a diagnostic that does not exist", [...f.at, "inputs"]);
        related.push(ordinal.value);
      }
    }
    const status = nodeStatus(kind, s.operation, inputs, output);
    const node: MutableNode = {
      nodeId: `${contributionKey}#${expectedPath}`,
      explanationPath: `${sectionPosition}/${expectedPath}`,
      sourceContributionKey: contributionKey,
      sourceTracePath: expectedPath,
      sourceTraceOrdinal: s.ordinal,
      key: s.key,
      operation: s.operation,
      phase: s.phase as string | null,
      status,
      label: status === null ? null : EXPLANATION_STATUS_LABELS[status],
      inputs,
      output,
      provenance,
      modifierSource,
      relatedDiagnosticOrdinals: related,
      omittedChildCount: 0,
      children: [],
    };
    f.into.push(node);
    const children = s.children as unknown[];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ step: children[i], parentPath: expectedPath, index: i, depth: f.depth + 1, into: node.children, at: [...f.at, "children", i] });
    }
  }
  if (trace.stepCount !== count) return bad("trace stepCount does not match its steps", [...at, "trace", "stepCount"]);
  return { nodes: roots, count };
}

/** Typed reads of exact result fields; any mismatch means "this is not that kind of result". */
class ShapeError extends Error {}
const field = (o: unknown, name: string): unknown => {
  if (!isPlainObject(o) || !Object.hasOwn(o, name)) throw new ShapeError(name);
  return (o as Record<string, unknown>)[name];
};
const num = (o: unknown, name: string) => {
  const v = field(o, name);
  if (typeof v !== "number") throw new ShapeError(name);
  return v;
};
const bool = (o: unknown, name: string) => {
  const v = field(o, name);
  if (typeof v !== "boolean") throw new ShapeError(name);
  return v;
};
const list = (o: unknown, name: string) => {
  const v = field(o, name);
  if (!Array.isArray(v)) throw new ShapeError(name);
  return v as unknown[];
};
const json = (v: unknown) => clonePlainData(v) as JsonValue;

/** Facts copied from the exact result's own fields. Nothing is computed except list lengths and an equality check. */
function factsOf(kind: ExplanationContributionKind, evaluationKind: string, data: unknown, messages: readonly RuleMessage[]): ExplanationFact[] {
  const fact = (factKey: string, label: string, value: unknown): ExplanationFact => ({ factKey, label, value: json(value) });
  if (kind === "VALIDATION") {
    return [
      fact("errorCount", "Errors", messages.filter((m) => m.severity === "ERROR").length),
      fact("warningCount", "Warnings", messages.filter((m) => m.severity === "WARNING").length),
      fact("infoCount", "Info", messages.filter((m) => m.severity === "INFO").length),
    ];
  }
  if (data === null) return []; // no result exists — none is invented
  switch (kind) {
    case "FORMULA": {
      const rounding = field(data, "rounding");
      num(rounding, "value");
      return [
        fact("expressionValue", "Raw result", num(data, "expressionValue")),
        fact("rounding", "Rounding", rounding),
        fact("minimum", "Minimum", field(data, "minimum")),
        fact("maximum", "Maximum", field(data, "maximum")),
        fact("finalValue", "Final result", num(data, "finalValue")),
        fact("unit", "Unit", field(data, "unit")),
        fact("variables", "Variables", list(data, "variables")),
      ];
    }
    case "KEYWORD":
      return [fact("keywordCount", "Keywords", list(data, "keywords").length)];
    case "REQUIREMENT":
      return [fact("satisfied", "Satisfied", bool(data, "satisfied"))];
    case "MODIFIER": {
      const valueOf = (t: unknown) => {
        const k = field(t, "kind");
        if (k === "NUMERIC") return num(t, "value");
        if (k === "ORDERED") return field(t, "currentKey");
        return { advantage: (Object.hasOwn(t as object, "advantage") ? list(t, "advantage") : []), disadvantage: Object.hasOwn(t as object, "disadvantage") ? list(t, "disadvantage") : [] };
      };
      const initial = list(data, "initialTargets").map((t) => fact(`initial:${String(field(t, "targetKey"))}`, "Initial value", valueOf(t)));
      const final = list(data, "finalTargets").map((t) => fact(`final:${String(field(t, "targetKey"))}`, "Final value", valueOf(t)));
      return [...initial, ...final];
    }
    case "RESOURCE": {
      if (evaluationKind.startsWith("resource.payment.")) {
        const allocations = list(data, "allocations");
        const original = field(data, "originalResources");
        const resulting = field(data, "resultingResources");
        const resultingCurrent = new Map(list(resulting, "resources").map((r) => [String(field(r, "resourceKey")), num(r, "current")]));
        return [
          // The LISTED amount — never reduced by payment. There is deliberately no "effective" amount.
          fact("listedAmount", "Listed amount", num(data, "listedAmount")),
          fact("canPay", "Payment available", bool(data, "canPay")),
          fact("totalPaid", "Total paid", num(data, "totalPaid")),
          fact("shortfall", "Shortfall", num(data, "shortfall")),
          ...allocations.map((a) => fact(`paid:${String(field(a, "resourceKey"))}`, "Paid by source", num(a, "amountPaid"))),
          ...allocations.map((a) => fact(`resultingCurrent:${String(field(a, "resourceKey"))}`, "Current after payment", resultingCurrent.get(String(field(a, "resourceKey"))) ?? null)),
          fact("resourceStateChanged", "Resource state changed", canonicalJson(original) !== canonicalJson(resulting)),
        ];
      }
      const before = field(data, "before");
      const after = field(data, "after");
      return [
        fact("transition", "Operation", field(data, "transition")),
        fact("applied", "Applied", bool(data, "applied")),
        fact("requestedAmount", "Requested", num(data, "requestedAmount")),
        fact("actualAmount", "Actual", num(data, "actualAmount")),
        fact("shortfall", "Shortfall", num(data, "shortfall")),
        fact("overflow", "Overflow", num(data, "overflow")),
        fact("currentAboveCeiling", "Current above ceiling", bool(data, "currentAboveCeiling")),
        fact("maximum", "Maximum", field(before, "maximum")),
        fact("currentBefore", "Current before", num(before, "current")),
        fact("currentAfter", "Current after", num(after, "current")),
        fact("reservedBefore", "Reserved before", num(before, "reservedCapacity")),
        fact("reservedAfter", "Reserved after", num(after, "reservedCapacity")),
        fact("availableMaximumBefore", "Available maximum before", field(data, "availableMaximumBefore")),
        fact("availableMaximumAfter", "Available maximum after", field(data, "availableMaximumAfter")),
      ];
    }
    default:
      return [];
  }
}

/** Section status: from the response status and explicit result fields only. */
function sectionStatus(kind: ExplanationContributionKind, evaluationKind: string, responseStatus: string, data: unknown): ExplanationStatus {
  if (responseStatus === "ERROR") return "ENGINE_FAILURE";
  if (responseStatus === "INVALID") return "INVALID";
  if (kind === "VALIDATION") return responseStatus === "VALID_WITH_WARNINGS" ? "VALID_WITH_WARNINGS" : "VALID";
  if (kind === "REQUIREMENT") return bool(data, "satisfied") ? "SATISFIED" : "NOT_SATISFIED";
  if (kind === "RESOURCE") return evaluationKind.startsWith("resource.payment.") ? (bool(data, "canPay") ? "PAYABLE" : "PAYMENT_UNAVAILABLE") : bool(data, "applied") ? "APPLIED" : "NOT_APPLIED";
  if (kind === "KEYWORD") return "RESOLVED";
  return "EVALUATED";
}

function readRulesetProvenance(v: unknown): RulesetProvenance | null | undefined {
  if (v === undefined || v === null) return null;
  if (!hasExactly(v, ["rulesetId", "manifestId", "manifestHash", "rulesetVersionLabel", "release"])) return undefined;
  const p = new InputProblems();
  if (readUuid(v.rulesetId, [], p) === null || readUuid(v.manifestId, [], p) === null) return undefined;
  if (!(v.manifestHash === null || typeof v.manifestHash === "string") || !(v.rulesetVersionLabel === null || typeof v.rulesetVersionLabel === "string")) return undefined;
  if (!(v.release === null || isPlainObject(v.release))) return undefined;
  return clonePlainData(v) as unknown as RulesetProvenance;
}

const CONTRIBUTION_FIELDS = ["contributionKey", "order", "kind", "response", "label", "description", "unit", "groupKey", "provenance"];
const INPUT_FIELDS = ["explanationKey", "title", "contributions", "ruleset", "provenance"];

/** The evaluation kind `buildExplanation` uses on the M4-WO1 boundary. */
export const EXPLANATION_BUILD_KIND = "explanation.build";

export interface BuildExplanationOptions {
  /** The exact RulesetContext the explanation runs under; recorded verbatim as response provenance, never searched. */
  readonly ruleset?: unknown;
}

/** Builds the canonical DETAILED ExplanationDocument from exact completed results. */
export function buildExplanation(input: unknown, options: BuildExplanationOptions = {}): RuleEngineResponse<ExplanationDocument> {
  return evaluate<ExplanationDocument | null>(
    {
      kind: EXPLANATION_BUILD_KIND,
      evaluate: () => {
        const problems: Problem[] = [];
        const report = (p: Problem) => problems.push(p);
        const toMessages = (): ValidationMessageDraft[] =>
          problems.map((p) => validationMessage({ severity: "ERROR", category: "STRUCTURE", code: p.code, message: p.message, path: jsonPointer(p.path) }));

        if (!ownRecord(input, INPUT_FIELDS) || !isExactLabel(input.explanationKey) || !Array.isArray(input.contributions) || !optionalText(input.title)) {
          report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_INPUT, message: "an explanation input is { explanationKey, title?, contributions[], ruleset?, provenance? }", path: [] });
          return { data: null, messages: toMessages() };
        }
        if (input.contributions.length > EXPLANATION_LIMITS.MAX_CONTRIBUTIONS) {
          report({ code: EXPLANATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, message: `at most ${EXPLANATION_LIMITS.MAX_CONTRIBUTIONS} contributions`, path: ["contributions"] });
          return { data: null, messages: toMessages() };
        }
        const ruleset = readRulesetProvenance(input.ruleset);
        if (ruleset === undefined) report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_INPUT, message: "ruleset must be an M4-WO1 RulesetProvenance or null", path: ["ruleset"] });
        const docProblems = new InputProblems();
        const docProvenance = readProvenance(input.provenance, [], docProblems);
        if (docProblems.count > 0) report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_INPUT, message: "provenance is malformed", path: ["provenance"] });

        // Contributions, in input order: every malformed one is reported.
        type Read = { key: string; order: number; kind: ExplanationContributionKind; raw: Record<string, unknown>; response: Record<string, unknown>; messages: readonly RuleMessage[]; status: string; signature: string; at: (string | number)[] };
        const read: Read[] = [];
        input.contributions.forEach((c: unknown, i: number) => {
          const at = ["contributions", i];
          if (!ownRecord(c, CONTRIBUTION_FIELDS) || !isExactLabel(c.contributionKey) || typeof c.order !== "number" || !Number.isSafeInteger(c.order)) {
            return void report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: `a contribution is { ${CONTRIBUTION_FIELDS.join(", ")} } with an exact contributionKey and integer order`, path: at });
          }
          if (!(EXPLANATION_CONTRIBUTION_KINDS as readonly unknown[]).includes(c.kind)) {
            return void report({ code: EXPLANATION_DIAGNOSTIC_CODES.UNSUPPORTED_CONTRIBUTION, message: `kind must be one of ${EXPLANATION_CONTRIBUTION_KINDS.join(", ")} (never guessed)`, path: [...at, "kind"] });
          }
          if (![c.label, c.description, c.unit, c.groupKey].every(optionalText)) return void report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: "label, description, unit and groupKey are short strings or null", path: at });
          const cp = new InputProblems();
          readProvenance(c.provenance, [], cp);
          if (cp.count > 0) return void report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: "provenance is malformed", path: [...at, "provenance"] });
          const source = readSourceResponse(c.response);
          if (typeof source === "string") return void report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: `response: ${source}`, path: [...at, "response"] });
          const response = c.response as Record<string, unknown>;
          const kind = c.kind as ExplanationContributionKind;
          if (!EVALUATION_KINDS[kind](response.evaluationKind)) {
            return void report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: `a ${kind} contribution must carry a ${kind} response (got evaluationKind ${JSON.stringify(response.evaluationKind)})`, path: [...at, "response", "evaluationKind"] });
          }
          read.push({ key: c.contributionKey as string, order: c.order as number, kind, raw: c, response, messages: source.messages, status: source.status, signature: canonicalJson(c), at });
        });

        // Duplicate identities, sorted: identical collapse, conflicting fail closed.
        const groups = new Map<string, Read[]>();
        for (const r of read) groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
        const unique: Read[] = [];
        for (const key of [...groups.keys()].sort(byCodeUnit)) {
          const members = groups.get(key) as Read[];
          if (new Set(members.map((m) => m.signature)).size > 1) report({ code: EXPLANATION_DIAGNOSTIC_CODES.DUPLICATE_CONTRIBUTION, message: `contributionKey "${key}" is supplied with conflicting content`, path: ["contributions"] });
          else unique.push(members[0] as Read);
        }
        if (problems.length > 0) return { data: null, messages: toMessages() };

        // Sections, in explicit order.
        const ordered = unique.sort((a, b) => a.order - b.order || byCodeUnit(a.key, b.key));
        const sections: ExplanationSection[] = [];
        let totalNodes = 0;
        for (const [position, r] of ordered.entries()) {
          const evaluationKind = r.response.evaluationKind as string;
          const projected = projectTrace(r.response.trace, r.key, position + 1, r.kind, new Set(r.messages.map((m) => m.ordinal)), r.at.concat("response"));
          if ("code" in projected) {
            report(projected);
            continue;
          }
          totalNodes += projected.count;
          if (totalNodes > EXPLANATION_LIMITS.MAX_TOTAL_NODES) {
            report({ code: EXPLANATION_DIAGNOSTIC_CODES.LIMIT_EXCEEDED, message: `an explanation may have at most ${EXPLANATION_LIMITS.MAX_TOTAL_NODES} nodes`, path: ["contributions"] });
            break;
          }
          let facts: ExplanationFact[];
          let status: ExplanationStatus;
          try {
            facts = factsOf(r.kind, evaluationKind, r.response.data, r.messages);
            status = sectionStatus(r.kind, evaluationKind, r.status, r.response.data);
          } catch (e) {
            if (!(e instanceof ShapeError)) throw e;
            report({ code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_CONTRIBUTION, message: `the ${r.kind} result is missing or mistypes field "${e.message}"`, path: [...r.at, "response", "data"] });
            continue;
          }
          const text = (v: unknown) => (typeof v === "string" ? v : null);
          sections.push({
            sectionKey: r.key,
            kind: r.kind,
            order: r.order,
            label: text(r.raw.label),
            description: text(r.raw.description),
            unit: text(r.raw.unit),
            groupKey: text(r.raw.groupKey),
            evaluationKind,
            responseStatus: r.status as ExplanationSection["responseStatus"],
            status,
            statusLabel: EXPLANATION_STATUS_LABELS[status],
            facts,
            nodes: projected.nodes,
            diagnostics: clonePlainData(r.messages) as unknown as RuleMessage[],
            provenance: (r.raw.provenance as RuleProvenance | undefined) ?? null,
            ruleset: clonePlainData(r.response.ruleset),
          });
        }
        if (problems.length > 0) return { data: null, messages: toMessages() };

        const all = sections.flatMap((s) => s.diagnostics);
        const document: ExplanationDocument = {
          explanationKey: input.explanationKey as string,
          title: typeof input.title === "string" ? input.title : null,
          level: "DETAILED",
          ruleset: ruleset ?? null,
          provenance: docProvenance,
          summary: {
            contributionCount: sections.length,
            errorCount: all.filter((m) => m.severity === "ERROR").length,
            warningCount: all.filter((m) => m.severity === "WARNING").length,
            infoCount: all.filter((m) => m.severity === "INFO").length,
            nodeCount: totalNodes,
          },
          sections,
        };
        const trace: TraceStepInput[] = [
          {
            key: "explanation",
            operation: EXPLANATION_BUILD_KIND,
            children: sections.map((s, i) => ({
              key: `section.${i}`,
              operation: "explanation.section",
              inputs: [
                { name: "contribution_key", value: stringValue(s.sectionKey) },
                { name: "kind", value: stringValue(s.kind) },
                { name: "node_count", value: numberValue(countNodes(s.nodes)) },
              ],
            })),
          },
        ];
        return { data: deepFreeze(document), trace };
      },
    },
    { kind: EXPLANATION_BUILD_KIND, ruleset: options.ruleset ?? null },
  ) as RuleEngineResponse<ExplanationDocument>;
}

/** Counts nodes iteratively (depth is bounded, but recursion is avoided on principle). */
export function countNodes(nodes: readonly ExplanationNode[]): number {
  const stack = [...nodes];
  let n = 0;
  while (stack.length > 0) {
    const node = stack.pop() as ExplanationNode;
    n += 1;
    stack.push(...node.children);
  }
  return n;
}
