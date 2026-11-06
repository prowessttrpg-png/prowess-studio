import type { RequirementNode } from "@prowess/rules";
import type { CompiledTrait } from "../ability/compile.js";
import type { EffectChainBehavior } from "../definition/effect-chain-payload.js";
import type { ExecutionChainNode, ExecutionEffect, ExecutionGroup, ExecutionTermination, SaveFlow } from "../ability/effect-execution.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { clonePlainData, deepFreeze } from "../internal/plain-data.js";

/**
 * PAS-10 M6-WO9 — the Card Rules semantic model: a typed, language-free reading of an EXISTING M5-WO12 execution
 * plan (chain nodes / resolution groups) and the compiled Traits. It restates what the engine established — checks,
 * outcome keys, transitions, triggers, delivery — and marks everything it cannot describe faithfully as UNRESOLVED
 * (fail closed). It never reads names, descriptions or narrative intent, and computes no mechanical value.
 *
 * Outcome keys follow M5 exactly: SUCCESS / FAILURE are the EFFECT's result. For a Saving Throw the Effect SUCCEEDS
 * when the defender's save FAILS, and FAILS when the defender's save SUCCEEDS (decision C4; effect-execution.ts).
 */

export interface OperationFact {
  readonly key: string;
  readonly value: unknown;
  /** PARAMETER: the evaluated parameter the authored operation names; AUTHORED: literal authored operation data. */
  readonly from: "PARAMETER" | "AUTHORED";
}
export interface OperationSemantics {
  readonly kind: string;
  readonly facts: readonly OperationFact[];
  /** A parameter the operation names that the evaluation did not supply — the operation is not fully describable. */
  readonly missingParameters: readonly string[];
}
export interface OutcomeSemantics {
  readonly authored: boolean;
  readonly operations: readonly OperationSemantics[];
}
export type CheckSemantics =
  | { readonly kind: "ATTACK_ROLL"; readonly reusesDelivery: boolean }
  | { readonly kind: "SAVING_THROW"; readonly flow: SaveFlow; readonly effectSucceedsWhen: "DEFENDER_SAVE_FAILS"; readonly effectFailsWhen: "DEFENDER_SAVE_SUCCEEDS" }
  | { readonly kind: "AUTOMATIC" }
  | { readonly kind: "GROUP"; readonly groupKey: string }
  | { readonly kind: "UNRESOLVED"; readonly code: string; readonly reason: string };
export type NextSemantics = { readonly kind: "EFFECT"; readonly effectKey: string } | { readonly kind: "END"; readonly termination: ExecutionTermination };
export type ConditionSemantics =
  | { readonly kind: "EFFECT_RESULT"; readonly effectKey: string; readonly result: "SUCCEEDED" | "FAILED"; readonly negated: boolean }
  | { readonly kind: "PREVIOUS_RESULT"; readonly result: "SUCCEEDED" | "FAILED"; readonly negated: boolean }
  | { readonly kind: "DELIVERY"; readonly fact: "HIT" | "CRITICAL"; readonly negated: boolean }
  | { readonly kind: "TARGET_FACT"; readonly factKey: string; readonly operator: string; readonly expected: number }
  | { readonly kind: "ALL" | "ANY" | "NONE"; readonly children: readonly ConditionSemantics[] }
  | { readonly kind: "UNDESCRIBED"; readonly requirement: RequirementNode };
export interface ChainStepSemantics {
  readonly effectKey: string;
  readonly effect: ProwessDefinitionRef;
  readonly family: string;
  /** 1-based position in the authored order (presentation only). */
  readonly position: string;
  readonly branchDestination: boolean;
  readonly trigger: ConditionSemantics | null;
  /** Where a false trigger goes: NOT_TRIGGERED is never a failure; the chain moves on. */
  readonly notTriggered: NextSemantics | null;
  readonly check: CheckSemantics;
  /** A Trait's RESOLUTION modification that set this check (exact Trait), when one did. */
  readonly checkSetBy: ProwessDefinitionRef | null;
  readonly onEffectSuccess: OutcomeSemantics;
  readonly onEffectFailure: OutcomeSemantics;
  readonly behavior: EffectChainBehavior;
  readonly behaviorSource: string;
  readonly afterSuccess: NextSemantics;
  readonly afterFailure: NextSemantics;
  readonly traits: readonly ProwessDefinitionRef[];
}
/** Decision C2: a presentation hook for an explicit target-selection restriction. No M5 Trait expresses one yet, so
 * production projections never supply it; only test presentation fixtures do. */
export interface TargetSelectionHook {
  readonly kind: "SELECTED_CREATURES_ONLY";
  readonly source: ProwessDefinitionRef;
}
export interface TargetSemantics {
  readonly kind: string;
  readonly count: number | null;
  readonly selection: TargetSelectionHook | null;
  /** Exact compiled TARGETING_MEASURE Trait changes (the Trait, measure, operation and selected value). */
  readonly measureChanges: readonly { readonly trait: ProwessDefinitionRef; readonly measure: string; readonly operation: string; readonly selected: number | string | boolean | null }[];
}
export interface UnresolvedSemantics {
  readonly code: string;
  readonly message: string;
}
export interface SpellChainRules {
  readonly kind: "SPELL_CHAIN";
  readonly targets: TargetSemantics;
  /** Each target resolves its own independent chain (M5-WO12). */
  readonly perTarget: true;
  readonly delivery: { readonly check: string; readonly reusedBy: readonly string[]; readonly onMiss: "NOT_DELIVERED" } | null;
  readonly start: string | null;
  readonly steps: readonly ChainStepSemantics[];
  readonly unresolved: readonly UnresolvedSemantics[];
}
export interface GroupEffectSemantics {
  readonly effectKey: string;
  readonly effect: ProwessDefinitionRef;
  readonly family: string;
  readonly position: string;
  readonly check: CheckSemantics;
  readonly onEffectSuccess: OutcomeSemantics;
  readonly onEffectFailure: OutcomeSemantics;
  readonly traits: readonly ProwessDefinitionRef[];
}
export interface ResolutionGroupSemantics {
  readonly groupKey: string;
  readonly kind: ExecutionGroup["kind"];
  readonly position: string;
  readonly actionKeys: readonly string[];
  readonly attack: ProwessDefinitionRef | null;
  /** The group's ONE runtime resolution — never shared with another group. */
  readonly check: { readonly kind: "ATTACK_ROLL" } | { readonly kind: "SAVING_THROW"; readonly replacedBy: string; readonly flow: SaveFlow } | { readonly kind: "NONE" };
  /** One target per resolution unless an exact attached Targeting Conversion widens it (null). */
  readonly targetLimit: number | null;
  readonly effects: readonly GroupEffectSemantics[];
}
export interface ManeuverGroupRules {
  readonly kind: "MANEUVER_GROUPS";
  /** Each group resolves independently; Maneuver Actions are never one Spell Effect Chain. */
  readonly groups: readonly ResolutionGroupSemantics[];
  readonly unresolved: readonly UnresolvedSemantics[];
}
export type CardRulesModel = SpellChainRules | ManeuverGroupRules;

/** "1", "2", … for an ordered list — positions are labels (no arithmetic over mechanics). */
function positionsOf<T>(list: readonly T[]): readonly string[] {
  return Object.keys(["", ...list]).slice(1);
}

function operationOf(op: { readonly kind: string; readonly data: Readonly<Record<string, unknown>> }, parameters: ExecutionEffect["parameters"]): OperationSemantics {
  const facts: OperationFact[] = [];
  const missing: string[] = [];
  for (const [key, value] of Object.entries(op.data)) {
    const named = key.endsWith("Parameter") && typeof value === "string";
    if (!named) {
      facts.push({ key, value, from: "AUTHORED" });
      continue;
    }
    const found = parameters.find((q) => q.parameter === value);
    if (found === undefined) missing.push(value);
    else facts.push({ key: key.slice(0, key.indexOf("Parameter")), value: found.value, from: "PARAMETER" });
  }
  return { kind: op.kind, facts, missingParameters: missing };
}

function outcomeOf(e: ExecutionEffect, key: "SUCCESS" | "FAILURE"): OutcomeSemantics {
  const reading = e.outcomes.find((o) => o.outcomeKey === key);
  return reading === undefined ? { authored: false, operations: [] } : { authored: true, operations: reading.operations.map((op) => operationOf(op, e.parameters)) };
}

function checkOf(e: ExecutionEffect, unresolved: UnresolvedSemantics[]): CheckSemantics {
  if (e.route === "DELIVERY_ATTACK") return { kind: "ATTACK_ROLL", reusesDelivery: true };
  if (e.resolution === "ATTACK_ROLL") return { kind: "ATTACK_ROLL", reusesDelivery: false };
  if (e.resolution === "SAVING_THROW") {
    if (e.throwFlow === null) {
      unresolved.push({ code: "M5-SC-050", message: `${e.effectKey}: the Saving Throw has no executable Save flow` });
      return { kind: "UNRESOLVED", code: "M5-SC-050", reason: "no executable Save flow" };
    }
    return { kind: "SAVING_THROW", flow: e.throwFlow, effectSucceedsWhen: "DEFENDER_SAVE_FAILS", effectFailsWhen: "DEFENDER_SAVE_SUCCEEDS" };
  }
  return { kind: "AUTOMATIC" };
}

const resultFlag = (expected: number, operator: string): { negated: boolean } | null => {
  if (operator === "==" && expected === 1) return { negated: false };
  if (operator === "==" && expected === 0) return { negated: true };
  if (operator === "!=" && expected === 0) return { negated: false };
  if (operator === "!=" && expected === 1) return { negated: true };
  return null;
};

/** Reads an M5-WO12 trigger Requirement into conditions over the chain-local / delivery / explicit target facts. */
export function conditionOf(node: RequirementNode): ConditionSemantics {
  if (node.kind === "ALL" || node.kind === "ANY" || node.kind === "NONE") return { kind: node.kind, children: node.children.map(conditionOf) };
  if (node.kind !== "NUMERIC_COMPARE") return { kind: "UNDESCRIBED", requirement: node };
  const parts = node.factKey.split(".");
  if (parts[0] === "target" && parts.length > 1) return { kind: "TARGET_FACT", factKey: node.factKey, operator: node.operator, expected: node.expected };
  const flag = resultFlag(node.expected, node.operator);
  if (flag === null) return { kind: "UNDESCRIBED", requirement: node };
  if (parts[0] === "delivery" && parts.length === 2 && (parts[1] === "hit" || parts[1] === "critical")) return { kind: "DELIVERY", fact: parts[1] === "hit" ? "HIT" : "CRITICAL", ...flag };
  if (parts[0] === "chain" && parts.length === 3 && (parts[2] === "success" || parts[2] === "failure")) {
    const result = parts[2] === "success" ? "SUCCEEDED" : "FAILED";
    return parts[1] === "previous" ? { kind: "PREVIOUS_RESULT", result, ...flag } : { kind: "EFFECT_RESULT", effectKey: parts[1]!, result, ...flag };
  }
  return { kind: "UNDESCRIBED", requirement: node };
}

const nextOf = (successor: string | null): NextSemantics => (successor === null ? { kind: "END", termination: "END_OF_CHAIN" } : { kind: "EFFECT", effectKey: successor });

function transitionsOf(n: ExecutionChainNode): { afterSuccess: NextSemantics; afterFailure: NextSemantics } {
  const forward = nextOf(n.successor);
  switch (n.behavior) {
    case "STOP":
      return { afterSuccess: { kind: "END", termination: "STOP" }, afterFailure: { kind: "END", termination: "STOP" } };
    case "SUCCESS_ONLY":
      return { afterSuccess: forward, afterFailure: { kind: "END", termination: "SUCCESS_ONLY_FAILURE" } };
    case "FAILURE_ONLY":
      return { afterSuccess: { kind: "END", termination: "FAILURE_ONLY_SUCCESS" }, afterFailure: forward };
    case "BRANCH":
      return n.branch === null ? { afterSuccess: forward, afterFailure: forward } : { afterSuccess: { kind: "EFFECT", effectKey: n.branch.success }, afterFailure: { kind: "EFFECT", effectKey: n.branch.failure } };
    default:
      return { afterSuccess: forward, afterFailure: forward };
  }
}

const traitRefsFor = (traits: readonly CompiledTrait[], keys: readonly string[]) => traits.filter((t) => keys.includes(t.componentKey)).map((t) => t.definition);
const resolutionSetter = (traits: readonly CompiledTrait[], effectKey: string): ProwessDefinitionRef | null =>
  traits.flatMap((t) => t.modifications).filter((m) => m.modification.kind === "RESOLUTION" && m.targetComponentKey === effectKey).map((m) => m.definition).at(-1) ?? null;

export interface SpellRulesInput {
  readonly chain: { readonly start: string | null; readonly nodes: readonly ExecutionChainNode[] };
  readonly delivery: { readonly check: string } | null;
  readonly targets: { readonly kind: string; readonly count: number | null };
  readonly traits: readonly CompiledTrait[];
  readonly targetSelection?: TargetSelectionHook | null;
}

/** The Spell chain, step by step, exactly as the M5-WO12 plan routes it (per target). */
export function spellRulesOf(input: SpellRulesInput): SpellChainRules {
  const unresolved: UnresolvedSemantics[] = [];
  const nodes = input.chain.nodes;
  const positions = positionsOf(nodes);
  const steps = nodes.map((n, i): ChainStepSemantics => ({
    effectKey: n.effectKey,
    effect: n.definition,
    family: n.family,
    position: positions[i]!,
    branchDestination: n.branchDestination,
    trigger: n.trigger === null ? null : conditionOf(n.trigger),
    notTriggered: n.trigger === null ? null : nextOf(n.successor),
    check: checkOf(n, unresolved),
    checkSetBy: resolutionSetter(input.traits, n.effectKey),
    onEffectSuccess: outcomeOf(n, "SUCCESS"),
    onEffectFailure: outcomeOf(n, "FAILURE"),
    behavior: n.behavior,
    behaviorSource: n.behaviorSource,
    ...transitionsOf(n),
    traits: traitRefsFor(input.traits, n.traits),
  }));
  for (const s of steps) if (s.trigger !== null && hasUndescribed(s.trigger)) unresolved.push({ code: "CARD.UNDESCRIBED_TRIGGER", message: `${s.effectKey}: the trigger requirement has no faithful wording; see the Rules Inspector` });
  for (const s of steps) for (const op of [...s.onEffectSuccess.operations, ...s.onEffectFailure.operations]) for (const m of op.missingParameters) unresolved.push({ code: "CARD.MISSING_PARAMETER", message: `${s.effectKey}: ${op.kind} names parameter ${m}, which the evaluation does not supply` });
  const measureChanges = input.traits.flatMap((t) => t.modifications.filter((m) => m.modification.kind === "TARGETING_MEASURE").map((m) => ({ trait: m.definition, measure: (m.modification as { measure: string }).measure, operation: (m.modification as { operation: string }).operation, selected: m.selected })));
  return deepFreeze(
    clonePlainData({
      kind: "SPELL_CHAIN" as const,
      targets: { kind: input.targets.kind, count: input.targets.count, selection: input.targetSelection ?? null, measureChanges },
      perTarget: true as const,
      delivery: input.delivery === null ? null : { check: input.delivery.check, reusedBy: nodes.filter((n) => n.route === "DELIVERY_ATTACK").map((n) => n.effectKey), onMiss: "NOT_DELIVERED" as const },
      start: input.chain.start,
      steps,
      unresolved,
    }),
  );
}

function hasUndescribed(c: ConditionSemantics): boolean {
  if (c.kind === "UNDESCRIBED") return true;
  if (c.kind === "ALL" || c.kind === "ANY" || c.kind === "NONE") return c.children.some(hasUndescribed);
  return false;
}

/**
 * The exact delivery a Spell plan carries, read from M5's own per-Effect delivery interaction: M5 sets a non-NONE
 * interaction exactly when the shared Targeting imposes a delivery check (effect/compile.ts), and the plan's delivery
 * is that check (effect-execution.ts). Used where only the chain is retained (the Character Spell evaluation).
 */
export function spellDeliveryOf(chain: { readonly nodes: readonly ExecutionChainNode[] }): { readonly check: "RANGED_ATTACK_ROLL" } | null {
  const first = chain.nodes[0];
  return first !== undefined && first.deliveryInteraction !== "NONE" ? { check: "RANGED_ATTACK_ROLL" } : null;
}

export interface ManeuverRulesInput {
  readonly groups: readonly ExecutionGroup[];
  readonly traits: readonly CompiledTrait[];
}

/** The Maneuver's independent resolution groups (Powerful Blow constituents resolve ONCE together). */
export function maneuverRulesOf(input: ManeuverRulesInput): ManeuverGroupRules {
  const unresolved: UnresolvedSemantics[] = [];
  const groupPositions = positionsOf(input.groups);
  const groups = input.groups.map((g, gi): ResolutionGroupSemantics => {
    const positions = positionsOf(g.effects);
    return {
      groupKey: g.groupKey,
      kind: g.kind,
      position: groupPositions[gi]!,
      actionKeys: g.actionKeys,
      attack: g.attack,
      check: g.resolution.mode === "SAVING_THROW" ? { kind: "SAVING_THROW", replacedBy: g.resolution.replacedBy, flow: g.resolution.flow } : g.resolution.mode === "ATTACK_ROLL" ? { kind: "ATTACK_ROLL" } : { kind: "NONE" },
      targetLimit: g.targetLimit,
      effects: g.effects.map((e, ei) => ({
        effectKey: e.effectKey,
        effect: e.definition,
        family: e.family,
        position: positions[ei]!,
        check: e.route === "GROUP" ? { kind: "GROUP", groupKey: g.groupKey } : checkOf(e, unresolved),
        onEffectSuccess: outcomeOf(e, "SUCCESS"),
        onEffectFailure: outcomeOf(e, "FAILURE"),
        traits: traitRefsFor(input.traits, e.traits),
      })),
    };
  });
  for (const g of groups) for (const e of g.effects) for (const op of [...e.onEffectSuccess.operations, ...e.onEffectFailure.operations]) for (const m of op.missingParameters) unresolved.push({ code: "CARD.MISSING_PARAMETER", message: `${e.effectKey}: ${op.kind} names parameter ${m}, which the evaluation does not supply` });
  return deepFreeze(clonePlainData({ kind: "MANEUVER_GROUPS" as const, groups, unresolved }));
}
