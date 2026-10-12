import { deepFreeze, isPlainObject, jsonPointer } from "../internal/plain-data.js";
import { diagnostic, FORMULA_DIAGNOSTIC_CODES, type FormulaDiagnostic } from "./diagnostics.js";

/**
 * Formula dependency ordering (PAS-10 M4-WO3 §72–78): a pure helper over caller-supplied nodes only — it never looks
 * anything up in a RulesetContext, M2 or persistence, and nothing is stored.
 *
 * Each node names the exact keys it depends on. The result is ONE deterministic topological order: dependencies
 * before dependents, and whenever several nodes are ready at once the lexically smallest key (UTF-16 code-unit order)
 * goes first. Input order never matters. Failures are explicit and never "repaired":
 *   - a malformed node or duplicate key        → FORMULA.INVALID_DEFINITION
 *   - a dependency on a key not in the graph    → FORMULA.UNKNOWN_DEPENDENCY (never treated as an external variable)
 *   - a cycle (including a self-dependency)     → FORMULA.DEPENDENCY_CYCLE, naming the cycle
 * Repeating the same dependency within one node is harmless (dependencies are a set).
 */
export interface FormulaDependencyNode {
  readonly key: string;
  readonly dependencies: readonly string[];
}

export type FormulaDependencyOrder =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly FormulaDiagnostic[]; readonly cycle: readonly string[] | null };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const MAX_KEY_LENGTH = 200;
const isKey = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_KEY_LENGTH && v.trim() === v;

/** Inserts into an ascending array, keeping it sorted. */
function insertSorted(list: string[], key: string): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (byCodeUnit(list[mid] as string, key) < 0) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, key);
}

export function orderFormulaDependencies(nodes: unknown): FormulaDependencyOrder {
  const fail = (diagnostics: FormulaDiagnostic[], cycle: string[] | null = null): FormulaDependencyOrder => deepFreeze({ ok: false as const, diagnostics, cycle });
  if (!Array.isArray(nodes)) return fail([diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, "dependency nodes must be an array", { path: "" })]);

  // 1. Shape and duplicate keys, in input position order.
  const deps = new Map<string, Set<string>>();
  const shape: FormulaDiagnostic[] = [];
  nodes.forEach((node: unknown, i: number) => {
    if (!isPlainObject(node) || !isKey(node.key) || !Array.isArray(node.dependencies) || !node.dependencies.every(isKey) || Object.keys(node).some((k) => k !== "key" && k !== "dependencies")) {
      shape.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, "a dependency node is { key, dependencies[] } with non-empty string keys", { path: jsonPointer([i]) }));
      return;
    }
    if (deps.has(node.key)) {
      shape.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.INVALID_DEFINITION, `duplicate key "${node.key}"`, { path: jsonPointer([i, "key"]) }));
      return;
    }
    deps.set(node.key, new Set(node.dependencies as string[]));
  });
  if (shape.length > 0) return fail(shape);

  // 2. Unknown dependencies, in sorted (node key, dependency key) order.
  const keys = [...deps.keys()].sort(byCodeUnit);
  const unknown: FormulaDiagnostic[] = [];
  for (const key of keys) {
    for (const dep of [...(deps.get(key) as Set<string>)].sort(byCodeUnit)) {
      if (!deps.has(dep)) unknown.push(diagnostic(FORMULA_DIAGNOSTIC_CODES.UNKNOWN_DEPENDENCY, `"${key}" depends on "${dep}", which is not in the graph`, { path: null }));
    }
  }
  if (unknown.length > 0) return fail(unknown);

  // 3. Kahn's algorithm with a sorted ready list.
  const remaining = new Map<string, number>(keys.map((k) => [k, (deps.get(k) as Set<string>).size]));
  const dependents = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const key of keys) for (const dep of deps.get(key) as Set<string>) (dependents.get(dep) as string[]).push(key);
  const ready = keys.filter((k) => remaining.get(k) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const key = ready.shift() as string;
    order.push(key);
    for (const dependent of dependents.get(key) as string[]) {
      const left = (remaining.get(dependent) as number) - 1;
      remaining.set(dependent, left);
      if (left === 0) insertSorted(ready, dependent);
    }
  }
  if (order.length === keys.length) return deepFreeze({ ok: true as const, order });

  // 4. A cycle remains. Walk deterministically from the smallest unresolved key along its smallest unresolved
  //    dependency until a key repeats; report exactly that cycle.
  const unresolved = new Set(keys.filter((k) => (remaining.get(k) as number) > 0));
  const path: string[] = [];
  const index = new Map<string, number>();
  let current = [...unresolved].sort(byCodeUnit)[0] as string;
  while (!index.has(current)) {
    index.set(current, path.length);
    path.push(current);
    current = [...(deps.get(current) as Set<string>)].filter((d) => unresolved.has(d)).sort(byCodeUnit)[0] as string;
  }
  const cycle = [...path.slice(index.get(current) as number), current];
  return fail([diagnostic(FORMULA_DIAGNOSTIC_CODES.DEPENDENCY_CYCLE, `dependency cycle: ${cycle.join(" → ")}`, { path: null })], cycle);
}
