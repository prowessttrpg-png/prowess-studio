import {
  getWeaponCapability,
  indexWeaponLibrary,
  type AttackDefinitionPayload,
  type EquipmentTraitPayload,
  type ProwessDefinitionRef,
  type ResolvedTraitUse,
  type WeaponCapability,
  type WeaponDefinitionPayload,
  type WeaponLibraryIssue,
} from "@prowess/game";
import { selectVersionDisplay } from "../character/repository.js";
import { materializeProwessDefinitionsFromRelease } from "../prowess-definition/service.js";
import { requireRelease, requireRuleset, type ReferenceReleaseSummary, type ReferenceRulesetSummary } from "../compendium-reference/service.js";

/**
 * Weapon & Attack Library reference reads (PAS-10 M6-WO6 §89–§91, §94). A separate module from the M6-WO2 Rules
 * Reference (which never re-validates content): the Weapon Library MATERIALIZES the exact Release so @prowess/game can
 * check every Moveset / property reference and report capability. It reuses only WO2's exact Ruleset / Release lookup. The Library of ONE exact Release — its pinned
 * WEAPON / ATTACK / EQUIPMENT_TRAIT revisions read through @prowess/game (exact refs, coherence, capability) — never a
 * latest revision and never a canonical-key or name lookup. Read-only. Display names come from each exact EntityVersion.
 */

export interface ReferenceTraitUse {
  readonly trait: ProwessDefinitionRef;
  readonly traitKey: string;
  readonly displayName: string;
  readonly parameters: Readonly<Record<string, number>>;
  readonly executionStatus: string;
  readonly summary: string;
}

export interface ReferenceAttack {
  readonly attack: ProwessDefinitionRef;
  readonly displayName: string;
  readonly revisionNumber: number | null;
  readonly payload: AttackDefinitionPayload;
  /** The Attack's effective scaling under its parent Weapon (POWER / STATIC). */
  readonly scaling: string;
  readonly moveProperties: readonly ReferenceTraitUse[];
  /** The exact Weapons in this Release whose Moveset names this Attack. */
  readonly weapons: readonly { readonly weapon: ProwessDefinitionRef; readonly displayName: string }[];
}

export interface ReferenceWeapon {
  readonly weapon: ProwessDefinitionRef;
  readonly displayName: string;
  readonly revisionNumber: number | null;
  readonly payload: WeaponDefinitionPayload;
  readonly weaponProperties: readonly ReferenceTraitUse[];
  readonly moveset: readonly ReferenceAttack[];
  readonly scalingRule: ReferenceTraitUse | null;
  readonly versatileRule: ReferenceTraitUse | null;
}

export interface ReferenceWeaponLibrary {
  readonly ruleset: ReferenceRulesetSummary;
  readonly release: ReferenceReleaseSummary;
  readonly capability: WeaponCapability;
  readonly weapons: readonly ReferenceWeapon[];
  readonly excluded: readonly { readonly weapon: ProwessDefinitionRef; readonly displayName: string }[];
  readonly traits: readonly { readonly trait: ProwessDefinitionRef; readonly displayName: string; readonly payload: EquipmentTraitPayload }[];
  readonly issues: readonly WeaponLibraryIssue[];
}

async function libraryOf(rulesetId: string, releaseId: string): Promise<ReferenceWeaponLibrary> {
  const ruleset = await requireRuleset(rulesetId);
  const release = await requireRelease(ruleset, releaseId);
  const { bundle } = await materializeProwessDefinitionsFromRelease(release.id);
  const index = indexWeaponLibrary(bundle);
  const ids = bundle.definitions.filter((d) => ["WEAPON", "ATTACK", "EQUIPMENT_TRAIT"].includes(d.definitionKind)).map((d) => d.entityVersionId);
  const display = new Map((await selectVersionDisplay(ids)).map((v) => [v.id, v] as const));
  const name = (ref: ProwessDefinitionRef) => display.get(ref.entityVersionId)?.displayName ?? ref.canonicalKey;
  const revision = (ref: ProwessDefinitionRef) => display.get(ref.entityVersionId)?.revisionNumber ?? null;
  const use = (u: ResolvedTraitUse): ReferenceTraitUse => ({ trait: u.trait, traitKey: u.traitKey, displayName: name(u.trait), parameters: u.parameters, executionStatus: u.executionStatus, summary: u.summary });
  const parents = new Map<string, { weapon: ProwessDefinitionRef; displayName: string }[]>();
  for (const w of index.weapons) for (const a of w.attacks) parents.set(a.ref.entityVersionId, [...(parents.get(a.ref.entityVersionId) ?? []), { weapon: w.ref, displayName: name(w.ref) }]);
  const weapons: ReferenceWeapon[] = index.weapons.map((w) => ({
    weapon: w.ref,
    displayName: name(w.ref),
    revisionNumber: revision(w.ref),
    payload: w.payload,
    weaponProperties: w.weaponProperties.map(use),
    moveset: w.attacks.map((a) => ({ attack: a.ref, displayName: name(a.ref), revisionNumber: revision(a.ref), payload: a.payload, scaling: a.scaling, moveProperties: a.moveProperties.map(use), weapons: parents.get(a.ref.entityVersionId) ?? [] })),
    scalingRule: w.scalingRule === null ? null : use(w.scalingRule.use),
    versatileRule: w.versatileRule === null ? null : use(w.versatileRule.use),
  }));
  return {
    ruleset,
    release: { id: release.id, rulesetId: release.rulesetId, releaseNumber: release.releaseNumber, versionLabel: release.versionLabel, channel: release.channel, publishedAt: release.publishedAt },
    capability: getWeaponCapability(bundle, index),
    weapons,
    excluded: index.excluded.map((ref) => ({ weapon: ref, displayName: name(ref) })),
    traits: index.traits.map((t) => ({ trait: t.ref, displayName: name(t.ref), payload: t.payload })),
    issues: index.issues,
  };
}

/** GET …/releases/:releaseId/weapons — the exact Release's Weapon Library (Weapons, Movesets, Equipment Traits). */
export async function getReferenceWeaponLibrary(rulesetId: string, releaseId: string): Promise<ReferenceWeaponLibrary> {
  return libraryOf(rulesetId, releaseId);
}

/** GET …/releases/:releaseId/attacks — every exact Attack a coherent Weapon of this Release names, with its parents. */
export async function getReferenceAttackLibrary(rulesetId: string, releaseId: string): Promise<{ readonly ruleset: ReferenceRulesetSummary; readonly release: ReferenceReleaseSummary; readonly attacks: readonly ReferenceAttack[] }> {
  const library = await libraryOf(rulesetId, releaseId);
  const seen = new Set<string>();
  const attacks = library.weapons.flatMap((w) => w.moveset).filter((a) => (seen.has(a.attack.entityVersionId) ? false : (seen.add(a.attack.entityVersionId), true)));
  return { ruleset: library.ruleset, release: library.release, attacks };
}
