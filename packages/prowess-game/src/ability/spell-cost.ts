import type { JsonObject } from "@prowess/model";
import { orchestrateRulesEvaluation, type EvaluationBinding, type EvaluationPlan, type EvaluationRun, type EvaluationStep } from "@prowess/rules";
import { compileAffinity, type ProwessAffinityCompiledPlan } from "../affinity/compile.js";
import type { ProwessCompilationSourceMap, ProwessSourceMapEntry } from "../compilation/model.js";
import { SPELL_COST_POLICY } from "../content/core-playtest-v0.1/spell-cost.js";
import type { EffectCostRule } from "../definition/effect-payload.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { SpellDefinitionPayload } from "../definition/authored-ability-payload.js";
import type { ProwessRulesetProvenance } from "../bundle/bundle.js";
import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, own, type ProwessOutcome } from "../internal/problems.js";
import { compileAbilityDefinition, readAbilityDefinitionRun, type AuthoredAbilityResult, type ProwessAbilityDefinitionCompiledPlan } from "./compile.js";

/**
 * M5-WO10 FINAL SPELL COST, PERCENTAGE NETTING & AP DERIVATION. Composes with — never replaces — the canonical authored
 * Ability compiler (WO8) and consumes the permanent component outputs:
 *
 *   WO6 Targeting listed contributions · WO7 Effect listed contributions · WO8 Trait listed contributions (and exact
 *   COST/ADD modifications) · WO9 Duration listed values, the EFFECTIVE (30%-capped) Casting Condition MP reduction and
 *   listed AP modifiers (Somatic, Charge) · WO4 Affinity Strength / highest-Weakness percentage stages.
 *
 * The M4 plan, appended after the authored plan:
 *
 *   FORMULA  wo10.contribution.<n>      — each listed component contribution (max(0, units − included) × rate)
 *   MODIFIER wo10.base_mp               — constructed base MP: ADD every MP contribution, SUBTRACT exact flat reductions
 *   MODIFIER wo10.net_percent           — ONE net percentage: 100 − Strength + Weakness (the WO4 stages, verbatim) −
 *                                         the WO9 effective Casting Condition reduction (M5-SC-028)
 *   FORMULA  wo10.unrounded_mp          — base × net ÷ 100, applied ONCE, unrounded
 *   REQUIREMENT wo10.non_negative       — an unsupported negative final MP fails closed (never clamped)
 *   FORMULA  wo10.final_mp              — the ONE final rounding: normal, 0.5 up
 *   FORMULA  wo10.base_ap               — max(1, floor(final MP ÷ PRO))
 *   MODIFIER wo10.final_ap              — explicit AP modifiers AFTER base AP, then MAX 1 (no maximum)
 *   EXPLANATION wo10.explanation        — every cost step, for the Rules Inspector
 *
 * WO10 calculates the price; it never pays it: no MP / ME / AP / HP mutation, no Mana Efficiency (payment capacity, not a
 * discount), no Channeling, Sustain, Mana Lock lifecycle or Concentration (WO13), no Effect Chain (WO12), no Maneuver cost
 * (WO11), no dynamic Metamagic and no Signature discount without structured authority.
 */

export const SPELL_COST_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "PROWESS_SPELL_COST.INVALID_REQUEST",
  /** Final Maneuver cost belongs to M5-WO11. */
  SPELL_ONLY: "PROWESS_SPELL_COST.SPELL_ONLY",
  /** Spell AP needs the caster's exact Prowess Score: never defaulted, inferred or zero. */
  INVALID_PRO: "PROWESS_SPELL_COST.INVALID_PRO",
  /** A listed contribution has no exact executable value (a deferred base, an unresolved scaling rule, an unauthorized operation). */
  UNRESOLVED_CONTRIBUTION: "PROWESS_SPELL_COST.UNRESOLVED_CONTRIBUTION",
  DUPLICATE_CONTRIBUTION: "PROWESS_SPELL_COST.DUPLICATE_CONTRIBUTION",
  /** The structured modifier graph produced a negative final MP: fail closed, never clamp. */
  NEGATIVE_FINAL_MP: "PROWESS_SPELL_COST.NEGATIVE_FINAL_MP",
  INCOMPLETE_RUN: "PROWESS_SPELL_COST.INCOMPLETE_RUN",
});
const K = SPELL_COST_ERROR_CODES;

export type SpellCostSource = "TARGETING" | "EFFECT" | "TRAIT" | "DURATION" | "CASTING_CONDITION";
export type SpellCostOperation = "ADD_MP" | "SUBTRACT_MP" | "ADD_AP" | "SUBTRACT_AP";
/** A listed contribution's structured currency selects its ADD operation (vocabulary lookup, not a Resource-name branch). */
const ADD_OPERATION: Readonly<Record<"MP" | "AP", SpellCostOperation>> = { MP: "ADD_MP", AP: "ADD_AP" };

/** One listed contribution and the M4 step that computes its value. */
export interface SpellCostContributionPlan {
  readonly contributionKey: string;
  readonly source: SpellCostSource;
  readonly componentKey: string;
  readonly definition: ProwessDefinitionRef;
  readonly operation: SpellCostOperation;
  readonly rule: string;
  readonly selected: number | string | boolean | null;
  readonly stepKey: string;
}

export interface SpellCostPercentPlan {
  readonly modifierKey: string;
  readonly source: "AFFINITY_STRENGTH" | "AFFINITY_WEAKNESS" | "CASTING_CONDITIONS";
  readonly definitions: readonly ProwessDefinitionRef[];
}

export interface ProwessSpellCostCompiledPlan {
  readonly contractVersion: 1;
  readonly subject: { readonly kind: "SPELL_COST"; readonly subjectKey: string };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly definition: ProwessDefinitionRef;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  /** The canonical authored Ability plan this cost plan extends (its steps are the first steps of `evaluationPlan`). */
  readonly ability: ProwessAbilityDefinitionCompiledPlan;
  /** The WO4 Affinity steps included (null when the Spell has no governing Affinity). Its listed-cost step is never included. */
  readonly affinity: { readonly governing: ProwessDefinitionRef; readonly stepKeys: readonly string[] } | null;
  readonly contributions: readonly SpellCostContributionPlan[];
  readonly percentages: readonly SpellCostPercentPlan[];
  readonly pro: number;
  readonly steps: {
    readonly baseMp: string;
    readonly netPercent: string;
    readonly unroundedMp: string;
    readonly nonNegative: string;
    readonly finalMp: string;
    readonly baseAp: string;
    readonly finalAp: string;
    readonly explanation: string;
  };
}

export interface SpellCostResult {
  readonly status: "VALID" | "INVALID";
  readonly valid: boolean;
  readonly definition: ProwessDefinitionRef;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly authored: AuthoredAbilityResult;
  readonly mp: {
    readonly contributions: readonly (Omit<SpellCostContributionPlan, "stepKey"> & { readonly value: number; readonly stepKey: string })[];
    readonly baseMpCost: number;
  };
  readonly percentageContributions: readonly { readonly modifierKey: string; readonly source: SpellCostPercentPlan["source"]; readonly operation: string; readonly percent: number; readonly applied: boolean; readonly definitions: readonly ProwessDefinitionRef[] }[];
  /** Casting Conditions as WO9 reported them: listed (raw) and effective (capped at the flat 30%). Only `effective` is consumed. */
  readonly castingConditions: { readonly listedPercent: number; readonly effectivePercent: number; readonly maximumPercent: number } | null;
  readonly netCostPercent: number;
  readonly unroundedFinalMpCost: number;
  readonly rounding: { readonly mode: "NORMAL_HALF_UP_ONCE"; readonly stepKey: string };
  readonly finalMpCost: number;
  readonly ap: {
    readonly pro: number;
    readonly baseApCost: number;
    readonly modifiers: readonly { readonly contributionKey: string; readonly operation: string; readonly value: number; readonly applied: boolean }[];
    readonly finalApCost: number;
  };
  readonly steps: ProwessSpellCostCompiledPlan["steps"];
  readonly problems: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

const POLICY = SPELL_COST_POLICY;
const BASE_TARGET = "spell.base_mp_cost";
const NET_TARGET = "spell.net_cost_percent";
const AP_TARGET = "spell.ap_cost";
const CONDITIONS_MODIFIER = "spell.casting_conditions";
const bind = (target: string, stepKey: string, pointer = "/data/finalValue"): EvaluationBinding => ({ target, source: { kind: "STEP", stepKey, pointer } });
const emptyFacts = (): JsonObject => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: null, keywords: null });

/** Compiles the exact authored Spell and its final cost into ONE M4 plan. Pure; never mutates its input. */
export function compileSpellCost(request: unknown): ProwessOutcome<ProwessSpellCostCompiledPlan> {
  const p = new Problems();
  if (!checkPlainData(request, [], p, K.INVALID_REQUEST)) return finish(p, () => null as never);
  const ability = compileAbilityDefinition(request);
  if (!ability.ok) return ability as ProwessOutcome<never>;
  const plan = ability.value;
  const r = request as Record<string, unknown>;
  if (plan.subject.abilityKind !== "SPELL") {
    p.add(K.SPELL_ONLY, ["definition"], "WO10 prices Spells only; final Maneuver cost is M5-WO11");
    return finish(p, () => null as never);
  }
  // Spell AP needs the exact Prowess Score from the existing WO2 character contract — never a default.
  const stats = isPlainObject(own(r, "character")) ? own(own(r, "character") as Record<string, unknown>, "stats") : undefined;
  const pro = isPlainObject(stats) ? own(stats, "PRO") : undefined;
  if (typeof pro !== "number" || !Number.isSafeInteger(pro) || pro < POLICY.minimumAp) {
    p.add(K.INVALID_PRO, ["character", "stats", "PRO"], "Spell AP divides final MP by the caster's Prowess Score: an explicit positive integer is required");
    return finish(p, () => null as never);
  }

  const steps: EvaluationStep[] = plan.evaluationPlan.steps.map((s) => clonePlainData(s));
  const entries: ProwessSourceMapEntry[] = plan.sourceMap.entries.map((e) => clonePlainData(e));
  const spellRef = plan.definition;
  const subjectKey = plan.subject.subjectKey;
  const push = (step: Omit<EvaluationStep, "order">, entry: Omit<ProwessSourceMapEntry, "order" | "stepKey" | "operation">) => {
    if (steps.some((s) => s.stepKey === step.stepKey)) p.add(K.DUPLICATE_CONTRIBUTION, [step.stepKey], "duplicate compiled step identity");
    const order = steps.length;
    steps.push({ ...step, order } as EvaluationStep);
    entries.push({ ...entry, stepKey: step.stepKey, order, operation: step.operation });
    return step.stepKey;
  };
  const key = (k: string) => `wo10.${subjectKey}.${k}`;
  const formula = (k: string, slot: keyof typeof POLICY.formulas, variables: Record<string, number>, bindings: EvaluationBinding[], role: string, definitions: readonly ProwessDefinitionRef[], componentKeys: readonly string[]) =>
    push({ stepKey: key(k), operation: "FORMULA", input: { program: { expression: POLICY.formulas[slot].expression, rounding: "NONE" }, variables } as unknown as JsonObject, bindings }, { role, componentKeys, definitions: [spellRef, ...definitions] });

  // ---- 1. Listed component contributions (exact WO6 / WO7 / WO8 / WO9 outputs; nothing re-priced) -------------------
  const contributions: SpellCostContributionPlan[] = [];
  const seen = new Set<string>();
  const add = (c: Omit<SpellCostContributionPlan, "stepKey">, stepKey: string | null, scale: { units: number; included: number; rate: number } | null) => {
    const identity = `${c.source}:${c.componentKey}:${c.contributionKey}`;
    if (seen.has(identity)) {
      p.add(K.DUPLICATE_CONTRIBUTION, [c.componentKey, c.contributionKey], "a component contribution is counted exactly once");
      return;
    }
    seen.add(identity);
    const s = stepKey ?? formula(`contribution.${String(contributions.length)}`, "contribution", scale as Record<string, number>, [], "spell-cost-contribution", [c.definition], [c.componentKey]);
    contributions.push({ ...c, stepKey: s });
  };
  const unresolved = (path: readonly string[], why: string) => p.add(K.UNRESOLVED_CONTRIBUTION, path, why);
  const listed = (source: SpellCostSource, componentKey: string, definition: ProwessDefinitionRef, cost: EffectCostRule & { readonly selected: number | string | boolean | null }) => {
    const operation: SpellCostOperation = ADD_OPERATION[cost.currency];
    if (cost.kind === "FIXED") add({ contributionKey: cost.contributionKey, source, componentKey, definition, operation, rule: "FIXED", selected: null }, null, { units: 1, included: 0, rate: cost.amount });
    else if (cost.kind === "PER_UNIT") {
      if (typeof cost.selected !== "number") return unresolved([componentKey, cost.contributionKey], "a PER_UNIT contribution needs its selected count");
      add({ contributionKey: cost.contributionKey, source, componentKey, definition, operation, rule: "PER_UNIT", selected: cost.selected }, null, { units: cost.selected, included: cost.includedUnits, rate: cost.amount });
    } else {
      const rate = typeof cost.selected === "string" ? cost.amounts[cost.selected] : undefined;
      if (rate === undefined) return unresolved([componentKey, cost.contributionKey], "a PER_SELECTION contribution needs one exact listed value for the selection");
      add({ contributionKey: cost.contributionKey, source, componentKey, definition, operation, rule: "PER_SELECTION", selected: cost.selected }, null, { units: 1, included: 0, rate });
    }
  };
  // WO6 Targeting.
  const t = plan.targeting.outputs;
  if (t.cost.base.status === "DEFERRED_PENDING_CANON") unresolved(["targeting", t.cost.base.contributionKey], `the Targeting base cost is DEFERRED_PENDING_CANON (${t.cost.base.conflictKey})`);
  else if (t.cost.base.status === "LISTED") add({ contributionKey: t.cost.base.contributionKey, source: "TARGETING", componentKey: t.targeting.componentKey, definition: t.targeting.definition, operation: "ADD_MP", rule: "BASE", selected: null }, null, { units: 1, included: 0, rate: t.cost.base.amount });
  for (const s of t.cost.scaling) {
    const c = { contributionKey: s.contributionKey, source: "TARGETING" as const, componentKey: t.targeting.componentKey, definition: t.targeting.definition, operation: "ADD_MP" as const, selected: s.selected };
    if (s.kind === "PER_STEP") {
      if (typeof s.selected !== "number") unresolved(["targeting", s.contributionKey], "a PER_STEP selection is a count");
      else add({ ...c, rule: "PER_STEP" }, null, { units: s.selected, included: 0, rate: s.amount });
    } else if (s.kind === "PER_SELECTION") add({ ...c, rule: "PER_SELECTION" }, null, { units: s.values !== null && typeof s.selected !== "number" && s.selected !== null && s.values.includes(s.selected) ? 1 : 0, included: 0, rate: s.amount });
    // M5-SC-046: no authored base target count exists for "+1 Multi-Target target"; a selected count cannot be priced.
    else if (s.selected !== null) unresolved(["targeting", s.contributionKey], "M5-SC-046: the number of Multi-Target targets the base cost covers is not authored; additional-target pricing stays unresolved");
  }
  // WO7 Effects (each exact Effect use once).
  for (const e of plan.effects) for (const c of e.plan.outputs.costContributions) listed("EFFECT", e.plan.subject.componentKey, e.plan.outputs.effect.definition, c);
  // WO8 Traits: listed contributions, and the exact COST/ADD modification (a structured flat addition); MULTIPLY / SET
  // have no authored meaning for total Spell cost and fail closed.
  for (const tr of plan.traits) {
    for (const c of tr.costs) listed("TRAIT", tr.componentKey, tr.definition, c);
    for (const m of tr.modifications) {
      if (m.modification.kind !== "COST") continue;
      if (m.modification.operation !== "ADD" || typeof m.selected !== "number") unresolved(["traits", tr.componentKey], `Trait COST ${m.modification.operation} has no authored Spell-cost meaning; only an exact ADD of a selected count is executable`);
      else add({ contributionKey: `${tr.componentKey}.cost.${m.modification.parameter}`, source: "TRAIT", componentKey: tr.componentKey, definition: tr.definition, operation: ADD_OPERATION[m.modification.currency], rule: "COST_ADD", selected: m.selected }, null, { units: m.selected, included: 0, rate: 1 });
    }
  }
  // WO9 Duration and Casting Condition listed values — the WO9 steps themselves, never recomputed.
  const dc = plan.durationConditions;
  if (dc !== undefined) {
    for (const v of dc.duration.listedContributions) add({ contributionKey: v.contributionKey, source: "DURATION", componentKey: dc.duration.componentKey, definition: dc.duration.definition, operation: ADD_OPERATION[v.currency], rule: "WO9_LISTED", selected: v.selected }, v.listedStep, null);
    for (const c of dc.conditions) {
      for (const v of c.listedContributions) {
        const operation: SpellCostOperation | null = v.modifier === "AP_REDUCTION" ? "SUBTRACT_AP" : v.modifier === "AP_COMMITMENT" ? "ADD_AP" : v.modifier === "MP_REDUCTION" ? "SUBTRACT_MP" : null;
        if (operation !== null) add({ contributionKey: v.contributionKey, source: "CASTING_CONDITION", componentKey: c.componentKey, definition: c.definition, operation, rule: "WO9_LISTED", selected: v.selected }, v.listedStep, null);
      }
    }
  }
  if (p.count > 0) return finish(p, () => null as never);
  const provenance = { sourceType: "prowess.spell_cost", sourceKey: spellRef.canonicalKey, sourceId: spellRef.entityVersionId };
  const modifier = (modifierKey: string, targetKey: string, operation: string, phaseKey: string, phaseOrder: number, order: number, sourceRef: ProwessDefinitionRef) => ({
    modifierKey,
    targetKey,
    operation,
    operand: 0,
    phase: { phaseKey, phaseOrder },
    priority: 0,
    order,
    condition: null,
    stacking: { policy: "STACK" },
    source: { sourceType: "prowess.spell_cost", sourceKey: sourceRef.canonicalKey, sourceId: sourceRef.entityVersionId },
    provenance: null,
  });

  // ---- 2. Constructed base MP (M4 MODIFIER: ADD each MP contribution, SUBTRACT exact flat reductions) ----------------
  const mp = contributions.filter((c) => c.operation === "ADD_MP" || c.operation === "SUBTRACT_MP");
  const baseMp = push(
    {
      stepKey: key("base_mp"),
      operation: "MODIFIER",
      input: { request: { targets: [{ targetKey: BASE_TARGET, kind: "NUMERIC", value: 0 }], modifiers: mp.map((c, i) => modifier(c.contributionKey, BASE_TARGET, c.operation === "ADD_MP" ? "ADD" : "SUBTRACT", "spell.base_mp", 1, i, c.definition)), facts: emptyFacts() } } as unknown as JsonObject,
      bindings: mp.map((c, i) => bind(`/request/modifiers/${String(i)}/operand`, c.stepKey)),
    },
    { role: "spell-base-mp", componentKeys: [...new Set(mp.map((c) => c.componentKey))], definitions: [spellRef, ...mp.map((c) => c.definition)] },
  );

  // ---- 3. ONE net percentage (M5-SC-028): the WO4 Strength / Weakness stages + the WO9 EFFECTIVE Condition reduction --
  const percentages: SpellCostPercentPlan[] = [];
  const netModifiers: JsonObject[] = [];
  const netBindings: EvaluationBinding[] = [];
  let affinity: ProwessSpellCostCompiledPlan["affinity"] = null;
  const composition = (plan.authored as SpellDefinitionPayload).composition as unknown as Record<string, unknown>;
  if (composition.affinity !== null && composition.affinity !== undefined) {
    // Reuse WO4: its compiled Strength / Weakness stages are taken verbatim. Its listed-cost step (× net ÷ 100) and its own
    // net step are NOT included — Affinity is consumed exactly once, inside the single Spell net percentage.
    const character = own(r, "character") as Record<string, unknown>;
    const wo4 = compileAffinity({ contractVersion: 1, subject: { kind: "SPELL_AFFINITY_COST", subjectKey: `${subjectKey}.affinity`, composition, costTarget: "LISTED_MP_COST", baseCost: 0 }, definitions: own(r, "definitions"), ruleset: own(r, "ruleset"), profile: own(character, "affinityProfile") ?? null, keywords: own(r, "keywords") });
    if (!wo4.ok) return wo4 as ProwessOutcome<never>;
    const a: ProwessAffinityCompiledPlan = wo4.value;
    if (a.outputs.cost === null || a.outputs.governing === null) {
      p.add(K.UNRESOLVED_CONTRIBUTION, ["affinity"], "the governing Affinity produced no Spell cost stages");
      return finish(p, () => null as never);
    }
    const excluded = new Set([a.outputs.cost.stepKey, a.outputs.cost.netStepKey]);
    const kept: string[] = [];
    for (const s of a.evaluationPlan.steps) {
      if (excluded.has(s.stepKey)) continue;
      const entry = a.sourceMap.entries.find((e) => e.stepKey === s.stepKey)!;
      kept.push(push({ stepKey: s.stepKey, operation: s.operation, input: clonePlainData(s.input), bindings: clonePlainData(s.bindings) }, { role: entry.role, componentKeys: entry.componentKeys, definitions: [spellRef, ...entry.definitions] }));
    }
    const net = a.evaluationPlan.steps.find((s) => s.stepKey === a.outputs.cost!.netStepKey)!;
    const request = (net.input as { request: { modifiers: JsonObject[] } }).request;
    for (const m of request.modifiers) netModifiers.push({ ...clonePlainData(m), targetKey: NET_TARGET });
    for (const b of net.bindings) netBindings.push(clonePlainData(b));
    if (a.outputs.cost.strengthModifierKey !== null) percentages.push({ modifierKey: a.outputs.cost.strengthModifierKey, source: "AFFINITY_STRENGTH", definitions: [a.outputs.governing.affinity, a.outputs.governing.rankRule] });
    if (a.outputs.cost.weaknessModifierKey !== null) percentages.push({ modifierKey: a.outputs.cost.weaknessModifierKey, source: "AFFINITY_WEAKNESS", definitions: [a.outputs.governing.affinity] });
    affinity = { governing: a.outputs.governing.affinity, stepKeys: kept };
  }
  if (dc !== undefined) {
    // WO9's EFFECTIVE reduction (min(listed, 30)) — never the raw listed total, never a rank-based cap.
    const index = netModifiers.length;
    netModifiers.push(modifier(CONDITIONS_MODIFIER, NET_TARGET, "SUBTRACT", "spell.net_cost_percent", 2, index, dc.summary.policy) as unknown as JsonObject);
    netBindings.push(bind(`/request/modifiers/${String(index)}/operand`, dc.summary.spellMpPercent.effectiveStep));
    percentages.push({ modifierKey: CONDITIONS_MODIFIER, source: "CASTING_CONDITIONS", definitions: [dc.summary.policy, ...dc.conditions.map((c) => c.definition)] });
  }
  const netPercent = push(
    { stepKey: key("net_percent"), operation: "MODIFIER", input: { request: { targets: [{ targetKey: NET_TARGET, kind: "NUMERIC", value: POLICY.fullPricePercent }], modifiers: netModifiers, facts: emptyFacts() } } as unknown as JsonObject, bindings: netBindings },
    { role: "spell-net-cost-percent", componentKeys: [], definitions: [spellRef, ...percentages.flatMap((q) => q.definitions)] },
  );

  // ---- 4. Applied once; rounded once ----------------------------------------------------------------------------------
  const unrounded = formula("unrounded_mp", "unrounded", { base: 0, net: 0 }, [bind("/variables/base", baseMp, "/data/finalTargets/0/value"), bind("/variables/net", netPercent, "/data/finalTargets/0/value")], "spell-unrounded-final-mp", [], []);
  const nonNegative = push(
    { stepKey: key("non_negative"), operation: "REQUIREMENT", input: { requirement: { kind: "NUMERIC_COMPARE", factKey: "spell.unrounded_mp", operator: ">=", expected: 0, provenance: null }, facts: { ...emptyFacts(), numeric: [{ key: "spell.unrounded_mp", value: 0, provenance: null }] } } as unknown as JsonObject, bindings: [bind("/facts/numeric/0/value", unrounded)] },
    { role: "spell-final-mp-non-negative", componentKeys: [], definitions: [spellRef] },
  );
  const finalMp = formula("final_mp", "finalMp", { unrounded: 0 }, [bind("/variables/unrounded", unrounded)], "spell-final-mp-rounding", [], []);

  // ---- 5. AP: derived only from final MP, then explicit modifiers, then the minimum ------------------------------------
  const baseAp = formula("base_ap", "baseAp", { final_mp: 0, pro }, [bind("/variables/final_mp", finalMp)], "spell-base-ap", [], []);
  const apMods = contributions.filter((c) => c.operation === "ADD_AP" || c.operation === "SUBTRACT_AP");
  const finalAp = push(
    {
      stepKey: key("final_ap"),
      operation: "MODIFIER",
      input: {
        request: {
          targets: [{ targetKey: AP_TARGET, kind: "NUMERIC", value: 0 }],
          modifiers: [
            ...apMods.map((c, i) => modifier(c.contributionKey, AP_TARGET, c.operation === "ADD_AP" ? "ADD" : "SUBTRACT", "spell.ap_modifiers", 1, i, c.definition)),
            { ...modifier("spell.minimum_ap", AP_TARGET, "MAX", "spell.ap_minimum", 2, 0, spellRef), operand: POLICY.minimumAp, source: provenance },
          ],
          facts: emptyFacts(),
        },
      } as unknown as JsonObject,
      bindings: [bind("/request/targets/0/value", baseAp), ...apMods.map((c, i) => bind(`/request/modifiers/${String(i)}/operand`, c.stepKey))],
    },
    { role: "spell-final-ap", componentKeys: [...new Set(apMods.map((c) => c.componentKey))], definitions: [spellRef, ...apMods.map((c) => c.definition)] },
  );

  // ---- 6. Explanation of every cost step -------------------------------------------------------------------------------
  const explained = steps.slice(plan.evaluationPlan.steps.length);
  const explanation = push(
    {
      stepKey: key("explanation"),
      operation: "EXPLANATION",
      input: { input: { explanationKey: key("explanation"), contributions: explained.map((s, i) => ({ contributionKey: s.stepKey, order: i, kind: s.operation === "FORMULA" ? "FORMULA" : s.operation === "KEYWORD" ? "KEYWORD" : s.operation === "MODIFIER" ? "MODIFIER" : "REQUIREMENT", response: null })) } } as unknown as JsonObject,
      bindings: explained.map((s, i) => bind(`/input/contributions/${String(i)}/response`, s.stepKey, "")),
    },
    { role: "spell-cost-explanation", componentKeys: [], definitions: [spellRef] },
  );
  if (p.count > 0) return finish(p, () => null as never);
  return finish(p, () =>
    deepFreeze(clonePlainData({
      contractVersion: 1 as const,
      subject: { kind: "SPELL_COST" as const, subjectKey },
      rulesetProvenance: plan.rulesetProvenance,
      definition: spellRef,
      evaluationPlan: { steps, primaryStepKey: finalMp, validationStepKey: null, explanationStepKey: explanation },
      sourceMap: { entries },
      ability: plan,
      affinity,
      contributions,
      percentages,
      pro,
      steps: { baseMp, netPercent, unroundedMp: unrounded, nonNegative, finalMp, baseAp, finalAp, explanation },
    })),
  );
}

/** Reads an M4 run of a Spell cost plan. Every number comes from M4; nothing here computes. */
export function readSpellCostRun(plan: ProwessSpellCostCompiledPlan, run: unknown): ProwessOutcome<SpellCostResult> {
  const p = new Problems();
  if (!checkPlainData(run, [], p, K.INCOMPLETE_RUN)) return finish(p, () => null as never);
  if (!isPlainObject(run) || !Array.isArray(run.steps)) {
    p.add(K.INCOMPLETE_RUN, [], "exact EvaluationRun required");
    return finish(p, () => null as never);
  }
  const full = run as unknown as EvaluationRun;
  const planned = plan.evaluationPlan.steps;
  if (
    full.executionStatus !== "COMPLETE" ||
    full.primaryStepKey !== plan.evaluationPlan.primaryStepKey ||
    full.explanationStepKey !== plan.evaluationPlan.explanationStepKey ||
    full.steps.length !== planned.length ||
    planned.some((s) => !full.steps.some((x) => x.stepKey === s.stepKey && x.operation === s.operation && x.order === s.order && x.executionStatus === "EXECUTED" && x.response?.success === true && JSON.stringify(clonePlainData(x.response.ruleset ?? null)) === JSON.stringify(clonePlainData(plan.rulesetProvenance))))
  ) {
    p.add(K.INCOMPLETE_RUN, [], "every planned step must execute successfully under the plan's exact Ruleset");
    return finish(p, () => null as never);
  }
  const data = (stepKey: string) => full.steps.find((s) => s.stepKey === stepKey)!.response!.data as Record<string, unknown>;
  const num = (stepKey: string) => data(stepKey).finalValue as number;
  const target = (stepKey: string) => ((data(stepKey).finalTargets as { value: number }[])[0] as { value: number }).value;
  const outcomes = (stepKey: string) => data(stepKey).outcomes as { modifierKey: string; operation: string; operand: number; status: string; before: number; after: number }[];
  const abilitySteps = new Set(plan.ability.evaluationPlan.steps.map((s) => s.stepKey));
  const sub: EvaluationRun = { ...full, primaryStepKey: null, validationStepKey: null, explanationStepKey: plan.ability.explanationStepKey, steps: full.steps.filter((s) => abilitySteps.has(s.stepKey)) };
  const authored = readAbilityDefinitionRun(plan.ability, sub);
  if (!authored.ok) return authored as ProwessOutcome<never>;
  const netOutcomes = outcomes(plan.steps.netPercent);
  const percentageContributions = plan.percentages.map((q) => {
    const o = netOutcomes.find((x) => x.modifierKey === q.modifierKey)!;
    return { modifierKey: q.modifierKey, source: q.source, operation: o.operation, percent: o.operand, applied: o.status === "APPLIED", definitions: q.definitions };
  });
  const dc = authored.value.durationConditions;
  const apOutcomes = outcomes(plan.steps.finalAp);
  const unrounded = num(plan.steps.unroundedMp);
  const nonNegative = (data(plan.steps.nonNegative) as { satisfied: boolean }).satisfied;
  const problems = [...authored.value.problems];
  if (!nonNegative) problems.push({ code: K.NEGATIVE_FINAL_MP, path: "unroundedFinalMpCost", message: `the structured modifiers produced ${String(unrounded)} MP; an unsupported negative final MP is never clamped` });
  return finish(p, () =>
    deepFreeze(clonePlainData({
      status: problems.length === 0 ? ("VALID" as const) : ("INVALID" as const),
      valid: problems.length === 0,
      definition: plan.definition,
      rulesetProvenance: plan.rulesetProvenance,
      authored: authored.value,
      mp: { contributions: plan.contributions.map((c) => ({ ...c, value: num(c.stepKey) })), baseMpCost: target(plan.steps.baseMp) },
      percentageContributions,
      castingConditions: dc === undefined ? null : { listedPercent: dc.conditionSummary.spellMpPercent.listed, effectivePercent: dc.conditionSummary.spellMpPercent.effective, maximumPercent: dc.conditionSummary.spellMpPercent.maximum },
      netCostPercent: target(plan.steps.netPercent),
      unroundedFinalMpCost: unrounded,
      rounding: { mode: "NORMAL_HALF_UP_ONCE" as const, stepKey: plan.steps.finalMp },
      finalMpCost: num(plan.steps.finalMp),
      ap: {
        pro: plan.pro,
        baseApCost: num(plan.steps.baseAp),
        modifiers: plan.contributions.filter((c) => c.operation === "ADD_AP" || c.operation === "SUBTRACT_AP").map((c) => ({ contributionKey: c.contributionKey, operation: c.operation, value: num(c.stepKey), applied: apOutcomes.find((o) => o.modifierKey === c.contributionKey)?.status === "APPLIED" })),
        finalApCost: target(plan.steps.finalAp),
      },
      steps: plan.steps,
      problems,
    })),
  );
}

/** compile → M4 → read, in one pure call. */
export function evaluateSpellCost(request: unknown): ProwessOutcome<SpellCostResult> {
  const plan = compileSpellCost(request);
  if (!plan.ok) return plan as ProwessOutcome<never>;
  const response = orchestrateRulesEvaluation({ evaluationKey: `spell-cost.${plan.value.subject.subjectKey}`, contexts: { ruleset: (request as Record<string, unknown>).ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) {
    const p = new Problems();
    p.add(K.INCOMPLETE_RUN, [], "M4 could not evaluate the Spell cost plan");
    return finish(p, () => null as never);
  }
  return readSpellCostRun(plan.value, response.data);
}
