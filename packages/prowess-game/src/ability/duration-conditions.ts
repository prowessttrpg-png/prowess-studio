import type { JsonObject } from "@prowess/model";
import type { EvaluationStep, EvaluationBinding, EvaluationRun, RequirementNode } from "@prowess/rules";
import { findBundleDefinition, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import { definitionRefOf, isSameExactDefinition, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { AbilityComposition } from "../construction/composition.js";
import type { AbilityConstructionRulePayload } from "../definition/ability-construction-payload.js";
import { readComponentConstructionRules } from "../definition/ability-construction-payload.js";
import type { AbilityConditionDefinitionPayload, DurationDefinitionPayload, TraitDefinitionPayload, TargetingDefinitionPayload } from "../definition/payload.js";
import { readDurationRules, readDurationCosts, readConditionRules, readConditionContributions, DURATION_CONDITION_ERRORS as E, type DurationRules, type RuntimeRequirement, type ConditionModifier } from "../definition/duration-condition-payload.js";
import type { ConditionPolicy } from "../definition/condition-policy.js";
import type { EffectParameterRule, EffectCostRule } from "../definition/effect-payload.js";
import type { ProwessAbilityDefinitionCompiledPlan, CompiledTrait } from "./compile.js";
import type { ProwessConstructionCompiledPlan } from "../construction/legality.js";
import { Problems } from "../internal/problems.js";
import type { DurationConcept } from "../vocabulary/construction.js";

type Emit = (key: string, operation: EvaluationStep["operation"], input: JsonObject, refs: readonly ProwessDefinitionRef[], keys: readonly string[], bindings?: readonly EvaluationBinding[]) => string;
type Check = (key: string, requirement: JsonObject, facts: JsonObject, refs: readonly ProwessDefinitionRef[], keys: readonly string[], code?: string, bindings?: readonly EvaluationBinding[]) => void;
interface ListedValue { readonly contributionKey: string; readonly currency: "MP" | "AP"; readonly modifier: ConditionModifier | "DURATION_COST"; readonly unit: "POINTS" | "PERCENT_POINTS"; readonly selected: number | string | boolean | null; readonly listedStep: string; }
export interface CompiledDurationConditions {
  readonly duration: { readonly definition: ProwessDefinitionRef; readonly componentKey: string; readonly mode: DurationConcept; readonly parameters: Readonly<Record<string, number | string | boolean>>; readonly requirements: RequirementNode; readonly futureRuntime: DurationRules["futureRuntime"]; readonly costStatus: DurationRules["costStatus"]; readonly listedContributions: readonly ListedValue[] };
  readonly conditions: readonly { readonly definition: ProwessDefinitionRef; readonly componentKey: string; readonly restriction: string; readonly parameters: Readonly<Record<string, number | string | boolean>>; readonly applicability: RequirementNode; readonly runtimeRequirements: readonly (RuntimeRequirement & { readonly status: "REQUIREMENT_CONTRACT_ONLY" })[]; readonly consumesSlot: boolean; readonly slotExemption: string | null; readonly selectedCostOption: string | null; readonly listedContributions: readonly ListedValue[] }[];
  readonly summary: { readonly usedCapacity: number; readonly maximumCapacity: number; readonly policy: ProwessDefinitionRef; readonly spellMpPercent: CapSteps; readonly "maneuverAp": CapSteps };
}
interface CapSteps { readonly maximum: number; readonly listedStep: string; readonly effectiveStep: string; readonly excessStep: string; }
export interface DurationConditionResult {
  readonly duration: Omit<CompiledDurationConditions["duration"], "listedContributions"> & { readonly listedContributions: readonly ResolvedListedValue[] };
  readonly conditions: readonly (Omit<CompiledDurationConditions["conditions"][number], "listedContributions"> & { readonly listedContributions: readonly ResolvedListedValue[] })[];
  readonly conditionSummary: { readonly usedCapacity: number; readonly maximumCapacity: number; readonly policy: ProwessDefinitionRef; readonly spellMpPercent: CapResult; readonly "maneuverAp": CapResult; readonly costStage: "LISTED_COMPONENT_CONTRIBUTIONS_ONLY" };
}
interface ResolvedListedValue extends Omit<ListedValue, "listedStep"> { readonly listedValue: number; }
interface CapResult { readonly maximum: number; readonly listed: number; readonly effective: number; readonly excess: number; }
const json = (v: unknown) => v as JsonObject;
const compare = (factKey: string, operator: string, expected: number) => ({ kind: "NUMERIC_COMPARE", factKey, operator, expected });
const facts = (key: string, value: number): JsonObject => ({ numeric: [{ key, value }], ranks: [], sets: [], ownedEntityIds: null, keywords: null });
const binding = (stepKey: string, target: string): EvaluationBinding => ({ target, source: { kind: "STEP", stepKey, pointer: "/data/finalValue" } });

/** Narrow component extension, called only by WO8's authored Ability compiler. All arithmetic and predicates go to M4. */
export function compileDurationConditions(input: {
  readonly bundle: ProwessDefinitionBundle; readonly composition: AbilityComposition; readonly construction: ProwessConstructionCompiledPlan;
  readonly effects: ProwessAbilityDefinitionCompiledPlan["effects"]; readonly traits: readonly CompiledTrait[]; readonly actions: ProwessAbilityDefinitionCompiledPlan["actions"];
  readonly targeting: ProwessAbilityDefinitionCompiledPlan["targeting"]; readonly stats: Readonly<Partial<Record<string, number>>>;
}, emit: Emit, check: Check, p: Problems): CompiledDurationConditions | undefined {
  const { bundle, composition: c, effects, traits, actions, construction } = input;
  const durationUse = c.duration, durationDef = durationUse ? findBundleDefinition(bundle, durationUse.definition) : null;
  if (!durationDef || !durationUse) return undefined; // the canonical caller has already rejected a missing Duration
  const dp = durationDef.payload as unknown as DurationDefinitionPayload;
  if (dp.rules.duration === undefined && !c.conditions.length) {
    if (dp.durationConcept === "PERMANENT_BY_SPECIAL_RULE") p.add(E.DEFERRED, ["duration"], "Permanent requires an exact authored access rule");
    return undefined; // preserve historical WO8 plans exactly
  }
  const dr = readDurationRules(dp.rules.duration, c.abilityKind, dp.durationConcept, ["duration", "rules"], p);
  const policyDefs = bundle.definitions.filter(d => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  const policyDef = policyDefs.length === 1 ? policyDefs[0] : null, policy = policyDef ? (policyDef.payload as unknown as AbilityConstructionRulePayload).conditionPolicy : undefined;
  if (!policy || !policyDef) p.add(E.REFERENCE, ["conditionPolicy"], "typed WO9 components require the exact permanent construction policy");
  if (!dr || !policy || !policyDef) return undefined;
  if (dr.availability !== "EXECUTABLE") p.add(E.DEFERRED, ["duration"], `Duration is deferred: ${dr.deferralKey}`);
  if (dp.durationConcept === "PERMANENT_BY_SPECIAL_RULE") {
    const cr = readComponentConstructionRules(dp.rules, ["duration", "rules"], p);
    if (!cr?.prerequisites.length) p.add(E.DEFERRED, ["duration"], "Permanent needs an exact structured construction prerequisite; indefinite Sustain is not permission");
  }
  for (const key of Object.keys(dp.rules)) if (!["duration", "construction"].includes(key)) p.add(E.INVALID, ["duration", "rules", key], "no runtime execution or opaque executable rules");
  if (Object.keys(dp.parameters).length) p.add(E.PARAMETER, ["duration", "parameters"], "typed Duration parameters use the declared ROUNDS contract only");
  const pref = definitionRefOf(policyDef), durRefs = [durationUse.definition, pref], allUses = [c.targeting, ...c.effects, ...c.traits, durationUse, ...c.conditions, ...actions];
  const mechanicRefs = [...effects.map(e => e.plan.outputs.effect.definition), ...traits.map(t => t.definition), ...actions.map(a => a.definition), input.targeting.outputs.targeting.definition, durationUse.definition];
  const selectedResolutions = effects.map(e => {
    const mods = traits.filter(t => t.scope.scope === "RESOLUTION" && t.scope.componentKey === e.plan.subject.componentKey).flatMap(t => t.modifications).filter(m => m.modification.kind === "RESOLUTION");
    return mods.length ? (mods.at(-1)!.modification as { mode: string }).mode : e.plan.outputs.resolution;
  });
  const convertedTargets = effects.flatMap(e => e.plan.outputs.targetingConversion ? [findBundleDefinition(bundle, e.plan.outputs.targetingConversion.destination)!] : []);
  const conversionArea = convertedTargets.some(d => ((d.payload as unknown as TargetingDefinitionPayload).rules.targeting as JsonObject)?.cardinality && (((d.payload as unknown as TargetingDefinitionPayload).rules.targeting as JsonObject).cardinality as JsonObject).kind === "AREA");
  const numeric = [
    { key: "mechanic.present", value: 1 },
    { key: "mechanic.attack", value: selectedResolutions.includes("ATTACK_ROLL") || effects.some(e => e.plan.outputs.deliveryCheck === "RANGED_ATTACK_ROLL") || actions.some(a => a.profile.resolution.mode === "ATTACK_ROLL") ? 1 : 0 },
    { key: "mechanic.save", value: selectedResolutions.includes("SAVING_THROW") ? 1 : 0 },
    { key: "mechanic.area", value: input.targeting.outputs.cardinality.kind === "AREA" || conversionArea ? 1 : 0 },
    { key: "mechanic.sustained", value: dp.durationConcept === "SUSTAINED" ? 1 : 0 },
  ];
  const sets = [
    { key: "mechanic.duration", members: [dp.durationConcept] },
    { key: "mechanic.targets", members: input.targeting.outputs.validTargets.filter(category => actions.length > 0 || effects.some(e => e.plan.outputs.targetCategories.includes(category))) },
    { key: "mechanic.effects", members: effects.map(e => e.plan.outputs.effect.family) },
    { key: "mechanic.foundations", members: actions.map(a => a.profile.category) },
  ];
  const mechanicFacts = json({ numeric, sets, ranks: [], ownedEntityIds: null, keywords: null });
  const checkReferences = (req: RequirementNode, owner: ProwessDefinitionRef, subjects: readonly ProwessDefinitionRef[] = []): void => {
    const allowed = [owner, ...subjects];
    if (req.provenance) {
      const v = req.provenance, d = allowed.map(ref => findBundleDefinition(bundle, ref)).find(d => d && d.entityId === v.entityId && d.entityVersionId === v.entityVersionId && d.canonicalKey === v.canonicalKey);
      if (!d || !(v.rulesetId === bundle.rulesetProvenance.rulesetId && v.manifestId === bundle.rulesetProvenance.manifestId || v.rulesetId === d.provenance.sourceRulesetId && v.manifestId === d.provenance.sourceManifestId)) p.add(E.REFERENCE, [owner.canonicalKey, "requirement", "provenance"], "requirement provenance must match an exact subject and its Ruleset pin");
    }
    if (req.kind === "ENTITY_OWNED" && !subjects.some(ref => ref.entityId === req.entityId && findBundleDefinition(bundle, ref))) p.add(E.REFERENCE, [owner.canonicalKey, "requirement"], "an ownership restriction requires an exact historical subject reference");
    if ("children" in req) req.children.forEach(child => checkReferences(child, owner, subjects));
  };
  const checkMechanic = (key: string, req: RequirementNode, refs: readonly ProwessDefinitionRef[], keys: readonly string[]) => {
    checkReferences(req, refs[0]!);
    const known = (n: RequirementNode): boolean => "children" in n ? n.children.every(known) : "factKey" in n && (n.kind === "NUMERIC_COMPARE" ? numeric.some(x => x.key === n.factKey) : n.kind === "SET_CONTAINS" && sets.some(x => x.key === n.factKey));
    if (!known(req)) p.add(E.RELEVANCE, [key], "construction relevance uses declared compiled mechanic facts; runtime facts remain deferred");
    else check(key, json(req), mechanicFacts, [...refs, ...mechanicRefs], keys, E.RELEVANCE);
  };
  const formula = (key: string, slot: keyof ConditionPolicy["formulas"], variables: Record<string, number>, refs: readonly ProwessDefinitionRef[], keys: readonly string[], bindings: readonly EvaluationBinding[] = []) => emit(`wo9.${key}`, "FORMULA", json({ program: { expression: policy.formulas[slot].expression }, variables }), [...refs, pref], keys, bindings);
  const selectParameters = (params: JsonObject, declared: readonly EffectParameterRule[], key: string, refs: readonly ProwessDefinitionRef[]) => {
    const selected: Record<string, number | string | boolean> = {};
    for (const name of Object.keys(params)) if (!declared.some(q => q.parameter === name)) p.add(E.PARAMETER, [key, "parameters", name], "unknown authored parameter");
    for (const q of declared) {
      const v = Object.hasOwn(params, q.parameter) ? params[q.parameter] : q.default;
      if (q.kind === "COUNT" ? !Number.isSafeInteger(v) || (v as number) < 0 : q.kind === "TOKEN" ? typeof v !== "string" || !q.allowed.includes(v) : typeof v !== "boolean") { p.add(E.PARAMETER, [key, q.parameter], "required declared parameter has the wrong type or selection"); continue; }
      selected[q.parameter] = v as number | string | boolean;
      if (q.kind === "COUNT") {
        const bound = (suffix: string, operator: string, expected: number) => check(`wo9.${key}.${q.parameter}.${suffix}`, compare("selection", operator, expected), facts("selection", v as number), refs, [key], E.PARAMETER);
        if (q.minimum !== null) bound("minimum", ">=", q.minimum);
        if (q.maximum) { const max = q.maximum.kind === "FIXED" ? q.maximum.value : input.stats[q.maximum.stat]; if (!Number.isSafeInteger(max)) p.add(E.PARAMETER, [key, q.parameter], "declared maximum Stat is unavailable"); else bound("maximum", "<=", max!); }
        if (q.increment !== null) {
          const step = formula(`${key}.${q.parameter}.increment`, "increment", { value: v as number, minimum: q.minimum ?? 0, increment: q.increment }, refs, [key]);
          check(`wo9.${key}.${q.parameter}.incrementCheck`, compare("increment", "==", 0), facts("increment", 0), refs, [key], E.PARAMETER, [binding(step, "/facts/numeric/0/value")]);
        }
      }
    }
    return selected;
  };
  const listed = (key: string, costs: readonly { cost: EffectCostRule; modifier: ListedValue["modifier"] }[], selected: Readonly<Record<string, number | string | boolean>>, refs: readonly ProwessDefinitionRef[]): ListedValue[] => costs.map(({ cost, modifier }) => {
    const value = cost.kind === "FIXED" ? null : selected[cost.parameter] ?? null;
    // The supplied contribution parameter is validated before M4 sees it. No final-cost input exists here.
    const rate = cost.kind === "PER_SELECTION" ? cost.amounts[value as string] : cost.amount;
    const units = cost.kind === "PER_UNIT" ? value as number : 1;
    if (cost.kind === "PER_UNIT" && cost.includedUnits !== 0) p.add(E.INVALID, [key, cost.contributionKey], "WO9 reductions have no implicit free units");
    const listedStep = formula(`${key}.${cost.contributionKey}`, "scale", { units: typeof units === "number" ? units : 0, rate: rate ?? 0 }, refs, [key]);
    return { contributionKey: cost.contributionKey, currency: cost.currency, modifier, unit: modifier === "MP_PERCENT_REDUCTION" ? "PERCENT_POINTS" : "POINTS", selected: value, listedStep };
  });
  checkMechanic("wo9.duration.requirements", dr.requirements, durRefs, [durationUse.componentKey]);
  if (dp.durationConcept === "ROUNDS") check("wo9.duration.rounds", compare("rounds", ">=", 1), facts("rounds", durationUse.parameters.rounds as number), durRefs, [durationUse.componentKey], E.PARAMETER);
  for (const relation of dp.compatibility) {
    const selected = relation.relation === "EFFECT" ? effects.map(e => ({ value: e.plan.outputs.effect.family, definition: e.plan.outputs.effect.definition, key: e.plan.subject.componentKey })) : relation.relation === "TRAIT" ? traits.map(t => ({ value: (findBundleDefinition(bundle, t.definition)!.payload as unknown as TraitDefinitionPayload).traitFamily, definition: t.definition, key: t.componentKey })) : [];
    for (const [i, item] of selected.entries()) check(`wo9.duration.compatibility.${relation.relation}.${i}`, { kind: "SET_CONTAINS", factKey: "allowed", member: item.value }, json({ numeric: [], ranks: [], sets: [{ key: "allowed", members: relation.allow }], ownedEntityIds: null, keywords: null }), [durationUse.definition, item.definition], [durationUse.componentKey, item.key], E.RELEVANCE);
  }
  for (const e of effects) {
    if (dp.durationConcept === "SUSTAINED" && !e.plan.outputs.duration.sustainEligible || dp.durationConcept === "MANA_LOCK" && !e.plan.outputs.duration.manaLockEligible) p.add(E.RELEVANCE, ["duration", e.plan.subject.componentKey], "Effect does not declare eligibility for this maintenance mode");
  }
  for (const t of traits.filter(t => t.scope.scope === "DURATION")) {
    const td = findBundleDefinition(bundle, t.definition)!.payload as unknown as TraitDefinitionPayload;
    if (t.scope.componentKey !== durationUse.componentKey || !td.compatibility.some(q => q.relation === "DURATION")) p.add(E.RELEVANCE, ["traits", t.componentKey], "Duration-scoped Trait must explicitly declare its compatible Duration metadata");
  }
  for (const t of traits) for (const q of (findBundleDefinition(bundle, t.definition)!.payload as unknown as TraitDefinitionPayload).compatibility.filter(q => q.relation === "DURATION")) check(`wo9.trait.${t.componentKey}.duration`, { kind: "SET_CONTAINS", factKey: "allowed", member: dp.durationConcept }, json({ numeric: [], ranks: [], sets: [{ key: "allowed", members: q.allow }], ownedEntityIds: null, keywords: null }), [t.definition, durationUse.definition], [t.componentKey, durationUse.componentKey], E.RELEVANCE);
  const conditions: CompiledDurationConditions["conditions"][number][] = [];
  for (const use of c.conditions) {
    const d = findBundleDefinition(bundle, use.definition)!, cp = d.payload as unknown as AbilityConditionDefinitionPayload, cr = readConditionRules(cp.rules.condition, c.abilityKind, ["conditions", use.componentKey], p);
    if (!cr) continue;
    if (cr.availability !== "EXECUTABLE") { p.add(E.DEFERRED, ["conditions", use.componentKey], `Condition is deferred: ${cr.deferralKey}`); continue; }
    for (const key of Object.keys(cp.rules)) if (!["condition", "construction"].includes(key)) p.add(E.INVALID, ["conditions", use.componentKey, key], "only typed restriction and construction rules are executable");
    if (Object.keys(cp.restriction.data).length || Object.keys(cp.tradeoff).length || Object.keys(cp.parameters).length) p.add(E.INVALID, ["conditions", use.componentKey], "opaque restriction, tradeoff or parameter data cannot supplement typed contracts");
    for (const runtime of cr.runtimeRequirements) {
      for (const ref of runtime.references) if (!findBundleDefinition(bundle, ref)) p.add(E.REFERENCE, [use.componentKey, "runtimeRequirements"], "runtime subject must resolve in this exact Ruleset");
      checkReferences(runtime.requirement, use.definition, runtime.references);
    }
    if (cp.restriction.restrictionKey === "MATERIAL" && !cr.runtimeRequirements.some(q => q.references.length > 0)) p.add(E.REFERENCE, [use.componentKey], "Material needs an exact authored focus/item/reagent subject, with no default benefit");
    const selected = selectParameters(use.parameters, cr.parameters, use.componentKey, [use.definition]);
    checkMechanic(`wo9.${use.componentKey}.applicability`, cr.applicability, [use.definition], [use.componentKey]);
    const intrinsic: Readonly<Record<string, string>> = { ATTACK_RESTRICTION: "mechanic.attack", ATTACK_ROLL: "mechanic.attack", "SAVE_RESTRICTION": "mechanic.save", SAVING_THROW: "mechanic.save", AREA_RESTRICTION: "mechanic.area", SUSTAIN_RESTRICTION: "mechanic.sustained" };
    const intrinsicFact = intrinsic[cp.restriction.restrictionKey];
    if (intrinsicFact) check(`wo9.${use.componentKey}.intrinsic`, compare(intrinsicFact, ">=", 1), mechanicFacts, [use.definition, ...mechanicRefs], [use.componentKey], E.RELEVANCE);
    if (["TARGET_FLANKED", "TARGET_UNAWARE", "TARGET_BLOODIED"].includes(cp.restriction.restrictionKey)) check(`wo9.${use.componentKey}.creature`, { kind: "SET_CONTAINS", factKey: "mechanic.targets", member: "CREATURE" }, mechanicFacts, [use.definition, ...mechanicRefs], [use.componentKey], E.RELEVANCE);
    if (["DURATION_RESTRICTION", "TARGET_RESTRICTION"].includes(cp.restriction.restrictionKey) && !("factKey" in cr.applicability && cr.applicability.factKey === (cp.restriction.restrictionKey === "DURATION_RESTRICTION" ? "mechanic.duration" : "mechanic.targets"))) p.add(E.RELEVANCE, [use.componentKey], "restriction needs its explicit Duration or target requirement");
    for (const dep of cr.dependencies) if (!findBundleDefinition(bundle, dep) || !allUses.some(x => isSameExactDefinition(x.definition, dep))) p.add(E.REFERENCE, [use.componentKey, "dependencies"], "exact dependency must belong to this Ruleset and actually be selected");
    const incompatible = c.conditions.filter(other => cr.incompatibleRestrictions.includes((findBundleDefinition(bundle, other.definition)!.payload as unknown as AbilityConditionDefinitionPayload).restriction.restrictionKey));
    check(`wo9.${use.componentKey}.incompatible`, compare("incompatible", "==", 0), facts("incompatible", incompatible.length), [use.definition, ...incompatible.map(x => x.definition)], [use.componentKey, ...incompatible.map(x => x.componentKey)], E.RELEVANCE);
    check(`wo9.${use.componentKey}.uniqueRestriction`, compare("instances", "<=", 1), facts("instances", c.conditions.filter(other => (findBundleDefinition(bundle, other.definition)!.payload as unknown as AbilityConditionDefinitionPayload).restriction.restrictionKey === cp.restriction.restrictionKey).length), c.conditions.map(x => x.definition), [use.componentKey], E.RELEVANCE);
    const contributions = readConditionContributions(cp, cr, [use.componentKey, "contributions"], p), option = cr.choice.kind === "CHOOSE_ONE" ? selected[cr.choice.parameter] : null;
    conditions.push({ definition: use.definition, componentKey: use.componentKey, restriction: cp.restriction.restrictionKey, parameters: selected, applicability: cr.applicability, runtimeRequirements: cr.runtimeRequirements.map(q => ({ ...q, status: "REQUIREMENT_CONTRACT_ONLY" })), consumesSlot: cr.consumesSlot, slotExemption: cr.slotExemption, selectedCostOption: typeof option === "string" ? option : null, listedContributions: listed(use.componentKey, contributions.filter(x => x.option === null || x.option === option), selected, [use.definition]) });
  }
  const cap = (key: string, modifier: ConditionModifier, maximum: number): CapSteps => {
    const refs = [pref, durationUse.definition, ...conditions.map(c => c.definition)], keys = [durationUse.componentKey, ...conditions.map(c => c.componentKey)], values = conditions.flatMap(row => row.listedContributions.filter(q => q.modifier === modifier && (modifier !== "AP_REDUCTION" || c.abilityKind === "MANEUVER")));
    let sum = formula(`${key}.zero`, "sum", { left: 0, right: 0 }, refs, keys);
    for (const [i, value] of values.entries()) sum = formula(`${key}.sum.${i}`, "sum", { left: 0, right: 0 }, refs, keys, [binding(sum, "/variables/left"), binding(value.listedStep, "/variables/right")]);
    const effectiveStep = formula(`${key}.cap`, "cap", { listed: 0, maximum }, refs, keys, [binding(sum, "/variables/listed")]);
    const excessStep = formula(`${key}.excess`, "excess", { listed: 0, effective: 0 }, refs, keys, [binding(sum, "/variables/listed"), binding(effectiveStep, "/variables/effective")]);
    check(`wo9.${key}.maximum`, compare("effective", "<=", maximum), facts("effective", 0), refs, keys, E.CAP, [binding(effectiveStep, "/facts/numeric/0/value")]);
    // A Maneuver attempting more than the legal AP reduction is rejected; its effective contribution still cannot exceed the cap.
    if (c.abilityKind === "MANEUVER" && modifier === "AP_REDUCTION") check(`wo9.${key}.listedMaximum`, compare("listed", "<=", maximum), facts("listed", 0), refs, keys, E.CAP, [binding(sum, "/facts/numeric/0/value")]);
    return { maximum, listedStep: sum, effectiveStep, excessStep };
  };
  return { duration: { definition: durationUse.definition, componentKey: durationUse.componentKey, mode: dp.durationConcept, parameters: durationUse.parameters as Readonly<Record<string, number | string | boolean>>, requirements: dr.requirements, futureRuntime: dr.futureRuntime, costStatus: dr.costStatus, listedContributions: listed(durationUse.componentKey, readDurationCosts(dp.costContributions, dr, dp.durationConcept, ["duration", "costs"], p).map(cost => ({ cost, modifier: "DURATION_COST" })), durationUse.parameters as Readonly<Record<string, number | string | boolean>>, durRefs) }, conditions, summary: { usedCapacity: construction.outputs.usage.conditions, maximumCapacity: construction.outputs.capacity.conditions, policy: pref, spellMpPercent: cap("spellMpPercent", "MP_PERCENT_REDUCTION", policy.spellMpPercentMaximum), "maneuverAp": cap("maneuverAp", "AP_REDUCTION", policy.maneuverApMaximum) } };
}
export function readDurationConditionRun(plan: CompiledDurationConditions, run: EvaluationRun): DurationConditionResult {
  // The parent reader has already verified exact step identity, operation, order, success and Ruleset provenance.
  const value = (key: string) => (run.steps.find(s => s.stepKey === key)!.response!.data as unknown as { finalValue: number }).finalValue;
  const listed = (rows: readonly ListedValue[]): ResolvedListedValue[] => rows.map(({ listedStep, ...row }) => ({ ...row, listedValue: value(listedStep) }));
  const cap = (q: CapSteps): CapResult => ({ maximum: q.maximum, listed: value(q.listedStep), effective: value(q.effectiveStep), excess: value(q.excessStep) });
  return { duration: { ...plan.duration, listedContributions: listed(plan.duration.listedContributions) }, conditions: plan.conditions.map(c => ({ ...c, listedContributions: listed(c.listedContributions) })), conditionSummary: { usedCapacity: plan.summary.usedCapacity, maximumCapacity: plan.summary.maximumCapacity, policy: plan.summary.policy, spellMpPercent: cap(plan.summary.spellMpPercent), "maneuverAp": cap(plan.summary["maneuverAp"]), costStage: "LISTED_COMPONENT_CONTRIBUTIONS_ONLY" } };
}
