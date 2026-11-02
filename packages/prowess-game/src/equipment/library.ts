import { evaluateModifiers } from "@prowess/rules";
import { deepFreeze } from "../internal/plain-data.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { AttackResolution, AttackTargeting } from "../definition/equipment-payload.js";
import type { CharacterMechanicalProfile } from "../character/advancement.js";
import { numericCompare, rankAtLeast } from "../character/requirements.js";
import { getWeaponCapability, indexWeaponLibrary, type AttackEntry, type ResolvedTraitUse, type WeaponCapability, type WeaponEntry, type WeaponLibraryIndex } from "./catalog.js";
import { evaluateSlot, previewAttackDamage, type DamagePreview, type PowerAdjustment } from "./damage.js";
import { checkWeaponRequirements, martialRankOf, resolveWeaponLoadout, type LoadoutIssue, type RequirementCheck, type ResolvedWeaponLoadout, type WeaponLoadoutChoice } from "./loadout.js";
import type { WeaponGrip } from "../vocabulary/equipment.js";

/**
 * The Character Attack Library (PAS-10 M6-WO6 §79–§82, §146–§147): ONE read-only projection of every Attack the
 * Character can make right now — the Unarmed profile of its exact Martial rank, the Moves of its Main-hand and
 * Off-hand Weapons, and each eligible Dual Wield pairing — each with its exact Weapon + Attack identity, a
 * Character-specific damage PREVIEW and full provenance. Pure and deterministic: it never rolls, never spends AP / MP /
 * ammunition, never applies Armor or Conditions and never persists anything.
 */

export type AttackHand = "UNARMED" | "MAIN_HAND" | "OFF_HAND";

export interface AttackRange {
  readonly mode: AttackTargeting["mode"];
  /** Melee / Close reach in feet (an executable Reach property sets it). */
  readonly reachFeet: number | null;
  /** Ranged distance in feet for THIS Character (stat × feet per point, through M4). */
  readonly rangeFeet: number | null;
  readonly lengthFeet: number | null;
  readonly area: { readonly shape: string; readonly radiusFeet: number } | null;
  readonly basis: { readonly stat: string; readonly statScore: number; readonly feetPerPoint: number } | null;
}

export interface CharacterAttack {
  /** Exact identity of this Weapon Attack: the Weapon EntityVersion and the Attack EntityVersion (§14). */
  readonly attackKey: string;
  readonly hand: AttackHand;
  readonly weapon: ProwessDefinitionRef;
  readonly attack: ProwessDefinitionRef;
  readonly moveKey: string;
  readonly weaponFamilyKey: string;
  readonly grip: WeaponGrip;
  readonly apCost: number;
  readonly mpCost: number;
  /** One preview per authored damage profile; the player selects one — never auto-selected (§23). */
  readonly damage: readonly DamagePreview[];
  readonly range: AttackRange;
  readonly resolution: AttackResolution;
  readonly accuracyModifier: number;
  readonly weaponProperties: readonly ResolvedTraitUse[];
  readonly moveProperties: readonly ResolvedTraitUse[];
  /** Property uses WO6 does not execute (REFERENCE_ONLY / DEFERRED), named so the preview never implies behavior (§98). */
  readonly notExecuted: readonly string[];
  readonly requirements: readonly RequirementCheck[];
  readonly eligibility: "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED";
  readonly provenance: { readonly rulesetId: string; readonly manifestId: string; readonly releaseId: string | null };
}

export interface DualWieldSequence {
  readonly sequenceIndex: number;
  /** max(AP A, AP B) through the Release's Formula — never the sum (§50). */
  readonly apCost: number;
  /** Two separate exact Attacks — never merged, never a Powerful Blow (§54). */
  readonly attacks: readonly [CharacterAttack, CharacterAttack];
  readonly powerfulBlow: false;
  readonly rule: ProwessDefinitionRef;
}

export interface DualWieldStatus {
  readonly available: boolean;
  readonly reasons: readonly string[];
  readonly rule: ProwessDefinitionRef | null;
  readonly hands: readonly { readonly hand: "MAIN_HAND" | "OFF_HAND"; readonly weapon: ProwessDefinitionRef; readonly category: string | null; readonly powerAdjustment: number; readonly powerAdjustmentApplies: boolean; readonly requirements: readonly RequirementCheck[] }[];
}

export interface CharacterAttackLibrary {
  readonly capability: WeaponCapability;
  readonly loadout: ResolvedWeaponLoadout;
  readonly martialRank: string | null;
  readonly unarmed: { readonly weapon: ProwessDefinitionRef; readonly attacks: readonly CharacterAttack[]; readonly grantedFeatures: readonly { readonly featureKey: string; readonly executionStatus: string; readonly summary: string }[] } | null;
  readonly mainHand: { readonly weapon: ProwessDefinitionRef; readonly grip: WeaponGrip; readonly attacks: readonly CharacterAttack[] } | null;
  readonly offHand: { readonly weapon: ProwessDefinitionRef; readonly grip: WeaponGrip; readonly attacks: readonly CharacterAttack[] } | null;
  readonly dualWield: DualWieldStatus & { readonly sequences: readonly DualWieldSequence[] };
  readonly issues: readonly LoadoutIssue[];
}

/**
 * A RANGED_MULTIPLIER range for this Character (§33): the authored feet per point MULTIPLIED by the Stat score, through
 * the M4 Modifier engine (no arithmetic here, no formula text). Null when M4 refuses it (fail closed).
 */
function rangedFeet(feetPerPoint: number, statScore: number): number | null {
  const out = evaluateModifiers({
    targets: [{ targetKey: "attack.range", kind: "NUMERIC", value: feetPerPoint }],
    modifiers: [
      {
        modifierKey: "attack.range.stat",
        targetKey: "attack.range",
        operation: "MULTIPLY",
        operand: statScore,
        phase: { phaseKey: "weapon-range", phaseOrder: 0 },
        priority: 0,
        order: 0,
        condition: null,
        stacking: { policy: "STACK" },
        source: { sourceType: "attack.targeting", sourceKey: "ranged_multiplier", sourceId: null },
        provenance: null,
      },
    ],
  });
  const target = out.success && out.data !== null ? out.data.finalTargets.find((t) => t.targetKey === "attack.range") : undefined;
  return target !== undefined && target.kind === "NUMERIC" ? target.value : null;
}

function rangeOf(attack: AttackEntry, weapon: WeaponEntry, stats: Readonly<Partial<Record<string, number>>>): AttackRange {
  const t = attack.payload.targeting;
  const none = { reachFeet: null, rangeFeet: null, lengthFeet: null, area: null, basis: null };
  switch (t.mode) {
    case "MELEE":
    case "CLOSE": {
      // An executable Reach property (on the Weapon or the Move) sets the reach (§19–§20); otherwise the authored reach.
      const reach = [...weapon.weaponProperties, ...attack.moveProperties].find((u) => u.executionStatus === "EXECUTABLE" && u.contract?.kind === "REACH");
      return { mode: t.mode, ...none, reachFeet: reach?.contract?.kind === "REACH" ? reach.contract.reachFeet : t.reachFeet };
    }
    case "RANGED_MULTIPLIER": {
      const score = stats[t.stat];
      const feet = score === undefined ? null : rangedFeet(t.feetPerPoint, score);
      return { mode: t.mode, ...none, rangeFeet: feet, area: t.area, basis: score === undefined ? null : { stat: t.stat, statScore: score, feetPerPoint: t.feetPerPoint } };
    }
    case "LINE":
    case "CONE":
      return { mode: t.mode, ...none, lengthFeet: t.lengthFeet };
  }
}

function project(request: {
  readonly bundle: ProwessDefinitionBundle;
  readonly index: WeaponLibraryIndex;
  readonly profile: CharacterMechanicalProfile;
  readonly hand: AttackHand;
  readonly weapon: WeaponEntry;
  readonly attack: AttackEntry;
  readonly grip: WeaponGrip;
  readonly weaponRequirements: readonly RequirementCheck[];
  readonly powerAdjustment?: PowerAdjustment | null;
}): CharacterAttack {
  const { weapon, attack, profile, grip } = request;
  const stats = profile.constructionContext.stats as Readonly<Partial<Record<string, number>>>;
  const damage = attack.payload.damageProfiles.map((d) => previewAttackDamage({ weapon, attack, profile: d, grip, stats, powerAdjustment: attack.scaling === "POWER" ? (request.powerAdjustment ?? null) : null }));
  const requirements = [...request.weaponRequirements, ...checkWeaponRequirements(request.index, profile, attack.payload.requirements, attack.ref)];
  const eligibility = requirements.some((r) => r.satisfied === null) ? "UNRESOLVED" : requirements.every((r) => r.satisfied === true) ? "ELIGIBLE" : "INELIGIBLE";
  const notExecuted = [...weapon.weaponProperties, ...attack.moveProperties].filter((u) => u.executionStatus !== "EXECUTABLE").map((u) => u.traitKey);
  const release = request.bundle.rulesetProvenance.release;
  return {
    attackKey: `${weapon.ref.entityVersionId}:${attack.ref.entityVersionId}`,
    hand: request.hand,
    weapon: weapon.ref,
    attack: attack.ref,
    moveKey: attack.payload.moveKey,
    weaponFamilyKey: attack.payload.weaponFamilyKey,
    grip,
    apCost: attack.payload.apCost,
    mpCost: attack.payload.mpCost,
    damage,
    range: rangeOf(attack, weapon, stats),
    resolution: attack.payload.resolution,
    accuracyModifier: attack.payload.accuracyModifier,
    weaponProperties: weapon.weaponProperties,
    moveProperties: attack.moveProperties,
    notExecuted,
    requirements,
    eligibility,
    provenance: { rulesetId: request.bundle.rulesetProvenance.rulesetId, manifestId: request.bundle.rulesetProvenance.manifestId, releaseId: release === null ? null : release.releaseId },
  };
}

function dualWieldStatus(index: WeaponLibraryIndex, profile: CharacterMechanicalProfile, loadout: ResolvedWeaponLoadout): DualWieldStatus {
  const reasons: string[] = [];
  const rule = index.dualWield;
  const main = loadout.mainHand;
  const off = loadout.offHand;
  if (rule === null) reasons.push("the Release pins no Dual Wield rule");
  if (main === null || off === null) reasons.push("Dual Wielding needs a Weapon in each hand");
  // A Shield is never Dual Wielding (§61, §75), and a two-handed grip leaves no second hand.
  for (const e of [main, off]) {
    if (e === null) continue;
    if (e.weapon.payload.equipmentRole === "SHIELD") reasons.push(`${e.weapon.ref.canonicalKey} is a Shield; Shield + Weapon is not Dual Wielding`);
    if (e.grip === "TWO_HANDED") reasons.push(`${e.weapon.ref.canonicalKey} is held two-handed`);
  }
  const martial = martialRankOf(index, profile);
  const hands: DualWieldStatus["hands"][number][] = [];
  if (rule !== null && main !== null && off !== null) {
    for (const e of [main, off]) {
      const row = rule.contract.rows.find((r) => r.category === e.weapon.payload.category);
      if (row === undefined) {
        reasons.push(`the Dual Wield rule has no row for ${e.weapon.payload.category} Weapons`);
        continue;
      }
      const required = index.martial?.ladder.find((r) => r.rankKey === row.minimumMartialRank);
      const checks: RequirementCheck[] = [
        { requirementKey: "dual_wield_martial", kind: "MARTIAL_RANK_AT_LEAST", required: `Martial ${row.minimumMartialRank}`, actual: martial === null ? "unknown" : `Martial ${martial.rankKey}`, satisfied: martial === null || required === undefined ? null : rankAtLeast(`skill_rank.${index.martial?.skillKey ?? ""}`, martial, required), source: rule.ref },
      ];
      if (row.minimumStat !== null) {
        const score = profile.stats.find((s) => s.stat === row.minimumStat?.stat)?.final;
        checks.push({ requirementKey: "dual_wield_stat", kind: "STAT_AT_LEAST", required: `${row.minimumStat.stat} ${row.minimumStat.minimum}`, actual: score === undefined ? "unknown" : `${row.minimumStat.stat} ${score}`, satisfied: score === undefined ? null : numericCompare(`stat.${row.minimumStat.stat}`, score, ">=", row.minimumStat.minimum), source: rule.ref });
      }
      for (const c of checks) if (c.satisfied !== true) reasons.push(`Dual Wielding ${e.weapon.payload.category} Weapons requires ${c.required} (the Character has ${c.actual})`);
      // The Power adjustment applies to POWER-scaled damage only: a STATIC Attack has no Power to adjust (§53).
      hands.push({ hand: e.hand, weapon: e.weapon.ref, category: e.weapon.payload.category, powerAdjustment: row.powerAdjustment, powerAdjustmentApplies: e.weapon.payload.scalingModel !== "STATIC", requirements: checks });
    }
  }
  return { available: reasons.length === 0, reasons, rule: rule?.ref ?? null, hands };
}

/**
 * One explicit Dual Wield sequence (§50–§54): Attack A from the Main hand + Attack B from the Off hand, each Power-scaled
 * Attack's Power adjusted by its category row plus `repeatPowerIncrement × sequenceIndex` (an explicit index — WO6
 * keeps no turn state, §52). AP is the Release's sequence-cost Formula (max of the two). Null when unavailable.
 */
export function previewDualWieldSequence(request: {
  readonly bundle: ProwessDefinitionBundle;
  readonly profile: CharacterMechanicalProfile;
  readonly loadout: ResolvedWeaponLoadout;
  readonly mainAttack: ProwessDefinitionRef;
  readonly offAttack: ProwessDefinitionRef;
  readonly sequenceIndex: number;
  readonly index?: WeaponLibraryIndex;
}): DualWieldSequence | null {
  const index = request.index ?? indexWeaponLibrary(request.bundle);
  const status = dualWieldStatus(index, request.profile, request.loadout);
  const main = request.loadout.mainHand;
  const off = request.loadout.offHand;
  const rule = index.dualWield;
  if (!status.available || main === null || off === null || rule === null || !Number.isSafeInteger(request.sequenceIndex) || numericCompare("dual_wield.sequence_index", request.sequenceIndex, ">=", 0) !== true) return null;
  const a = main.weapon.attacks.find((x) => x.ref.entityId === request.mainAttack.entityId && x.ref.entityVersionId === request.mainAttack.entityVersionId);
  const b = off.weapon.attacks.find((x) => x.ref.entityId === request.offAttack.entityId && x.ref.entityVersionId === request.offAttack.entityVersionId);
  if (a === undefined || b === undefined) return null;
  const adjust = (hand: "MAIN_HAND" | "OFF_HAND"): PowerAdjustment => ({
    adjustment: status.hands.find((h) => h.hand === hand)?.powerAdjustment ?? 0,
    increment: rule.contract.repeatPowerIncrement,
    sequenceIndex: request.sequenceIndex,
    rule: rule.ref,
    formula: rule.contract.effectivePower,
  });
  const pa = project({ bundle: request.bundle, index, profile: request.profile, hand: "MAIN_HAND", weapon: main.weapon, attack: a, grip: main.grip, weaponRequirements: main.requirements, powerAdjustment: adjust("MAIN_HAND") });
  const pb = project({ bundle: request.bundle, index, profile: request.profile, hand: "OFF_HAND", weapon: off.weapon, attack: b, grip: off.grip, weaponRequirements: off.requirements, powerAdjustment: adjust("OFF_HAND") });
  const apCost = evaluateSlot(rule.contract.sequenceCost, { ap_a: a.payload.apCost, ap_b: b.payload.apCost });
  if (apCost === null) return null;
  return deepFreeze({ sequenceIndex: request.sequenceIndex, apCost, attacks: [pa, pb] as [CharacterAttack, CharacterAttack], powerfulBlow: false as const, rule: rule.ref });
}

/** The Character Attack Library of one Character, loadout and exact Release (§146). */
export function buildCharacterAttackLibrary(request: { readonly bundle: ProwessDefinitionBundle; readonly characterProfile: CharacterMechanicalProfile; readonly loadout: WeaponLoadoutChoice }): CharacterAttackLibrary {
  const { bundle, characterProfile: profile } = request;
  const index = indexWeaponLibrary(bundle);
  const capability = getWeaponCapability(bundle, index);
  const loadout = resolveWeaponLoadout({ bundle, profile, loadout: request.loadout, index });
  const martial = martialRankOf(index, profile);
  // Unarmed is derived from the Character's CURRENT Martial rank — the exact profile for that rank (§58).
  const unarmedWeapon = martial === null ? undefined : index.weapons.find((w) => w.payload.profileKind === "UNARMED" && w.payload.martialRankKey === martial.rankKey);
  const handAttacks = (hand: "MAIN_HAND" | "OFF_HAND", e: ResolvedWeaponLoadout["mainHand"]) =>
    e === null ? null : { weapon: e.weapon.ref, grip: e.grip, attacks: e.weapon.attacks.map((attack) => project({ bundle, index, profile, hand, weapon: e.weapon, attack, grip: e.grip, weaponRequirements: e.requirements })) };
  const usable = loadout.status === "VALID";
  const status = dualWieldStatus(index, profile, loadout);
  const sequences: DualWieldSequence[] = [];
  if (usable && status.available && loadout.mainHand !== null && loadout.offHand !== null) {
    for (const a of loadout.mainHand.weapon.attacks)
      for (const b of loadout.offHand.weapon.attacks) {
        const s = previewDualWieldSequence({ bundle, profile, loadout, mainAttack: a.ref, offAttack: b.ref, sequenceIndex: 0, index });
        if (s !== null) sequences.push(s);
      }
  }
  return deepFreeze({
    capability,
    loadout,
    martialRank: martial?.rankKey ?? null,
    unarmed:
      unarmedWeapon === undefined
        ? null
        : {
            weapon: unarmedWeapon.ref,
            attacks: unarmedWeapon.attacks.map((attack) => project({ bundle, index, profile, hand: "UNARMED", weapon: unarmedWeapon, attack, grip: "ONE_HANDED", weaponRequirements: [] })),
            grantedFeatures: unarmedWeapon.payload.grantedFeatures,
          },
    mainHand: usable ? handAttacks("MAIN_HAND", loadout.mainHand) : null,
    offHand: usable ? handAttacks("OFF_HAND", loadout.offHand) : null,
    dualWield: { ...status, available: usable && status.available, sequences },
    issues: loadout.issues,
  });
}
