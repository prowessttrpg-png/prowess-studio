import { definitionRefOf, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { AbilityConstructionRulePayload } from "../definition/ability-construction-payload.js";
import { readFoundationProfile, isAttackFoundation } from "../definition/authored-ability-payload.js";
import type { FoundationDefinitionPayload } from "../definition/payload.js";
import { Problems } from "../internal/problems.js";
import { deepFreeze } from "../internal/plain-data.js";
import type { CharacterMechanicalProfile } from "./advancement.js";
import { componentEligibilityMap } from "./eligibility.js";
import { buildSignatureSpellCatalog, parametersOf, contributionsOf, type SpellComponentOption } from "./signature-spell-catalog.js";
import { bindWeaponAttackToManeuver } from "../equipment/bridge.js";
import { indexWeaponLibrary } from "../equipment/catalog.js";
import type { CharacterAttackLibrary } from "../equipment/library.js";
import type { ManeuverActionSource } from "./signature-maneuver.js";

export interface ManeuverActionOption {
  readonly optionKey: string;
  readonly category: "WEAPON_ATTACK" | "MOVEMENT" | "DEFENSE" | "INTERACTION";
  readonly source: ManeuverActionSource;
  readonly available: boolean;
  readonly reasons: readonly { readonly code: string; readonly message: string }[];
  readonly profile: ReturnType<typeof readFoundationProfile>;
  readonly contributions: ReturnType<typeof contributionsOf>;
  readonly keywords: readonly string[];
}
export type ManeuverComponentOption = Omit<SpellComponentOption, "kind"> & { readonly kind: string; readonly available: boolean; readonly unavailableReason: string | null; readonly foundationCategories: readonly string[]; readonly consumesSlot: boolean | null; readonly slotExemption: string | null; readonly performanceVersion: string | null };
export interface SignatureManeuverCatalog {
  readonly actions: readonly ManeuverActionOption[];
  readonly effects: readonly ManeuverComponentOption[];
  readonly traits: readonly ManeuverComponentOption[];
  readonly durations: readonly ManeuverComponentOption[];
  readonly conditions: readonly ManeuverComponentOption[];
  readonly affinities: ReturnType<typeof buildSignatureSpellCatalog>["affinities"];
  readonly martial: { readonly skillKey: string | null; readonly rankKey: string | null; readonly maximumActionBlocks: number | null; readonly effectCapacity: number | null; readonly traitCapacity: number | null; readonly conditionCapacity: number | null };
  readonly limitations: readonly { readonly code: string; readonly message: string }[];
  readonly performanceCondition: { readonly present: boolean; readonly definitions: readonly ProwessDefinitionRef[] };
  readonly powerfulBlow: { readonly available: boolean; readonly minimumRepetitions: 2; readonly maximumGroups: 1 };
}
/** Read-only Release projection. Listed component prices remain authored data; the cost compiler alone totals them. */
export function buildSignatureManeuverCatalog(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile; readonly attackLibrary: CharacterAttackLibrary }): SignatureManeuverCatalog {
  const { bundle, profile, attackLibrary: library } = request;
  const eligibility = componentEligibilityMap({ bundle, profile });
  const shared = buildSignatureSpellCatalog({ bundle, profile });
  const construction = bundle.definitions.find(d => d.definitionKind === "ABILITY_CONSTRUCTION_RULE")?.payload as unknown as AbilityConstructionRulePayload | undefined;
  const martial = construction?.maneuver.martial, skillKey = martial?.skillKey ?? null;
  const rankKey = profile.constructionContext.skillRanks.find(s => s.skillKey === skillKey)?.rankKey ?? null;
  const row = martial?.ranks.find(r => r.rankKey === rankKey);
  const limitations: { code: string; message: string }[] = [];
  if (!construction?.maneuverCostPolicy?.extension) limitations.push({ code: "MISSING_APPROVED_COST_POLICY", message: "This Release lacks the approved M6-WO8-A policy; finalization requires a separately governed content update." });
  const option = (kind: string): ManeuverComponentOption[] => bundle.definitions.filter(d => d.definitionKind === kind).map(d => {
    const p = d.payload as Record<string, unknown>, rules = p.rules as Record<string, Record<string, unknown>>;
    const component = rules?.[kind === "MANEUVER_EFFECT" ? "effect" : kind === "MANEUVER_DURATION" ? "duration" : kind === "MANEUVER_CONDITION" ? "condition" : "trait"];
    const category = String(p.effectFamily ?? p.durationConcept ?? (p.restriction as { restrictionKey?: string } | undefined)?.restrictionKey ?? p.traitFamily ?? "");
    const keywords = (p.keywords ?? []) as string[];
    const declared = kind === "MANEUVER_DURATION" && category === "ROUNDS" ? [{ parameter: "rounds", kind: "COUNT", minimum: 1, maximum: null, increment: 1, default: null }] : component?.parameters;
    const parameters = parametersOf(declared, profile.constructionContext.stats).filter(q => q.parameter !== (component?.performance as { rankParameter?: string } | undefined)?.rankParameter);
    const performanceGap = category === "PERFORMANCE" && (component?.performance as { version?: string } | undefined)?.version !== "M6-WO8-A";
    return { foundationCategories: (component?.foundationCategories ?? []) as string[], consumesSlot: typeof component?.consumesSlot === "boolean" ? component.consumesSlot : null, slotExemption: typeof component?.slotExemption === "string" ? component.slotExemption : null, performanceVersion: typeof (component?.performance as { version?: unknown } | undefined)?.version === "string" ? (component!.performance as { version: string }).version : null, available: !!component && !performanceGap && component.availability !== "DEFERRED" && (eligibility.get(d.entityVersionId)?.status ?? "ELIGIBLE") === "ELIGIBLE", unavailableReason: performanceGap ? "This Performance Definition lacks the approved exact rank and preparation contract" : !component ? "This exact Definition has no executable structured contract" : component.availability === "DEFERRED" ? String(component.deferralKey) : (eligibility.get(d.entityVersionId)?.status ?? "ELIGIBLE") !== "ELIGIBLE" ? "Character requirements are not satisfied" : null, ref: definitionRefOf(d), kind, category, subcategory: typeof component?.effectSubfamily === "string" ? component.effectSubfamily : null, keywords, parameters, contributions: contributionsOf(p.costContributions), compatibility: (p.compatibility ?? []) as SpellComponentOption["compatibility"], availability: typeof component?.availability === "string" ? component.availability : null, durationsAllowed: ((component?.duration as { allowed?: string[] } | undefined)?.allowed ?? []), traitScope: typeof p.scope === "string" ? p.scope : null, effectFamilies: (component?.effectFamilies ?? []) as string[], futureRuntime: null, description: typeof component?.description === "string" ? component.description : null, eligibility: eligibility.get(d.entityVersionId) ?? null, alignment: shared.affinities.map(a => ({ affinity: a.affinity, strengthKeys: a.strengths.filter(s => s.matchAny.some(k => keywords.includes(k))).map(s => s.strengthKey), weaknessKeys: a.weaknesses.filter(w => w.matchAny.some(k => keywords.includes(k))).map(w => w.weaknessKey), explicitAccess: ((rules?.construction?.affinityAccess ?? []) as ProwessDefinitionRef[]).some(ref => ref.entityVersionId === a.affinity.entityVersionId) })) };
  });
  const actions: ManeuverActionOption[] = [];
  for (const d of bundle.definitions.filter(d => d.definitionKind === "MANEUVER_FOUNDATION")) {
    const payload = d.payload as unknown as FoundationDefinitionPayload, p = new Problems(), foundation = readFoundationProfile(payload.rules, [], p);
    if (!foundation || isAttackFoundation(foundation)) continue; // Character Attacks always come from the current WO6 Library.
    const access = eligibility.get(d.entityVersionId);
    const reasons = access !== undefined && access.status !== "ELIGIBLE" ? [{ code: "ACTION_PREREQUISITES", message: "The Character does not meet this exact Action's construction requirements." }] : [];
    actions.push({ optionKey: d.entityVersionId, category: foundation.category, source: { kind: "FOUNDATION", definition: definitionRefOf(d) }, available: !reasons.length, reasons, profile: foundation, contributions: contributionsOf(payload.costContributions), keywords: payload.keywords });
  }
  const index = indexWeaponLibrary(bundle), targeting = bundle.definitions.filter(d => d.definitionKind === "MANEUVER_TARGETING" && (d.payload as { semanticShape?: string }).semanticShape === "SINGLE_TARGET");
  const currentAttacks = [...(library.unarmed?.attacks ?? []), ...(library.mainHand?.attacks ?? []), ...(library.offHand?.attacks ?? [])];
  for (const attack of currentAttacks) for (const damage of attack.damage) {
    const reasons = attack.eligibility !== "ELIGIBLE" ? [{ code: "ATTACK_PREREQUISITES", message: "The exact current Attack's WO6 requirements are not satisfied." }] : [];
    const bound = targeting.length === 1 ? bindWeaponAttackToManeuver({ index, attack, damageProfileKey: damage.profileKey, targeting: { componentKey: "targeting", definition: definitionRefOf(targeting[0]!), parameters: {} } }) : null;
    if (!bound?.ok) reasons.push(...(bound ? bound.problems.map(q => ({ code: q.code, message: q.message })) : [{ code: "MISSING_INHERITED_TARGETING", message: "This Release needs an unambiguous exact single-target Maneuver targeting Definition." }]));
    if (currentAttacks.filter(a => a.attackKey === attack.attackKey).length > 1) reasons.push({ code: "AMBIGUOUS_ATTACK_CONTEXT", message: "This key identifies multiple current hand profiles; the current WO6 binding contract cannot choose one unambiguously." });
    const source: ManeuverActionSource = { kind: "WEAPON_ATTACK", attackKey: attack.attackKey, weapon: attack.weapon, attack: attack.attack, damageProfileKey: damage.profileKey };
    const optionKey = `${attack.attackKey}:${damage.profileKey}`;
    if (!actions.some(a => a.optionKey === optionKey)) actions.push({ optionKey, category: "WEAPON_ATTACK", source, available: !reasons.length, reasons, profile: bound?.ok ? bound.value.foundation : null, contributions: bound?.ok ? contributionsOf(bound.value.foundationPayload.costContributions) : [], keywords: [] });
  }
  for (const category of ["MOVEMENT", "DEFENSE", "INTERACTION"] as const) if (!actions.some(a => a.category === category)) limitations.push({ code: `MISSING_${category}_FOUNDATIONS`, message: `No exact ${category.toLowerCase()} Action Foundation is authored in this Release; no Action or price is fabricated.` });
  const conditions = option("MANEUVER_CONDITION"), performance = conditions.filter(c => c.category === "PERFORMANCE" && c.performanceVersion === "M6-WO8-A");
  if (!performance.length) limitations.push({ code: "MISSING_PERFORMANCE_CONDITION", message: "This Release does not pin the approved structured Performance Condition. The governed content candidate is prepared separately." });
  return deepFreeze({ actions, effects: option("MANEUVER_EFFECT"), traits: [...option("MANEUVER_TRAIT"), ...option("SHARED_TRAIT")], durations: option("MANEUVER_DURATION"), conditions, affinities: shared.affinities, martial: { skillKey, rankKey, maximumActionBlocks: row?.martialRankValue ?? null, effectCapacity: row?.effectCapacity ?? null, traitCapacity: row?.traitCapacity ?? null, conditionCapacity: row?.conditionCapacity ?? null }, limitations, performanceCondition: { present: !!performance.length, definitions: performance.map(c => c.ref) }, powerfulBlow: { available: actions.some(a => a.available && a.category === "WEAPON_ATTACK"), minimumRepetitions: 2, maximumGroups: 1 } });
}
