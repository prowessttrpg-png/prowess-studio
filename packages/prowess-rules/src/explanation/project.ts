import { evaluate } from "../evaluation/evaluate.js";
import { inspectPlainData, isPlainObject } from "../internal/plain-data.js";
import type { RuleEngineResponse } from "../result/rule-engine-response.js";
import { validationMessage } from "../validation/validation-message.js";
import { EXPLANATION_DIAGNOSTIC_CODES, EXPLANATION_LEVELS, EXPLANATION_LIMITS, type ExplanationDocument, type ExplanationLevel, type ExplanationNode, type ExplanationStatus } from "./model.js";

/**
 * projectExplanation (PAS-10 M4-WO9 §17–20, §60, §91–97): a deterministic view of a canonical DETAILED document.
 *
 * Projection only FILTERS — it never adds, re-orders, recomputes or rewrites anything, so a SUMMARY is always a subset
 * of the DETAILED document it came from (same node ids, same fields). SUMMARY keeps every section with its status,
 * facts and diagnostics (failures and warnings stay visible), the top two trace levels, and any deeper node that failed,
 * was not satisfied / not applied / unavailable, or produced a diagnostic — together with its ancestors. Each kept node
 * reports how many direct children were omitted. DETAILED returns the document unchanged (a detached copy).
 */
const SUMMARY_DEPTH = 2;
const ALWAYS_KEEP: ReadonlySet<ExplanationStatus> = new Set(["INVALID", "ENGINE_FAILURE", "NOT_SATISFIED", "NOT_APPLIED", "PAYMENT_UNAVAILABLE", "FAIL"]);
const NODE_FIELDS = [
  "nodeId",
  "explanationPath",
  "sourceContributionKey",
  "sourceTracePath",
  "sourceTraceOrdinal",
  "key",
  "operation",
  "phase",
  "status",
  "label",
  "inputs",
  "output",
  "provenance",
  "modifierSource",
  "relatedDiagnosticOrdinals",
  "omittedChildCount",
  "children",
];
const DOCUMENT_FIELDS = ["explanationKey", "title", "level", "ruleset", "provenance", "summary", "sections"];

const exact = (candidate: unknown, fields: readonly string[]): candidate is Record<string, unknown> =>
  isPlainObject(candidate) && Object.keys(candidate).length === fields.length && Object.keys(candidate).filter((k) => !fields.includes(k)).length === 0;

/** Filters one section's node forest iteratively. */
function filterNodes(roots: readonly ExplanationNode[], level: ExplanationLevel): ExplanationNode[] {
  type Entry = { node: ExplanationNode; parent: number; depth: number };
  const entries: Entry[] = [];
  const stack: { node: ExplanationNode; parent: number; depth: number }[] = [...roots].reverse().map((node) => ({ node, parent: -1, depth: 1 }));
  while (stack.length > 0) {
    const e = stack.pop() as Entry;
    const index = entries.push(e) - 1;
    for (let i = e.node.children.length - 1; i >= 0; i -= 1) stack.push({ node: e.node.children[i] as ExplanationNode, parent: index, depth: e.depth + 1 });
  }
  const keep = entries.map(
    (e) => level === "DETAILED" || e.depth <= SUMMARY_DEPTH || (e.node.status !== null && ALWAYS_KEEP.has(e.node.status)) || e.node.relatedDiagnosticOrdinals.length > 0,
  );
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const parent = (entries[i] as Entry).parent;
    if (keep[i] && parent >= 0) keep[parent] = true; // ancestors of a kept node are kept
  }
  // Rebuild kept nodes in pre-order (original relative order), attaching each to its kept parent copy.
  type Built = Omit<ExplanationNode, "children" | "omittedChildCount"> & { children: Built[]; omittedChildCount: number };
  const built: (Built | null)[] = entries.map(() => null);
  const out: Built[] = [];
  entries.forEach((e, i) => {
    if (!keep[i]) return;
    const { children: _children, omittedChildCount: _omitted, ...fields } = e.node;
    void _children;
    void _omitted;
    const copy: Built = { ...fields, children: [], omittedChildCount: 0 };
    built[i] = copy;
    const parent = e.parent >= 0 ? (built[e.parent] ?? null) : null;
    if (parent === null) out.push(copy);
    else parent.children.push(copy);
  });
  entries.forEach((e, i) => {
    const copy = built[i];
    if (copy !== null && copy !== undefined) copy.omittedChildCount = e.node.omittedChildCount + (e.node.children.length - copy.children.length);
  });
  return out as unknown as ExplanationNode[];
}

/** The evaluation kind `projectExplanation` uses on the M4-WO1 boundary. */
export const EXPLANATION_PROJECT_KIND = "explanation.project";

/** Projects a DETAILED ExplanationDocument to `level`. Pure; the input document is never changed. */
export function projectExplanation(document: unknown, level: ExplanationLevel): RuleEngineResponse<ExplanationDocument> {
  return evaluate<ExplanationDocument | null>(
    {
      kind: EXPLANATION_PROJECT_KIND,
      evaluate: () => {
        const invalid = (message: string) => ({
          data: null,
          messages: [validationMessage({ severity: "ERROR", category: "STRUCTURE", code: EXPLANATION_DIAGNOSTIC_CODES.INVALID_INPUT, message, path: "" })],
        });
        if (!(EXPLANATION_LEVELS as readonly unknown[]).includes(level)) return invalid(`level must be one of ${EXPLANATION_LEVELS.join(", ")}`);
        let plain = false;
        try {
          plain = inspectPlainData(document).length === 0;
        } catch {
          plain = false;
        }
        if (!plain || !exact(document, DOCUMENT_FIELDS) || document.level !== "DETAILED" || !Array.isArray(document.sections)) {
          return invalid("projection takes a canonical DETAILED ExplanationDocument (plain data)");
        }
        // Shape check of every node, iteratively, before filtering.
        const stack: { node: unknown; depth: number }[] = [];
        for (const s of document.sections as unknown[]) {
          if (!isPlainObject(s) || !Array.isArray(s.nodes)) return invalid("every section needs a nodes array");
          for (const n of s.nodes as unknown[]) stack.push({ node: n, depth: 1 });
        }
        let count = 0;
        while (stack.length > 0) {
          const { node, depth } = stack.pop() as { node: unknown; depth: number };
          count += 1;
          if (count > EXPLANATION_LIMITS.MAX_TOTAL_NODES || depth > EXPLANATION_LIMITS.MAX_TRACE_DEPTH) return invalid("the document exceeds the explanation limits");
          if (!exact(node, NODE_FIELDS) || !Array.isArray(node.children) || !Array.isArray(node.relatedDiagnosticOrdinals) || typeof node.omittedChildCount !== "number") {
            return invalid("malformed explanation node");
          }
          for (const c of node.children as unknown[]) stack.push({ node: c, depth: depth + 1 });
        }
        const doc = document as unknown as ExplanationDocument;
        return {
          data: {
            ...doc,
            level,
            sections: doc.sections.map((s) => ({ ...s, nodes: filterNodes(s.nodes, level) })),
          },
        };
      },
    },
    { kind: EXPLANATION_PROJECT_KIND },
  ) as RuleEngineResponse<ExplanationDocument>;
}
