import { DERIVED_STATISTICS, PROWESS_STATS, type ProwessDefinitionBundle, type ProwessDefinitionEnvelope } from "@prowess/game";

/**
 * PRE-M7-WO1 — the rule DEPENDENCY graph of one exact bundle (a published Release, a Manifest, or a Draft candidate).
 *
 * Built only from what the engine reads, never from prose or names:
 *   - a Formula variable's declared source (`{ kind: "STAT", stat }`, `{ kind: "DERIVED", statistic }`,
 *     `{ kind: "CHOSEN_STAT" }`) — exactly the sources the M5 core compiler binds (core/compile.ts);
 *   - a structured field that names a derived statistic (`statistic` / `capacityStatistic` holding a DERIVED_STATISTICS
 *     value) — RESOURCE maxima, targeting ranges, the Signature slot capacity and similar readers.
 * Nodes are ROLES the engine resolves through the role index (one STAT per Stat, one DERIVED_STAT per statistic, one
 * CORE_RESOLUTION per procedure); every edge records the exact owning Definition revision and the authored path.
 *
 * Analysis limits (reported, never guessed): Stat contributions that enter through Character state rather than a rule
 * (Ancestry Stat grants, creation points, advancement) are INPUTS to a Stat, not dependents, and are listed separately;
 * application screens that display a statistic are a documented consumer map, not part of this graph.
 */
export type RuleNodeKey = `STAT:${string}` | `DERIVED:${string}` | `PROCEDURE:${string}` | `DEFINITION:${string}`;

export interface RuleNode {
  readonly key: RuleNodeKey;
  readonly role: "STAT" | "DERIVED_STAT" | "CORE_RESOLUTION" | "DEFINITION";
  /** The Stat, statistic or procedure token; for DEFINITION the canonical key. */
  readonly token: string;
  readonly definition: { readonly entityId: string; readonly entityVersionId: string; readonly canonicalKey: string; readonly definitionKind: string } | null;
}

export interface RuleEdge {
  /** The dependency (what is read). */
  readonly from: RuleNodeKey;
  /** The dependent (the rule that reads it). */
  readonly to: RuleNodeKey;
  readonly via: "FORMULA_VARIABLE" | "CHOSEN_STAT" | "STRUCTURED_FIELD" | "VALUE_CONTRIBUTION";
  /** JSON-pointer-like path inside the dependent's payload. */
  readonly path: string;
  /** The Formula variable name, when the edge is a formula input. */
  readonly variable: string | null;
  /** The authored expression that reads it, when the edge is a formula input. */
  readonly expression: string | null;
}

export interface RuleGraph {
  readonly nodes: ReadonlyMap<RuleNodeKey, RuleNode>;
  readonly edges: readonly RuleEdge[];
}

const DERIVED = new Set<string>(DERIVED_STATISTICS);
const STATS = new Set<string>(PROWESS_STATS);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function nodeOf(e: ProwessDefinitionEnvelope): RuleNode {
  const definition = { entityId: e.entityId, entityVersionId: e.entityVersionId, canonicalKey: e.canonicalKey, definitionKind: e.definitionKind };
  const p = e.payload as Record<string, unknown>;
  if (e.definitionKind === "STAT" && typeof p.stat === "string") return { key: `STAT:${p.stat}`, role: "STAT", token: p.stat, definition };
  if (e.definitionKind === "DERIVED_STAT" && typeof p.statistic === "string") return { key: `DERIVED:${p.statistic}`, role: "DERIVED_STAT", token: p.statistic, definition };
  if (e.definitionKind === "CORE_RESOLUTION" && typeof p.procedure === "string") return { key: `PROCEDURE:${p.procedure}`, role: "CORE_RESOLUTION", token: p.procedure, definition };
  return { key: `DEFINITION:${e.canonicalKey}`, role: "DEFINITION", token: e.canonicalKey, definition };
}

/** A Formula object as the core payload readers define it: `{ expression, rounding, variables: [{ variable, source }] }`. */
function isFormula(v: Record<string, unknown>): v is { expression: string; variables: unknown[] } {
  return typeof v.expression === "string" && Array.isArray(v.variables);
}

export function buildRuleGraph(bundle: Pick<ProwessDefinitionBundle, "definitions">): RuleGraph {
  const nodes = new Map<RuleNodeKey, RuleNode>();
  const edges: RuleEdge[] = [];
  for (const e of bundle.definitions) {
    const n = nodeOf(e);
    nodes.set(n.key, n);
  }
  // Role tokens that are referenced but not defined still get a node, so a missing role is visible (never assumed 0).
  const ensure = (key: RuleNodeKey, role: RuleNode["role"], token: string) => {
    if (!nodes.has(key)) nodes.set(key, { key, role, token, definition: null });
  };
  // RULES-WO1: authored calculated values are addressed by their valueKey (a Formula input `{ kind: "CALCULATED_VALUE",
  // valueKey }`, a Skill benefit contribution's `valueKey`). Each resolves to the exact CALCULATED_VALUE Definition(s)
  // of this bundle that carry that key; an unknown key adds no edge (the M5 evaluator reports it).
  const valueOwners = (valueKey: string): RuleNodeKey[] =>
    bundle.definitions.filter((d) => d.definitionKind === "CALCULATED_VALUE" && (d.payload as { valueKey?: unknown }).valueKey === valueKey).map((d) => nodeOf(d).key);
  for (const e of bundle.definitions) {
    const owner = nodeOf(e).key;
    if (e.definitionKind === "SKILL_BENEFIT") {
      const contributions = (e.payload as { contributions?: unknown }).contributions;
      if (Array.isArray(contributions))
        contributions.forEach((c, i) => {
          if (!isRecord(c) || typeof c.valueKey !== "string") return;
          for (const value of valueOwners(c.valueKey)) edges.push({ from: owner, to: value, via: "VALUE_CONTRIBUTION", path: `/contributions/${String(i)}`, variable: null, expression: null });
        });
    }
    const walk = (v: unknown, path: string): void => {
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${path}/${String(i)}`));
        return;
      }
      if (!isRecord(v)) return;
      if (isFormula(v)) {
        v.variables.forEach((decl, i) => {
          if (!isRecord(decl) || !isRecord(decl.source) || typeof decl.variable !== "string") return;
          const s = decl.source;
          const at = `${path}/variables/${String(i)}`;
          if (s.kind === "STAT" && typeof s.stat === "string" && STATS.has(s.stat)) {
            ensure(`STAT:${s.stat}`, "STAT", s.stat);
            edges.push({ from: `STAT:${s.stat}`, to: owner, via: "FORMULA_VARIABLE", path: at, variable: decl.variable, expression: v.expression });
          } else if (s.kind === "DERIVED" && typeof s.statistic === "string" && DERIVED.has(s.statistic)) {
            ensure(`DERIVED:${s.statistic}`, "DERIVED_STAT", s.statistic);
            edges.push({ from: `DERIVED:${s.statistic}`, to: owner, via: "FORMULA_VARIABLE", path: at, variable: decl.variable, expression: v.expression });
          } else if (s.kind === "CALCULATED_VALUE" && typeof s.valueKey === "string") {
            for (const value of valueOwners(s.valueKey)) edges.push({ from: value, to: owner, via: "FORMULA_VARIABLE", path: at, variable: decl.variable, expression: v.expression });
          } else if (s.kind === "CHOSEN_STAT") {
            for (const stat of PROWESS_STATS) {
              ensure(`STAT:${stat}`, "STAT", stat);
              edges.push({ from: `STAT:${stat}`, to: owner, via: "CHOSEN_STAT", path: at, variable: decl.variable, expression: v.expression });
            }
          }
        });
      }
      for (const [k, x] of Object.entries(v)) {
        if ((k === "statistic" || k === "capacityStatistic") && typeof x === "string" && DERIVED.has(x)) {
          // A DERIVED_STAT's own `statistic` names ITSELF (its role), never a dependency.
          if (!(e.definitionKind === "DERIVED_STAT" && path === "" && k === "statistic")) {
            ensure(`DERIVED:${x}`, "DERIVED_STAT", x);
            // Formula variable sources are handled above; only structured readers are added here.
            if ((v as Record<string, unknown>).kind !== "DERIVED") edges.push({ from: `DERIVED:${x}`, to: owner, via: "STRUCTURED_FIELD", path: `${path}/${k}`, variable: null, expression: null });
          }
        }
        if (typeof x === "object" && x !== null) walk(x, `${path}/${k}`);
      }
    };
    walk(e.payload, "");
  }
  return { nodes, edges };
}

export interface Impact {
  readonly node: RuleNode;
  /** 1 = reads the Stat directly; 2+ = through the derived statistics on `through`. */
  readonly depth: number;
  /** The chain of intermediate nodes from the Stat to this dependent (exclusive of both ends). */
  readonly through: readonly RuleNode[];
  /** The edges by which this dependent reads its immediate dependency on the chain. */
  readonly edges: readonly RuleEdge[];
}

/** Everything that depends on `start`, breadth-first: direct dependents first, then indirect ones with their path. */
export function dependentsOf(graph: RuleGraph, start: RuleNodeKey): Impact[] {
  const out: Impact[] = [];
  const seen = new Set<RuleNodeKey>([start]);
  let frontier: Array<{ key: RuleNodeKey; through: RuleNode[] }> = [{ key: start, through: [] }];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: Array<{ key: RuleNodeKey; through: RuleNode[] }> = [];
    for (const f of frontier) {
      const byTarget = new Map<RuleNodeKey, RuleEdge[]>();
      for (const e of graph.edges) if (e.from === f.key) byTarget.set(e.to, [...(byTarget.get(e.to) ?? []), e]);
      for (const [to, es] of [...byTarget.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (seen.has(to)) continue;
        seen.add(to);
        const node = graph.nodes.get(to);
        if (node === undefined) continue;
        out.push({ node, depth, through: f.through, edges: es });
        next.push({ key: to, through: [...f.through, node] });
      }
    }
    frontier = next;
  }
  return out;
}

/** The direct dependencies a node reads (its inputs), for the rule page. */
export function dependenciesOf(graph: RuleGraph, key: RuleNodeKey): RuleEdge[] {
  return graph.edges.filter((e) => e.to === key);
}

/**
 * A cycle among derived statistics, if any (the M4 dependency order refuses one at compile time; this reports it
 * with names before anything is saved or proposed).
 */
export function derivedCycle(graph: RuleGraph): RuleNodeKey[] | null {
  const adj = new Map<RuleNodeKey, RuleNodeKey[]>();
  for (const e of graph.edges) if (e.from.startsWith("DERIVED:") && e.to.startsWith("DERIVED:")) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const state = new Map<RuleNodeKey, 1 | 2>();
  const stack: RuleNodeKey[] = [];
  const visit = (n: RuleNodeKey): RuleNodeKey[] | null => {
    if (state.get(n) === 2) return null;
    if (state.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const c = visit(m);
      if (c !== null) return c;
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of adj.keys()) {
    const c = visit(n);
    if (c !== null) return c;
  }
  return null;
}
