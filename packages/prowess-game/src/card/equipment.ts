import type { ProwessRulesetProvenance } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { WeaponDefinitionPayload } from "../definition/equipment-payload.js";
import type { ResolvedTraitUse, WeaponEntry } from "../equipment/catalog.js";
import type { CharacterAttack, CharacterAttackLibrary } from "../equipment/library.js";
import type { EquippedWeapon, RequirementCheck } from "../equipment/loadout.js";
import { clonePlainData, deepFreeze } from "../internal/plain-data.js";
import {
  CARD_CONTRACT_VERSION,
  available,
  unavailable,
  type AttackCard,
  type CardAvailability,
  type CardEquippedState,
  type CardLimitation,
  type CardPropertyEntry,
  type CardProvenance,
  type CardRequirementEntry,
  type WeaponCard,
} from "./contract.js";
import { renderAttackRules, sentence, type CardInstructions, type InstructionBlock, type LanguageContext } from "./language.js";
import type { AttackCheckSemantics, AttackRules } from "./semantics.js";

/**
 * PAS-10 M6-WO9 Phase B — Weapon and Attack Cards, projected from the M6-WO6 Character Attack Library (the one
 * authority for a Character's Attacks). Every value — AP / MP, damage previews with their evaluated scaling steps,
 * range, resolution, properties, requirements and eligibility — is COPIED from that library or from the exact Weapon
 * Definition it names. Nothing is rolled, spent, tracked (ammunition, inventory) or executed; no value is recomputed.
 */

/** The non-Ability Card context: the exact Character and its pinned Release, plus exact-ref labels (never identity). */
export interface CharacterCardContext {
  readonly characterId: string;
  readonly characterReleaseId: string;
  readonly rulesetProvenance: ProwessRulesetProvenance;
  readonly names: Readonly<Record<string, string>>;
}

const WO6_AUTHORITY = "M6-WO6 buildCharacterAttackLibrary (M4-evaluated damage preview, requirements and range)";
const labelFrom = (names: Readonly<Record<string, string>>) => (ref: ProwessDefinitionRef): string => names[ref.entityVersionId] ?? ref.canonicalKey;

/** "ATTACK:<weapon version>:<attack version>:<hand>" — exact identity, never a name. */
export const attackCardKey = (hand: string, weaponRef: ProwessDefinitionRef, attackRef: ProwessDefinitionRef): string => `ATTACK:${weaponRef.entityVersionId}:${attackRef.entityVersionId}:${hand}`;
export const weaponCardKey = (hand: string, weaponRef: ProwessDefinitionRef): string => `WEAPON:${weaponRef.entityVersionId}:${hand}`;

const propertyOf = (u: ResolvedTraitUse): CardPropertyEntry => ({ trait: u.trait, traitKey: u.traitKey, executionStatus: u.executionStatus, parameters: u.parameters, summary: u.summary });
const requirementOf = (q: RequirementCheck): CardRequirementEntry => ({ requirementKey: q.requirementKey, kind: q.kind, required: q.required, actual: q.actual, satisfied: q.satisfied, source: q.source });
/** The authored Move AP / MP fields, read by key (the WO6 library already resolved them; nothing is priced here). */
const listed = (a: CharacterAttack, key: "apCost" | "mpCost"): number => a[key];

function provenanceOf(ctx: CharacterCardContext, sources: readonly ProwessDefinitionRef[], state: string): CardProvenance {
  return { rulesetProvenance: ctx.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, characterId: ctx.characterId, ability: null, sources, evaluation: { authority: WO6_AUTHORITY, state } };
}

function checkOf(a: CharacterAttack): AttackCheckSemantics {
  const r = a.resolution;
  if (r.mode === "ATTACK_ROLL") return { kind: "ATTACK_ROLL", onMiss: r.onMiss };
  if (r.mode === "SAVING_THROW") return { kind: "SAVING_THROW", stat: r.savingThrowStat, dc: r.dc, onDefenderSaveFails: r.onFailure, onDefenderSaveSucceeds: r.onSuccess };
  return { kind: "UNRESOLVED", code: "ATTACK.RESOLUTION_DEFERRED", reason: r.reason };
}

/** The typed rules model of one Character Attack (its exact authored resolution and evaluated damage). */
export function attackRulesOf(a: CharacterAttack): AttackRules {
  const check = checkOf(a);
  const properties = [...a.weaponProperties, ...a.moveProperties].map((u) => ({ trait: u.trait, traitKey: u.traitKey, executionStatus: u.executionStatus, summary: u.summary }));
  const unresolved = [
    ...(check.kind === "UNRESOLVED" ? [{ code: check.code, message: check.reason }] : []),
    ...a.damage.filter((d) => d.status !== "PREVIEWED").map((d) => ({ code: "ATTACK.DAMAGE_FAIL_CLOSED", message: `${d.profileKey}: ${d.reason ?? "the damage preview failed closed"}` })),
  ];
  return deepFreeze({ kind: "WEAPON_ATTACK" as const, check, damage: a.damage.map((d) => ({ profileKey: d.profileKey, damageType: d.damageType, expression: d.final?.expression ?? null, status: d.status })), properties, unresolved });
}

const availabilityOf = (a: CharacterAttack): CardAvailability => {
  if (a.eligibility !== "ELIGIBLE") return "UNAVAILABLE";
  return a.notExecuted.length > 0 || a.resolution.mode === "DEFERRED" ? "AVAILABLE_WITH_RUNTIME_DEFERRED" : "AVAILABLE";
};

/** One Attack card from one Character Attack (Unarmed, Main-hand or Off-hand Move). */
export function projectAttackCard(input: { readonly attack: CharacterAttack; readonly equipped: CardEquippedState; readonly context: CharacterCardContext; readonly description?: string }): AttackCard {
  const a = input.attack;
  const ctx = input.context;
  const { weapon: weaponRef, attack: attackRef } = a;
  const lang: LanguageContext = { labelOf: labelFrom(ctx.names) };
  const rules = attackRulesOf(a);
  const instructions = renderAttackRules(rules, lang);
  const traitRefs = [...a.weaponProperties, ...a.moveProperties].map((u) => u.trait);
  const sources = [weaponRef, attackRef, ...traitRefs.filter((t, i) => traitRefs.findIndex((x) => x.entityVersionId === t.entityVersionId) === i)];
  const limitations: CardLimitation[] = [
    ...a.notExecuted.map((n) => ({ code: "ATTACK.PROPERTY_NOT_EXECUTED", message: n })),
    ...a.requirements.filter((q) => q.satisfied !== true).map((q) => ({ code: q.satisfied === null ? "ATTACK.REQUIREMENT_UNRESOLVED" : "ATTACK.REQUIREMENT_UNMET", message: `${q.required} (has ${q.actual})` })),
  ];
  const cardKey = attackCardKey(a.hand, weaponRef, attackRef);
  const ap = listed(a, "apCost");
  const mp = listed(a, "mpCost");
  return deepFreeze(
    clonePlainData({
      contractVersion: CARD_CONTRACT_VERSION,
      cardKey,
      category: "ATTACK" as const,
      name: lang.labelOf(attackRef),
      description: input.description ?? "",
      artwork: { kind: "PLACEHOLDER" as const },
      availability: availabilityOf(a),
      provenance: provenanceOf(ctx, sources, a.eligibility),
      costs: { ap: available(ap), mp: available(mp), breakdown: [{ label: "Attack", currency: "AP" as const, value: ap, source: attackRef }, { label: "Attack", currency: "MP" as const, value: mp, source: attackRef }] },
      targeting: available({ targeting: null, range: available({ value: a.range.rangeFeet ?? a.range.reachFeet ?? a.range.lengthFeet ?? null, unit: "ft", model: a.range.mode, ruleText: null }), targetCount: { kind: a.range.area === null ? a.range.mode : a.range.area.shape, count: null } }),
      rules: available(rules),
      instructions,
      limitations,
      section: {
        kind: "ATTACK" as const,
        weapon: weaponRef,
        attack: attackRef,
        attackKey: a.attackKey,
        equipped: input.equipped,
        moveKey: a.moveKey,
        weaponFamilyKey: a.weaponFamilyKey,
        accuracyModifier: a.accuracyModifier,
        damage: a.damage.map((d) => ({ profileKey: d.profileKey, damageType: d.damageType, status: d.status, reason: d.reason, scaling: d.scaling, base: d.base.expression, final: d.final?.expression ?? null, steps: d.steps.map((s) => ({ step: s.step, detail: s.detail, source: s.source })) })),
        range: a.range,
        resolution: a.resolution as unknown as Readonly<Record<string, unknown>>,
        properties: { weapon: a.weaponProperties.map(propertyOf), move: a.moveProperties.map(propertyOf) },
        notExecuted: a.notExecuted,
        requirements: a.requirements.map(requirementOf),
        eligibility: a.eligibility,
        equipmentProvenance: a.provenance,
      },
      snapshot: { contractVersion: CARD_CONTRACT_VERSION, cardKey, rulesetProvenance: ctx.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, ability: null, sources: sources.map((s) => s.entityVersionId) },
    }),
  ) as AttackCard;
}

function weaponNotes(properties: readonly CardPropertyEntry[], features: WeaponDefinitionPayload["grantedFeatures"], lang: LanguageContext): CardInstructions {
  const words: Readonly<Record<string, string>> = { EXECUTABLE: "applied", REFERENCE_ONLY: "reference only — not executed", DEFERRED: "deferred — not executed" };
  const blocks: InstructionBlock[] = [
    ...properties.map((p, i) => ({ key: `weapon.property.${i}`, kind: "NOTE" as const, text: sentence(`${lang.labelOf(p.trait)} (${words[p.executionStatus] ?? p.executionStatus})${p.summary === "" ? "" : `: ${p.summary}`}`), refs: [p.traitKey] })),
    ...features.map((f, i) => ({ key: `weapon.feature.${i}`, kind: "NOTE" as const, text: sentence(`${f.summary} (${words[f.executionStatus] ?? f.executionStatus})`), refs: [f.featureKey] })),
    { key: "weapon.moves", kind: "NOTE" as const, text: sentence("each Move is its own Attack card with its own cost, damage and resolution"), refs: [] },
  ];
  return deepFreeze({ language: "en" as const, status: "COMPLETE" as const, blocks, unresolved: [] });
}

/** One Weapon card: the exact Weapon revision the Character holds (or its Unarmed profile) and its equipped state. */
export function projectWeaponCard(input: { readonly entry: WeaponEntry; readonly equipped: CardEquippedState; readonly requirements: readonly RequirementCheck[]; readonly context: CharacterCardContext; readonly description?: string }): WeaponCard {
  const { entry, context: ctx } = input;
  const w = entry.payload;
  const lang: LanguageContext = { labelOf: labelFrom(ctx.names) };
  const properties = entry.weaponProperties.map(propertyOf);
  const requirements = input.requirements.map(requirementOf);
  const sources = [entry.ref, ...entry.attacks.map((x) => x.ref), ...properties.map((p) => p.trait)];
  const unmet = requirements.filter((q) => q.satisfied !== true);
  const cardKey = weaponCardKey(input.equipped.hand, entry.ref);
  const notApplicable = "a Weapon has no cost or targeting of its own; each Move is its own Attack card";
  return deepFreeze(
    clonePlainData({
      contractVersion: CARD_CONTRACT_VERSION,
      cardKey,
      category: "WEAPON" as const,
      name: lang.labelOf(entry.ref),
      description: input.description ?? "",
      artwork: { kind: "PLACEHOLDER" as const },
      availability: unmet.length === 0 ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
      provenance: provenanceOf(ctx, sources, unmet.length === 0 ? "REQUIREMENTS_MET" : "REQUIREMENTS_NOT_MET"),
      costs: { ap: unavailable<number>("CARD.NOT_APPLICABLE", notApplicable), mp: unavailable<number>("CARD.NOT_APPLICABLE", notApplicable), breakdown: [] },
      targeting: unavailable("CARD.NOT_APPLICABLE", notApplicable),
      rules: unavailable("CARD.NOT_APPLICABLE", notApplicable),
      instructions: weaponNotes(properties, w.grantedFeatures, lang),
      limitations: unmet.map((q) => ({ code: q.satisfied === null ? "WEAPON.REQUIREMENT_UNRESOLVED" : "WEAPON.REQUIREMENT_UNMET", message: `${q.required} (has ${q.actual})` })),
      section: {
        kind: "WEAPON" as const,
        weapon: entry.ref,
        equipped: input.equipped,
        profileKind: w.profileKind,
        equipmentRole: w.equipmentRole,
        category: w.category,
        handedness: w.handedness,
        scalingModel: w.scalingModel,
        power: w.power === null ? unavailable<number>("WEAPON.NO_POWER", "this Weapon authors no Power (it is not Power-scaled)") : available(w.power),
        martialRankKey: w.martialRankKey,
        exampleForms: w.exampleForms,
        properties,
        equippedModifiers: w.equippedModifiers,
        grantedFeatures: w.grantedFeatures,
        requirements,
        moveset: entry.attacks.map((x) => ({ attack: x.ref, cardKey: attackCardKey(input.equipped.hand, entry.ref, x.ref) })),
      },
      snapshot: { contractVersion: CARD_CONTRACT_VERSION, cardKey, rulesetProvenance: ctx.rulesetProvenance, characterReleaseId: ctx.characterReleaseId, ability: null, sources: sources.map((s) => s.entityVersionId) },
    }),
  ) as WeaponCard;
}

/** The equipped state of one loadout hand. */
const handState = (hand: "MAIN_HAND" | "OFF_HAND", e: EquippedWeapon): CardEquippedState => ({ hand, grip: e.grip, occupies: e.occupies });

/**
 * Every Weapon and Attack card of the Character's CURRENT loadout, in sheet order (Unarmed, Main hand, Off hand), from
 * one Character Attack Library. Unarmed is the profile of the Character's exact Martial rank; a held Weapon's cards
 * exist only while it is equipped in a VALID loadout (the library's own rule).
 */
export function projectEquipmentCards(input: { readonly library: CharacterAttackLibrary; readonly weapons: readonly WeaponEntry[]; readonly context: CharacterCardContext }): { readonly weapons: readonly WeaponCard[]; readonly attacks: readonly AttackCard[] } {
  const { library, context } = input;
  const entryOf = (ref: ProwessDefinitionRef) => input.weapons.find((w) => w.ref.entityVersionId === ref.entityVersionId) ?? null;
  const weapons: WeaponCard[] = [];
  const attacks: AttackCard[] = [];
  if (library.unarmed !== null) {
    const { weapon: unarmedRef } = library.unarmed;
    const equipped: CardEquippedState = { hand: "UNARMED", grip: "ONE_HANDED", occupies: [] };
    const entry = entryOf(unarmedRef);
    if (entry !== null) weapons.push(projectWeaponCard({ entry, equipped, requirements: [], context }));
    for (const a of library.unarmed.attacks) attacks.push(projectAttackCard({ attack: a, equipped, context }));
  }
  for (const [hand, held, lib] of [
    ["MAIN_HAND", library.loadout.mainHand, library.mainHand],
    ["OFF_HAND", library.loadout.offHand, library.offHand],
  ] as const) {
    if (held === null || lib === null) continue;
    const { weapon: entry, requirements } = held;
    const equipped = handState(hand, held);
    weapons.push(projectWeaponCard({ entry, equipped, requirements, context }));
    for (const a of lib.attacks) attacks.push(projectAttackCard({ attack: a, equipped, context }));
  }
  return deepFreeze({ weapons, attacks });
}
