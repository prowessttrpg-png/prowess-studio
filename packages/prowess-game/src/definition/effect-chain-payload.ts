import { validateRequirement, type RequirementNode } from "@prowess/rules";
import type { JsonObject } from "@prowess/model";
import { deepFreeze, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, isExactLabel, own, readEnum, readRecord } from "../internal/problems.js";

/**
 * M5-WO12 authored Spell Effect Chain (Core Playtest V0.1 "EFFECT CHAINS": each Effect defines its trigger condition,
 * resolution, success / failure result and whether the chain continues; designer ruling M5-SC-014). Stored on the
 * Spell branch as `effectChain: { failurePolicy, nodes? }`. The WO8 `failurePolicy` stays the chain-wide default for an
 * Effect with no listed behavior (STOP → failure ends the chain = SUCCESS_ONLY; CONTINUE → CONTINUE); an absent
 * `effectChain` is the ruled default (failure ends the chain). Nothing here executes.
 */
export const EFFECT_CHAIN_BEHAVIORS = deepFreeze(["CONTINUE", "SUCCESS_ONLY", "FAILURE_ONLY", "STOP", "BRANCH"] as const);
export type EffectChainBehavior = (typeof EFFECT_CHAIN_BEHAVIORS)[number];
export const EFFECT_CHAIN_FAILURE_POLICIES = deepFreeze(["STOP", "CONTINUE"] as const);
export type EffectChainFailurePolicy = (typeof EFFECT_CHAIN_FAILURE_POLICIES)[number];
/** Chain-local trigger facts: an EARLIER exact Effect Use's result, the delivery result, or an explicit runtime target fact. */
const EFFECT_CHAIN_FACT_PATTERN = /^(chain\.([A-Za-z0-9_-]+)\.(success|failure)|chain\.previous\.(success|failure)|delivery\.(hit|critical)|target\.[a-z][a-z0-9_]*)$/;
/** The WO8 authored-definition code: an invalid chain is an invalid authored Spell. */
const EFFECT_CHAIN_ERROR = "PROWESS_ABILITY.INVALID_DEFINITION";

export interface EffectChainNode {
  readonly effectKey: string;
  readonly behavior: EffectChainBehavior;
  readonly branch: { readonly success: string; readonly failure: string } | null;
  readonly trigger: RequirementNode | null;
}
export interface EffectChainPayload {
  readonly failurePolicy: EffectChainFailurePolicy;
  readonly nodes: readonly EffectChainNode[];
}

const FIELDS = ["effectKey", "behavior", "branch", "trigger"];
const TRIGGER_KINDS = ["NUMERIC_COMPARE", "SET_CONTAINS", "ALL", "ANY", "NONE"];

/** Every fact key a trigger reads, depth-first. */
export function triggerFactKeys(node: RequirementNode): string[] {
  return "children" in node ? node.children.flatMap(triggerFactKeys) : "factKey" in node ? [node.factKey] : [];
}

/**
 * Reads `effectChain` against the Spell's exact ordered Effect Uses. Branch destinations are exact LATER Effect Uses
 * (forward-only, so the graph is acyclic), each owned by at most one branch; triggers are structured M4 requirements over
 * chain-local facts that name only EARLIER Effect Uses. Prose, names and indexes are never routing data.
 */
export function readEffectChain(value: unknown, effects: readonly { readonly componentKey: string; readonly order: number }[], at: readonly PathSegment[], p: Problems): EffectChainPayload | null {
  const before = p.count, E = EFFECT_CHAIN_ERROR;
  const r = readRecord(value, at, p, E, ["failurePolicy", "nodes"], ["failurePolicy"]); if (!r) return null;
  const failurePolicy = readEnum(own(r, "failurePolicy"), EFFECT_CHAIN_FAILURE_POLICIES, [...at, "failurePolicy"], p, E, "structural failure policy");
  const position = new Map(effects.map((e, i) => [e.componentKey, i]));
  const raw = own(r, "nodes") ?? [];
  const nodes: EffectChainNode[] = [];
  if (!Array.isArray(raw)) p.add(E, [...at, "nodes"], "nodes is an array of exact Effect Use chain entries");
  else raw.forEach((x, i) => {
    const a = [...at, "nodes", i];
    const q = readRecord(x, a, p, E, FIELDS, ["effectKey", "behavior"]); if (!q) return;
    const effectKey = own(q, "effectKey");
    if (!isExactLabel(effectKey) || !position.has(effectKey)) { p.add(E, [...a, "effectKey"], "a chain node names an exact Effect Use of this Spell"); return; }
    if (nodes.some((n) => n.effectKey === effectKey)) { p.add(E, [...a, "effectKey"], "one chain entry per Effect Use"); return; }
    const behavior = readEnum(own(q, "behavior"), EFFECT_CHAIN_BEHAVIORS, [...a, "behavior"], p, E, "Chain Behavior");
    let branch: EffectChainNode["branch"] = null;
    const rb = own(q, "branch");
    if (behavior === "BRANCH") {
      const b = readRecord(rb, [...a, "branch"], p, E, ["success", "failure"], ["success", "failure"]);
      if (b) {
        const s = own(b, "success"), f = own(b, "failure");
        for (const [k, v] of [["success", s], ["failure", f]] as const) {
          if (!isExactLabel(v) || !position.has(v)) p.add(E, [...a, "branch", k], "a branch destination is an exact Effect Use of this Spell");
          else if ((position.get(v) as number) <= (position.get(effectKey) as number)) p.add(E, [...a, "branch", k], "a branch destination comes later in authored order: chains are acyclic");
        }
        if (isExactLabel(s) && isExactLabel(f) && s === f) p.add(E, [...a, "branch"], "a branch selects between two different destinations");
        branch = { success: s as string, failure: f as string };
      }
    } else if (rb !== undefined && rb !== null) p.add(E, [...a, "branch"], "only BRANCH declares destinations");
    let trigger: RequirementNode | null = null;
    const rt = own(q, "trigger");
    if (rt !== undefined && rt !== null) {
      const v = validateRequirement(rt);
      const kinds = (n: RequirementNode): boolean => TRIGGER_KINDS.includes(n.kind) && ("children" in n ? n.children.every(kinds) : true);
      if (!v.ok || !isPlainObject(rt)) p.add(E, [...a, "trigger"], "a trigger is a structured M4 requirement; prose is never executable");
      else if (!kinds(v.requirement)) p.add(E, [...a, "trigger"], "a trigger uses NUMERIC_COMPARE / SET_CONTAINS / ALL / ANY / NONE only");
      else {
        for (const factKey of triggerFactKeys(v.requirement)) {
          const m = EFFECT_CHAIN_FACT_PATTERN.exec(factKey);
          if (!m) p.add(E, [...a, "trigger"], `unknown chain fact ${factKey}`);
          else if (m[2] !== undefined && (!position.has(m[2]) || (position.get(m[2]) as number) >= (position.get(effectKey) as number))) p.add(E, [...a, "trigger"], `a trigger reads only an EARLIER exact Effect Use (${factKey})`);
        }
        trigger = v.requirement;
      }
    }
    if (behavior) nodes.push({ effectKey, behavior, branch, trigger });
  });
  const owners = new Map<string, string>();
  for (const n of nodes) if (n.branch) for (const d of [n.branch.success, n.branch.failure]) {
    if (owners.has(d) && owners.get(d) !== n.effectKey) p.add(E, [...at, "nodes"], `Effect Use ${d} is the destination of more than one branch`);
    owners.set(d, n.effectKey);
  }
  return p.count > before || failurePolicy === null ? null : { failurePolicy, nodes: nodes.sort((x, y) => ((position.get(x.effectKey) as number) < (position.get(y.effectKey) as number) ? -1 : 1)) };
}
export type EffectChainJson = JsonObject;
