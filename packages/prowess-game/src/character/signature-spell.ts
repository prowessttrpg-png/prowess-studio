import type { JsonObject } from "@prowess/model";
import { createRulesetContext, evaluateFormula, orchestrateRulesEvaluation } from "@prowess/rules";
import { readKeywordCatalog } from "../affinity/definitions.js";
import { findBundleDefinition, type ProwessDefinitionBundle, type ProwessRulesetProvenance } from "../bundle/bundle.js";
import { compileAuthoredAbilityCore, readAbilityDefinitionRun, type AuthoredAbilityResult } from "../ability/compile.js";
import { compileSpellCostCore, readSpellCostRun, type SpellCostResult } from "../ability/spell-cost.js";
import { compileExecutionCore, type ProwessAbilityExecutionPlan } from "../ability/effect-execution.js";
import { readAuthoredAbilityPayload, type SpellDefinitionPayload } from "../definition/authored-ability-payload.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "../definition/envelope.js";
import { clonePlainData, deepFreeze, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import { Problems, checkPlainData, finish, isExactLabel, own, readEnum, readRecord, readSafeInteger, type ProwessOutcome, type ProwessProblem } from "../internal/problems.js";
import type { CharacterMechanicalProfile } from "./advancement.js";

/**
 * Character Signature Spells (PAS-10 M6-WO7) — the ONE adapter from a Character-owned Spell composition to the
 * permanent M5 Spell engine. A Character Spell is NOT Compendium canon: it is never an Entity, an EntityVersion or a
 * Release Definition, and nothing here adds a Definition to the Character's Release bundle (§105). It references only
 * exact Release-pinned components (Targeting, Effects, Traits, Duration, Casting Conditions, Affinity).
 *
 *   Character-owned draft → (closed reader) → the M5 SPELL_DEFINITION payload reader (readAuthoredAbilityPayload)
 *   → compileAuthoredAbilityCore (M5-WO5…WO9: construction, Targeting, Effects, Traits, Duration, Conditions)
 *   → compileSpellCostCore (M5-WO10: base MP, ONE net percentage, ONE rounding, AP) → M4 → readSpellCostRun
 *   → compileExecutionCore (M5-WO12: the Effect Chain plan and its runtime-deferred conflicts) — read only
 *   → the WO13 active-magic policy, read for the Sustain / Mana Lock / Concentration preview (M4 evaluates its Formula)
 *
 * The Spell's name and texts never reach M5 (a fixed inert label stands in), so they can never create mechanics (§23).
 * Nothing is persisted, rolled, spent or applied (§47, §100). Every number is M4's.
 */

export const SIGNATURE_SPELL_SCHEMA_VERSION = 1 as const;
export const SPELL_AUTHORITIES = deepFreeze(["ARCANE_AUTHORITY", "AFFINITY_AUTHORITY"] as const);
export type SpellAuthority = (typeof SPELL_AUTHORITIES)[number];
/** Presentation states (§74) — NOT M5 result vocabulary. */
export const SIGNATURE_SPELL_STATES = deepFreeze(["INCOMPLETE", "INVALID", "VALID", "VALID_WITH_RUNTIME_DEFERRED"] as const);
export type SignatureSpellState = (typeof SIGNATURE_SPELL_STATES)[number];
/** The builder steps a missing / failing selection links to (§21, §124). */
export const SIGNATURE_SPELL_STEPS = deepFreeze(["CONCEPT", "AUTHORITY", "TARGETING", "EFFECTS", "EFFECT_CHAIN", "TRAITS", "DURATION", "CASTING_CONDITIONS", "REVIEW"] as const);
export type SignatureSpellStep = (typeof SIGNATURE_SPELL_STEPS)[number];
export const SIGNATURE_SPELL_ERROR_CODES = deepFreeze({
  INVALID_DRAFT: "SIGNATURE_SPELL.INVALID_DRAFT",
  INCOMPLETE: "SIGNATURE_SPELL.INCOMPLETE",
  INVALID_CONTEXT: "SIGNATURE_SPELL.INVALID_CONTEXT",
});
const E = SIGNATURE_SPELL_ERROR_CODES.INVALID_DRAFT;

/** Player prose (§22) — inert text, stored separately from every mechanical selection. */
export interface SignatureSpellConcept {
  readonly name: string;
  readonly description: string;
  readonly visualDescription: string;
  readonly notes: string;
  /** Narrative tags only (§86): never mechanical Keywords. */
  readonly narrativeTags: readonly string[];
}
export interface SignatureSpellUse {
  readonly definition: ProwessDefinitionRef;
  readonly parameters: JsonObject;
}
export interface SignatureSpellOrderedUse extends SignatureSpellUse {
  readonly componentKey: string;
  readonly order: number;
}
export interface SignatureSpellTraitUse extends SignatureSpellOrderedUse {
  readonly appliesTo: { readonly scope: string; readonly componentKey: string | null };
}
/** The Character-owned, persisted SELECTIONS (§77). No cost, capacity, range or other derived value is ever part of it (§78). */
export interface SignatureSpellDraft {
  readonly schemaVersion: typeof SIGNATURE_SPELL_SCHEMA_VERSION;
  readonly concept: SignatureSpellConcept;
  readonly authority: SpellAuthority | null;
  readonly affinity: ProwessDefinitionRef | null;
  readonly targeting: SignatureSpellUse | null;
  readonly effects: readonly SignatureSpellOrderedUse[];
  /** The exact M5-WO12 chain contract ({ failurePolicy, nodes }) or null for the ruled default (§43). */
  readonly effectChain: JsonObject | null;
  readonly traits: readonly SignatureSpellTraitUse[];
  readonly duration: SignatureSpellUse | null;
  readonly castingConditions: readonly SignatureSpellOrderedUse[];
  /** The explicit Effect-slot → Trait exchange (§41, §130); never inferred. */
  readonly constructionOptions: { readonly effectSlotsTradedForTraits: number };
  /** Requests for the unresolved additional Affinity Trait capacity (M5-SC-042) — always refused by M5 (§52). */
  readonly additionalAffinityTraits: readonly string[];
}

const DRAFT_FIELDS = ["schemaVersion", "concept", "authority", "affinity", "targeting", "effects", "effectChain", "traits", "duration", "castingConditions", "constructionOptions", "additionalAffinityTraits"];
const CONCEPT_FIELDS = ["name", "description", "visualDescription", "notes", "narrativeTags"];
const TEXT_LIMIT = 4000;
const NAME_LIMIT = 120;
const RESERVED_KEYS = ["targeting", "duration", "affinity"];

export function emptySignatureSpellDraft(name: string): SignatureSpellDraft {
  return deepFreeze({ schemaVersion: SIGNATURE_SPELL_SCHEMA_VERSION, concept: { name, description: "", visualDescription: "", notes: "", narrativeTags: [] }, authority: null, affinity: null, targeting: null, effects: [], effectChain: null, traits: [], duration: null, castingConditions: [], constructionOptions: { effectSlotsTradedForTraits: 0 }, additionalAffinityTraits: [] });
}

function readText(v: unknown, at: readonly PathSegment[], p: Problems, limit: number): string {
  if (typeof v !== "string" || [...v].length > limit) {
    p.add(E, at, `inert text of at most ${String(limit)} characters`);
    return "";
  }
  return v;
}
function readParameters(v: unknown, at: readonly PathSegment[], p: Problems): JsonObject {
  if (!isPlainObject(v)) {
    p.add(E, at, "parameters is an object of the component's declared parameters");
    return {};
  }
  const out: Record<string, number | string | boolean> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!isExactLabel(k) || !(typeof x === "string" || typeof x === "boolean" || (typeof x === "number" && Number.isSafeInteger(x)))) p.add(E, [...at, k], "a declared parameter value is an exact integer, token or flag — never executable data");
    else out[k] = x;
  }
  return out;
}
function readUse(v: unknown, at: readonly PathSegment[], p: Problems): SignatureSpellUse | null {
  const r = readRecord(v, at, p, E, ["definition", "parameters"], ["definition", "parameters"]);
  if (!r) return null;
  const definition = readDefinitionRef(own(r, "definition"), [...at, "definition"], p, E);
  const parameters = readParameters(own(r, "parameters"), [...at, "parameters"], p);
  return definition ? { definition, parameters } : null;
}
function readOrdered(v: unknown, at: readonly PathSegment[], p: Problems, trait: boolean): SignatureSpellOrderedUse[] {
  if (!Array.isArray(v)) {
    p.add(E, at, "an ordered list of exact component uses");
    return [];
  }
  const fields = trait ? ["componentKey", "definition", "order", "parameters", "appliesTo"] : ["componentKey", "definition", "order", "parameters"];
  const out: SignatureSpellOrderedUse[] = [];
  v.forEach((raw, i) => {
    const a = [...at, i];
    const r = readRecord(raw, a, p, E, fields, fields);
    if (!r) return;
    const componentKey = own(r, "componentKey");
    if (!isExactLabel(componentKey) || RESERVED_KEYS.includes(componentKey)) p.add(E, [...a, "componentKey"], "an exact, non-reserved component key");
    const order = readSafeInteger(own(r, "order"), [...a, "order"], p, E, "order");
    const use = readUse({ definition: own(r, "definition"), parameters: own(r, "parameters") }, a, p);
    let appliesTo: SignatureSpellTraitUse["appliesTo"] | null = null;
    if (trait) {
      const t = readRecord(own(r, "appliesTo"), [...a, "appliesTo"], p, E, ["scope", "componentKey"], ["scope", "componentKey"]);
      const scope = t ? own(t, "scope") : null;
      const target = t ? own(t, "componentKey") : null;
      if (typeof scope !== "string" || !(target === null || isExactLabel(target))) p.add(E, [...a, "appliesTo"], "a Trait names its scope and, unless ability-wide, its exact target component");
      else appliesTo = { scope, componentKey: target };
    }
    if (use && isExactLabel(componentKey) && order !== null) out.push(trait && appliesTo ? ({ componentKey, order, ...use, appliesTo } as SignatureSpellTraitUse) : { componentKey, order, ...use });
  });
  return out;
}

/**
 * Reads untrusted persisted / submitted draft data strictly (§118): closed fields, a schema version, exact refs,
 * declared-parameter values only, inert prose. A draft may be INCOMPLETE or mechanically invalid — those are M5's
 * findings, not structural errors (§12) — but it is never arbitrary executable JSON.
 */
export function readSignatureSpellDraft(value: unknown): ProwessOutcome<SignatureSpellDraft> {
  const p = new Problems();
  if (!checkPlainData(value, [], p, E)) return finish(p, () => null as never);
  const r = readRecord(value, [], p, E, DRAFT_FIELDS, DRAFT_FIELDS);
  if (!r) return finish(p, () => null as never);
  if (own(r, "schemaVersion") !== SIGNATURE_SPELL_SCHEMA_VERSION) p.add(E, ["schemaVersion"], `the supported Character Spell schema version is ${String(SIGNATURE_SPELL_SCHEMA_VERSION)}`);
  const c = readRecord(own(r, "concept"), ["concept"], p, E, CONCEPT_FIELDS, CONCEPT_FIELDS);
  const name = c ? readText(own(c, "name"), ["concept", "name"], p, NAME_LIMIT) : "";
  if (c && name.trim() === "") p.add(E, ["concept", "name"], "a Spell needs a name (display text only)");
  const tags = c ? own(c, "narrativeTags") : [];
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string" && isExactLabel(t)) || new Set(tags).size !== tags.length) p.add(E, ["concept", "narrativeTags"], "narrative tags are unique short labels");
  const concept: SignatureSpellConcept = {
    name,
    description: c ? readText(own(c, "description"), ["concept", "description"], p, TEXT_LIMIT) : "",
    visualDescription: c ? readText(own(c, "visualDescription"), ["concept", "visualDescription"], p, TEXT_LIMIT) : "",
    notes: c ? readText(own(c, "notes"), ["concept", "notes"], p, TEXT_LIMIT) : "",
    narrativeTags: Array.isArray(tags) ? (tags as string[]) : [],
  };
  const rawAuthority = own(r, "authority");
  const authority = rawAuthority === null ? null : readEnum(rawAuthority, SPELL_AUTHORITIES, ["authority"], p, E, "Spell authority");
  const rawAffinity = own(r, "affinity");
  const affinity = rawAffinity === null ? null : readDefinitionRef(rawAffinity, ["affinity"], p, E);
  const targeting = own(r, "targeting") === null ? null : readUse(own(r, "targeting"), ["targeting"], p);
  const duration = own(r, "duration") === null ? null : readUse(own(r, "duration"), ["duration"], p);
  const effects = readOrdered(own(r, "effects"), ["effects"], p, false);
  const traits = readOrdered(own(r, "traits"), ["traits"], p, true) as SignatureSpellTraitUse[];
  const castingConditions = readOrdered(own(r, "castingConditions"), ["castingConditions"], p, false);
  const keys = [...effects, ...traits, ...castingConditions].map((u) => u.componentKey);
  if (new Set(keys).size !== keys.length) p.add(E, [], "every component key is unique within the Spell");
  const chain = own(r, "effectChain");
  if (chain !== null && !isPlainObject(chain)) p.add(E, ["effectChain"], "the Effect Chain is the M5 chain object or null");
  const options = readRecord(own(r, "constructionOptions"), ["constructionOptions"], p, E, ["effectSlotsTradedForTraits"], ["effectSlotsTradedForTraits"]);
  const trades = options ? readSafeInteger(own(options, "effectSlotsTradedForTraits"), ["constructionOptions", "effectSlotsTradedForTraits"], p, E, "Effect slots traded") : null;
  const extra = own(r, "additionalAffinityTraits");
  if (!Array.isArray(extra) || !extra.every(isExactLabel)) p.add(E, ["additionalAffinityTraits"], "component keys of Traits requested in the additional Affinity capacity");
  return finish(p, () =>
    deepFreeze(clonePlainData({ schemaVersion: SIGNATURE_SPELL_SCHEMA_VERSION, concept, authority, affinity, targeting, effects, effectChain: chain as JsonObject | null, traits, duration, castingConditions, constructionOptions: { effectSlotsTradedForTraits: trades ?? 0 }, additionalAffinityTraits: extra as string[] })),
  );
}

/** Every exact canonical component the draft names (§9, §79). */
export function signatureSpellComponentRefs(draft: SignatureSpellDraft): readonly ProwessDefinitionRef[] {
  return [...(draft.affinity ? [draft.affinity] : []), ...(draft.targeting ? [draft.targeting.definition] : []), ...draft.effects.map((e) => e.definition), ...draft.traits.map((t) => t.definition), ...(draft.duration ? [draft.duration.definition] : []), ...draft.castingConditions.map((c) => c.definition)];
}

/** The Character-owned subject an evaluation is FOR (§106). Never a Definition ref. */
export interface CharacterSpellSubject {
  readonly kind: "CHARACTER_SIGNATURE_SPELL";
  readonly characterId: string;
  readonly signatureAbilityId: string | null;
  readonly revisionNumber: number | null;
}

export interface SignatureSpellIssue {
  readonly code: string;
  readonly path: string;
  readonly step: SignatureSpellStep;
  readonly componentKey: string | null;
  readonly message: string;
}
export interface RuntimeDeferral {
  /** The exact unresolved M5 conflict key (M5-SC-0xx), never a guessed behaviour (§97). */
  readonly conflictKey: string;
  readonly message: string;
}
export interface SignatureSpellEvaluation {
  readonly state: SignatureSpellState;
  readonly subject: CharacterSpellSubject;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly components: readonly ProwessDefinitionRef[];
  /** What a draft still lacks before M5 can evaluate it (§12). */
  readonly missing: readonly SignatureSpellStep[];
  readonly issues: readonly SignatureSpellIssue[];
  /** Mechanical Keywords exactly as the selected components author them (§86). */
  readonly keywords: readonly string[];
  /** The M5-WO10 result, or null when the Spell cannot be priced (§128: never zero). */
  readonly cost: SpellCostResult<CharacterSpellSubject> | null;
  readonly costUnresolved: readonly { readonly path: string; readonly message: string }[];
  /** The M5 authored-Ability result (construction, capacity, Signature projection, Targeting, Effects, Traits). */
  readonly authored: AuthoredAbilityResult<CharacterSpellSubject> | null;
  /** The M5-WO12 chain plan (presentation over the existing contract; nothing executes). */
  readonly chain: ProwessAbilityExecutionPlan<CharacterSpellSubject>["chain"];
  readonly runtime: {
    readonly sustain: { readonly mpPerRound: number | null; readonly apPerRound: number; readonly meEligible: boolean } | null;
    readonly manaLock: { readonly reservedMp: null; readonly conflictKey: string } | null;
    readonly concentration: string | null;
    readonly deferred: readonly RuntimeDeferral[];
  };
}

const CONFLICT = /M5-SC-0\d\d/;
/** The pinned WO13 policy fields the preview reads (the construction rule's `activeMagicPolicy`). */
interface ActiveMagicPolicyView {
  readonly formulas: { readonly sustainMp: { readonly expression: string } };
  readonly sustainApPerRound: number;
  readonly sustainMeEligible: boolean;
  readonly manaLock: { readonly amount: unknown; readonly conflictKey: string };
}
/** Reads a nested authored value (data access only). */
function dig(value: unknown, path: readonly string[]): unknown {
  let at: unknown = value;
  for (const k of path) at = isPlainObject(at) ? own(at, k) : undefined;
  return at;
}
const stepOf = (path: string): SignatureSpellStep => {
  const q = path.toLowerCase();
  if (q.includes("authority") || q.includes("affinity")) return "AUTHORITY";
  if (q.includes("targeting")) return "TARGETING";
  if (q.includes("effectchain") || q.includes("chain")) return "EFFECT_CHAIN";
  if (q.includes("trait")) return "TRAITS";
  if (q.includes("duration")) return "DURATION";
  if (q.includes("condition")) return "CASTING_CONDITIONS";
  if (q.includes("effect")) return "EFFECTS";
  return "REVIEW";
};

/**
 * The M5 construction character context from the ONE profile (M6-WO4): its Stats and exact Skill ranks, and the
 * Character's owned Affinities in the CharacterAffinityProfile INPUT form M5 reads ({ affinities: [{ affinity, rank,
 * role, acquisition }] }) — the validated profile's derived fields (identity, primary) are re-derived by M5 itself.
 */
function constructionCharacterOf(profile: CharacterMechanicalProfile): Record<string, unknown> {
  const owned = profile.constructionContext.affinityProfile as { readonly affinities?: readonly { readonly affinity: ProwessDefinitionRef; readonly rank: string; readonly role: string; readonly acquisition: unknown }[] } | null;
  return clonePlainData({
    stats: profile.constructionContext.stats,
    skillRanks: profile.constructionContext.skillRanks,
    affinityProfile: owned === null || owned.affinities === undefined ? null : { affinities: owned.affinities.map((a) => ({ affinity: a.affinity, rank: a.rank, role: a.role, acquisition: a.acquisition ?? null })) },
  });
}

/** The M5 SPELL_DEFINITION payload the Character composition corresponds to — mechanics only, never the prose. */
function spellPayloadOf(draft: SignatureSpellDraft): Record<string, unknown> {
  const ordered = (u: SignatureSpellOrderedUse) => ({ componentKey: u.componentKey, definition: u.definition, order: u.order, parameters: u.parameters });
  return clonePlainData({
    // A fixed inert label: player prose never reaches the engine (§23, M6-I079).
    name: "Character Signature Spell",
    description: "",
    composition: {
      compositionKey: "character.signature_spell",
      abilityKind: "SPELL",
      affinity: draft.affinity ? { componentKey: "affinity", definition: draft.affinity, parameters: {} } : null,
      authority: { authority: draft.authority },
      keywords: [],
      targeting: { componentKey: "targeting", definition: draft.targeting!.definition, parameters: draft.targeting!.parameters },
      effects: draft.effects.map(ordered),
      traits: draft.traits.map((t) => ({ ...ordered(t), appliesTo: t.appliesTo })),
      duration: { componentKey: "duration", definition: draft.duration!.definition, parameters: draft.duration!.parameters },
      conditions: draft.castingConditions.map(ordered),
      branch: { kind: "SPELL", effectChain: draft.effectChain, sustain: null, concentration: null, data: {} },
    },
    additionalAffinityTraits: draft.additionalAffinityTraits,
    constructionOptions: draft.constructionOptions,
  });
}

function missingSteps(draft: SignatureSpellDraft): SignatureSpellStep[] {
  const out: SignatureSpellStep[] = [];
  if (draft.authority === null || (draft.authority === "AFFINITY_AUTHORITY" && draft.affinity === null)) out.push("AUTHORITY");
  if (draft.targeting === null) out.push("TARGETING");
  if (draft.effects.length === 0) out.push("EFFECTS");
  if (draft.duration === null) out.push("DURATION");
  return out;
}

const issueOf = (q: ProwessProblem | { readonly code: string; readonly path: string; readonly message: string }, componentKeys: readonly string[]): SignatureSpellIssue => {
  const componentKey = componentKeys.find((k) => q.path.split(/[/.]/).includes(k)) ?? null;
  return { code: q.code, path: q.path, step: stepOf(`${q.path} ${q.code}`), componentKey, message: q.message };
};

/**
 * Evaluates one Character-owned Spell composition against the Character's exact Release and mechanical profile.
 * `usedSlots` is the Signature capacity already used by the Character's OTHER finalized Signature Abilities.
 */
export function evaluateCharacterSignatureSpell(request: {
  readonly bundle: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  readonly profile: CharacterMechanicalProfile;
  readonly keywords: unknown;
  readonly draft: SignatureSpellDraft;
  readonly usedSlots: number;
  readonly subject: CharacterSpellSubject;
}): SignatureSpellEvaluation {
  const { bundle, draft, profile, subject } = request;
  const componentKeys = [...draft.effects, ...draft.traits, ...draft.castingConditions].map((u) => u.componentKey);
  const keywords = [...new Set(signatureSpellComponentRefs(draft).flatMap((ref) => {
    const d = findBundleDefinition(bundle, ref);
    const k = d === null ? [] : own(d.payload as Record<string, unknown>, "keywords");
    return Array.isArray(k) ? (k as string[]) : [];
  }))].sort();
  const base = { subject, rulesetProvenance: bundle.rulesetProvenance, components: signatureSpellComponentRefs(draft), keywords, chain: null, runtime: { sustain: null, manaLock: null, concentration: null, deferred: [] } };
  const missing = missingSteps(draft);
  if (missing.length > 0) {
    return deepFreeze(clonePlainData({ ...base, state: "INCOMPLETE" as const, missing, issues: missing.map((step) => ({ code: SIGNATURE_SPELL_ERROR_CODES.INCOMPLETE, path: step.toLowerCase(), step, componentKey: null, message: `${step.toLowerCase().replaceAll("_", " ")} is not chosen yet` })), cost: null, costUnresolved: [], authored: null }));
  }
  const fail = (issues: readonly SignatureSpellIssue[], extra: Partial<SignatureSpellEvaluation> = {}): SignatureSpellEvaluation =>
    deepFreeze(clonePlainData({ ...base, state: "INVALID" as const, missing: [], issues, cost: null, costUnresolved: [], authored: null, ...extra }));

  // 1. The M5 SPELL_DEFINITION payload reader (the exact closed contract, chain reader included).
  const p0 = new Problems();
  const payload = readAuthoredAbilityPayload("SPELL_DEFINITION", spellPayloadOf(draft), [], p0) as SpellDefinitionPayload | null;
  if (payload === null || p0.count > 0) return fail(p0.list.map((q) => issueOf(q, componentKeys)));

  // 2. The authored-Ability compilation (construction legality, Targeting, Effects, Traits, Duration, Conditions).
  const context = createRulesetContext(request.ruleset);
  const p1 = new Problems();
  const catalog = readKeywordCatalog(request.keywords, ["keywords"], p1);
  if (!context.ok || catalog === null) return fail(p1.list.map((q) => issueOf({ ...q, code: SIGNATURE_SPELL_ERROR_CODES.INVALID_CONTEXT }, componentKeys)));
  const subjectKey = "character.signature_spell";
  const r: Record<string, unknown> = {
    contractVersion: 1,
    subjectKey,
    definitions: bundle,
    ruleset: context.value,
    character: constructionCharacterOf(profile),
    keywords: request.keywords,
    // Explicit Signature state; the candidate uses the default slot cost (no exemption is ever self-granted, §15).
    signature: { usedSlots: request.usedSlots, candidate: { slotUse: "DEFAULT" } },
  };
  const ability = compileAuthoredAbilityCore(p1, r, subjectKey, context.value, bundle, catalog, { authored: payload, spell: true, subjectRefs: [], definition: subject });
  if (!ability.ok) return fail(ability.problems.map((q) => issueOf(q, componentKeys)));

  // 3. The M5-WO10 cost plan over the SAME compiled plan; then ONE M4 run.
  const pro = profile.constructionContext.stats.PRO;
  const p2 = new Problems();
  const sourceId = subject.signatureAbilityId ?? `${subject.characterId}:draft`;
  const costPlan = typeof pro === "number" ? compileSpellCostCore(p2, r, ability.value, pro, { subjectRefs: [], sourceKey: "character.signature_spell", sourceId }) : null;
  let cost: SpellCostResult<CharacterSpellSubject> | null = null;
  let authored: AuthoredAbilityResult<CharacterSpellSubject> | null = null;
  const costUnresolved: { path: string; message: string }[] = [];
  if (costPlan !== null && costPlan.ok) {
    const run = orchestrateRulesEvaluation({ evaluationKey: `spell-cost.${subjectKey}`, contexts: { ruleset: context.value }, plan: costPlan.value.evaluationPlan });
    const read = run.success && run.data ? readSpellCostRun(costPlan.value, run.data) : null;
    if (read !== null && read.ok) {
      cost = read.value;
      authored = read.value.authored;
    } else costUnresolved.push({ path: "cost", message: "M4 could not evaluate the Spell cost plan" });
  } else {
    // The Spell cannot be priced (e.g. M5-SC-046): show the exact reason and still report construction (§34, §128).
    for (const q of costPlan === null ? [{ path: "/character/stats/PRO", message: "Spell AP divides final MP by the Character's Prowess Score, which this profile does not state" }] : costPlan.problems) costUnresolved.push({ path: q.path, message: q.message });
    const run = orchestrateRulesEvaluation({ evaluationKey: `authored.${subjectKey}`, contexts: { ruleset: context.value }, plan: ability.value.evaluationPlan });
    const read = run.success && run.data ? readAbilityDefinitionRun(ability.value, run.data) : null;
    if (read !== null && read.ok) authored = read.value;
  }
  const issues: SignatureSpellIssue[] = [...(cost ? cost.problems : authored ? authored.problems : []).map((q) => issueOf(q, componentKeys)), ...costUnresolved.map((q) => issueOf({ code: "PROWESS_SPELL_COST.UNRESOLVED_CONTRIBUTION", ...q }, componentKeys))];
  if (authored !== null && !authored.construction.valid) for (const rule of authored.construction.problems) issues.push(issueOf({ code: "PROWESS_CONSTRUCTION.RULE_FAILED", path: rule, message: `construction rule not satisfied: ${rule}` }, componentKeys));
  const valid = cost !== null && cost.valid && issues.length === 0;

  // 4. Runtime readiness (presentation only): the WO12 chain plan and the WO13 policy, read — never executed.
  const deferred: RuntimeDeferral[] = [];
  let chain: SignatureSpellEvaluation["chain"] = null;
  if (valid && authored !== null) {
    const p3 = new Problems();
    const execution = compileExecutionCore(p3, r, ability.value, authored, sourceId);
    if (execution.ok) chain = execution.value.plan.chain;
    else for (const q of execution.problems) deferred.push({ conflictKey: CONFLICT.exec(q.message)?.[0] ?? q.code, message: q.message });
  }
  const rule = bundle.definitions.find((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  const policy = rule ? (dig(rule.payload, ["activeMagicPolicy"]) as ActiveMagicPolicyView | undefined) : undefined;
  const duration = findBundleDefinition(bundle, draft.duration!.definition);
  const future = duration ? (dig(duration.payload, ["rules", "duration", "futureRuntime"]) as { sustain?: boolean; manaLock?: boolean; concentration?: string } | undefined) : undefined;
  let sustain: SignatureSpellEvaluation["runtime"]["sustain"] = null;
  let manaLock: SignatureSpellEvaluation["runtime"]["manaLock"] = null;
  if (future?.sustain === true && policy) {
    // The pinned WO13 Sustain Formula, evaluated by M4 over the M5 final MP and PRO — never recomputed here (§58).
    const value = cost !== null && typeof pro === "number" ? evaluateFormula({ expression: policy.formulas.sustainMp.expression, rounding: "NONE" }, { final_mp: cost.finalMpCost, pro }) : null;
    sustain = { mpPerRound: value !== null && value.success && value.data !== null ? value.data.finalValue : null, apPerRound: policy.sustainApPerRound, meEligible: policy.sustainMeEligible };
  }
  if (future?.manaLock === true) {
    const conflictKey = policy?.manaLock.conflictKey ?? "M5-SC-052";
    if (!policy || policy.manaLock.amount === null) {
      manaLock = { reservedMp: null, conflictKey };
      deferred.push({ conflictKey, message: "no exact Mana Lock reservation amount is authored; the runtime reservation is deferred" });
    }
  }
  const unique = deferred.filter((d, i) => deferred.findIndex((x) => x.conflictKey === d.conflictKey && x.message === d.message) === i);
  const state: SignatureSpellState = !valid ? "INVALID" : unique.length > 0 ? "VALID_WITH_RUNTIME_DEFERRED" : "VALID";
  return deepFreeze(
    clonePlainData({
      ...base,
      state,
      missing: [],
      issues,
      cost,
      costUnresolved,
      authored,
      chain,
      runtime: { sustain, manaLock, concentration: typeof future?.concentration === "string" ? future.concentration : null, deferred: unique },
    }),
  );
}

/**
 * The client-facing projection of an evaluation (§69–§70, §96): every value is copied from the M5 results — nothing is
 * recomputed, combined or rounded here. `cost` is null whenever M5 could not price the Spell (§128: never zero).
 */
export interface SignatureSpellSummary {
  readonly state: SignatureSpellState;
  readonly missing: readonly SignatureSpellStep[];
  readonly issues: readonly SignatureSpellIssue[];
  readonly keywords: readonly string[];
  readonly components: readonly ProwessDefinitionRef[];
  readonly construction: {
    readonly valid: boolean;
    readonly access: AuthoredAbilityResult["construction"]["access"];
    readonly capacity: AuthoredAbilityResult["construction"]["capacity"];
    readonly usage: AuthoredAbilityResult["construction"]["usage"];
    readonly signature: AuthoredAbilityResult["construction"]["signature"];
    readonly affinityAccess: AuthoredAbilityResult["construction"]["affinityAccess"];
    readonly prerequisites: AuthoredAbilityResult["construction"]["prerequisites"];
    readonly traitCapacity: AuthoredAbilityResult["traitCapacity"];
  } | null;
  readonly targeting: { readonly range: AuthoredAbilityResult["targeting"]["range"]; readonly geometry: AuthoredAbilityResult["targeting"]["geometry"]; readonly targetCount: AuthoredAbilityResult["targeting"]["targetCount"]; readonly compatibility: AuthoredAbilityResult["targeting"]["compatibility"]; readonly deferred: AuthoredAbilityResult["targeting"]["deferred"] } | null;
  readonly effects: readonly { readonly componentKey: string; readonly valid: boolean; readonly family: string; readonly resolution: string | null; readonly targetingStatus: string; readonly parameters: AuthoredAbilityResult["effects"][number]["result"]["parameters"]; readonly problems: readonly string[] }[];
  readonly cost: {
    readonly contributions: readonly { readonly source: string; readonly componentKey: string; readonly contributionKey: string; readonly operation: string; readonly rule: string; readonly value: number; readonly definition: ProwessDefinitionRef }[];
    readonly baseMp: number;
    readonly percentages: readonly { readonly source: string; readonly operation: string; readonly percent: number; readonly applied: boolean }[];
    readonly castingConditions: SpellCostResult["castingConditions"];
    readonly netPercent: number;
    readonly unroundedMp: number;
    readonly finalMp: number;
    readonly pro: number;
    readonly baseAp: number;
    readonly apModifiers: SpellCostResult["ap"]["modifiers"];
    readonly finalAp: number;
  } | null;
  readonly costUnresolved: readonly { readonly path: string; readonly message: string }[];
  readonly chain: SignatureSpellEvaluation["chain"];
  readonly runtime: SignatureSpellEvaluation["runtime"];
}

export function summarizeSignatureSpell(e: SignatureSpellEvaluation): SignatureSpellSummary {
  const a = e.authored;
  const c = e.cost;
  return deepFreeze(
    clonePlainData({
      state: e.state,
      missing: e.missing,
      issues: e.issues,
      keywords: e.keywords,
      components: e.components,
      construction: a === null ? null : { valid: a.construction.valid, access: a.construction.access, capacity: a.construction.capacity, usage: a.construction.usage, signature: a.construction.signature, affinityAccess: a.construction.affinityAccess, prerequisites: a.construction.prerequisites, traitCapacity: a.traitCapacity },
      targeting: a === null ? null : { range: a.targeting.range, geometry: a.targeting.geometry, targetCount: a.targeting.targetCount, compatibility: a.targeting.compatibility, deferred: a.targeting.deferred },
      effects: a === null ? [] : a.effects.map((x) => ({ componentKey: x.result.componentKey, valid: x.result.valid, family: String(x.result.effect.family), resolution: x.result.resolution, targetingStatus: x.result.targetingStatus, parameters: x.result.parameters, problems: x.result.problems })),
      cost:
        c === null
          ? null
          : {
              contributions: c.mp.contributions.map((q) => ({ source: q.source, componentKey: q.componentKey, contributionKey: q.contributionKey, operation: q.operation, rule: q.rule, value: q.value, definition: q.definition })),
              baseMp: c.mp.baseMpCost,
              percentages: c.percentageContributions.map((q) => ({ source: q.source, operation: q.operation, percent: q.percent, applied: q.applied })),
              castingConditions: c.castingConditions,
              netPercent: c.netCostPercent,
              unroundedMp: c.unroundedFinalMpCost,
              finalMp: c.finalMpCost,
              pro: c.ap.pro,
              baseAp: c.ap.baseApCost,
              apModifiers: c.ap.modifiers,
              finalAp: c.ap.finalApCost,
            },
      costUnresolved: e.costUnresolved,
      chain: e.chain,
      runtime: e.runtime,
    }),
  );
}
