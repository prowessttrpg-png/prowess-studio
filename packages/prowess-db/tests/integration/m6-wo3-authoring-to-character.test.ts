/**
 * PAS-10 M6-WO3 §101 — Compendium Admin → Canon → Release → Character Builder, end to end in the database layer.
 *
 * Release R0 publishes only core + Affinity content (NOT Character-Creation capable). A Character Creation Rule, four
 * Skills and an Ancestry are then authored through the M6-WO1 Compendium authoring services (validated by the M5
 * contract on create and on submit), proposed to the Ruleset through WO1's own ChangeSet proposal, approved and published
 * through M2. The last Release is capable, and a Character built from it resolves exactly the authored revisions.
 * Fixture content is test-only (`test.m6wo3auth.*`). Invariant: M6-I027 (options are published Release content).
 */
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind, type ProwessDefinitionRef } from "@prowess/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  createAuthoredDefinition,
  createCharacter,
  finalizeCharacterCoreCreation,
  getReleaseCharacterCreationCapability,
  proposeDefinitionChangeSet,
  publishRulesetRelease,
  saveCharacterCreation,
  submitAuthoredRevisionForReview,
  submitChangeSetForReview,
  transitionEntityVersionStatus,
  validateCharacterCandidate,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";
import { cleanupCharacterWorlds, seedCharacterRelease, selOf, type CharacterReleaseWorld, type Pin } from "../fixtures/m6-wo3-character-release";
import { TEST_ANCESTRY_KEY, TEST_RULE_KEY, ancestryPayload, creationRulePayload, skillPayload } from "../../../prowess-game/src/testing/character-fixtures.js";

const PREFIX = "test.m6wo3auth";
const SKILLS = ["test.m6wo3.skill.athletics", "test.m6wo3.skill.survival", "test.m6wo3.skill.stealth", "test.m6wo3.skill.arcana"];
let world: CharacterReleaseWorld;
let releaseId = "";
let manifestId = "";
const pins = new Map<string, Pin>();

const envelope = (kind: ProwessDefinitionKind, payload: unknown) => ({ schemaVersion: 1, systemFamily: PROWESS_DEFINITION_KINDS[kind].family, definitionKind: kind, payload });
const refOf = (contentKey: string): ProwessDefinitionRef => {
  const p = pins.get(contentKey) ?? world.pins.get(contentKey);
  if (p === undefined) throw new Error(`no pin for ${contentKey}`);
  return { entityId: p.entityId, entityVersionId: p.entityVersionId, canonicalKey: p.canonicalKey, definitionKind: p.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[p.definitionKind].family } as unknown as ProwessDefinitionRef;
};

/** Author (WO1) → submit (WO1, contract-checked) → approve (M1) → propose (WO1) → approve + publish (M2). */
async function authorAndPublish(contentKey: string, kind: ProwessDefinitionKind, payload: unknown, displayName: string) {
  const canonicalKey = `${PREFIX}.${contentKey.replace(/\./g, "_")}_${Date.now()}`;
  const { entity, version } = await createAuthoredDefinition({ definitionKind: kind, canonicalKey, displayName, prowessDefinition: envelope(kind, payload) });
  await submitAuthoredRevisionForReview(version.id);
  await transitionEntityVersionStatus(version.id, "APPROVED");
  const cs = await proposeDefinitionChangeSet(version.id, { rulesetId: world.rulesetId, name: `Add ${displayName} ${Date.now()}` });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  const release = await publishRulesetRelease({ rulesetId: world.rulesetId, baseManifestId: manifestId, canonPolicyId: world.policyId, changeSetId: cs.id, versionLabel: `+${displayName}` });
  releaseId = release.id;
  manifestId = release.manifestId;
  pins.set(contentKey, { entityId: entity.id, entityVersionId: version.id, canonicalKey, definitionKind: kind });
}

describe("M6-WO3 §101 — Definitions authored through Compendium Admin build a Character (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    await cleanupCharacterWorlds(PREFIX);
    world = await seedCharacterRelease(PREFIX, "R0", { characterContent: false });
    releaseId = world.release.id;
    manifestId = world.release.manifestId;
  }, 180_000);
  afterAll(async () => {
    await cleanupCharacterWorlds(PREFIX);
  }, 120_000);

  it("a Release without Character content is MISSING_REQUIRED_CONTENT and refuses new Characters", async () => {
    const capability = await getReleaseCharacterCreationCapability(world.release.id);
    expect(capability.status).toBe("MISSING_REQUIRED_CONTENT");
    expect(capability.missing.map((m) => m.requirement)).toEqual(expect.arrayContaining(["CHARACTER_CREATION_RULE", "ANCESTRY", "SKILL"]));
    await expect(createCharacter({ name: "Too Early", concept: null, rulesetReleaseId: world.release.id })).rejects.toMatchObject({ code: "CHARACTER.RELEASE_NOT_CAPABLE" });
  });

  it("authored Creation Rule, Skills and Ancestry are published and consumed by Character creation", async () => {
    await authorAndPublish(TEST_RULE_KEY, "CHARACTER_CREATION_RULE", creationRulePayload(), "Creation Rule (authored)");
    for (const k of SKILLS) await authorAndPublish(k, "SKILL", skillPayload(), `${k.split(".").pop()} (authored)`);
    await authorAndPublish(TEST_ANCESTRY_KEY, "ANCESTRY", ancestryPayload(refOf), "Orcani (authored)");

    expect((await getReleaseCharacterCreationCapability(releaseId)).status).toBe("READY");
    const character = await createCharacter({ name: "Authored Grukk", concept: null, rulesetReleaseId: releaseId });
    expect(character.level).toBe(1);
    const candidate = {
      ancestry: selOf(pins, TEST_ANCESTRY_KEY),
      ancestryStatChoices: [
        { grantKey: "orcani_versatility", stat: "AGI" },
        { grantKey: "orcani_versatility", stat: "PRO" },
      ],
      statAllocations: { STR: 3, AGI: 3, CON: 3, PER: 2, RES: 2, PRO: 2 },
      skills: [
        { skill: selOf(pins, "test.m6wo3.skill.survival"), sourceKind: "ANCESTRY", sourceGrantKey: "orcani_upbringing" },
        { skill: selOf(pins, "test.m6wo3.skill.stealth"), sourceKind: "FREE", sourceGrantKey: null },
        { skill: selOf(pins, "test.m6wo3.skill.arcana"), sourceKind: "FREE", sourceGrantKey: null },
      ],
      primaryAffinity: selOf(world.pins, "affinity.evocation"),
    };
    const v = await validateCharacterCandidate(character.id, candidate);
    expect(v.issues).toEqual([]);
    expect(v.status).toBe("READY");
    expect(v.resolved.ancestry?.entityVersionId).toBe(pins.get(TEST_ANCESTRY_KEY)?.entityVersionId);
    expect(v.resolved.creationRule?.entityVersionId).toBe(pins.get(TEST_RULE_KEY)?.entityVersionId);
    expect(v.resolved.skills.map((s) => s.skill.entityVersionId).sort()).toEqual(
      ["test.m6wo3.skill.survival", "test.m6wo3.skill.stealth", "test.m6wo3.skill.arcana"].map((k) => pins.get(k)?.entityVersionId).sort(),
    );
    const saved = await saveCharacterCreation(character.id, { expectedLockVersion: character.lockVersion, candidate });
    const done = await finalizeCharacterCoreCreation(character.id, { expectedLockVersion: saved.lockVersion });
    expect(done.status).toBe("CORE_COMPLETE");
    const preview = Object.fromEntries((done.resolution.derivedPreview ?? []).map((d) => [d.statistic, d.value]));
    expect(preview.MAXIMUM_HP).toBe(14);
    expect(preview.SIGNATURE_ABILITY_SLOTS).toBe(4);
  }, 180_000);
});
