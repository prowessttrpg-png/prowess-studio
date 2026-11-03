import { describe, expect, it } from "vitest";
import { evaluateSpellCost } from "./ability/spell-cost.js";
import type { CharacterMechanicalProfile } from "./character/advancement.js";
import { emptySignatureSpellDraft, evaluateCharacterSignatureSpell, readSignatureSpellDraft, type CharacterSpellSubject, type SignatureSpellDraft } from "./character/signature-spell.js";
import { spellCostCharacter } from "./testing/spell-cost-fixtures.js";
import { signatureSpellFixture } from "./testing/signature-spell-fixtures.js";
import { effectCharacter } from "./testing/effect-fixtures.js";

/**
 * PAS-10 M6-WO7 — the Character Signature Spell adapter over the permanent M5 Spell engine (§102–§108, §135–§155).
 * Invariants: M6-I077 Character-owned (no synthetic canon) · M6-I078 exact Release-pinned components · M6-I079 prose
 * never creates mechanics · M6-I080 explicit authority · M6-I081 capacities never stack · M6-I082 M5 owns legality ·
 * M6-I083 M5-WO10 owns cost · M6-I084 ME never changes listed cost · M6-I085 the 30% cap · M6-I086 Effect order ·
 * M6-I087 explicit exchange · M6-I088 M5-SC-042 fail closed · M6-I095 no latest component · M6-I096 reuse, never
 * redefine · M6-I097 runtime deferrals surfaced · M6-I098 nothing is cast.
 */
const TIMEOUT = 60_000;
const f = signatureSpellFixture();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only structural access to fixture payloads
type Loose = any;
type Payload = { composition: Record<string, Loose>; constructionOptions: { effectSlotsTradedForTraits: number }; additionalAffinityTraits: string[] };
const payloadOf = (key: string) => f.bundle.definitions.find((d) => d.canonicalKey === key)!.payload as unknown as Payload;
const pick = ({ componentKey, definition, order, parameters }: Record<string, Loose>) => ({ componentKey, definition, order, parameters });
/** The same component selections as a Character-owned draft. */
function draftOf(key: string, name = "Ember Bolt"): SignatureSpellDraft {
  const c = payloadOf(key).composition;
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
    constructionOptions: payloadOf(key).constructionOptions,
    additionalAffinityTraits: payloadOf(key).additionalAffinityTraits,
  };
  const read = readSignatureSpellDraft(JSON.parse(JSON.stringify(draft)));
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}
const affinityOf = (key: string): Parameters<typeof spellCostCharacter>[1] => (key.includes("strength") || key.includes("combined") ? [f.ref(key.includes("weakness") || key.includes("combined") ? "affinity.transmutation" : "affinity.evocation"), "EXPERT"] : null);
const subject: CharacterSpellSubject = { kind: "CHARACTER_SIGNATURE_SPELL", characterId: "00000000-0000-4000-8000-0000000c0001", signatureAbilityId: null, revisionNumber: null };
const profileOf = (character: object) => ({ constructionContext: character }) as unknown as CharacterMechanicalProfile;
function evaluate(draft: SignatureSpellDraft, character: object = spellCostCharacter(4), usedSlots = 0) {
  const request = (f as unknown as { request: (k: string, c: object) => { keywords: unknown; ruleset: unknown } }).request("fixture.spell.simple", character);
  return evaluateCharacterSignatureSpell({ bundle: f.bundle, ruleset: request.ruleset, profile: profileOf(character), keywords: request.keywords, draft, usedSlots, subject });
}
const canonical = (key: string, character: object) => evaluateSpellCost((f as unknown as { request: (k: string, c: object) => object }).request(key, character));

describe("§162 / §108 adapter equivalence with canonical SPELL_DEFINITION compilation (M6-I096, M6-I083)", { timeout: TIMEOUT }, () => {
  const keys = f.bundle.definitions.filter((d) => d.definitionKind === "SPELL_DEFINITION" && d.canonicalKey.startsWith("fixture.wo10.")).map((d) => d.canonicalKey);
  it("covers the M5-WO10 golden Spells", () => expect(keys.length).toBeGreaterThanOrEqual(14));
  it.each(keys)("%s: same validity, contributions, base MP, net %%, unrounded and final MP, AP", (key) => {
    const character = spellCostCharacter(key.includes("minimum") || key.includes("high") ? 5 : 4, affinityOf(key));
    const c = canonical(key, character);
    const a = evaluate(draftOf(key), character);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(a.cost).not.toBeNull();
    const x = a.cost!;
    expect(x.valid).toBe(c.value.valid);
    expect(x.mp.contributions.map((q) => [q.source, q.componentKey, q.contributionKey, q.value])).toEqual(c.value.mp.contributions.map((q) => [q.source, q.componentKey, q.contributionKey, q.value]));
    expect([x.mp.baseMpCost, x.netCostPercent, x.unroundedFinalMpCost, x.finalMpCost, x.ap.baseApCost, x.ap.finalApCost]).toEqual([c.value.mp.baseMpCost, c.value.netCostPercent, c.value.unroundedFinalMpCost, c.value.finalMpCost, c.value.ap.baseApCost, c.value.ap.finalApCost]);
    expect(x.percentageContributions.map((q) => [q.source, q.percent, q.applied])).toEqual(c.value.percentageContributions.map((q) => [q.source, q.percent, q.applied]));
    expect(x.authored.construction.capacity).toEqual(c.value.authored.construction.capacity);
    expect(x.authored.construction.signature).toEqual(c.value.authored.construction.signature);
    expect(x.authored.traitCapacity).toEqual(c.value.authored.traitCapacity);
  });
});

describe("Character-owned, never canon (§6, §105, M6-I077, M6-I078)", { timeout: TIMEOUT }, () => {
  it("the evaluation's subject is the Character Spell; no subject Definition is cited and the bundle is untouched", () => {
    const before = JSON.stringify(f.bundle);
    const a = evaluate(draftOf("fixture.wo10.spell.simple"));
    expect(JSON.stringify(f.bundle)).toBe(before);
    expect(a.subject).toEqual(subject);
    expect(a.cost!.definition).toEqual(subject);
    const cited = a.cost!.authored.construction ? JSON.stringify(a) : "";
    for (const ref of f.bundle.definitions.filter((d) => d.definitionKind === "SPELL_DEFINITION")) expect(cited).not.toContain(ref.entityVersionId);
    expect(a.components.every((r) => f.bundle.definitions.some((d) => d.entityVersionId === r.entityVersionId))).toBe(true);
  });
  it("§30 / M6-I095 a component revision the Release does not pin is refused, never rebound to another revision", () => {
    const d = draftOf("fixture.wo10.spell.simple");
    const foreign = { ...d, targeting: { ...d.targeting!, definition: { ...d.targeting!.definition, entityVersionId: "00000000-0000-4000-8000-0000000ffff1" } } };
    const a = evaluate(foreign as unknown as SignatureSpellDraft);
    expect(a.state).toBe("INVALID");
    expect(a.cost).toBeNull();
  });
});

describe("§135 / §143 / §142 / §144 golden builds (M6-I083, M6-I085)", { timeout: TIMEOUT }, () => {
  it("§135 a simple Arcane Spell is VALID, uses one Signature slot and is exactly priced", () => {
    const a = evaluate(draftOf("fixture.wo10.spell.simple"), spellCostCharacter(4), 1);
    expect(a.state).toBe("VALID");
    expect(a.authored!.construction.signature.candidateUse).toBe(1);
    expect(a.authored!.construction.signature.projected).toBe(2);
    expect(a.cost!.finalMpCost).toBe(13);
  });
  it("§143 13 × 90% = 11.7 rounds ONCE to 12, never 11", () => {
    const a = evaluate(draftOf("fixture.wo10.spell.legacy"));
    expect([a.cost!.mp.baseMpCost, a.cost!.netCostPercent, a.cost!.unroundedFinalMpCost, a.cost!.finalMpCost]).toEqual([13, 90, 11.7, 12]);
  });
  it("§142 Casting Conditions listing 45% reduce by the flat 30% effective cap", () => {
    const a = evaluate(draftOf("fixture.wo10.spell.cap"));
    expect(a.cost!.castingConditions).toEqual({ listedPercent: 45, effectivePercent: 30, maximumPercent: 30 });
    expect(a.cost!.finalMpCost).toBe(14);
  });
  it("§144 AP = max(1, floor(final MP ÷ PRO)) then explicit modifiers; no 3 AP maximum", () => {
    expect(evaluate(draftOf("fixture.wo10.spell.high"), spellCostCharacter(5)).cost!.ap.finalApCost).toBe(7);
    expect(evaluate(draftOf("fixture.wo10.spell.somatic")).cost!.ap.finalApCost).toBe(3);
  });
  it("§145 / M6-I084 the listed price ignores Mana Efficiency and current resources entirely", () => {
    const draft = draftOf("fixture.wo10.spell.simple");
    const a = evaluate(draft, { ...spellCostCharacter(4) });
    const b = evaluate(draft, JSON.parse(JSON.stringify({ ...spellCostCharacter(4) })));
    expect(b.cost!.finalMpCost).toBe(a.cost!.finalMpCost);
    expect(JSON.stringify(a)).not.toMatch(/manaEfficiency|"ME"/);
  });
});

describe("authority, affinity and capacity (§24–§28, §137–§141, M6-I080, M6-I081, M6-I087)", { timeout: TIMEOUT }, () => {
  const affinityDraft = (): SignatureSpellDraft => ({ ...draftOf("fixture.wo10.spell.strength"), authority: "AFFINITY_AUTHORITY", traits: [] });
  it("§137 Affinity Authority with an owned Affinity applies the Strength discount (20 × 80% = 16)", () => {
    const a = evaluate(affinityDraft(), spellCostCharacter(4, affinityOf("fixture.wo10.spell.strength")));
    expect(a.authored!.construction.access.path).toBe("AFFINITY_AUTHORITY");
    expect(a.state).toBe("VALID");
    expect(a.cost!.percentageContributions.find((q) => q.source === "AFFINITY_STRENGTH")?.percent).toBe(20);
    expect(a.cost!.finalMpCost).toBe(16);
  });
  it("§138 an unowned Affinity fails; the authority is never switched to Arcane", () => {
    const draft = affinityDraft();
    const a = evaluate(draft, spellCostCharacter(4, null));
    expect(a.state).toBe("INVALID");
    expect(draft.authority).toBe("AFFINITY_AUTHORITY");
    expect(a.authored?.construction.access.path).toBe("AFFINITY_AUTHORITY");
    expect(a.authored?.construction.access.satisfied).toBe(false);
    expect(a.issues.length).toBeGreaterThan(0);
  });
  it("§139 Effect capacity follows the exact Arcana rank (Trained 1 / Expert 2 / Master 3) — never the sum with an Affinity", () => {
    const caps = ["TRAINED", "EXPERT", "MASTER"].map((arcana) => evaluate(draftOf("fixture.wo10.spell.simple"), { ...effectCharacter({ arcana }), affinityProfile: null }).authored!.construction.capacity.effects.base);
    expect(caps).toEqual([1, 2, 3]);
  });
  it("§140 a Trait exchange happens only when requested; at least one Effect remains", () => {
    const draft = draftOf("fixture.wo10.spell.simple");
    const none = evaluate(draft, { ...effectCharacter({ arcana: "EXPERT" }), affinityProfile: null }).authored!.construction.capacity;
    const traded = evaluate({ ...draft, constructionOptions: { effectSlotsTradedForTraits: 1 } }, { ...effectCharacter({ arcana: "EXPERT" }), affinityProfile: null }).authored!.construction.capacity;
    expect(traded.traits.effective).toBe(none.traits.effective + 1);
    expect(none.trades.requested).toBe(0);
    const tooMany = evaluate({ ...draft, constructionOptions: { effectSlotsTradedForTraits: 2 } }, { ...effectCharacter({ arcana: "EXPERT" }), affinityProfile: null });
    expect(tooMany.state).toBe("INVALID");
  });
  it("§141 Casting Condition capacity comes from the Arcana rank even under Affinity Authority", () => {
    const a = evaluate(affinityDraft(), { ...spellCostCharacter(4, affinityOf("fixture.wo10.spell.strength")), skillRanks: [{ skillKey: "skill.arcana", rankKey: "UNTRAINED" }] });
    expect(a.authored!.construction.capacity.conditions).toMatchObject({ capacity: 0, source: { rank: "UNTRAINED" } });
  });
});

describe("unresolved M5 conflicts are surfaced, never guessed (§34, §52, §59, M6-I088, M6-I097)", { timeout: TIMEOUT }, () => {
  it("§146 M5-SC-046: a Multi-Target target count cannot be priced — cost unresolved, never zero", () => {
    const draft = draftOf("fixture.wo10.spell.simple");
    const multi = f.bundle.definitions.find((d) => d.canonicalKey === "spell.targeting.multi_target")!;
    const ref = { entityId: multi.entityId, entityVersionId: multi.entityVersionId, canonicalKey: multi.canonicalKey, definitionKind: multi.definitionKind, systemFamily: multi.systemFamily };
    const a = evaluate({ ...draft, targeting: { definition: ref, parameters: { targetCount: 2 } } } as SignatureSpellDraft);
    expect(a.state).toBe("INVALID");
    expect(a.cost).toBeNull();
    expect(a.costUnresolved.some((q) => q.message.includes("M5-SC-046"))).toBe(true);
  });
  it("§147 M5-SC-042: an additional Affinity Trait capacity request is refused", () => {
    const draft = draftOf("fixture.wo10.spell.simple");
    const a = evaluate({ ...draft, additionalAffinityTraits: ["trait1"] });
    expect(a.state).toBe("INVALID");
    expect(a.issues.some((q) => q.message.includes("M5-SC-042"))).toBe(true);
  });
  it("§148 M5-SC-052: a Mana Lock Duration is structurally evaluated but its reservation is runtime-deferred", () => {
    const draft = draftOf("fixture.wo10.spell.simple");
    const maint = f.bundle.definitions.find((d) => d.canonicalKey === "fixture.wo9.effect.maintenance")!;
    const lock = f.bundle.definitions.find((d) => d.canonicalKey === "spell.duration.mana_lock")!;
    const r = (d: typeof maint) => ({ entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily });
    const a = evaluate({ ...draft, effects: [{ componentKey: "effect1", definition: r(maint), order: 10, parameters: { amount: 1 } }], traits: [], duration: { definition: r(lock), parameters: {} } } as unknown as SignatureSpellDraft);
    expect(a.runtime.manaLock).toEqual({ reservedMp: null, conflictKey: "M5-SC-052" });
    expect(a.runtime.deferred.map((d) => d.conflictKey)).toContain("M5-SC-052");
    if (a.cost?.valid) expect(a.state).toBe("VALID_WITH_RUNTIME_DEFERRED");
  });
});

describe("drafts, prose and order (§12, §23, §42, §155, M6-I079, M6-I086)", { timeout: TIMEOUT }, () => {
  it("§154 an incomplete draft reads, evaluates INCOMPLETE and names what is missing — nothing is priced", () => {
    const a = evaluate(emptySignatureSpellDraft("Unfinished"));
    expect(a.state).toBe("INCOMPLETE");
    expect(a.missing).toEqual(["AUTHORITY", "TARGETING", "EFFECTS", "DURATION"]);
    expect(a.cost).toBeNull();
  });
  it("§155 renaming Fireball → Healing Nova (and any prose) changes no mechanic", () => {
    const a = evaluate(draftOf("fixture.wo10.spell.simple", "Fireball"));
    const b = evaluate({ ...draftOf("fixture.wo10.spell.simple", "Healing Nova"), concept: { name: "Healing Nova", description: "heals fire ice lightning", visualDescription: "radius 30 ft", notes: "Evocation", narrativeTags: ["holy"] } });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it("§136 Effect order is authored meaning: the chain lists Effects in their authored order", () => {
    const d = draftOf("fixture.wo10.spell.simple");
    const def = (k: string) => {
      const x = f.bundle.definitions.find((y) => y.canonicalKey === k)!;
      return { entityId: x.entityId, entityVersionId: x.entityVersionId, canonicalKey: x.canonicalKey, definitionKind: x.definitionKind, systemFamily: x.systemFamily };
    };
    const effects = [
      { componentKey: "damage", definition: def("spell.effect.direct_damage"), order: 10, parameters: { dice: 1 } },
      { componentKey: "move", definition: def("spell.effect.reposition"), order: 20, parameters: { distance: 5 } },
      { componentKey: "control", definition: def("spell.effect.bind"), order: 30, parameters: { distance: 5 } },
    ];
    const a = evaluate({ ...d, traits: [], effects } as unknown as SignatureSpellDraft, { ...effectCharacter({ arcana: "MASTER" }), affinityProfile: null });
    expect(a.authored?.effects.map((e) => e.result.componentKey)).toEqual(["damage", "move", "control"]);
    const reversed = evaluate({ ...d, traits: [], effects: effects.map((e, i) => ({ ...e, order: [30, 20, 10][i] })) } as unknown as SignatureSpellDraft, { ...effectCharacter({ arcana: "MASTER" }), affinityProfile: null });
    if (a.chain && reversed.chain) expect(reversed.chain.nodes.map((n) => n.effectKey)).toEqual([...a.chain.nodes.map((n) => n.effectKey)].reverse());
  });
});

describe("the strict draft reader (§118, §121)", () => {
  it("refuses unknown fields, derived values, executable data and a wrong schema version", () => {
    const ok = JSON.parse(JSON.stringify(draftOf("fixture.wo10.spell.simple")));
    expect(readSignatureSpellDraft(ok).ok).toBe(true);
    for (const bad of [{ ...ok, finalMpCost: 12 }, { ...ok, schemaVersion: 2 }, { ...ok, effects: [{ ...ok.effects[0], parameters: { dice: { $eval: "1+1" } } }] }, { ...ok, concept: { ...ok.concept, name: "" } }, { ...ok, targeting: { ...ok.targeting, definition: { canonicalKey: "spell.targeting.single_target" } } }]) {
      expect(readSignatureSpellDraft(bad).ok).toBe(false);
    }
  });
});
