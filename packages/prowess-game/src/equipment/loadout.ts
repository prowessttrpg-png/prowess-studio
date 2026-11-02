import { deepFreeze, isPlainObject } from "../internal/plain-data.js";
import { isExactUuid, own } from "../internal/problems.js";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { EquippedModifier, WeaponRequirement } from "../definition/equipment-payload.js";
import type { CharacterMechanicalProfile } from "../character/advancement.js";
import { numericCompare, rankAtLeast } from "../character/requirements.js";
import { findLibraryWeapon, indexWeaponLibrary, type WeaponEntry, type WeaponLibraryIndex } from "./catalog.js";
import { WEAPON_GRIPS, type WeaponGrip, type WeaponHand } from "../vocabulary/equipment.js";

/**
 * Character Weapon loadout (PAS-10 M6-WO6 §68–§77): Main-hand and Off-hand hold exact Weapon Definitions of the
 * Character's own Release. The loadout is a CHOICE — the only thing stored. Everything derived from it (hands occupied,
 * Attacks, shield bonuses, damage) is recomputed from the exact Release and the Character profile. Requirements are
 * evaluated through the M4 Requirement engine; a failure is a structured reason, never a silent equip.
 */

export const WEAPON_LOADOUT_ERROR_CODES = deepFreeze({
  INVALID_INPUT: "PROWESS_LOADOUT.INVALID_INPUT",
  NOT_PINNED: "PROWESS_LOADOUT.WEAPON_NOT_IN_RELEASE",
  NOT_EQUIPPABLE: "PROWESS_LOADOUT.NOT_EQUIPPABLE",
  GRIP: "PROWESS_LOADOUT.GRIP",
  HANDS: "PROWESS_LOADOUT.HANDS_OCCUPIED",
  REQUIREMENT: "PROWESS_LOADOUT.REQUIREMENT_NOT_MET",
  UNRESOLVED: "PROWESS_LOADOUT.REQUIREMENT_UNRESOLVED",
} as const);
const L = WEAPON_LOADOUT_ERROR_CODES;

/** The stored loadout choice: exact Entity + EntityVersion pairs and the explicit Versatile grip. */
export interface WeaponLoadoutChoice {
  readonly mainHand: { readonly entityId: string; readonly entityVersionId: string } | null;
  /** Explicit for a VERSATILE Main-hand Weapon; null otherwise (the grip follows the Weapon's handedness). */
  readonly mainHandGrip: WeaponGrip | null;
  readonly offHand: { readonly entityId: string; readonly entityVersionId: string } | null;
}

export interface LoadoutIssue {
  readonly code: string;
  readonly hand: WeaponHand | null;
  readonly message: string;
  readonly source: ProwessDefinitionRef | null;
}

export interface RequirementCheck {
  readonly requirementKey: string;
  readonly kind: WeaponRequirement["kind"];
  readonly required: string;
  readonly actual: string;
  /** null when it could not be evaluated (fails closed for equipping). */
  readonly satisfied: boolean | null;
  readonly source: ProwessDefinitionRef;
}

export interface EquippedWeapon {
  readonly hand: WeaponHand;
  readonly weapon: WeaponEntry;
  readonly grip: WeaponGrip;
  /** Hands this Weapon occupies: a Two-Handed Weapon (or a two-handed Versatile grip) occupies both (§73–§74). */
  readonly occupies: readonly WeaponHand[];
  readonly requirements: readonly RequirementCheck[];
}

export interface ResolvedWeaponLoadout {
  readonly status: "VALID" | "INVALID";
  readonly issues: readonly LoadoutIssue[];
  readonly mainHand: EquippedWeapon | null;
  readonly offHand: EquippedWeapon | null;
}

/** The Character's exact Martial rank (the ladder's first rank when untrained), or null when it cannot be read. */
export function martialRankOf(index: WeaponLibraryIndex, profile: CharacterMechanicalProfile): { readonly rankKey: string; readonly order: number } | null {
  if (index.martial === null) return null;
  const owned = profile.constructionContext.skillRanks.find((s) => s.skillKey === index.martial?.skillKey);
  const row = owned === undefined ? index.martial.ladder[0] : index.martial.ladder.find((r) => r.rankKey === owned.rankKey);
  return row === undefined ? null : { rankKey: row.rankKey, order: row.order };
}

/** Structured requirements through M4 (§60, §76): Martial rank on the Release's ladder, Stat scores from the profile. */
export function checkWeaponRequirements(index: WeaponLibraryIndex, profile: CharacterMechanicalProfile, requirements: readonly WeaponRequirement[], source: ProwessDefinitionRef): RequirementCheck[] {
  const martial = martialRankOf(index, profile);
  return requirements.map((q) => {
    if (q.kind === "MARTIAL_RANK_AT_LEAST") {
      const required = index.martial?.ladder.find((r) => r.rankKey === q.minimumRank);
      const satisfied = martial === null || required === undefined ? null : rankAtLeast(`skill_rank.${index.martial?.skillKey ?? ""}`, martial, required);
      return { requirementKey: q.requirementKey, kind: q.kind, required: `Martial ${q.minimumRank}`, actual: martial === null ? "unknown" : `Martial ${martial.rankKey}`, satisfied, source };
    }
    const score = profile.stats.find((s) => s.stat === q.stat)?.final;
    const satisfied = score === undefined ? null : numericCompare(`stat.${q.stat}`, score, ">=", q.minimum);
    return { requirementKey: q.requirementKey, kind: q.kind, required: `${q.stat} ${q.minimum}`, actual: score === undefined ? "unknown" : `${q.stat} ${score}`, satisfied, source };
  });
}

/** Reads untrusted loadout input strictly: exact pairs and a grip only (§145). */
export function readWeaponLoadoutChoice(input: unknown): { readonly ok: true; readonly value: WeaponLoadoutChoice } | { readonly ok: false; readonly message: string } {
  if (!isPlainObject(input)) return { ok: false, message: "the loadout is { mainHand, mainHandGrip, offHand }" };
  const allowed = ["mainHand", "mainHandGrip", "offHand"];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) return { ok: false, message: `unknown field "${key}" — the client chooses Weapons and grip only; everything else is derived` };
  const pair = (v: unknown, what: string): { entityId: string; entityVersionId: string } | null | "bad" => {
    if (v === null) return null;
    if (!isPlainObject(v) || Object.keys(v).sort().join(",") !== "entityId,entityVersionId" || !isExactUuid(own(v, "entityId")) || !isExactUuid(own(v, "entityVersionId"))) return "bad";
    void what;
    return { entityId: own(v, "entityId") as string, entityVersionId: own(v, "entityVersionId") as string };
  };
  const mainHand = pair(own(input, "mainHand") ?? null, "mainHand");
  const offHand = pair(own(input, "offHand") ?? null, "offHand");
  const rawGrip = own(input, "mainHandGrip") ?? null;
  if (mainHand === "bad" || offHand === "bad") return { ok: false, message: "a hand is null or an exact { entityId, entityVersionId } pair" };
  if (rawGrip !== null && !(WEAPON_GRIPS as readonly unknown[]).includes(rawGrip)) return { ok: false, message: `mainHandGrip is null or one of ${WEAPON_GRIPS.join(", ")}` };
  return { ok: true, value: { mainHand, mainHandGrip: rawGrip as WeaponGrip | null, offHand } };
}

/** Validates a loadout choice against the exact Release and the Character's profile. Pure; never persists. */
export function resolveWeaponLoadout(request: { readonly bundle: ProwessDefinitionBundle; readonly profile: CharacterMechanicalProfile; readonly loadout: WeaponLoadoutChoice; readonly index?: WeaponLibraryIndex }): ResolvedWeaponLoadout {
  const index = request.index ?? indexWeaponLibrary(request.bundle);
  const issues: LoadoutIssue[] = [];
  const { loadout, profile } = request;
  const equip = (hand: WeaponHand, selection: { entityId: string; entityVersionId: string } | null): EquippedWeapon | null => {
    if (selection === null) return null;
    const weapon = findLibraryWeapon(index, selection);
    if (weapon === null) {
      issues.push({ code: L.NOT_PINNED, hand, message: `the ${hand === "MAIN_HAND" ? "Main-hand" : "Off-hand"} selection is not a coherent Weapon pinned by this Character's Release (exact Entity and EntityVersion)`, source: null });
      return null;
    }
    if (weapon.payload.profileKind === "UNARMED") {
      issues.push({ code: L.NOT_EQUIPPABLE, hand, message: "Unarmed is intrinsic to the Character's Martial rank; it is never equipped in a hand (§56)", source: weapon.ref });
      return null;
    }
    const h = weapon.payload.handedness;
    if (h === null) {
      issues.push({ code: L.NOT_EQUIPPABLE, hand, message: `${weapon.ref.canonicalKey} has no authored handedness, so the hands it occupies are unknown; it is never equipped by guess`, source: weapon.ref });
      return null;
    }
    let grip: WeaponGrip;
    if (hand === "MAIN_HAND" && h === "VERSATILE") {
      if (loadout.mainHandGrip === null) {
        issues.push({ code: L.GRIP, hand, message: "a Versatile Weapon's grip is explicit: ONE_HANDED or TWO_HANDED (§74)", source: weapon.ref });
        return null;
      }
      grip = loadout.mainHandGrip;
    } else if (hand === "MAIN_HAND") {
      if (loadout.mainHandGrip !== null) issues.push({ code: L.GRIP, hand, message: "only a Versatile Weapon takes an explicit grip", source: weapon.ref });
      grip = h === "TWO_HANDED" ? "TWO_HANDED" : "ONE_HANDED";
    } else {
      // The Off-hand holds a one-handed grip only: a Two-Handed Weapon is never an Off-hand Weapon (§73).
      if (h === "TWO_HANDED") issues.push({ code: L.HANDS, hand, message: "a Two-Handed Weapon occupies both hands; it is held in the Main hand", source: weapon.ref });
      grip = "ONE_HANDED";
    }
    const requirements = checkWeaponRequirements(index, profile, weapon.payload.requirements, weapon.ref);
    for (const r of requirements) {
      if (r.satisfied === false) issues.push({ code: L.REQUIREMENT, hand, message: `${weapon.ref.canonicalKey} requires ${r.required} (the Character has ${r.actual})`, source: weapon.ref });
      if (r.satisfied === null) issues.push({ code: L.UNRESOLVED, hand, message: `${weapon.ref.canonicalKey}: ${r.requirementKey} could not be evaluated`, source: weapon.ref });
    }
    return { hand, weapon, grip, occupies: grip === "TWO_HANDED" ? ["MAIN_HAND", "OFF_HAND"] : [hand], requirements };
  };
  const mainHand = equip("MAIN_HAND", loadout.mainHand);
  const offHand = equip("OFF_HAND", loadout.offHand);
  if (mainHand !== null && offHand !== null && mainHand.occupies.includes("OFF_HAND")) issues.push({ code: L.HANDS, hand: "OFF_HAND", message: `${mainHand.weapon.ref.canonicalKey} is held two-handed and occupies both hands; the Off-hand must be empty (§73)`, source: offHand.weapon.ref });
  if (loadout.mainHand === null && loadout.mainHandGrip !== null) issues.push({ code: L.GRIP, hand: "MAIN_HAND", message: "an empty Main hand has no grip", source: null });
  return deepFreeze({ status: issues.length === 0 ? "VALID" : "INVALID", issues, mainHand, offHand });
}

/**
 * The additive equipment context of the ONE Character profile (§66–§67): the exact equipped Weapons and the modifiers
 * they grant while equipped. Null for an empty loadout — the profile is then exactly the unequipped profile.
 */
export interface CharacterEquipmentContext {
  readonly equipped: readonly { readonly hand: WeaponHand; readonly definition: ProwessDefinitionRef; readonly modifiers: readonly EquippedModifier[] }[];
}

export function equipmentContextOf(loadout: ResolvedWeaponLoadout): CharacterEquipmentContext | null {
  if (loadout.status !== "VALID") return null;
  const equipped = [loadout.mainHand, loadout.offHand].flatMap((e) => (e === null ? [] : [{ hand: e.hand, definition: e.weapon.ref, modifiers: e.weapon.payload.equippedModifiers }]));
  return equipped.length === 0 ? null : deepFreeze({ equipped });
}
