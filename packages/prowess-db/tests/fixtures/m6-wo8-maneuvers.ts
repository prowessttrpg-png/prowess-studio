import { advanceCharacter, createCharacter, finalizeCharacterCoreCreation, getCharacterAttacks, saveCharacterCreation, updateCharacterWeaponLoadout } from "../../src/index";
import { refOf, selOf, workedChoices, type CharacterReleaseWorld } from "./m6-wo3-character-release";
import type { CharacterAttack, SignatureManeuverDraft } from "@prowess/game";

export async function martialCharacter(w: CharacterReleaseWorld, name: string, master = false) {
  const c = await createCharacter({ name, rulesetReleaseId: w.release.id });
  const choices = workedChoices(w.pins), candidate = { ...choices, skills: choices.skills.map((s, i) => i === 1 ? { ...s, skill: selOf(w.pins, "skill.martial") } : i === 2 ? { ...s, skill: selOf(w.pins, "skill.arcana") } : s) };
  const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate });
  let character = await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
  if (master) for (const [stat, upgrade] of [["PER", false], ["PRO", true], ["AGI", false], ["CON", true]] as const) character = await advanceCharacter(c.id, { expectedLockVersion: character.lockVersion, choices: { statAllocations: { [stat]: 1 }, skillAdvancements: upgrade ? [{ action: "UPGRADE", skill: selOf(w.pins, "skill.martial") }] : [], affinityChoice: null } });
  await updateCharacterWeaponLoadout(c.id, { expectedVersion: 0, mainHand: selOf(w.pins, "weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null });
  const attacks = await getCharacterAttacks(c.id);
  return { character, attack: attacks.library.mainHand!.attacks[0]!, loadoutVersion: attacks.loadoutVersion };
}
export function maneuverDraft(w: CharacterReleaseWorld, attack: CharacterAttack, name = "Exact Strike"): SignatureManeuverDraft {
  return { schemaVersion: 1, concept: { name, description: "", visualDescription: "", notes: "", narrativeTags: [] }, actions: [{ componentKey: "attack", order: 1, source: { kind: "WEAPON_ATTACK", weapon: attack.weapon, attack: attack.attack, attackKey: attack.attackKey, damageProfileKey: attack.damage[0]!.profileKey } }], affinity: null, effects: [{ componentKey: "effect", order: 1, definition: refOf(w.pins, "test.wo8.effect.enhancement"), parameters: {} }], effectAttachments: [{ effectKey: "effect", actionKeys: ["attack"] }], traits: [], duration: { definition: refOf(w.pins, "maneuver.duration.instant"), parameters: {} }, conditions: [], powerfulBlow: null };
}
export function spellDraft(w: CharacterReleaseWorld, name = "Spell") {
  const use = (key: string, parameters: Record<string, unknown> = {}) => ({ definition: refOf(w.pins, key), parameters });
  return { schemaVersion: 1, concept: { name, description: "", visualDescription: "", notes: "", narrativeTags: [] }, authority: "ARCANE_AUTHORITY", affinity: null, targeting: use("spell.targeting.single_target"), effects: [{ componentKey: "effect1", order: 1, ...use("fixture.wo10.effect.damage", { dice: 1, mp: 8 }) }], effectChain: null, traits: [], duration: use("spell.duration.instant"), castingConditions: [], constructionOptions: { effectSlotsTradedForTraits: 0 }, additionalAffinityTraits: [] };
}
