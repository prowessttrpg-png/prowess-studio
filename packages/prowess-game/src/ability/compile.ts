import { TRAIT_PARAMETER_INCREMENT_FORMULA } from "../content/core-playtest-v0.1/traits.js";
import type { JsonObject } from "@prowess/model";
import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationPlan, type EvaluationRun, type EvaluationStep, type EvaluationBinding } from "@prowess/rules";
import { createProwessDefinitionBundle, findBundleDefinition, type ProwessRulesetProvenance } from "../bundle/bundle.js";
import { readDefinitionRef, definitionRefOf, isSameExactDefinition, type ProwessDefinitionRef } from "../definition/envelope.js";
import { readComponentConstructionRules } from "../definition/ability-construction-payload.js";
import { readAttackFoundationProfile, AUTHORED_ABILITY_ERROR_CODES as A, type AuthoredAbilityPayload, type AttackFoundationProfile, type ManeuverDefinitionPayload, type SpellDefinitionPayload } from "../definition/authored-ability-payload.js";
import { readTraitRules, readTraitCosts, TRAIT_ERROR_CODES as T, type TraitSelectedModification, type TraitRules } from "../definition/trait-payload.js";
import type { TraitDefinitionPayload, EffectDefinitionPayload, FoundationDefinitionPayload, DurationDefinitionPayload } from "../definition/payload.js";
import { compileAbilityConstruction, readAbilityConstructionRun, type AbilityConstructionRequest, type AbilityConstructionResult, type ProwessConstructionCompiledPlan } from "../construction/legality.js";
import { validateAbilityComposition, type TraitUse } from "../construction/composition.js";
import { compileAbilityTargeting, readAbilityTargetingRun, type ProwessTargetingCompiledPlan, type AbilityTargetingResult } from "../targeting/compile.js";
import { compileEffectUse, readEffectRun, type ProwessEffectCompiledPlan, type EffectUseResult } from "../effect/compile.js";
import type { EffectCostRule } from "../definition/effect-payload.js";
import type { AffinityDefinitionV2Payload } from "../definition/affinity-payload.js";
import { readKeywordCatalog, keywordReference } from "../affinity/definitions.js";
import { clonePlainData, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactLabel, own, readRecord, type ProwessOutcome } from "../internal/problems.js";
import type { ProwessCompilationSourceMap, ProwessSourceMapEntry } from "../compilation/model.js";
import { compileDurationConditions, readDurationConditionRun, type CompiledDurationConditions, type DurationConditionResult } from "./duration-conditions.js";

export interface AbilityDefinitionRequest extends Omit<AbilityConstructionRequest, "composition" | "options"> {
  readonly definition: ProwessDefinitionRef;
  readonly constructionOptions?: AbilityConstructionRequest["options"];
}
export interface CompiledTrait {
  readonly componentKey: string;
  readonly definition: ProwessDefinitionRef;
  readonly scope: TraitUse["appliesTo"];
  readonly family: TraitRules["family"];
  readonly name: string;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
  readonly modifications: readonly TraitSelectedModification[];
  readonly costs: readonly (EffectCostRule & { readonly selected: number | string | boolean | null })[];
}
interface EffectCompilation { readonly actionKey: string | null; readonly plan: ProwessEffectCompiledPlan; readonly targeting: ProwessTargetingCompiledPlan; }
export interface ProwessAbilityDefinitionCompiledPlan {
  readonly durationConditions?: CompiledDurationConditions;
  readonly contractVersion: 1;
  readonly subject: { readonly kind: "AUTHORED_ABILITY"; readonly subjectKey: string; readonly abilityKind: "SPELL" | "MANEUVER" };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly definition: ProwessDefinitionRef;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly authored: AuthoredAbilityPayload;
  readonly construction: ProwessConstructionCompiledPlan;
  readonly targeting: ProwessTargetingCompiledPlan;
  readonly effects: readonly EffectCompilation[];
  readonly traits: readonly CompiledTrait[];
  readonly rules: readonly { readonly ruleKey: string; readonly stepKey: string; readonly code: string }[];
  readonly actions: readonly { readonly componentKey: string; readonly definition: ProwessDefinitionRef; readonly profile: AttackFoundationProfile }[];
  readonly targetingChanges: readonly { readonly actionKey: string | null; readonly measure: string; readonly stepKey: string; readonly definitions: readonly ProwessDefinitionRef[] }[];
  readonly actionConstruction: readonly ProwessConstructionCompiledPlan[];
  readonly explanationStepKey: string;
}
export interface AuthoredAbilityResult {
  readonly durationConditions?: DurationConditionResult;
  readonly valid: boolean;
  readonly status: "VALID" | "INVALID";
  readonly abilityKind: "SPELL" | "MANEUVER";
  readonly definition: ProwessDefinitionRef;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly construction: AbilityConstructionResult;
  readonly targeting: AbilityTargetingResult;
  readonly effects: readonly { readonly actionKey: string | null; readonly result: EffectUseResult }[];
  readonly traits: readonly CompiledTrait[];
  readonly traitCapacity: { readonly ordinary: { readonly base: number; readonly effective: number; readonly used: number }; readonly affinityAdditional: { readonly capacity: null; readonly used: number; readonly conflictKey: "M5-SC-042" } };
  readonly actions: ProwessAbilityDefinitionCompiledPlan["actions"];
  readonly targetingChanges: readonly { readonly actionKey: string | null; readonly measure: string; readonly value: number; readonly definitions: readonly ProwessDefinitionRef[] }[];
  readonly powerfulBlow: { readonly actionKeys: readonly string[]; readonly damageSource: "COMBINED_COMMITTED_ATTACKS"; readonly attachedEffectsResolve: "ONCE" } | null;
  readonly problems: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}
const FIELDS = ["contractVersion", "subjectKey", "definition", "definitions", "ruleset", "character", "keywords", "signature", "constructionOptions", "accessGrants"];
const emptyFacts = () => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: null, keywords: null });
const asJson = (v: unknown): JsonObject => v as JsonObject;

/** Compiles exact, versioned authored objects through the permanent WO4–WO7 compilers and M4 primitives. */
export function compileAbilityDefinition(request: unknown): ProwessOutcome<ProwessAbilityDefinitionCompiledPlan> {
  const p = new Problems(); if (!checkPlainData(request, [], p, A.INVALID)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, A.INVALID, FIELDS, ["contractVersion", "subjectKey", "definition", "definitions", "ruleset", "character", "keywords", "signature"]); if (!r) return finish(p, () => null as never);
  const subjectKey = own(r, "subjectKey"); if (own(r, "contractVersion") !== 1 || !isExactLabel(subjectKey)) p.add(A.INVALID, [], "supported contractVersion and exact subjectKey required");
  const context = createRulesetContext(own(r, "ruleset")), rawBundle = own(r, "definitions");
  if (!context.ok || !isPlainObject(rawBundle)) { p.add(A.REFERENCE, ["definitions"], "exact Ruleset context and bundle required"); return finish(p, () => null as never); }
  const bundleOut = createProwessDefinitionBundle({ ruleset: context.value, definitions: rawBundle.definitions });
  if (!bundleOut.ok) return bundleOut;
  if (JSON.stringify(clonePlainData(rawBundle.rulesetProvenance ?? null)) !== JSON.stringify(clonePlainData(bundleOut.value.rulesetProvenance))) p.add(A.REFERENCE, ["definitions"], "supplied provenance must match this exact Ruleset");
  const bundle = bundleOut.value;
  const ref = readDefinitionRef(own(r, "definition"), ["definition"], p, A.REFERENCE);
  const d = ref ? findBundleDefinition(bundle, ref) : null;
  if (!d || !["SPELL_DEFINITION", "MANEUVER_DEFINITION"].includes(d.definitionKind)) { p.add(A.REFERENCE, ["definition"], "exact authored Spell or Maneuver Definition required"); return finish(p, () => null as never); }
  const catalog = readKeywordCatalog(own(r, "keywords"), ["keywords"], p); if (p.count || !catalog) return finish(p, () => null as never);
  const authored = d.payload as unknown as AuthoredAbilityPayload;
  const spell = d.definitionKind === "SPELL_DEFINITION";
  const spellData = spell ? authored as SpellDefinitionPayload : null;
  const constructionOptions = spellData?.constructionOptions ?? { effectSlotsTradedForTraits: 0 };
  if (own(r, "constructionOptions") !== undefined && JSON.stringify(clonePlainData(own(r, "constructionOptions"))) !== JSON.stringify(clonePlainData(constructionOptions))) p.add(A.INVALID, ["constructionOptions"], "validation cannot override the authored Effect-slot exchange selection");
  const man = spell ? null : authored as ManeuverDefinitionPayload;
  const actions: { componentKey: string; definition: ProwessDefinitionRef; profile: AttackFoundationProfile }[] = [];
  if (man) for (const action of man.actions) {
    const definition = findBundleDefinition(bundle, action.definition);
    if (!definition || definition.definitionKind !== "MANEUVER_FOUNDATION") { p.add(A.FOUNDATION, ["actions", action.componentKey], "foundation must resolve in this exact Ruleset"); continue; }
    if (Object.keys(action.parameters).length) p.add(A.FOUNDATION, ["actions", action.componentKey, "parameters"], "foundation profile is inherited; no arbitrary attack override parameters");
    const payload = definition.payload as unknown as FoundationDefinitionPayload;
    const profile = readAttackFoundationProfile(payload.rules.attack, ["actions", action.componentKey, "profile"], p);
    if (profile) actions.push({ componentKey: action.componentKey, definition: action.definition, profile });
  }
  if (p.count) return finish(p, () => null as never);
  const firstAction = actions[0];
  const rawComposition = spellData ? spellData.composition : { ...man!.composition, targeting: firstAction!.profile.targeting, branch: { kind: "MANEUVER", foundation: { componentKey: man!.actions[0]!.componentKey, definition: man!.actions[0]!.definition, parameters: man!.actions[0]!.parameters }, martialAccess: null, resolutionProfile: null, data: {} } };
  // Ordered actions carry order; WO1's single foundation use does not.
  const normalized = validateAbilityComposition(rawComposition, { bundle }); if (!normalized.ok) return normalized;
  const composition = normalized.value;
  const baseRequest = { contractVersion: 1, definitions: bundle, ruleset: context.value, character: own(r, "character"), keywords: own(r, "keywords"), signature: own(r, "signature"), ...(own(r, "accessGrants") === undefined ? {} : { accessGrants: own(r, "accessGrants") }) };
  const construction = compileAbilityConstruction({ ...baseRequest, subjectKey: `${subjectKey}.construction`, composition, options: constructionOptions });
  if (!construction.ok) return construction;
  const steps: EvaluationStep[] = [], entries: ProwessSourceMapEntry[] = [];
  const append = (plan: { evaluationPlan: EvaluationPlan; sourceMap: ProwessCompilationSourceMap }) => {
    for (const step of plan.evaluationPlan.steps) {
      if (steps.some(s => s.stepKey === step.stepKey)) { p.add(A.INVALID, [], "duplicate compiled step identity"); continue; }
      const order = steps.length; steps.push({ ...step, order });
      const source = plan.sourceMap.entries.find(e => e.stepKey === step.stepKey)!;
      entries.push({ ...source, order, definitions: [...source.definitions, definitionRefOf(d)] });
    }
  };
  append(construction.value);
  const rules: { ruleKey: string; stepKey: string; code: string }[] = [];
  const emit = (key: string, operation: EvaluationStep["operation"], input: JsonObject, refs: readonly ProwessDefinitionRef[], componentKeys: readonly string[], bindings: readonly EvaluationBinding[] = []) => {
    const stepKey = `authored.${subjectKey}.${key}`, order = steps.length;
    steps.push({ stepKey, order, operation, input, bindings }); entries.push({ stepKey, order, operation, role: key, componentKeys, definitions: [definitionRefOf(d), ...refs] }); return stepKey;
  };
  const check = (key: string, requirement: JsonObject, facts: JsonObject, refs: readonly ProwessDefinitionRef[], componentKeys: readonly string[], code: string = T.INCOMPATIBLE, bindings: readonly EvaluationBinding[] = []) => {
    const stepKey = emit(key, "REQUIREMENT", { requirement, facts }, refs, componentKeys, bindings); rules.push({ ruleKey: key, stepKey, code });
  };
  const compare = (key: string, value: number, operator: string, expected: number, refs: readonly ProwessDefinitionRef[], componentKeys: readonly string[]) => check(key, { kind: "NUMERIC_COMPARE", factKey: "trait.selection", operator, expected }, asJson({ ...emptyFacts(), numeric: [{ key: "trait.selection", value }] }), refs, componentKeys, T.PARAMETER);
  const traits: CompiledTrait[] = [];
  for (const trait of composition.traits) {
    const definition = findBundleDefinition(bundle, trait.definition)!;
    const payload = definition.payload as unknown as TraitDefinitionPayload;
    if (Object.keys(payload.rules).some(k => !["trait", "construction"].includes(k))) p.add(T.INVALID, ["traits", trait.componentKey], "executable Trait rules use only permanent construction and typed trait contracts");
    const tr = readTraitRules(payload.rules.trait, spell ? definition.definitionKind === "SHARED_TRAIT" ? null : "SPELL" : definition.definitionKind === "SHARED_TRAIT" ? null : "MANEUVER", payload.scope, ["traits", trait.componentKey], p);
    const cr = readComponentConstructionRules(payload.rules, ["traits", trait.componentKey, "rules"], p);
    if (!tr || !cr) continue;
    const costs = readTraitCosts(payload.costContributions, tr, ["traits", trait.componentKey, "costs"], p);
    const selected: Record<string, number | string | boolean> = {};
    for (const key of Object.keys(trait.parameters)) if (!tr.parameters.some(q => q.parameter === key)) p.add(T.PARAMETER, ["traits", trait.componentKey, "parameters", key], "unknown Trait parameter");
    for (const q of tr.parameters) {
      const v = Object.hasOwn(trait.parameters, q.parameter) ? trait.parameters[q.parameter] : q.default;
      if (q.kind === "COUNT" ? !Number.isSafeInteger(v) || (v as number) < 0 : q.kind === "FLAG" ? typeof v !== "boolean" : typeof v !== "string" || !q.allowed.includes(v)) { p.add(T.PARAMETER, ["traits", trait.componentKey, "parameters", q.parameter], "required declared parameter has wrong type or token"); continue; }
      selected[q.parameter] = v as number | string | boolean;
      if (q.kind === "COUNT") {
        if (q.minimum !== null) compare(`trait.${trait.componentKey}.${q.parameter}.min`, v as number, ">=", q.minimum, [trait.definition], [trait.componentKey]);
        if (q.maximum) {
          const character = own(r, "character") as AbilityDefinitionRequest["character"];
          const max = q.maximum.kind === "FIXED" ? q.maximum.value : character.stats[q.maximum.stat];
          if (!Number.isSafeInteger(max)) p.add(T.PARAMETER, ["character"], "parameter maximum needs its declared Stat");
          else compare(`trait.${trait.componentKey}.${q.parameter}.max`, v as number, "<=", max!, [trait.definition], [trait.componentKey]);
        }
        if (q.increment !== null) {
          const f = emit(`trait.${trait.componentKey}.${q.parameter}.increment`, "FORMULA", { program: { expression: TRAIT_PARAMETER_INCREMENT_FORMULA }, variables: { value: v as number, minimum: q.minimum ?? 0, increment: q.increment } }, [trait.definition], [trait.componentKey]);
          check(`trait.${trait.componentKey}.${q.parameter}.step`, { kind: "NUMERIC_COMPARE", factKey: "trait.increment", operator: "==", expected: 0 }, asJson({ ...emptyFacts(), numeric: [{ key: "trait.increment", value: 0 }] }), [trait.definition], [trait.componentKey], T.PARAMETER, [{ target: "/facts/numeric/0/value", source: { kind: "STEP", stepKey: f, pointer: "/data/finalValue" } }]);
        }
      }
    }
    const targetEffect = composition.effects.find(x => x.componentKey === trait.appliesTo.componentKey);
    const effect = targetEffect ? findBundleDefinition(bundle, targetEffect.definition) : null;
    if (tr.effectFamilies.length) check(`trait.${trait.componentKey}.effect`, { kind: "SET_CONTAINS", factKey: "trait.allowed", member: effect ? (effect.payload as unknown as EffectDefinitionPayload).effectFamily : "NO_EFFECT" }, asJson({ ...emptyFacts(), sets: [{ key: "trait.allowed", members: tr.effectFamilies }] }), [trait.definition, ...(targetEffect ? [targetEffect.definition] : [])], [trait.componentKey]);
    for (const incompatible of tr.incompatibleTraits) check(`trait.${trait.componentKey}.incompatible.${incompatible}`, { kind: "NONE", children: [{ kind: "SET_CONTAINS", factKey: "trait.present", member: incompatible }] }, asJson({ ...emptyFacts(), sets: [{ key: "trait.present", members: composition.traits.map(t => t.definition.canonicalKey) }] }), [trait.definition], [trait.componentKey]);
    const related = man && targetEffect ? actions.filter(a => man.effectAttachments.find(x => x.effectKey === targetEffect.componentKey)?.actionKeys.includes(a.componentKey)) : actions;
    for (const action of related) if (tr.foundationCategories.length) check(`trait.${trait.componentKey}.foundation.${action.componentKey}`, { kind: "SET_CONTAINS", factKey: "trait.foundation", member: action.profile.category }, asJson({ ...emptyFacts(), sets: [{ key: "trait.foundation", members: tr.foundationCategories }] }), [trait.definition, action.definition], [trait.componentKey, action.componentKey]);
    if (tr.affinity) {
      const af = findBundleDefinition(bundle, tr.affinity);
      if (!af || af.schemaVersion !== 2 || !cr.prerequisites.some(x => x.kind === "AFFINITY_RANK_AT_LEAST" && isSameExactDefinition(x.affinity, tr.affinity!))) p.add(T.INVALID, ["traits", trait.componentKey], "Affinity-specific Traits author an exact permanent Affinity prerequisite");
      else {
        const keywordStep = emit(`trait.${trait.componentKey}.keywords`, "KEYWORD", { contributions: payload.keywords.flatMap(canonicalKey => { const kw = keywordReference(catalog, canonicalKey); if (!kw) { p.add(T.INVALID, ["traits", trait.componentKey, "keywords"], "exact Keyword catalog reference required"); return []; } return [{ keyword: { keywordId: kw.keywordId, canonicalKey: kw.canonicalKey, categoryId: kw.categoryId }, source: { sourceType: "prowess.trait", sourceKey: trait.componentKey, sourceId: definition.entityVersionId, provenance: { entityId: definition.entityId, entityVersionId: definition.entityVersionId, canonicalKey: definition.canonicalKey, rulesetId: bundle.rulesetProvenance.rulesetId, manifestId: bundle.rulesetProvenance.manifestId } } }]; }) }, [trait.definition, tr.affinity], [trait.componentKey]);
        const children = (af.payload as unknown as AffinityDefinitionV2Payload).strengths.flatMap(s => s.matchAny.map(k => { const kw = keywordReference(catalog, k); if (!kw) p.add(T.INVALID, ["traits", trait.componentKey], "Strength Keyword missing from catalog"); return { kind: "KEYWORD_PRESENT", keywordId: kw?.keywordId ?? "" }; }));
        check(`trait.${trait.componentKey}.strength`, { kind: "ANY", children }, asJson(emptyFacts()), [trait.definition, tr.affinity], [trait.componentKey], T.INCOMPATIBLE, [{ target: "/facts/keywords", source: { kind: "STEP", stepKey: keywordStep, pointer: "/data" } }]);
      }
    }
    const modifications: TraitSelectedModification[] = tr.modifications.map(modification => ({ definition: trait.definition, componentKey: trait.componentKey, targetComponentKey: trait.appliesTo.componentKey, modification, selected: "parameter" in modification ? selected[modification.parameter] ?? null : null }));
    for (const m of modifications) {
      if (m.modification.kind === "DAMAGE_TYPE" && (!effect || (effect.payload as unknown as EffectDefinitionPayload).effectFamily !== "DAMAGE")) p.add(T.INCOMPATIBLE, ["traits", trait.componentKey], "conversion requires an existing Damage Effect; it cannot add damage");
      if (m.modification.kind === "TARGETING_MEASURE") {
        const t = findBundleDefinition(bundle, composition.targeting.definition)!;
        const targetRules = (t.payload.rules as JsonObject)?.targeting as JsonObject | undefined;
        if (m.modification.measure === "RADIUS" && targetRules?.radiusCapable !== true) p.add(T.INCOMPATIBLE, ["traits", trait.componentKey], "radius modification requires explicit radius-capable Targeting");
      }
    }
    // Repetition on one selected target uses declared stacks; different Effect instances retain separate slots.
    check(`trait.${trait.componentKey}.unique`, { kind: "NUMERIC_COMPARE", factKey: "trait.instances", operator: "<=", expected: 1 }, asJson({ ...emptyFacts(), numeric: [{ key: "trait.instances", value: composition.traits.filter(t => isSameExactDefinition(t.definition, trait.definition) && t.appliesTo.scope === trait.appliesTo.scope && t.appliesTo.componentKey === trait.appliesTo.componentKey).length }] }), [trait.definition], [trait.componentKey]);
    traits.push({ componentKey: trait.componentKey, definition: trait.definition, scope: trait.appliesTo, family: tr.family, name: tr.name, parameters: selected, modifications, costs: costs.map(c => ({ ...c, selected: "parameter" in c ? selected[c.parameter] ?? null : null })) });
  }
  if (spellData?.additionalAffinityTraits.length) p.add(T.CAPACITY_UNRESOLVED, ["additionalAffinityTraits"], "M5-SC-042: no authoritative additional Affinity Trait capacity grant exists yet; ordinary/exchanged capacity cannot be relabeled");
  if (p.count) return finish(p, () => null as never);
  const character = own(r, "character") as AbilityDefinitionRequest["character"];
  const targetingRequest = { contractVersion: 1, definitions: bundle, ruleset: context.value, character: { stats: character.stats, skillRanks: character.skillRanks }, keywords: own(r, "keywords") };
  const targeting = compileAbilityTargeting({ ...targetingRequest, subjectKey: `${subjectKey}.targeting`, composition });
  if (!targeting.ok) return targeting;
  append(targeting.value);
  const targetingChanges: { actionKey: string | null; measure: string; stepKey: string; definitions: ProwessDefinitionRef[] }[] = [];
  const modifyTargeting = (target: ProwessTargetingCompiledPlan, action: typeof firstAction | null) => {
    const changes = traits.flatMap(t => t.modifications).filter(m => m.modification.kind === "TARGETING_MEASURE");
    for (const measure of ["RADIUS", "RANGE", "LENGTH", "WIDTH"] as const) {
      const selected = changes.filter(m => m.modification.kind === "TARGETING_MEASURE" && m.modification.measure === measure);
      if (!selected.length) continue;
      const baseStep = measure === "RANGE" ? target.outputs.range.stepKey : target.outputs.measures.find(m => m.measure === measure)?.stepKey;
      const fixedBase = action && measure === "RANGE" ? action.profile.range.feet : null;
      if ((!baseStep && fixedBase === null) || (measure === "RADIUS" && !target.outputs.radiusCapable)) { p.add(T.INCOMPATIBLE, ["targeting", measure], "Trait requires an explicit supported numeric inherited measure"); continue; }
      const key = `trait.targeting.${action?.componentKey ?? "spell"}.${measure}`;
      const targetKey = { RADIUS: "targeting.radius", RANGE: "targeting.range", LENGTH: "targeting.length", WIDTH: "targeting.width" }[measure];
      const definitions = selected.map(m => m.definition);
      const stepKey = emit(key, "MODIFIER", { request: { targets: [{ targetKey, kind: "NUMERIC", value: fixedBase ?? 0 }], modifiers: selected.map((m, order) => ({ modifierKey: `${m.componentKey}.${measure}`, targetKey, operation: (m.modification as { operation: string }).operation, operand: m.selected, phase: { phaseKey: "TRAITS", phaseOrder: 1 }, priority: 0, order, stacking: { policy: "STACK" }, source: { sourceType: "prowess.trait", sourceKey: m.definition.canonicalKey, sourceId: m.definition.entityVersionId } })) } }, [target.outputs.targeting.definition, ...definitions], selected.map(m => m.componentKey), fixedBase === null && baseStep ? [{ target: "/request/targets/0/value", source: { kind: "STEP", stepKey: baseStep, pointer: "/data/finalValue" } }] : []);
      targetingChanges.push({ actionKey: action?.componentKey ?? null, measure, stepKey, definitions });
    }
  };
  if (spell) modifyTargeting(targeting.value, null);
  const actionConstruction: ProwessConstructionCompiledPlan[] = [];
  const effects: EffectCompilation[] = [];
  const effectGroups = spell ? [{ action: null, composition }] : actions.map(action => {
    const attached = composition.effects.filter(e => man!.effectAttachments.find(a => a.effectKey === e.componentKey)!.actionKeys.includes(action.componentKey));
    return { action, composition: { ...composition, targeting: action.profile.targeting, effects: attached, traits: composition.traits.filter(t => t.appliesTo.componentKey === null || t.appliesTo.scope === "TARGETING" || attached.some(e => e.componentKey === t.appliesTo.componentKey)), branch: { kind: "MANEUVER" as const, foundation: { componentKey: action.componentKey, definition: action.definition, parameters: {} }, martialAccess: null, resolutionProfile: null, data: {} } } };
  });
  for (const group of effectGroups) {
    const groupTargeting = group.action ? compileAbilityTargeting({ ...targetingRequest, subjectKey: `${subjectKey}.targeting.${group.action.componentKey}`, composition: group.composition }) : targeting;
    if (!groupTargeting.ok) return groupTargeting;
    if (group.action) {
      append(groupTargeting.value); modifyTargeting(groupTargeting.value, group.action);
      // Every committed action is checked, including an action with no attached Effect.
      const checked = compileAbilityConstruction({ ...baseRequest, subjectKey: `${subjectKey}.action.${group.action.componentKey}`, composition: { ...composition, targeting: group.composition.targeting, branch: group.composition.branch } });
      if (!checked.ok) return checked;
      append(checked.value); actionConstruction.push(checked.value);
    }
    for (const effect of group.composition.effects) {
      if (group.action) {
        const payload = findBundleDefinition(bundle, effect.definition)!.payload as unknown as EffectDefinitionPayload;
        for (const c of payload.compatibility.filter(x => x.relation === "FOUNDATION")) check(`effect.${effect.componentKey}.foundation.${group.action.componentKey}`, { kind: "SET_CONTAINS", factKey: "effect.foundation", member: group.action.profile.category }, asJson({ ...emptyFacts(), sets: [{ key: "effect.foundation", members: c.allow }] }), [effect.definition, group.action.definition], [effect.componentKey, group.action.componentKey]);
      }
      const plan = compileEffectUse({ ...baseRequest, subjectKey: `${subjectKey}.effect.${group.action?.componentKey ?? "spell"}.${effect.componentKey}`, componentKey: effect.componentKey, composition: group.composition, constructionOptions });
      if (!plan.ok) return plan;
      append(plan.value); effects.push({ actionKey: group.action?.componentKey ?? null, plan: plan.value, targeting: groupTargeting.value });
    }
  }
  const duration = composition.duration ? findBundleDefinition(bundle, composition.duration.definition) : null;
  if (!duration) p.add(A.DURATION, ["duration"], "authored Ability requires an exact Duration Definition");
  else {
    const concept = (duration.payload as unknown as DurationDefinitionPayload).durationConcept, params = composition.duration!.parameters;
    if (Object.keys(params).some(k => k !== "rounds") || (concept === "ROUNDS" ? !Number.isSafeInteger(params.rounds) || (params.rounds as number) < 1 : Object.keys(params).length > 0)) p.add(A.DURATION, ["duration", "parameters"], "only ROUNDS accepts an explicit positive rounds count; maintenance is deferred");
    for (const e of effects) check(`duration.${e.actionKey ?? "spell"}.${e.plan.subject.componentKey}`, { kind: "SET_CONTAINS", factKey: "duration.allowed", member: concept }, asJson({ ...emptyFacts(), sets: [{ key: "duration.allowed", members: e.plan.outputs.duration.allowed }] }), [composition.duration!.definition, e.plan.outputs.effect.definition], [composition.duration!.componentKey, e.plan.subject.componentKey], A.DURATION);
  }
  const durationConditions = compileDurationConditions({ bundle, composition, construction: construction.value, effects, traits, actions, targeting: targeting.value, stats: character.stats }, emit, check, p);
  if (p.count) return finish(p, () => null as never);
  const explained = [...steps];
  const explanationStepKey = emit("explanation", "EXPLANATION", { input: { explanationKey: `authored.${subjectKey}`, contributions: explained.map((s, i) => ({ contributionKey: s.stepKey, order: i, kind: s.operation === "FORMULA" ? "FORMULA" : s.operation === "KEYWORD" ? "KEYWORD" : s.operation === "MODIFIER" ? "MODIFIER" : s.operation === "EXPLANATION" ? "GENERIC" : "REQUIREMENT", response: null })) } }, [definitionRefOf(d)], [composition.compositionKey], explained.map((s, i) => ({ target: `/input/contributions/${i}/response`, source: { kind: "STEP", stepKey: s.stepKey, pointer: "" } })));
  return finish(p, () => clonePlainData({ contractVersion: 1 as const, subject: { kind: "AUTHORED_ABILITY" as const, subjectKey: subjectKey as string, abilityKind: composition.abilityKind }, rulesetProvenance: bundle.rulesetProvenance, definition: definitionRefOf(d), evaluationPlan: { steps, primaryStepKey: null, validationStepKey: null, explanationStepKey }, sourceMap: { entries }, authored, construction: construction.value, targeting: targeting.value, effects, traits, rules, actions, targetingChanges, actionConstruction, ...(durationConditions ? { durationConditions } : {}), explanationStepKey }));
}

export function readAbilityDefinitionRun(plan: ProwessAbilityDefinitionCompiledPlan, run: unknown): ProwessOutcome<AuthoredAbilityResult> {
  const p = new Problems(); if (!checkPlainData(run, [], p, A.INCOMPLETE_RUN)) return finish(p, () => null as never);
  if (!isPlainObject(run) || !Array.isArray(run.steps)) { p.add(A.INCOMPLETE_RUN, [], "exact EvaluationRun required"); return finish(p, () => null as never); }
  if (!run.steps.every(s => isPlainObject(s) && isPlainObject(s.response) && isPlainObject(s.response.data) && Array.isArray(s.blockedBy) && s.blockedBy.length === 0)) { p.add(A.INCOMPLETE_RUN, [], "each executed step needs a structured successful response and no blocked bindings"); return finish(p, () => null as never); }
  const full = run as unknown as EvaluationRun;
  if (full.explanationStepKey !== plan.explanationStepKey || full.primaryStepKey !== null || full.validationStepKey !== null) { p.add(A.INCOMPLETE_RUN, [], "run designations must match the authored plan"); return finish(p, () => null as never); }
  for (const change of plan.targetingChanges) {
    const data = full.steps.find(s => s.stepKey === change.stepKey)?.response?.data;
    if (!isPlainObject(data) || !Array.isArray(data.finalTargets) || !isPlainObject(data.finalTargets[0]) || typeof data.finalTargets[0].value !== "number" || !Number.isFinite(data.finalTargets[0].value)) p.add(A.INCOMPLETE_RUN, [], "numeric targeting modifier result required");
  }
  if (p.count) return finish(p, () => null as never);
  if (full.executionStatus !== "COMPLETE" || new Set(full.steps.map(s => s.stepKey)).size !== full.steps.length || full.steps.length !== plan.evaluationPlan.steps.length || plan.evaluationPlan.steps.some(s => !full.steps.some(x => x.stepKey === s.stepKey && x.operation === s.operation && x.order === s.order && JSON.stringify(clonePlainData(x.response?.ruleset ?? null)) === JSON.stringify(clonePlainData(plan.rulesetProvenance)) && x.executionStatus === "EXECUTED" && x.response?.success))) { p.add(A.INCOMPLETE_RUN, [], "every step must match and execute successfully"); return finish(p, () => null as never); }
  if (plan.durationConditions && full.steps.some(s => { const data = s.response!.data as { finalValue?: unknown }; return s.stepKey.includes(".wo9.") && s.operation === "FORMULA" && (!Number.isSafeInteger(data.finalValue) || (data.finalValue as number) < 0); })) { p.add(A.INCOMPLETE_RUN, [], "WO9 contribution results must be complete nonnegative safe integers"); return finish(p, () => null as never); }
  const subset = (child: { evaluationPlan: EvaluationPlan }): EvaluationRun => ({ ...full, steps: full.steps.filter(s => child.evaluationPlan.steps.some(x => x.stepKey === s.stepKey)) });
  const construction = readAbilityConstructionRun({ plan: plan.construction, run: subset(plan.construction) }); if (!construction.ok) return construction;
  const targeting = readAbilityTargetingRun({ plan: plan.targeting, run: subset(plan.targeting) }); if (!targeting.ok) return targeting;
  const effects: { actionKey: string | null; result: EffectUseResult }[] = [];
  for (const e of plan.effects) { const t = readAbilityTargetingRun({ plan: e.targeting, run: subset(e.targeting) }); if (!t.ok) return t; const result = readEffectRun({ plan: e.plan, run: subset(e.plan), targeting: t.value }); if (!result.ok) return result; effects.push({ actionKey: e.actionKey, result: result.value }); }
  const problems = plan.rules.filter(q => (full.steps.find(s => s.stepKey === q.stepKey)!.response!.data as { satisfied: boolean }).satisfied !== true).map(q => ({ code: q.code, path: q.ruleKey, message: `authored structural rule failed: ${q.ruleKey}` }));
  for (const child of plan.actionConstruction) {
    const result = readAbilityConstructionRun({ plan: child, run: subset(child) });
    if (!result.ok) return result;
    if (!result.value.valid) problems.push({ code: A.FOUNDATION, path: child.subject.subjectKey, message: "committed action prerequisites failed" });
  }
  if (!construction.value.valid) problems.push({ code: A.INVALID, path: "construction", message: construction.value.problems.join(", ") });
  if (!targeting.value.valid) problems.push({ code: A.INVALID, path: "targeting", message: targeting.value.problems.join(", ") });
  for (const e of effects) if (!e.result.valid) problems.push({ code: A.INVALID, path: e.result.componentKey, message: e.result.problems.join(", ") });
  const man = plan.subject.abilityKind === "MANEUVER" ? plan.authored as ManeuverDefinitionPayload : null;
  const additional = plan.subject.abilityKind === "SPELL" ? (plan.authored as SpellDefinitionPayload).additionalAffinityTraits.length : 0;
  return finish(p, () => ({ ...(plan.durationConditions ? { durationConditions: readDurationConditionRun(plan.durationConditions, full) } : {}), valid: problems.length === 0, status: problems.length ? "INVALID" : "VALID", abilityKind: plan.subject.abilityKind, definition: plan.definition, rulesetProvenance: plan.rulesetProvenance, construction: construction.value, targeting: targeting.value, effects, traits: plan.traits, traitCapacity: { ordinary: { base: construction.value.capacity.traits.base, effective: construction.value.capacity.traits.effective, used: construction.value.usage.traits }, affinityAdditional: { capacity: null, used: additional, conflictKey: "M5-SC-042" } }, actions: plan.actions, targetingChanges: plan.targetingChanges.map(c => ({ actionKey: c.actionKey, measure: c.measure, definitions: c.definitions, value: (full.steps.find(s => s.stepKey === c.stepKey)!.response!.data as unknown as { finalTargets: { value: number }[] }).finalTargets[0]!.value })), powerfulBlow: man?.powerfulBlow ? { actionKeys: man.powerfulBlow.actionKeys, damageSource: "COMBINED_COMMITTED_ATTACKS", attachedEffectsResolve: "ONCE" } : null, problems }));
}
export function evaluateAbilityDefinition(request: unknown): ProwessOutcome<AuthoredAbilityResult> {
  const plan = compileAbilityDefinition(request); if (!plan.ok) return plan;
  const raw = request as AbilityDefinitionRequest;
  const response = orchestrateRulesEvaluation({ evaluationKey: `authored.${raw.subjectKey}`, contexts: { ruleset: raw.ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || !response.data) { const p = new Problems(); p.add(A.INCOMPLETE_RUN, [], "M4 could not evaluate the authored Definition plan"); return finish(p, () => null as never); }
  return readAbilityDefinitionRun(plan.value, response.data);
}
