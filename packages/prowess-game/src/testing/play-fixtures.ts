import { buildCharacterMechanicalProfile, previewCharacterAdvancement, type AdvancementChoices, type CharacterMechanicalProfile, type CommittedAdvancement } from "../character/advancement.js";
import { buildCharacterSheetMechanics } from "../character/sheet.js";
import { emptySignatureManeuverDraft, type SignatureManeuverDraft } from "../character/signature-maneuver.js";
import { emptySignatureSpellDraft, readSignatureSpellDraft, type SignatureSpellDraft } from "../character/signature-spell.js";
import type { ManeuverDefinitionPayload } from "../definition/authored-ability-payload.js";
import { buildCharacterAttackLibrary } from "../equipment/library.js";
import type { PlayAbilitySource } from "../play/abilities.js";
import { characterCoreOf } from "../play/engine.js";
import { evaluatePlayOperation, type PlayContext, type PlayStored } from "../play/operations.js";
import type { PlayOperationOutcome } from "../play/contract.js";
import { signatureManeuverFixture } from "./signature-maneuver-fixtures.js";
import { martialProfile, weaponFixture } from "./weapon-fixtures.js";
import type { FixtureRow } from "./character-fixtures.js";

/**
 * PAS-10 M6-WO10 TEST world (never canonical content, never published). ONE isolated test Release — the M6-WO8 Signature
 * Maneuver fixture, which already pins the Core Playtest runtime Resources / Actions / Terrains, the WO6 Weapon catalog,
 * the Spell and Maneuver components and the CURRENT construction rule (WO9 … WO13 policies) — and a real M6-WO4 profile:
 * a Level-5 Character trained in Arcana (Arcane Authority) and Martial MASTER, wielding a Long Blade one-handed. Its
 * Signature Abilities are drafts copied from the fixture's own authored Spell / Maneuver Definitions.
 */
export const PLAY_CHARACTER_ID = "00000000-0000-4000-8000-0000000c0010";
export const PLAY_RELEASE_ID = "00000000-0000-4000-8000-0000000e0010";
export const EMBER_ID = "00000000-0000-4000-8000-0000000a0101";
export const WARD_ID = "00000000-0000-4000-8000-0000000a0102";
export const STRIKE_ID = "00000000-0000-4000-8000-0000000a0103";

const NO_CHOICES = { statAllocations: {}, skillAdvancements: [], affinityChoice: null } as const;
const label = (key: string) => key.split(".").at(-1)!.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PlayWorld {
  readonly f: ReturnType<typeof signatureManeuverFixture>;
  readonly profile: CharacterMechanicalProfile;
  readonly context: PlayContext;
  readonly withAdvancement: (count: number) => PlayContext;
  /** The same Character with additional (test) Signature Spells. */
  readonly withSpells: (spells: readonly { readonly abilityId: string; readonly name: string; readonly effects: readonly (readonly [string, string, Record<string, unknown>?])[]; readonly duration: readonly [string, Record<string, unknown>]; readonly chain?: unknown }[]) => PlayContext;
}

let cached: PlayWorld | null = null;

export function playWorld(): PlayWorld {
  if (cached !== null) return cached;
  const f = signatureManeuverFixture();
  // Arcana (Arcane Authority) replaces the free Stealth pick; Martial replaces the free Arcana pick, upgraded twice.
  const creation = { ...f.creation, skills: f.creation.skills.map((s, i) => (i === 1 ? { ...s, skill: f.sel("skill.arcana") } : i === 2 ? { ...s, skill: f.sel("skill.martial") } : s)) };
  const steps: AdvancementChoices[] = [
    { ...NO_CHOICES, statAllocations: { PER: 1 } },
    { ...NO_CHOICES, statAllocations: { PRO: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: f.sel("skill.martial") }] },
    { ...NO_CHOICES, statAllocations: { AGI: 1 } },
    { ...NO_CHOICES, statAllocations: { CON: 1 }, skillAdvancements: [{ action: "UPGRADE", skill: f.sel("skill.martial") }] },
  ] as AdvancementChoices[];
  const history: CommittedAdvancement[] = [];
  let level = 1;
  for (const choices of steps) {
    const p = previewCharacterAdvancement({ bundle: f.bundle, ruleset: f.ruleset, character: { creation, level, history }, choices });
    if (p.status !== "READY") throw new Error(JSON.stringify(p.issues));
    history.push(p.record as CommittedAdvancement);
    level = p.toLevel as number;
  }
  const built = buildCharacterMechanicalProfile({ bundle: f.bundle, ruleset: f.ruleset, character: { creation, level, history } });
  if (built.profile === null) throw new Error(JSON.stringify(built.issues));
  const profile = built.profile;
  const loadout = { mainHand: f.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED" as const, offHand: null };
  const library = buildCharacterAttackLibrary({ bundle: f.bundle, characterProfile: profile, loadout });

  const spellDraft = (key: string, name: string): SignatureSpellDraft => {
    const c = (f.bundle.definitions.find((d) => d.canonicalKey === key)!.payload as unknown as { composition: Record<string, Loose> }).composition;
    const pick = ({ componentKey, definition, order, parameters }: Record<string, Loose>) => ({ componentKey, definition, order, parameters });
    const raw = {
      ...emptySignatureSpellDraft(name),
      authority: c.authority.authority,
      affinity: c.affinity?.definition ?? null,
      targeting: { definition: c.targeting.definition, parameters: c.targeting.parameters },
      effects: c.effects.map(pick),
      effectChain: c.branch?.effectChain ?? null,
      traits: c.traits.map((t: Record<string, Loose>) => ({ ...pick(t), appliesTo: t.appliesTo })),
      duration: { definition: c.duration.definition, parameters: c.duration.parameters },
      castingConditions: c.conditions.map(pick),
    };
    const read = readSignatureSpellDraft(JSON.parse(JSON.stringify(raw)));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    return read.value;
  };
  const maneuverDraft = (key: string, name: string): SignatureManeuverDraft => {
    const p = f.bundle.definitions.find((d) => d.canonicalKey === `fixture.wo11.maneuver.${key}`)!.payload as unknown as ManeuverDefinitionPayload;
    const a0 = library.mainHand!.attacks[0]!;
    return {
      ...emptySignatureManeuverDraft(name),
      actions: p.actions.map((a) => ({ componentKey: a.componentKey, order: a.order, source: a.definition.canonicalKey.includes(".attack.") ? { kind: "WEAPON_ATTACK" as const, attackKey: a0.attackKey, weapon: a0.weapon, attack: a0.attack, damageProfileKey: a0.damage[0]!.profileKey } : { kind: "FOUNDATION" as const, definition: a.definition } })),
      effects: p.composition.effects,
      traits: p.composition.traits,
      duration: p.composition.duration ? { definition: p.composition.duration.definition, parameters: p.composition.duration.parameters } : null,
      conditions: p.composition.conditions,
      effectAttachments: p.effectAttachments,
      powerfulBlow: p.powerfulBlow,
    };
  };
  /** A Spell draft over the same Arcane-Authority base with exact Effect Uses, Duration and authored Effect Chain. */
  const customSpell = (name: string, effects: readonly (readonly [string, string, Record<string, unknown>?])[], duration: readonly [string, Record<string, unknown>], effectChain: unknown = null): SignatureSpellDraft => {
    const base = spellDraft("fixture.spell.simple", name);
    const raw = { ...base, traits: [], effects: effects.map(([componentKey, key, parameters], order) => ({ componentKey, definition: f.ref(key), order: order + 1, parameters: parameters ?? {} })), effectChain, duration: { definition: f.ref(duration[0]), parameters: duration[1] } };
    const read = readSignatureSpellDraft(JSON.parse(JSON.stringify(raw)));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    return read.value;
  };
  const source = <D,>(abilityId: string, name: string, draft: D): PlayAbilitySource<D> => ({ abilityId, name, status: "ACTIVE", revisionNumber: 1, revisionReleaseId: PLAY_RELEASE_ID, draft, usedSlots: 2 });
  const mechanics = buildCharacterSheetMechanics({ bundle: f.bundle, ruleset: f.ruleset, profile });
  const context = (advancementCount: number): PlayContext => ({
    characterId: PLAY_CHARACTER_ID,
    releaseId: PLAY_RELEASE_ID,
    characterName: "Play Tester",
    level: profile.level,
    advancementCount,
    bundle: f.bundle,
    ruleset: f.ruleset,
    profile,
    equippedProfile: profile,
    maneuverAttackLibrary: library,
    attackLibrary: library,
    keywords: (f.request("fixture.wo11.maneuver.basic") as unknown as { keywords: unknown }).keywords,
    spells: [source(EMBER_ID, "Ember Bolt", spellDraft("fixture.spell.simple", "Ember Bolt")), source(WARD_ID, "Steady Ward", spellDraft("fixture.wo9.spell.sustained", "Steady Ward"))],
    maneuvers: [source(STRIKE_ID, "Twin Strike", maneuverDraft("multi", "Twin Strike"))],
    casterCore: characterCoreOf(profile),
    characterDie: profile.characterDie,
    characterDc: mechanics.combat.characterDc.value,
    mechanics,
    names: Object.fromEntries(f.bundle.definitions.map((d) => [d.entityVersionId, label(d.canonicalKey)])),
  });
  const base = context(history.length);
  const withSpells: PlayWorld["withSpells"] = (extra) => ({ ...base, spells: [...base.spells, ...extra.map((x) => source(x.abilityId, x.name, customSpell(x.name, x.effects, x.duration, x.chain ?? null)))] });
  cached = { f, profile, context: base, withAdvancement: context, withSpells };
  return cached;
}

/** A test "server": evaluates an operation and, when COMMITTABLE, adopts its result as the new stored state. */
export function step(ctx: PlayContext, stored: PlayStored, operation: unknown): { readonly outcome: PlayOperationOutcome; readonly stored: PlayStored } {
  const outcome = evaluatePlayOperation(ctx, stored, operation);
  if (outcome.status !== "COMMITTABLE") return { outcome, stored };
  const sheet = (outcome.resourcesAfter ?? []).filter((r) => ctx.mechanics.resources.some((m) => m.resourceKey === r.resourceKey)).map((r) => ({ resourceKey: r.resourceKey, current: r.current }));
  return { outcome, stored: { sheetResources: sheet, runtime: outcome.runtimeAfter } };
}

export const EMPTY: PlayStored = { sheetResources: null, runtime: null };
export const roll = (...rolls: number[]) => ({ mode: "NORMAL", rolls, source: "PHYSICAL" });

let improvementCached: PlayContext | null = null;
/**
 * A second isolated test Release: the Weapon fixture with ONE test ACTION_IMPROVEMENT (the M6-WO9 Phase B shape — never
 * canon): "Quick Dodge" sets the Dodge Action's AP to 2 from Level 3. The Character is the Level-3 Martial EXPERT.
 */
export function improvementWorld(): PlayContext {
  if (improvementCached !== null) return improvementCached;
  const probe = weaponFixture();
  const row = { canonicalKey: "test.m6wo10.improvement.quick_dodge", definitionKind: "ACTION_IMPROVEMENT", schemaVersion: 1, payload: { improvementKey: "QUICK_DODGE", action: probe.ref("action.dodge"), rulesText: "Test improvement quick dodge.", prerequisites: [{ prerequisiteKey: "LEVEL_3", kind: "LEVEL_AT_LEAST", minimum: 3 }], modifications: [{ modificationKey: "QUICK", kind: "ACTION_POINT_COST", rulesText: "Test cost QUICK.", condition: null, actionPointCost: { model: "FIXED", amount: 2 } }], source: { locators: ["s44"], conflicts: [] } } } as FixtureRow;
  const wf = weaponFixture({ extra: [row] });
  const profile = martialProfile(wf, "EXPERT");
  const library = buildCharacterAttackLibrary({ bundle: wf.bundle, characterProfile: profile, loadout: { mainHand: null, mainHandGrip: null, offHand: null } as never });
  const mechanics = buildCharacterSheetMechanics({ bundle: wf.bundle, ruleset: wf.ruleset, profile });
  improvementCached = {
    characterId: PLAY_CHARACTER_ID, releaseId: PLAY_RELEASE_ID, characterName: "Improvement Tester", level: profile.level, advancementCount: 2,
    bundle: wf.bundle, ruleset: wf.ruleset, profile, equippedProfile: profile, maneuverAttackLibrary: library, attackLibrary: library, keywords: [], spells: [], maneuvers: [],
    casterCore: characterCoreOf(profile), characterDie: profile.characterDie, characterDc: mechanics.combat.characterDc.value, mechanics,
    names: Object.fromEntries(wf.bundle.definitions.map((d) => [d.entityVersionId, label(d.canonicalKey)])),
  };
  return improvementCached;
}
