import type { JsonObject } from "@prowess/model";
import { validateFormulaProgram } from "@prowess/rules";
import type { PathSegment } from "../internal/plain-data.js";
import { Problems, isExactLabel, isToken, own, readEnum, readRecord, readSafeInteger } from "../internal/problems.js";
import { PROWESS_STATS, type ProwessStat } from "../vocabulary/core.js";
import {
  ATTACK_AREA_SHAPES,
  ATTACK_SCALINGS,
  ATTACK_TARGETING_MODES,
  DAMAGE_DIE_SIDES,
  DAMAGE_OUTCOMES,
  DAMAGE_TYPES,
  EQUIPMENT_MODIFIER_TARGETS,
  EQUIPMENT_ROLES,
  POST_HIT_FAILURE_KINDS,
  SAVING_THROW_DCS,
  TRAIT_CONTRACT_KINDS,
  TRAIT_EXECUTION_STATUSES,
  TRAIT_PARAMETER_KINDS,
  TRAIT_USE_SITES,
  WEAPON_CATEGORIES,
  WEAPON_HANDEDNESS,
  WEAPON_PROFILE_KINDS,
  WEAPON_REQUIREMENT_KINDS,
  WEAPON_SCALING_MODELS,
  type AttackScaling,
  type DamageOutcome,
  type DamageType,
  type EquipmentModifierTarget,
  type EquipmentRole,
  type SavingThrowDc,
  type TraitContractKind,
  type TraitExecutionStatus,
  type TraitParameterKind,
  type TraitUseSite,
  type WeaponCategory,
  type WeaponHandedness,
  type WeaponProfileKind,
  type WeaponScalingModel,
} from "../vocabulary/equipment.js";
import { DEFINITION_ERROR_CODES as C } from "./codes.js";
import { readDefinitionRef, type ProwessDefinitionRef } from "./envelope.js";

/**
 * Version-1 payload contracts of the EQUIPMENT-family Definition kinds of PAS-10 M6-WO6: WEAPON, ATTACK and
 * EQUIPMENT_TRAIT. Like every M5 / M6 reader they check structure, closed vocabularies and exact references only — no
 * arithmetic, no defaults and no cross-Definition legality. Whether a Weapon's Moveset resolves inside one exact Release,
 * whether every Attack belongs to the Weapon's family and whether a HYBRID Weapon's Attacks each declare their scaling
 * is checked against the exact bundle by equipment/catalog.ts (fail closed).
 *
 * Identity is exact: a Moveset is an ordered list of exact ATTACK references; a property use names its exact
 * EQUIPMENT_TRAIT. A move key or display name is never identity (§13).
 */

// ---- Shared ----------------------------------------------------------------------------------------------------------

/** Where an Equipment Definition came from: Core Playtest locators, M5 conflicts and the designer rulings it applies. */
export interface EquipmentDefinitionSource {
  readonly locators: readonly string[];
  readonly conflicts: readonly string[];
  /** Explicit designer authority, e.g. "M6-WO6 §103" (the expanded catalog is a designer-approved addition, §3). */
  readonly designerAuthority: readonly string[];
}

/** One structured requirement (§60). Evaluated through the M4 Requirement engine — never parsed from text. */
export type WeaponRequirement =
  | { readonly requirementKey: string; readonly kind: "MARTIAL_RANK_AT_LEAST"; readonly minimumRank: string }
  | { readonly requirementKey: string; readonly kind: "STAT_AT_LEAST"; readonly stat: ProwessStat; readonly minimum: number };

/** A use of an exact Equipment Trait with its explicit parameters (§17). */
export interface TraitUse {
  readonly traitRef: ProwessDefinitionRef;
  readonly parameters: Readonly<Record<string, number>>;
}

// ---- EQUIPMENT_TRAIT ---------------------------------------------------------------------------------------------------

export interface TraitParameter {
  readonly parameterKey: string;
  readonly kind: TraitParameterKind;
  readonly required: boolean;
}

/** The complete machine-readable contracts WO6 executes (§19). Nothing else is ever executed. */
export type TraitContract =
  | { readonly kind: "CLOSE_QUARTERS"; readonly usableWhileGrappled: boolean; readonly usableInTightSpaces: boolean }
  | { readonly kind: "REACH"; readonly reachFeet: number }
  | { readonly kind: "ARMOR_PIERCE"; readonly amountParameter: string }
  | {
      readonly kind: "POST_HIT_SAVE";
      readonly savingThrowStats: readonly ProwessStat[];
      readonly dc: SavingThrowDc;
      readonly onFailure: { readonly kind: "APPLY_CONDITION"; readonly conditionKey: string } | { readonly kind: "PULL"; readonly feet: number; readonly destination: "TOWARD_ATTACKER_OR_ADJACENT" };
    }
  | { readonly kind: "DIE_STEP"; readonly grip: "TWO_HANDED"; readonly steps: readonly { readonly fromSides: number; readonly toSides: number }[]; readonly order: "BEFORE_POWER"; readonly multiDie: "FAIL_CLOSED" }
  | { readonly kind: "SAVE_AREA_FIRE"; readonly savingThrowStat: ProwessStat; readonly dc: SavingThrowDc; readonly onFailure: DamageOutcome; readonly onSuccess: DamageOutcome }
  | { readonly kind: "AUTHORED_BURST"; readonly accuracyModifier: number; readonly damageIsFinal: true }
  | {
      readonly kind: "POWER_SCALING";
      readonly stat: ProwessStat;
      readonly minimumPower: number;
      readonly multiplier: FormulaSlot;
      readonly diceCount: FormulaSlot;
    }
  | {
      readonly kind: "DUAL_WIELD";
      readonly rows: readonly { readonly category: WeaponCategory; readonly minimumMartialRank: string; readonly minimumStat: { readonly stat: ProwessStat; readonly minimum: number } | null; readonly powerAdjustment: number }[];
      readonly repeatPowerIncrement: number;
      readonly sequenceCost: FormulaSlot;
      readonly effectivePower: FormulaSlot;
    };

/** An M4 Formula reading only its declared variables. */
export interface FormulaSlot {
  readonly expression: string;
  readonly variables: readonly string[];
}

export interface EquipmentTraitPayload {
  readonly traitKey: string;
  readonly useSites: readonly TraitUseSite[];
  readonly executionStatus: TraitExecutionStatus;
  readonly parameters: readonly TraitParameter[];
  /** Present exactly when EXECUTABLE (§18). */
  readonly contract: TraitContract | null;
  /** Inert reference text; never parsed for behavior (§42). */
  readonly summary: string;
  readonly source: EquipmentDefinitionSource;
}

// ---- ATTACK ------------------------------------------------------------------------------------------------------------

export interface DamageProfile {
  readonly profileKey: string;
  readonly dice: { readonly count: number; readonly sides: number };
  readonly damageType: DamageType;
}

export type AttackResolution =
  | { readonly mode: "ATTACK_ROLL"; readonly onMiss: DamageOutcome }
  | { readonly mode: "SAVING_THROW"; readonly savingThrowStat: ProwessStat; readonly dc: SavingThrowDc; readonly onFailure: DamageOutcome; readonly onSuccess: DamageOutcome }
  /** Canon does not state how this Move resolves; it is displayed but never resolved (§3.5: no inference). */
  | { readonly mode: "DEFERRED"; readonly reason: string };

export type AttackTargeting =
  | { readonly mode: "MELEE"; readonly reachFeet: number }
  | { readonly mode: "CLOSE"; readonly reachFeet: number }
  | { readonly mode: "RANGED_MULTIPLIER"; readonly stat: ProwessStat; readonly feetPerPoint: number; readonly area: { readonly shape: "BLAST"; readonly radiusFeet: number } | null }
  | { readonly mode: "LINE"; readonly lengthFeet: number }
  | { readonly mode: "CONE"; readonly lengthFeet: number };

export interface AttackDefinitionPayload {
  readonly moveKey: string;
  readonly weaponFamilyKey: string;
  readonly apCost: number;
  readonly mpCost: number;
  /** One or more authored, selectable damage options (§23). Never auto-selected. */
  readonly damageProfiles: readonly DamageProfile[];
  /** Explicit per-Attack scaling — required on a HYBRID Weapon's Attacks, absent (null) otherwise (§29). */
  readonly scaling: AttackScaling | null;
  readonly resolution: AttackResolution;
  readonly targeting: AttackTargeting;
  readonly moveProperties: readonly TraitUse[];
  readonly accuracyModifier: number;
  readonly requirements: readonly WeaponRequirement[];
  readonly source: EquipmentDefinitionSource;
}

// ---- WEAPON ------------------------------------------------------------------------------------------------------------

export interface EquippedModifier {
  readonly modifierKey: string;
  readonly target: EquipmentModifierTarget;
  readonly value: number;
}

export interface GrantedFeature {
  readonly featureKey: string;
  readonly executionStatus: Exclude<TraitExecutionStatus, "EXECUTABLE">;
  readonly summary: string;
}

export interface WeaponDefinitionPayload {
  readonly familyKey: string;
  readonly profileKind: WeaponProfileKind;
  /** WEAPON or SHIELD — explicit (§61). */
  readonly equipmentRole: EquipmentRole;
  /** The exact Martial rank this intrinsic Unarmed profile belongs to (UNARMED only). */
  readonly martialRankKey: string | null;
  /** Null only where canon authors no category (the intrinsic Unarmed profiles) — never guessed. */
  readonly category: WeaponCategory | null;
  /** Null where canon authors no handedness (§107, §118, §136, §137): the profile is shown but never equipped. */
  readonly handedness: WeaponHandedness | null;
  readonly scalingModel: WeaponScalingModel;
  /** Absent (null) on a STATIC Weapon — never a fake 0 (§28). */
  readonly power: number | null;
  /** The exact POWER_SCALING rule a Power-scaled Weapon uses (null on a STATIC Weapon). */
  readonly scalingRule: TraitUse | null;
  /** The exact Versatile die-step rule (VERSATILE Weapons only). */
  readonly versatileRule: TraitUse | null;
  readonly exampleForms: readonly string[];
  readonly weaponProperties: readonly TraitUse[];
  /** Ordered exact ATTACK references (§15). */
  readonly moveset: readonly ProwessDefinitionRef[];
  readonly requirements: readonly WeaponRequirement[];
  readonly equippedModifiers: readonly EquippedModifier[];
  readonly grantedFeatures: readonly GrantedFeature[];
  readonly source: EquipmentDefinitionSource;
}

export const EQUIPMENT_PAYLOAD_KINDS = Object.freeze(["WEAPON", "ATTACK", "EQUIPMENT_TRAIT"] as const);
export type EquipmentPayloadKind = (typeof EQUIPMENT_PAYLOAD_KINDS)[number];
export const isEquipmentPayloadKind = (kind: string): kind is EquipmentPayloadKind => (EQUIPMENT_PAYLOAD_KINDS as readonly string[]).includes(kind);

// ---- Readers -----------------------------------------------------------------------------------------------------------

const E = C.INVALID_PAYLOAD;
const LOWER_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const LOCATOR = /^s[0-9]+$/;
const CONFLICT = /^M[0-9]+-SC-[0-9]{3}$/;
const AUTHORITY = /^M[0-9]+-WO[0-9]+ §[0-9]+$/;
/** Input validation only: these are the smallest legal authored values, not game rules. */
const NONE = 0;
const ONE = 1;
const MINIMUM_AUTHORED_POWER = 2;

function readInteger(value: unknown, at: readonly PathSegment[], p: Problems, what: string, minimum: number | null): number | null {
  const n = readSafeInteger(value, at, p, E, what);
  if (n !== null && minimum !== null && n < minimum) {
    p.add(E, at, `${what} is at least ${minimum}`);
    return null;
  }
  return n;
}

function readSides(value: unknown, at: readonly PathSegment[], p: Problems): number | null {
  if (typeof value !== "number" || !(DAMAGE_DIE_SIDES as readonly number[]).includes(value)) {
    p.add(E, at, `die sides are one of ${DAMAGE_DIE_SIDES.join(", ")}`);
    return null;
  }
  return value;
}

function readText(value: unknown, at: readonly PathSegment[], p: Problems, what: string): string | null {
  if (typeof value !== "string") {
    p.add(E, at, `${what} is text`);
    return null;
  }
  return value;
}

function readTokenField(value: unknown, at: readonly PathSegment[], p: Problems, what: string): string | null {
  if (!isToken(value)) {
    p.add(E, at, `${what} is a SCREAMING_SNAKE token`);
    return null;
  }
  return value;
}

function readList<T>(value: unknown, at: readonly PathSegment[], p: Problems, what: string, read: (v: unknown, at: readonly PathSegment[]) => T | null, nonEmpty = false): T[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    p.add(E, at, `${what} is ${nonEmpty ? "a non-empty" : "an"} array`);
    return [];
  }
  const out: T[] = [];
  value.forEach((v: unknown, i: number) => {
    const r = read(v, [...at, i]);
    if (r !== null) out.push(r);
  });
  return out;
}

function unique(keys: readonly string[], at: readonly PathSegment[], p: Problems, what: string): void {
  if (new Set(keys).size !== keys.length) p.add(E, at, `${what} are unique`);
}

export function readEquipmentSource(value: unknown, at: readonly PathSegment[], p: Problems): EquipmentDefinitionSource | null {
  const fields = ["locators", "conflicts", "designerAuthority"];
  const r = readRecord(value, at, p, E, fields, fields);
  if (r === null) return null;
  const list = (field: string, pattern: RegExp, what: string): string[] | null => {
    const v = own(r, field);
    if (!Array.isArray(v) || !v.every((x: unknown) => typeof x === "string" && pattern.test(x)) || new Set(v).size !== v.length) {
      p.add(E, [...at, field], `${field} is a duplicate-free array of ${what}`);
      return null;
    }
    return [...(v as string[])].sort();
  };
  const locators = list("locators", LOCATOR, "Core Playtest section keys (sNNN)");
  const conflicts = list("conflicts", CONFLICT, "source-conflict keys");
  const designerAuthority = list("designerAuthority", AUTHORITY, "Work Order section citations (M6-WO6 §NNN)");
  return locators === null || conflicts === null || designerAuthority === null ? null : { locators, conflicts, designerAuthority };
}

export function readWeaponRequirement(value: unknown, at: readonly PathSegment[], p: Problems): WeaponRequirement | null {
  const r = readRecord(value, at, p, E, ["requirementKey", "kind", "minimumRank", "stat", "minimum"], ["requirementKey", "kind"]);
  if (r === null) return null;
  const before = p.count;
  const requirementKey = own(r, "requirementKey");
  if (typeof requirementKey !== "string" || !LOWER_KEY.test(requirementKey)) p.add(E, [...at, "requirementKey"], "requirementKey is a lowercase key");
  const kind = readEnum(own(r, "kind"), WEAPON_REQUIREMENT_KINDS, [...at, "kind"], p, E, "requirement kind");
  if (kind === "MARTIAL_RANK_AT_LEAST") {
    if (own(r, "stat") !== undefined || own(r, "minimum") !== undefined) p.add(E, at, "a Martial rank requirement names only minimumRank");
    const minimumRank = readTokenField(own(r, "minimumRank"), [...at, "minimumRank"], p, "minimumRank");
    return p.count > before || minimumRank === null ? null : { requirementKey: requirementKey as string, kind, minimumRank };
  }
  if (kind === "STAT_AT_LEAST") {
    if (own(r, "minimumRank") !== undefined) p.add(E, at, "a Stat requirement names only stat and minimum");
    const stat = readEnum(own(r, "stat"), PROWESS_STATS, [...at, "stat"], p, E, "Stat");
    const minimum = readInteger(own(r, "minimum"), [...at, "minimum"], p, "minimum", ONE);
    return p.count > before || stat === null || minimum === null ? null : { requirementKey: requirementKey as string, kind, stat, minimum };
  }
  return null;
}

function readRequirements(value: unknown, at: readonly PathSegment[], p: Problems): WeaponRequirement[] {
  const out = readList(value, at, p, "requirements", (v, a) => readWeaponRequirement(v, a, p));
  unique(out.map((x) => x.requirementKey), at, p, "requirement keys");
  return out;
}

export function readTraitUse(value: unknown, at: readonly PathSegment[], p: Problems): TraitUse | null {
  const r = readRecord(value, at, p, E, ["traitRef", "parameters"], ["traitRef", "parameters"]);
  if (r === null) return null;
  const traitRef = readDefinitionRef(own(r, "traitRef"), [...at, "traitRef"], p, E);
  if (traitRef !== null && traitRef.definitionKind !== "EQUIPMENT_TRAIT") p.add(E, [...at, "traitRef"], "a property use names an exact EQUIPMENT_TRAIT");
  const raw = own(r, "parameters");
  const parameters: Record<string, number> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) p.add(E, [...at, "parameters"], "parameters is an object of { parameterKey: integer }");
  else
    for (const key of Object.keys(raw).sort()) {
      if (!LOWER_KEY.test(key)) p.add(E, [...at, "parameters", key], "parameter keys are lowercase");
      const v = readInteger(own(raw as Record<string, unknown>, key), [...at, "parameters", key], p, `parameter ${key}`, NONE);
      if (v !== null) parameters[key] = v;
    }
  return traitRef === null || traitRef.definitionKind !== "EQUIPMENT_TRAIT" ? null : { traitRef, parameters };
}

function readTraitUses(value: unknown, at: readonly PathSegment[], p: Problems): TraitUse[] {
  const out = readList(value, at, p, "property uses", (v, a) => readTraitUse(v, a, p));
  unique(out.map((u) => u.traitRef.entityId), at, p, "property uses (one per exact Equipment Trait)");
  return out;
}

function readFormulaSlot(value: unknown, at: readonly PathSegment[], p: Problems, variables: readonly string[]): FormulaSlot | null {
  const r = readRecord(value, at, p, E, ["expression", "variables"], ["expression", "variables"]);
  if (r === null) return null;
  const program = validateFormulaProgram({ expression: own(r, "expression") });
  const declared = own(r, "variables");
  if (!program.ok || !Array.isArray(declared) || JSON.stringify(declared) !== JSON.stringify(variables) || program.program.variables.some((v) => !variables.includes(v))) {
    p.add(C.INVALID_FORMULA, at, `an M4 Formula reading only ${variables.join(", ")}`);
    return null;
  }
  return { expression: own(r, "expression") as string, variables: [...variables] };
}

function readContract(value: unknown, at: readonly PathSegment[], p: Problems): TraitContract | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    p.add(E, at, "an executable trait carries one complete contract");
    return null;
  }
  const kind = readEnum(own(value as Record<string, unknown>, "kind"), TRAIT_CONTRACT_KINDS, [...at, "kind"], p, E, "trait contract kind");
  if (kind === null) return null;
  const before = p.count;
  const fields = (rest: readonly string[]) => readRecord(value, at, p, E, ["kind", ...rest], ["kind", ...rest]);
  const flag = (r: Record<string, unknown>, key: string) => {
    if (own(r, key) !== true) p.add(E, [...at, key], `${key} is true for this contract`);
    return true;
  };
  switch (kind as TraitContractKind) {
    case "CLOSE_QUARTERS": {
      const r = fields(["usableWhileGrappled", "usableInTightSpaces"]);
      if (r === null) return null;
      flag(r, "usableWhileGrappled");
      flag(r, "usableInTightSpaces");
      return p.count > before ? null : { kind: "CLOSE_QUARTERS", usableWhileGrappled: true, usableInTightSpaces: true };
    }
    case "REACH": {
      const r = fields(["reachFeet"]);
      const reachFeet = r === null ? null : readInteger(own(r, "reachFeet"), [...at, "reachFeet"], p, "reachFeet", ONE);
      return reachFeet === null ? null : { kind: "REACH", reachFeet };
    }
    case "ARMOR_PIERCE": {
      const r = fields(["amountParameter"]);
      const amountParameter = r === null ? null : own(r, "amountParameter");
      if (typeof amountParameter !== "string" || !LOWER_KEY.test(amountParameter)) {
        p.add(E, [...at, "amountParameter"], "amountParameter names the trait parameter holding X");
        return null;
      }
      return { kind: "ARMOR_PIERCE", amountParameter };
    }
    case "POST_HIT_SAVE": {
      const r = fields(["savingThrowStats", "dc", "onFailure"]);
      if (r === null) return null;
      const savingThrowStats = readList(own(r, "savingThrowStats"), [...at, "savingThrowStats"], p, "savingThrowStats", (v, a) => readEnum(v, PROWESS_STATS, a, p, E, "Save Stat"), true);
      unique(savingThrowStats, [...at, "savingThrowStats"], p, "Save Stats");
      const dc = readEnum(own(r, "dc"), SAVING_THROW_DCS, [...at, "dc"], p, E, "Save DC");
      const f = readRecord(own(r, "onFailure"), [...at, "onFailure"], p, E, ["kind", "conditionKey", "feet", "destination"], ["kind"]);
      const fk = f === null ? null : readEnum(own(f, "kind"), POST_HIT_FAILURE_KINDS, [...at, "onFailure", "kind"], p, E, "failure kind");
      let onFailure: Extract<TraitContract, { kind: "POST_HIT_SAVE" }>["onFailure"] | null = null;
      if (f !== null && fk === "APPLY_CONDITION") {
        const conditionKey = readTokenField(own(f, "conditionKey"), [...at, "onFailure", "conditionKey"], p, "conditionKey");
        if (own(f, "feet") !== undefined || own(f, "destination") !== undefined) p.add(E, [...at, "onFailure"], "a Condition failure names only conditionKey");
        if (conditionKey !== null) onFailure = { kind: "APPLY_CONDITION", conditionKey };
      } else if (f !== null && fk === "PULL") {
        const feet = readInteger(own(f, "feet"), [...at, "onFailure", "feet"], p, "feet", ONE);
        if (own(f, "destination") !== "TOWARD_ATTACKER_OR_ADJACENT") p.add(E, [...at, "onFailure", "destination"], "destination is TOWARD_ATTACKER_OR_ADJACENT");
        if (own(f, "conditionKey") !== undefined) p.add(E, [...at, "onFailure"], "a pull names only feet and destination");
        if (feet !== null) onFailure = { kind: "PULL", feet, destination: "TOWARD_ATTACKER_OR_ADJACENT" };
      }
      return p.count > before || dc === null || onFailure === null ? null : { kind: "POST_HIT_SAVE", savingThrowStats, dc, onFailure };
    }
    case "DIE_STEP": {
      const r = fields(["grip", "steps", "order", "multiDie"]);
      if (r === null) return null;
      if (own(r, "grip") !== "TWO_HANDED") p.add(E, [...at, "grip"], "the die step applies to the TWO_HANDED grip");
      if (own(r, "order") !== "BEFORE_POWER") p.add(E, [...at, "order"], "the die step applies BEFORE Power multiplication (§30)");
      if (own(r, "multiDie") !== "FAIL_CLOSED") p.add(E, [...at, "multiDie"], "a multi-die base fails closed (§31)");
      const steps = readList(own(r, "steps"), [...at, "steps"], p, "steps", (v, a) => {
        const s = readRecord(v, a, p, E, ["fromSides", "toSides"], ["fromSides", "toSides"]);
        if (s === null) return null;
        const fromSides = readSides(own(s, "fromSides"), [...a, "fromSides"], p);
        const toSides = readSides(own(s, "toSides"), [...a, "toSides"], p);
        return fromSides === null || toSides === null ? null : { fromSides, toSides };
      }, true);
      unique(steps.map((s) => String(s.fromSides)), [...at, "steps"], p, "step origins");
      return p.count > before ? null : { kind: "DIE_STEP", grip: "TWO_HANDED", steps, order: "BEFORE_POWER", multiDie: "FAIL_CLOSED" };
    }
    case "SAVE_AREA_FIRE": {
      const r = fields(["savingThrowStat", "dc", "onFailure", "onSuccess"]);
      if (r === null) return null;
      const savingThrowStat = readEnum(own(r, "savingThrowStat"), PROWESS_STATS, [...at, "savingThrowStat"], p, E, "Save Stat");
      const dc = readEnum(own(r, "dc"), SAVING_THROW_DCS, [...at, "dc"], p, E, "Save DC");
      const onFailure = readEnum(own(r, "onFailure"), DAMAGE_OUTCOMES, [...at, "onFailure"], p, E, "failure damage");
      const onSuccess = readEnum(own(r, "onSuccess"), DAMAGE_OUTCOMES, [...at, "onSuccess"], p, E, "success damage");
      return savingThrowStat === null || dc === null || onFailure === null || onSuccess === null ? null : { kind: "SAVE_AREA_FIRE", savingThrowStat, dc, onFailure, onSuccess };
    }
    case "AUTHORED_BURST": {
      const r = fields(["accuracyModifier", "damageIsFinal"]);
      if (r === null) return null;
      const accuracyModifier = readInteger(own(r, "accuracyModifier"), [...at, "accuracyModifier"], p, "accuracyModifier", null);
      flag(r, "damageIsFinal");
      return p.count > before || accuracyModifier === null ? null : { kind: "AUTHORED_BURST", accuracyModifier, damageIsFinal: true };
    }
    case "POWER_SCALING": {
      const r = fields(["stat", "minimumPower", "multiplier", "diceCount"]);
      if (r === null) return null;
      const stat = readEnum(own(r, "stat"), PROWESS_STATS, [...at, "stat"], p, E, "scaling Stat");
      const minimumPower = readInteger(own(r, "minimumPower"), [...at, "minimumPower"], p, "minimumPower", ONE);
      const multiplier = readFormulaSlot(own(r, "multiplier"), [...at, "multiplier"], p, ["stat_score", "power", "minimum_power"]);
      const diceCount = readFormulaSlot(own(r, "diceCount"), [...at, "diceCount"], p, ["base_count", "multiplier"]);
      return p.count > before || stat === null || minimumPower === null || multiplier === null || diceCount === null ? null : { kind: "POWER_SCALING", stat, minimumPower, multiplier, diceCount };
    }
    case "DUAL_WIELD": {
      const r = fields(["rows", "repeatPowerIncrement", "sequenceCost", "effectivePower"]);
      if (r === null) return null;
      const rows = readList(own(r, "rows"), [...at, "rows"], p, "rows", (v, a) => {
        const row = readRecord(v, a, p, E, ["category", "minimumMartialRank", "minimumStat", "powerAdjustment"], ["category", "minimumMartialRank", "minimumStat", "powerAdjustment"]);
        if (row === null) return null;
        const category = readEnum(own(row, "category"), WEAPON_CATEGORIES, [...a, "category"], p, E, "Weapon category");
        const minimumMartialRank = readTokenField(own(row, "minimumMartialRank"), [...a, "minimumMartialRank"], p, "minimumMartialRank");
        const rawStat = own(row, "minimumStat");
        let minimumStat: { stat: ProwessStat; minimum: number } | null = null;
        if (rawStat !== null) {
          const s = readRecord(rawStat, [...a, "minimumStat"], p, E, ["stat", "minimum"], ["stat", "minimum"]);
          const stat = s === null ? null : readEnum(own(s, "stat"), PROWESS_STATS, [...a, "minimumStat", "stat"], p, E, "Stat");
          const minimum = s === null ? null : readInteger(own(s, "minimum"), [...a, "minimumStat", "minimum"], p, "minimum", ONE);
          if (stat !== null && minimum !== null) minimumStat = { stat, minimum };
        }
        const powerAdjustment = readInteger(own(row, "powerAdjustment"), [...a, "powerAdjustment"], p, "powerAdjustment", NONE);
        return category === null || minimumMartialRank === null || powerAdjustment === null ? null : { category, minimumMartialRank, minimumStat, powerAdjustment };
      }, true);
      unique(rows.map((x) => x.category), [...at, "rows"], p, "Dual Wield categories");
      const repeatPowerIncrement = readInteger(own(r, "repeatPowerIncrement"), [...at, "repeatPowerIncrement"], p, "repeatPowerIncrement", NONE);
      const sequenceCost = readFormulaSlot(own(r, "sequenceCost"), [...at, "sequenceCost"], p, ["ap_a", "ap_b"]);
      const effectivePower = readFormulaSlot(own(r, "effectivePower"), [...at, "effectivePower"], p, ["power", "adjustment", "increment", "sequence_index"]);
      return p.count > before || repeatPowerIncrement === null || sequenceCost === null || effectivePower === null ? null : { kind: "DUAL_WIELD", rows, repeatPowerIncrement, sequenceCost, effectivePower };
    }
  }
  return null;
}

function readEquipmentTrait(value: unknown, at: readonly PathSegment[], p: Problems): EquipmentTraitPayload | null {
  const fields = ["traitKey", "useSites", "executionStatus", "parameters", "contract", "summary", "source"];
  const r = readRecord(value, at, p, E, fields, fields);
  if (r === null) return null;
  const before = p.count;
  const traitKey = readTokenField(own(r, "traitKey"), [...at, "traitKey"], p, "traitKey");
  const useSites = readList(own(r, "useSites"), [...at, "useSites"], p, "useSites", (v, a) => readEnum(v, TRAIT_USE_SITES, a, p, E, "use site"), true);
  unique(useSites, [...at, "useSites"], p, "use sites");
  const executionStatus = readEnum(own(r, "executionStatus"), TRAIT_EXECUTION_STATUSES, [...at, "executionStatus"], p, E, "execution status");
  const parameters = readList(own(r, "parameters"), [...at, "parameters"], p, "parameters", (v, a) => {
    const q = readRecord(v, a, p, E, ["parameterKey", "kind", "required"], ["parameterKey", "kind", "required"]);
    if (q === null) return null;
    const parameterKey = own(q, "parameterKey");
    if (typeof parameterKey !== "string" || !LOWER_KEY.test(parameterKey)) p.add(E, [...a, "parameterKey"], "parameterKey is a lowercase key");
    const kind = readEnum(own(q, "kind"), TRAIT_PARAMETER_KINDS, [...a, "kind"], p, E, "parameter kind");
    if (typeof own(q, "required") !== "boolean") p.add(E, [...a, "required"], "required is a boolean");
    return kind === null || typeof parameterKey !== "string" || typeof own(q, "required") !== "boolean" ? null : { parameterKey, kind, required: own(q, "required") as boolean };
  });
  unique(parameters.map((x) => x.parameterKey), [...at, "parameters"], p, "parameter keys");
  const rawContract = own(r, "contract");
  let contract: TraitContract | null = null;
  // EXECUTABLE ⇔ a complete contract (§18): a trait is never executed without one, and a contract never rides on a
  // REFERENCE_ONLY / DEFERRED trait.
  if (executionStatus === "EXECUTABLE") contract = readContract(rawContract, [...at, "contract"], p);
  else if (rawContract !== null) p.add(E, [...at, "contract"], "only an EXECUTABLE trait carries a contract");
  if (contract?.kind === "ARMOR_PIERCE" && !parameters.some((x) => x.parameterKey === contract.amountParameter && x.required)) p.add(E, [...at, "contract", "amountParameter"], "the Pierce amount is a declared, required parameter");
  const summary = readText(own(r, "summary"), [...at, "summary"], p, "summary");
  const source = readEquipmentSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || traitKey === null || executionStatus === null || summary === null || source === null) return null;
  return { traitKey, useSites, executionStatus, parameters, contract, summary, source };
}

function readDamageProfile(value: unknown, at: readonly PathSegment[], p: Problems): DamageProfile | null {
  const r = readRecord(value, at, p, E, ["profileKey", "dice", "damageType"], ["profileKey", "dice", "damageType"]);
  if (r === null) return null;
  const profileKey = own(r, "profileKey");
  if (typeof profileKey !== "string" || !LOWER_KEY.test(profileKey)) p.add(E, [...at, "profileKey"], "profileKey is a lowercase key");
  const d = readRecord(own(r, "dice"), [...at, "dice"], p, E, ["count", "sides"], ["count", "sides"]);
  const count = d === null ? null : readInteger(own(d, "count"), [...at, "dice", "count"], p, "dice count", ONE);
  const sides = d === null ? null : readSides(own(d, "sides"), [...at, "dice", "sides"], p);
  const damageType = readEnum(own(r, "damageType"), DAMAGE_TYPES, [...at, "damageType"], p, E, "damage type");
  return typeof profileKey !== "string" || !LOWER_KEY.test(profileKey) || count === null || sides === null || damageType === null ? null : { profileKey, dice: { count, sides }, damageType };
}

function readResolution(value: unknown, at: readonly PathSegment[], p: Problems): AttackResolution | null {
  const r = readRecord(value, at, p, E, ["mode", "onMiss", "savingThrowStat", "dc", "onFailure", "onSuccess", "reason"], ["mode"]);
  if (r === null) return null;
  const mode = own(r, "mode");
  const only = (keys: readonly string[]) => {
    for (const k of Object.keys(r)) if (k !== "mode" && !keys.includes(k)) p.add(E, [...at, k], `${String(mode)} resolution has no ${k}`);
  };
  if (mode === "ATTACK_ROLL") {
    only(["onMiss"]);
    // Partial damage on a miss is exact authored outcome data, never a global rule (§38).
    const onMiss = readEnum(own(r, "onMiss"), DAMAGE_OUTCOMES, [...at, "onMiss"], p, E, "miss damage");
    return onMiss === null ? null : { mode, onMiss };
  }
  if (mode === "SAVING_THROW") {
    only(["savingThrowStat", "dc", "onFailure", "onSuccess"]);
    const savingThrowStat = readEnum(own(r, "savingThrowStat"), PROWESS_STATS, [...at, "savingThrowStat"], p, E, "Save Stat");
    const dc = readEnum(own(r, "dc"), SAVING_THROW_DCS, [...at, "dc"], p, E, "Save DC");
    const onFailure = readEnum(own(r, "onFailure"), DAMAGE_OUTCOMES, [...at, "onFailure"], p, E, "failure damage");
    const onSuccess = readEnum(own(r, "onSuccess"), DAMAGE_OUTCOMES, [...at, "onSuccess"], p, E, "success damage");
    return savingThrowStat === null || dc === null || onFailure === null || onSuccess === null ? null : { mode, savingThrowStat, dc, onFailure, onSuccess };
  }
  if (mode === "DEFERRED") {
    only(["reason"]);
    const reason = readText(own(r, "reason"), [...at, "reason"], p, "reason");
    if (reason !== null && reason.trim() === "") p.add(E, [...at, "reason"], "a deferred resolution states why");
    return reason === null || reason.trim() === "" ? null : { mode, reason };
  }
  p.add(E, [...at, "mode"], "resolution mode is ATTACK_ROLL, SAVING_THROW or DEFERRED");
  return null;
}

function readTargeting(value: unknown, at: readonly PathSegment[], p: Problems): AttackTargeting | null {
  const r = readRecord(value, at, p, E, ["mode", "reachFeet", "stat", "feetPerPoint", "area", "lengthFeet"], ["mode"]);
  if (r === null) return null;
  const mode = readEnum(own(r, "mode"), ATTACK_TARGETING_MODES, [...at, "mode"], p, E, "targeting mode");
  if (mode === null) return null;
  const only = (keys: readonly string[]) => {
    for (const k of Object.keys(r)) if (k !== "mode" && !keys.includes(k)) p.add(E, [...at, k], `${mode} targeting has no ${k}`);
    for (const k of keys) if (own(r, k) === undefined) p.add(E, [...at, k], `"${k}" is required for ${mode} targeting`);
  };
  const before = p.count;
  switch (mode) {
    case "MELEE":
    case "CLOSE": {
      only(["reachFeet"]);
      const reachFeet = readInteger(own(r, "reachFeet"), [...at, "reachFeet"], p, "reachFeet", ONE);
      return p.count > before || reachFeet === null ? null : { mode, reachFeet };
    }
    case "RANGED_MULTIPLIER": {
      only(["stat", "feetPerPoint", "area"]);
      const stat = readEnum(own(r, "stat"), PROWESS_STATS, [...at, "stat"], p, E, "range Stat");
      const feetPerPoint = readInteger(own(r, "feetPerPoint"), [...at, "feetPerPoint"], p, "feetPerPoint", ONE);
      const rawArea = own(r, "area");
      let area: { shape: "BLAST"; radiusFeet: number } | null = null;
      if (rawArea !== null && rawArea !== undefined) {
        const a = readRecord(rawArea, [...at, "area"], p, E, ["shape", "radiusFeet"], ["shape", "radiusFeet"]);
        const shape = a === null ? null : readEnum(own(a, "shape"), ATTACK_AREA_SHAPES, [...at, "area", "shape"], p, E, "area shape");
        const radiusFeet = a === null ? null : readInteger(own(a, "radiusFeet"), [...at, "area", "radiusFeet"], p, "radiusFeet", ONE);
        if (shape !== null && radiusFeet !== null) area = { shape, radiusFeet };
      }
      return p.count > before || stat === null || feetPerPoint === null ? null : { mode, stat, feetPerPoint, area };
    }
    case "LINE":
    case "CONE": {
      only(["lengthFeet"]);
      const lengthFeet = readInteger(own(r, "lengthFeet"), [...at, "lengthFeet"], p, "lengthFeet", ONE);
      return p.count > before || lengthFeet === null ? null : { mode, lengthFeet };
    }
  }
  return null;
}

function readAttack(value: unknown, at: readonly PathSegment[], p: Problems): AttackDefinitionPayload | null {
  const fields = ["moveKey", "weaponFamilyKey", "apCost", "mpCost", "damageProfiles", "scaling", "resolution", "targeting", "moveProperties", "accuracyModifier", "requirements", "source"];
  const r = readRecord(value, at, p, E, fields, fields);
  if (r === null) return null;
  const before = p.count;
  const moveKey = readTokenField(own(r, "moveKey"), [...at, "moveKey"], p, "moveKey");
  const weaponFamilyKey = readTokenField(own(r, "weaponFamilyKey"), [...at, "weaponFamilyKey"], p, "weaponFamilyKey");
  // The Move owns its AP (§5): authored, never inferred from a Weapon Category.
  const ap = readInteger(own(r, "apCost"), [...at, "apCost"], p, "AP cost", NONE);
  const mp = readInteger(own(r, "mpCost"), [...at, "mpCost"], p, "MP cost", NONE);
  const damageProfiles = readList(own(r, "damageProfiles"), [...at, "damageProfiles"], p, "damageProfiles", (v, a) => readDamageProfile(v, a, p), true);
  unique(damageProfiles.map((d) => d.profileKey), [...at, "damageProfiles"], p, "damage profile keys");
  const rawScaling = own(r, "scaling");
  const scaling = rawScaling === null ? null : readEnum(rawScaling, ATTACK_SCALINGS, [...at, "scaling"], p, E, "Attack scaling");
  const resolution = readResolution(own(r, "resolution"), [...at, "resolution"], p);
  const targeting = readTargeting(own(r, "targeting"), [...at, "targeting"], p);
  const moveProperties = readTraitUses(own(r, "moveProperties"), [...at, "moveProperties"], p);
  const accuracyModifier = readInteger(own(r, "accuracyModifier"), [...at, "accuracyModifier"], p, "accuracyModifier", null);
  const requirements = readRequirements(own(r, "requirements"), [...at, "requirements"], p);
  const source = readEquipmentSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || moveKey === null || weaponFamilyKey === null || ap === null || mp === null || resolution === null || targeting === null || accuracyModifier === null || source === null) return null;
  return { moveKey, weaponFamilyKey, apCost: ap, mpCost: mp, damageProfiles, scaling, resolution, targeting, moveProperties, accuracyModifier, requirements, source };
}

function readWeapon(value: unknown, at: readonly PathSegment[], p: Problems): WeaponDefinitionPayload | null {
  const fields = ["familyKey", "profileKind", "equipmentRole", "martialRankKey", "category", "handedness", "scalingModel", "power", "scalingRule", "versatileRule", "exampleForms", "weaponProperties", "moveset", "requirements", "equippedModifiers", "grantedFeatures", "source"];
  const r = readRecord(value, at, p, E, fields, fields);
  if (r === null) return null;
  const before = p.count;
  const familyKey = readTokenField(own(r, "familyKey"), [...at, "familyKey"], p, "familyKey");
  const profileKind = readEnum(own(r, "profileKind"), WEAPON_PROFILE_KINDS, [...at, "profileKind"], p, E, "profile kind");
  const equipmentRole = readEnum(own(r, "equipmentRole"), EQUIPMENT_ROLES, [...at, "equipmentRole"], p, E, "equipment role");
  if (equipmentRole === "SHIELD" && profileKind !== "STANDARD") p.add(E, [...at, "equipmentRole"], "only a standard held profile is a Shield");
  const rawRank = own(r, "martialRankKey");
  const martialRankKey = rawRank === null ? null : readTokenField(rawRank, [...at, "martialRankKey"], p, "martialRankKey");
  if (profileKind === "UNARMED" && rawRank === null) p.add(E, [...at, "martialRankKey"], "an Unarmed profile names the exact Martial rank it belongs to");
  if (profileKind !== null && profileKind !== "UNARMED" && rawRank !== null) p.add(E, [...at, "martialRankKey"], "only an Unarmed profile names a Martial rank");
  const rawCategory = own(r, "category");
  const category = rawCategory === null ? null : readEnum(rawCategory, WEAPON_CATEGORIES, [...at, "category"], p, E, "Weapon category");
  if (rawCategory === null && profileKind !== "UNARMED") p.add(E, [...at, "category"], "only the intrinsic Unarmed profile leaves its category unauthored");
  const rawHandedness = own(r, "handedness");
  const handedness = rawHandedness === null ? null : readEnum(rawHandedness, WEAPON_HANDEDNESS, [...at, "handedness"], p, E, "handedness");
  // Mandatory and explicit (§24): never inferred from whether `power` happens to be present.
  const scalingModel = readEnum(own(r, "scalingModel"), WEAPON_SCALING_MODELS, [...at, "scalingModel"], p, E, "scaling model");
  const rawPower = own(r, "power");
  const power = rawPower === null ? null : readInteger(rawPower, [...at, "power"], p, "Power", MINIMUM_AUTHORED_POWER);
  const rawScalingRule = own(r, "scalingRule");
  const scalingRule = rawScalingRule === null ? null : readTraitUse(rawScalingRule, [...at, "scalingRule"], p);
  if (scalingModel === "STATIC" && rawPower !== null) p.add(E, [...at, "power"], "a STATIC Weapon has no Power — never a fake value (§28)");
  if (scalingModel === "STATIC" && rawScalingRule !== null) p.add(E, [...at, "scalingRule"], "a STATIC Weapon has no Power scaling rule");
  if (scalingModel === "POWER" && rawPower === null) p.add(E, [...at, "power"], "a POWER Weapon authors its Power");
  if (scalingModel === "POWER" && rawScalingRule === null) p.add(E, [...at, "scalingRule"], "a POWER Weapon names its exact Power scaling rule");
  if (scalingModel === "HYBRID" && (rawPower === null) !== (rawScalingRule === null)) p.add(E, [...at, "scalingRule"], "a HYBRID Weapon authors Power and its exact scaling rule together, or neither");
  const rawVersatile = own(r, "versatileRule");
  const versatileRule = rawVersatile === null ? null : readTraitUse(rawVersatile, [...at, "versatileRule"], p);
  if ((handedness === "VERSATILE") !== (rawVersatile !== null)) p.add(E, [...at, "versatileRule"], "a VERSATILE Weapon (and only one) names its exact Versatile die-step rule");
  const exampleForms = readList(own(r, "exampleForms"), [...at, "exampleForms"], p, "exampleForms", (v, a) => (isExactLabel(v) ? v : (p.add(E, a, "an example form is display text"), null)));
  unique(exampleForms, [...at, "exampleForms"], p, "example forms");
  const weaponProperties = readTraitUses(own(r, "weaponProperties"), [...at, "weaponProperties"], p);
  const moveset = readList(own(r, "moveset"), [...at, "moveset"], p, "moveset", (v, a) => {
    const ref = readDefinitionRef(v, a, p, E);
    if (ref !== null && ref.definitionKind !== "ATTACK") {
      p.add(E, a, "a Moveset entry is an exact ATTACK reference");
      return null;
    }
    return ref;
  }, true);
  unique(moveset.map((m) => m.entityId), [...at, "moveset"], p, "Moveset Attacks");
  const requirements = readRequirements(own(r, "requirements"), [...at, "requirements"], p);
  const equippedModifiers = readList(own(r, "equippedModifiers"), [...at, "equippedModifiers"], p, "equippedModifiers", (v, a) => {
    const m = readRecord(v, a, p, E, ["modifierKey", "target", "value"], ["modifierKey", "target", "value"]);
    if (m === null) return null;
    const modifierKey = own(m, "modifierKey");
    if (typeof modifierKey !== "string" || !LOWER_KEY.test(modifierKey)) p.add(E, [...a, "modifierKey"], "modifierKey is a lowercase key");
    const target = readEnum(own(m, "target"), EQUIPMENT_MODIFIER_TARGETS, [...a, "target"], p, E, "modifier target");
    const amount = readInteger(own(m, "value"), [...a, "value"], p, "modifier value", null);
    if (amount === NONE) p.add(E, [...a, "value"], "a modifier changes its target");
    return typeof modifierKey !== "string" || !LOWER_KEY.test(modifierKey) || target === null || amount === null || amount === NONE ? null : { modifierKey, target, value: amount };
  });
  unique(equippedModifiers.map((m) => m.modifierKey), [...at, "equippedModifiers"], p, "modifier keys");
  const grantedFeatures = readList(own(r, "grantedFeatures"), [...at, "grantedFeatures"], p, "grantedFeatures", (v, a) => {
    const g = readRecord(v, a, p, E, ["featureKey", "executionStatus", "summary"], ["featureKey", "executionStatus", "summary"]);
    if (g === null) return null;
    const featureKey = readTokenField(own(g, "featureKey"), [...a, "featureKey"], p, "featureKey");
    const status = readEnum(own(g, "executionStatus"), ["REFERENCE_ONLY", "DEFERRED"] as const, [...a, "executionStatus"], p, E, "granted feature status (WO6 executes no granted feature)");
    const summary = readText(own(g, "summary"), [...a, "summary"], p, "summary");
    return featureKey === null || status === null || summary === null ? null : { featureKey, executionStatus: status, summary };
  });
  unique(grantedFeatures.map((g) => g.featureKey), [...at, "grantedFeatures"], p, "feature keys");
  const source = readEquipmentSource(own(r, "source"), [...at, "source"], p);
  if (p.count > before || familyKey === null || profileKind === null || equipmentRole === null || (rawCategory !== null && category === null) || (rawHandedness !== null && handedness === null) || scalingModel === null || source === null) return null;
  return { familyKey, profileKind, equipmentRole, martialRankKey, category, handedness, scalingModel, power, scalingRule, versatileRule, exampleForms, weaponProperties, moveset, requirements, equippedModifiers, grantedFeatures, source };
}

/** Validates `value` as the version-1 payload of `kind` (the caller checked the version). */
export function readEquipmentPayload(kind: EquipmentPayloadKind, value: unknown, at: readonly PathSegment[], p: Problems): JsonObject | null {
  const payload = kind === "WEAPON" ? readWeapon(value, at, p) : kind === "ATTACK" ? readAttack(value, at, p) : readEquipmentTrait(value, at, p);
  return payload as unknown as JsonObject | null;
}
