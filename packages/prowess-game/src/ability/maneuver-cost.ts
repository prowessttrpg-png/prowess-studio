import type { JsonObject } from "@prowess/model";
import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationBinding, type EvaluationPlan, type EvaluationRun, type EvaluationStep } from "@prowess/rules";
import { validateAffinityProfile } from "../affinity/profile.js";
import { createProwessDefinitionBundle, findBundleDefinition, type ProwessRulesetProvenance } from "../bundle/bundle.js";
import type { ProwessCompilationSourceMap, ProwessSourceMapEntry } from "../compilation/model.js";
import type { AbilityConstructionRulePayload } from "../definition/ability-construction-payload.js";
import { isAttackFoundation, type ManeuverDefinitionPayload } from "../definition/authored-ability-payload.js";
import type { EffectCostRule } from "../definition/effect-payload.js";
import { isSameExactDefinition, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { ManeuverCostPolicy } from "../definition/maneuver-cost-policy.js";
import type { FoundationDefinitionPayload } from "../definition/payload.js";
import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, own, type ProwessOutcome } from "../internal/problems.js";
import { compileAbilityDefinition, readAbilityDefinitionRun, type AuthoredAbilityResult, type ProwessAbilityDefinitionCompiledPlan } from "./compile.js";

/**
 * M5-WO11 FINAL MANEUVER COST, ATTACK FLOORS & SIGNATURE REDUCTION. Composes with — never replaces — the canonical
 * authored Ability compiler (WO8) and consumes the permanent component outputs: exact foundation (Attack / action) AP,
 * WO7 Effect AP / MP (one count per authored Effect instance, explicit AP-or-MP choices, exact Effect-specific Affinity
 * reductions), WO8 Trait costs, WO9 Duration values and the WO9 EFFECTIVE (3 AP-capped) Maneuver Condition AP reduction
 * plus explicitly selected Condition MP reductions.
 *
 * The M4 plan, appended after the authored plan, makes every phase explicit:
 *
 *   FORMULA  wo11.contribution.<n>   each exact component contribution (max(0, units − included) × rate)
 *   MODIFIER wo11.affinity.<n>       highest relevant Affinity reduction of one Effect-specific cost rule (then
 *   FORMULA  wo11.adjusted.<n>       max(component minimum, amount − reduction)) — never a global Affinity percentage
 *   MODIFIER wo11.base_ap            Base AP: ADD every AP contribution (Base AP is preserved; Commitment reads it)
 *   MODIFIER wo11.base_mp            Base MP: ADD every MP contribution (never derived from AP)
 *   FORMULA  wo11.condition_reduced  Base AP − the WO9 EFFECTIVE Condition AP reduction (≤ 3)
 *   FORMULA  wo11.attack_floor       max(1, separate attack resolutions) — Powerful Blow is ONE resolution
 *   MODIFIER wo11.post_condition_ap  MAX(Condition-reduced AP, attack floor)
 *   MODIFIER wo11.final_ap           phase 1: SUBTRACT the Signature Maneuver reduction; phase 2: MAX 1 (no 3 AP cap)
 *   MODIFIER wo11.final_mp           phase 1: SUBTRACT each selected Condition MP reduction; phase 2: MAX 0
 *   EXPLANATION wo11.explanation     every cost step, for the Rules Inspector
 *
 * WO11 calculates cost only: no AP / MP / ME spending, no attack roll, damage, movement, Save, Effect Chain (WO12),
 * Sustain / Mana Lock / Concentration (WO13). No Spell semantics: no MP ÷ PRO, no percentage netting, no final rounding.
 */
export const MANEUVER_COST_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "PROWESS_MANEUVER_COST.INVALID_REQUEST",
  /** Final Spell cost is M5-WO10's separate pipeline. */
  MANEUVER_ONLY: "PROWESS_MANEUVER_COST.MANEUVER_ONLY",
  /** The exact Signature assignment is missing, or claims Signature without occupying a Signature Ability slot. */
  INVALID_SIGNATURE: "PROWESS_MANEUVER_COST.INVALID_SIGNATURE",
  /** The exact Ruleset pins no Maneuver cost policy. */
  MISSING_POLICY: "PROWESS_MANEUVER_COST.MISSING_POLICY",
  /** A component cost has no exact executable value (unpriced foundation, unresolved conflict, unauthored operation). */
  UNRESOLVED_CONTRIBUTION: "PROWESS_MANEUVER_COST.UNRESOLVED_CONTRIBUTION",
  /** An AP-or-MP cost option was not explicitly chosen by the authored Maneuver. */
  MISSING_COST_CHOICE: "PROWESS_MANEUVER_COST.MISSING_COST_CHOICE",
  /** A Condition restates a requirement the selected Attack already carries (its weapon): no discount, refused. */
  REDUNDANT_RESTRICTION: "PROWESS_MANEUVER_COST.REDUNDANT_RESTRICTION",
  DUPLICATE_CONTRIBUTION: "PROWESS_MANEUVER_COST.DUPLICATE_CONTRIBUTION",
  INCOMPLETE_RUN: "PROWESS_MANEUVER_COST.INCOMPLETE_RUN",
});
const K = MANEUVER_COST_ERROR_CODES;

export type ManeuverCostSource = "FOUNDATION" | "EFFECT" | "TRAIT" | "DURATION" | "MANEUVER_CONDITION";
export type ManeuverCurrency = "AP" | "MP";
export interface ManeuverCostContributionPlan {
  readonly contributionKey: string;
  readonly source: ManeuverCostSource;
  /** The authored component USE (an action use, an Effect instance, a Trait use): identity is use-based, not Definition-based. */
  readonly componentKey: string;
  readonly definition: ProwessDefinitionRef;
  readonly currency: ManeuverCurrency;
  readonly rule: string;
  readonly selected: number | string | boolean | null;
  readonly stepKey: string;
  /** The Effect-specific Affinity adjustment, when the exact cost rule declares one. */
  readonly affinity: { readonly listedAmount: number; readonly minimum: number; readonly reductionStepKey: string; readonly candidates: readonly { readonly affinity: ProwessDefinitionRef; readonly rank: string; readonly reduction: number }[] } | null;
}
export interface ManeuverCostOption {
  readonly componentKey: string;
  readonly definition: ProwessDefinitionRef;
  readonly parameter: string;
  readonly selected: string | null;
  readonly options: readonly { readonly option: string; readonly amounts: Readonly<Record<string, number>> }[];
}
export interface ManeuverResolutionGroup {
  readonly groupKey: string;
  readonly kind: "ATTACK" | "POWERFUL_BLOW" | "ACTION";
  readonly actionKeys: readonly string[];
  readonly attack: ProwessDefinitionRef | null;
  readonly repetitions: number;
  /** The Attack's own weapon requirement, carried automatically: never a Condition, never a discount, never a slot. */
  readonly inheritedRequirements: readonly { readonly kind: "WEAPON"; readonly weaponKey: string; readonly attack: ProwessDefinitionRef; readonly grantsConditionDiscount: false; readonly consumesConditionSlot: false; readonly status: "REQUIREMENT_CONTRACT_ONLY" }[];
  readonly effects: readonly string[];
  readonly traits: readonly string[];
}
export interface ManeuverStructure {
  readonly actions: readonly { readonly actionKey: string; readonly definition: ProwessDefinitionRef; readonly kind: "ATTACK" | "ACTION"; readonly category: string; readonly groupKey: string }[];
  readonly resolutionGroups: readonly ManeuverResolutionGroup[];
  readonly separateAttackResolutions: number;
  readonly maneuverScoped: { readonly traits: readonly string[] };
}
export interface ProwessManeuverCostCompiledPlan {
  readonly contractVersion: 1;
  readonly subject: { readonly kind: "MANEUVER_COST"; readonly subjectKey: string };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly definition: ProwessDefinitionRef;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly ability: ProwessAbilityDefinitionCompiledPlan;
  readonly policy: { readonly definition: ProwessDefinitionRef; readonly signatureApReduction: number; readonly minimumAp: number; readonly minimumMp: number };
  readonly structure: ManeuverStructure;
  readonly contributions: readonly ManeuverCostContributionPlan[];
  readonly costOptions: readonly ManeuverCostOption[];
  readonly conditionMpReductions: readonly { readonly contributionKey: string; readonly componentKey: string; readonly definition: ProwessDefinitionRef; readonly selectedOption: string | null; readonly stepKey: string }[];
  readonly signature: { readonly assigned: boolean; readonly reduction: number };
  readonly steps: {
    readonly baseAp: string;
    readonly baseMp: string;
    readonly conditionApEffective: string | null;
    readonly conditionReducedAp: string;
    readonly attackFloor: string;
    readonly postConditionAp: string;
    readonly finalAp: string;
    readonly conditionMp: string;
    readonly finalMp: string;
    readonly explanation: string;
  };
}
type Resolved<T> = T & { readonly value: number };
export interface ManeuverCostResult {
  readonly status: "VALID" | "INVALID";
  readonly valid: boolean;
  readonly definition: ProwessDefinitionRef;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly authored: AuthoredAbilityResult;
  readonly structure: ManeuverStructure;
  readonly costOptions: readonly ManeuverCostOption[];
  readonly ap: {
    readonly contributions: readonly Resolved<ManeuverCostContributionPlan>[];
    /** Base AP: before Conditions, Signature and any temporary discount. Commitment-scaling consumers read THIS value. */
    readonly baseApCost: number;
    readonly conditions: { readonly listedApReduction: number; readonly effectiveApReduction: number; readonly maximumApReduction: number };
    readonly conditionReducedApCost: number;
    readonly separateAttackResolutions: number;
    readonly conditionAttackFloor: number;
    readonly postConditionApCost: number;
    readonly signature: { readonly assigned: boolean; readonly reduction: number; readonly applied: boolean };
    readonly finalApCost: number;
  };
  readonly mp: {
    readonly contributions: readonly Resolved<ManeuverCostContributionPlan>[];
    readonly baseMpCost: number;
    readonly conditionReductions: readonly Resolved<ProwessManeuverCostCompiledPlan["conditionMpReductions"][number]>[];
    readonly conditionMpReduction: number;
    readonly finalMpCost: number;
  };
  readonly steps: ProwessManeuverCostCompiledPlan["steps"];
  readonly problems: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

const CURRENCIES: readonly string[] = ["AP", "MP"];
const CONDITION_MP = "maneuver.condition_mp_reduction";
const BASE_AP = "maneuver.base_ap_cost", BASE_MP = "maneuver.base_mp_cost", POST_AP = "maneuver.post_condition_ap_cost", FINAL_AP = "maneuver.ap_cost", FINAL_MP = "maneuver.mp_cost", REDUCTION = "maneuver.effect_affinity_reduction";
const bind = (target: string, stepKey: string, pointer = "/data/finalValue"): EvaluationBinding => ({ target, source: { kind: "STEP", stepKey, pointer } });
/** Partitions contributions by their structured currency (vocabulary, not a Resource-name branch). */
const ofCurrency = <T extends { readonly currency: ManeuverCurrency }>(rows: readonly T[], currency: ManeuverCurrency): T[] => rows.filter((c) => c.currency === currency);
const emptyFacts = (): JsonObject => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: null, keywords: null });
/** Signature is an explicit assignment; WO5 verifies the slot (a Signature Maneuver occupies a Signature Ability slot). */
const SIGNATURE_FIELD = "signatureManeuver";

/** Compiles the exact authored Maneuver and its final cost into ONE M4 plan. Pure; never mutates its input. */
export function compileManeuverCost(request: unknown): ProwessOutcome<ProwessManeuverCostCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, K.INVALID_REQUEST)) return finish(p, () => null as never);
  if (!isPlainObject(request)) { p.add(K.INVALID_REQUEST, [], "request object required"); return finish(p, () => null as never); }
  const assigned = own(request, SIGNATURE_FIELD);
  if (typeof assigned !== "boolean") { p.add(K.INVALID_SIGNATURE, [SIGNATURE_FIELD], "the exact Signature Maneuver assignment (true / false) is required; it is never inferred from a name"); return finish(p, () => null as never); }
  const abilityRequest = Object.fromEntries(Object.entries(request).filter(([k]) => k !== SIGNATURE_FIELD));
  const ability = compileAbilityDefinition(abilityRequest);
  if (!ability.ok) return ability as ProwessOutcome<never>;
  const plan = ability.value;
  if (plan.subject.abilityKind !== "MANEUVER") { p.add(K.MANEUVER_ONLY, ["definition"], "WO11 prices Maneuvers only; final Spell cost is M5-WO10"); return finish(p, () => null as never); }
  const signatureState = own(request, "signature");
  const slotUse = isPlainObject(signatureState) && isPlainObject(own(signatureState, "candidate")) ? own(own(signatureState, "candidate") as Record<string, unknown>, "slotUse") : undefined;
  if (assigned && slotUse !== "DEFAULT") { p.add(K.INVALID_SIGNATURE, ["signature", "candidate"], "a Signature Maneuver occupies a Signature Ability slot (WO5 slotUse DEFAULT)"); return finish(p, () => null as never); }

  // The exact Ruleset's own construction rule carries the Maneuver cost policy (Signature reduction, minimums).
  const context = createRulesetContext(own(request, "ruleset"));
  const rawBundle = own(request, "definitions") as Record<string, unknown>;
  const bundleOut = context.ok ? createProwessDefinitionBundle({ ruleset: context.value, definitions: rawBundle.definitions }) : null;
  if (!bundleOut?.ok) { p.add(K.INVALID_REQUEST, ["definitions"], "exact Ruleset bundle required"); return finish(p, () => null as never); }
  const bundle = bundleOut.value;
  const rules = bundle.definitions.filter((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  const policyDef = rules.length === 1 ? rules[0]! : null;
  const policy: ManeuverCostPolicy | undefined = policyDef ? (policyDef.payload as unknown as AbilityConstructionRulePayload).maneuverCostPolicy : undefined;
  if (!policyDef || !policy) { p.add(K.MISSING_POLICY, ["definitions"], "the exact Ruleset pins no Maneuver cost policy; Signature and minimum values are never defaulted"); return finish(p, () => null as never); }
  const policyRef = plan.durationConditions?.summary.policy ?? { entityId: policyDef.entityId, entityVersionId: policyDef.entityVersionId, canonicalKey: policyDef.canonicalKey, definitionKind: policyDef.definitionKind, systemFamily: policyDef.systemFamily };

  const steps: EvaluationStep[] = plan.evaluationPlan.steps.map((s) => clonePlainData(s));
  const entries: ProwessSourceMapEntry[] = plan.sourceMap.entries.map((e) => clonePlainData(e));
  const ref = plan.definition, subjectKey = plan.subject.subjectKey;
  const push = (step: Omit<EvaluationStep, "order">, entry: Omit<ProwessSourceMapEntry, "order" | "stepKey" | "operation">) => {
    if (steps.some((s) => s.stepKey === step.stepKey)) p.add(K.DUPLICATE_CONTRIBUTION, [step.stepKey], "duplicate compiled step identity");
    const order = steps.length;
    steps.push({ ...step, order } as EvaluationStep);
    entries.push({ ...entry, stepKey: step.stepKey, order, operation: step.operation });
    return step.stepKey;
  };
  const key = (k: string) => `wo11.${subjectKey}.${k}`;
  const formula = (k: string, slot: keyof ManeuverCostPolicy["formulas"], variables: Record<string, number>, bindings: EvaluationBinding[], role: string, definitions: readonly ProwessDefinitionRef[], componentKeys: readonly string[]) =>
    push({ stepKey: key(k), operation: "FORMULA", input: { program: { expression: policy.formulas[slot].expression, rounding: "NONE" }, variables } as unknown as JsonObject, bindings }, { role, componentKeys, definitions: [ref, policyRef, ...definitions] });
  const modifier = (modifierKey: string, targetKey: string, operation: string, phaseKey: string, phaseOrder: number, order: number, source: ProwessDefinitionRef, operand = 0) => ({
    modifierKey, targetKey, operation, operand, phase: { phaseKey, phaseOrder }, priority: 0, order, condition: null, stacking: { policy: "STACK" },
    source: { sourceType: "prowess.maneuver_cost", sourceKey: source.canonicalKey, sourceId: source.entityVersionId }, provenance: null,
  });
  const unresolved = (path: readonly string[], why: string) => p.add(K.UNRESOLVED_CONTRIBUTION, path, why);
  const unresolvedConflict = (d: ProwessDefinitionRef) => policy.unresolvedComponentCosts.find((u) => u.canonicalKey === d.canonicalKey)?.conflictKey ?? null;

  // ---- 0. Attachment structure: resolution groups, inherited weapon requirements, per-resolution Effects / Traits ------
  const authored = plan.authored as ManeuverDefinitionPayload;
  const pb = authored.powerfulBlow;
  const pbKey = pb ? `powerful_blow.${[...pb.actionKeys].sort().join(".")}` : null;
  const groupOf = (actionKey: string) => (pb?.actionKeys.includes(actionKey) ? pbKey! : actionKey);
  const effectGroup = (effectKey: string) => { const a = authored.effectAttachments.find((x) => x.effectKey === effectKey); return a ? groupOf(a.actionKeys[0]!) : null; };
  const groupTraits = (effects: readonly string[]) => plan.traits.filter((t) => t.scope.componentKey !== null && effects.includes(t.scope.componentKey)).map((t) => t.componentKey);
  const resolutionGroups: ManeuverResolutionGroup[] = [];
  for (const a of plan.actions) {
    const groupKey = groupOf(a.componentKey);
    if (resolutionGroups.some((g) => g.groupKey === groupKey)) continue;
    const members = plan.actions.filter((x) => groupOf(x.componentKey) === groupKey);
    const effects = authored.effectAttachments.filter((x) => effectGroup(x.effectKey) === groupKey).map((x) => x.effectKey);
    const attack = isAttackFoundation(a.profile) ? a.profile : null;
    resolutionGroups.push({
      groupKey, kind: groupKey === pbKey ? "POWERFUL_BLOW" : attack ? "ATTACK" : "ACTION", actionKeys: members.map((x) => x.componentKey), attack: attack ? a.definition : null, repetitions: members.length,
      inheritedRequirements: attack ? [{ kind: "WEAPON", weaponKey: attack.damage.weaponKey, attack: a.definition, grantsConditionDiscount: false, consumesConditionSlot: false, status: "REQUIREMENT_CONTRACT_ONLY" }] : [],
      effects, traits: groupTraits(effects),
    });
  }
  const attached = new Set(resolutionGroups.flatMap((g) => g.traits));
  const structure: ManeuverStructure = {
    actions: plan.actions.map((a) => ({ actionKey: a.componentKey, definition: a.definition, kind: isAttackFoundation(a.profile) ? "ATTACK" : "ACTION", category: a.profile.category, groupKey: groupOf(a.componentKey) })),
    resolutionGroups,
    separateAttackResolutions: resolutionGroups.filter((g) => g.kind !== "ACTION").length,
    maneuverScoped: { traits: plan.traits.filter((t) => !attached.has(t.componentKey)).map((t) => t.componentKey) },
  };

  // ---- 1. Exact component contributions (one per component USE; nothing priced from names or prose) ------------------
  const contributions: ManeuverCostContributionPlan[] = [];
  const seen = new Set<string>();
  const add = (c: Omit<ManeuverCostContributionPlan, "stepKey" | "affinity">, stepKey: string | null, scale: { units: number; included: number; rate: number } | null, affinity: ManeuverCostContributionPlan["affinity"] = null) => {
    const identity = `${c.source}:${c.componentKey}:${c.contributionKey}`;
    if (seen.has(identity)) { p.add(K.DUPLICATE_CONTRIBUTION, [c.componentKey, c.contributionKey], "a component use is counted exactly once"); return; }
    seen.add(identity);
    const s = stepKey ?? formula(`contribution.${String(contributions.length)}`, "contribution", scale as Record<string, number>, [], "maneuver-cost-contribution", [c.definition], [c.componentKey]);
    contributions.push({ ...c, stepKey: s, affinity });
  };
  const affinityProfile = (() => {
    const character = own(request, "character");
    const raw = isPlainObject(character) ? own(character, "affinityProfile") : undefined;
    if (raw === null || raw === undefined) return null;
    const out = validateAffinityProfile(raw, bundle);
    return out.ok ? out.value : null;
  })();
  const listed = (source: ManeuverCostSource, componentKey: string, definition: ProwessDefinitionRef, cost: EffectCostRule & { readonly selected: number | string | boolean | null }) => {
    const base = { contributionKey: cost.contributionKey, source, componentKey, definition, currency: cost.currency };
    if (cost.kind === "FIXED" && cost.affinityReduction) {
      // Effect-specific rule: the caster's highest rank among the EXACT listed relevant Affinities, never below the minimum.
      const r = cost.affinityReduction;
      const candidates: { affinity: ProwessDefinitionRef; rank: string; reduction: number }[] = [];
      for (const a of r.affinities) {
        if (!findBundleDefinition(bundle, a)) { unresolved([componentKey, cost.contributionKey], "a relevant Affinity must resolve in this exact Ruleset"); return; }
        const owned = affinityProfile?.affinities.find((o) => isSameExactDefinition(o.affinity, a));
        if (!owned) continue;
        const reduction = r.byRank[owned.rank];
        if (reduction === undefined) { unresolved([componentKey, cost.contributionKey], `no authored reduction for relevant Affinity rank ${owned.rank}`); return; }
        candidates.push({ affinity: a, rank: owned.rank, reduction });
      }
      const n = String(contributions.length);
      const reductionStep = push(
        { stepKey: key(`affinity.${n}`), operation: "MODIFIER", input: { request: { targets: [{ targetKey: REDUCTION, kind: "NUMERIC", value: 0 }], modifiers: candidates.map((c, i) => modifier(`${componentKey}.${c.affinity.canonicalKey}`, REDUCTION, "MAX", "maneuver.effect_affinity", 1, i, c.affinity, c.reduction)), facts: emptyFacts() } } as unknown as JsonObject, bindings: [] },
        { role: "maneuver-effect-affinity-reduction", componentKeys: [componentKey], definitions: [ref, definition, ...r.affinities] },
      );
      const adjusted = formula(`adjusted.${n}`, "affinityAdjusted", { minimum: r.minimum, amount: cost.amount, reduction: 0 }, [bind("/variables/reduction", reductionStep, "/data/finalTargets/0/value")], "maneuver-cost-contribution", [definition, ...r.affinities], [componentKey]);
      add({ ...base, rule: "FIXED_AFFINITY_ADJUSTED", selected: null }, adjusted, null, { listedAmount: cost.amount, minimum: r.minimum, reductionStepKey: reductionStep, candidates });
    } else if (cost.kind === "FIXED") add({ ...base, rule: "FIXED", selected: null }, null, { units: 1, included: 0, rate: cost.amount });
    else if (cost.kind === "PER_UNIT") {
      if (typeof cost.selected !== "number") return unresolved([componentKey, cost.contributionKey], "a PER_UNIT contribution needs its selected count");
      add({ ...base, rule: "PER_UNIT", selected: cost.selected }, null, { units: cost.selected, included: cost.includedUnits, rate: cost.amount });
    } else {
      const rate = typeof cost.selected === "string" ? cost.amounts[cost.selected] : undefined;
      if (rate === undefined) return unresolved([componentKey, cost.contributionKey], "a PER_SELECTION contribution needs one exact listed value for the selection");
      add({ ...base, rule: "PER_SELECTION", selected: cost.selected }, null, { units: 1, included: 0, rate });
    }
  };
  // Foundations / Attack uses: every authored action use contributes its exact AP once (repeated uses stay distinct).
  for (const a of plan.actions) {
    const costs = (findBundleDefinition(bundle, a.definition)!.payload as unknown as FoundationDefinitionPayload).costContributions;
    const conflict = unresolvedConflict(a.definition);
    if (conflict) { unresolved(["actions", a.componentKey], `the exact foundation cost is unresolved (${conflict})`); continue; }
    if (!costs.length) { unresolved(["actions", a.componentKey], "the foundation authors no AP cost; it is never priced from its name"); continue; }
    for (const c of costs) {
      const data = c.data as Record<string, unknown>;
      if (data.kind !== "FIXED" || !Number.isSafeInteger(data.amount) || (data.amount as number) < 0 || Object.keys(data).some((k) => k !== "kind" && k !== "amount") || !CURRENCIES.includes(c.currency)) { unresolved(["actions", a.componentKey, c.contributionKey], "a foundation cost is one exact FIXED AP / MP amount"); continue; }
      add({ contributionKey: c.contributionKey, source: "FOUNDATION", componentKey: a.componentKey, definition: a.definition, currency: c.currency as ManeuverCurrency, rule: "FIXED", selected: null }, null, { units: 1, included: 0, rate: data.amount as number });
    }
  }
  // Effects: one count per authored Effect INSTANCE, however many compiled views (resolution groups) it appears in.
  const costOptions: ManeuverCostOption[] = [];
  const counted = new Set<string>();
  for (const e of plan.effects) {
    const componentKey = e.plan.subject.componentKey;
    if (counted.has(componentKey)) continue;
    counted.add(componentKey);
    const def = e.plan.outputs.effect.definition, conflict = unresolvedConflict(def);
    if (conflict) { unresolved(["effects", componentKey], `the exact Effect cost is unresolved (${conflict})`); continue; }
    // AP-or-MP alternatives: PER_SELECTION costs in BOTH currencies keyed by one TOKEN parameter. The choice is authored.
    const byParameter = new Map<string, (typeof e.plan.outputs.costContributions)[number][]>();
    for (const c of e.plan.outputs.costContributions) if (c.kind === "PER_SELECTION") byParameter.set(c.parameter, [...(byParameter.get(c.parameter) ?? []), c]);
    for (const [parameter, costs] of byParameter) {
      if (new Set(costs.map((c) => c.currency)).size < 2) continue;
      const tokens = [...new Set(costs.flatMap((c) => (c.kind === "PER_SELECTION" ? Object.keys(c.amounts) : [])))].sort();
      const selectedParam = e.plan.outputs.parameters.find((q) => q.parameter === parameter);
      costOptions.push({ componentKey, definition: def, parameter, selected: typeof selectedParam?.value === "string" ? selectedParam.value : null, options: tokens.map((option) => ({ option, amounts: Object.fromEntries(costs.map((c) => [c.currency, c.kind === "PER_SELECTION" ? c.amounts[option] ?? 0 : 0])) })) });
      if (!selectedParam?.explicit) p.add(K.MISSING_COST_CHOICE, ["effects", componentKey, parameter], "an AP-or-MP cost option requires an explicit authored choice; it is never auto-selected");
    }
    for (const c of e.plan.outputs.costContributions) listed("EFFECT", componentKey, def, c);
  }
  // Traits (WO8): listed costs and exact COST / ADD of a selected count; other COST operations fail closed.
  for (const tr of plan.traits) {
    const conflict = unresolvedConflict(tr.definition);
    if (conflict) { unresolved(["traits", tr.componentKey], `the exact Trait cost is unresolved (${conflict})`); continue; }
    for (const c of tr.costs) listed("TRAIT", tr.componentKey, tr.definition, c);
    for (const m of tr.modifications) {
      if (m.modification.kind !== "COST") continue;
      if (m.modification.operation !== "ADD" || typeof m.selected !== "number") unresolved(["traits", tr.componentKey], `Trait COST ${m.modification.operation} has no authored Maneuver-cost meaning`);
      else add({ contributionKey: `${tr.componentKey}.cost.${m.modification.parameter}`, source: "TRAIT", componentKey: tr.componentKey, definition: tr.definition, currency: m.modification.currency, rule: "COST_ADD", selected: m.selected }, null, { units: m.selected, included: 0, rate: 1 });
    }
  }
  // WO9 Duration listed values and Maneuver Condition contributions — WO9's own steps, never recomputed or revalidated.
  const dc = plan.durationConditions;
  const conditionMpReductions: ProwessManeuverCostCompiledPlan["conditionMpReductions"][number][] = [];
  if (dc !== undefined) {
    for (const v of dc.duration.listedContributions) add({ contributionKey: v.contributionKey, source: "DURATION", componentKey: dc.duration.componentKey, definition: dc.duration.definition, currency: v.currency, rule: "WO9_LISTED", selected: v.selected }, v.listedStep, null);
    const inherited = resolutionGroups.some((g) => g.inheritedRequirements.length > 0);
    for (const c of dc.conditions) if (inherited && policy.inherentRestrictionKeys.includes(c.restriction)) p.add(K.REDUNDANT_RESTRICTION, ["conditions", c.componentKey], "the selected Attack already requires its weapon; restating it as a Condition grants no discount");
    for (const c of dc.conditions) for (const v of c.listedContributions) {
      if (v.modifier === "AP_REDUCTION") continue; // consumed ONLY through the WO9 effective (capped) total below
      if (v.modifier === "MP_REDUCTION") conditionMpReductions.push({ contributionKey: v.contributionKey, componentKey: c.componentKey, definition: c.definition, selectedOption: c.selectedCostOption, stepKey: v.listedStep });
      else if (v.modifier === "AP_COMMITMENT") add({ contributionKey: v.contributionKey, source: "MANEUVER_CONDITION", componentKey: c.componentKey, definition: c.definition, currency: "AP", rule: "WO9_LISTED", selected: v.selected }, v.listedStep, null);
      else unresolved(["conditions", c.componentKey, v.contributionKey], "a percentage reduction has no Maneuver-cost meaning; Spell netting is never applied to Maneuvers");
    }
  }
  if (p.count > 0) return finish(p, () => null as never);

  // ---- 2. Base AP and Base MP (independent currencies; MP never derived from AP) -----------------------------------
  const sum = (stepName: string, target: string, currency: ManeuverCurrency, role: string) => {
    const rows = ofCurrency(contributions, currency);
    return push(
      { stepKey: key(stepName), operation: "MODIFIER", input: { request: { targets: [{ targetKey: target, kind: "NUMERIC", value: 0 }], modifiers: rows.map((c, i) => modifier(`${c.componentKey}.${c.contributionKey}`, target, "ADD", `maneuver.${stepName}`, 1, i, c.definition)), facts: emptyFacts() } } as unknown as JsonObject, bindings: rows.map((c, i) => bind(`/request/modifiers/${String(i)}/operand`, c.stepKey)) },
      { role, componentKeys: [...new Set(rows.map((c) => c.componentKey))], definitions: [ref, ...rows.map((c) => c.definition)] },
    );
  };
  const baseAp = sum("base_ap", BASE_AP, "AP", "maneuver-base-ap");
  const baseMp = sum("base_mp", BASE_MP, "MP", "maneuver-base-mp");

  // ---- 3. Conditions (WO9 effective, ≤ 3 AP) → attack floor → Signature → final minimum -------------------------------
  const conditionApEffective = dc?.summary.maneuverAp.effectiveStep ?? null;
  const conditionReduced = formula("condition_reduced", "conditionReduced", { base: 0, reduction: 0 }, [bind("/variables/base", baseAp, "/data/finalTargets/0/value"), ...(conditionApEffective ? [bind("/variables/reduction", conditionApEffective)] : [])], "maneuver-condition-reduced-ap", dc ? dc.conditions.map((c) => c.definition) : [], dc ? dc.conditions.map((c) => c.componentKey) : []);
  const attackFloor = formula("attack_floor", "attackFloor", { minimum: policy.minimumAp, attacks: structure.separateAttackResolutions }, [], "maneuver-condition-attack-floor", plan.actions.map((a) => a.definition), plan.actions.map((a) => a.componentKey));
  const postConditionAp = push(
    { stepKey: key("post_condition_ap"), operation: "MODIFIER", input: { request: { targets: [{ targetKey: POST_AP, kind: "NUMERIC", value: 0 }], modifiers: [modifier("maneuver.condition_attack_floor", POST_AP, "MAX", "maneuver.condition_floor", 1, 0, policyRef)], facts: emptyFacts() } } as unknown as JsonObject, bindings: [bind("/request/targets/0/value", conditionReduced), bind("/request/modifiers/0/operand", attackFloor)] },
    { role: "maneuver-post-condition-ap", componentKeys: [], definitions: [ref, policyRef] },
  );
  const finalAp = push(
    {
      stepKey: key("final_ap"), operation: "MODIFIER",
      input: { request: { targets: [{ targetKey: FINAL_AP, kind: "NUMERIC", value: 0 }], modifiers: [
        ...(assigned ? [modifier("maneuver.signature", FINAL_AP, "SUBTRACT", "maneuver.signature", 1, 0, policyRef, policy.signatureApReduction)] : []),
        modifier("maneuver.minimum_ap", FINAL_AP, "MAX", "maneuver.minimum_ap", 2, 0, policyRef, policy.minimumAp),
      ], facts: emptyFacts() } } as unknown as JsonObject,
      bindings: [bind("/request/targets/0/value", postConditionAp, "/data/finalTargets/0/value")],
    },
    { role: "maneuver-final-ap", componentKeys: [], definitions: [ref, policyRef] },
  );
  // Only the explicitly SELECTED Condition MP options (WO9 already dropped the unselected AP-or-MP alternative).
  const conditionMp = push(
    { stepKey: key("condition_mp"), operation: "MODIFIER", input: { request: { targets: [{ targetKey: CONDITION_MP, kind: "NUMERIC", value: 0 }], modifiers: conditionMpReductions.map((c, i) => modifier(`${c.componentKey}.${c.contributionKey}`, CONDITION_MP, "ADD", "maneuver.condition_mp", 1, i, c.definition)), facts: emptyFacts() } } as unknown as JsonObject, bindings: conditionMpReductions.map((c, i) => bind(`/request/modifiers/${String(i)}/operand`, c.stepKey)) },
    { role: "maneuver-condition-mp-reduction", componentKeys: conditionMpReductions.map((c) => c.componentKey), definitions: [ref, ...conditionMpReductions.map((c) => c.definition)] },
  );
  const finalMp = push(
    {
      stepKey: key("final_mp"), operation: "MODIFIER",
      input: { request: { targets: [{ targetKey: FINAL_MP, kind: "NUMERIC", value: 0 }], modifiers: [
        modifier("maneuver.condition_mp", FINAL_MP, "SUBTRACT", "maneuver.condition_mp", 1, 0, policyRef),
        modifier("maneuver.minimum_mp", FINAL_MP, "MAX", "maneuver.minimum_mp", 2, 0, policyRef, policy.minimumMp),
      ], facts: emptyFacts() } } as unknown as JsonObject,
      bindings: [bind("/request/targets/0/value", baseMp, "/data/finalTargets/0/value"), bind("/request/modifiers/0/operand", conditionMp, "/data/finalTargets/0/value")],
    },
    { role: "maneuver-final-mp", componentKeys: conditionMpReductions.map((c) => c.componentKey), definitions: [ref, policyRef, ...conditionMpReductions.map((c) => c.definition)] },
  );

  // ---- 4. Explanation of every cost step -------------------------------------------------------------------------------
  const explained = steps.slice(plan.evaluationPlan.steps.length);
  const explanation = push(
    { stepKey: key("explanation"), operation: "EXPLANATION", input: { input: { explanationKey: key("explanation"), contributions: explained.map((s, i) => ({ contributionKey: s.stepKey, order: i, kind: s.operation === "FORMULA" ? "FORMULA" : "MODIFIER", response: null })) } } as unknown as JsonObject, bindings: explained.map((s, i) => bind(`/input/contributions/${String(i)}/response`, s.stepKey, "")) },
    { role: "maneuver-cost-explanation", componentKeys: [], definitions: [ref] },
  );
  if (p.count > 0) return finish(p, () => null as never);
  return finish(p, () => deepFreeze(clonePlainData({
    contractVersion: 1 as const,
    subject: { kind: "MANEUVER_COST" as const, subjectKey },
    rulesetProvenance: plan.rulesetProvenance,
    definition: ref,
    evaluationPlan: { steps, primaryStepKey: finalAp, validationStepKey: null, explanationStepKey: explanation },
    sourceMap: { entries },
    ability: plan,
    policy: { definition: policyRef, signatureApReduction: policy.signatureApReduction, minimumAp: policy.minimumAp, minimumMp: policy.minimumMp },
    structure, contributions, costOptions, conditionMpReductions,
    signature: { assigned, reduction: assigned ? policy.signatureApReduction : 0 },
    steps: { baseAp, baseMp, conditionApEffective, conditionReducedAp: conditionReduced, attackFloor, postConditionAp, finalAp, conditionMp, finalMp, explanation },
  })));
}

/** Reads an M4 run of a Maneuver cost plan. Every number comes from M4; nothing here computes. */
export function readManeuverCostRun(plan: ProwessManeuverCostCompiledPlan, run: unknown): ProwessOutcome<ManeuverCostResult> {
  const p = new Problems();
  if (!checkPlainData(run, [], p, K.INCOMPLETE_RUN)) return finish(p, () => null as never);
  if (!isPlainObject(run) || !Array.isArray(run.steps)) { p.add(K.INCOMPLETE_RUN, [], "exact EvaluationRun required"); return finish(p, () => null as never); }
  const full = run as unknown as EvaluationRun, planned = plan.evaluationPlan.steps;
  if (full.executionStatus !== "COMPLETE" || full.primaryStepKey !== plan.evaluationPlan.primaryStepKey || full.explanationStepKey !== plan.evaluationPlan.explanationStepKey || full.steps.length !== planned.length ||
    planned.some((s) => !full.steps.some((x) => x.stepKey === s.stepKey && x.operation === s.operation && x.order === s.order && x.executionStatus === "EXECUTED" && x.response?.success === true && JSON.stringify(clonePlainData(x.response.ruleset ?? null)) === JSON.stringify(clonePlainData(plan.rulesetProvenance))))) {
    p.add(K.INCOMPLETE_RUN, [], "every planned step must execute successfully under the plan's exact Ruleset");
    return finish(p, () => null as never);
  }
  const data = (stepKey: string) => full.steps.find((s) => s.stepKey === stepKey)!.response!.data as Record<string, unknown>;
  const num = (stepKey: string) => data(stepKey).finalValue as number;
  const target = (stepKey: string) => ((data(stepKey).finalTargets as { value: number }[])[0] as { value: number }).value;
  const outcomes = (stepKey: string) => data(stepKey).outcomes as { modifierKey: string; status: string }[];
  const abilitySteps = new Set(plan.ability.evaluationPlan.steps.map((s) => s.stepKey));
  const authored = readAbilityDefinitionRun(plan.ability, { ...full, primaryStepKey: null, validationStepKey: null, explanationStepKey: plan.ability.explanationStepKey, steps: full.steps.filter((s) => abilitySteps.has(s.stepKey)) });
  if (!authored.ok) return authored as ProwessOutcome<never>;
  const cap = authored.value.durationConditions?.conditionSummary.maneuverAp ?? { listed: 0, effective: 0, maximum: 3 };
  const resolved = plan.contributions.map((c) => ({ ...c, value: num(c.stepKey) }));
  const mpReductions = plan.conditionMpReductions.map((c) => ({ ...c, value: num(c.stepKey) }));
  const problems = [...authored.value.problems];
  return finish(p, () => deepFreeze(clonePlainData({
    status: problems.length === 0 ? ("VALID" as const) : ("INVALID" as const),
    valid: problems.length === 0,
    definition: plan.definition,
    rulesetProvenance: plan.rulesetProvenance,
    authored: authored.value,
    structure: plan.structure,
    costOptions: plan.costOptions,
    ap: {
      contributions: ofCurrency(resolved, "AP"),
      baseApCost: target(plan.steps.baseAp),
      conditions: { listedApReduction: cap.listed, effectiveApReduction: cap.effective, maximumApReduction: cap.maximum },
      conditionReducedApCost: num(plan.steps.conditionReducedAp),
      separateAttackResolutions: plan.structure.separateAttackResolutions,
      conditionAttackFloor: num(plan.steps.attackFloor),
      postConditionApCost: target(plan.steps.postConditionAp),
      signature: { assigned: plan.signature.assigned, reduction: plan.signature.reduction, applied: outcomes(plan.steps.finalAp).some((o) => o.modifierKey === "maneuver.signature" && o.status === "APPLIED") },
      finalApCost: target(plan.steps.finalAp),
    },
    mp: {
      contributions: ofCurrency(resolved, "MP"),
      baseMpCost: target(plan.steps.baseMp),
      conditionReductions: mpReductions,
      conditionMpReduction: target(plan.steps.conditionMp),
      finalMpCost: target(plan.steps.finalMp),
    },
    steps: plan.steps,
    problems,
  })));
}

/** compile → M4 → read, in one pure call. */
export function evaluateManeuverCost(request: unknown): ProwessOutcome<ManeuverCostResult> {
  const plan = compileManeuverCost(request);
  if (!plan.ok) return plan as ProwessOutcome<never>;
  const response = orchestrateRulesEvaluation({ evaluationKey: `maneuver-cost.${plan.value.subject.subjectKey}`, contexts: { ruleset: (request as Record<string, unknown>).ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) { const p = new Problems(); p.add(K.INCOMPLETE_RUN, [], "M4 could not evaluate the Maneuver cost plan"); return finish(p, () => null as never); }
  return readManeuverCostRun(plan.value, response.data);
}
