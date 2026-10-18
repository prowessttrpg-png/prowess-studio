import { describe, expect, it } from "vitest";
import { compileCoreResolution } from "./core/compile.js";
import { resolveRollMode, resolveRollSignals } from "./core/dice.js";
import { createSidePhase, resolveInitiativeOrder, validateActingSequence } from "./runtime/combat.js";
import { compileRuntime } from "./runtime/compile.js";
import { coreBundle } from "./testing/core-fixtures.js";
import { codes, compileWith, roll, runCore } from "./testing/core-run.js";
import { payForAction, resources, runRuntime, runtimeCharacter } from "./testing/runtime-run.js";

/**
 * M5-WO3 GOLDEN fixtures (PAS-10 M5-WO3 §105–125, §61). Every number asserted here was produced by the frozen M4 engine
 * from the canonical content files: the WO2 capacity statistics, the RESOURCE / ACTION / TERRAIN Definitions and the
 * INITIATIVE procedure. @prowess/game only chose and wired the operations.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I075 Base Movement · M5-I077 / M5-I078 / M5-I079
 * roll signals · M5-I080 distinct Resources · M5-I081 maximum vs current · M5-I082 / M5-I083 no HP / MP refresh ·
 * M5-I084 AP refresh · M5-I085 AP expiry · M5-I086 / M5-I087 Counter Action · M5-I088 Counter vs AP · M5-I089 ME
 * refresh · M5-I090 ME before MP · M5-I091 listed cost unchanged · M5-I092 atomic payment · M5-I093 / M5-I094
 * reservation · M5-I096 AP is spendable points · M5-I098 Move allowance · M5-I099 split movement · M5-I100 Difficult
 * Terrain · M5-I101 side Initiative · M5-I102 Initiative formula · M5-I103 tie-break · M5-I104 Surprise · M5-I107 zero
 * HP · M5-I109 repeated Sprint · M5-I110 ordinary costs are atomic, never multi-turn debt.
 */
const ROUND = (round: number, surprised = false) => ({ round, surprised });
const timing = (event: string, inputs: { character: unknown; resources: unknown; combat?: unknown }, extra: Record<string, unknown> = {}) =>
  runRuntime({ kind: "RESOURCE_TIMING", subjectKey: "tick", event, ...extra }, { combat: ROUND(1), ...inputs });

describe("§60–§61 / §115 MOVEMENT = BASE MOVEMENT (5 ft) × AGI (M5-SC-006; terminology amended post-WO3 — M5-I111 supersedes M5-I075)", () => {
  it.each([
    [1, 5],
    [2, 10],
    [4, 20],
    [6, 30],
    [10, 50],
  ])("AGI %i → %i ft (M4 FORMULA over canonical content)", (agi, feet) => {
    const r = runCore({ kind: "DERIVED_STATISTICS", subjectKey: "move", statistics: ["BASE_MOVEMENT", "MOVEMENT"] }, { ...runtimeCharacter({ AGI: agi }) });
    expect(r.derived("BASE_MOVEMENT")).toBe(5); // the standard creature's authored Base Movement — never × AGI itself
    expect(r.derived("MOVEMENT")).toBe(feet); // Base Movement × AGI; a character with no Size named is MEDIUM (5 ft — M5-I152)
  });

  it.each([
    ["SMALL", 5, 20],
    ["MEDIUM", 5, 20],
    ["LARGE", 10, 40],
    ["HUGE", 15, 60],
  ])("M5-I152 designer ruling M5-SC-033: a %s creature has Base Movement %i ft → Movement %i ft at AGI 4 (the Size Definition is cited)", (size, base, feet) => {
    const r = runCore({ kind: "DERIVED_STATISTICS", subjectKey: "move", statistics: ["BASE_MOVEMENT", "MOVEMENT"] }, { ...runtimeCharacter({ AGI: 4 }), creatureSize: size });
    expect([r.derived("BASE_MOVEMENT"), r.derived("MOVEMENT")]).toEqual([base, feet]);
    expect(r.plan.sourceMap.entries.find((e) => e.role === "derived-statistic:BASE_MOVEMENT")?.componentKeys).toContain(`creature-size.${size}`);
  });

  it("M5-I152 / M5-SC-036 a MASSIVE creature's Base Movement is pending canon: the sheet fails closed, nothing is guessed", () => {
    const out = compileWith({ kind: "DERIVED_STATISTICS", subjectKey: "move", statistics: ["MOVEMENT"] }, { ...runtimeCharacter({ AGI: 4 }), creatureSize: "MASSIVE" });
    expect(codes(out)).toEqual(["PROWESS_CORE.SIZE_BASE_MOVEMENT_PENDING_CANON"]);
  });

  it("an unknown creature Size is refused as an invalid character, never defaulted", () => {
    const out = compileWith({ kind: "DERIVED_STATISTICS", subjectKey: "move", statistics: ["MOVEMENT"] }, { ...runtimeCharacter({ AGI: 4 }), creatureSize: "GARGANTUAN" });
    expect(codes(out)).toEqual(["PROWESS_CORE.INVALID_CHARACTER"]);
  });

  it("explicit Movement modifiers apply to Movement; Size never does (M5-I076)", () => {
    const r = runCore({ kind: "DERIVED_STATISTICS", subjectKey: "move", statistics: ["MOVEMENT"] }, runtimeCharacter({ AGI: 4 }, { explicitBonuses: [{ bonusKey: "haste", appliesTo: "MOVEMENT", value: 10 }] }));
    expect([r.derived("BASE_MOVEMENT"), r.derived("MOVEMENT")]).toEqual([5, 30]);
  });
});

describe("§105–§108 ACTION POINTS — refresh, spend, inability to pay, expiry (M5-I084 / M5-I085 / M5-I092 / M5-I096)", () => {
  const agi6 = runtimeCharacter({ AGI: 6 });

  it("§105 AGI 6 → AP Capacity 5; current 1 → START_OF_TURN → 5", () => {
    const r = timing("START_OF_TURN", { character: agi6, resources: resources(["AP", 1]) });
    expect(r.current("AP")).toBe(5);
    expect(r.reading.transitions).toEqual([expect.objectContaining({ resourceKey: "AP", operation: "REFRESH", currentBefore: 1, currentAfter: 5 })]);
  });

  it("§106 current 5, Balanced Attack 2 AP → 3 (PAID through M4 payment)", () => {
    const { confirmation } = payForAction({ actionKey: "BALANCED_ATTACK", window: "OWN_TURN" }, { character: agi6, resources: resources(["AP", 5]) });
    expect(confirmation.status).toBe("PAID");
    expect(confirmation.payments).toEqual([expect.objectContaining({ costKey: "ACTION_POINTS", listedAmount: 2, canPay: true, shortfall: 0 })]);
    expect(confirmation.resources.resources).toEqual([{ resourceKey: "AP", current: 3, reservedCapacity: 0 }]);
  });

  it("§107 current 2, Heavy Attack 3 AP → canPay false, shortfall 1, AP remains 2 (a valid inability, not an error)", () => {
    const { result, confirmation } = payForAction({ actionKey: "HEAVY_ATTACK", window: "OWN_TURN" }, { character: agi6, resources: resources(["AP", 2]) });
    expect(result.reading.payments).toEqual([expect.objectContaining({ listedAmount: 3, canPay: false, shortfall: 1, totalPaid: 2 })]);
    expect(result.current("AP")).toBe(2); // M4 atomicity: the resulting snapshot is the original
    expect(confirmation.status).toBe("CANNOT_PAY");
    expect(confirmation.resources.resources).toEqual([{ resourceKey: "AP", current: 2, reservedCapacity: 0 }]);
  });

  it("§108 current 2 → END_OF_TURN → 0; next START_OF_TURN refreshes to Capacity (no banking)", () => {
    const end = timing("END_OF_TURN", { character: agi6, resources: resources(["AP", 2]) });
    expect(end.current("AP")).toBe(0);
    const next = timing("START_OF_TURN", { character: agi6, resources: end.reading.resources });
    expect(next.current("AP")).toBe(5);
  });

  it("§108 an explicit preservation rule keeps unused AP; it never raises it", () => {
    const r = timing("END_OF_TURN", { character: agi6, resources: resources(["AP", 2]) }, { preserve: [{ resourceKey: "AP", sourceKey: "feature.test_preserve_ap" }] });
    expect(r.plan.outputs.preserved).toEqual([{ resourceKey: "AP", sourceKey: "feature.test_preserve_ap" }]);
    expect(r.plan.evaluationPlan.steps.some((s) => s.operation === "RESOURCE_SET_CURRENT")).toBe(false);
    expect(r.current("AP")).toBe(2); // untouched by the plan, carried over from the supplied state
  });

  it("M5-I096 AP is spendable points, not slots: 5 AP buys Light + Light + Light + Balanced in any order", () => {
    let state: unknown = resources(["AP", 5]);
    for (const actionKey of ["LIGHT_ATTACK", "BALANCED_ATTACK", "LIGHT_ATTACK", "LIGHT_ATTACK"]) {
      const { confirmation } = payForAction({ actionKey, window: "OWN_TURN" }, { character: agi6, resources: state });
      expect(confirmation.status, actionKey).toBe("PAID");
      state = confirmation.resources;
    }
    expect(state).toEqual({ resources: [{ resourceKey: "AP", current: 0, reservedCapacity: 0 }] });
  });
});

describe("§109 / §125 COUNTER ACTION — refresh, spend, no banking, Surprise (M5-I086 / M5-I087 / M5-I088 / M5-I104)", () => {
  const ch = runtimeCharacter();
  const react = (state: unknown, combat = ROUND(1)) =>
    payForAction({ actionKey: "COUNTER_REACTION", window: "OUTSIDE_OWN_TURN", trigger: { triggerKey: "ally_attacked", sourceKey: "feature.test_guard" } }, { character: ch, resources: state, combat });

  it("§109 capacity 1: start Round → 1; react → 0; second reaction same Round unavailable; next Round → 1", () => {
    const start = timing("START_OF_ROUND", { character: ch, resources: resources(["COUNTER_ACTION", 0]) });
    expect(start.current("COUNTER_ACTION")).toBe(1);
    expect(start.reading.availability).toEqual([{ resourceKey: "COUNTER_ACTION", restrictionKey: "SURPRISED", available: true }]);
    const first = react(start.reading.resources);
    expect(first.confirmation.status).toBe("PAID");
    expect(first.confirmation.resources.resources).toEqual([{ resourceKey: "COUNTER_ACTION", current: 0, reservedCapacity: 0 }]);
    const second = react(first.confirmation.resources);
    expect(second.confirmation.status).toBe("CANNOT_PAY");
    expect(second.confirmation.payments[0]).toEqual(expect.objectContaining({ listedAmount: 1, canPay: false, shortfall: 1 }));
    const next = timing("START_OF_ROUND", { character: ch, resources: first.confirmation.resources, combat: ROUND(2) });
    expect(next.current("COUNTER_ACTION")).toBe(1);
  });

  it("M5-I087 an unused Counter Action never accumulates: 1 unused + capacity 1 → still 1", () => {
    const next = timing("START_OF_ROUND", { character: ch, resources: resources(["COUNTER_ACTION", 1]), combat: ROUND(2) });
    expect(next.current("COUNTER_ACTION")).toBe(1);
  });

  it("M5-I088 a Counter Action reaction spends no AP; spending AP spends no Counter Action", () => {
    const reaction = react(resources(["AP", 3], ["COUNTER_ACTION", 1]));
    expect(reaction.confirmation.resources.resources).toEqual([
      { resourceKey: "AP", current: 3, reservedCapacity: 0 },
      { resourceKey: "COUNTER_ACTION", current: 0, reservedCapacity: 0 },
    ]);
    const attack = payForAction({ actionKey: "LIGHT_ATTACK", window: "OWN_TURN" }, { character: ch, resources: resources(["AP", 3], ["COUNTER_ACTION", 1]) });
    expect(attack.confirmation.resources.resources).toEqual([
      { resourceKey: "AP", current: 2, reservedCapacity: 0 },
      { resourceKey: "COUNTER_ACTION", current: 1, reservedCapacity: 0 },
    ]);
  });

  it("§125 Round 1 surprised: capacity 1 and refresh unchanged, but the Counter Action is UNAVAILABLE; Round 2 normal", () => {
    const start = timing("START_OF_ROUND", { character: ch, resources: resources(["COUNTER_ACTION", 0]), combat: ROUND(1, true) });
    expect(start.current("COUNTER_ACTION")).toBe(1); // nothing removed or spent
    expect(start.reading.availability).toEqual([{ resourceKey: "COUNTER_ACTION", restrictionKey: "SURPRISED", available: false }]);
    const blocked = react(start.reading.resources, ROUND(1, true));
    expect(blocked.confirmation.status).toBe("UNAVAILABLE");
    expect(blocked.confirmation.resources).toEqual(start.reading.resources); // original state, nothing paid
    const round2 = timing("START_OF_ROUND", { character: ch, resources: start.reading.resources, combat: ROUND(2, true) });
    expect(round2.reading.availability[0]?.available).toBe(true);
    expect(react(round2.reading.resources, ROUND(2, true)).confirmation.status).toBe("PAID");
  });

  it("§52 Surprise invents no AP penalty: a surprised creature's AP refreshes to full Capacity", () => {
    const r = runRuntime({ kind: "RESOURCE_TIMING", subjectKey: "t", event: "START_OF_TURN" }, { character: runtimeCharacter({ AGI: 6 }), resources: resources(["AP", 0]), combat: ROUND(1, true) });
    expect(r.current("AP")).toBe(5);
  });
});

describe("§110–§114 MANA — ME refresh, ME → MP payment, atomicity, reservation (M5-I089–I094)", () => {
  it("§110 PRO 5 → ME Maximum 5; current 1 → START_OF_ROUND → 5", () => {
    const r = timing("START_OF_ROUND", { character: runtimeCharacter({ PRO: 5 }), resources: resources(["ME", 1], ["COUNTER_ACTION", 1]) });
    expect(r.current("ME")).toBe(5);
  });

  it("§111 listed 8, ME 5, MP 18 → pay ME 5 then MP 3 → ME 0, MP 15; listed cost still 8", () => {
    const r = runRuntime({ kind: "MAGICAL_PAYMENT", subjectKey: "cast", costKey: "spell.test", listedAmount: 8, meEligible: true }, { character: runtimeCharacter({ PRO: 5 }, { baseMp: 17 }), resources: resources(["MP", 18], ["ME", 5]) });
    const [payment] = r.reading.payments;
    expect(payment).toEqual(
      expect.objectContaining({
        listedAmount: 8,
        canPay: true,
        allocations: [
          { resourceKey: "ME", order: 0, amountPaid: 5, currentBefore: 5, currentAfter: 0 },
          { resourceKey: "MP", order: 1, amountPaid: 3, currentBefore: 18, currentAfter: 15 },
        ],
      }),
    );
    expect([r.current("ME"), r.current("MP")]).toEqual([0, 15]);
    expect(r.value(r.plan.outputs.payments[0]!.preview)).toEqual(expect.objectContaining({ mode: "PREVIEW", listedAmount: 8 }));
  });

  it("§112 listed 10, ME 3, MP 4 → canPay false, shortfall 3; ME stays 3, MP stays 4", () => {
    const r = runRuntime({ kind: "MAGICAL_PAYMENT", subjectKey: "cast", costKey: "spell.test", listedAmount: 10, meEligible: true }, { character: runtimeCharacter({ PRO: 5 }), resources: resources(["MP", 4], ["ME", 3]) });
    expect(r.reading.payments[0]).toEqual(expect.objectContaining({ listedAmount: 10, canPay: false, shortfall: 3 }));
    expect([r.current("ME"), r.current("MP")]).toEqual([3, 4]);
  });

  it("M5-I090 a cost not declared ME-eligible is paid from MP only", () => {
    const r = runRuntime({ kind: "MAGICAL_PAYMENT", subjectKey: "cast", costKey: "art.test", listedAmount: 8, meEligible: false }, { character: runtimeCharacter({ PRO: 5 }, { baseMp: 17 }), resources: resources(["MP", 18], ["ME", 5]) });
    expect(r.reading.payments[0]?.allocations.map((a) => a.resourceKey)).toEqual(["MP"]);
    expect([r.current("ME"), r.current("MP")]).toEqual([5, 10]);
  });

  it("§113 MP maximum 20, current 18, reserve 6 → reserved 6, available maximum 14, current 18 (no spend)", () => {
    const r = runRuntime({ kind: "RESOURCE_TRANSITIONS", subjectKey: "lock", transitions: [{ resourceKey: "MP", operation: "RESERVE_CAPACITY", amount: 6 }] }, { character: runtimeCharacter({ RES: 3 }, { baseMp: 17 }), resources: resources(["MP", 18]) });
    expect(r.reading.transitions).toEqual([expect.objectContaining({ resourceKey: "MP", currentBefore: 18, currentAfter: 18, reservedAfter: 6, availableMaximumBefore: 20, availableMaximumAfter: 14 })]);
    expect([r.current("MP"), r.reserved("MP")]).toEqual([18, 6]);
  });

  it("§114 maximum 20, current 9, reserved 6, release 6 → available maximum 20, current stays 9 (no refill)", () => {
    const r = runRuntime({ kind: "RESOURCE_TRANSITIONS", subjectKey: "unlock", transitions: [{ resourceKey: "MP", operation: "RELEASE_CAPACITY", amount: 6 }] }, { character: runtimeCharacter({ RES: 3 }, { baseMp: 17 }), resources: resources(["MP", 9, 6]) });
    expect(r.reading.transitions).toEqual([expect.objectContaining({ currentBefore: 9, currentAfter: 9, reservedBefore: 6, reservedAfter: 0, availableMaximumAfter: 20 })]);
    expect([r.current("MP"), r.reserved("MP")]).toEqual([9, 0]);
  });
});

describe("§24 / §29 / §25 HP and MP never refresh on their own; zero HP is exposed (M5-I082 / M5-I083 / M5-I107)", () => {
  it.each(["START_OF_ROUND", "START_OF_TURN", "END_OF_TURN", "END_OF_ROUND"])("%s touches neither HP nor MP", (event) => {
    const r = timing(event, { character: runtimeCharacter(), resources: resources(["HP", 3], ["MP", 2], ["ME", 0], ["AP", 0], ["COUNTER_ACTION", 0], ["MOVEMENT_ALLOWANCE", 0]) });
    expect(r.plan.outputs.transitions.map((t) => t.resourceKey)).not.toContain("HP");
    expect(r.plan.outputs.transitions.map((t) => t.resourceKey)).not.toContain("MP");
    expect([r.current("HP"), r.current("MP")]).toEqual([3, 2]);
  });

  it("HP 5, an already-resolved spend of 5 → 0 and depleted; Downed / Death Saves are not applied here", () => {
    const r = runRuntime({ kind: "RESOURCE_TRANSITIONS", subjectKey: "hit", transitions: [{ resourceKey: "HP", operation: "SPEND", amount: 5 }] }, { character: runtimeCharacter(), resources: resources(["HP", 5]) });
    expect([r.current("HP"), r.reading.depleted]).toEqual([0, [{ resourceKey: "HP", depleted: true }]]);
    const partial = runRuntime({ kind: "RESOURCE_TRANSITIONS", subjectKey: "hit", transitions: [{ resourceKey: "HP", operation: "SPEND", amount: 3 }] }, { character: runtimeCharacter(), resources: resources(["HP", 5]) });
    expect([partial.current("HP"), partial.reading.depleted]).toEqual([2, [{ resourceKey: "HP", depleted: false }]]);
  });

  it("HP restoration is explicit and bounded by Maximum HP (Base HP 10 + CON 3 = 13)", () => {
    const r = runRuntime({ kind: "RESOURCE_TRANSITIONS", subjectKey: "heal", transitions: [{ resourceKey: "HP", operation: "RESTORE", amount: 10 }] }, { character: runtimeCharacter(), resources: resources(["HP", 8]) });
    expect(r.reading.transitions[0]).toEqual(expect.objectContaining({ currentBefore: 8, currentAfter: 13, overflow: 5 }));
  });
});

describe("§116–§118 MOVE, SPLIT MOVEMENT, DIFFICULT TERRAIN, SPRINT (M5-I098 / M5-I099 / M5-I100 / M5-I109)", () => {
  const agi4 = runtimeCharacter({ AGI: 4 });
  const followOn = (receipt: unknown, state: unknown) => runRuntime({ kind: "ACTION_FOLLOW_ON", subjectKey: "after", receipt }, { character: agi4, resources: state });

  it("§116 AP 3, Move costs 1 → AP 2; the PAID follow-on grants 20 ft of allowance (AGI 4) — Movement itself is unchanged", () => {
    const { confirmation } = payForAction({ actionKey: "MOVE", window: "OWN_TURN" }, { character: agi4, resources: resources(["AP", 3], ["MOVEMENT_ALLOWANCE", 0]) });
    expect(confirmation.status).toBe("PAID");
    const after = followOn(confirmation, confirmation.resources);
    expect(after.reading.movementGrant).toBe(20);
    expect([after.current("AP"), after.current("MOVEMENT_ALLOWANCE")]).toEqual([2, 20]);
    expect(after.plan.outputs.derived.BASE_MOVEMENT).toBeDefined();
  });

  it("§117 20 ft allowance: move 10, attack, move 10 → 0, with no second Move cost", () => {
    const move = (state: unknown) => runRuntime({ kind: "MOVEMENT", subjectKey: "step", segments: [{ distance: 10, terrainKey: "NORMAL" }] }, { character: agi4, resources: state });
    const first = move(resources(["AP", 2], ["MOVEMENT_ALLOWANCE", 20]));
    const attack = payForAction({ actionKey: "LIGHT_ATTACK", window: "OWN_TURN" }, { character: agi4, resources: first.reading.resources });
    const second = move(attack.confirmation.resources);
    expect([first.current("MOVEMENT_ALLOWANCE"), second.current("MOVEMENT_ALLOWANCE"), second.current("AP")]).toEqual([10, 0, 1]);
    expect(second.plan.evaluationPlan.steps.some((s) => s.operation.startsWith("RESOURCE_PAYMENT"))).toBe(false);
  });

  it("§117 movement beyond the remaining allowance is refused, not partially taken", () => {
    const r = runRuntime({ kind: "MOVEMENT", subjectKey: "step", segments: [{ distance: 25, terrainKey: "NORMAL" }] }, { character: agi4, resources: resources(["MOVEMENT_ALLOWANCE", 20]) });
    expect(r.reading.transitions[0]).toEqual(expect.objectContaining({ applied: false, shortfall: 5, currentAfter: 20 }));
  });

  it("§118 20 ft allowance, 5 ft of Difficult Terrain consumes 10 → 10 remain", () => {
    const r = runRuntime({ kind: "MOVEMENT", subjectKey: "mud", segments: [{ distance: 5, terrainKey: "DIFFICULT" }] }, { character: agi4, resources: resources(["MOVEMENT_ALLOWANCE", 20]) });
    expect([r.reading.movementCosts, r.current("MOVEMENT_ALLOWANCE")]).toEqual([[10], 10]);
  });

  it("§73–§75 Sprint costs 3 AP and grants Sprint Allowance = Movement × 4 (AGI 4 → 80 ft; M5-SC-034 RESOLVED_BY_DESIGNER, M5-I112)", () => {
    const { confirmation } = payForAction({ actionKey: "SPRINT", window: "OWN_TURN" }, { character: agi4, resources: resources(["AP", 4], ["MOVEMENT_ALLOWANCE", 0]) });
    expect(confirmation.payments[0]?.listedAmount).toBe(3);
    const after = followOn(confirmation, confirmation.resources);
    expect([after.reading.movementGrant, after.current("AP"), after.current("MOVEMENT_ALLOWANCE")]).toEqual([80, 1, 80]);
  });

  it("§75 a second Sprint is another execution — each grants Movement × 4, linear, never ×4 ×4 (AGI 9: 6 AP, 45 ft)", () => {
    const agi9 = runtimeCharacter({ AGI: 9 });
    let state: unknown = resources(["AP", 6], ["MOVEMENT_ALLOWANCE", 0]);
    const grants: number[] = [];
    for (const execution of ["first", "second"]) {
      const { confirmation } = payForAction({ actionKey: "SPRINT", window: "OWN_TURN" }, { character: agi9, resources: state });
      expect(confirmation.status, execution).toBe("PAID");
      const after = runRuntime({ kind: "ACTION_FOLLOW_ON", subjectKey: "after", receipt: confirmation }, { character: agi9, resources: confirmation.resources });
      grants.push(after.reading.movementGrant as number);
      state = after.reading.resources;
    }
    expect(grants).toEqual([180, 180]);
    expect(state).toEqual({ resources: [{ resourceKey: "AP", current: 0, reservedCapacity: 0 }, { resourceKey: "MOVEMENT_ALLOWANCE", current: 360, reservedCapacity: 0 }] });
  });

  it("movement allowance expires at END_OF_TURN; it never becomes permanent Movement", () => {
    const r = timing("END_OF_TURN", { character: agi4, resources: resources(["AP", 0], ["MOVEMENT_ALLOWANCE", 15]) });
    expect(r.current("MOVEMENT_ALLOWANCE")).toBe(0);
    const sheet = runCore({ kind: "DERIVED_STATISTICS", subjectKey: "m", statistics: ["MOVEMENT"] }, agi4);
    expect(sheet.derived("MOVEMENT")).toBe(20);
  });
});

describe("§119–§120 ROLL SIGNALS — presence-based, non-stacking, cancelling, provenance-preserving (M5-I077 / M5-I078 / M5-I079)", () => {
  it.each([
    [[], [], "NORMAL"],
    [["a"], [], "ADVANTAGE"],
    [["a1", "a2"], [], "ADVANTAGE"],
    [["a1", "a2", "a3", "a4", "a5"], [], "ADVANTAGE"],
    [[], ["d"], "DISADVANTAGE"],
    [[], ["d1", "d2"], "DISADVANTAGE"],
    [["a"], ["d"], "NORMAL"],
    [["a1", "a2"], ["d"], "NORMAL"],
    [["a"], ["d1", "d2"], "NORMAL"],
    [["a1", "a2"], ["d1", "d2", "d3"], "NORMAL"],
  ])("advantage %j / disadvantage %j → %s", (advantage, disadvantage, mode) => {
    expect(resolveRollMode({ advantage, disadvantage })).toEqual({ ok: true, value: mode });
    expect(resolveRollSignals({ advantage, disadvantage }).ok && (resolveRollSignals({ advantage, disadvantage }) as { value: { mode: string } }).value.mode).toBe(mode);
  });

  it("§120 Stat Mastery + High Ground vs Poisoned → NORMAL, every source still visible", () => {
    const r = resolveRollSignals({ advantage: ["stat_mastery.per", "high_ground"], disadvantage: ["poisoned"] });
    expect(r).toEqual({ ok: true, value: { mode: "NORMAL", advantage: ["high_ground", "stat_mastery.per"], disadvantage: ["poisoned"], cancelled: true, ruling: "M5-SC-032" } });
  });

  it("accepts the M4 ROLL_SIGNAL target state directly (Stat Mastery fires at Level 10 / Stat 10)", () => {
    const mastered = runCore({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode: "NORMAL" }, { level: 10, characterDie: { dieKey: "D12" }, stats: { STR: 1, AGI: 1, CON: 1, PER: 10, RES: 1, PRO: 1 }, baseHp: 1, baseMp: 1, skillRanks: [], explicitBonuses: [] }, { roll: roll("D12", 12, "NORMAL", 4), targetDodge: 5 });
    const signal = { ...mastered.masterySignal!, disadvantage: ["poisoned"] };
    expect(resolveRollSignals(signal)).toEqual({ ok: true, value: { mode: "NORMAL", advantage: ["stat_mastery.per"], disadvantage: ["poisoned"], cancelled: true, ruling: "M5-SC-032" } });
  });
});

describe("§121–§124 INITIATIVE and the SHARED PLAYER PHASE (M5-I101 / M5-I102 / M5-I103)", () => {
  it("§121 d8 natural 5 + PER 5 / 2 + AGI 3 / 2 + bonus 1 = 10 (no hidden rounding)", () => {
    const r = runCore(
      { kind: "CORE_RESOLUTION", subjectKey: "side.players", procedure: "INITIATIVE", mode: "NORMAL" },
      { level: 5, characterDie: { dieKey: "D8" }, stats: { STR: 1, AGI: 3, CON: 1, PER: 5, RES: 1, PRO: 1 }, baseHp: 1, baseMp: 1, skillRanks: [], explicitBonuses: [{ bonusKey: "alert", appliesTo: "INITIATIVE", value: 1 }] },
      { roll: roll("D8", 8, "NORMAL", 5) },
    );
    expect([r.natural, r.total, r.success]).toEqual([5, 10, null]);
  });

  it("fractional Initiative totals are kept exactly (d8 natural 4 + PER 5 / 2 + AGI 2 / 2 = 7.5)", () => {
    const r = runCore({ kind: "CORE_RESOLUTION", subjectKey: "side", procedure: "INITIATIVE", mode: "NORMAL" }, { level: 5, characterDie: { dieKey: "D8" }, stats: { STR: 1, AGI: 2, CON: 1, PER: 5, RES: 1, PRO: 1 }, baseHp: 1, baseMp: 1, skillRanks: [], explicitBonuses: [] }, { roll: roll("D8", 8, "NORMAL", 4) });
    expect(r.total).toBe(7.5);
  });

  const side = (sideKey: string, initiative: number, ...members: [string, number, number][]) => ({ sideKey, initiative, members: members.map(([creatureKey, PER, AGI]) => ({ creatureKey, stats: { PER, AGI } })) });

  it("§122 totals 10 / 10; highest PER 5 vs 4 → side A acts first", () => {
    const r = resolveInitiativeOrder({ definitions: coreBundle().bundle, sides: [side("B", 10, ["b1", 4, 6]), side("A", 10, ["a1", 2, 1], ["a2", 5, 1])] });
    expect(r).toEqual({ ok: true, value: { status: "ORDERED", order: [["A"], ["B"]], rerollSides: [], decisions: [{ before: "A", after: "B", decidedBy: "HIGHEST_PER" }] } });
  });

  it("higher total wins outright; equal PER falls to highest AGI", () => {
    const byTotal = resolveInitiativeOrder({ definitions: coreBundle().bundle, sides: [side("A", 9.5, ["a", 9, 9]), side("B", 10, ["b", 1, 1])] });
    expect(byTotal.ok && byTotal.value.order).toEqual([["B"], ["A"]]);
    const byAgi = resolveInitiativeOrder({ definitions: coreBundle().bundle, sides: [side("A", 10, ["a", 4, 2]), side("B", 10, ["b", 4, 3])] });
    expect(byAgi.ok && byAgi.value.decisions).toEqual([{ before: "B", after: "A", decidedBy: "HIGHEST_AGI" }]);
  });

  it("§123 equal total, PER and AGI → REROLL_REQUIRED (the reroll is new runtime input — never generated)", () => {
    const r = resolveInitiativeOrder({ definitions: coreBundle().bundle, sides: [side("A", 10, ["a", 4, 3]), side("B", 10, ["b", 4, 3])] });
    expect(r).toEqual({ ok: true, value: { status: "REROLL_REQUIRED", order: [["A", "B"]], rerollSides: ["A", "B"], decisions: [] } });
  });

  it("§124 the player side may act C → A → B; no Initiative slot or Stat sorts them; interleaving needs GM approval", () => {
    const phase = createSidePhase({ sideKey: "players", members: ["A", "B", "C"] });
    if (!phase.ok) throw new Error("phase");
    expect(phase.value).toEqual({ sideKey: "players", members: ["A", "B", "C"], orderPolicy: "CHOSEN_BY_SIDE", actingOrder: null });
    expect(validateActingSequence({ phase: phase.value, sequence: ["C", "A", "B"], interleavingApproved: false })).toEqual({ ok: true, value: { sequence: ["C", "A", "B"], interleaved: false } });
    expect(validateActingSequence({ phase: phase.value, sequence: ["B", "C"], interleavingApproved: false }).ok).toBe(true); // A waits
    expect(codes(validateActingSequence({ phase: phase.value, sequence: ["A", "C", "A"], interleavingApproved: false }))).toEqual(["PROWESS_RUNTIME.INTERLEAVING_REQUIRES_APPROVAL"]);
    expect(validateActingSequence({ phase: phase.value, sequence: ["A", "C", "A"], interleavingApproved: true })).toEqual({ ok: true, value: { sequence: ["A", "C", "A"], interleaved: true } });
  });

  it("Initiative is compiled by the WO2 core compiler (FORMULA steps only, no comparison step)", () => {
    const f = coreBundle();
    const plan = compileCoreResolution({ contractVersion: 1, subject: { kind: "CORE_RESOLUTION", subjectKey: "s", procedure: "INITIATIVE", mode: "ADVANTAGE" }, definitions: f.bundle, ruleset: f.ruleset, character: runtimeCharacter() });
    expect(plan.ok && [...new Set(plan.value.evaluationPlan.steps.map((s) => s.operation))]).toEqual(["FORMULA"]);
  });

  it("an unpaid follow-on is impossible: a CANNOT_PAY confirmation never compiles the Move allowance", () => {
    const f = coreBundle();
    const { confirmation } = payForAction({ actionKey: "MOVE", window: "OWN_TURN" }, { character: runtimeCharacter(), resources: resources(["AP", 0], ["MOVEMENT_ALLOWANCE", 0]) });
    expect(confirmation.status).toBe("CANNOT_PAY");
    const after = compileRuntime({ contractVersion: 1, subject: { kind: "ACTION_FOLLOW_ON", subjectKey: "x", receipt: confirmation }, definitions: f.bundle, ruleset: f.ruleset, character: runtimeCharacter(), resources: confirmation.resources });
    expect(codes(after)).toEqual(["PROWESS_RUNTIME.PAYMENT_NOT_CONFIRMED"]);
  });
});
