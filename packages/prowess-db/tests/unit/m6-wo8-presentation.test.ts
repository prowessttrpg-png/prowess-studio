import { performanceForDisplay } from "../../src/character/signature-maneuver-presentation";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signatureManeuverFixture } from "../../../prowess-game/src/testing/signature-maneuver-fixtures";
import { martialProfile } from "../../../prowess-game/src/testing/weapon-fixtures";
import { buildCharacterAttackLibrary } from "../../../prowess-game/src/equipment/library";
import { buildSignatureManeuverCatalog } from "../../../prowess-game/src/character/signature-maneuver-catalog";
import { emptySignatureManeuverDraft, readSignatureManeuverDraft, evaluateCharacterSignatureManeuver, type SignatureManeuverDraft } from "../../../prowess-game/src/character/signature-maneuver";
import type { ManeuverDefinitionPayload } from "../../../prowess-game/src/definition/authored-ability-payload";

/** Test-only wire responses evaluated by the real engine; never loaded by application/runtime code or published. */
describe("M6-WO8 presentation fixture from the approved Release fixture", () => {
  it("pins actual engine results for incomplete, multi-Action, Powerful Blow, scoped Traits and Performance", { timeout: 180_000 }, () => {
    const f = signatureManeuverFixture(), original = martialProfile(f, "MASTER");
    const profile = { ...original, constructionContext: { ...original.constructionContext, skillRanks: [...original.constructionContext.skillRanks, { skillKey: f.ref("test.wo8.skill.performance").canonicalKey, rankKey: "MASTER" }] } };
    const attackLibrary = buildCharacterAttackLibrary({ bundle: f.bundle, characterProfile: profile, loadout: { mainHand: f.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null } });
    const attack = attackLibrary.mainHand!.attacks[0]!;
    const fromCanonical = (key: string): SignatureManeuverDraft => {
      const p = f.bundle.definitions.find(d => d.canonicalKey === key)!.payload as unknown as ManeuverDefinitionPayload;
      return { ...emptySignatureManeuverDraft("Maneuver fixture"), actions: p.actions.map(a => ({ componentKey: a.componentKey, order: a.order, source: a.definition.canonicalKey.includes(".attack.") ? { kind: "WEAPON_ATTACK", attackKey: attack.attackKey, weapon: attack.weapon, attack: attack.attack, damageProfileKey: attack.damage[0]!.profileKey } : { kind: "FOUNDATION", definition: a.definition } })), effects: p.composition.effects, effectAttachments: p.effectAttachments, traits: p.composition.traits, duration: p.composition.duration ? { definition: p.composition.duration.definition, parameters: p.composition.duration.parameters } : null, conditions: p.composition.conditions, powerfulBlow: p.powerfulBlow, affinity: null };
    };
    const names = Object.fromEntries(f.bundle.definitions.map(d => [d.entityVersionId, d.canonicalKey.split(".").at(-1)!.replaceAll("_", " ")]));
    const catalog = buildSignatureManeuverCatalog({ bundle: f.bundle, profile, attackLibrary });
    const performance = performanceForDisplay({ bundle: f.bundle, profile, attackLibrary }, catalog);
    const basic = fromCanonical("fixture.wo11.maneuver.basic");
    const cases: Record<string, SignatureManeuverDraft> = { empty: emptySignatureManeuverDraft("New Maneuver"), basic, multi: fromCanonical("fixture.wo11.maneuver.multi"), powerful: fromCanonical("fixture.wo11.maneuver.powerful_blow"), scoped: fromCanonical("test.wo8.maneuver.master_reference"), performance: { ...basic, conditions: [{ componentKey: "performance", order: 1, definition: f.ref("maneuver.condition.performance"), parameters: {} }] } };
    const views = Object.fromEntries(Object.entries(cases).map(([key, draft]) => {
      expect(readSignatureManeuverDraft(draft).ok, key).toBe(true);
      const evaluation = evaluateCharacterSignatureManeuver({ bundle: f.bundle, ruleset: f.ruleset, profile, attackLibrary, keywords: [], draft, usedSlots: 0, subject: { kind: "CHARACTER_SIGNATURE_MANEUVER", characterId: "character", signatureAbilityId: "maneuver", revisionNumber: null } });
      if (key !== "empty") expect(evaluation.state, key).toMatch(/^VALID/);
      return [key, { character: { id: "character", name: "Maneuver Tester", level: profile.level, lockVersion: 1 }, release: { id: "release", rulesetId: f.ruleset.rulesetId, name: "Approved test Release", rulesetName: "Test" }, signature: { capacity: profile.signatureCapacity, used: 0 }, maneuver: { id: "maneuver", abilityKind: "MANEUVER", status: "DRAFT", lockVersion: 1, createdAt: "2026-11-04T00:00:00Z", retiredAt: null, current: null, draft: { draft, evaluation }, state: evaluation.state }, history: [], names, catalog, performance, stats: profile.constructionContext.stats, loadoutVersion: 1 }];
    }));
    const file = new URL("../../../../apps/studio/tests/unit/fixtures/m6-wo8-builder.json", import.meta.url);
    const normalized = JSON.parse(JSON.stringify(views));
    if (process.env.M6_WO8_WRITE_UI_FIXTURE === "1") writeFileSync(file, JSON.stringify(normalized, null, 2) + "\n");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(normalized);
  });
});
