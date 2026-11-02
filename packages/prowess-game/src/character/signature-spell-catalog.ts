import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import { clonePlainData, deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { own } from "../internal/problems.js";
import type { CharacterMechanicalProfile } from "./advancement.js";
import { componentEligibilityMap, type ComponentEligibility } from "./eligibility.js";

/**
 * The Signature Spell Builder catalog (PAS-10 M6-WO7 §29–§38, §48–§61, §82–§85): every Spell component the Character's
 * EXACT Release pins, projected for presentation. Read-only DATA projection — the authored parameters, listed
 * contributions, compatibility and Keywords exactly as each Definition authors them, the WO4 eligibility of each
 * component for this Character, and an Affinity ALIGNMENT HINT (which owned Affinity's Strength / Weakness Keyword lists
 * a component's own Keywords appear in, or its explicit component access). Nothing here decides legality, capacity or
 * cost: the M5 compilers do, on the actual Spell (signature-spell.ts). No component is ever hidden for being locked
 * (§32): it carries its eligibility reasons instead.
 */
export const SPELL_COMPONENT_KINDS = deepFreeze(["SPELL_TARGETING", "SPELL_EFFECT", "SPELL_TRAIT", "SHARED_TRAIT", "SPELL_DURATION", "SPELL_CASTING_CONDITION"] as const);
export type SpellComponentKind = (typeof SPELL_COMPONENT_KINDS)[number];

export interface DeclaredParameter {
  readonly parameter: string;
  readonly kind: string;
  readonly minimum: number | null;
  /** FIXED value, or the Stat it is bounded by with the Character's exact score (data lookup; M5 enforces it). */
  readonly maximum: { readonly kind: string; readonly value: number | null; readonly stat: string | null } | null;
  readonly increment: number | null;
  readonly default: number | string | boolean | null;
  readonly allowed: readonly string[] | null;
}
export interface ListedContribution {
  readonly contributionKey: string;
  readonly currency: string;
  readonly kind: string;
  readonly amount: number | null;
  readonly amounts: Readonly<Record<string, number>> | null;
  readonly parameter: string | null;
  readonly modifier: string | null;
}
export interface AffinityAlignment {
  readonly affinity: ProwessDefinitionRef;
  readonly strengthKeys: readonly string[];
  readonly weaknessKeys: readonly string[];
  readonly explicitAccess: boolean;
}
export interface SpellComponentOption {
  readonly ref: ProwessDefinitionRef;
  readonly kind: SpellComponentKind;
  /** The authored classifier: Effect family, Targeting shape, Duration concept, Condition restriction or Trait family. */
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly keywords: readonly string[];
  readonly parameters: readonly DeclaredParameter[];
  readonly contributions: readonly ListedContribution[];
  readonly compatibility: readonly { readonly relation: string; readonly allow: readonly string[] }[];
  /** EXECUTABLE / DEFERRED for Durations and Casting Conditions (a DEFERRED component is shown, never offered as usable). */
  readonly availability: string | null;
  /** Effects: the Duration concepts the Effect allows. */
  readonly durationsAllowed: readonly string[];
  /** Traits: scope and the Effect families they may modify. */
  readonly traitScope: string | null;
  readonly effectFamilies: readonly string[];
  /** Durations: the future runtime metadata (Sustain / Mana Lock / Concentration), as authored. */
  readonly futureRuntime: { readonly sustain: boolean; readonly manaLock: boolean; readonly concentration: string } | null;
  readonly description: string | null;
  readonly eligibility: ComponentEligibility | null;
  readonly alignment: readonly AffinityAlignment[];
}
export interface OwnedAffinityView {
  readonly affinity: ProwessDefinitionRef;
  readonly rank: string;
  readonly role: string;
  readonly strengths: readonly { readonly strengthKey: string; readonly matchAny: readonly string[] }[];
  readonly weaknesses: readonly { readonly weaknessKey: string; readonly matchAny: readonly string[]; readonly severity: string | null; readonly activationPenaltyPercent: number | null }[];
  /** The authored AFFINITY_RANK_RULE row for this rank: Authority capacities and Strength discount (data). */
  readonly rankRule: { readonly strengthDiscountPercent: number | null; readonly effectCapacity: number | null; readonly traitCapacity: number | null } | null;
}
export interface SignatureSpellCatalog {
  readonly targeting: readonly SpellComponentOption[];
  readonly effects: readonly SpellComponentOption[];
  readonly traits: readonly SpellComponentOption[];
  readonly durations: readonly SpellComponentOption[];
  readonly castingConditions: readonly SpellComponentOption[];
  readonly affinities: readonly OwnedAffinityView[];
  /** The Arcana Skill the Release names for Arcane Authority and the Character's exact rank on it. */
  readonly arcana: { readonly skillKey: string | null; readonly rankKey: string | null; readonly ranks: readonly { readonly rankKey: string; readonly effectCapacity: number | null; readonly traitCapacity: number | null; readonly conditionCapacity: number | null }[] };
  /** Mechanical Keywords the Release components author (§86): the only Keywords a Spell can carry. */
  readonly keywords: readonly string[];
  /** Performance Casting Condition status (§68): present in the Release or reported as a content gap. */
  readonly performanceCondition: { readonly present: boolean; readonly definitions: readonly ProwessDefinitionRef[] };
}

const dig = (value: unknown, path: readonly string[]): unknown => {
  let at: unknown = value;
  for (const k of path) at = isPlainObject(at) ? own(at, k) : undefined;
  return at;
};
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter(isPlainObject) as Record<string, unknown>[]) : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parametersOf(raw: unknown, stats: Readonly<Partial<Record<string, number>>>): DeclaredParameter[] {
  return list(raw).map((q) => {
    const max = isPlainObject(own(q, "maximum")) ? (own(q, "maximum") as Record<string, unknown>) : null;
    const stat = max ? str(own(max, "stat")) : null;
    const dflt = own(q, "default");
    return {
      parameter: String(own(q, "parameter")),
      kind: String(own(q, "kind")),
      minimum: num(own(q, "minimum")),
      maximum: max ? { kind: String(own(max, "kind")), value: stat !== null ? (stats[stat] ?? null) : num(own(max, "value")), stat } : null,
      increment: num(own(q, "increment")),
      default: typeof dflt === "number" || typeof dflt === "string" || typeof dflt === "boolean" ? dflt : null,
      allowed: Array.isArray(own(q, "allowed")) ? strings(own(q, "allowed")) : null,
    };
  });
}
function contributionsOf(raw: unknown): ListedContribution[] {
  return list(raw).map((c) => {
    const d = isPlainObject(own(c, "data")) ? (own(c, "data") as Record<string, unknown>) : {};
    const amounts = own(d, "amounts");
    return { contributionKey: String(own(c, "contributionKey")), currency: String(own(c, "currency")), kind: String(own(d, "kind")), amount: num(own(d, "amount")), amounts: isPlainObject(amounts) ? (clonePlainData(amounts) as Record<string, number>) : null, parameter: str(own(d, "parameter")), modifier: str(own(d, "modifier")) };
  });
}

/** The Spell-component catalog of the Character's exact Release, with eligibility and alignment hints. */
export function buildSignatureSpellCatalog(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile }): SignatureSpellCatalog {
  const { bundle, profile } = request;
  const eligibility = componentEligibilityMap({ bundle, profile });
  const stats = profile.constructionContext.stats as Readonly<Partial<Record<string, number>>>;
  const owned = (isPlainObject(profile.affinityProfile) ? list(own(profile.affinityProfile, "affinities")) : []).map((a) => ({ affinity: own(a, "affinity") as ProwessDefinitionRef, rank: String(own(a, "rank")), role: String(own(a, "role")) }));
  const affinityDefinition = (ref: ProwessDefinitionRef) => bundle.definitions.find((d) => d.entityId === ref.entityId && d.entityVersionId === ref.entityVersionId) ?? null;
  const rankRule = bundle.definitions.find((d) => d.definitionKind === "AFFINITY_RANK_RULE");
  const affinities: OwnedAffinityView[] = owned.map((o) => {
    const d = affinityDefinition(o.affinity);
    const row = rankRule ? list(own(rankRule.payload as Record<string, unknown>, "ranks")).find((r) => own(r, "rank") === o.rank) : undefined;
    return {
      ...o,
      strengths: list(d ? own(d.payload as Record<string, unknown>, "strengths") : []).map((s) => ({ strengthKey: String(own(s, "strengthKey")), matchAny: strings(own(s, "matchAny")) })),
      weaknesses: list(d ? own(d.payload as Record<string, unknown>, "weaknesses") : []).map((w) => ({ weaknessKey: String(own(w, "weaknessKey")), matchAny: strings(own(w, "matchAny")), severity: str(own(w, "severity")), activationPenaltyPercent: num(own(w, "activationPenaltyPercent")) })),
      rankRule: row ? { strengthDiscountPercent: num(own(row, "strengthDiscountPercent")), effectCapacity: num(dig(row, ["authority", "effectCapacity"])), traitCapacity: num(dig(row, ["authority", "traitCapacity"])) } : null,
    };
  });
  const option = (d: ProwessDefinitionEnvelope, kind: SpellComponentKind): SpellComponentOption => {
    const payload = d.payload as Record<string, unknown>;
    const keywords = strings(own(payload, "keywords"));
    const access = list(dig(payload, ["rules", "construction", "affinityAccess"]));
    const rules = (key: string) => dig(payload, ["rules", key]);
    const category = kind === "SPELL_EFFECT" ? str(own(payload, "effectFamily")) : kind === "SPELL_TARGETING" ? str(own(payload, "semanticShape")) : kind === "SPELL_DURATION" ? str(own(payload, "durationConcept")) : kind === "SPELL_CASTING_CONDITION" ? str(dig(payload, ["restriction", "restrictionKey"])) : str(own(payload, "traitFamily"));
    const declared = kind === "SPELL_EFFECT" ? dig(rules("effect"), ["parameters"]) : kind === "SPELL_TARGETING" ? dig(rules("targeting"), ["parameters"]) : kind === "SPELL_CASTING_CONDITION" ? dig(rules("condition"), ["parameters"]) : kind === "SPELL_DURATION" ? [] : dig(rules("trait"), ["parameters"]);
    const future = dig(rules("duration"), ["futureRuntime"]);
    return {
      ref: definitionRefOf(d),
      kind,
      category,
      subcategory: kind === "SPELL_EFFECT" ? str(dig(rules("effect"), ["effectSubfamily"])) : null,
      keywords,
      parameters: parametersOf(declared, stats),
      contributions: contributionsOf(own(payload, "costContributions")),
      compatibility: list(own(payload, "compatibility")).map((c) => ({ relation: String(own(c, "relation")), allow: strings(own(c, "allow")) })),
      availability: str(dig(rules(kind === "SPELL_DURATION" ? "duration" : "condition"), ["availability"])),
      durationsAllowed: kind === "SPELL_EFFECT" ? strings(dig(rules("effect"), ["duration", "allowed"])) : [],
      traitScope: kind === "SPELL_TRAIT" || kind === "SHARED_TRAIT" ? str(own(payload, "scope")) : null,
      effectFamilies: kind === "SPELL_TRAIT" || kind === "SHARED_TRAIT" ? strings(dig(rules("trait"), ["effectFamilies"])) : [],
      futureRuntime: isPlainObject(future) ? { sustain: own(future, "sustain") === true, manaLock: own(future, "manaLock") === true, concentration: String(own(future, "concentration")) } : null,
      description: str(dig(rules("trait"), ["description"])),
      eligibility: eligibility.get(d.entityVersionId) ?? null,
      alignment: affinities.map((a) => ({
        affinity: a.affinity,
        strengthKeys: a.strengths.filter((s) => s.matchAny.some((k) => keywords.includes(k))).map((s) => s.strengthKey),
        weaknessKeys: a.weaknesses.filter((w) => w.matchAny.some((k) => keywords.includes(k))).map((w) => w.weaknessKey),
        explicitAccess: access.some((x) => own(x, "entityId") === a.affinity.entityId && own(x, "entityVersionId") === a.affinity.entityVersionId),
      })),
    };
  };
  const of = (kind: SpellComponentKind) => bundle.definitions.filter((d) => d.definitionKind === kind).map((d) => option(d, kind));
  const construction = bundle.definitions.find((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  const spellRules = construction ? dig(construction.payload, ["spell"]) : undefined;
  const skillKey = str(dig(spellRules, ["arcaneAuthority", "skillKey"]));
  const arcaneRanks = list(dig(spellRules, ["arcaneAuthority", "ranks"]));
  const conditionRanks = list(dig(spellRules, ["castingConditions", "ranks"]));
  const conditions = of("SPELL_CASTING_CONDITION");
  const performance = conditions.filter((c) => c.category === "PERFORMANCE" || c.ref.canonicalKey.split(".").includes("performance"));
  return deepFreeze(
    clonePlainData({
      targeting: of("SPELL_TARGETING"),
      effects: of("SPELL_EFFECT"),
      traits: [...of("SPELL_TRAIT"), ...of("SHARED_TRAIT")],
      durations: of("SPELL_DURATION"),
      castingConditions: conditions,
      affinities,
      arcana: {
        skillKey,
        rankKey: profile.constructionContext.skillRanks.find((s) => s.skillKey === skillKey)?.rankKey ?? null,
        ranks: arcaneRanks.map((r) => ({ rankKey: String(own(r, "rankKey")), effectCapacity: num(own(r, "effectCapacity")), traitCapacity: num(own(r, "traitCapacity")), conditionCapacity: num(own(conditionRanks.find((c) => own(c, "rankKey") === own(r, "rankKey")) ?? {}, "capacity")) })),
      },
      keywords: [...new Set(bundle.definitions.filter((d) => (SPELL_COMPONENT_KINDS as readonly string[]).includes(d.definitionKind)).flatMap((d) => strings(own(d.payload as Record<string, unknown>, "keywords"))))].sort(),
      performanceCondition: { present: performance.length > 0, definitions: performance.map((c) => c.ref) },
    }),
  );
}
