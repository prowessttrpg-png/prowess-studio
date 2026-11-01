import type { JsonObject } from "@prowess/model";
import { deepFreeze } from "../internal/plain-data.js";
import { Problems, finish, type ProwessOutcome } from "../internal/problems.js";
import type { ComponentUse } from "../construction/composition.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { readFoundationProfile, type AttackFoundationProfile } from "../definition/authored-ability-payload.js";
import { readDefinitionPayload } from "../definition/payload.js";
import type { ResolvedTraitUse, WeaponLibraryIndex } from "./catalog.js";
import type { CharacterAttack } from "./library.js";
import type { RequirementCheck } from "./loadout.js";

/**
 * The ONE authoritative adapter from a Character Weapon Attack projection to the exact M5-WO11 Attack contract
 * (PAS-10 M6-WO6 §83–§85). It builds the M5 `rules.attack` foundation data and validates it with M5's OWN reader
 * (`readFoundationProfile`) — there is no second Maneuver Attack model. The binding keeps the exact Weapon + Attack
 * identity, the Move's own AP / MP, the selected damage profile, Power (or STATIC: none), properties, requirements and
 * provenance; Maneuver modifications layer on top of it and never replace it. The inherent weapon requirement stays
 * M5-WO11's (automatic; no Condition slot, no discount).
 *
 * M5-WO11 Attacks resolve by Attack Roll at a weapon range. An Attack this contract cannot express without inventing a
 * fact — a Saving Throw (Auto) Attack, an area (Line / Cone) Attack, a deferred resolution, or a failed damage preview —
 * is refused with a structured reason; it is never coerced.
 */

export const WEAPON_BRIDGE_ERROR_CODES = deepFreeze({
  NOT_REPRESENTABLE: "PROWESS_WEAPON_BRIDGE.NOT_REPRESENTABLE",
  UNKNOWN_PROFILE: "PROWESS_WEAPON_BRIDGE.UNKNOWN_DAMAGE_PROFILE",
  CONTRACT: "PROWESS_WEAPON_BRIDGE.M5_CONTRACT",
} as const);
const B = WEAPON_BRIDGE_ERROR_CODES;

export interface WeaponAttackBinding {
  readonly weapon: ProwessDefinitionRef;
  readonly attack: ProwessDefinitionRef;
  readonly attackKey: string;
  readonly moveKey: string;
  readonly apCost: number;
  readonly mpCost: number;
  readonly damageProfile: { readonly profileKey: string; readonly damageType: string; readonly base: string; readonly rolled: string };
  readonly scaling: "POWER" | "STATIC";
  /** The effective Power the Attack carries (null for STATIC — never a fake value). */
  readonly power: number | null;
  readonly weaponProperties: readonly ResolvedTraitUse[];
  readonly moveProperties: readonly ResolvedTraitUse[];
  readonly requirements: readonly RequirementCheck[];
  readonly provenance: CharacterAttack["provenance"];
  /** The exact M5-WO11 `rules.attack` foundation data, as validated by M5's reader. */
  readonly foundation: AttackFoundationProfile;
  readonly rulesAttack: JsonObject;
  /**
   * The complete MANEUVER_FOUNDATION payload (validated by M5's own Definition reader): the Move's OWN AP / MP as the
   * foundation's FIXED cost contributions and `rules.attack` above. Authoring a foundation from it changes nothing.
   */
  readonly foundationPayload: JsonObject;
}

/** Binds one Character Weapon Attack (one selected damage profile) to the M5-WO11 Attack contract. */
export function bindWeaponAttackToManeuver(request: { readonly index: WeaponLibraryIndex; readonly attack: CharacterAttack; readonly damageProfileKey: string; readonly targeting: ComponentUse }): ProwessOutcome<WeaponAttackBinding> {
  const p = new Problems();
  const { attack, index } = request;
  const fail = (code: string, message: string) => {
    p.add(code, [], message);
    return finish(p, () => null as never);
  };
  const preview = attack.damage.find((d) => d.profileKey === request.damageProfileKey);
  if (preview === undefined) return fail(B.UNKNOWN_PROFILE, `${attack.attack.canonicalKey} has no damage profile ${request.damageProfileKey}`);
  if (attack.resolution.mode !== "ATTACK_ROLL") return fail(B.NOT_REPRESENTABLE, `${attack.attack.canonicalKey} resolves by ${attack.resolution.mode}; the M5-WO11 Attack contract is an Attack Roll`);
  if (attack.range.mode === "LINE" || attack.range.mode === "CONE") return fail(B.NOT_REPRESENTABLE, `${attack.attack.canonicalKey} is a ${attack.range.mode} area Attack; the M5-WO11 Attack contract is a single weapon range`);
  if (preview.status !== "PREVIEWED") return fail(B.NOT_REPRESENTABLE, `${attack.attack.canonicalKey}: ${preview.reason ?? "the damage preview failed closed"}`);
  const feet = attack.range.mode === "RANGED_MULTIPLIER" ? attack.range.rangeFeet : attack.range.reachFeet;
  if (feet === null || index.attackRollStat === null) return fail(B.NOT_REPRESENTABLE, `${attack.attack.canonicalKey}: the range or the Release's Attack Roll Stat could not be read`);
  const rolledBase = preview.gripAdjusted ?? preview.base;
  const damage =
    preview.scaling === "STATIC" || preview.power === null
      ? { kind: "WEAPON", scaling: "STATIC", weaponKey: attack.weapon.canonicalKey, baseDice: rolledBase.expression, power: null, stat: null, enchantments: [] }
      : { kind: "WEAPON", weaponKey: attack.weapon.canonicalKey, baseDice: rolledBase.expression, power: preview.power.adjusted, stat: preview.power.scalingStat, enchantments: [] };
  const rulesAttack = {
    category: attack.range.mode === "RANGED_MULTIPLIER" ? "RANGED" : "MELEE",
    targeting: request.targeting,
    range: { kind: "WEAPON_RANGE", feet },
    resolution: { mode: "ATTACK_ROLL", stat: index.attackRollStat },
    damage,
  } as unknown as JsonObject;
  const foundation = readFoundationProfile({ attack: rulesAttack }, ["rules"], p);
  if (foundation === null || foundation.resolution.mode !== "ATTACK_ROLL") return fail(B.CONTRACT, "the bound Attack does not satisfy the M5-WO11 Attack contract");
  const costs = [
    { contributionKey: "foundation.ap", currency: "AP", data: { kind: "FIXED", amount: attack.apCost } },
    ...(attack.mpCost === 0 ? [] : [{ contributionKey: "foundation.mp", currency: "MP", data: { kind: "FIXED", amount: attack.mpCost } }]),
  ];
  const foundationPayload = readDefinitionPayload("MANEUVER_FOUNDATION", "FOUNDATION", { keywords: [], parameters: {}, compatibility: [], costContributions: costs, rules: { attack: rulesAttack }, foundationKind: "WEAPON_ATTACK" }, ["foundation"], p);
  if (foundationPayload === null) return fail(B.CONTRACT, "the bound Attack is not a valid M5 MANEUVER_FOUNDATION payload");
  return finish(p, () =>
    deepFreeze({
      weapon: attack.weapon,
      attack: attack.attack,
      attackKey: attack.attackKey,
      moveKey: attack.moveKey,
      apCost: attack.apCost,
      mpCost: attack.mpCost,
      damageProfile: { profileKey: preview.profileKey, damageType: preview.damageType, base: preview.base.expression, rolled: rolledBase.expression },
      scaling: preview.scaling,
      power: preview.power?.adjusted ?? null,
      weaponProperties: attack.weaponProperties,
      moveProperties: attack.moveProperties,
      requirements: attack.requirements,
      provenance: attack.provenance,
      foundation: foundation as AttackFoundationProfile,
      rulesAttack,
      foundationPayload,
    }),
  );
}
