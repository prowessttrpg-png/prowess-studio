import { deepFreeze } from "../internal/plain-data.js";
import { findBundleDefinition, type ProwessDefinitionBundle } from "../bundle/bundle.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import type { AttackDefinitionPayload, EquipmentTraitPayload, TraitContract, TraitUse, WeaponDefinitionPayload } from "../definition/equipment-payload.js";
import type { AbilityConstructionRulePayload } from "../definition/ability-construction-payload.js";
import { indexCoreDefinitions } from "../core/definitions.js";
import type { AttackScaling, TraitExecutionStatus, TraitUseSite } from "../vocabulary/equipment.js";
import type { ProwessStat } from "../vocabulary/core.js";

/**
 * The Weapon & Attack Library of ONE exact Release (PAS-10 M6-WO6 §15, §95, §97). Every WEAPON, ATTACK and
 * EQUIPMENT_TRAIT the bundle pins is cross-checked against the SAME bundle: a Moveset entry, a property use or a rule
 * reference must name an exact Definition pinned by this Release (no latest, no canonical-key-only, no display-name
 * lookup). A Weapon with any incoherence is reported and excluded from execution (fail closed); the rest of the Library
 * stays readable.
 */

export const WEAPON_LIBRARY_ERROR_CODES = deepFreeze({
  UNRESOLVED_REFERENCE: "PROWESS_WEAPON.UNRESOLVED_REFERENCE",
  WRONG_KIND: "PROWESS_WEAPON.WRONG_DEFINITION_KIND",
  FAMILY_MISMATCH: "PROWESS_WEAPON.ATTACK_FAMILY_MISMATCH",
  DUPLICATE_MOVE: "PROWESS_WEAPON.DUPLICATE_MOVE",
  TRAIT_SITE: "PROWESS_WEAPON.TRAIT_NOT_ALLOWED_HERE",
  TRAIT_PARAMETERS: "PROWESS_WEAPON.TRAIT_PARAMETERS",
  RULE_CONTRACT: "PROWESS_WEAPON.RULE_CONTRACT",
  HYBRID_SCALING: "PROWESS_WEAPON.HYBRID_SCALING",
  RESOLUTION_CONTRACT: "PROWESS_WEAPON.RESOLUTION_CONTRACT",
  UNARMED_RANK: "PROWESS_WEAPON.UNARMED_RANK",
  DUAL_WIELD_RULE: "PROWESS_WEAPON.DUAL_WIELD_RULE",
} as const);
const K = WEAPON_LIBRARY_ERROR_CODES;

export interface WeaponLibraryIssue {
  readonly code: string;
  readonly message: string;
  readonly source: ProwessDefinitionRef | null;
}

/** A property use resolved to its exact Equipment Trait. A REFERENCE_ONLY / DEFERRED trait is shown, never executed. */
export interface ResolvedTraitUse {
  readonly trait: ProwessDefinitionRef;
  readonly traitKey: string;
  readonly executionStatus: TraitExecutionStatus;
  readonly parameters: Readonly<Record<string, number>>;
  readonly contract: TraitContract | null;
  readonly summary: string;
}

export interface AttackEntry {
  readonly ref: ProwessDefinitionRef;
  readonly payload: AttackDefinitionPayload;
  /** The Attack's effective scaling: the Weapon's own (POWER / STATIC) or, on a HYBRID Weapon, the Attack's explicit one. */
  readonly scaling: AttackScaling;
  readonly moveProperties: readonly ResolvedTraitUse[];
}

export interface WeaponEntry {
  readonly ref: ProwessDefinitionRef;
  readonly payload: WeaponDefinitionPayload;
  readonly attacks: readonly AttackEntry[];
  readonly weaponProperties: readonly ResolvedTraitUse[];
  readonly scalingRule: { readonly use: ResolvedTraitUse; readonly contract: Extract<TraitContract, { kind: "POWER_SCALING" }> } | null;
  readonly versatileRule: { readonly use: ResolvedTraitUse; readonly contract: Extract<TraitContract, { kind: "DIE_STEP" }> } | null;
}

export interface WeaponLibraryIndex {
  /** Coherent Weapons (every reference exact and pinned), in bundle order. */
  readonly weapons: readonly WeaponEntry[];
  /** Weapons the Release pins that are excluded from execution because of an issue. */
  readonly excluded: readonly ProwessDefinitionRef[];
  readonly traits: readonly { readonly ref: ProwessDefinitionRef; readonly payload: EquipmentTraitPayload }[];
  readonly dualWield: { readonly ref: ProwessDefinitionRef; readonly contract: Extract<TraitContract, { kind: "DUAL_WIELD" }> } | null;
  /** The Martial Skill (exact canonical key) and the Skill rank ladder, read from the Release's construction rule. */
  readonly martial: { readonly skillKey: string; readonly ladder: readonly { readonly rankKey: string; readonly order: number }[] } | null;
  /** The Stat the Release's core Attack Roll adds (the M5 Attack contract's resolution Stat). */
  readonly attackRollStat: ProwessStat | null;
  readonly issues: readonly WeaponLibraryIssue[];
}

export interface WeaponCapability {
  readonly weaponLibrary: { readonly status: "WEAPON_LIBRARY_READY" | "NO_WEAPONS" | "INCONSISTENT_CONTENT"; readonly missing: readonly { readonly requirement: string; readonly message: string }[] };
  readonly attackLibrary: { readonly status: "ATTACK_LIBRARY_READY" | "MISSING_REQUIRED_CONTENT"; readonly missing: readonly { readonly requirement: string; readonly message: string }[] };
}

const isPair = (a: ProwessDefinitionRef, b: ProwessDefinitionRef) => a.entityId === b.entityId && a.entityVersionId === b.entityVersionId;

function resolveUse(bundle: ProwessDefinitionBundle, use: TraitUse, site: TraitUseSite, owner: ProwessDefinitionRef, add: (code: string, message: string) => void): ResolvedTraitUse | null {
  const envelope = findBundleDefinition(bundle, use.traitRef);
  if (envelope === null) {
    add(K.UNRESOLVED_REFERENCE, `${owner.canonicalKey} names Equipment Trait ${use.traitRef.canonicalKey} @ ${use.traitRef.entityVersionId}, which this Release does not pin`);
    return null;
  }
  if (envelope.definitionKind !== "EQUIPMENT_TRAIT") {
    add(K.WRONG_KIND, `${owner.canonicalKey}: ${envelope.canonicalKey} is not an EQUIPMENT_TRAIT`);
    return null;
  }
  const trait = envelope.payload as unknown as EquipmentTraitPayload;
  let ok = true;
  if (!trait.useSites.includes(site)) {
    add(K.TRAIT_SITE, `${owner.canonicalKey}: ${trait.traitKey} is not a ${site} property`);
    ok = false;
  }
  for (const key of Object.keys(use.parameters)) {
    if (!trait.parameters.some((x) => x.parameterKey === key)) {
      add(K.TRAIT_PARAMETERS, `${owner.canonicalKey}: ${trait.traitKey} declares no parameter ${key}`);
      ok = false;
    }
  }
  for (const declared of trait.parameters) {
    if (declared.required && use.parameters[declared.parameterKey] === undefined) {
      add(K.TRAIT_PARAMETERS, `${owner.canonicalKey}: ${trait.traitKey} requires parameter ${declared.parameterKey}`);
      ok = false;
    }
  }
  return ok ? { trait: definitionRefOf(envelope), traitKey: trait.traitKey, executionStatus: trait.executionStatus, parameters: use.parameters, contract: trait.contract, summary: trait.summary } : null;
}

function readMartial(bundle: ProwessDefinitionBundle): WeaponLibraryIndex["martial"] {
  const rules = bundle.definitions.filter((d) => d.definitionKind === "ABILITY_CONSTRUCTION_RULE");
  const core = indexCoreDefinitions(bundle);
  if (rules.length !== 1 || !core.ok) return null;
  const rule = (rules[0] as ProwessDefinitionEnvelope).payload as unknown as AbilityConstructionRulePayload;
  const ladder = [...core.value.skillLadder.payload.ranks].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return { skillKey: rule.maneuver.martial.skillKey, ladder };
}

function readAttackRollStat(bundle: ProwessDefinitionBundle): ProwessStat | null {
  const core = indexCoreDefinitions(bundle);
  if (!core.ok) return null;
  const roll = core.value.procedures.ATTACK_ROLL?.payload as { total?: { variables?: readonly { source: { kind: string; stat?: ProwessStat } }[] } } | undefined;
  const stats = (roll?.total?.variables ?? []).flatMap((v) => (v.source.kind === "STAT" && v.source.stat !== undefined ? [v.source.stat] : []));
  return stats.length === 1 ? (stats[0] as ProwessStat) : null;
}

/** Reads and cross-checks the Weapon & Attack Library of one exact bundle. Pure; never throws on content. */
export function indexWeaponLibrary(bundle: ProwessDefinitionBundle): WeaponLibraryIndex {
  const issues: WeaponLibraryIssue[] = [];
  const traits = bundle.definitions.filter((d) => d.definitionKind === "EQUIPMENT_TRAIT").map((d) => ({ ref: definitionRefOf(d), payload: d.payload as unknown as EquipmentTraitPayload }));
  const dualRules = traits.filter((t) => t.payload.contract?.kind === "DUAL_WIELD");
  if (dualRules.length > 1) issues.push({ code: K.DUAL_WIELD_RULE, message: `the Release pins ${dualRules.length} Dual Wield rules; at most one is allowed`, source: null });
  const dual = dualRules.length === 1 ? (dualRules[0] as (typeof dualRules)[number]) : null;
  const martial = readMartial(bundle);
  const weapons: WeaponEntry[] = [];
  const excluded: ProwessDefinitionRef[] = [];

  for (const envelope of bundle.definitions.filter((d) => d.definitionKind === "WEAPON")) {
    const ref = definitionRefOf(envelope);
    const payload = envelope.payload as unknown as WeaponDefinitionPayload;
    const local: WeaponLibraryIssue[] = [];
    const add = (code: string, message: string) => local.push({ code, message, source: ref });
    const weaponProperties = payload.weaponProperties.map((u) => resolveUse(bundle, u, "WEAPON_PROPERTY", ref, add));
    const rule = (use: TraitUse | null, kind: "POWER_SCALING" | "DIE_STEP") => {
      if (use === null) return null;
      const resolved = resolveUse(bundle, use, "WEAPON_PROPERTY", ref, add);
      if (resolved !== null && resolved.contract?.kind !== kind) {
        add(K.RULE_CONTRACT, `${ref.canonicalKey}: ${resolved.traitKey} is not an executable ${kind} rule`);
        return null;
      }
      return resolved;
    };
    const scalingUse = rule(payload.scalingRule, "POWER_SCALING");
    const versatileUse = rule(payload.versatileRule, "DIE_STEP");
    if (payload.profileKind === "UNARMED" && martial !== null && !martial.ladder.some((r) => r.rankKey === payload.martialRankKey)) add(K.UNARMED_RANK, `${ref.canonicalKey}: ${String(payload.martialRankKey)} is not a rank of the Skill rank ladder`);
    const attacks: AttackEntry[] = [];
    const moveKeys = new Set<string>();
    for (const attackRef of payload.moveset) {
      const a = findBundleDefinition(bundle, attackRef);
      if (a === null) {
        add(K.UNRESOLVED_REFERENCE, `${ref.canonicalKey} Moveset names Attack ${attackRef.canonicalKey} @ ${attackRef.entityVersionId}, which this Release does not pin`);
        continue;
      }
      if (a.definitionKind !== "ATTACK") {
        add(K.WRONG_KIND, `${ref.canonicalKey} Moveset entry ${a.canonicalKey} is not an ATTACK`);
        continue;
      }
      const attack = a.payload as unknown as AttackDefinitionPayload;
      if (attack.weaponFamilyKey !== payload.familyKey) add(K.FAMILY_MISMATCH, `${a.canonicalKey} belongs to Weapon family ${attack.weaponFamilyKey}, not ${payload.familyKey}`);
      if (moveKeys.has(attack.moveKey)) add(K.DUPLICATE_MOVE, `${ref.canonicalKey} Moveset repeats move key ${attack.moveKey}`);
      moveKeys.add(attack.moveKey);
      // The scaling is explicit: a POWER / STATIC Weapon's Attacks inherit it and declare none; a HYBRID Weapon's
      // Attacks each declare their own (§29) — never guessed from Power or damage.
      let scaling: AttackScaling | null = null;
      if (payload.scalingModel === "HYBRID") {
        if (attack.scaling === null) add(K.HYBRID_SCALING, `${a.canonicalKey} is a HYBRID Weapon's Attack and must declare its own scaling`);
        scaling = attack.scaling;
      } else {
        if (attack.scaling !== null) add(K.HYBRID_SCALING, `${a.canonicalKey} declares a scaling; only a HYBRID Weapon's Attacks do`);
        scaling = payload.scalingModel;
      }
      if (scaling === "POWER" && (payload.power === null || scalingUse === null)) add(K.HYBRID_SCALING, `${a.canonicalKey} is Power-scaled; ${ref.canonicalKey} must author Power and its exact Power scaling rule`);
      const attackRef2 = definitionRefOf(a);
      const moveProperties = attack.moveProperties.map((u) => resolveUse(bundle, u, "MOVE_PROPERTY", attackRef2, add));
      for (const use of moveProperties) {
        const c = use?.contract;
        if (c?.kind === "SAVE_AREA_FIRE") {
          const r = attack.resolution;
          if (r.mode !== "SAVING_THROW" || r.savingThrowStat !== c.savingThrowStat || r.dc !== c.dc || r.onFailure !== c.onFailure || r.onSuccess !== c.onSuccess) add(K.RESOLUTION_CONTRACT, `${a.canonicalKey} carries ${use?.traitKey}: it resolves as that trait's Saving Throw (Save, DC, failure and success damage), never an Attack Roll`);
        }
        if (c?.kind === "AUTHORED_BURST" && attack.accuracyModifier !== c.accuracyModifier) add(K.RESOLUTION_CONTRACT, `${a.canonicalKey} carries ${use?.traitKey}: its Accuracy adjustment is the trait's authored ${c.accuracyModifier}`);
      }
      if (scaling !== null && moveProperties.every((u) => u !== null)) attacks.push({ ref: attackRef2, payload: attack, scaling, moveProperties: moveProperties as ResolvedTraitUse[] });
    }
    if (local.length === 0 && weaponProperties.every((u) => u !== null)) {
      weapons.push({
        ref,
        payload,
        attacks,
        weaponProperties: weaponProperties as ResolvedTraitUse[],
        scalingRule: scalingUse === null ? null : { use: scalingUse, contract: scalingUse.contract as Extract<TraitContract, { kind: "POWER_SCALING" }> },
        versatileRule: versatileUse === null ? null : { use: versatileUse, contract: versatileUse.contract as Extract<TraitContract, { kind: "DIE_STEP" }> },
      });
    } else {
      excluded.push(ref);
      issues.push(...local);
    }
  }
  const unarmedRanks = weapons.filter((w) => w.payload.profileKind === "UNARMED").map((w) => w.payload.martialRankKey);
  if (new Set(unarmedRanks).size !== unarmedRanks.length) issues.push({ code: K.UNARMED_RANK, message: "the Release pins more than one Unarmed profile for a Martial rank", source: null });
  return deepFreeze({
    weapons,
    excluded,
    traits,
    dualWield: dual === null ? null : { ref: dual.ref, contract: dual.payload.contract as Extract<TraitContract, { kind: "DUAL_WIELD" }> },
    martial,
    attackRollStat: readAttackRollStat(bundle),
    issues,
  });
}

/** The coherent Weapon the selection names EXACTLY (Entity + EntityVersion) in this Release, or null. */
export function findLibraryWeapon(index: WeaponLibraryIndex, selection: { readonly entityId: string; readonly entityVersionId: string }): WeaponEntry | null {
  return index.weapons.find((w) => isPair(w.ref, selection as ProwessDefinitionRef)) ?? null;
}

/** Release capability (§97): the Weapon Library and the Character Attack Library, with every missing requirement. */
export function getWeaponCapability(bundle: ProwessDefinitionBundle, index: WeaponLibraryIndex = indexWeaponLibrary(bundle)): WeaponCapability {
  const weaponMissing: { requirement: string; message: string }[] = index.issues.map((i) => ({ requirement: i.code, message: i.message }));
  const standard = index.weapons.filter((w) => w.payload.profileKind === "STANDARD");
  if (standard.length === 0) weaponMissing.push({ requirement: "WEAPON", message: "the Release pins no coherent equippable Weapon" });
  const weaponStatus = index.issues.length > 0 ? ("INCONSISTENT_CONTENT" as const) : standard.length === 0 ? ("NO_WEAPONS" as const) : ("WEAPON_LIBRARY_READY" as const);
  const attackMissing: { requirement: string; message: string }[] = [];
  if (index.martial === null) attackMissing.push({ requirement: "ABILITY_CONSTRUCTION_RULE", message: "the Release pins no single Ability Construction Rule naming the Martial Skill, so the Character's Martial rank cannot be read" });
  else
    for (const rank of index.martial.ladder) {
      if (!index.weapons.some((w) => w.payload.profileKind === "UNARMED" && w.payload.martialRankKey === rank.rankKey)) attackMissing.push({ requirement: "UNARMED", message: `the Release pins no Unarmed profile for Martial rank ${rank.rankKey}` });
    }
  if (index.attackRollStat === null) attackMissing.push({ requirement: "ATTACK_ROLL", message: "the Release's core Attack Roll does not name exactly one Stat" });
  if (index.dualWield === null) attackMissing.push({ requirement: "DUAL_WIELD", message: "the Release pins no Dual Wield rule; Dual Wield sequences are unavailable" });
  for (const i of index.issues) attackMissing.push({ requirement: i.code, message: i.message });
  return deepFreeze({
    weaponLibrary: { status: weaponStatus, missing: weaponMissing },
    attackLibrary: { status: attackMissing.length === 0 ? ("ATTACK_LIBRARY_READY" as const) : ("MISSING_REQUIRED_CONTENT" as const), missing: attackMissing },
  });
}
