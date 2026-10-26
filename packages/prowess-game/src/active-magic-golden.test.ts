import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ActiveMagicTransition } from "./ability/active-magic.js";
import { executionKeyOf, saveInput } from "./testing/effect-execution-fixtures.js";
import { activeMagicFixture, caster, cur, d6, next, pool, refused, tx, type Fixture, type Step } from "./testing/active-magic-fixtures.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 600_000 });

/**
 * M5-WO13 goldens — ACTIVE MAGIC RUNTIME. Every Sustain MP, Concentration capacity and DC is an M4 Formula; every AP / ME
 * / MP / Mana Lock change is a WO3 runtime plan; every Concentration Save is WO2's Prowess Saving Throw; Final Spell MP / AP
 * come from WO10 and persistent outcomes from WO12. Guard index (docs/architecture/m5-invariants.json): M5-I316 · M5-I317 ·
 * M5-I318 · M5-I319 · M5-I320 · M5-I321 · M5-I322 · M5-I323 · M5-I324 · M5-I325 · M5-I326 · M5-I327 · M5-I328 · M5-I329 ·
 * M5-I330 · M5-I331 · M5-I332 · M5-I334 · M5-I335.
 */
const activate = (f: Fixture, step: Step, key: string, spell: string, pro = 4, round?: number) => tx(f, step, { kind: "ACTIVATE", activeEffectKey: key, ability: f.ability(spell, pro), ...(round === undefined ? {} : { round }) });
const statusOf = (t: ActiveMagicTransition) => t.state.effects.map((e) => [e.activeEffectKey, e.status, e.endReason]);
const FULL = pool({ AP: 3, ME: 3, MP: 20 });
/** Resource state as { key: [current, reserved] } (order- and default-insensitive). */
const bag = (r: unknown) => Object.fromEntries((r as { resources: { resourceKey: string; current: number; reservedCapacity?: number }[] }).resources.map((x) => [x.resourceKey, [x.current, x.reservedCapacity ?? 0]]));

let F: Fixture;
beforeAll(() => { F = activeMagicFixture({ heavyMp: 14 }); });

describe("Instant and Timed lifecycle (M5-I316, M5-I317, M5-I334)", () => {
  it("an Instant Spell resolves once and leaves NO Active Effect state; resources untouched", () => {
    const t = activate(F, { state: null, resources: FULL }, "x", "fixture.wo13.spell.instant");
    expect([t.status, t.noActiveEffectReason, t.state.effects, t.resourceChanges, bag(t.resources)]).toEqual(["NO_ACTIVE_EFFECT", "INSTANT", [], [], bag(FULL)]);
  });

  it("an outcome that does not persist (target saved: NO_EFFECT) creates no Active Effect — a Duration alone never does", () => {
    const ability = F.ability("fixture.wo13.spell.hex_rounds", 4, null);
    const ek = executionKeyOf({ ...ability, definitions: F.bundle, ruleset: F.ruleset });
    const execution = { targets: [{ targetKey: "foe" }], inputs: [saveInput(ek, "wo12.exec.foe.effect.effect1.saving_throw", 6)] };
    const t = tx(F, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "x", ability: { ...ability, execution } });
    expect([t.status, t.noActiveEffectReason, t.state.effects]).toEqual(["NO_ACTIVE_EFFECT", "NOTHING_PERSISTS", []]);
  });

  it("ROUNDS 3: 3 → 2 → 1 → 0 at explicit round ends, then ENDED / EXPIRED; no Sustain, no Concentration, no upkeep", () => {
    const a = activate(F, { state: null, resources: FULL }, "r", "fixture.wo13.spell.rounds", 4, 1);
    const e = a.state.effects[0]!;
    expect([e.duration.concept, e.duration.remainingRounds, e.sustain, e.concentration.required, e.manaLock, a.concentration.used]).toEqual(["ROUNDS", 3, null, false, null, 0]);
    const r1 = tx(F, next(a), { kind: "ROUND_END" }), r2 = tx(F, next(r1), { kind: "ROUND_END" }), r3 = tx(F, next(r2), { kind: "ROUND_END" });
    expect([r1, r2, r3].map((t) => [t.state.effects[0]!.duration.remainingRounds, t.state.effects[0]!.status, t.state.effects[0]!.endReason])).toEqual([[2, "ACTIVE", null], [1, "ACTIVE", null], [0, "ENDED", "EXPIRED"]]);
    expect([bag(r3.resources), r3.resourceChanges]).toEqual([bag(FULL), []]);
    const m = tx(F, next(r1), { kind: "MAINTENANCE" });
    expect([m.resourceChanges, bag(m.resources)]).toEqual([[], bag(FULL)]); // a Timed Effect is never charged Sustain
  });

  it("COMBAT stays ACTIVE through round ends and ends only at an explicit COMBAT_END; SCENE / MISSION likewise", () => {
    let s: Step = { state: null, resources: FULL };
    for (const [k, spell] of [["c", "combat"], ["s", "scene"], ["m", "mission"]] as const) s = next(activate(F, s, k, `fixture.wo13.spell.${spell}`));
    let t = tx(F, s, { kind: "ROUND_END" });
    for (let i = 0; i < 4; i += 1) t = tx(F, next(t), { kind: "ROUND_END" });
    expect(statusOf(t)).toEqual([["c", "ACTIVE", null], ["s", "ACTIVE", null], ["m", "ACTIVE", null]]);
    const c = tx(F, next(t), { kind: "BOUNDARY", boundary: "COMBAT_END" });
    expect(statusOf(c)).toEqual([["c", "ENDED", "COMBAT_ENDED"], ["s", "ACTIVE", null], ["m", "ACTIVE", null]]);
    const sc = tx(F, next(c), { kind: "BOUNDARY", boundary: "SCENE_END" }), mi = tx(F, next(sc), { kind: "BOUNDARY", boundary: "MISSION_END" });
    expect(statusOf(mi)).toEqual([["c", "ENDED", "COMBAT_ENDED"], ["s", "ENDED", "SCENE_ENDED"], ["m", "ENDED", "MISSION_ENDED"]]);
  });

  it("a Timed Effect is not dismissible early by default: refused, state unchanged", () => {
    const a = activate(F, { state: null, resources: FULL }, "r", "fixture.wo13.spell.rounds");
    expect(refused(F, next(a), { kind: "DISMISS", activeEffectKey: "r" })).toEqual(["PROWESS_ACTIVE_MAGIC.NOT_DISMISSIBLE"]);
  });

  it("a Sustained Effect is dismissed as a Free Action: ENDED / DISMISSED, slot released, no AP spent", () => {
    const a = activate(F, { state: null, resources: FULL }, "s", "fixture.wo13.spell.sustained");
    const d = tx(F, next(a), { kind: "DISMISS", activeEffectKey: "s" });
    expect([statusOf(d), a.concentration.used, d.concentration.used, d.resourceChanges, bag(d.resources)]).toEqual([[["s", "ENDED", "DISMISSED"]], 1, 0, [], bag(FULL)]);
  });
});

describe("Sustain (M5-I318–I322)", () => {
  it("Final MP 17 (WO10), PRO 4 → floor(4.25) = 4 MP / round, plus 1 AP / round; Concentration required", () => {
    const a = activate(F, { state: null, resources: FULL }, "h", "fixture.wo13.spell.sustained_heavy");
    const e = a.state.effects[0]!;
    expect([e.sustain, e.concentration.required]).toEqual([{ finalSpellMp: 17, pro: 4, mpCost: 4, apCost: 1, meEligible: true, lastPayment: null }, true]);
    expect(e.sourceMap.map((s) => [s.role, s.value])).toEqual([["sustain_mp", 4]]);
  });

  it("Final MP 18, PRO 4 → 4.5 rounds DOWN to 4 (never normal rounding)", () => {
    const f = activeMagicFixture(); // heavy Effect 15 MP + targeting → Final MP 18
    const a = activate(f, { state: null, resources: FULL }, "h", "fixture.wo13.spell.sustained_heavy");
    expect(a.state.effects[0]!.sustain).toEqual(expect.objectContaining({ finalSpellMp: 18, pro: 4, mpCost: 4 }));
  });

  it("Final MP 4, PRO 5 → floor(0.8) = 0 → minimum 1 MP / round", () => {
    const a = tx(F, { state: null, resources: FULL, caster: caster({ PRO: 5 }) }, { kind: "ACTIVATE", activeEffectKey: "l", ability: F.ability("fixture.wo13.spell.sustained_light", 5) });
    expect(a.state.effects[0]!.sustain).toEqual(expect.objectContaining({ finalSpellMp: 4, pro: 5, mpCost: 1, apCost: 1 }));
  });

  it("ME first, then MP: Sustain 5 with ME 3 / MP 10 → ME 0, MP 8, paid 3 ME + 2 MP; the Sustain Cost stays 5", () => {
    const f = activeMagicFixture({ heavyMp: 17 }); // Final MP 20 → 5 / round
    const a = activate(f, { state: null, resources: pool({ AP: 3, ME: 3, MP: 10 }) }, "h", "fixture.wo13.spell.sustained_heavy");
    const m = tx(f, next(a), { kind: "MAINTENANCE" });
    const e = m.state.effects[0]!;
    expect([cur(m, "AP").current, cur(m, "ME").current, cur(m, "MP").current, e.sustain!.mpCost, e.sustain!.lastPayment]).toEqual([2, 0, 8, 5, { ap: 1, me: 3, mp: 2 }]);
    expect(m.resourceChanges.map((c) => [c.resourceKey, c.operation, c.amount, c.before, c.after, c.ruleKey])).toEqual([["AP", "SPEND", 1, 3, 2, "sustain.ap"], ["ME", "PAYMENT", 3, 3, 0, "sustain.mp"], ["MP", "PAYMENT", 2, 10, 8, "sustain.mp"]]);
    expect(m.inspector.effects[0]!.sustain).toEqual({ mpCost: 5, apCost: 1, paymentSource: { ap: 1, me: 3, mp: 2 } });
  });

  it("Sustain 4 with ME 5 → 4 ME + 0 MP; ME 1 remains; the cost is still 4 (Final MP 20, PRO 5)", () => {
    const f = activeMagicFixture({ heavyMp: 17 }), c = caster({ PRO: 5 });
    const a = tx(f, { state: null, resources: pool({ AP: 3, ME: 5, MP: 10 }), caster: c }, { kind: "ACTIVATE", activeEffectKey: "h", ability: f.ability("fixture.wo13.spell.sustained_heavy", 5) });
    const m = tx(f, next(a, c), { kind: "MAINTENANCE" });
    expect([cur(m, "ME").current, cur(m, "MP").current, m.state.effects[0]!.sustain!.mpCost, m.state.effects[0]!.sustain!.lastPayment]).toEqual([1, 10, 4, { ap: 1, me: 4, mp: 0 }]);
  });

  it("unpayable upkeep (5 MP + 1 AP vs ME 1 / MP 2 / AP 3): nothing is spent at all and the Effect ends SUSTAIN_UNPAID", () => {
    const f = activeMagicFixture({ heavyMp: 17 });
    const start = pool({ AP: 3, ME: 1, MP: 2 });
    const a = activate(f, { state: null, resources: start }, "h", "fixture.wo13.spell.sustained_heavy");
    const m = tx(f, next(a), { kind: "MAINTENANCE" });
    expect([statusOf(m), bag(m.resources), m.resourceChanges, m.concentration.used]).toEqual([[["h", "ENDED", "SUSTAIN_UNPAID"]], bag(start), [], 0]);
  });

  it("missing AP alone also fails the whole upkeep atomically (no ME / MP spent)", () => {
    const start = pool({ AP: 0, ME: 5, MP: 10 });
    const a = activate(F, { state: null, resources: start }, "h", "fixture.wo13.spell.sustained_heavy");
    const m = tx(F, next(a), { kind: "MAINTENANCE" });
    expect([statusOf(m), bag(m.resources)]).toEqual([[["h", "ENDED", "SUSTAIN_UNPAID"]], bag(start)]);
  });
});

describe("several Sustained Effects (M5-I318, M5-I322)", () => {
  let two: Step;
  beforeAll(() => {
    const a = activate(F, { state: null, resources: pool({ AP: 3, ME: 0, MP: 20 }) }, "a", "fixture.wo13.spell.sustained");
    two = next(activate(F, next(a), "b", "fixture.wo13.spell.sustained_b"));
  });

  it("each Effect pays its own upkeep (2 MP + 1 AP each), in stable identity order, when all are affordable", () => {
    const m = tx(F, two, { kind: "MAINTENANCE" });
    expect([cur(m, "AP").current, cur(m, "MP").current, m.resourceChanges.map((c) => [c.subjectKey, c.resourceKey, c.amount])]).toEqual([1, 16, [["a", "AP", 1], ["a", "MP", 2], ["b", "AP", 1], ["b", "MP", 2]]]);
  });

  it("when not all can be maintained the engine never chooses: PENDING_MAINTENANCE_SELECTION, no mutation; the controller selects", () => {
    const short = { ...two, resources: pool({ AP: 1, ME: 0, MP: 20 }) };
    const m = tx(F, short, { kind: "MAINTENANCE" });
    expect([m.status, m.pending, statusOf(m), bag(m.resources), m.resourceChanges]).toEqual(["PENDING_MAINTENANCE_SELECTION", { kind: "MAINTENANCE_SELECTION", options: ["a", "b"], requestKey: "wo13.caster.1.maintenance" }, [["a", "PENDING_MAINTENANCE", null], ["b", "PENDING_MAINTENANCE", null]], bag(short.resources), []]);
    expect(refused(F, next(m), { kind: "ROUND_END" })).toEqual(["PROWESS_ACTIVE_MAGIC.PENDING_DECISION"]);
    const chosen = tx(F, next(m), { kind: "MAINTENANCE", selection: ["b"] });
    expect([statusOf(chosen), cur(chosen, "AP").current, cur(chosen, "MP").current]).toEqual([[["a", "ENDED", "SUSTAIN_UNPAID"], ["b", "ACTIVE", null]], 0, 18]);
    expect(refused(F, next(m), { kind: "MAINTENANCE", selection: ["a", "b"] })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_SELECTION"]);
  });
});

describe("Mana Lock (M5-I323, M5-I324)", () => {
  it("Max 40 / current 40, lock 12 → available maximum 28, current 40 (nothing spent); after spending to 16 the end restores 40, current stays 16", () => {
    const f = activeMagicFixture({ manaLock: { kind: "FIXED", amount: 12 } });
    const c = caster({}, 36);
    const a = tx(f, { state: null, resources: pool({ AP: 3, ME: 0, MP: 40 }), caster: c }, { kind: "ACTIVATE", activeEffectKey: "lock", ability: f.ability("fixture.wo13.spell.locked") });
    const ch = a.resourceChanges[0]!;
    expect([ch.operation, ch.amount, ch.before, ch.after, ch.availableMaximumBefore, ch.availableMaximumAfter, ch.reservedAfter]).toEqual(["RESERVE_CAPACITY", 12, 40, 40, 40, 28, 12]);
    expect([a.state.effects[0]!.manaLock, a.state.effects[0]!.sustain, a.state.effects[0]!.concentration.required, a.inspector.mp]).toEqual([{ reservedMp: 12, rule: "FIXED" }, null, false, { reserved: 12, availableMaximum: 28, current: 40 }]);
    const later = { state: a.state, resources: pool({ AP: 3, ME: 0, MP: 16 }, 12), caster: c };
    expect(refused(f, later, { kind: "DISMISS", activeEffectKey: "lock" })).toEqual(["PROWESS_ACTIVE_MAGIC.NOT_DISMISSIBLE"]);
    const end = tx(f, later, { kind: "EXTERNAL_END", activeEffectKey: "lock", end: "DISPELLED", sourceKey: "spell.dispel" });
    const r = end.resourceChanges[0]!;
    expect([statusOf(end), r.operation, r.availableMaximumAfter, r.after, cur(end, "MP").reservedCapacity, cur(end, "MP").current]).toEqual([[["lock", "ENDED", "DISPELLED"]], "RELEASE_CAPACITY", 40, 16, 0, 16]);
  });

  it("locks stack per exact Active Effect: Max 50, A 10 + B 15 → 25; A ends → 35; current unchanged", () => {
    const f = activeMagicFixture({ manaLock: { kind: "FINAL_SPELL_MP" }, heavyMp: 12 });
    const c = caster({}, 46);
    const a = tx(f, { state: null, resources: pool({ AP: 3, ME: 0, MP: 30 }), caster: c }, { kind: "ACTIVATE", activeEffectKey: "A", ability: f.ability("fixture.wo13.spell.locked_a") });
    const b = tx(f, next(a, c), { kind: "ACTIVATE", activeEffectKey: "B", ability: f.ability("fixture.wo13.spell.locked_b") });
    expect([a.state.effects[0]!.manaLock!.reservedMp, b.state.effects[1]!.manaLock!.reservedMp, b.inspector.mp.availableMaximum]).toEqual([10, 15, 25]);
    const e = tx(f, next(b, c), { kind: "EXTERNAL_END", activeEffectKey: "A", end: "SOURCE_ENDED", sourceKey: "spell.source" });
    expect([statusOf(e), e.inspector.mp, cur(e, "MP").current]).toEqual([[["A", "ENDED", "SOURCE_DESTROYED"], ["B", "ACTIVE", null]], { reserved: 15, availableMaximum: 35, current: 30 }, 30]);
  });

  it("the canonical Ruleset has no exact lock amount: Mana Lock activation fails closed (M5-SC-052)", () => {
    expect(refused(F, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "x", ability: F.ability("fixture.wo13.spell.locked") })).toEqual(["PROWESS_ACTIVE_MAGIC.UNRESOLVED_RUNTIME_RULE"]);
  });
});

describe("Concentration (M5-I325–I328)", () => {
  it.each([[1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [6, 4]])("RES %i → %i slots (1 + 1 per 2 complete Resolve)", (res, slots) => {
    expect(tx(F, { state: null, resources: FULL, caster: caster({ RES: res }) }, { kind: "TIMING", timing: "ON_ROUND_START" }).concentration.capacity).toBe(slots);
  });

  let three: Step, s4: ActiveMagicTransition[];
  beforeAll(() => {
    const c = caster({ RES: 6 });
    const a = activate(F, { state: null, resources: FULL, caster: c }, "A", "fixture.wo13.spell.sustained");
    const b = tx(F, next(a, c), { kind: "ACTIVATE", activeEffectKey: "B", ability: F.ability("fixture.wo13.spell.sustained_b") });
    const cc = tx(F, next(b, c), { kind: "ACTIVATE", activeEffectKey: "C", ability: F.ability("fixture.wo13.spell.sustained_c") });
    const d = tx(F, next(cc, c), { kind: "ACTIVATE", activeEffectKey: "D", ability: F.ability("fixture.wo13.spell.sustained_heavy") });
    s4 = [a, b, cc, d];
    three = next(cc, c);
  });

  it("DC = 8 + 2 per additional consumer: 1 → 8, 2 → 10, 3 → 12, 4 → 14", () => {
    expect(s4.map((t) => [t.concentration.used, t.inspector.concentration.dc])).toEqual([[1, 8], [2, 10], [3, 12], [4, 14]]);
  });

  it("three active, B disrupted, the Prowess Save fails (d6 1 + PRO 4 = 5 < DC 12): only B ends; A and C remain", () => {
    const t = tx(F, three, { kind: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: "B", roll: d6(1) });
    expect([t.concentration.test!.consumers, t.concentration.test!.dc, t.concentration.test!.stat, t.concentration.test!.result, t.concentration.test!.core!.total]).toEqual([3, 12, "PRO", "FAILURE", 5]);
    expect([statusOf(t), t.concentration.used]).toEqual([[["A", "ACTIVE", null], ["B", "ENDED", "CONCENTRATION_FAILED"], ["C", "ACTIVE", null]], 2]);
  });

  it("an explicit severe break (failureScope ALL) ends every Concentration consumer", () => {
    const t = tx(F, three, { kind: "CONCENTRATION_TEST", trigger: "MAGICAL_DISRUPTION", target: "B", failureScope: "ALL", roll: d6(1), sourceKey: "gm.severe_disruption" });
    expect(statusOf(t)).toEqual([["A", "ENDED", "CONCENTRATION_FAILED"], ["B", "ENDED", "CONCENTRATION_FAILED"], ["C", "ENDED", "CONCENTRATION_FAILED"]]);
  });

  it("a passed Save (1 consumer, d6 4 + PRO 4 = 8 vs DC 8) keeps the Effect: nothing refunded, nothing granted", () => {
    const t = tx(F, next(s4[0]!, caster({ RES: 6 })), { kind: "CONCENTRATION_TEST", trigger: "GRAPPLED", target: "A", roll: d6(4) });
    expect([t.concentration.test!.result, t.concentration.test!.dc, statusOf(t), t.resourceChanges]).toEqual(["SUCCESS", 8, [["A", "ACTIVE", null]], []]);
  });

  it("no roll yet → PENDING_INPUT with a stable request; only the test resolves it", () => {
    const t = tx(F, three, { kind: "CONCENTRATION_TEST", trigger: "CONCENTRATION_TEST_REQUIRED", target: "C" });
    expect([t.status, t.pending, t.state.effects[2]!.status]).toEqual(["PENDING_INPUT", { kind: "CONCENTRATION_SAVE", options: ["PRO"], requestKey: "wo13.caster.1.concentration.C" }, "PENDING_CONCENTRATION"]);
    expect(refused(F, next(t, caster({ RES: 6 })), { kind: "MAINTENANCE" })).toEqual(["PROWESS_ACTIVE_MAGIC.PENDING_DECISION"]);
    const done = tx(F, next(t, caster({ RES: 6 })), { kind: "CONCENTRATION_TEST", trigger: "CONCENTRATION_TEST_REQUIRED", target: "C", roll: d6(1) });
    expect(statusOf(done)[2]).toEqual(["C", "ENDED", "CONCENTRATION_FAILED"]);
  });

  it("starting another consumer beyond capacity is refused — no existing Effect is terminated automatically", () => {
    const one = caster({ RES: 1 });
    const a = tx(F, { state: null, resources: FULL, caster: one }, { kind: "ACTIVATE", activeEffectKey: "A", ability: F.ability("fixture.wo13.spell.sustained") });
    expect(refused(F, next(a, one), { kind: "ACTIVATE", activeEffectKey: "B", ability: F.ability("fixture.wo13.spell.sustained_b") })).toEqual(["PROWESS_ACTIVE_MAGIC.CONCENTRATION_CAPACITY"]);
    expect(refused(F, next(a, one), { kind: "CHANNEL_START", channelKey: "ch", ability: F.ability("fixture.wo13.spell.channel", 4, null) })).toEqual(["PROWESS_ACTIVE_MAGIC.CONCENTRATION_CAPACITY"]);
  });
});

describe("Channeling (M5-I329–I332)", () => {
  let G: Fixture;
  beforeAll(() => { G = activeMagicFixture({ heavyMp: 17 }); }); // Final MP 20: PRO 4 → 5 AP; PRO 3 → 6 AP
  const start = (f: Fixture, pro: number, res: { AP: number }) => tx(f, { state: null, resources: pool({ AP: res.AP, ME: 0, MP: 20 }), caster: caster({ PRO: pro }) }, { kind: "CHANNEL_START", channelKey: "ch", ability: f.ability("fixture.wo13.spell.channel", pro, null) });

  it("5 AP Spell: invest 3 (3/5), Save passes, next round invest 2 → COMPLETE immediately, ready to resolve; AP spent via WO3; MP timing unresolved", () => {
    const s = start(G, 4, { AP: 3 });
    expect([s.state.channel!.requiredAp, s.state.channel!.investedAp, s.concentration.used, s.inspector.channel]).toEqual([5, 0, 1, { spell: s.state.channel!.spell, requiredAp: 5, investedAp: 0, remainingAp: 5, concentrationSlot: true, status: "CHANNELING" }]);
    const i1 = tx(G, next(s, caster({ PRO: 4 })), { kind: "CHANNEL_INVEST", amount: 3 });
    expect([i1.state.channel!.investedAp, cur(i1, "AP").current, i1.resourceChanges.map((c) => [c.resourceKey, c.amount, c.ruleKey])]).toEqual([3, 0, [["AP", 3, "channel.ap"]]]);
    const save = tx(G, next(i1, caster({ PRO: 4 })), { kind: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: "CHANNEL", roll: d6(4) });
    expect([save.concentration.test!.dc, save.concentration.test!.result, save.state.channel!.investedAp]).toEqual([8, "SUCCESS", 3]);
    const r = tx(G, next(save, caster({ PRO: 4 })), { kind: "ROUND_END" });
    const i2 = tx(G, { state: r.state, resources: pool({ AP: 3, ME: 0, MP: 20 }), caster: caster({ PRO: 4 }) }, { kind: "CHANNEL_INVEST", amount: 2 });
    expect([i2.state.channel, i2.channelResult, i2.concentration.used, cur(i2, "AP").current, cur(i2, "MP").current]).toEqual([null, { channelKey: "ch", spell: s.state.channel!.spell, status: "COMPLETE", requiredAp: 5, investedAp: 5, readyToResolve: true, mpPayment: { status: "UNRESOLVED", conflictKey: "M5-SC-053" } }, 0, 1, 20]);
  });

  it("6 AP Spell, 4 invested, the Save fails: the Spell fails, all progress is lost, a new attempt starts at 0/6; no AP refunded", () => {
    const s = start(G, 3, { AP: 4 });
    const i = tx(G, next(s, caster({ PRO: 3 })), { kind: "CHANNEL_INVEST", amount: 4 });
    const fail = tx(G, next(i, caster({ PRO: 3 })), { kind: "CONCENTRATION_TEST", trigger: "STUNNED", target: "CHANNEL", roll: d6(1) });
    expect([fail.state.channel, fail.channelResult!.status, fail.channelResult!.investedAp, cur(fail, "AP").current, fail.concentration.used]).toEqual([null, "FAILED", 0, 0, 0]);
    const again = tx(G, { state: fail.state, resources: pool({ AP: 3, ME: 0, MP: 20 }), caster: caster({ PRO: 3 }) }, { kind: "CHANNEL_START", channelKey: "ch2", ability: G.ability("fixture.wo13.spell.channel", 3, null) });
    expect([again.state.channel!.requiredAp, again.state.channel!.investedAp]).toEqual([6, 0]);
  });

  it("only one Channel at a time; overpayment is refused; a round with no AP progress abandons the Channel; stopping refunds nothing", () => {
    const s = start(G, 4, { AP: 3 });
    expect(refused(G, next(s, caster({ PRO: 4 })), { kind: "CHANNEL_START", channelKey: "other", ability: G.ability("fixture.wo13.spell.channel", 4, null) })).toEqual(["PROWESS_ACTIVE_MAGIC.CHANNEL_LIMIT"]);
    expect(refused(G, next(s, caster({ PRO: 4 })), { kind: "CHANNEL_INVEST", amount: 6 })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(G, next(s, caster({ PRO: 4 })), { kind: "CHANNEL_INVEST", amount: 0 })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    const idle = tx(G, next(s, caster({ PRO: 4 })), { kind: "ROUND_END" });
    expect([idle.state.channel, idle.channelResult?.status, idle.lifecycle]).toEqual([null, "ABANDONED", [{ subjectKey: "ch", from: "CHANNELING", to: "ABANDONED", reason: "channel.minimum_ap_per_round" }]]);
    const i = tx(G, next(s, caster({ PRO: 4 })), { kind: "CHANNEL_INVEST", amount: 2 });
    const stop = tx(G, next(i, caster({ PRO: 4 })), { kind: "CHANNEL_STOP" });
    expect([stop.state.channel, stop.channelResult!.status, stop.channelResult!.investedAp, cur(stop, "AP").current]).toEqual([null, "ABANDONED", 0, 1]);
  });
});

describe("Active Effect ticks and external ends", () => {
  it("a structured outcome timing emits ACTIVE_EFFECT_TICK_DUE (never applied); other timings emit nothing", () => {
    const a = activate(F, { state: null, resources: FULL }, "t", "fixture.wo13.spell.ticking");
    expect(tx(F, next(a), { kind: "TIMING", timing: "START_OF_TARGET_TURN", targetKey: "ally" }).ticks).toEqual([{ activeEffectKey: "t", timing: "START_OF_TARGET_TURN", targetKey: "ally", effectKey: "effect1", kind: "ACTIVE_EFFECT_TICK_DUE" }]);
    expect(tx(F, next(a), { kind: "TIMING", timing: "END_OF_CASTER_TURN" }).ticks).toEqual([]);
  });

  it("an external end releases only the exact Effect's own slot; unrelated Effects continue", () => {
    const a = activate(F, { state: null, resources: FULL }, "A", "fixture.wo13.spell.sustained");
    const b = activate(F, next(a), "B", "fixture.wo13.spell.rounds");
    const e = tx(F, next(b), { kind: "EXTERNAL_END", activeEffectKey: "A", end: "INTERRUPTED", sourceKey: "rule.silence" });
    expect([statusOf(e), e.concentration.used, e.state.effects[0]!.endedBy]).toEqual([[["A", "ENDED", "INTERRUPTED"], ["B", "ACTIVE", null]], 0, { event: "EXTERNAL_END", sourceKey: "rule.silence" }]);
    expect(refused(F, next(e), { kind: "DISMISS", activeEffectKey: "A" })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
  });
});
