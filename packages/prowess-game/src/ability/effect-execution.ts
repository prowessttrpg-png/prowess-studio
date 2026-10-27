import type { JsonObject } from "@prowess/model";
import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationPlan, type RequirementNode } from "@prowess/rules";
import { createProwessDefinitionBundle, type ProwessDefinitionBundle, type ProwessRulesetProvenance, createBundleWithinCheckedRequest } from "../bundle/bundle.js";
import { buildCoreResolutionContexts, compileCoreResolution } from "../core/compile.js";
import type { AbilityConstructionRulePayload } from "../definition/ability-construction-payload.js";
import { isAttackFoundation, type ManeuverDefinitionPayload, type SpellDefinitionPayload } from "../definition/authored-ability-payload.js";
import { readEffectChain, triggerFactKeys, type EffectChainBehavior } from "../definition/effect-chain-payload.js";
import type { EffectExecutionPolicy, MartialSaveControl } from "../definition/effect-execution-policy.js";
import type { EffectOutcomeReading } from "../definition/effect-payload.js";
import { definitionRefOf, type ProwessDefinitionRef } from "../definition/envelope.js";
import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactLabel, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { compileAbilityDefinition, readAbilityDefinitionRun, type AuthoredAbilityResult } from "./compile.js";

/**
 * M5-WO12 EFFECT CHAIN EXECUTION & RUNTIME RESOLUTION ROUTING. Two stages over the canonical authored Ability (WO8):
 *
 *   compileAbilityExecution(request)   exact authored Ability → an execution plan: Spell chain nodes (exact Effect Uses,
 *                                      Chain Behavior, branch destinations, structured triggers, resolution contract,
 *                                      SUCCESS / FAILURE outcomes) or Maneuver resolution groups (Attack / Powerful Blow /
 *                                      action) with their attached Effects;
 *   executeAbilityResolution(request)  the plan + explicit runtime inputs (dice results, Save choices, target facts) →
 *                                      a deterministic per-target trace of statuses, transitions, terminations and
 *                                      ordered RESOLVED OUTCOME records.
 *
 * Attack Rolls and Saving Throws run through the permanent WO2 core-resolution plans on M4 from explicit roll inputs; chain
 * triggers run as M4 REQUIREMENT steps over chain-local facts. Nothing is rolled here, nothing is guessed, nothing is
 * applied: outcomes are inert structured intent (no HP / Armor / position / Status Condition / resource mutation). Sustain,
 * Mana Lock, Concentration and Active Effects are WO13; dynamic Metamagic and activation triggers are out of scope.
 */
export const EFFECT_EXECUTION_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "PROWESS_EXECUTION.INVALID_REQUEST",
  /** The authored Ability did not compile / evaluate VALID: there is nothing exact to execute. */
  INVALID_ABILITY: "PROWESS_EXECUTION.INVALID_ABILITY",
  /** The exact Ruleset pins no execution policy (default chain behavior, Martial Save control). */
  MISSING_POLICY: "PROWESS_EXECUTION.MISSING_POLICY",
  /** Content whose runtime routing is not exactly structured (a recorded M5 conflict): fail closed. */
  UNRESOLVED_RUNTIME_RULE: "PROWESS_EXECUTION.UNRESOLVED_RUNTIME_RULE",
  INVALID_TARGETS: "PROWESS_EXECUTION.INVALID_TARGETS",
  /** An input that names no request this plan can make, or belongs to another plan / target / Effect / kind. */
  UNKNOWN_INPUT: "PROWESS_EXECUTION.UNKNOWN_INPUT",
  /** A well-addressed input whose value is illegal (a Save outside the legal options, a roll the die cannot produce). */
  INVALID_INPUT: "PROWESS_EXECUTION.INVALID_INPUT",
});
const K = EFFECT_EXECUTION_ERROR_CODES;

export type ExecutionResolution = "ATTACK_ROLL" | "SAVING_THROW" | "AUTOMATIC";
export type ExecutionNodeStatus = "PENDING_INPUT" | "NOT_REACHED" | "NOT_TRIGGERED" | "NOT_DELIVERED" | "EXECUTED_SUCCESS" | "EXECUTED_FAILURE";
export type ExecutionTermination = "END_OF_CHAIN" | "STOP" | "SUCCESS_ONLY_FAILURE" | "FAILURE_ONLY_SUCCESS" | "DELIVERY_FAILED" | "BRANCH_END" | "NO_REACHABLE_EFFECT" | "INVALID_RUNTIME_PATH";
export type ExecutionInputKind = "ATTACK_ROLL" | "SAVING_THROW" | "SAVE_REMOVAL" | "SAVE_SELECTION";
/** A pending request may also be an explicit runtime target fact a trigger reads (supplied with the target, never guessed). */
export type ExecutionRequestKind = ExecutionInputKind | "TARGET_FACT";
export type SaveFlow = { readonly kind: "FIXED"; readonly stat: string } | { readonly kind: "DEFENDER_CHOOSES" | "ATTACKER_REMOVES_ONE" | "ATTACKER_CHOOSES"; readonly stats: readonly string[] };

export interface ExecutionEffect {
  readonly effectKey: string;
  readonly order: number;
  readonly definition: ProwessDefinitionRef;
  readonly family: string;
  readonly resolution: ExecutionResolution;
  /** How this Effect obtains its result: its own check, the reused delivery Attack, or its owning group's resolution. */
  readonly route: "OWN" | "DELIVERY_ATTACK" | "GROUP";
  readonly attackType: string | null;
  readonly throwFlow: SaveFlow | null;
  readonly deliveryInteraction: string;
  readonly outcomes: readonly EffectOutcomeReading[];
  readonly parameters: readonly { readonly parameter: string; readonly value: unknown }[];
  readonly formulaValues: readonly { readonly formulaKey: string; readonly value: number; readonly unit: string | null }[];
  readonly traits: readonly string[];
}
export interface ExecutionChainNode extends ExecutionEffect {
  readonly behavior: EffectChainBehavior;
  /** Where the listed behavior came from: the authored node, the authored chain default, or the ruled default (M5-SC-014). */
  readonly behaviorSource: "AUTHORED" | "CHAIN_FAILURE_POLICY" | "RULED_DEFAULT";
  readonly branch: { readonly success: string; readonly failure: string } | null;
  readonly trigger: RequirementNode | null;
  /** The next authored Effect Use that is not a branch destination (null at the end of the chain). */
  readonly successor: string | null;
  readonly branchDestination: boolean;
}
export interface ExecutionGroup {
  readonly groupKey: string;
  readonly kind: "ATTACK" | "POWERFUL_BLOW" | "ACTION";
  readonly actionKeys: readonly string[];
  readonly attack: ProwessDefinitionRef | null;
  /** The group's ONE runtime resolution: its Attack Roll, a replacing Martial Save, or none (a non-attack action). */
  readonly resolution: { readonly mode: "ATTACK_ROLL" } | { readonly mode: "SAVING_THROW"; readonly replacedBy: string; readonly flow: SaveFlow } | { readonly mode: "NONE" };
  readonly effects: readonly ExecutionEffect[];
  /** One target per resolution unless an attached exact Targeting Conversion (Sweep, Line, Cone …) widens it. */
  readonly targetLimit: number | null;
}
export interface ProwessAbilityExecutionPlan {
  readonly contractVersion: 1;
  readonly subject: { readonly kind: "ABILITY_EXECUTION"; readonly subjectKey: string; readonly abilityKind: "SPELL" | "MANEUVER" };
  /** Binds every runtime input to THIS plan: Ruleset, manifest, exact Ability version and subject. */
  readonly executionKey: string;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly definition: ProwessDefinitionRef;
  readonly policy: ProwessDefinitionRef;
  readonly targetLimit: { readonly kind: string; readonly maximum: number | null };
  readonly delivery: { readonly check: "RANGED_ATTACK_ROLL"; readonly targeting: ProwessDefinitionRef } | null;
  readonly chain: { readonly start: string | null; readonly nodes: readonly ExecutionChainNode[] } | null;
  readonly groups: readonly ExecutionGroup[] | null;
  readonly martialRank: string | null;
}

/** A runtime request the caller must answer; its key is stable and binds the answer to plan, target, scope and kind. */
export interface ExecutionInputRequest {
  readonly requestKey: string;
  readonly kind: ExecutionRequestKind;
  readonly targetKey: string;
  readonly scope: string;
  readonly by: "ATTACKER" | "DEFENDER";
  readonly options: readonly string[] | null;
  readonly definitions: readonly ProwessDefinitionRef[];
}
export interface CoreEvaluationRecord {
  readonly requestKey: string;
  readonly procedure: "ATTACK_ROLL" | "SAVING_THROW";
  readonly stat: string | null;
  readonly evaluationKey: string;
  readonly plan: EvaluationPlan;
  readonly contexts: { readonly actor: unknown; readonly runtime: unknown };
  readonly outputs: { readonly natural: number | null; readonly total: number | null; readonly success: boolean; readonly criticalHit: boolean | null };
}
export interface TriggerEvaluationRecord {
  readonly targetKey: string;
  readonly nodeKey: string;
  readonly evaluationKey: string;
  readonly plan: EvaluationPlan;
  readonly satisfied: boolean;
}
export interface ResolvedOutcome {
  readonly order: number;
  readonly targetKey: string;
  readonly effectKey: string;
  readonly groupKey: string | null;
  readonly definition: ProwessDefinitionRef;
  readonly result: "SUCCESS" | "FAILURE";
  readonly outcomeKey: "SUCCESS" | "FAILURE";
  /** The exact authored operations — inert mechanical intent, never applied here. Empty when nothing is authored. */
  readonly operations: readonly { readonly kind: string; readonly data: JsonObject }[];
  readonly authored: boolean;
  /** True only when THIS Effect's own resolving Attack Roll (or its group's) was a critical hit. */
  readonly critical: boolean;
  readonly parameters: ExecutionEffect["parameters"];
  readonly formulaValues: ExecutionEffect["formulaValues"];
  readonly resolvedBy: string | null;
  readonly rulesetProvenance: ProwessRulesetProvenance;
}
export interface ExecutionNodeTrace {
  readonly effectKey: string;
  readonly status: ExecutionNodeStatus;
  readonly trigger: { readonly evaluated: boolean; readonly satisfied: boolean | null; readonly evaluationKey: string | null } | null;
  readonly resolvedBy: string | null;
  readonly critical: boolean;
  readonly transition: { readonly behavior: EffectChainBehavior; readonly next: string | null } | null;
  readonly pending: readonly string[];
}
export interface SpellTargetTrace {
  readonly targetKey: string;
  readonly status: "COMPLETE" | "PENDING_INPUT";
  readonly delivery: { readonly status: "NONE" | "HIT" | "MISS" | "PENDING_INPUT"; readonly requestKey: string | null; readonly critical: boolean };
  readonly nodes: readonly ExecutionNodeTrace[];
  readonly termination: ExecutionTermination | null;
}
export interface GroupTargetTrace {
  readonly targetKey: string;
  readonly status: "COMPLETE" | "PENDING_INPUT";
  readonly resolution: { readonly mode: "ATTACK_ROLL" | "SAVING_THROW" | "NONE"; readonly requestKey: string | null; readonly result: "SUCCESS" | "FAILURE" | null; readonly critical: boolean };
  readonly effects: readonly { readonly effectKey: string; readonly status: ExecutionNodeStatus; readonly critical: boolean }[];
}
export interface AbilityExecutionResult {
  readonly status: "COMPLETE" | "PENDING_INPUT";
  readonly executionKey: string;
  readonly abilityKind: "SPELL" | "MANEUVER";
  readonly definition: ProwessDefinitionRef;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly targets: readonly SpellTargetTrace[] | null;
  readonly groups: readonly { readonly groupKey: string; readonly kind: ExecutionGroup["kind"]; readonly actionKeys: readonly string[]; readonly targets: readonly GroupTargetTrace[] }[] | null;
  readonly outcomes: readonly ResolvedOutcome[];
  readonly pendingInputs: readonly ExecutionInputRequest[];
  readonly unusedInputs: readonly string[];
  readonly coreEvaluations: readonly CoreEvaluationRecord[];
  readonly triggerEvaluations: readonly TriggerEvaluationRecord[];
}

const EXECUTION_FIELD = "execution";
const json = (v: unknown) => v as JsonObject;
const resolutionOf = (mode: string | null): ExecutionResolution | null => (mode === "ATTACK_ROLL" || mode === "SAVING_THROW" || mode === "AUTOMATIC" ? mode : null);

interface Compiled { readonly plan: ProwessAbilityExecutionPlan; readonly bundle: ProwessDefinitionBundle; readonly ruleset: unknown; readonly authored: AuthoredAbilityResult }

/** Stage A: the exact authored Ability → its execution plan. Pure; never mutates its input. */
export function compileAbilityExecution(request: unknown): ProwessOutcome<ProwessAbilityExecutionPlan> {
  const out = compileInternal(request);
  return out.ok ? finish(new Problems(), () => out.value.plan) : (out as ProwessOutcome<never>);
}

function compileInternal(request: unknown): ProwessOutcome<Compiled> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, K.INVALID_REQUEST)) return finish(p, () => null as never);
  if (!isPlainObject(request)) { p.add(K.INVALID_REQUEST, [], "request object required"); return finish(p, () => null as never); }
  const abilityRequest = Object.fromEntries(Object.entries(request).filter(([k]) => k !== EXECUTION_FIELD));
  const compiled = compileAbilityDefinition(abilityRequest);
  if (!compiled.ok) return compiled as ProwessOutcome<never>;
  // Evaluate the SAME compiled plan on M4 (evaluateAbilityDefinition semantics without a second compilation).
  const run = orchestrateRulesEvaluation({ evaluationKey: `authored.${String(own(abilityRequest, "subjectKey"))}`, contexts: { ruleset: own(abilityRequest, "ruleset") as never }, plan: compiled.value.evaluationPlan });
  if (!run.success || !run.data) { p.add(K.INVALID_ABILITY, ["authored"], "M4 could not evaluate the authored Definition plan"); return finish(p, () => null as never); }
  const evaluated = readAbilityDefinitionRun(compiled.value, run.data);
  if (!evaluated.ok) return evaluated as ProwessOutcome<never>;
  if (!evaluated.value.valid) {
    for (const q of evaluated.value.problems) p.add(K.INVALID_ABILITY, ["authored", q.path], `${q.code}: ${q.message}`);
    return finish(p, () => null as never);
  }
  const plan = compiled.value, authored = evaluated.value;
  const context = createRulesetContext(own(request, "ruleset"));
  const rawDefinitions = own(request, "definitions") as Record<string, unknown>;
  const bundleOut = !context.ok ? null : isPlainObject(rawDefinitions) && Object.hasOwn(rawDefinitions, "definitions") ? createBundleWithinCheckedRequest(context.value, own(rawDefinitions, "definitions"), false) : createProwessDefinitionBundle({ ruleset: context.value, definitions: rawDefinitions.definitions });
  if (!bundleOut?.ok) { p.add(K.INVALID_REQUEST, ["definitions"], "exact Ruleset bundle required"); return finish(p, () => null as never); }
  const bundle = bundleOut.value;
  const rules = bundle.definitions.filter((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  const policyDef = rules.length === 1 ? rules[0]! : null;
  const policy: EffectExecutionPolicy | undefined = policyDef ? (policyDef.payload as unknown as AbilityConstructionRulePayload).effectExecutionPolicy : undefined;
  if (!policyDef || !policy) { p.add(K.MISSING_POLICY, ["definitions"], "the exact Ruleset pins no Effect execution policy; routing defaults are never assumed"); return finish(p, () => null as never); }
  const unresolved = (path: readonly string[], conflict: string, why: string) => p.add(K.UNRESOLVED_RUNTIME_RULE, path, `${conflict}: ${why}`);

  // Martial rank (exact WO5 Skill rank) drives runtime Save control; nothing is inferred when absent.
  const character = own(request, "character") as Record<string, unknown> | undefined;
  const ranks = isPlainObject(character) && Array.isArray(own(character, "skillRanks")) ? (own(character, "skillRanks") as { skillKey: string; rankKey: string }[]) : [];
  const martialRank = ranks.find((r) => r.skillKey === policy.martialSkillKey)?.rankKey ?? null;
  const throwFlowOf = (key: string, stats: readonly string[], selection: string | null, maneuver: boolean): SaveFlow | null => {
    if (!stats.length) { unresolved(["effects", key], "M5-SC-050", "a Saving Throw Effect needs at least one exact Save"); return null; }
    if (stats.length === 1) return { kind: "FIXED", stat: stats[0]! };
    if (selection === "FIXED") return { kind: "FIXED", stat: stats[0]! };
    if (selection === "TARGET_CHOICE") return { kind: "DEFENDER_CHOOSES", stats: stats };
    if (selection === "MARTIAL_CONTROL" && maneuver) {
      const control: MartialSaveControl | undefined = martialRank === null ? undefined : policy.martialSaveControl[martialRank];
      if (!control) { unresolved(["effects", key], "M5-SC-050", "Martial Save control needs the exact Martial rank"); return null; }
      return { kind: control, stats: stats };
    }
    unresolved(["effects", key], "M5-SC-050", `Save selection ${String(selection)} has no authored runtime selection for ${stats.length} Saves`);
    return null;
  };

  // Each exact Effect Use once (a Powerful Blow compiles one Effect per constituent view; the use is still ONE).
  const effects = new Map<string, ExecutionEffect & { readonly policy: string }>();
  const authoredResults = authored.effects;
  for (const e of plan.effects) {
    const key = e.plan.subject.componentKey;
    if (effects.has(key)) continue;
    const result = authoredResults.find((x) => x.result.componentKey === key)!.result;
    const traits = plan.traits.filter((t) => t.scope.componentKey === key);
    if (traits.some((t) => t.modifications.some((m) => m.modification.kind === "TRIGGER"))) unresolved(["traits"], "M5-SC-049", "a Trait TRIGGER modification has no exact Effect Chain semantics");
    const res = traits.flatMap((t) => t.modifications).filter((m) => m.modification.kind === "RESOLUTION").map((m) => m.modification as { mode: string; validSaves?: readonly string[] });
    const last = res.length ? res[res.length - 1]! : null;
    const resolution = resolutionOf(last ? last.mode : e.plan.outputs.resolution);
    const throwStats = last?.validSaves ?? e.plan.outputs.saveProfile?.validSaves ?? [];
    const order = (plan.authored as SpellDefinitionPayload | ManeuverDefinitionPayload).composition.effects.find((x) => x.componentKey === key)!.order;
    effects.set(key, {
      effectKey: key, order, definition: e.plan.outputs.effect.definition, family: e.plan.outputs.effect.family,
      resolution: resolution ?? "AUTOMATIC", route: "OWN", attackType: e.plan.outputs.attackType, throwFlow: null, deliveryInteraction: e.plan.outputs.deliveryInteraction,
      outcomes: result.outcomes, parameters: result.parameters.map((q) => ({ parameter: q.parameter, value: q.value })), formulaValues: result.formulaValues,
      traits: traits.map((t) => t.componentKey), policy: e.plan.outputs.resolutionPolicy,
    });
    if (resolution === null && e.plan.outputs.resolutionPolicy !== "INHERIT_ABILITY") unresolved(["effects", key], "M5-SC-051", "the Effect has no exact executable resolution");
    if (resolution === "SAVING_THROW" || (last !== null && last.mode === "SAVING_THROW")) {
      const flow = throwFlowOf(key, throwStats, e.plan.outputs.saveProfile?.selectionPolicy ?? null, plan.subject.abilityKind === "MANEUVER");
      if (flow) effects.set(key, { ...effects.get(key)!, throwFlow: flow });
    }
  }
  const strip = ({ policy: _p, ...rest }: ExecutionEffect & { readonly policy: string }): ExecutionEffect => { void _p; return rest; };
  const executionKey = `${plan.rulesetProvenance.rulesetId}:${plan.rulesetProvenance.manifestId}:${plan.definition.entityVersionId}:${plan.subject.subjectKey}`;
  const cardinality = plan.targeting.outputs.cardinality;
  const targetLimit = { kind: cardinality.kind, maximum: cardinality.kind === "ONE" ? 1 : cardinality.kind === "SELECTED" ? cardinality.count : null };
  let delivery: ProwessAbilityExecutionPlan["delivery"] = null, chain: ProwessAbilityExecutionPlan["chain"] = null, groups: ExecutionGroup[] | null = null;

  if (plan.subject.abilityKind === "SPELL") {
    const spell = plan.authored as SpellDefinitionPayload;
    const ordered = [...effects.values()].sort((a, b) => (a.order < b.order ? -1 : 1));
    const first = plan.effects[0]?.plan.outputs.deliveryCheck ?? null;
    if (first === "RANGED_ATTACK_ROLL") delivery = { check: first, targeting: plan.targeting.outputs.targeting.definition };
    const rawChain = spell.composition.branch.kind === "SPELL" ? spell.composition.branch.effectChain : null;
    const authoredChain = rawChain === null ? null : readEffectChain(rawChain, spell.composition.effects, ["composition", "branch", "effectChain"], p);
    const destinations = new Set((authoredChain?.nodes ?? []).flatMap((n) => (n.branch ? [n.branch.success, n.branch.failure] : [])));
    const nodes: ExecutionChainNode[] = ordered.map((e, i) => {
      const listed = authoredChain?.nodes.find((n) => n.effectKey === e.effectKey);
      const behavior: EffectChainBehavior = listed ? listed.behavior : authoredChain ? (authoredChain.failurePolicy === "CONTINUE" ? "CONTINUE" : "SUCCESS_ONLY") : policy.defaultChainBehavior;
      const successor = ordered.slice(i + 1).find((x) => !destinations.has(x.effectKey))?.effectKey ?? null;
      const route: ExecutionEffect["route"] = delivery && e.deliveryInteraction === "SAME_ATTACK_ROLL" ? "DELIVERY_ATTACK" : "OWN";
      if (e.resolution === "SAVING_THROW" && e.throwFlow === null && !p.list.some((q) => q.path.includes(e.effectKey))) unresolved(["effects", e.effectKey], "M5-SC-050", "no executable Save flow");
      return { ...strip(e), route, behavior, behaviorSource: listed ? "AUTHORED" : authoredChain ? "CHAIN_FAILURE_POLICY" : "RULED_DEFAULT", branch: listed?.branch ?? null, trigger: listed?.trigger ?? null, successor, branchDestination: destinations.has(e.effectKey) };
    });
    chain = { start: nodes.find((n) => !n.branchDestination)?.effectKey ?? null, nodes };
  } else {
    const man = plan.authored as ManeuverDefinitionPayload;
    const pb = man.powerfulBlow;
    const pbKey = pb ? `powerful_blow.${[...pb.actionKeys].sort().join(".")}` : null;
    const groupOf = (actionKey: string) => (pb?.actionKeys.includes(actionKey) ? pbKey! : actionKey);
    groups = [];
    for (const a of plan.actions) {
      const groupKey = groupOf(a.componentKey);
      if (groups.some((g) => g.groupKey === groupKey)) continue;
      const attack = isAttackFoundation(a.profile);
      const attached = man.effectAttachments.filter((x) => groupOf(x.actionKeys[0]!) === groupKey).map((x) => effects.get(x.effectKey)!).sort((x, y) => (x.order < y.order ? -1 : 1));
      // A Martial Save Effect replaces the Attack Roll for its group (WO7 Save-based Maneuver Effect); one at most.
      const replacing = attached.filter((e) => e.policy === "OWN" && e.resolution === "SAVING_THROW");
      if (replacing.length > 1) unresolved(["groups", groupKey], "M5-SC-051", "more than one resolution-replacing Effect has no authored ordering");
      const replacement = replacing[0] ?? null;
      const resolution: ExecutionGroup["resolution"] = replacement && replacement.throwFlow ? { mode: "SAVING_THROW", replacedBy: replacement.effectKey, flow: replacement.throwFlow } : attack ? { mode: "ATTACK_ROLL" } : { mode: "NONE" };
      const routed = attached.map((e): ExecutionEffect => {
        const base = strip(e);
        if (e.policy === "INHERIT_ABILITY") {
          if (resolution.mode === "NONE") unresolved(["effects", e.effectKey], "M5-SC-051", "an inherited-resolution Effect on a non-attack action has nothing to inherit");
          return { ...base, route: "GROUP", resolution: resolution.mode === "SAVING_THROW" ? "SAVING_THROW" : "ATTACK_ROLL" };
        }
        if (e.resolution === "SAVING_THROW") return { ...base, route: "GROUP" };
        if (e.resolution === "ATTACK_ROLL") {
          if (resolution.mode !== "ATTACK_ROLL" || e.attackType !== "FOUNDATION_ATTACK") unresolved(["effects", e.effectKey], "M5-SC-051", "a Maneuver Effect's own Attack Roll is executable only as its group's foundation Attack");
          return { ...base, route: "GROUP" };
        }
        if (resolution.mode !== "NONE") unresolved(["effects", e.effectKey], "M5-SC-051", "an Automatic Effect attached to an Attack has no authored hit dependency");
        return base;
      });
      groups.push({ groupKey, kind: pb && groupKey === pbKey ? "POWERFUL_BLOW" : attack ? "ATTACK" : "ACTION", actionKeys: plan.actions.filter((x) => groupOf(x.componentKey) === groupKey).map((x) => x.componentKey), attack: attack ? a.definition : null, resolution, effects: routed, targetLimit: attached.some((e) => plan.effects.some((x) => x.plan.subject.componentKey === e.effectKey && x.plan.outputs.targetingConversion !== null)) ? null : 1 });
    }
  }
  if (p.count > 0) return finish(p, () => null as never);
  return finish(p, () => deepFreeze(clonePlainData({
    plan: {
      contractVersion: 1 as const,
      subject: { kind: "ABILITY_EXECUTION" as const, subjectKey: plan.subject.subjectKey, abilityKind: plan.subject.abilityKind },
      executionKey, rulesetProvenance: plan.rulesetProvenance, definition: plan.definition, policy: definitionRefOf(policyDef), targetLimit, delivery, chain, groups, martialRank,
    },
    bundle, ruleset: own(request, "ruleset"), authored,
  })) as Compiled);
}

// ---- Stage B ----------------------------------------------------------------------------------------------------------

interface TargetInput { readonly targetKey: string; readonly numeric: readonly { key: string; value: number }[]; readonly sets: readonly { key: string; members: string[] }[] }
interface InputValue { readonly requestKey: string; readonly kind: ExecutionInputKind; readonly executionKey: string; readonly roller?: unknown; readonly roll?: unknown; readonly targetDodge?: number; readonly difficultyClass?: number; readonly stat?: string }
// Quoted keys: these are input kinds (Saving Throw choices), not persistence operations.
const INPUT_FIELDS: Readonly<Record<ExecutionInputKind, readonly string[]>> = {
  ATTACK_ROLL: ["requestKey", "kind", "executionKey", "roller", "roll", "targetDodge"],
  SAVING_THROW: ["requestKey", "kind", "executionKey", "roller", "roll", "difficultyClass"],
  "SAVE_REMOVAL": ["requestKey", "kind", "executionKey", "stat"],
  "SAVE_SELECTION": ["requestKey", "kind", "executionKey", "stat"],
};

/** Stage B: compile, then execute deterministically with the explicit runtime inputs. Nothing is rolled or applied. */
export function executeAbilityResolution(request: unknown): ProwessOutcome<AbilityExecutionResult> {
  const compiled = compileInternal(request);
  if (!compiled.ok) return compiled as ProwessOutcome<never>;
  const { plan, bundle, ruleset } = compiled.value;
  const p = new Problems();
  const ex = readRecord(own(request as Record<string, unknown>, EXECUTION_FIELD), [EXECUTION_FIELD], p, K.INVALID_REQUEST, ["targets", "groupTargets", "inputs"], ["targets", "inputs"]);
  if (!ex) return finish(p, () => null as never);

  // Targets: exact labels in the caller's (Targeting system's) order — never re-sorted, never acquired here.
  const targets: TargetInput[] = [];
  const rawTargets = own(ex, "targets");
  if (!Array.isArray(rawTargets) || !rawTargets.length) p.add(K.INVALID_TARGETS, ["execution", "targets"], "one or more explicit targets from the Targeting result");
  else rawTargets.forEach((t, i) => {
    const r = readRecord(t, ["execution", "targets", i], p, K.INVALID_TARGETS, ["targetKey", "facts"], ["targetKey"]); if (!r) return;
    const targetKey = own(r, "targetKey");
    if (!isExactLabel(targetKey) || !/^[A-Za-z0-9_-]+$/.test(targetKey) || targets.some((x) => x.targetKey === targetKey)) { p.add(K.INVALID_TARGETS, ["execution", "targets", i], "unique exact target label"); return; }
    const f = own(r, "facts");
    const facts = f === undefined ? { numeric: [], sets: [] } : readRecord(f, ["execution", "targets", i, "facts"], p, K.INVALID_TARGETS, ["numeric", "sets"], []);
    const numeric = (facts && Array.isArray(own(facts, "numeric")) ? (own(facts, "numeric") as { key: unknown; value: unknown }[]) : []).filter((x) => isPlainObject(x) && typeof x.key === "string" && /^target\.[a-z][a-z0-9_]*$/.test(x.key) && typeof x.value === "number" && Number.isFinite(x.value)) as { key: string; value: number }[];
    const sets = (facts && Array.isArray(own(facts, "sets")) ? (own(facts, "sets") as { key: unknown; members: unknown }[]) : []).filter((x) => isPlainObject(x) && typeof x.key === "string" && /^target\.[a-z][a-z0-9_]*$/.test(x.key) && Array.isArray(x.members) && x.members.every((m) => typeof m === "string")) as { key: string; members: string[] }[];
    if (facts && ((Array.isArray(own(facts, "numeric")) && numeric.length !== (own(facts, "numeric") as unknown[]).length) || (Array.isArray(own(facts, "sets")) && sets.length !== (own(facts, "sets") as unknown[]).length))) p.add(K.INVALID_TARGETS, ["execution", "targets", i, "facts"], "target facts are target.<name> numeric values / string sets");
    targets.push({ targetKey, numeric, sets });
  });
  if (plan.chain && plan.targetLimit.maximum !== null && targets.length > plan.targetLimit.maximum) p.add(K.INVALID_TARGETS, ["execution", "targets"], `the exact Targeting allows at most ${plan.targetLimit.maximum} target(s)`);
  // Maneuver groups receive explicit target lists (separate Attacks may strike different creatures).
  const groupTargets = new Map<string, string[]>();
  const namedGroups = new Set<string>();
  if (plan.groups) {
    const raw = own(ex, "groupTargets");
    if (!Array.isArray(raw)) p.add(K.INVALID_TARGETS, ["execution", "groupTargets"], "each Maneuver resolution group names its explicit targets");
    else raw.forEach((g, i) => {
      const r = readRecord(g, ["execution", "groupTargets", i], p, K.INVALID_TARGETS, ["groupKey", "targetKeys"], ["groupKey", "targetKeys"]); if (!r) return;
      const groupKey = own(r, "groupKey"), keys = own(r, "targetKeys");
      if (typeof groupKey !== "string" || !plan.groups!.some((x) => x.groupKey === groupKey) || namedGroups.has(groupKey)) { p.add(K.INVALID_TARGETS, ["execution", "groupTargets", i], "an exact resolution group of this Maneuver, once"); return; }
      namedGroups.add(groupKey);
      if (!Array.isArray(keys) || !keys.length || !keys.every((k) => targets.some((t) => t.targetKey === k)) || new Set(keys).size !== keys.length) { p.add(K.INVALID_TARGETS, ["execution", "groupTargets", i], "declared targets, each once"); return; }
      const limit = plan.groups!.find((x) => x.groupKey === groupKey)!.targetLimit;
      if (limit !== null && keys.length > limit) { p.add(K.INVALID_TARGETS, ["execution", "groupTargets", i], `group ${groupKey} resolves against at most ${limit} target(s)`); return; }
      groupTargets.set(groupKey, keys as string[]);
    });
    for (const g of plan.groups) if (!namedGroups.has(g.groupKey)) p.add(K.INVALID_TARGETS, ["execution", "groupTargets"], `group ${g.groupKey} needs explicit targets`);
  } else if (own(ex, "groupTargets") !== undefined) p.add(K.INVALID_TARGETS, ["execution", "groupTargets"], "only Maneuvers have resolution groups");

  // Inputs: addressed to exact request keys of THIS plan; never a bare success claim.
  const prefix = `wo12.${plan.subject.subjectKey}.`;
  const inputs = new Map<string, InputValue>();
  const rawInputs = own(ex, "inputs");
  if (!Array.isArray(rawInputs)) p.add(K.INVALID_REQUEST, ["execution", "inputs"], "inputs is an array");
  else rawInputs.forEach((x, i) => {
    if (!isPlainObject(x)) { p.add(K.UNKNOWN_INPUT, ["execution", "inputs", i], "input object required"); return; }
    const kind = readEnum(own(x, "kind"), ["ATTACK_ROLL", "SAVING_THROW", "SAVE_REMOVAL", "SAVE_SELECTION"] as const, ["execution", "inputs", i, "kind"], p, K.UNKNOWN_INPUT, "input kind");
    if (!kind) return;
    const r = readRecord(x, ["execution", "inputs", i], p, K.UNKNOWN_INPUT, INPUT_FIELDS[kind], INPUT_FIELDS[kind]); if (!r) return;
    const requestKey = own(r, "requestKey");
    if (own(r, "executionKey") !== plan.executionKey) { p.add(K.UNKNOWN_INPUT, ["execution", "inputs", i, "executionKey"], "the input belongs to another execution plan, Ruleset or Ability version"); return; }
    if (typeof requestKey !== "string" || !requestKey.startsWith(prefix) || !requestKey.endsWith(`.${kind.toLowerCase()}`) || inputs.has(requestKey)) { p.add(K.UNKNOWN_INPUT, ["execution", "inputs", i, "requestKey"], "an exact request key of this plan for this input kind, once"); return; }
    if ((kind === "ATTACK_ROLL" && readSafeInteger(own(r, "targetDodge"), ["execution", "inputs", i, "targetDodge"], p, K.INVALID_INPUT, "targetDodge") === null) || (kind === "SAVING_THROW" && readSafeInteger(own(r, "difficultyClass"), ["execution", "inputs", i, "difficultyClass"], p, K.INVALID_INPUT, "difficultyClass") === null)) return;
    inputs.set(requestKey, clonePlainData(r) as unknown as InputValue);
  });
  if (p.count > 0) return finish(p, () => null as never);

  const knownScopes = new Set<string>();
  const requested = new Set<string>();
  const pending: ExecutionInputRequest[] = [];
  const coreEvaluations: CoreEvaluationRecord[] = [];
  const triggerEvaluations: TriggerEvaluationRecord[] = [];
  const outcomes: ResolvedOutcome[] = [];
  const keyOf = (targetKey: string, scope: string, kind: ExecutionInputKind) => `${prefix}${targetKey}.${scope}.${kind.toLowerCase()}`;
  const ask = (targetKey: string, scope: string, kind: ExecutionInputKind, by: ExecutionInputRequest["by"], options: readonly string[] | null, definitions: readonly ProwessDefinitionRef[]) => {
    const requestKey = keyOf(targetKey, scope, kind);
    requested.add(requestKey);
    const input = inputs.get(requestKey);
    if (input) return { requestKey, input };
    pending.push({ requestKey, kind, targetKey, scope, by, options, definitions });
    return { requestKey, input: null };
  };
  /** WO2 core resolution on M4 from the explicit roll input; the outcome is M4's, never the caller's claim. */
  const core = (requestKey: string, procedure: "ATTACK_ROLL" | "SAVING_THROW", input: InputValue, stat: string | null) => {
    const roll = isPlainObject(input.roll) ? input.roll : {};
    const subject = { kind: "CORE_RESOLUTION", subjectKey: requestKey, procedure, mode: own(roll, "mode"), ...(stat ? { stat } : {}) };
    const compiledCore = compileCoreResolution({ contractVersion: 1, subject, definitions: bundle, ruleset, character: input.roller });
    if (!compiledCore.ok) { for (const q of compiledCore.problems) p.add(K.INVALID_INPUT, [requestKey, q.path], q.message); return null; }
    const contexts = buildCoreResolutionContexts({ definitions: bundle, character: input.roller, plan: compiledCore.value, roll: input.roll, ...(procedure === "ATTACK_ROLL" ? { targetDodge: input.targetDodge! } : { difficultyClass: input.difficultyClass! }) });
    if (!contexts.ok) { for (const q of contexts.problems) p.add(K.INVALID_INPUT, [requestKey, q.path], q.message); return null; }
    const evaluationKey = `${requestKey}.core`;
    const response = orchestrateRulesEvaluation({ evaluationKey, contexts: { ruleset, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: compiledCore.value.evaluationPlan });
    const value = (stepKey: string | null): unknown => { if (stepKey === null || !response.success || !response.data) return null; const d = response.data.steps.find((s) => s.stepKey === stepKey)?.response?.data as Record<string, unknown> | undefined; return d === undefined ? null : "finalValue" in d ? d.finalValue : "satisfied" in d ? d.satisfied : null; };
    const o = compiledCore.value.outputs, success = value(o.success);
    if (!response.success || typeof success !== "boolean") { p.add(K.INVALID_INPUT, [requestKey], "the WO2 core resolution did not produce a result"); return null; }
    const outputs = { natural: value(o.natural) as number | null, total: value(o.total) as number | null, success, criticalHit: value(o.criticalHit) as boolean | null };
    coreEvaluations.push({ requestKey, procedure, stat, evaluationKey, plan: compiledCore.value.evaluationPlan, contexts: { actor: contexts.value.actor, runtime: contexts.value.runtime }, outputs });
    return outputs;
  };
  /** Attack Roll: hit / miss / critical from M4; null while the roll is pending. */
  const attack = (targetKey: string, scope: string, definitions: readonly ProwessDefinitionRef[]) => {
    knownScopes.add(`${targetKey}.${scope}.attack_roll`);
    const a = ask(targetKey, scope, "ATTACK_ROLL", "ATTACKER", null, definitions);
    if (!a.input) return { pending: true as const, requestKey: a.requestKey };
    const r = core(a.requestKey, "ATTACK_ROLL", a.input, null);
    return r === null ? null : { pending: false as const, requestKey: a.requestKey, hit: r.success, critical: r.criticalHit === true };
  };
  /** Saving Throw with the exact selection flow; returns whether the TARGET succeeded (Effect FAILURE) or failed (Effect SUCCESS). */
  const savingThrow = (targetKey: string, scope: string, flow: SaveFlow, definitions: readonly ProwessDefinitionRef[]) => {
    let stat: string | null = null;
    const choose = (kind: "SAVE_REMOVAL" | "SAVE_SELECTION", by: ExecutionInputRequest["by"], options: readonly string[]) => {
      knownScopes.add(`${targetKey}.${scope}.${kind.toLowerCase()}`);
      const a = ask(targetKey, scope, kind, by, options, definitions);
      if (!a.input) return undefined;
      if (typeof a.input.stat !== "string" || !options.includes(a.input.stat)) { p.add(K.INVALID_INPUT, [a.requestKey, "stat"], `the choice must be one of ${options.join(", ")}`); return null; }
      return a.input.stat;
    };
    if (flow.kind === "FIXED") stat = flow.stat;
    else if (flow.kind === "DEFENDER_CHOOSES") { const s = choose("SAVE_SELECTION", "DEFENDER", flow.stats); if (s === undefined) return { pending: true as const }; if (s === null) return null; stat = s; }
    else if (flow.kind === "ATTACKER_CHOOSES") { const s = choose("SAVE_SELECTION", "ATTACKER", flow.stats); if (s === undefined) return { pending: true as const }; if (s === null) return null; stat = s; }
    else {
      const removed = choose("SAVE_REMOVAL", "ATTACKER", flow.stats); if (removed === undefined) return { pending: true as const }; if (removed === null) return null;
      const remaining = flow.stats.filter((s) => s !== removed);
      if (remaining.length === 1) stat = remaining[0]!;
      else { const s = choose("SAVE_SELECTION", "DEFENDER", remaining); if (s === undefined) return { pending: true as const }; if (s === null) return null; stat = s; }
    }
    knownScopes.add(`${targetKey}.${scope}.saving_throw`);
    const a = ask(targetKey, scope, "SAVING_THROW", "DEFENDER", [stat], definitions);
    if (!a.input) return { pending: true as const };
    const r = core(a.requestKey, "SAVING_THROW", a.input, stat);
    return r === null ? null : { pending: false as const, requestKey: a.requestKey, targetSucceeded: r.success, stat };
  };
  const emit = (targetKey: string, e: ExecutionEffect, groupKey: string | null, result: "SUCCESS" | "FAILURE", critical: boolean, resolvedBy: string | null) => {
    const reading = e.outcomes.find((o) => o.outcomeKey === result);
    outcomes.push({ order: outcomes.length, targetKey, effectKey: e.effectKey, groupKey, definition: e.definition, result, outcomeKey: result, operations: reading ? reading.operations : [], authored: reading !== undefined, critical, parameters: e.parameters, formulaValues: e.formulaValues, resolvedBy, rulesetProvenance: plan.rulesetProvenance });
  };

  let targetTraces: SpellTargetTrace[] | null = null;
  let groupTraces: { groupKey: string; kind: ExecutionGroup["kind"]; actionKeys: readonly string[]; targets: GroupTargetTrace[] }[] | null = null;
  if (plan.chain) {
    targetTraces = [];
    for (const t of targets) {
      // Every target owns an independent cursor and chain-local facts.
      const nodes = new Map<string, ExecutionNodeTrace>(plan.chain.nodes.map((n) => [n.effectKey, { effectKey: n.effectKey, status: "NOT_REACHED", trigger: null, resolvedBy: null, critical: false, transition: null, pending: [] }]));
      const facts = new Map<string, number>(plan.chain.nodes.flatMap((n) => [[`chain.${n.effectKey}.success`, 0], [`chain.${n.effectKey}.failure`, 0]] as [string, number][]));
      facts.set("chain.previous.success", 0); facts.set("chain.previous.failure", 0); facts.set("delivery.hit", 0); facts.set("delivery.critical", 0);
      let status: SpellTargetTrace["status"] = "COMPLETE";
      let termination: ExecutionTermination | null = null;
      let deliveryTrace: SpellTargetTrace["delivery"] = { status: "NONE", requestKey: null, critical: false };
      let deliveryHit: boolean | null = null;
      if (plan.delivery) {
        const d = attack(t.targetKey, "delivery", [plan.delivery.targeting, plan.definition]);
        if (d === null) return finish(p, () => null as never);
        if (d.pending) { deliveryTrace = { status: "PENDING_INPUT", requestKey: d.requestKey, critical: false }; status = "PENDING_INPUT"; }
        else { deliveryHit = d.hit; deliveryTrace = { status: d.hit ? "HIT" : "MISS", requestKey: d.requestKey, critical: d.critical }; facts.set("delivery.hit", d.hit ? 1 : 0); facts.set("delivery.critical", d.critical ? 1 : 0); }
      }
      let cursor: string | null = status === "PENDING_INPUT" ? null : plan.chain.start;
      let viaBranch = false, executed = 0;
      const visited = new Set<string>();
      if (cursor === null && status === "COMPLETE") termination = "NO_REACHABLE_EFFECT";
      while (cursor !== null) {
        if (visited.has(cursor)) { termination = "INVALID_RUNTIME_PATH"; break; }
        visited.add(cursor);
        const n = plan.chain.nodes.find((x) => x.effectKey === cursor)!;
        const trace = (patch: Partial<ExecutionNodeTrace>) => nodes.set(n.effectKey, { ...nodes.get(n.effectKey)!, ...patch });
        // 1. Trigger (an M4 REQUIREMENT over chain-local and explicit target facts). False → NOT_TRIGGERED, never a result.
        if (n.trigger) {
          const missing = triggerFactKeys(n.trigger).filter((k) => k.startsWith("target.") && !t.numeric.some((x) => x.key === k) && !t.sets.some((x) => x.key === k));
          if (missing.length) {
            const keys = missing.map((k) => `${prefix}${t.targetKey}.effect.${n.effectKey}.fact.${k}`);
            missing.forEach((k, i) => pending.push({ requestKey: keys[i]!, kind: "TARGET_FACT", targetKey: t.targetKey, scope: `effect.${n.effectKey}`, by: "DEFENDER", options: [k], definitions: [n.definition, plan.definition] }));
            trace({ status: "PENDING_INPUT", pending: keys }); status = "PENDING_INPUT"; break;
          }
          const evaluationKey = `${prefix}${t.targetKey}.effect.${n.effectKey}.trigger`;
          const tplan: EvaluationPlan = { steps: [{ stepKey: evaluationKey, order: 0, operation: "REQUIREMENT", input: json({ requirement: n.trigger, facts: { numeric: [...[...facts.entries()].map(([key, value]) => ({ key, value })), ...t.numeric], ranks: [], sets: t.sets, ownedEntityIds: null, keywords: null } }), bindings: [] }], primaryStepKey: evaluationKey, validationStepKey: null, explanationStepKey: null };
          const response = orchestrateRulesEvaluation({ evaluationKey, contexts: { ruleset }, plan: tplan });
          const satisfied = response.success && response.data ? (response.data.steps[0]?.response?.data as { satisfied?: unknown } | undefined)?.satisfied : undefined;
          if (typeof satisfied !== "boolean") { p.add(K.INVALID_INPUT, [evaluationKey], "the trigger requirement did not evaluate"); return finish(p, () => null as never); }
          triggerEvaluations.push({ targetKey: t.targetKey, nodeKey: n.effectKey, evaluationKey, plan: tplan, satisfied });
          trace({ trigger: { evaluated: true, satisfied, evaluationKey } });
          if (!satisfied) { trace({ status: "NOT_TRIGGERED", transition: { behavior: n.behavior, next: n.successor } }); cursor = n.successor; continue; }
        }
        // 2. Resolution (WO7 normalization; Projectile Attack Effects reuse the delivery roll; a miss never reaches a Save).
        let result: "SUCCESS" | "FAILURE" | null = null, critical = false, resolvedBy: string | null = null;
        const defs = [n.definition, plan.definition];
        if (deliveryHit === false && n.route !== "DELIVERY_ATTACK") { trace({ status: "NOT_DELIVERED" }); termination = "DELIVERY_FAILED"; break; }
        if (n.route === "DELIVERY_ATTACK") { result = deliveryHit ? "SUCCESS" : "FAILURE"; critical = deliveryTrace.critical; resolvedBy = deliveryTrace.requestKey; }
        else if (n.resolution === "ATTACK_ROLL") {
          const r = attack(t.targetKey, `effect.${n.effectKey}`, defs); if (r === null) return finish(p, () => null as never);
          if (r.pending) { trace({ status: "PENDING_INPUT", pending: [r.requestKey] }); status = "PENDING_INPUT"; break; }
          result = r.hit ? "SUCCESS" : "FAILURE"; critical = r.critical; resolvedBy = r.requestKey;
        } else if (n.resolution === "SAVING_THROW") {
          const r = savingThrow(t.targetKey, `effect.${n.effectKey}`, n.throwFlow!, defs); if (r === null) return finish(p, () => null as never);
          if (r.pending) { trace({ status: "PENDING_INPUT", pending: pending.filter((q) => q.targetKey === t.targetKey && q.scope === `effect.${n.effectKey}`).map((q) => q.requestKey) }); status = "PENDING_INPUT"; break; }
          result = r.targetSucceeded ? "FAILURE" : "SUCCESS"; resolvedBy = r.requestKey;
        } else result = "SUCCESS"; // AUTOMATIC: the authored Ability evaluated VALID, so its application requirements hold.
        executed += 1;
        emit(t.targetKey, n, null, result, critical, resolvedBy);
        facts.set(`chain.${n.effectKey}.success`, result === "SUCCESS" ? 1 : 0); facts.set(`chain.${n.effectKey}.failure`, result === "FAILURE" ? 1 : 0);
        facts.set("chain.previous.success", result === "SUCCESS" ? 1 : 0); facts.set("chain.previous.failure", result === "FAILURE" ? 1 : 0);
        // 3. Transition by the exact Chain Behavior.
        let next: string | null = null;
        if (n.behavior === "STOP") termination = "STOP";
        else if (n.behavior === "SUCCESS_ONLY" && result === "FAILURE") termination = "SUCCESS_ONLY_FAILURE";
        else if (n.behavior === "FAILURE_ONLY" && result === "SUCCESS") termination = "FAILURE_ONLY_SUCCESS";
        else if (n.behavior === "BRANCH") { next = result === "SUCCESS" ? n.branch!.success : n.branch!.failure; viaBranch = true; }
        else next = n.successor;
        trace({ status: result === "SUCCESS" ? "EXECUTED_SUCCESS" : "EXECUTED_FAILURE", resolvedBy, critical, transition: { behavior: n.behavior, next } });
        if (next === null && termination === null) termination = viaBranch ? "BRANCH_END" : "END_OF_CHAIN";
        cursor = termination === null ? next : null;
      }
      if (status === "COMPLETE" && termination === null) termination = executed === 0 ? "NO_REACHABLE_EFFECT" : viaBranch ? "BRANCH_END" : "END_OF_CHAIN";
      if (status === "PENDING_INPUT") termination = null;
      targetTraces.push({ targetKey: t.targetKey, status, delivery: deliveryTrace, nodes: plan.chain.nodes.map((n) => nodes.get(n.effectKey)!), termination });
    }
  } else if (plan.groups) {
    groupTraces = [];
    for (const g of plan.groups) {
      const traces: GroupTargetTrace[] = [];
      for (const targetKey of groupTargets.get(g.groupKey)!) {
        // ONE resolution per group and target: its Attack Roll (a Powerful Blow rolls once) or its replacing Save.
        const scope = `group.${g.groupKey}`, defs = [...(g.attack ? [g.attack] : []), plan.definition];
        let result: "SUCCESS" | "FAILURE" | null = null, critical = false, requestKey: string | null = null, pendingGroup = false;
        if (g.resolution.mode === "ATTACK_ROLL") {
          const r = attack(targetKey, scope, defs); if (r === null) return finish(p, () => null as never);
          if (r.pending) { pendingGroup = true; requestKey = r.requestKey; } else { result = r.hit ? "SUCCESS" : "FAILURE"; critical = r.critical; requestKey = r.requestKey; }
        } else if (g.resolution.mode === "SAVING_THROW") {
          const r = savingThrow(targetKey, scope, g.resolution.flow, defs); if (r === null) return finish(p, () => null as never);
          if (r.pending) pendingGroup = true; else { result = r.targetSucceeded ? "FAILURE" : "SUCCESS"; requestKey = r.requestKey; }
        }
        const effectTraces = g.effects.map((e) => {
          if (pendingGroup && e.route === "GROUP") return { effectKey: e.effectKey, status: "PENDING_INPUT" as const, critical: false };
          const r = e.route === "GROUP" ? result! : "SUCCESS";
          const c = e.route === "GROUP" ? critical : false;
          emit(targetKey, e, g.groupKey, r, c, e.route === "GROUP" ? requestKey : null);
          return { effectKey: e.effectKey, status: r === "SUCCESS" ? ("EXECUTED_SUCCESS" as const) : ("EXECUTED_FAILURE" as const), critical: c };
        });
        traces.push({ targetKey, status: pendingGroup ? "PENDING_INPUT" : "COMPLETE", resolution: { mode: g.resolution.mode, requestKey, result, critical }, effects: effectTraces });
      }
      groupTraces.push({ groupKey: g.groupKey, kind: g.kind, actionKeys: g.actionKeys, targets: traces });
    }
  }
  if (p.count > 0) return finish(p, () => null as never);
  // An input addressed to a request this plan could never make (another target, Effect, group or kind) is refused.
  const possible = (key: string) => {
    if (requested.has(key)) return true;
    const rest = key.slice(prefix.length);
    const target = targets.find((t) => rest.startsWith(`${t.targetKey}.`));
    if (!target) return false;
    const tail = rest.slice(target.targetKey.length + 1);
    // Each scope accepts only the input kinds its exact resolution can request.
    const THROW_KINDS = ["saving_throw", "save_removal", "save_selection"], ATTACK_KINDS = ["attack_roll"];
    const scopes: [string, string[]][] = plan.chain
      ? [...(plan.delivery ? [["delivery", ATTACK_KINDS] as [string, string[]]] : []), ...plan.chain.nodes.map((n): [string, string[]] => [`effect.${n.effectKey}`, n.route === "DELIVERY_ATTACK" ? [] : n.resolution === "ATTACK_ROLL" ? ATTACK_KINDS : n.resolution === "SAVING_THROW" ? THROW_KINDS : []])]
      : plan.groups!.map((g): [string, string[]] => [`group.${g.groupKey}`, g.resolution.mode === "ATTACK_ROLL" ? ATTACK_KINDS : g.resolution.mode === "SAVING_THROW" ? THROW_KINDS : []]);
    return scopes.some(([s, kinds]) => tail.startsWith(`${s}.`) && kinds.includes(tail.slice(s.length + 1)));
  };
  for (const key of inputs.keys()) if (!possible(key)) p.add(K.UNKNOWN_INPUT, ["execution", "inputs", key], "the input names no request this plan can make for its targets");
  if (p.count > 0) return finish(p, () => null as never);
  return finish(p, () => deepFreeze(clonePlainData({
    status: pending.length || (targetTraces ?? []).some((t) => t.status === "PENDING_INPUT") ? ("PENDING_INPUT" as const) : ("COMPLETE" as const),
    executionKey: plan.executionKey, abilityKind: plan.subject.abilityKind, definition: plan.definition, rulesetProvenance: plan.rulesetProvenance,
    targets: targetTraces, groups: groupTraces, outcomes, pendingInputs: pending, unusedInputs: [...inputs.keys()].filter((k) => !requested.has(k)), coreEvaluations, triggerEvaluations,
  })) as AbilityExecutionResult);
}
