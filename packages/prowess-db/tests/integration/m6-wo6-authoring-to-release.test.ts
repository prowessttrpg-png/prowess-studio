/**
 * PAS-10 M6-WO6 §92–§95, §140, §164 — Compendium Admin → Canon → Release → Character, for Weapons. An Equipment Trait,
 * its Power-scaling / Versatile rules, an Attack and a Weapon naming the exact Attack revision are authored through the
 * M6-WO1 Compendium authoring services (validated by the WO6 contracts on create and on submit), proposed to the Ruleset
 * through WO1's ChangeSet proposal, approved and published through M2 — never auto-published. The materialized Release
 * carries exactly the authored content, and a Character on it equips the authored Weapon. Fixture content is
 * `test.m6wo6auth.*`. Invariants: M6-I057 (exact Attack identity), M6-I064 (Release-scoped refs).
 */
import { PROWESS_DEFINITION_KINDS, indexWeaponLibrary, type ProwessDefinitionKind, type ProwessDefinitionRef } from "@prowess/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  createAuthoredDefinition,
  createCharacter,
  finalizeCharacterCoreCreation,
  getCharacterAttacks,
  materializeProwessDefinitionsFromRelease,
  prisma,
  proposeDefinitionChangeSet,
  publishRulesetRelease,
  saveCharacterCreation,
  submitAuthoredRevisionForReview,
  submitChangeSetForReview,
  transitionEntityVersionStatus,
  updateCharacterWeaponLoadout,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, seedCharacterRelease, workedChoices, type CharacterReleaseWorld, type Pin } from "../fixtures/m6-wo3-character-release";
import { WEAPON_DEFINITIONS, resolveContentRefs } from "../../../prowess-game/src/testing/weapon-fixtures.js";

const PREFIX = "test.m6wo6auth";
let world: CharacterReleaseWorld;
let releaseId = "";
let manifestId = "";
const pins = new Map<string, Pin>();
const payloadOf = (key: string) => WEAPON_DEFINITIONS.find((d) => d.canonicalKey === key)!.payload;
const refOf = (contentKey: string): ProwessDefinitionRef => {
  const p = pins.get(contentKey);
  if (p === undefined) throw new Error(`no pin for ${contentKey}`);
  return { entityId: p.entityId, entityVersionId: p.entityVersionId, canonicalKey: p.canonicalKey, definitionKind: p.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[p.definitionKind].family } as unknown as ProwessDefinitionRef;
};

/** Author (WO1) → submit (WO1, contract-checked) → approve (M1) → propose (WO1) → approve + publish (M2). */
async function authorAndPublish(contentKey: string, kind: ProwessDefinitionKind, payload: unknown, displayName: string) {
  const canonicalKey = `${PREFIX}.${contentKey.replace(/\./g, "_")}_${Date.now()}`;
  const { entity, version } = await createAuthoredDefinition({ definitionKind: kind, canonicalKey, displayName, prowessDefinition: { schemaVersion: 1, systemFamily: PROWESS_DEFINITION_KINDS[kind].family, definitionKind: kind, payload } });
  await submitAuthoredRevisionForReview(version.id);
  // Authoring never publishes (§140): the revision is not in any Release until the ChangeSet is approved and published.
  expect(await prisma.rulesetManifestEntry.count({ where: { entityVersionId: version.id } })).toBe(0);
  await transitionEntityVersionStatus(version.id, "APPROVED");
  const cs = await proposeDefinitionChangeSet(version.id, { rulesetId: world.rulesetId, name: `Add ${displayName} ${Date.now()}` });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  const release = await publishRulesetRelease({ rulesetId: world.rulesetId, baseManifestId: manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: `+${displayName}` });
  releaseId = release.id;
  manifestId = release.manifestId;
  pins.set(contentKey, { entityId: entity.id, entityVersionId: version.id, canonicalKey, definitionKind: kind });
}

describe("M6-WO6 §164 — Weapons authored through Compendium Admin reach a Character (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    world = await seedCharacterRelease(PREFIX, "R0", { advancement: true });
    releaseId = world.release.id;
    manifestId = world.release.manifestId;
  }, 300_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 300_000);

  it("Trait → rules → Attack → Weapon (exact Moveset) → validate → submit → publish → materialize → exact content → equip", async () => {
    // A contract-violating Weapon is refused at authoring time (WO6 contract runs inside WO1 validation).
    const bad = await createAuthoredDefinition({ definitionKind: "WEAPON", canonicalKey: `${PREFIX}.bad_${Date.now()}`, displayName: "Bad", prowessDefinition: { schemaVersion: 1, systemFamily: "EQUIPMENT", definitionKind: "WEAPON", payload: { ...payloadOf("weapon.rifle"), power: 0 } } });
    expect(bad.validation.status).toBe("FAIL");
    expect(JSON.stringify(bad.validation)).toMatch(/STATIC Weapon has no Power/);
    await expect(submitAuthoredRevisionForReview(bad.version.id)).rejects.toThrow();

    for (const key of ["equipment.trait.pierce", "equipment.trait.close", "equipment.trait.reinforced", "equipment.trait.brace", "equipment.trait.power_scaling", "equipment.trait.versatile"]) await authorAndPublish(key, "EQUIPMENT_TRAIT", payloadOf(key), `${key.split(".").pop()} (authored)`);
    for (const key of ["attack.long_blade.slash", "attack.long_blade.stab", "attack.long_blade.bash"]) await authorAndPublish(key, "ATTACK", resolveContentRefs(payloadOf(key), refOf), `${key} (authored)`);
    const weapon = resolveContentRefs(payloadOf("weapon.long_blade"), refOf) as Record<string, unknown>;
    await authorAndPublish("weapon.long_blade", "WEAPON", weapon, "Long Blade (authored)");

    const { bundle } = await materializeProwessDefinitionsFromRelease(releaseId);
    const stored = bundle.definitions.find((d) => d.entityVersionId === pins.get("weapon.long_blade")!.entityVersionId)!;
    expect(stored.definitionKind).toBe("WEAPON");
    expect(stored.payload).toEqual(weapon);
    const index = indexWeaponLibrary(bundle);
    expect(index.issues).toEqual([]);
    expect(index.weapons.map((w) => w.attacks.map((a) => a.ref.entityVersionId))).toEqual([["attack.long_blade.slash", "attack.long_blade.stab", "attack.long_blade.bash"].map((k) => pins.get(k)!.entityVersionId)]);

    const c = await createCharacter({ name: "Authored Blade", rulesetReleaseId: releaseId });
    const saved = await saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: workedChoices(world.pins) });
    await finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion });
    const w = pins.get("weapon.long_blade")!;
    await updateCharacterWeaponLoadout(c.id, { expectedVersion: 0, mainHand: { entityId: w.entityId, entityVersionId: w.entityVersionId }, mainHandGrip: "TWO_HANDED", offHand: null });
    const lib = (await getCharacterAttacks(c.id)).library;
    expect(lib.mainHand?.attacks.map((a) => `${a.moveKey} ${a.damage[0]?.final?.expression}`)).toEqual(["SLASH 2d10", "STAB 2d8", "BASH 2d6"]);
    // No Unarmed profiles were authored: the Attack Library capability says so; the Weapon Library is ready.
    expect(lib.capability.weaponLibrary.status).toBe("WEAPON_LIBRARY_READY");
    expect(lib.capability.attackLibrary.missing.map((m) => m.requirement)).toContain("UNARMED");
  }, 600_000);
});
