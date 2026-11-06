import type { ProwessCompilationSourceMap } from "../compilation/model.js";
import type { JsonObject } from "@prowess/model";
import { createRulesetContext, orchestrateRulesEvaluation } from "@prowess/rules";
import { readKeywordCatalog } from "../affinity/definitions.js";
import { findBundleDefinition, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import { compileAuthoredAbilityCore, type AuthoredAbilityResult } from "../ability/compile.js";
import { compileManeuverCostCore, readManeuverCostRun, type ManeuverCostResult } from "../ability/maneuver-cost.js";
import { compileExecutionCore, type ExecutionGroup } from "../ability/effect-execution.js";
import { readAuthoredAbilityPayload, readFoundationProfile, isAttackFoundation, type ManeuverDefinitionPayload } from "../definition/authored-ability-payload.js";
import { readDefinitionRef, isSameExactDefinition, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { FoundationDefinitionPayload } from "../definition/payload.js";
import type { AbilityConstructionRulePayload } from "../definition/ability-construction-payload.js";
import type { ManeuverCompilationContext } from "../construction/maneuver-context.js";
import { bindWeaponAttackToManeuver } from "../equipment/bridge.js";
import { indexWeaponLibrary } from "../equipment/catalog.js";
import type { CharacterAttackLibrary } from "../equipment/library.js";
import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, readRecord, isExactLabel, type ProwessProblem, type ProwessOutcome } from "../internal/problems.js";
import type { CharacterMechanicalProfile } from "./advancement.js";
import type { SignatureSpellConcept, SignatureSpellOrderedUse, SignatureSpellTraitUse, SignatureSpellUse, SignatureSpellState } from "./signature-spell.js";

export const SIGNATURE_MANEUVER_STEPS = deepFreeze(["CONCEPT", "ACTION_SELECTION", "ACTION_SEQUENCE", "EFFECTS", "TRAITS", "DURATION", "CONDITIONS", "REVIEW", "FINALIZE"] as const);
export type ManeuverActionSource =
  | { readonly kind: "FOUNDATION"; readonly definition: ProwessDefinitionRef }
  | { readonly kind: "WEAPON_ATTACK"; readonly attackKey: string; readonly weapon: ProwessDefinitionRef; readonly attack: ProwessDefinitionRef; readonly damageProfileKey: string };
export interface ManeuverActionUse { readonly componentKey: string; readonly order: number; readonly source: ManeuverActionSource; }
/** Persisted choices only. Costs, targeting profiles and derived capacity never belong in a draft. */
export interface SignatureManeuverDraft {
  readonly schemaVersion: 1;
  readonly concept: SignatureSpellConcept;
  readonly actions: readonly ManeuverActionUse[];
  readonly affinity: ProwessDefinitionRef | null;
  readonly effects: readonly SignatureSpellOrderedUse[];
  readonly effectAttachments: ManeuverDefinitionPayload["effectAttachments"];
  readonly traits: readonly SignatureSpellTraitUse[];
  readonly duration: SignatureSpellUse | null;
  readonly conditions: readonly SignatureSpellOrderedUse[];
  readonly powerfulBlow: ManeuverDefinitionPayload["powerfulBlow"];
}
export interface CharacterManeuverSubject { readonly kind: "CHARACTER_SIGNATURE_MANEUVER"; readonly characterId: string; readonly signatureAbilityId: string | null; readonly revisionNumber: number | null; }
export interface SignatureManeuverEvaluation {
  readonly state: SignatureSpellState;
  readonly subject: CharacterManeuverSubject;
  readonly rulesetProvenance: ProwessDefinitionBundle["rulesetProvenance"];
  readonly missing: readonly string[];
  readonly issues: readonly ProwessProblem[];
  readonly components: readonly ProwessDefinitionRef[];
  readonly cost: ManeuverCostResult<CharacterManeuverSubject> | null;
  readonly authored: AuthoredAbilityResult<CharacterManeuverSubject> | null;
  readonly inspector: { readonly sourceMap: ProwessCompilationSourceMap } | null;
  readonly runtimeDeferred: readonly { readonly code: string; readonly message: string }[];
  /** PAS-10 M6-WO9 (additive): the M5-WO12 execution plan's independent resolution groups, retained for presentation (Ability Cards) — never executed here. */
  readonly execution: { readonly groups: readonly ExecutionGroup[]; readonly targetLimit: { readonly kind: string; readonly maximum: number | null }; readonly martialRank: string | null } | null;
}
const E = "SIGNATURE_MANEUVER.INVALID_DRAFT";
export function emptySignatureManeuverDraft(name: string): SignatureManeuverDraft {
  return deepFreeze({ schemaVersion: 1, concept: { name, description: "", visualDescription: "", notes: "", narrativeTags: [] }, actions: [], affinity: null, effects: [], effectAttachments: [], traits: [], duration: null, conditions: [], powerfulBlow: null });
}
export function readSignatureManeuverDraft(input: unknown): ProwessOutcome<SignatureManeuverDraft> {
  const p = new Problems(); if (!checkPlainData(input, [], p, E)) return finish(p, () => null as never);
  const fields = ["schemaVersion", "concept", "actions", "affinity", "effects", "effectAttachments", "traits", "duration", "conditions", "powerfulBlow"];
  const r = readRecord(input, [], p, E, fields, fields); if (!r) return finish(p, () => null as never);
  if (r.schemaVersion !== 1) p.add(E, ["schemaVersion"], "supported draft schema required");
  const cf = ["name", "description", "visualDescription", "notes", "narrativeTags"], c = readRecord(r.concept, ["concept"], p, E, cf, cf);
  if (c) {
    for (const k of cf.filter(k => k !== "narrativeTags")) if (typeof c[k] !== "string" || [...c[k] as string].length > (k === "name" ? 120 : 4000)) p.add(E, ["concept", k], "bounded inert text required");
    if (!Array.isArray(c.narrativeTags) || c.narrativeTags.length > 20 || !c.narrativeTags.every(x => typeof x === "string" && x.length <= 120)) p.add(E, ["concept", "narrativeTags"], "bounded narrative tags required");
  }
  const ref = (v: unknown, path: (string | number)[]) => readDefinitionRef(v, path, p, E);
  const parameters = (v: unknown, path: (string | number)[]) => { if (!isPlainObject(v) || Object.entries(v).some(([k, x]) => !isExactLabel(k) || !(typeof x === "string" || typeof x === "boolean" || Number.isSafeInteger(x)))) p.add(E, path, "declared scalar parameter selections required"); return v as JsonObject; };
  const list = (v: unknown, path: string, trait = false): SignatureSpellOrderedUse[] => {
    if (!Array.isArray(v)) { p.add(E, [path], "ordered selections required"); return []; }
    return v.flatMap((x, i) => {
      const f = ["componentKey", "order", "definition", "parameters", ...(trait ? ["appliesTo"] : [])], q = readRecord(x, [path, i], p, E, f, f); if (!q) return [];
      const d = ref(q.definition, [path, i, "definition"]), ps = parameters(q.parameters, [path, i, "parameters"]);
      if (!isExactLabel(q.componentKey) || !Number.isSafeInteger(q.order) || (q.order as number) < 0) p.add(E, [path, i], "stable use key and nonnegative order required");
      let appliesTo: unknown;
      if (trait) { const a = readRecord(q.appliesTo, [path, i, "appliesTo"], p, E, ["scope", "componentKey"], ["scope", "componentKey"]); if (a && (typeof a.scope !== "string" || !(a.componentKey === null || isExactLabel(a.componentKey)))) p.add(E, [path, i], "explicit Trait scope and target required"); appliesTo = a; }
      return d ? [{ componentKey: q.componentKey as string, order: q.order as number, definition: d, parameters: ps, ...(trait ? { appliesTo } : {}) } as SignatureSpellOrderedUse] : [];
    }).sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
  };
  const effects = list(r.effects, "effects"), traits = list(r.traits, "traits", true) as SignatureSpellTraitUse[], conditions = list(r.conditions, "conditions");
  const actions: ManeuverActionUse[] = [];
  if (!Array.isArray(r.actions)) p.add(E, ["actions"], "ordered Action uses required");
  else r.actions.forEach((x, i) => {
    const q = readRecord(x, ["actions", i], p, E, ["componentKey", "order", "source"], ["componentKey", "order", "source"]); if (!q) return;
    if (!isExactLabel(q.componentKey) || !Number.isSafeInteger(q.order) || (q.order as number) < 0) p.add(E, ["actions", i], "stable Action key and order required");
    const raw = isPlainObject(q.source) ? q.source : {}, kind = raw.kind;
    const fs = kind === "FOUNDATION" ? ["kind", "definition"] : ["kind", "attackKey", "weapon", "attack", "damageProfileKey"], s = readRecord(q.source, ["actions", i, "source"], p, E, fs, fs); if (!s) return;
    if (kind === "FOUNDATION") { const d = ref(s.definition, ["actions", i, "source", "definition"]); if (d?.definitionKind !== "MANEUVER_FOUNDATION") p.add(E, ["actions", i], "exact Foundation required"); else actions.push({ componentKey: q.componentKey as string, order: q.order as number, source: { kind, definition: d } }); }
    else if (kind === "WEAPON_ATTACK") {
      const weapon = ref(s.weapon, ["actions", i, "source", "weapon"]), attack = ref(s.attack, ["actions", i, "source", "attack"]);
      if (weapon?.definitionKind !== "WEAPON" || attack?.definitionKind !== "ATTACK" || !isExactLabel(s.attackKey) || !isExactLabel(s.damageProfileKey)) p.add(E, ["actions", i], "exact WO6 Weapon/Attack identity and selected damage profile required");
      else actions.push({ componentKey: q.componentKey as string, order: q.order as number, source: { kind, weapon, attack, attackKey: s.attackKey, damageProfileKey: s.damageProfileKey } });
    } else p.add(E, ["actions", i], "supported structured Action source required");
  });
  const labels = (v: unknown, path: (string | number)[]) => { if (!Array.isArray(v) || !v.length || !v.every(isExactLabel) || new Set(v).size !== v.length) { p.add(E, path, "unique explicit Action keys required"); return []; } return v as string[]; };
  const effectAttachments: { effectKey: string; actionKeys: string[] }[] = [];
  if (!Array.isArray(r.effectAttachments)) p.add(E, ["effectAttachments"], "explicit attachment list required");
  else r.effectAttachments.forEach((x, i) => { const q = readRecord(x, ["effectAttachments", i], p, E, ["effectKey", "actionKeys"], ["effectKey", "actionKeys"]); if (q) { if (!isExactLabel(q.effectKey)) p.add(E, ["effectAttachments", i], "exact Effect key required"); effectAttachments.push({ effectKey: q.effectKey as string, actionKeys: labels(q.actionKeys, ["effectAttachments", i, "actionKeys"]) }); } });
  let powerfulBlow: SignatureManeuverDraft["powerfulBlow"] = null;
  if (r.powerfulBlow !== null) { const q = readRecord(r.powerfulBlow, ["powerfulBlow"], p, E, ["actionKeys"], ["actionKeys"]); if (q) { powerfulBlow = { actionKeys: labels(q.actionKeys, ["powerfulBlow", "actionKeys"]) }; if (powerfulBlow.actionKeys.length < 2) p.add(E, ["powerfulBlow"], "Powerful Blow requires at least two constituent Attacks"); } }
  let duration: SignatureSpellUse | null = null;
  if (r.duration !== null) { const q = readRecord(r.duration, ["duration"], p, E, ["definition", "parameters"], ["definition", "parameters"]); if (q) { const d = ref(q.definition, ["duration", "definition"]); if (d) duration = { definition: d, parameters: parameters(q.parameters, ["duration", "parameters"]) }; } }
  const affinity = r.affinity === null ? null : ref(r.affinity, ["affinity"]);
  for (const [slot, uses, kinds] of [["effects", effects, ["MANEUVER_EFFECT"]], ["traits", traits, ["MANEUVER_TRAIT", "SHARED_TRAIT"]], ["conditions", conditions, ["MANEUVER_CONDITION"]]] as const) for (const use of uses) if (!(kinds as readonly string[]).includes(use.definition.definitionKind)) p.add(E, [slot, use.componentKey], "Only exact Maneuver components of this slot's Definition kind are accepted");
  if (duration && duration.definition.definitionKind !== "MANEUVER_DURATION") p.add(E, ["duration"], "An exact Maneuver Duration is required");
  if (affinity && affinity.definitionKind !== "AFFINITY") p.add(E, ["affinity"], "An exact Affinity is required");
  const all = [...actions, ...effects, ...traits, ...conditions];
  if (actions.some(a => all.some(u => u.componentKey === `${a.componentKey}.targeting`))) p.add(E, ["actions"], "inherited Action targeting keys are reserved and cannot identify another component");
  if (new Set(all.map(x => x.componentKey)).size !== all.length || all.some(x => ["targeting", "duration", "affinity"].includes(x.componentKey))) p.add(E, [], "component keys are globally unique and preserve reserved identities");
  for (const rows of [actions, effects, traits, conditions]) if (new Set(rows.map(x => x.order)).size !== rows.length) p.add(E, [], "orders must be unambiguous within each slot");
  return finish(p, () => deepFreeze(clonePlainData({ schemaVersion: 1, concept: c as unknown as SignatureSpellConcept, actions: actions.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0), affinity, effects, effectAttachments, traits, duration, conditions, powerfulBlow })));
}
export function signatureManeuverComponentRefs(draft: SignatureManeuverDraft): readonly ProwessDefinitionRef[] {
  return [...draft.actions.flatMap(a => a.source.kind === "FOUNDATION" ? [a.source.definition] : [a.source.weapon, a.source.attack]), ...(draft.affinity ? [draft.affinity] : []), ...draft.effects.map(x => x.definition), ...draft.traits.map(x => x.definition), ...draft.conditions.map(x => x.definition), ...(draft.duration ? [draft.duration.definition] : [])];
}
/** The exact adapter to M5/M4. No Release Definition is created or inserted into the bundle. */
export function evaluateCharacterSignatureManeuver(request: { readonly bundle: ProwessDefinitionBundle; readonly ruleset: unknown; readonly profile: CharacterMechanicalProfile; readonly attackLibrary: CharacterAttackLibrary; readonly keywords: unknown; readonly draft: SignatureManeuverDraft; readonly usedSlots: number; readonly subject: CharacterManeuverSubject }): SignatureManeuverEvaluation {
  const { bundle, profile, draft, subject } = request;
  const base = { subject, rulesetProvenance: bundle.rulesetProvenance, components: signatureManeuverComponentRefs(draft), inspector: null, runtimeDeferred: [], execution: null };
  const fail = (issues: readonly ProwessProblem[], state: SignatureSpellState = "INVALID", missing: readonly string[] = []): SignatureManeuverEvaluation => deepFreeze({ ...base, state, missing, issues, cost: null, authored: null });
  const missing = [...(!draft.actions.length ? ["ACTION_SELECTION"] : []), ...(!draft.effects.length ? ["EFFECTS"] : []), ...(!draft.duration ? ["DURATION"] : [])];
  if (missing.length) return fail(missing.map(step => ({ code: "SIGNATURE_MANEUVER.INCOMPLETE", path: step, message: `${step} is not selected` })), "INCOMPLETE", missing);
  const p = new Problems(), context = createRulesetContext(request.ruleset), catalog = readKeywordCatalog(request.keywords, ["keywords"], p);
  const policy = bundle.definitions.find(d => d.definitionKind === "ABILITY_CONSTRUCTION_RULE")?.payload as unknown as AbilityConstructionRulePayload | undefined;
  if (policy?.maneuverCostPolicy?.extension?.version !== "M6-WO8-A") p.add("SIGNATURE_MANEUVER.MISSING_APPROVED_POLICY", ["release"], "This exact Release lacks the M6-WO8 Amendment A cost policy. A governed content update must be published separately.");
  const index = indexWeaponLibrary(bundle), library = request.attackLibrary;
  const attacks = [...(library.unarmed?.attacks ?? []), ...(library.mainHand?.attacks ?? []), ...(library.offHand?.attacks ?? [])];
  const projections: ManeuverCompilationContext["foundations"][number][] = [];
  const single = bundle.definitions.filter(d => d.definitionKind === "MANEUVER_TARGETING" && (d.payload as { semanticShape?: string }).semanticShape === "SINGLE_TARGET");
  const actions = draft.actions.flatMap(a => {
    if (a.source.kind === "FOUNDATION") {
      const d = findBundleDefinition(bundle, a.source.definition);
      const profile = d ? readFoundationProfile((d.payload as unknown as FoundationDefinitionPayload).rules, ["actions", a.componentKey], p) : null;
      if (!profile || isAttackFoundation(profile)) { p.add("SIGNATURE_MANEUVER.ATTACK_IDENTITY", ["actions", a.componentKey], "A Character Weapon Attack must bind the exact current WO6 Weapon, Attack and damage profile; legacy Attack Foundations cannot bypass the loadout."); return []; }
      return [{ componentKey: a.componentKey, order: a.order, definition: a.source.definition, parameters: {} }];
    }
    const source = a.source;
    const matches = attacks.filter(x => x.attackKey === source.attackKey && isSameExactDefinition(x.weapon, source.weapon) && isSameExactDefinition(x.attack, source.attack));
    if (matches.length > 1) { p.add("SIGNATURE_MANEUVER.AMBIGUOUS_ATTACK_CONTEXT", ["actions", a.componentKey], "This exact WO6 Attack key identifies multiple equipped hand profiles. The current binding contract cannot select one unambiguously."); return []; }
    const attack = matches[0];
    if (!attack || attack.eligibility !== "ELIGIBLE") { p.add("SIGNATURE_MANEUVER.ATTACK_UNAVAILABLE", ["actions", a.componentKey], "The exact authored Weapon Attack is unavailable in the current loadout; it has not been substituted."); return []; }
    if (single.length !== 1) { p.add("SIGNATURE_MANEUVER.TARGETING_CONTENT", ["actions", a.componentKey], "An unambiguous exact single-target Maneuver targeting Definition is required by the WO6 bridge."); return []; }
    const t = single[0]!, targeting = { componentKey: "targeting", definition: { entityId: t.entityId, entityVersionId: t.entityVersionId, canonicalKey: t.canonicalKey, definitionKind: t.definitionKind, systemFamily: t.systemFamily }, parameters: {} };
    const bound = bindWeaponAttackToManeuver({ index, attack, damageProfileKey: source.damageProfileKey, targeting });
    if (!bound.ok) { p.list.push(...bound.problems.map(q => ({ ...q, path: `/actions/${a.componentKey}${q.path}` }))); return []; }
    projections.push({ actionKey: a.componentKey, reference: source.attack, payload: bound.value.foundationPayload as unknown as FoundationDefinitionPayload, provenance: [source.weapon, source.attack] });
    return [{ componentKey: a.componentKey, order: a.order, definition: source.attack, parameters: {} }];
  });
  if (!context.ok) p.add("SIGNATURE_MANEUVER.INVALID_CONTEXT", ["ruleset"], "An exact valid Ruleset context is required");
  if (p.count || !context.ok || !catalog) return fail(p.list);
  const scoped: ManeuverCompilationContext = { foundations: projections, actionKeys: draft.actions.map(a => a.componentKey), enforceActionBlockCapacity: true };
  const payload = readAuthoredAbilityPayload("MANEUVER_DEFINITION", { name: "Character Signature Maneuver", description: "", actions, effectAttachments: draft.effectAttachments, powerfulBlow: draft.powerfulBlow, composition: { compositionKey: "character.signature_maneuver", abilityKind: "MANEUVER", authority: null, affinity: draft.affinity ? { componentKey: "affinity", definition: draft.affinity, parameters: {} } : null, keywords: [], effects: draft.effects, traits: draft.traits, duration: { componentKey: "duration", ...draft.duration! }, conditions: draft.conditions } }, [], p, projections.map(x => x.reference)) as ManeuverDefinitionPayload | null;
  if (!payload || p.count) return fail(p.list);
  const owned = profile.constructionContext.affinityProfile as { affinities?: readonly { affinity: ProwessDefinitionRef; rank: string; role: string; acquisition?: unknown }[] } | null;
  const character = { stats: profile.constructionContext.stats, skillRanks: profile.constructionContext.skillRanks, affinityProfile: owned?.affinities ? { affinities: owned.affinities.map(a => ({ affinity: a.affinity, rank: a.rank, role: a.role, acquisition: a.acquisition ?? null })) } : null };
  const r = { contractVersion: 1, subjectKey: "character.signature_maneuver", definitions: bundle, ruleset: context.value, character, keywords: request.keywords, signature: { usedSlots: request.usedSlots, candidate: { slotUse: "DEFAULT" } }, signatureManeuver: true };
  const ability = compileAuthoredAbilityCore(p, r, r.subjectKey, context.value, bundle, catalog, { authored: payload, spell: false, subjectRefs: [], definition: subject }, scoped);
  if (!ability.ok) return fail(ability.problems);
  const costPlan = compileManeuverCostCore(r, ability.value, [], scoped); if (!costPlan.ok) return fail(costPlan.problems);
  const run = orchestrateRulesEvaluation({ evaluationKey: "character.signature_maneuver", contexts: { ruleset: context.value }, plan: costPlan.value.evaluationPlan });
  const cost = run.success && run.data ? readManeuverCostRun(costPlan.value, run.data) : null;
  if (!cost?.ok) return fail(cost && !cost.ok ? cost.problems : [{ code: "SIGNATURE_MANEUVER.EVALUATION", path: "review", message: "M4 could not complete the exact Maneuver plan" }]);
  const execution = compileExecutionCore(new Problems(), r, ability.value, cost.value.authored, subject.signatureAbilityId ?? `${subject.characterId}:draft`);
  const deferred = execution.ok ? [] : execution.problems.map(q => ({ code: q.code, message: q.message }));
  if (ability.value.traits.some(t => t.scope.scope === "ACTION_SPECIFIC" && t.modifications.some(m => m.modification.kind === "TRIGGER"))) deferred.push({ code: "M5-SC-049", message: "Action-scoped Trait triggers have no authorized runtime routing; their exact selection and cost remain visible." });
  return deepFreeze({ ...base, state: !cost.value.valid ? "INVALID" : deferred.length ? "VALID_WITH_RUNTIME_DEFERRED" : "VALID", missing: [], issues: cost.value.problems, inspector: { sourceMap: costPlan.value.sourceMap }, cost: cost.value, authored: cost.value.authored, runtimeDeferred: deferred, execution: execution.ok ? { groups: execution.value.plan.groups ?? [], targetLimit: execution.value.plan.targetLimit, martialRank: execution.value.plan.martialRank } : null });
}
