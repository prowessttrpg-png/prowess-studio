import { describe, expect, it, vi } from "vitest";
import { compileAbilityExecution } from "./ability/effect-execution.js";
import type { CharacterMechanicalProfile } from "./character/advancement.js";
import { emptySignatureSpellDraft, evaluateCharacterSignatureSpell, readSignatureSpellDraft, type CharacterSpellSubject, type SignatureSpellDraft } from "./character/signature-spell.js";
import { emptySignatureManeuverDraft, evaluateCharacterSignatureManeuver, type SignatureManeuverDraft } from "./character/signature-maneuver.js";
import { buildCharacterAttackLibrary } from "./equipment/library.js";
import type { ManeuverDefinitionPayload } from "./definition/authored-ability-payload.js";
import { projectManeuverCard, projectSpellCard, type CardProjectionContext } from "./card/projection.js";
import { spellDeliveryOf } from "./card/semantics.js";
import { CARD_CONTRACT_VERSION } from "./card/contract.js";
import { executionFixture } from "./testing/effect-execution-fixtures.js";
import { signatureSpellFixture } from "./testing/signature-spell-fixtures.js";
import { signatureManeuverFixture } from "./testing/signature-maneuver-fixtures.js";
import { spellCostCharacter } from "./testing/spell-cost-fixtures.js";
import { martialProfile } from "./testing/weapon-fixtures.js";

/**
 * PAS-10 M6-WO9 Phase A — Spell and Maneuver card projections over the real M6-WO7 / M6-WO8 evaluations: every cost,
 * range and outcome on the card is the evaluation's own value; unresolved values are typed (never zero); exact
 * identity and provenance are retained; Maneuvers keep their independent resolution groups (the additive WO8 change).
 */
vi.setConfig({ testTimeout: 180_000 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only structural access to fixture payloads
type Loose = any;
const sf = signatureSpellFixture();
const spellPayload = (key: string) => sf.bundle.definitions.find((d) => d.canonicalKey === key)!.payload as unknown as { composition: Record<string, Loose>; constructionOptions: { effectSlotsTradedForTraits: number }; additionalAffinityTraits: string[] };
const pick = ({ componentKey, definition, order, parameters }: Record<string, Loose>) => ({ componentKey, definition, order, parameters });
function spellDraft(key: string, name = "Ember Bolt"): SignatureSpellDraft {
  const c = spellPayload(key).composition;
  const draft = {
    ...emptySignatureSpellDraft(name),
    authority: c.authority.authority,
    affinity: c.affinity?.definition ?? null,
    targeting: { definition: c.targeting.definition, parameters: c.targeting.parameters },
    effects: c.effects.map(pick),
    effectChain: c.branch.effectChain,
    traits: c.traits.map((t: Record<string, Loose>) => ({ ...pick(t), appliesTo: t.appliesTo })),
    duration: { definition: c.duration.definition, parameters: c.duration.parameters },
    castingConditions: c.conditions.map(pick),
    constructionOptions: spellPayload(key).constructionOptions,
    additionalAffinityTraits: spellPayload(key).additionalAffinityTraits,
  };
  const read = readSignatureSpellDraft(JSON.parse(JSON.stringify(draft)));
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}
const spellSubject: CharacterSpellSubject = { kind: "CHARACTER_SIGNATURE_SPELL", characterId: "00000000-0000-4000-8000-0000000c0001", signatureAbilityId: "00000000-0000-4000-8000-0000000a0001", revisionNumber: 2 };
function evaluateSpell(draft: SignatureSpellDraft) {
  const character = spellCostCharacter(4);
  const request = (sf as unknown as { request: (k: string, c: object) => { keywords: unknown; ruleset: unknown } }).request("fixture.spell.simple", character);
  return evaluateCharacterSignatureSpell({ bundle: sf.bundle, ruleset: request.ruleset, profile: { constructionContext: character } as unknown as CharacterMechanicalProfile, keywords: request.keywords, draft, usedSlots: 0, subject: spellSubject });
}
const context = (kind: "SPELL" | "MANEUVER", revisionRole: "CURRENT" | "DRAFT" | "HISTORICAL" = "CURRENT"): CardProjectionContext => ({
  characterId: "00000000-0000-4000-8000-0000000c0001",
  characterReleaseId: "00000000-0000-4000-8000-0000000r0001",
  identity: { kind, abilityId: "00000000-0000-4000-8000-0000000a0001", revisionNumber: revisionRole === "DRAFT" ? null : 2, revisionRole },
  names: {},
});

describe("Signature Spell cards", () => {
  it("copy the evaluation's cost, targeting, provenance and exact identity; the chain is the M5-WO12 chain", () => {
    const draft = spellDraft("fixture.wo10.spell.simple");
    const e = evaluateSpell(draft);
    expect(e.state).toBe("VALID");
    const card = projectSpellCard({ evaluation: e, draft, context: context("SPELL") });
    expect(card.contractVersion).toBe(CARD_CONTRACT_VERSION);
    expect(card.cardKey).toBe("SIGNATURE_SPELL:00000000-0000-4000-8000-0000000a0001:2");
    expect(card.availability).toBe("AVAILABLE");
    expect(card.costs.mp).toEqual({ status: "AVAILABLE", value: e.cost!.finalMpCost });
    expect(card.costs.ap).toEqual({ status: "AVAILABLE", value: e.cost!.ap.finalApCost });
    expect(card.costs.breakdown.filter((l) => l.currency === "MP" && l.source !== null).map((l) => l.value)).toEqual(e.cost!.mp.contributions.map((q) => q.value));
    expect(card.provenance.sources).toEqual(e.components);
    expect(card.provenance.rulesetProvenance).toEqual(e.rulesetProvenance);
    expect(card.snapshot.sources).toEqual(e.components.map((s) => s.entityVersionId));
    expect(card.snapshot.ability).toEqual(context("SPELL").identity);
    expect(card.rules.status).toBe("AVAILABLE");
    if (card.rules.status !== "AVAILABLE" || card.rules.value.kind !== "SPELL_CHAIN") throw new Error("rules");
    expect(card.rules.value.steps.map((s) => s.effectKey)).toEqual(e.chain!.nodes.map((n) => n.effectKey));
    expect(card.instructions.status).toBe("COMPLETE");
    expect(card.artwork).toEqual({ kind: "PLACEHOLDER" });
  });

  it("the Traits' actual compiled modifications are carried (not prose)", () => {
    const draft = spellDraft("fixture.wo10.spell.simple");
    const e = evaluateSpell(draft);
    const card = projectSpellCard({ evaluation: e, draft, context: context("SPELL") });
    expect(card.section.traits.map((t) => t.trait)).toEqual(e.authored!.traits.map((t) => t.definition));
    expect(card.section.traits.flatMap((t) => t.modifications.map((m) => m.kind))).toEqual(e.authored!.traits.flatMap((t) => t.modifications.map((m) => m.modification.kind)));
  });

  it("an unpriceable Spell (M5-SC-046) has typed unresolved costs — never zero — and no invented instructions", () => {
    const draft = spellDraft("fixture.wo10.spell.simple");
    const multi = sf.bundle.definitions.find((d) => d.canonicalKey === "spell.targeting.multi_target")!;
    const bad = { ...draft, targeting: { definition: { entityId: multi.entityId, entityVersionId: multi.entityVersionId, canonicalKey: multi.canonicalKey, definitionKind: multi.definitionKind, systemFamily: multi.systemFamily }, parameters: { targetCount: 2 } } } as SignatureSpellDraft;
    const card = projectSpellCard({ evaluation: evaluateSpell(bad), draft: bad, context: context("SPELL", "DRAFT") });
    expect(card.availability).toBe("INVALID");
    expect(card.costs.mp.status).toBe("UNAVAILABLE");
    expect(card.costs.ap.status).toBe("UNAVAILABLE");
    expect(JSON.stringify(card.costs)).toContain("M5-SC-046");
    expect(card.costs.breakdown).toEqual([]);
    expect(card.instructions.status).toBe("UNAVAILABLE");
    expect(card.cardKey).toBe("SIGNATURE_SPELL:00000000-0000-4000-8000-0000000a0001:draft");
  });

  it("an incomplete draft is INCOMPLETE with typed reasons", () => {
    const draft = readSignatureSpellDraft(JSON.parse(JSON.stringify(emptySignatureSpellDraft("Unfinished"))));
    if (!draft.ok) throw new Error("draft");
    const card = projectSpellCard({ evaluation: evaluateSpell(draft.value), draft: draft.value, context: context("SPELL", "DRAFT") });
    expect([card.availability, card.costs.mp.status, card.rules.status]).toEqual(["INCOMPLETE", "UNAVAILABLE", "UNAVAILABLE"]);
  });

  it("Mana Lock stays DEFERRED (M5-SC-052) and is listed as a limitation; no reserved amount appears", () => {
    const draft = spellDraft("fixture.wo10.spell.simple");
    const maint = sf.bundle.definitions.find((d) => d.canonicalKey === "fixture.wo9.effect.maintenance")!;
    const lock = sf.bundle.definitions.find((d) => d.canonicalKey === "spell.duration.mana_lock")!;
    const r = (d: typeof maint) => ({ entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily });
    const locked = { ...draft, effects: [{ componentKey: "effect1", definition: r(maint), order: 10, parameters: { amount: 1 } }], traits: [], duration: { definition: r(lock), parameters: {} } } as unknown as SignatureSpellDraft;
    const card = projectSpellCard({ evaluation: evaluateSpell(locked), draft: locked, context: context("SPELL") });
    expect(card.section.runtime.manaLock).toEqual({ status: "DEFERRED", conflictKey: "M5-SC-052", reason: "no exact Mana Lock reservation amount is authored" });
    expect(card.limitations.map((l) => l.code)).toContain("M5-SC-052");
    expect(JSON.stringify(card)).not.toMatch(/reservedMp"?:\s*\d/);
  });

  it("player prose never changes mechanics: a renamed Spell projects identical rules and costs", () => {
    const a = spellDraft("fixture.wo10.spell.simple", "Fireball");
    const b = { ...a, concept: { ...a.concept, name: "Healing Nova", description: "Ice and fire." } };
    const ca = projectSpellCard({ evaluation: evaluateSpell(a), draft: a, context: context("SPELL") });
    const cb = projectSpellCard({ evaluation: evaluateSpell(b), draft: b, context: context("SPELL") });
    expect([cb.name, cb.description]).toEqual(["Healing Nova", "Ice and fire."]);
    expect([cb.rules, cb.costs, cb.instructions]).toEqual([ca.rules, ca.costs, ca.instructions]);
  });

  it("the Spell delivery read from the retained chain equals the M5 plan's own delivery for every golden Spell", () => {
    const F = executionFixture();
    const keys = F.bundle.definitions.filter((d) => d.definitionKind === "SPELL_DEFINITION" && d.canonicalKey.startsWith("fixture.wo12.spell.")).map((d) => d.canonicalKey);
    let checked = 0;
    for (const k of keys) {
      const p = compileAbilityExecution(F.ability(k));
      if (!p.ok) continue;
      expect(spellDeliveryOf(p.value.chain!), k).toEqual(p.value.delivery === null ? null : { check: p.value.delivery.check });
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});

describe("Signature Maneuver cards (independent resolution groups)", () => {
  const mf = signatureManeuverFixture();
  const profile = martialProfile(mf, "MASTER");
  const attacks = buildCharacterAttackLibrary({ bundle: mf.bundle, characterProfile: profile, loadout: { mainHand: mf.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null } });
  const subject = { kind: "CHARACTER_SIGNATURE_MANEUVER", characterId: "character", signatureAbilityId: null, revisionNumber: null } as const;
  const fromCanonical = (key: string): SignatureManeuverDraft => {
    const p = mf.bundle.definitions.find((d) => d.canonicalKey === `fixture.wo11.maneuver.${key}`)!.payload as unknown as ManeuverDefinitionPayload;
    const a0 = attacks.mainHand!.attacks[0]!;
    return {
      ...emptySignatureManeuverDraft("Test Maneuver"),
      actions: p.actions.map((a) => ({ componentKey: a.componentKey, order: a.order, source: a.definition.canonicalKey.includes(".attack.") ? { kind: "WEAPON_ATTACK" as const, attackKey: a0.attackKey, weapon: a0.weapon, attack: a0.attack, damageProfileKey: a0.damage[0]!.profileKey } : { kind: "FOUNDATION" as const, definition: a.definition } })),
      effects: p.composition.effects,
      traits: p.composition.traits,
      duration: p.composition.duration ? { definition: p.composition.duration.definition, parameters: p.composition.duration.parameters } : null,
      conditions: p.composition.conditions,
      effectAttachments: p.effectAttachments,
      powerfulBlow: p.powerfulBlow,
    };
  };
  const evaluate = (draft: SignatureManeuverDraft, rank: Parameters<typeof martialProfile>[1] = "MASTER") => evaluateCharacterSignatureManeuver({ bundle: mf.bundle, ruleset: mf.ruleset, profile: martialProfile(mf, rank), attackLibrary: attacks, draft, usedSlots: 0, subject, keywords: [] });

  it("the evaluation retains the M5-WO12 resolution groups (additive WO8 change); the card presents one block per group", () => {
    const draft = fromCanonical("multi");
    const e = evaluate(draft);
    expect(e.state, JSON.stringify(e.issues)).toBe("VALID");
    expect(e.execution).not.toBeNull();
    expect(e.execution!.groups.map((g) => g.groupKey)).toEqual(["attack1", "attack2"]);
    const card = projectManeuverCard({ evaluation: e, draft, context: context("MANEUVER") });
    expect(card.costs.ap).toEqual({ status: "AVAILABLE", value: e.cost!.ap.finalApCost });
    expect(card.costs.mp).toEqual({ status: "AVAILABLE", value: e.cost!.mp.finalMpCost });
    expect(card.costs.breakdown.find((l) => l.label === "Protected Action AP")?.value).toBe(e.cost!.ap.protectedActionAp);
    if (card.rules.status !== "AVAILABLE" || card.rules.value.kind !== "MANEUVER_GROUPS") throw new Error("rules");
    expect(card.rules.value.groups.map((g) => [g.groupKey, g.check.kind])).toEqual(e.execution!.groups.map((g) => [g.groupKey, g.resolution.mode]));
    expect(card.instructions.blocks.filter((b) => b.kind === "GROUP")).toHaveLength(2);
    expect(card.section.actions.map((a) => [a.actionKey, a.weapon?.entityVersionId ?? null])).toEqual(draft.actions.map((a) => [a.componentKey, a.source.kind === "WEAPON_ATTACK" ? attacks.mainHand!.attacks[0]!.weapon.entityVersionId : null]));
  });

  it("a Powerful Blow is ONE resolution group naming each constituent Attack", () => {
    const draft = fromCanonical("powerful_blow");
    const e = evaluate(draft);
    expect(e.state, JSON.stringify(e.issues)).toMatch(/^VALID/);
    expect(e.execution!.groups).toHaveLength(1);
    const card = projectManeuverCard({ evaluation: e, draft, context: context("MANEUVER") });
    if (card.rules.status !== "AVAILABLE" || card.rules.value.kind !== "MANEUVER_GROUPS") throw new Error("rules");
    expect(card.rules.value.groups[0]).toMatchObject({ kind: "POWERFUL_BLOW", actionKeys: ["attack1", "attack2"] });
    expect(card.instructions.blocks.find((b) => b.kind === "GROUP")!.text).toContain("Powerful Blow: 2 Attacks");
  });

  it("an invalid Maneuver projects typed unresolved values and no groups (even when M5 compiled them)", () => {
    const draft = fromCanonical("multi");
    const e = evaluate({ ...draft, conditions: [] }, "TRAINED");
    expect(e.state).toBe("INVALID");
    const card = projectManeuverCard({ evaluation: e, draft, context: context("MANEUVER", "DRAFT") });
    expect([card.availability, card.costs.ap.status, card.rules.status, card.instructions.status]).toEqual(["INVALID", "UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"]);
  });
});
