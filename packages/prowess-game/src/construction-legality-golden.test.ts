import { describe, expect, it } from "vitest";
import { constructionFixture, maneuverOf, spellOf } from "./testing/construction-fixtures.js";
import { failing, runConstruction } from "./testing/construction-run.js";

/**
 * M5-WO5 GOLDEN fixtures (PAS-10 M5-WO5 §64–§89 and addendum §A5). Every number and every comparison asserted here was
 * produced by the frozen M4 engine from the canonical construction-rule content, the WO4 Affinity Rank rule and the WO2
 * Signature statistic. @prowess/game only chose and wired the operations.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I156 one explicit valid Spell Authority · M5-I157
 * Casting Condition capacity from Arcane Rank only · M5-I158 Martial training is the Maneuver minimum; Affinity never
 * substitutes for it or adds Martial capacity.
 */
const F = constructionFixture();
const evocation = (rank: string) => [["affinity.evocation", rank] as const];
const affinitySpell = (spec: Parameters<typeof spellOf>[1] = {}) => spellOf(F, { authority: "AFFINITY_AUTHORITY", affinity: "affinity.evocation", ...spec });
const traits = (n: number) => Array.from({ length: n }, () => ({ trait: "focusTrait" as const, appliesTo: "effect1" }));

describe("§68–§73 / M5-I156 Spell access — one explicit, valid construction Authority", () => {
  it("§68 Arcana TRAINED + Arcane Authority: 1 Effect, 1 Trait, 0 Conditions → VALID", () => {
    const r = runConstruction(spellOf(F, { traits: traits(1) }), { arcana: "TRAINED" });
    expect([r.result.status, failing(r)]).toEqual(["VALID", []]);
    expect(r.result.access).toEqual(expect.objectContaining({ path: "ARCANE_AUTHORITY", rank: "TRAINED", minimumRank: "TRAINED", satisfied: true, rankSource: { kind: "SKILL", track: "ARCANE", skillKey: "skill.arcana" } }));
  });

  it("§69 Arcana UNTRAINED + Arcane Authority → INVALID (access)", () => {
    const r = runConstruction(spellOf(F), { arcana: "UNTRAINED" });
    expect(r.result.status).toBe("INVALID");
    expect(failing(r)).toContain("access");
  });

  it("an unlisted Arcana Skill is the ladder's first rank (UNTRAINED) — never assumed trained", () => {
    expect(failing(runConstruction(spellOf(F), {}))).toContain("access");
  });

  it("§70 Affinity-only caster (Arcana UNTRAINED, Evocation TRAINED, Affinity Authority, every component within Evocation) → VALID, Casting Condition capacity 0", () => {
    const r = runConstruction(affinitySpell(), { arcana: "UNTRAINED", affinities: evocation("TRAINED") });
    expect([r.result.status, failing(r)]).toEqual(["VALID", []]);
    expect(r.result.capacity.conditions).toEqual({ capacity: 0, source: { track: "ARCANE", rank: "UNTRAINED" } });
    expect(r.result.affinityAccess.map((a) => [a.componentKey, a.satisfied])).toEqual([["targeting", true], ["effect1", true], ["duration", true]]);
  });

  it("§71 no Trained Arcana and no Trained Affinity → INVALID under either Authority", () => {
    expect(failing(runConstruction(spellOf(F), { arcana: "UNTRAINED", affinities: evocation("NONE") }))).toContain("access");
    expect(failing(runConstruction(affinitySpell(), { arcana: "UNTRAINED", affinities: evocation("NONE") }))).toContain("access");
  });

  it("§72 Arcana UNTRAINED + Evocation MASTER, Arcane Authority selected → INVALID; never silently switched to Affinity Authority", () => {
    const r = runConstruction(spellOf(F, { affinity: "affinity.evocation" }), { arcana: "UNTRAINED", affinities: evocation("MASTER") });
    expect([r.result.status, r.result.access.path, failing(r)]).toEqual(["INVALID", "ARCANE_AUTHORITY", ["access", "capacity.effects"]]);
  });

  it("§73 Arcana MASTER + Evocation NONE, Affinity Authority selected → INVALID; never silently switched to Arcane Authority", () => {
    const r = runConstruction(affinitySpell(), { arcana: "MASTER", affinities: evocation("NONE") });
    expect([r.result.status, r.result.access.path]).toEqual(["INVALID", "AFFINITY_AUTHORITY"]);
    expect(failing(r)).toContain("access");
  });

  it("§73 an Affinity Authority Spell whose governing Affinity is not owned at all → INVALID (ownership leaf)", () => {
    const r = runConstruction(affinitySpell(), { arcana: "MASTER", affinities: [["affinity.conjuration", "MASTER"]] });
    expect(failing(r)).toContain("access");
    expect(JSON.stringify(r.result.rules.find((x) => x.ruleKey === "access")?.outcome)).toContain("ENTITY_OWNED");
  });

  it("§24 Affinity Authority: a component with no access through Evocation → INVALID; an explicit access grant makes it legal", () => {
    const out = runConstruction(affinitySpell({ effects: ["light"] }), { affinities: evocation("TRAINED") });
    expect(failing(out)).toEqual(["affinity_access.effect1"]);
    const granted = runConstruction(affinitySpell({ effects: ["light"] }), { affinities: evocation("TRAINED") }, { accessGrants: [{ componentKey: "effect1", sourceKey: "rule.test.light_through_evocation" }] });
    expect(granted.result.status).toBe("VALID");
  });

  it("§25 an Affinity Weakness alone never makes a component illegal (cost is WO10)", () => {
    expect(runConstruction(affinitySpell({ effects: ["healing"] }), { affinities: evocation("TRAINED") }).result.status).toBe("VALID");
  });

  it("§27 Arcane Authority with Affinity data present stays Arcane Authority (Affinity alignment is cost, not construction)", () => {
    const r = runConstruction(spellOf(F, { affinity: "affinity.evocation", effects: ["light"] }), { arcana: "TRAINED", affinities: evocation("MASTER") });
    expect([r.result.status, r.result.access.path, r.result.affinityAccess]).toEqual(["VALID", "ARCANE_AUTHORITY", []]);
  });
});

describe("§9 / §26 / §63–§67 Spell capacity, the explicit Trait exchange and non-stacking Authorities", () => {
  it("Arcane capacity is 1 / 2 / 3 Effects and 1 / 2 / 3 base Traits", () => {
    for (const [rank, n] of [["TRAINED", 1], ["EXPERT", 2], ["MASTER", 3]] as const) {
      const r = runConstruction(spellOf(F), { arcana: rank });
      expect([r.result.capacity.effects, r.result.capacity.traits], rank).toEqual([{ base: n, remaining: n }, { base: n, effective: n }]);
    }
  });

  it("§26 Arcane Expert + Evocation Master: Arcane Authority → 2 Effects, Affinity Authority → 3 Effects, never 5", () => {
    const arcane = runConstruction(spellOf(F, { effects: ["directDamage", "directDamage", "directDamage"] }), { arcana: "EXPERT", affinities: evocation("MASTER") });
    expect([arcane.result.capacity.effects.remaining, failing(arcane)]).toEqual([2, ["capacity.effects"]]);
    const affinity = runConstruction(affinitySpell({ effects: ["directDamage", "directDamage", "directDamage"] }), { arcana: "EXPERT", affinities: evocation("MASTER") });
    expect([affinity.result.capacity.effects.remaining, affinity.result.status]).toEqual([3, "VALID"]);
    const four = runConstruction(affinitySpell({ effects: ["directDamage", "directDamage", "directDamage", "directDamage"] }), { arcana: "EXPERT", affinities: evocation("MASTER") });
    expect(failing(four)).toEqual(["capacity.effects"]);
  });

  it("§64 Arcane TRAINED, trades = 1 → INVALID: the Spell would keep no Effect slot", () => {
    const r = runConstruction(spellOf(F, { traits: traits(2) }), { arcana: "TRAINED" }, { trades: 1 });
    expect(r.result.capacity.trades).toEqual({ requested: 1, maximum: 0, exchangeAvailable: true });
    expect(failing(r)).toEqual(["capacity.trades", "capacity.effects"]);
  });

  it("§65 Arcane EXPERT, trades = 1 → 1 Effect / 3 Traits, legal", () => {
    const r = runConstruction(spellOf(F, { traits: traits(3) }), { arcana: "EXPERT" }, { trades: 1 });
    expect([r.result.status, r.result.capacity.effects.remaining, r.result.capacity.traits.effective, r.result.capacity.trades.maximum]).toEqual(["VALID", 1, 3, 1]);
  });

  it("§66 Arcane MASTER, trades = 2 → 1 Effect / 5 Traits, legal; effective Trait capacity may exceed 3", () => {
    const r = runConstruction(spellOf(F, { traits: traits(5) }), { arcana: "MASTER" }, { trades: 2 });
    expect([r.result.status, r.result.capacity.effects.remaining, r.result.capacity.traits.effective, r.result.capacity.trades.maximum]).toEqual(["VALID", 1, 5, 2]);
    expect(failing(runConstruction(spellOf(F, { traits: traits(5) }), { arcana: "MASTER" }, { trades: 3 }))).toContain("capacity.trades");
  });

  it("§67 Evocation MASTER under Affinity Authority, trades = 2 → 1 Effect / 5 Traits, legal when every component passes access", () => {
    const r = runConstruction(affinitySpell({ traits: traits(5) }), { affinities: evocation("MASTER") }, { trades: 2 });
    expect([r.result.status, r.result.capacity.effects.remaining, r.result.capacity.traits.effective]).toEqual(["VALID", 1, 5]);
  });

  it("§61 a trade is never inferred from unused Effect capacity: Master, 1 Effect, 5 Traits, no trades → INVALID (Traits 5 > 3)", () => {
    expect(failing(runConstruction(spellOf(F, { traits: traits(5) }), { arcana: "MASTER" }))).toEqual(["capacity.traits"]);
  });

  it("§62 unused capacity may stay unused: Master, 1 Effect, 1 Trait, 0 trades → VALID", () => {
    expect(runConstruction(spellOf(F, { traits: traits(1) }), { arcana: "MASTER" }).result.status).toBe("VALID");
  });

  it("§11 a Spell must contain at least one Effect", () => {
    expect(failing(runConstruction(spellOf(F, { effects: [] }), { arcana: "MASTER" }))).toEqual(["capacity.minimum_effects"]);
  });
});

describe("§74–§76 / M5-I157 Casting Condition capacity comes from Arcane Rank only", () => {
  it("§74 Arcana UNTRAINED + Affinity MASTER under Affinity Authority, 1 Casting Condition → INVALID (capacity 0)", () => {
    const r = runConstruction(affinitySpell({ conditions: ["verbal"] }), { arcana: "UNTRAINED", affinities: evocation("MASTER") });
    expect([r.result.capacity.conditions.capacity, failing(r)]).toEqual([0, ["capacity.conditions"]]);
  });

  it("§75 Arcana TRAINED + Affinity MASTER under Affinity Authority: 1 Condition VALID, 2 INVALID", () => {
    expect(runConstruction(affinitySpell({ conditions: ["verbal"] }), { arcana: "TRAINED", affinities: evocation("MASTER") }).result.status).toBe("VALID");
    expect(failing(runConstruction(affinitySpell({ conditions: ["verbal", "somatic"] }), { arcana: "TRAINED", affinities: evocation("MASTER") }))).toEqual(["capacity.conditions"]);
  });

  it("§7 / §76 the capacity is UNTRAINED 0 · TRAINED 1 · EXPERT 2 · MASTER 3 under either Authority", () => {
    for (const [rank, n] of [["UNTRAINED", 0], ["TRAINED", 1], ["EXPERT", 2], ["MASTER", 3]] as const) {
      for (const spell of [spellOf(F), affinitySpell()]) {
        expect(runConstruction(spell, { arcana: rank, affinities: evocation("MASTER") }).result.capacity.conditions.capacity, rank).toBe(n);
      }
    }
    expect(runConstruction(affinitySpell({ conditions: ["verbal", "somatic", "material"] }), { arcana: "MASTER", affinities: evocation("TRAINED") }).result.status).toBe("VALID");
  });
});

describe("§12–§16 / §77–§79 / M5-I158 Maneuvers — Martial training, Martial capacity, Foundation and minimum Effect", () => {
  it("§77 Martial UNTRAINED → INVALID", () => {
    expect(failing(runConstruction(maneuverOf(F), { martial: "UNTRAINED" }))).toContain("access");
  });

  it("§77 Martial TRAINED / EXPERT / MASTER: Effects, Traits, Conditions and Rank Value 1 / 2 / 3", () => {
    for (const [rank, n] of [["TRAINED", 1], ["EXPERT", 2], ["MASTER", 3]] as const) {
      const r = runConstruction(maneuverOf(F), { martial: rank });
      expect([r.result.access.path, r.result.access.martialRankValue, r.result.capacity.effects.base, r.result.capacity.traits.base, r.result.capacity.conditions.capacity], rank).toEqual(["MARTIAL", n, n, n, n]);
      expect(r.result.access.rankSource).toEqual({ kind: "SKILL", track: "MARTIAL", skillKey: "skill.martial" });
    }
  });

  it("Martial capacity is enforced: Expert with a Targeting Conversion + 1 Effect VALID; + 2 more INVALID; 3 Conditions over 2 INVALID", () => {
    expect(runConstruction(maneuverOf(F, { effects: ["conversion", "strike"] }), { martial: "EXPERT" }).result.status).toBe("VALID");
    expect(failing(runConstruction(maneuverOf(F, { effects: ["conversion", "strike", "sweep"] }), { martial: "EXPERT" }))).toEqual(["capacity.effects"]);
    expect(failing(runConstruction(maneuverOf(F, { conditions: ["stance", "firstMove", "flanked"] }), { martial: "EXPERT" }))).toEqual(["capacity.conditions"]);
  });

  it("§78 Martial MASTER cannot trade an Effect slot for a Trait slot (no Maneuver exchange)", () => {
    const r = runConstruction(maneuverOf(F, { traits: [{ trait: "maneuverTrait", appliesTo: "effect1" }] }), { martial: "MASTER" }, { trades: 1 });
    expect(r.result.capacity.trades).toEqual({ requested: 1, maximum: 0, exchangeAvailable: false });
    expect(failing(r)).toEqual(["capacity.trades"]);
  });

  it("§79 a Foundation with 0 Maneuver Effects is not a Maneuver → INVALID", () => {
    expect(failing(runConstruction(maneuverOf(F, { effects: [] }), { martial: "MASTER" }))).toEqual(["capacity.minimum_effects"]);
  });

  it("§16 a Maneuver names its Foundation", () => {
    expect(failing(runConstruction(maneuverOf(F, { foundation: null }), { martial: "MASTER" }))).toEqual(["structure.foundation"]);
  });

  it("§A5-1 Martial UNTRAINED + Evocation MASTER → cannot construct a Maneuver", () => {
    expect(failing(runConstruction(maneuverOf(F, { affinity: "affinity.evocation" }), { martial: "UNTRAINED", affinities: evocation("MASTER") }))).toContain("access");
  });

  it("§A5-2 Martial TRAINED, no Affinity → an ordinary Maneuver is VALID", () => {
    expect(runConstruction(maneuverOf(F), { martial: "TRAINED" }).result.status).toBe("VALID");
  });

  it("§A5-3 / §A8 a Maneuver Effect requiring Evocation TRAINED: usable with it, INVALID without it — a separate Requirement from the Martial minimum (§A9)", () => {
    const ok = runConstruction(maneuverOf(F, { effects: ["emberStrike"] }), { martial: "TRAINED", affinities: evocation("TRAINED") });
    expect(ok.result.status).toBe("VALID");
    expect(ok.result.prerequisites).toEqual([{ componentKey: "effect1", ruleKey: "prerequisite.effect1.evocation_trained", satisfied: true }]);
    const no = runConstruction(maneuverOf(F, { effects: ["emberStrike"] }), { martial: "TRAINED" });
    expect(failing(no)).toEqual(["prerequisite.effect1.evocation_trained"]);
    expect(no.result.rules.filter((x) => x.family === "ACCESS").map((x) => x.satisfied)).toEqual([true]);
  });

  it("§A5-4 / §A6 Martial MASTER + Enhancement MASTER: Martial governs capacity — 3 Effects, never 6", () => {
    const r = runConstruction(maneuverOf(F, { affinity: "affinity.enhancement", effects: ["strike", "sweep", "feint", "conversion"] }), { martial: "MASTER", affinities: [["affinity.enhancement", "MASTER"]] });
    expect([r.result.capacity.effects.base, failing(r)]).toEqual([3, ["capacity.effects"]]);
  });

  it("§A7 an Affinity-assisted Maneuver remains a MANEUVER", () => {
    expect(runConstruction(maneuverOf(F, { affinity: "affinity.evocation" }), { martial: "TRAINED", affinities: evocation("TRAINED") }).result.abilityKind).toBe("MANEUVER");
  });
});

describe("§52–§58 / §80–§84 stacking is explicit and obeys the Definition's own limit", () => {
  it("§80 stackable, fixed limit 3, stacks 3 → 1 Effect slot, VALID", () => {
    const r = runConstruction(spellOf(F, { effects: [{ c: "stackable3", stacks: 3 }] }), { arcana: "TRAINED" });
    expect([r.result.status, r.result.usage.effects, r.result.stacking]).toEqual(["VALID", 1, [{ componentKey: "effect1", stacks: 3, limit: 3, limitSource: "FIXED", satisfied: true }]]);
  });

  it("§81 the same Effect with stacks 4 → INVALID", () => {
    expect(failing(runConstruction(spellOf(F, { effects: [{ c: "stackable3", stacks: 4 }] }), { arcana: "TRAINED" }))).toEqual(["stacking.effect1"]);
  });

  it("§82 a non-stackable Effect with stacks 2 → INVALID", () => {
    expect(failing(runConstruction(spellOf(F, { effects: [{ c: "directDamage", stacks: 2 }] }), { arcana: "TRAINED" }))).toEqual(["stacking.effect1"]);
  });

  it("§83 stack limit = Martial Rank Value only when the Effect says so: Martial EXPERT, stacks 2 VALID, 3 INVALID", () => {
    expect(runConstruction(maneuverOf(F, { effects: [{ c: "flurry", stacks: 2 }] }), { martial: "EXPERT" }).result.status).toBe("VALID");
    expect(failing(runConstruction(maneuverOf(F, { effects: [{ c: "flurry", stacks: 3 }] }), { martial: "EXPERT" }))).toEqual(["stacking.effect1"]);
  });

  it("§84 a fixed maximum of 4 is never reduced to Rank Value: Martial TRAINED, stacks 4 → VALID", () => {
    expect(runConstruction(maneuverOf(F, { effects: [{ c: "barrage", stacks: 4 }] }), { martial: "TRAINED" }).result.status).toBe("VALID");
  });

  it("§58 two separate uses of one Effect Definition are two Effect slots — never silently merged into stacks", () => {
    const r = runConstruction(spellOf(F, { effects: ["stackable3", "stackable3"] }), { arcana: "TRAINED" });
    expect([r.result.usage.effects, failing(r)]).toEqual([2, ["capacity.effects"]]);
  });
});

describe("§45–§51 / §85–§89 Signature Ability slots", () => {
  it("§85 PRO 4, 3 used, a default permanent Spell → VALID, 0 slots left after", () => {
    const r = runConstruction(spellOf(F), { arcana: "TRAINED", pro: 4 }, { usedSlots: 3 });
    expect(r.result.signature).toEqual(expect.objectContaining({ capacity: 4, usedBefore: 3, candidateUse: 1, projected: 4, availableAfter: 0, satisfied: true }));
  });

  it("§86 PRO 4, 4 used, a default permanent Maneuver → INVALID", () => {
    expect(failing(runConstruction(maneuverOf(F), { martial: "TRAINED", pro: 4 }, { usedSlots: 4 }))).toEqual(["signature.capacity"]);
  });

  it("§87 PRO 4, 4 used, an exact authored exemption → VALID, 0 slots, provenance kept", () => {
    const rule = JSON.parse(JSON.stringify(F.bundle.definitions.find((d) => d.canonicalKey === "construction.ability_rules")?.payload)) as { signature: { exemptions: unknown[] } };
    rule.signature.exemptions = [{ exemptionKey: "TEMPORARY_COPY", description: "test-only: a temporarily copied Ability uses no Signature slot" }];
    const f = constructionFixture({ revise: { "construction.ability_rules": rule as unknown as Record<string, unknown> } });
    const r = runConstruction(spellOf(f), { arcana: "TRAINED", pro: 4 }, { usedSlots: 4, candidate: { slotUse: "EXEMPT", exemptionKey: "TEMPORARY_COPY" } }, f);
    expect([r.result.status, r.result.signature.candidateUse, r.result.signature.exemption]).toEqual(["VALID", 0, { exemptionKey: "TEMPORARY_COPY", rule: f.ref("construction.ability_rules") }]);
  });

  it("§88 EXEMPT without an exact authored exemption rule → INVALID", () => {
    expect(failing(runConstruction(spellOf(F), { arcana: "TRAINED" }, { candidate: { slotUse: "EXEMPT", exemptionKey: null } }))).toEqual(["signature.exemption"]);
    expect(failing(runConstruction(spellOf(F), { arcana: "TRAINED" }, { candidate: { slotUse: "EXEMPT", exemptionKey: "TEMPORARY_COPY" } }))).toEqual(["signature.exemption"]);
  });

  it("§89 complexity never changes slot use: Master, 3 Effects, 3 Traits, 3 Conditions → 1 slot", () => {
    const r = runConstruction(spellOf(F, { effects: ["directDamage", "directDamage", "directDamage"], traits: traits(3), conditions: ["verbal", "somatic", "material"] }), { arcana: "MASTER" });
    expect([r.result.status, r.result.signature.candidateUse]).toEqual(["VALID", 1]);
  });

  it("§45 capacity is the WO2 statistic (= PRO)", () => {
    for (const pro of [1, 4, 7]) expect(runConstruction(spellOf(F), { arcana: "TRAINED", pro }).result.signature.capacity).toBe(pro);
  });
});

describe("§36–§41 component prerequisites", () => {
  it("a Skill prerequisite (Arcana EXPERT) is evaluated by M4: TRAINED → INVALID, EXPERT → VALID", () => {
    expect(failing(runConstruction(spellOf(F, { effects: ["expertArcana"] }), { arcana: "TRAINED" }))).toEqual(["prerequisite.effect1.arcana_expert"]);
    expect(runConstruction(spellOf(F, { effects: ["expertArcana"] }), { arcana: "EXPERT" }).result.status).toBe("VALID");
  });

  it("an Affinity prerequisite (Evocation EXPERT) is checked in addition to the Authority", () => {
    expect(failing(runConstruction(spellOf(F, { effects: ["evocationExpert"] }), { arcana: "MASTER", affinities: evocation("TRAINED") }))).toEqual(["prerequisite.effect1.evocation_expert"]);
    expect(runConstruction(spellOf(F, { effects: ["evocationExpert"] }), { arcana: "MASTER", affinities: evocation("EXPERT") }).result.status).toBe("VALID");
  });
});

describe("§94 the result explains itself", () => {
  it("Evocation Master Spell, Arcane Trained, 1 trade, 2 Effects, 4 Traits, 1 Condition, 2 of 4 Signature slots used", () => {
    const r = runConstruction(affinitySpell({ effects: ["directDamage", "healing"], traits: traits(4), conditions: ["verbal"] }), { arcana: "TRAINED", affinities: evocation("MASTER"), pro: 4 }, { trades: 1, usedSlots: 2 });
    expect(r.result.status).toBe("VALID");
    expect({ access: [r.result.access.path, r.result.access.rank], effects: [r.result.usage.effects, r.result.capacity.effects.remaining], traits: [r.result.usage.traits, r.result.capacity.traits.effective], conditions: [r.result.usage.conditions, r.result.capacity.conditions], signature: [r.result.signature.projected, r.result.signature.capacity] }).toEqual({
      access: ["AFFINITY_AUTHORITY", "MASTER"],
      effects: [2, 2],
      traits: [4, 4],
      conditions: [1, { capacity: 1, source: { track: "ARCANE", rank: "TRAINED" } }],
      signature: [3, 4],
    });
    for (const rule of r.result.rules) expect(rule.outcome, rule.ruleKey).toEqual(expect.objectContaining({ satisfied: true }));
  });
});
