import { CHARACTER_ERROR_CODES } from "@prowess/model";
import {
  buildCharacterAttackLibrary,
  checkWeaponRequirements,
  equipmentContextOf,
  getWeaponCapability,
  indexWeaponLibrary,
  readWeaponLoadoutChoice,
  resolveWeaponLoadout,
  type CharacterAttack,
  type CharacterAttackLibrary,
  type CharacterMechanicalProfile,
  type ProwessDefinitionBundle,
  type ProwessDefinitionRef,
  type RequirementCheck,
  type ResolvedWeaponLoadout,
  type WeaponCapability,
  type WeaponLibraryIndex,
  type WeaponLoadoutChoice,
} from "@prowess/game";
import type { RulesetContext } from "@prowess/rules";
import { loadCompleted, requireProfile } from "./advancement-service.js";
import { profileOf } from "./progression.js";
import { fail, namesOf, releaseSummary, type CharacterReleaseSummary } from "./service.js";
import { selectWeaponLoadout, writeWeaponLoadout } from "./weapon-repository.js";

/**
 * Character Weapon & Attack service (PAS-10 M6-WO6). Orchestration and persistence only:
 *
 *   Character + exact Release → unequipped profile (M6-WO4) → stored loadout CHOICE → @prowess/game loadout validation
 *   → equipment context → the SAME profile builder with equipment → Character Attack Library (damage preview)
 *
 * Nothing here computes a rule. The client submits only `expectedVersion`, exact Weapon pairs and the Versatile grip;
 * Power, damage, Attacks and shield bonuses are derived by @prowess/game from the Character's exact Release on every
 * read. Equipping never writes the Character row, creation, advancement history, sheet state or Possessions.
 */

export interface EquippedSummary {
  readonly weapon: ProwessDefinitionRef;
  readonly grip: "ONE_HANDED" | "TWO_HANDED";
  readonly occupies: readonly string[];
  readonly familyKey: string;
  readonly category: string | null;
  readonly handedness: string | null;
  readonly scalingModel: string;
  readonly power: number | null;
  readonly equipmentRole: string;
  readonly properties: readonly { readonly traitKey: string; readonly parameters: Readonly<Record<string, number>>; readonly executionStatus: string }[];
}

export interface CharacterWeaponOption {
  readonly weapon: ProwessDefinitionRef;
  readonly familyKey: string;
  readonly profileKind: string;
  readonly equipmentRole: string;
  readonly category: string | null;
  readonly handedness: string | null;
  readonly scalingModel: string;
  readonly power: number | null;
  readonly requirements: readonly RequirementCheck[];
  /** Whether the Character may equip it (requirements met, held profile, authored handedness). */
  readonly equippable: boolean;
  readonly reasons: readonly string[];
}

export interface CharacterWeaponsView {
  readonly character: { readonly id: string; readonly name: string; readonly level: number };
  readonly release: CharacterReleaseSummary;
  readonly capability: WeaponCapability;
  readonly loadout: {
    readonly version: number;
    readonly status: ResolvedWeaponLoadout["status"];
    readonly issues: ResolvedWeaponLoadout["issues"];
    readonly mainHand: EquippedSummary | null;
    readonly offHand: EquippedSummary | null;
  };
  /** Every held Weapon profile the Character's exact Release pins (no ownership / inventory yet, §77). */
  readonly options: readonly CharacterWeaponOption[];
  readonly names: Readonly<Record<string, string>>;
}

export interface CharacterAttacksView {
  readonly character: { readonly id: string; readonly name: string; readonly level: number };
  readonly release: CharacterReleaseSummary;
  readonly loadoutVersion: number;
  readonly library: CharacterAttackLibrary;
  readonly names: Readonly<Record<string, string>>;
}

const EMPTY: WeaponLoadoutChoice = { mainHand: null, mainHandGrip: null, offHand: null };

/** The Character's equipped state, rebuilt from its exact Release (shared by the Weapon, Attack and Sheet reads). */
export async function loadEquippedCharacter(id: string): Promise<{
  readonly c: Awaited<ReturnType<typeof loadCompleted>>["c"];
  readonly bundle: ProwessDefinitionBundle;
  readonly ruleset: RulesetContext;
  readonly history: Awaited<ReturnType<typeof loadCompleted>>["history"];
  readonly base: CharacterMechanicalProfile;
  readonly profile: CharacterMechanicalProfile;
  readonly index: WeaponLibraryIndex;
  readonly choice: WeaponLoadoutChoice;
  readonly loadoutVersion: number;
  readonly resolved: ResolvedWeaponLoadout;
}> {
  const { c, bundle, ruleset, history, progression } = await loadCompleted(id);
  const base = requireProfile(profileOf(bundle, ruleset, progression));
  const stored = await selectWeaponLoadout(c.id);
  const choice: WeaponLoadoutChoice = stored === null ? EMPTY : { mainHand: stored.mainHand, mainHandGrip: stored.mainHandGrip, offHand: stored.offHand };
  const index = indexWeaponLibrary(bundle);
  const resolved = resolveWeaponLoadout({ bundle, profile: base, loadout: choice, index });
  // The ONE profile builder, with the additive equipment context (null ⇒ exactly the unequipped profile).
  const equipment = equipmentContextOf(resolved);
  const profile = equipment === null ? base : requireProfile(profileOf(bundle, ruleset, progression, equipment));
  return { c, bundle, ruleset, history, base, profile, index, choice, loadoutVersion: stored?.lockVersion ?? 0, resolved };
}

function summaryOf(e: ResolvedWeaponLoadout["mainHand"]): EquippedSummary | null {
  if (e === null) return null;
  const p = e.weapon.payload;
  return {
    weapon: e.weapon.ref,
    grip: e.grip,
    occupies: e.occupies,
    familyKey: p.familyKey,
    category: p.category,
    handedness: p.handedness,
    scalingModel: p.scalingModel,
    power: p.power,
    equipmentRole: p.equipmentRole,
    properties: e.weapon.weaponProperties.map((u) => ({ traitKey: u.traitKey, parameters: u.parameters, executionStatus: u.executionStatus })),
  };
}

/** The Character's loadout summary for the Sheet (and the Weapons read). */
export function loadoutSummary(state: { readonly loadoutVersion: number; readonly resolved: ResolvedWeaponLoadout }): CharacterWeaponsView["loadout"] {
  const ok = state.resolved.status === "VALID";
  return { version: state.loadoutVersion, status: state.resolved.status, issues: state.resolved.issues, mainHand: ok ? summaryOf(state.resolved.mainHand) : null, offHand: ok ? summaryOf(state.resolved.offHand) : null };
}

/** The names of every Weapon and Attack a library or loadout mentions (exact EntityVersion → display name). */
export function libraryRefs(library: CharacterAttackLibrary): ProwessDefinitionRef[] {
  const attacks: CharacterAttack[] = [...(library.unarmed?.attacks ?? []), ...(library.mainHand?.attacks ?? []), ...(library.offHand?.attacks ?? []), ...library.dualWield.sequences.flatMap((s) => [...s.attacks])];
  return [...attacks.flatMap((a) => [a.weapon, a.attack, ...a.weaponProperties.map((u) => u.trait), ...a.moveProperties.map((u) => u.trait)]), ...(library.unarmed === null ? [] : [library.unarmed.weapon])];
}

/** GET /api/characters/:id/weapons — the loadout and every Weapon the Character's exact Release offers. */
export async function getCharacterWeapons(id: string): Promise<CharacterWeaponsView> {
  const state = await loadEquippedCharacter(id);
  const { c, bundle, base, index } = state;
  const options: CharacterWeaponOption[] = index.weapons
    .filter((w) => w.payload.profileKind !== "UNARMED")
    .map((w) => {
      const requirements = checkWeaponRequirements(index, base, w.payload.requirements, w.ref);
      const reasons = [
        ...(w.payload.handedness === null ? ["no authored handedness — shown, never equipped"] : []),
        ...requirements.filter((r) => r.satisfied !== true).map((r) => `requires ${r.required} (has ${r.actual})`),
      ];
      return { weapon: w.ref, familyKey: w.payload.familyKey, profileKind: w.payload.profileKind, equipmentRole: w.payload.equipmentRole, category: w.payload.category, handedness: w.payload.handedness, scalingModel: w.payload.scalingModel, power: w.payload.power, requirements, equippable: reasons.length === 0, reasons };
    });
  const loadout = loadoutSummary(state);
  return {
    character: { id: c.id, name: c.name, level: c.level },
    release: await releaseSummary(c.rulesetReleaseId),
    capability: getWeaponCapability(bundle, index),
    loadout,
    options,
    names: await namesOf([...options.map((o) => o.weapon), loadout.mainHand?.weapon, loadout.offHand?.weapon]),
  };
}

/** GET /api/characters/:id/attacks — the Character Attack Library (preview only; nothing rolled or spent). */
export async function getCharacterAttacks(id: string): Promise<CharacterAttacksView> {
  const { c, bundle, base, choice, loadoutVersion } = await loadEquippedCharacter(id);
  // Requirements and Power read the Character's own (unequipped) profile; equipment never changes Stats or Martial rank.
  const library = buildCharacterAttackLibrary({ bundle, characterProfile: base, loadout: choice });
  return { character: { id: c.id, name: c.name, level: c.level }, release: await releaseSummary(c.rulesetReleaseId), loadoutVersion, library, names: await namesOf(libraryRefs(library)) };
}

const FIELDS = ["expectedVersion", "mainHand", "mainHandGrip", "offHand"];

/** PUT /api/characters/:id/weapon-loadout — strict choices only (§145); stale → 409; illegal → 422 with reasons. */
export async function updateCharacterWeaponLoadout(id: string, body: unknown): Promise<CharacterWeaponsView> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "The body is { expectedVersion, mainHand, mainHandGrip, offHand }");
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!FIELDS.includes(key)) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, `Unknown field "${key}" — only Weapons and grip are chosen; Power, damage, Attacks and bonuses are derived by the server`);
  const expected = raw.expectedVersion;
  if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, "expectedVersion is a non-negative whole number (0 when nothing has been saved yet)");
  const parsed = readWeaponLoadoutChoice({ mainHand: raw.mainHand ?? null, mainHandGrip: raw.mainHandGrip ?? null, offHand: raw.offHand ?? null });
  if (!parsed.ok) throw fail(CHARACTER_ERROR_CODES.INVALID_INPUT, parsed.message);
  const state = await loadEquippedCharacter(id);
  const resolved = resolveWeaponLoadout({ bundle: state.bundle, profile: state.base, loadout: parsed.value, index: state.index });
  if (resolved.status !== "VALID") throw fail(CHARACTER_ERROR_CODES.INVALID_LOADOUT, `This loadout is not legal for the Character: ${resolved.issues.map((i) => i.message).join("; ")}`);
  const out = await writeWeaponLoadout(state.c.id, expected, parsed.value);
  if (out.outcome === "stale") throw fail(CHARACTER_ERROR_CODES.STALE_WRITE, `This Character's Weapon loadout changed since it was loaded (now at version ${out.current}). Reload and try again.`);
  return getCharacterWeapons(id);
}
