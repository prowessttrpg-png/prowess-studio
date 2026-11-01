import { describe, expect, it } from "vitest";
import { DEFINITION_ERROR_CODES as C } from "./definition/codes.js";
import { readDefinitionPayload } from "./definition/payload.js";
import { Problems } from "./internal/problems.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "./vocabulary/families.js";
import { WEAPON_DEFINITIONS, resolveContentRefs } from "./testing/weapon-fixtures";
import { uuid } from "./testing/fixtures.js";
import type { ProwessDefinitionRef } from "./definition/envelope.js";

/**
 * PAS-10 M6-WO6 §8–§18, §21–§24, §28–§35 — the version-1 WEAPON / ATTACK / EQUIPMENT_TRAIT payload contracts: structure,
 * closed vocabularies and exact references only (no arithmetic, no defaults). Invariants: M6-I058 · M6-I059 · M6-I060 ·
 * M6-I061 · M6-I063 · M6-I065 · M6-I073.
 */
const fakeRef = (key: string): ProwessDefinitionRef => {
  const d = WEAPON_DEFINITIONS.find((x) => x.canonicalKey === key);
  const kind = (d?.definitionKind ?? "ATTACK") as ProwessDefinitionKind;
  const i = WEAPON_DEFINITIONS.findIndex((x) => x.canonicalKey === key);
  return { entityId: uuid(40000 + i), entityVersionId: uuid(41000 + i), canonicalKey: key, definitionKind: kind, systemFamily: PROWESS_DEFINITION_KINDS[kind].family } as unknown as ProwessDefinitionRef;
};
const content = (key: string) => resolveContentRefs(JSON.parse(JSON.stringify(WEAPON_DEFINITIONS.find((d) => d.canonicalKey === key)!.payload)), fakeRef) as Record<string, unknown>;
const read = (kind: ProwessDefinitionKind, payload: unknown) => {
  const p = new Problems();
  const out = readDefinitionPayload(kind, null, payload, [], p);
  return { out, messages: p.list.map((x) => x.message).join(" | "), codes: p.list.map((x) => x.code) };
};

describe("every baseline Definition reads under its own v1 contract", () => {
  it.each(WEAPON_DEFINITIONS.map((d) => [d.canonicalKey, d.definitionKind] as const))("%s (%s)", (key, kind) => {
    const r = read(kind, content(key));
    expect(r.messages).toBe("");
    expect(r.out).not.toBeNull();
  });
});

describe("WEAPON v1", () => {
  const blade = () => content("weapon.long_blade");
  const rifle = () => content("weapon.rifle");
  it("M6-I060 the scaling model is mandatory and closed — never inferred from Power", () => {
    const { scalingModel: _omit, ...rest } = blade();
    void _omit;
    expect(read("WEAPON", rest).messages).toMatch(/"scalingModel" is required/);
    expect(read("WEAPON", { ...blade(), scalingModel: "DYNAMIC" }).out).toBeNull();
  });
  it("M6-I061 a STATIC Weapon has no Power (never a fake 0) and no Power scaling rule", () => {
    expect(read("WEAPON", { ...rifle(), power: 0 }).messages).toMatch(/STATIC Weapon has no Power/);
    expect(read("WEAPON", { ...rifle(), power: 6 }).messages).toMatch(/STATIC Weapon has no Power/);
    expect(read("WEAPON", { ...rifle(), scalingRule: blade().scalingRule }).messages).toMatch(/no Power scaling rule/);
  });
  it("a POWER Weapon authors Power and its exact scaling rule; M6-I063 an authored Power below 2 is refused", () => {
    expect(read("WEAPON", { ...blade(), power: null }).messages).toMatch(/authors its Power/);
    expect(read("WEAPON", { ...blade(), scalingRule: null }).messages).toMatch(/exact Power scaling rule/);
    expect(read("WEAPON", { ...blade(), power: 1 }).messages).toMatch(/Power is at least 2/);
  });
  it("M6-I068 a VERSATILE Weapon (and only one) names its Versatile die-step rule", () => {
    expect(read("WEAPON", { ...blade(), versatileRule: null }).messages).toMatch(/Versatile die-step rule/);
    expect(read("WEAPON", { ...rifle(), versatileRule: blade().versatileRule }).messages).toMatch(/Versatile die-step rule/);
  });
  it("closed category / handedness vocabularies; only Unarmed leaves its category unauthored and names a Martial rank", () => {
    expect(read("WEAPON", { ...blade(), category: "MEDIUM" }).out).toBeNull();
    expect(read("WEAPON", { ...blade(), handedness: "THREE_HANDED" }).out).toBeNull();
    expect(read("WEAPON", { ...blade(), category: null }).messages).toMatch(/only the intrinsic Unarmed profile/);
    expect(read("WEAPON", { ...blade(), martialRankKey: "MASTER" }).messages).toMatch(/only an Unarmed profile names a Martial rank/);
    expect(read("WEAPON", { ...content("weapon.unarmed_master"), martialRankKey: null }).messages).toMatch(/names the exact Martial rank/);
  });
  it("M6-I057 / M6-I065 the Moveset is exact ATTACK references — unique, of the right kind, never names", () => {
    const m = blade().moveset as Record<string, unknown>[];
    expect(read("WEAPON", { ...blade(), moveset: [m[0], m[0]] }).messages).toMatch(/Moveset Attacks are unique/);
    expect(read("WEAPON", { ...blade(), moveset: [{ ...m[0], definitionKind: "WEAPON", systemFamily: "EQUIPMENT" }] }).messages).toMatch(/exact ATTACK reference/);
    expect(read("WEAPON", { ...blade(), moveset: ["Slash"] }).out).toBeNull();
    expect(read("WEAPON", { ...blade(), moveset: [] }).out).toBeNull();
  });
  it("equipped modifiers target only Armor / Dodge / Movement and never zero; granted features are never executable", () => {
    const shield = content("weapon.heavy_shield");
    expect(read("WEAPON", { ...shield, equippedModifiers: [{ modifierKey: "x", target: "MAXIMUM_HP", value: 3 }] }).out).toBeNull();
    expect(read("WEAPON", { ...shield, equippedModifiers: [{ modifierKey: "x", target: "ARMOR", value: 0 }] }).out).toBeNull();
    expect(read("WEAPON", { ...shield, grantedFeatures: [{ featureKey: "FULL_GUARD", executionStatus: "EXECUTABLE", summary: "x" }] }).out).toBeNull();
  });
  it("unknown fields (an ammo count, an inventory owner, a derived total) are refused", () => {
    for (const extra of [{ roundsLoaded: 6 }, { reserveAmmo: 30 }, { ownerCharacterId: uuid(1) }, { armorTotal: 5 }]) expect(read("WEAPON", { ...rifle(), ...extra }).out, JSON.stringify(extra)).toBeNull();
  });
});

describe("ATTACK v1", () => {
  const stab = () => content("attack.long_blade.stab");
  it("M6-I058 AP and MP are authored non-negative integers on the Move itself", () => {
    expect(read("ATTACK", { ...stab(), apCost: -1 }).out).toBeNull();
    expect(read("ATTACK", { ...stab(), apCost: 1.5 }).out).toBeNull();
    const { apCost: _omit, ...rest } = stab();
    void _omit;
    expect(read("ATTACK", rest).messages).toMatch(/"apCost" is required/);
  });
  it("damage profiles are structured dice (count × sides) with closed types; selectable options are unique", () => {
    expect(read("ATTACK", { ...stab(), damageProfiles: [{ profileKey: "p", dice: "1d6", damageType: "PIERCING" }] }).out).toBeNull();
    expect(read("ATTACK", { ...stab(), damageProfiles: [{ profileKey: "p", dice: { count: 1, sides: 7 }, damageType: "PIERCING" }] }).out).toBeNull();
    expect(read("ATTACK", { ...stab(), damageProfiles: [{ profileKey: "p", dice: { count: 0, sides: 6 }, damageType: "PIERCING" }] }).out).toBeNull();
    expect(read("ATTACK", { ...stab(), damageProfiles: [] }).out).toBeNull();
    const dup = { profileKey: "p", dice: { count: 1, sides: 6 }, damageType: "PIERCING" };
    expect(read("ATTACK", { ...stab(), damageProfiles: [dup, dup] }).messages).toMatch(/damage profile keys are unique/);
    expect(read("ATTACK", { ...stab(), damageProfiles: [{ profileKey: "p", dice: { count: 3, sides: 8 }, damageType: "FIRE" }] }).out).not.toBeNull();
  });
  it("targeting is structured (never range text) and resolution modes are explicit", () => {
    expect(read("ATTACK", { ...stab(), targeting: "30 ft × PER" }).out).toBeNull();
    expect(read("ATTACK", { ...stab(), targeting: { mode: "RANGED_MULTIPLIER", stat: "PER", feetPerPoint: 30 } }).messages).toMatch(/"area" is required/);
    expect(read("ATTACK", { ...stab(), targeting: { mode: "LINE", lengthFeet: 10, reachFeet: 5 } }).messages).toMatch(/LINE targeting has no reachFeet/);
    expect(read("ATTACK", { ...stab(), resolution: { mode: "SAVING_THROW", savingThrowStat: "AGI", dc: "ATTACKER_CHARACTER_DC", onFailure: "FULL" } }).out).toBeNull();
    expect(read("ATTACK", { ...stab(), resolution: { mode: "DEFERRED", reason: " " } }).out).toBeNull();
    expect(read("ATTACK", { ...stab(), resolution: { mode: "ATTACK_ROLL", onMiss: "HALF", savingThrowStat: "AGI" } }).out).toBeNull();
  });
  it("M6-I059 Move properties are exact Equipment Trait uses with integer parameters — never names", () => {
    expect(read("ATTACK", { ...stab(), moveProperties: ["Pierce 1"] }).out).toBeNull();
    const p = (stab().moveProperties as Record<string, unknown>[])[0]!;
    expect(read("ATTACK", { ...stab(), moveProperties: [{ ...p, parameters: { amount: "1" } }] }).out).toBeNull();
    expect(read("ATTACK", { ...stab(), moveProperties: [p, p] }).messages).toMatch(/one per exact Equipment Trait/);
  });
});

describe("EQUIPMENT_TRAIT v1 (§16–§19)", () => {
  const pierce = () => content("equipment.trait.pierce");
  const recoil = () => content("equipment.trait.recoil");
  it("EXECUTABLE ⇔ a complete contract: an executable trait without one, or a reference-only trait with one, is refused", () => {
    expect(read("EQUIPMENT_TRAIT", { ...pierce(), contract: null }).messages).toMatch(/one complete contract/);
    expect(read("EQUIPMENT_TRAIT", { ...recoil(), contract: pierce().contract }).messages).toMatch(/only an EXECUTABLE trait carries a contract/);
    expect(read("EQUIPMENT_TRAIT", { ...recoil(), executionStatus: "EXECUTABLE", contract: { kind: "RECOIL_PENALTY", penalty: 1 } }).out).toBeNull();
  });
  it("a Pierce contract names its declared, required amount parameter", () => {
    expect(read("EQUIPMENT_TRAIT", { ...pierce(), parameters: [] }).messages).toMatch(/declared, required parameter/);
  });
  it("rule Formulas are M4 programs reading only their declared variables", () => {
    const scaling = content("equipment.trait.power_scaling");
    const c = scaling.contract as Record<string, unknown>;
    expect(read("EQUIPMENT_TRAIT", { ...scaling, contract: { ...c, multiplier: { expression: "1 + floor(stat_score / power) + level", variables: ["stat_score", "power", "minimum_power"] } } }).codes).toContain(C.INVALID_FORMULA);
    expect(read("EQUIPMENT_TRAIT", { ...scaling, contract: { ...c, multiplier: { expression: "1 + floor(", variables: ["stat_score", "power", "minimum_power"] } } }).codes).toContain(C.INVALID_FORMULA);
    const dual = content("equipment.trait.dual_wield");
    const d = dual.contract as Record<string, unknown>;
    expect(read("EQUIPMENT_TRAIT", { ...dual, contract: { ...d, sequenceCost: { expression: "ap_a + ap_b", variables: ["ap_a", "ap_b"] } } }).out).not.toBeNull(); // structure only — the baseline content pins max(ap_a, ap_b)
  });
  it("the Versatile die step is authored BEFORE Power and multi-die fails closed — any other choice is refused", () => {
    const v = content("equipment.trait.versatile");
    const c = v.contract as Record<string, unknown>;
    expect(read("EQUIPMENT_TRAIT", { ...v, contract: { ...c, order: "AFTER_POWER" } }).out).toBeNull();
    expect(read("EQUIPMENT_TRAIT", { ...v, contract: { ...c, multiDie: "STEP_EACH_DIE" } }).out).toBeNull();
  });
  it("the summary is inert text: a legacy term in it (Evasion) is refused as canonical content", () => {
    expect(read("EQUIPMENT_TRAIT", { ...recoil(), summary: "Evasion" }).codes).toContain(C.LEGACY_TERM_AS_CANONICAL);
  });
});
