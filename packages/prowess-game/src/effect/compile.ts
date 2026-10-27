import type { JsonObject } from "@prowess/model";
import { createRulesetContext, orchestrateRulesEvaluation, type EvaluationPlan, type EvaluationRun, type RuleProvenance } from "@prowess/rules";
import { keywordReference, readKeywordCatalog } from "../affinity/definitions.js";
import { bundleMatchesRuleset, findBundleDefinition, type ProwessDefinitionBundle, type ProwessRulesetProvenance, createBundleWithinCheckedRequest } from "../bundle/bundle.js";
import { assembleFragments, compiledStepKey } from "../compilation/assemble.js";
import type { CompilationFragment, ProwessCompilationSourceMap } from "../compilation/model.js";
import { validateAbilityComposition, type AbilityComposition } from "../construction/composition.js";
import {
  evaluateAbilityConstruction,
  type AbilityConstructionCharacterContext,
  type AbilityConstructionResult,
  type SignatureCandidate,
} from "../construction/legality.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION, SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS, type ProwessCompilationContractVersion } from "../contract-version.js";
import { COMPILATION_ERROR_CODES as X, DEFINITION_ERROR_CODES as C } from "../definition/codes.js";
import {
  EFFECT_ERROR_CODES as E,
  readEffectCosts,
  readEffectOutcomes,
  readEffectRules,
  readTargetingDeliveryRule,
  type EffectCostRule,
  type EffectOutcomeReading,
  type EffectParameterRule,
  type EffectRules,
  type TargetingDeliveryRule,
} from "../definition/effect-payload.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { CompatibilityRule, EffectDefinitionPayload } from "../definition/payload.js";
import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactLabel, isToken, own, readRecord, readSafeInteger, type ProwessOutcome } from "../internal/problems.js";
import { evaluateAbilityTargeting, type AbilityTargetingResult } from "../targeting/compile.js";
import type { ResolutionMode } from "../vocabulary/construction.js";
import type { ProwessStat } from "../vocabulary/core.js";
import type { AbilityKind, ProwessDefinitionKind } from "../vocabulary/families.js";
import type { EffectDeliveryInteraction, TargetingDeliveryCheck } from "../vocabulary/effect.js";

export type EffectCharacterContext = AbilityConstructionCharacterContext;
export interface EffectUseRequest {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subjectKey: string;
  readonly componentKey: string;
  readonly composition: unknown;
  readonly definitions: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  readonly character: EffectCharacterContext;
  readonly keywords: unknown;
  readonly signature: { readonly usedSlots: number; readonly candidate: SignatureCandidate };
  readonly constructionOptions?: { readonly effectSlotsTradedForTraits?: number };
  readonly accessGrants?: readonly { readonly componentKey: string; readonly sourceKey: string }[];
  readonly targetingModifiers?: readonly { readonly componentKey: string; readonly sourceKey: string }[];
}
export type EffectParameterValue = number | string | boolean;
export interface EffectCompiledFormula { readonly formulaKey: string; readonly stepKey: string; readonly unit: string | null; }
export interface EffectCompiledOutputs {
  readonly abilityKind: AbilityKind;
  readonly effect: { readonly componentKey: string; readonly definition: ProwessDefinitionRef; readonly definitionKind: ProwessDefinitionKind; readonly family: string; readonly subfamily: string | null };
  readonly resolutionPolicy: EffectRules["resolutionPolicy"];
  readonly resolution: ResolutionMode | null;
  readonly attackType: EffectRules["attackType"];
  readonly saveProfile: EffectRules["saveProfile"];
  readonly targetingCompatibility: readonly string[];
  readonly targetCategories: EffectRules["targetCategories"];
  readonly deliveryCheck: TargetingDeliveryCheck | null;
  readonly deliveryInteraction: EffectDeliveryInteraction;
  readonly parameters: readonly { readonly parameter: string; readonly value: EffectParameterValue | null; readonly explicit: boolean }[];
  readonly parameterRules: readonly { readonly ruleKey: string; readonly stepKey: string }[];
  readonly formulas: readonly EffectCompiledFormula[];
  readonly costContributions: readonly (EffectCostRule & { readonly selected: EffectParameterValue | null })[];
  readonly outcomes: readonly EffectOutcomeReading[];
  readonly duration: EffectRules["duration"];
  readonly targetingConversion: EffectRules["targetingConversion"];
  readonly restrictions: readonly string[];
  readonly keywordsStepKey: string | null;
  readonly construction: { readonly valid: boolean; readonly access: AbilityConstructionResult["access"]; readonly prerequisites: AbilityConstructionResult["prerequisites"]; readonly affinityAccess: AbilityConstructionResult["affinityAccess"]; readonly stacking: AbilityConstructionResult["stacking"] };
}
export interface ProwessEffectCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: { readonly kind: "ABILITY_EFFECT"; readonly subjectKey: string; readonly abilityKind: AbilityKind; readonly compositionKey: string; readonly componentKey: string };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
  readonly outputs: EffectCompiledOutputs;
}
export interface EffectUseResult {
  readonly abilityKind: AbilityKind;
  readonly compositionKey: string;
  readonly componentKey: string;
  readonly status: "VALID" | "INVALID";
  readonly valid: boolean;
  readonly effect: EffectCompiledOutputs["effect"];
  readonly resolutionPolicy: EffectCompiledOutputs["resolutionPolicy"];
  readonly resolution: ResolutionMode | null;
  readonly attackType: EffectCompiledOutputs["attackType"];
  readonly validSaves: readonly ProwessStat[];
  readonly saveSelectionPolicy: string | null;
  readonly targetingCompatibility: readonly string[];
  readonly targetingStatus: "COMPATIBLE" | "MODIFIED_BY_EXPLICIT_RULE" | "INCOMPATIBLE" | "NOT_DECLARED";
  readonly access: { readonly satisfied: boolean; readonly constructionValid: boolean; readonly prerequisites: readonly { readonly ruleKey: string; readonly satisfied: boolean }[]; readonly affinity: boolean; readonly stacking: boolean };
  readonly delivery: { readonly check: TargetingDeliveryCheck | null; readonly interaction: EffectDeliveryInteraction; readonly effectResolution: ResolutionMode | null };
  readonly parameters: EffectCompiledOutputs["parameters"];
  readonly formulaValues: readonly { readonly formulaKey: string; readonly value: number; readonly unit: string | null }[];
  readonly costContributions: EffectCompiledOutputs["costContributions"];
  readonly outcomes: EffectCompiledOutputs["outcomes"];
  readonly duration: EffectCompiledOutputs["duration"];
  readonly targetingConversion: EffectCompiledOutputs["targetingConversion"];
  readonly restrictions: readonly string[];
  readonly keywords: readonly { readonly keywordId: string; readonly canonicalKey: string; readonly sources: readonly JsonObject[] }[];
  readonly rules: readonly { readonly ruleKey: string; readonly satisfied: boolean; readonly outcome: JsonObject }[];
  readonly problems: readonly string[];
  readonly provenance: { readonly ruleset: ProwessRulesetProvenance; readonly effect: ProwessDefinitionRef; readonly targeting: ProwessDefinitionRef };
}

const REQUEST_FIELDS = ["contractVersion", "subjectKey", "componentKey", "composition", "definitions", "ruleset", "character", "keywords", "signature", "constructionOptions", "accessGrants", "targetingModifiers"];
const REQUEST_REQUIRED = ["contractVersion", "subjectKey", "componentKey", "composition", "definitions", "ruleset", "character", "keywords", "signature"];
const SUBJECT_KIND = "ABILITY_EFFECT";
const KEYWORD_SOURCE_TYPE = "prowess.effect";
const emptyFacts = (): JsonObject => ({ numeric: [], ranks: [], sets: [], ownedEntityIds: null, keywords: null });
const provenanceJson = (p: RuleProvenance): JsonObject => ({ ...p }) as unknown as JsonObject;

function nonNegative(value: unknown, p: Problems, path: readonly (string | number)[], what: string): number | null {
  const n = readSafeInteger(value, path, p, E.INVALID_EFFECT_RULES, what);
  if (n !== null && n < 0) { p.add(E.INVALID_EFFECT_RULES, path, `${what} is non-negative`); return null; }
  return n;
}
function readEffectParameters(raw: Record<string, unknown>, rules: EffectRules, componentKey: string, p: Problems): Map<string, EffectParameterValue> | null {
  const before = p.count; const out = new Map<string, EffectParameterValue>();
  for (const name of Object.keys(raw).sort()) {
    const at = ["composition", "effects", componentKey, "parameters", name]; const rule = rules.parameters.find((q) => q.parameter === name);
    if (!rule) { p.add(E.INVALID_EFFECT_RULES, at, `${name} is not declared by this exact Effect Definition`); continue; }
    const value = own(raw, name);
    if (rule.kind === "COUNT") { const n = nonNegative(value, p, at, name); if (n !== null) out.set(name, n); }
    else if (rule.kind === "FLAG") { if (typeof value !== "boolean") p.add(E.INVALID_EFFECT_RULES, at, `${name} is boolean`); else out.set(name, value); }
    else if (!isToken(value) || !rule.allowed.includes(value)) p.add(E.INVALID_EFFECT_RULES, at, `${name} is one of ${rule.allowed.join(", ")}`); else out.set(name, value);
  }
  return p.count > before ? null : out;
}
const parameterValue = (rule: EffectParameterRule, selected: ReadonlyMap<string, EffectParameterValue>): EffectParameterValue | null => selected.has(rule.parameter) ? selected.get(rule.parameter)! : rule.default;
function deliveryInteraction(check: TargetingDeliveryCheck | null, resolution: ResolutionMode | null, policy: EffectRules["resolutionPolicy"]): EffectDeliveryInteraction {
  if (check === null) return "NONE";
  if (policy === "INHERIT_ABILITY") return "DELIVERY_THEN_INHERITED";
  if (resolution === "ATTACK_ROLL") return "SAME_ATTACK_ROLL";
  if (resolution === "SAVING_THROW") return "DELIVERY_THEN_SAVE";
  if (resolution === "AUTOMATIC") return "DELIVERY_THEN_AUTOMATIC";
  return "NONE";
}
function targetingDelivery(composition: AbilityComposition, bundle: ProwessDefinitionBundle, p: Problems): { ref: ProwessDefinitionRef; rule: TargetingDeliveryRule | null } | null {
  const envelope = findBundleDefinition(bundle, composition.targeting.definition); if (!envelope) return null;
  const payload = envelope.payload as Record<string, unknown>; const raw = own((own(payload, "rules") ?? {}) as Record<string, unknown>, "delivery");
  return { ref: composition.targeting.definition, rule: readTargetingDeliveryRule(raw, ["definitions", envelope.canonicalKey, "payload", "rules", "delivery"], p) };
}

export function compileEffectUse(request: unknown): ProwessOutcome<ProwessEffectCompiledPlan> {
  const p = new Problems(); if (!checkPlainData(request, [], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never);
  const r = readRecord(request, [], p, E.INVALID_EFFECT_RULES, REQUEST_FIELDS, REQUEST_REQUIRED); if (!r) return finish(p, () => null as never);
  const contractVersion = own(r, "contractVersion"); if (typeof contractVersion !== "number" || !SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.includes(contractVersion)) p.add(X.UNSUPPORTED_CONTRACT_VERSION, ["contractVersion"], `supported Prowess compilation contract versions: ${SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS.join(", ")}`);
  const subjectKey = own(r, "subjectKey"), componentKey = own(r, "componentKey"); if (!isExactLabel(subjectKey)) p.add(E.INVALID_EFFECT_RULES, ["subjectKey"], "subjectKey is an exact label"); if (!isExactLabel(componentKey)) p.add(E.INVALID_EFFECT_RULES, ["componentKey"], "componentKey is an exact label");
  const ruleset = createRulesetContext(own(r, "ruleset")); const rawBundle = own(r, "definitions"); let bundle: ProwessDefinitionBundle | null = null;
  if (!ruleset.ok) p.add(E.INVALID_EFFECT_RULES, ["ruleset"], "an exact valid M4 RulesetContext is required");
  else if (!isPlainObject(rawBundle)) p.add(E.INVALID_EFFECT_RULES, ["definitions"], "definitions is exact ProwessDefinitionBundle");
  else { const rebuilt = createBundleWithinCheckedRequest(own(r, "ruleset"), own(rawBundle, "definitions") ?? null, true); if (!rebuilt.ok) for (const problem of rebuilt.problems) p.list.push({ ...problem, path: `/definitions${problem.path}` }); else if (!bundleMatchesRuleset(rebuilt.value, ruleset.value)) p.add(X.BUNDLE_RULESET_MISMATCH, ["definitions"], "bundle belongs to another Ruleset"); else bundle = rebuilt.value; }
  const catalog = readKeywordCatalog(own(r, "keywords"), ["keywords"], p); if (p.count || !bundle || !catalog) return finish(p, () => null as never);
  const compositionOut = validateAbilityComposition(own(r, "composition"), { bundle }); if (!compositionOut.ok) for (const problem of compositionOut.problems) p.list.push({ ...problem, path: `/composition${problem.path}` }); if (!compositionOut.ok || p.count) return finish(p, () => null as never);
  const composition = compositionOut.value; const effectUse = composition.effects.find((x) => x.componentKey === componentKey); if (!effectUse) { p.add(E.INVALID_EFFECT_RULES, ["componentKey"], "componentKey names one Effect use"); return finish(p, () => null as never); }
  const envelope = findBundleDefinition(bundle, effectUse.definition); if (!envelope || (envelope.definitionKind !== "SPELL_EFFECT" && envelope.definitionKind !== "MANEUVER_EFFECT")) { p.add(E.INVALID_EFFECT_RULES, ["componentKey"], "exact Effect Definition required"); return finish(p, () => null as never); }
  const branch = envelope.definitionKind === "SPELL_EFFECT" ? "SPELL" : "MANEUVER"; const payload = envelope.payload as unknown as EffectDefinitionPayload; const rawEffectRules = own((payload.rules ?? {}) as Record<string, unknown>, "effect");
  if (rawEffectRules === undefined) { p.add(E.EFFECT_RULE_MISSING, ["definitions", envelope.canonicalKey, "payload", "rules", "effect"], "executable rules.effect contract required"); return finish(p, () => null as never); }
  const eAt = ["definitions", envelope.canonicalKey, "payload"]; const effectRules = readEffectRules(rawEffectRules, payload.effectFamily, branch, payload.resolution, [...eAt, "rules", "effect"], p); const costs = effectRules ? readEffectCosts(payload.costContributions, effectRules, [...eAt, "costContributions"], p) : null; const outcomes = readEffectOutcomes(payload.outcomes, [...eAt, "outcomes"], p);
  if (!effectRules || !costs || p.count) return finish(p, () => null as never);
  const params = readEffectParameters(effectUse.parameters as Record<string, unknown>, effectRules, effectUse.componentKey, p); const delivery = targetingDelivery(composition, bundle, p); if (!params || !delivery || p.count) return finish(p, () => null as never);
  const constructionOptions = own(r, "constructionOptions"); const accessGrants = own(r, "accessGrants");
  const construction = evaluateAbilityConstruction({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subjectKey: `${String(subjectKey)}.construction`, composition, definitions: bundle, ruleset: own(r, "ruleset"), character: own(r, "character"), keywords: own(r, "keywords"), signature: own(r, "signature"), ...(constructionOptions === undefined ? {} : { options: constructionOptions }), ...(accessGrants === undefined ? {} : { accessGrants }) });
  if (!construction.ok) for (const problem of construction.problems) p.list.push({ ...problem, path: `/construction${problem.path}` }); if (!construction.ok || p.count) return finish(p, () => null as never); const constructionResult = construction.value;
  const character = own(r, "character") as EffectCharacterContext; const stat = (s: ProwessStat): number | null => { const v = character.stats[s]; if (!Number.isSafeInteger(v) || (v as number) < 0) { p.add(E.INVALID_EFFECT_RULES, ["character", "stats", s], `valid ${s} required`); return null; } return v as number; };
  const fragments: CompilationFragment[] = []; const components = new Map<string, ProwessDefinitionRef[]>([[effectUse.componentKey, [effectUse.definition]]]); const emit = (f: CompilationFragment) => { fragments.push(f); return f.fragmentKey; };
  const effectProv: RuleProvenance = { entityId: envelope.entityId, entityVersionId: envelope.entityVersionId, canonicalKey: envelope.canonicalKey, rulesetId: bundle.rulesetProvenance.rulesetId, manifestId: bundle.rulesetProvenance.manifestId } as RuleProvenance;
  const parameterRules: { ruleKey: string; stepKey: string }[] = [];
  const requirement = (ruleKey: string, parameter: string, value: number, operator: ">=" | "<=", expected: number) => { const factKey = `effect.parameter.${effectUse.componentKey}.${parameter}`; const fragmentKey = emit({ fragmentKey: ruleKey, order: 100, operation: "REQUIREMENT", input: { requirement: { kind: "NUMERIC_COMPARE", factKey, operator, expected, provenance: provenanceJson(effectProv) }, facts: { ...emptyFacts(), numeric: [{ key: factKey, value, provenance: null }] } }, bindings: [], role: "effect-parameter-bound", componentKeys: [effectUse.componentKey], definitions: [effectUse.definition] }); parameterRules.push({ ruleKey, stepKey: fragmentKey }); };
  for (const q of effectRules.parameters) { const value = parameterValue(q, params); if (q.kind === "COUNT" && typeof value === "number") { if (q.minimum !== null) requirement(`parameter.${q.parameter}.minimum`, q.parameter, value, ">=", q.minimum); if (q.maximum?.kind === "FIXED") requirement(`parameter.${q.parameter}.maximum`, q.parameter, value, "<=", q.maximum.value); if (q.maximum?.kind === "STAT") { const max = stat(q.maximum.stat); if (max !== null) requirement(`parameter.${q.parameter}.maximum`, q.parameter, value, "<=", max); } } }
  if (p.count) return finish(p, () => null as never);
  const compiledFormulas: EffectCompiledFormula[] = [];
  for (const f of effectRules.formulas) { const variables: Record<string, number> = {}; for (const v of f.variables) { if (v.source.kind === "STAT") { const x = stat(v.source.stat); if (x !== null) variables[v.variable] = x; } else if (v.source.kind === "PARAMETER") { const parameter = v.source.parameter; const q = effectRules.parameters.find((x) => x.parameter === parameter)!; const x = parameterValue(q, params); if (typeof x !== "number") p.add(E.INVALID_EFFECT_RULES, ["composition", "effects", effectUse.componentKey, "parameters", parameter], `numeric ${parameter} required`); else variables[v.variable] = x; } else { const x = constructionResult.access.martialRankValue; if (x === null) p.add(E.INVALID_EFFECT_RULES, ["composition", "effects", effectUse.componentKey], `Martial Rank Value required by ${f.formulaKey}`); else variables[v.variable] = x; } } if (p.count) continue; const k = emit({ fragmentKey: `formula.${f.formulaKey}`, order: 200, operation: "FORMULA", input: { program: { expression: f.expression, rounding: f.rounding, ...(f.minimum === null ? {} : { minimum: f.minimum }), ...(f.unit === null ? {} : { unit: f.unit }), provenance: provenanceJson(effectProv) }, variables }, bindings: [], role: "effect-scaling-formula", componentKeys: [effectUse.componentKey], definitions: [effectUse.definition] }); compiledFormulas.push({ formulaKey: f.formulaKey, stepKey: k, unit: f.unit }); }
  let keywordsStepKey: string | null = null; if (payload.keywords.length) { const contributions: JsonObject[] = []; for (const canonicalKey of payload.keywords) { const ref = keywordReference(catalog, canonicalKey); if (!ref) p.add(E.INVALID_EFFECT_RULES, [...eAt, "keywords"], `${canonicalKey} must resolve by exact Keyword identity`); else contributions.push({ keyword: { keywordId: ref.keywordId, canonicalKey: ref.canonicalKey, categoryId: ref.categoryId }, source: { sourceType: KEYWORD_SOURCE_TYPE, sourceKey: effectUse.componentKey, sourceId: envelope.entityVersionId, provenance: provenanceJson(effectProv) }, ordinal: 0 }); } if (!p.count) keywordsStepKey = emit({ fragmentKey: "keywords", order: 300, operation: "KEYWORD", input: { contributions }, bindings: [], role: "effect-keywords", componentKeys: [effectUse.componentKey], definitions: [effectUse.definition] }); }
  if (p.count) return finish(p, () => null as never);
  const targetingAllow = ((payload.compatibility ?? []) as readonly CompatibilityRule[]).filter((q) => q.relation === "TARGETING").flatMap((q) => q.allow).filter((v, i, a) => a.indexOf(v) === i).sort(); const selected = (q: EffectParameterRule) => parameterValue(q, params); const costContributions = costs.map((c) => ({ ...c, selected: "parameter" in c ? selected(effectRules.parameters.find((q) => q.parameter === c.parameter)!) : null })); const interaction = deliveryInteraction(delivery.rule?.check ?? null, payload.resolution?.mode ?? null, effectRules.resolutionPolicy);
  const assembled = assembleFragments({ subjectKind: SUBJECT_KIND, subjectKey: subjectKey as string, components, bundle, fragments }, p); if (p.count) return finish(p, () => null as never); const step = (k: string | null) => k === null ? null : compiledStepKey(SUBJECT_KIND, subjectKey as string, k);
  const outputs: EffectCompiledOutputs = { abilityKind: composition.abilityKind, effect: { componentKey: effectUse.componentKey, definition: effectUse.definition, definitionKind: envelope.definitionKind, family: payload.effectFamily, subfamily: effectRules.effectSubfamily }, resolutionPolicy: effectRules.resolutionPolicy, resolution: payload.resolution?.mode ?? null, attackType: effectRules.attackType, saveProfile: effectRules.saveProfile, targetingCompatibility: targetingAllow, targetCategories: effectRules.targetCategories, deliveryCheck: delivery.rule?.check ?? null, deliveryInteraction: interaction, parameters: effectRules.parameters.map((q) => ({ parameter: q.parameter, value: selected(q), explicit: params.has(q.parameter) })), parameterRules: parameterRules.map((q) => ({ ...q, stepKey: step(q.stepKey)! })), formulas: compiledFormulas.map((f) => ({ ...f, stepKey: step(f.stepKey)! })), costContributions, outcomes, duration: effectRules.duration, targetingConversion: effectRules.targetingConversion, restrictions: effectRules.restrictions, keywordsStepKey: step(keywordsStepKey), construction: { valid: constructionResult.valid, access: constructionResult.access, prerequisites: constructionResult.prerequisites.filter((x) => x.componentKey === effectUse.componentKey), affinityAccess: constructionResult.affinityAccess.filter((x) => x.componentKey === effectUse.componentKey), stacking: constructionResult.stacking.filter((x) => x.componentKey === effectUse.componentKey) } };
  return finish(p, () => deepFreeze({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subject: { kind: SUBJECT_KIND, subjectKey: subjectKey as string, abilityKind: composition.abilityKind, compositionKey: composition.compositionKey, componentKey: effectUse.componentKey }, rulesetProvenance: bundle.rulesetProvenance, evaluationPlan: { steps: assembled.steps, primaryStepKey: null, validationStepKey: null, explanationStepKey: null }, sourceMap: { entries: assembled.entries }, outputs }) as ProwessEffectCompiledPlan);
}

export function readEffectRun(input: { readonly plan: ProwessEffectCompiledPlan; readonly run: unknown; readonly targeting: AbilityTargetingResult }): ProwessOutcome<EffectUseResult> {
  const p = new Problems(); if (!checkPlainData(input.run, ["run"], p, C.NOT_PLAIN_DATA)) return finish(p, () => null as never); const steps = isPlainObject(input.run) ? own(input.run, "steps") : undefined; if (!Array.isArray(steps)) { p.add(E.INVALID_EFFECT_RULES, ["run"], "EvaluationRun steps required"); return finish(p, () => null as never); }
  const planned = new Set(input.plan.evaluationPlan.steps.map((s) => s.stepKey)), ran = new Set(steps.map((s) => isPlainObject(s) ? own(s, "stepKey") : null)); if (planned.size !== ran.size || ![...planned].every((k) => ran.has(k))) { p.add(E.INVALID_EFFECT_RULES, ["run", "steps"], "run evaluates exactly this Effect plan"); return finish(p, () => null as never); }
  const data = (stepKey: string): Record<string, unknown> | null => { const s = steps.find((x) => isPlainObject(x) && own(x, "stepKey") === stepKey) as Record<string, unknown> | undefined; const response = s ? own(s, "response") : undefined; const d = isPlainObject(response) && own(response, "success") === true ? own(response, "data") : undefined; if (!s || own(s, "executionStatus") !== "EXECUTED" || !isPlainObject(d)) { p.add(E.INVALID_EFFECT_RULES, ["run", "steps"], `step ${stepKey} did not execute successfully`); return null; } return d; };
  const rules = input.plan.outputs.parameterRules.map((q) => { const d = data(q.stepKey); return { ruleKey: q.ruleKey, satisfied: d !== null && own(d, "satisfied") === true, outcome: ((d ? own(d, "outcome") : null) ?? {}) as JsonObject }; });
  const formulaValues = input.plan.outputs.formulas.map((f) => { const d = data(f.stepKey), v = d ? own(d, "finalValue") : undefined; if (typeof v !== "number" || !Number.isFinite(v)) p.add(E.INVALID_EFFECT_RULES, ["run", "steps"], `formula ${f.formulaKey} missing finite result`); return { formulaKey: f.formulaKey, value: typeof v === "number" ? v : Number.NaN, unit: f.unit }; });
  const keywordData = input.plan.outputs.keywordsStepKey === null ? null : data(input.plan.outputs.keywordsStepKey); const keywords = ((keywordData ? own(keywordData, "keywords") ?? [] : []) as { keyword: { keywordId: string; canonicalKey: string }; contributors?: JsonObject[] }[]).map((k) => ({ keywordId: k.keyword.keywordId, canonicalKey: k.keyword.canonicalKey, sources: [...(k.contributors ?? [])] })); if (p.count) return finish(p, () => null as never);
  const c = input.plan.outputs.construction; const prerequisites = c.prerequisites.map((x) => ({ ruleKey: x.ruleKey, satisfied: x.satisfied })); const affinity = c.affinityAccess.every((x) => x.satisfied), stacking = c.stacking.every((x) => x.satisfied), accessSatisfied = c.access.satisfied && prerequisites.every((x) => x.satisfied) && affinity && stacking; const target = input.targeting.compatibility.find((x) => x.componentKey === input.plan.subject.componentKey); const targetingStatus = target?.status ?? "NOT_DECLARED"; const targetingSatisfied = targetingStatus === "COMPATIBLE" || targetingStatus === "MODIFIED_BY_EXPLICIT_RULE"; const valid = rules.every((x) => x.satisfied) && accessSatisfied && c.valid && targetingSatisfied && input.targeting.valid;
  const problems = [...rules.filter((x) => !x.satisfied).map((x) => x.ruleKey), ...(!accessSatisfied ? ["access"] : []), ...(!c.valid ? ["construction"] : []), ...(!targetingSatisfied ? ["targeting.compatibility"] : []), ...(!input.targeting.valid ? ["targeting"] : [])];
  return finish(p, () => deepFreeze({ abilityKind: input.plan.outputs.abilityKind, compositionKey: input.plan.subject.compositionKey, componentKey: input.plan.subject.componentKey, status: valid ? "VALID" : "INVALID", valid, effect: input.plan.outputs.effect, resolutionPolicy: input.plan.outputs.resolutionPolicy, resolution: input.plan.outputs.resolution, attackType: input.plan.outputs.attackType, validSaves: input.plan.outputs.saveProfile?.validSaves ?? [], saveSelectionPolicy: input.plan.outputs.saveProfile?.selectionPolicy ?? null, targetingCompatibility: input.plan.outputs.targetingCompatibility, targetingStatus, access: { satisfied: accessSatisfied, constructionValid: c.valid, prerequisites, affinity, stacking }, delivery: { check: input.plan.outputs.deliveryCheck, interaction: input.plan.outputs.deliveryInteraction, effectResolution: input.plan.outputs.resolution }, parameters: input.plan.outputs.parameters, formulaValues, costContributions: input.plan.outputs.costContributions, outcomes: input.plan.outputs.outcomes, duration: input.plan.outputs.duration, targetingConversion: input.plan.outputs.targetingConversion, restrictions: input.plan.outputs.restrictions, keywords, rules, problems, provenance: { ruleset: input.plan.rulesetProvenance, effect: input.plan.outputs.effect.definition, targeting: input.targeting.targeting.definition } }) as EffectUseResult);
}

export function validateEffectUse(request: unknown): ProwessOutcome<EffectUseResult> {
  const plan = compileEffectUse(request); if (!plan.ok) return plan as ProwessOutcome<never>; const raw = request as Record<string, unknown>;
  const targetingModifiers = own(raw, "targetingModifiers");
  const character = own(raw, "character") as EffectCharacterContext;
  const targetingCharacter = { stats: character.stats, skillRanks: character.skillRanks };
  const targeting = evaluateAbilityTargeting({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subjectKey: `${String(own(raw, "subjectKey"))}.targeting`, composition: own(raw, "composition"), definitions: own(raw, "definitions"), ruleset: own(raw, "ruleset"), character: targetingCharacter, keywords: own(raw, "keywords"), ...(targetingModifiers === undefined ? {} : { targetingModifiers }) }); if (!targeting.ok) return targeting as ProwessOutcome<never>;
  const response = orchestrateRulesEvaluation({ evaluationKey: `effect.${plan.value.subject.subjectKey}.${plan.value.subject.componentKey}`, contexts: { ruleset: own(raw, "ruleset") }, plan: plan.value.evaluationPlan }); if (!response.success || response.data === null) { const p = new Problems(); p.add(E.INVALID_EFFECT_RULES, ["run"], `M4 could not evaluate Effect plan: ${JSON.stringify(response.errors)}`); return finish(p, () => null as never); }
  return readEffectRun({ plan: plan.value, run: response.data as unknown as EvaluationRun, targeting: targeting.value });
}
