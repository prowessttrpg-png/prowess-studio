/** Permanent WO8 invariants exercised below: M6-I099 M6-I101 M6-I103 M6-I104 M6-I105 M6-I106 M6-I107 M6-I108 M6-I109 M6-I115 M6-I116 M6-I117 M6-I121. */
import { describe, expect, it, vi } from "vitest";
import { signatureManeuverFixture } from "./testing/signature-maneuver-fixtures.js";
import { martialProfile } from "./testing/weapon-fixtures.js";
import { emptySignatureManeuverDraft, readSignatureManeuverDraft, evaluateCharacterSignatureManeuver, type SignatureManeuverDraft } from "./character/signature-maneuver.js";
import { buildSignatureManeuverCatalog } from "./character/signature-maneuver-catalog.js";
import { buildCharacterAttackLibrary } from "./equipment/library.js";
import { runManeuverCost } from "./testing/maneuver-cost-fixtures.js";
import { copy } from "./testing/duration-condition-fixtures.js";
import type { ManeuverDefinitionPayload } from "./definition/authored-ability-payload.js";

vi.setConfig({ testTimeout: 120_000 });
const f = signatureManeuverFixture();
const profile = martialProfile(f, "MASTER");
const attacks = buildCharacterAttackLibrary({ bundle: f.bundle, characterProfile: profile, loadout: { mainHand: f.sel("weapon.long_blade"), mainHandGrip: "ONE_HANDED", offHand: null } });
const subject = { kind: "CHARACTER_SIGNATURE_MANEUVER", characterId: "character", signatureAbilityId: null, revisionNumber: null } as const;
const fromCanonical = (key: string): SignatureManeuverDraft => {
  const p = f.bundle.definitions.find(d => d.canonicalKey === `fixture.wo11.maneuver.${key}`)!.payload as unknown as ManeuverDefinitionPayload;
  return { ...emptySignatureManeuverDraft("Test Maneuver"), actions: p.actions.map(a => ({ componentKey: a.componentKey, order: a.order, source: a.definition.canonicalKey.includes(".attack.") ? { kind: "WEAPON_ATTACK" as const, attackKey: attacks.mainHand!.attacks[0]!.attackKey, weapon: attacks.mainHand!.attacks[0]!.weapon, attack: attacks.mainHand!.attacks[0]!.attack, damageProfileKey: attacks.mainHand!.attacks[0]!.damage[0]!.profileKey } : { kind: "FOUNDATION" as const, definition: a.definition } })), effects: p.composition.effects, traits: p.composition.traits, duration: p.composition.duration ? { definition: p.composition.duration.definition, parameters: p.composition.duration.parameters } : null, conditions: p.composition.conditions, effectAttachments: p.effectAttachments, powerfulBlow: p.powerfulBlow };
};
const evaluate = (draft: SignatureManeuverDraft, overrides: Partial<Parameters<typeof evaluateCharacterSignatureManeuver>[0]> = {}) => evaluateCharacterSignatureManeuver({ bundle: f.bundle, ruleset: f.ruleset, profile, attackLibrary: attacks, draft, usedSlots: 0, subject, keywords: [], ...overrides });
describe("Character-owned Maneuvers — one M5/M4 pipeline", () => {
  it("reads exact choices and rejects client prices, shared targeting, Spell exchanges and ambiguous order", () => {
    const draft = fromCanonical("multi");
    expect(readSignatureManeuverDraft(draft).ok).toBe(true);
    for (const data of [{ ...draft, apCost: 0 }, { ...draft, targeting: {} }, { ...draft, constructionOptions: { effectSlotsTradedForTraits: 1 } }, { ...draft, actions: draft.actions.map(a => ({ ...a, order: 1 })) }]) expect(readSignatureManeuverDraft(data).ok).toBe(false);
  });
  it("retains exact ordered Action identity and does not mutate the Release bundle", () => {
    const draft = fromCanonical("multi"), before = JSON.stringify(f.bundle);
    const out = evaluate(draft);
    expect(out.state, JSON.stringify(out.issues)).toBe("VALID");
    expect(out.cost?.ap).toMatchObject({ protectedActionAp: 4, finalApCost: 3 });
    expect(out.authored?.actions.map(a => a.componentKey)).toEqual(draft.actions.map(a => a.componentKey));
    expect(JSON.stringify(f.bundle)).toBe(before);
    expect(out.cost?.definition).toEqual(subject);
  });
  it("a Powerful Blow counts as one block but pays every constituent, with one attached Effect instance", () => {
    const out = evaluate(fromCanonical("powerful_blow"), { profile: martialProfile(f, "TRAINED") });
    // Two Conditions exceed Trained capacity; one-block capacity itself still succeeds.
    expect(out.issues.some(q => q.path === "maneuver.action_block_capacity")).toBe(false);
    expect(out.cost?.ap.protectedActionAp).toBe(4);
    expect(out.cost?.structure.resolutionGroups).toHaveLength(1);
  });
  it("enforces the actual Martial block limit independently of global Effects and Traits", () => {
    const draft = fromCanonical("multi");
    const out = evaluate({ ...draft, conditions: [] }, { profile: martialProfile(f, "TRAINED") });
    expect(out.state).toBe("INVALID");
    expect(out.issues.some(q => q.path === "maneuver.action_block_capacity")).toBe(true);
    const untrained = evaluate(fromCanonical("basic"), { profile: martialProfile(f, "UNTRAINED") });
    expect(untrained.state).toBe("INVALID");
  });
  it("consumes current WO6 exact Attack bindings without manufacturing a Foundation Definition", () => {
    const a = attacks.mainHand!.attacks[0]!, base = fromCanonical("basic");
    const draft: SignatureManeuverDraft = { ...base, conditions: [], actions: [{ componentKey: "attack1", order: 1, source: { kind: "WEAPON_ATTACK", weapon: a.weapon, attack: a.attack, attackKey: a.attackKey, damageProfileKey: a.damage[0]!.profileKey } }] };
    const out = evaluate(draft);
    expect(out.state, JSON.stringify(out.issues)).toBe("VALID");
    expect(out.cost?.ap.protectedActionAp).toBe(a.apCost);
    expect(out.authored?.actions[0]?.definition).toEqual(a.attack);
    const contribution = out.cost!.ap.contributions.find(c => c.source === "FOUNDATION")!;
    expect(out.inspector!.sourceMap.entries.find(e => e.stepKey === contribution.stepKey)!.definitions).toContainEqual(a.weapon);
    const forged = { ...draft, actions: [{ ...draft.actions[0]!, source: { ...draft.actions[0]!.source, attackKey: "not-the-authored-attack-key" } }] } as SignatureManeuverDraft;
    expect(evaluate(forged).issues[0]?.code).toBe("SIGNATURE_MANEUVER.ATTACK_UNAVAILABLE");
    const missing = evaluate(draft, { attackLibrary: { ...attacks, mainHand: null } });
    expect(missing.state).toBe("INVALID");
    expect(missing.issues[0]?.code).toBe("SIGNATURE_MANEUVER.ATTACK_UNAVAILABLE");
    expect(draft.actions[0]!.source).toEqual(draft.actions[0]!.source);
  });
  it("prices the required Master Move → Attack → Block fixture at base 7 AP / 9 MP and Signature 6 AP / 9 MP", () => {
    const base = fromCanonical("basic"), bundle = f.bundle;
    const draft: SignatureManeuverDraft = { ...base, conditions: [], actions: [
      { componentKey: "move", order: 1, source: { kind: "FOUNDATION", definition: f.ref("fixture.wo11.action.move") } },
      { ...base.actions[0]!, componentKey: "attack", order: 2 },
      { componentKey: "block", order: 3, source: { kind: "FOUNDATION", definition: f.ref("fixture.wo11.action.block") } },
    ], effects: [{ componentKey: "effect", order: 1, definition: f.ref("test.wo8.effect.enhancement"), parameters: {} }], effectAttachments: [{ effectKey: "effect", actionKeys: ["attack"] }], traits: [{ componentKey: "trait", order: 1, definition: f.ref("test.wo8.trait.block_addition"), parameters: {}, appliesTo: { scope: "ACTION_SPECIFIC", componentKey: "block" } }] };
    const out = evaluate(draft, { bundle });
    expect(out.state, JSON.stringify(out.issues)).toBe("VALID");
    expect(out.cost?.ap).toMatchObject({ baseApCost: 7, protectedActionAp: 5, finalApCost: 6 });
    expect(out.cost?.mp).toMatchObject({ baseMpCost: 9, finalMpCost: 9 });
    expect(out.cost?.structure.resolutionGroups.map(g => [g.actionKeys, g.effects, g.traits])).toEqual([[["move"], [], []], [["attack"], ["effect"], []], [["block"], [], ["trait"]]]);
    const wrong = { ...draft, traits: draft.traits.map(t => ({ ...t, appliesTo: { scope: "ACTION_SPECIFIC", componentKey: "attack" } })) };
    expect(evaluate(wrong, { bundle }).state).toBe("INVALID");
  });
  it("uses the same versioned M5 compiler for the exact canonical Master reference", () => {
    const plain = runManeuverCost(f.request("test.wo8.maneuver.master_reference")).result;
    const signature = runManeuverCost(f.request("test.wo8.maneuver.master_reference", true)).result;
    expect(plain.valid, JSON.stringify(plain.problems)).toBe(true);
    expect([plain.ap.baseApCost, plain.ap.finalApCost, plain.mp.finalMpCost]).toEqual([7, 7, 9]);
    expect([signature.ap.baseApCost, signature.ap.finalApCost, signature.mp.finalMpCost]).toEqual([7, 6, 9]);
    expect(signature.structure.resolutionGroups.map(g => g.traits)).toEqual([[], [], ["trait"]]);
  });
  it("isolates per-Action Targeting Traits and derives Condition relevance from every inherited delivery", () => {
    const d = fromCanonical("basic");
    const draft = { ...d, actions: [{ componentKey: "move", order: 1, source: { kind: "FOUNDATION", definition: f.ref("fixture.wo11.action.move") } }, { ...d.actions[0]!, order: 2 }], traits: [{ componentKey: "range", order: 1, definition: f.ref("test.wo8.trait.exact_range"), parameters: {}, appliesTo: { scope: "TARGETING", componentKey: "attack1.targeting" } }], conditions: [{ componentKey: "unaware", order: 1, definition: f.ref("maneuver.condition.target_unaware"), parameters: {} }] } as SignatureManeuverDraft;
    const out = evaluate(draft);
    expect(out.state, JSON.stringify(out.issues)).toBe("VALID");
    expect(out.authored?.targetingChanges.map(c => [c.actionKey, c.measure, c.value])).toEqual([["attack1", "RANGE", 10]]);
    expect(out.cost?.structure.resolutionGroups.map(g => g.traits)).toEqual([[], ["range"]]);
    expect(evaluate({ ...draft, traits: draft.traits.map(t => ({ ...t, appliesTo: { scope: "TARGETING", componentKey: "targeting" } })) }).state).toBe("INVALID");
  });
  it("fails closed for an ambiguous WO6 hand context and exposes exact Release catalog gaps", () => {
    const dual = buildCharacterAttackLibrary({ bundle: f.bundle, characterProfile: profile, loadout: { mainHand: f.sel("weapon.short_blade"), mainHandGrip: null, offHand: f.sel("weapon.short_blade") } });
    const a = dual.mainHand!.attacks[0]!, d = fromCanonical("basic");
    const draft = { ...d, conditions: [], actions: [{ componentKey: "attack1", order: 1, source: { kind: "WEAPON_ATTACK", weapon: a.weapon, attack: a.attack, attackKey: a.attackKey, damageProfileKey: a.damage[0]!.profileKey } }] } as SignatureManeuverDraft;
    expect(evaluate(draft, { attackLibrary: dual }).issues[0]?.code).toBe("SIGNATURE_MANEUVER.AMBIGUOUS_ATTACK_CONTEXT");
    const catalog = buildSignatureManeuverCatalog({ bundle: f.bundle, profile, attackLibrary: attacks });
    expect(catalog.actions.some(a => a.category === "MOVEMENT" && a.available)).toBe(true);
    expect(catalog.limitations.some(q => q.code === "MISSING_INTERACTION_FOUNDATIONS")).toBe(true);
    expect(catalog.conditions.find(c => c.category === "PERFORMANCE")?.parameters).toEqual([]);
    expect(catalog.actions.every(a => a.source.kind !== "FOUNDATION" || a.profile?.resolution.mode === "NONE")).toBe(true);
  });
  it("rejects partial Powerful Blow attachment and cross-Release refs", () => {
    const draft = fromCanonical("powerful_blow");
    expect(evaluate({ ...draft, effectAttachments: [{ effectKey: "effect1", actionKeys: ["attack1"] }] }).state).toBe("INVALID");
    const bad = copy(fromCanonical("basic"));
    const source = bad.actions[0]!.source;
    if (source.kind !== "WEAPON_ATTACK") throw new Error("fixture");
    const cross = { ...bad, actions: [{ ...bad.actions[0]!, source: { ...source, attack: { ...source.attack, entityVersionId: f.ref("fixture.wo11.attack.heavy").entityVersionId } } }] };
    expect(evaluate(cross).state).toBe("INVALID");
  });
  it("keeps incomplete drafts unpriced and exposes a missing Release policy without runtime synthesis", () => {
    expect(evaluate(emptySignatureManeuverDraft("Draft"))).toMatchObject({ state: "INCOMPLETE", cost: null });
    const b = copy(f.bundle), rule = b.definitions.find(d => d.definitionKind === "ABILITY_CONSTRUCTION_RULE")!;
    delete (rule.payload as unknown as { maneuverCostPolicy: { extension?: unknown } }).maneuverCostPolicy.extension;
    const out = evaluate(fromCanonical("basic"), { bundle: b });
    expect(out.cost).toBeNull();
    expect(out.issues[0]?.code).toBe("SIGNATURE_MANEUVER.MISSING_APPROVED_POLICY");
  });
});
