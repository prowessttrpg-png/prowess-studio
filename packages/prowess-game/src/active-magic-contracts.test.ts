import { beforeAll, describe, expect, it, vi } from "vitest";
import { transitionActiveMagic, type ActiveMagicTransition } from "./ability/active-magic.js";
import { executionFixture } from "./testing/effect-execution-fixtures.js";
import { activeMagicFixture, caster, d6, next, pool, refused, request, tx, type Fixture } from "./testing/active-magic-fixtures.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 600_000 });

/**
 * M5-WO13 contracts — exact Ruleset pinning, state integrity, fail-closed rules, atomicity, ownership boundaries,
 * determinism and safety. Guard index (docs/architecture/m5-invariants.json): M5-I316 · M5-I318 · M5-I322 · M5-I323 ·
 * M5-I326 · M5-I330 · M5-I333 · M5-I335 · M5-I336 · M5-I337.
 */
const FULL = pool({ AP: 3, ME: 3, MP: 20 });
let F: Fixture, sustained: ActiveMagicTransition, locked: ActiveMagicTransition, FL: Fixture;
beforeAll(() => {
  F = activeMagicFixture();
  sustained = tx(F, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "s", ability: F.ability("fixture.wo13.spell.sustained") });
  FL = activeMagicFixture({ manaLock: { kind: "FIXED", amount: 12 } });
  locked = tx(FL, { state: null, resources: pool({ AP: 3, ME: 0, MP: 30 }) }, { kind: "ACTIVATE", activeEffectKey: "l", ability: FL.ability("fixture.wo13.spell.locked") });
});
const forge = (t: ActiveMagicTransition, edit: (e: Record<string, unknown>) => void) => {
  const state = JSON.parse(JSON.stringify(t.state)) as { effects: Record<string, unknown>[] };
  edit(state.effects[0]!);
  return { state: state as never, resources: t.resources };
};

describe("exact Ruleset pinning and history (M5-I333)", () => {
  it("R1 Active Effect state is refused under an R2 Ruleset; R1 keeps its pinned Sustain AP while R2 changes it", () => {
    const R2 = activeMagicFixture({ rulesetId: "00000000-0000-4000-8000-00000000a702", manifestId: "00000000-0000-4000-8000-00000000a703", policy: { sustainApPerRound: 2 } });
    expect(refused(R2, next(sustained), { kind: "MAINTENANCE" })).toEqual(["PROWESS_ACTIVE_MAGIC.CROSS_RULESET"]);
    const r1 = tx(F, next(sustained), { kind: "MAINTENANCE" });
    expect(r1.resourceChanges.filter((c) => c.resourceKey === "AP").map((c) => c.amount)).toEqual([1]);
    const r2 = tx(R2, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "s", ability: R2.ability("fixture.wo13.spell.sustained") });
    expect([r2.state.effects[0]!.sustain!.apCost, sustained.state.effects[0]!.sustain!.apCost]).toEqual([2, 1]);
  });

  it("an Active Effect pinned to another policy version (same Ruleset id, revised policy) is refused", () => {
    const revised = activeMagicFixture({ policy: { sustainApPerRound: 2 } });
    // The pinned upkeep no longer matches the policy the request's Ruleset carries: the state is refused, never re-derived.
    expect(refused(revised, next(sustained), { kind: "MAINTENANCE" })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_STATE"]);
  });

  it("a Ruleset without the active-magic policy is refused — lifecycle defaults are never assumed", () => {
    const wo12 = executionFixture();
    const out = transitionActiveMagic({ contractVersion: 1, definitions: wo12.bundle, ruleset: wo12.ruleset, caster: caster(), casterKey: "caster.1", resources: FULL, state: null, event: { kind: "ROUND_END" } });
    expect(out.ok ? [] : out.problems.map((q) => q.code)).toEqual(["PROWESS_ACTIVE_MAGIC.MISSING_POLICY"]);
  });
});

describe("state integrity: no forged amounts, identities or lifecycle (M5-I318, M5-I323, M5-I335)", () => {
  it.each([
    ["an arbitrary Sustain MP", (e: Record<string, unknown>) => { (e.sustain as Record<string, unknown>).mpCost = 1; }],
    ["an arbitrary Sustain AP", (e: Record<string, unknown>) => { (e.sustain as Record<string, unknown>).apCost = 0; }],
    ["a forged caster", (e: Record<string, unknown>) => { e.casterKey = "caster.2"; }],
    ["a held ENDING status", (e: Record<string, unknown>) => { e.status = "ENDING"; }],
    ["an ENDED Effect without a reason", (e: Record<string, unknown>) => { e.status = "ENDED"; }],
    ["an Instant Effect retained as state", (e: Record<string, unknown>) => { (e.duration as Record<string, unknown>).concept = "INSTANT"; }],
    ["a Sustained Effect stripped of Concentration", (e: Record<string, unknown>) => { e.concentration = { required: false }; }],
    ["a Sustained Effect stripped of Sustain", (e: Record<string, unknown>) => { e.sustain = null; }],
    ["a dismissal rule changed", (e: Record<string, unknown>) => { (e.duration as Record<string, unknown>).dismissal = "NOT_DISMISSIBLE"; }],
    ["an unknown field", (e: Record<string, unknown>) => { e.success = true; }],
  ])("%s is refused", (_l, edit) => {
    expect(refused(F, forge(sustained, edit), { kind: "MAINTENANCE" }).length).toBeGreaterThan(0);
  });

  it("an arbitrary Mana Lock amount and a lock the Resources do not hold are refused", () => {
    expect(refused(FL, forge(locked, (e) => { (e.manaLock as Record<string, unknown>).reservedMp = 3; }), { kind: "ROUND_END" })).toContain("PROWESS_ACTIVE_MAGIC.INVALID_STATE");
    expect(refused(FL, { state: locked.state, resources: pool({ AP: 3, ME: 0, MP: 30 }) }, { kind: "ROUND_END" })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_STATE"]);
    // Under the canonical policy (no exact lock amount, M5-SC-052) a held reservation is never trusted.
    expect(refused(F, next(locked), { kind: "ROUND_END" })).toEqual(["PROWESS_ACTIVE_MAGIC.UNRESOLVED_RUNTIME_RULE"]);
  });

  it("another caster's state, duplicate identities and a reused activation identity are refused", () => {
    const other = transitionActiveMagic({ ...request(F, next(sustained), { kind: "ROUND_END" }), casterKey: "caster.2" });
    expect(other.ok ? [] : other.problems.map((q) => q.code)).toContain("PROWESS_ACTIVE_MAGIC.INVALID_STATE");
    const dup = JSON.parse(JSON.stringify(sustained.state)) as { effects: unknown[] };
    dup.effects.push(dup.effects[0]);
    expect(refused(F, { state: dup as never, resources: sustained.resources }, { kind: "ROUND_END" })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_STATE"]);
    expect(refused(F, next(sustained), { kind: "ACTIVATE", activeEffectKey: "s", ability: F.ability("fixture.wo13.spell.rounds") })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
  });
});

describe("events, inputs and fail-closed rules (M5-I322, M5-I326, M5-I330)", () => {
  it("unknown events / fields, prose triggers, unknown boundaries and a client success boolean are refused", () => {
    expect(refused(F, next(sustained), { kind: "TICK_EVERYTHING" })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(F, next(sustained), { kind: "ROUND_END", amount: 3 })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(F, next(sustained), { kind: "CONCENTRATION_TEST", trigger: "the caster feels shaken", target: "s", roll: d6(6) })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(F, next(sustained), { kind: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: "s", success: true })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(F, next(sustained), { kind: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: "s", roll: { ...d6(6), success: true } }).length).toBeGreaterThan(0);
    expect(refused(F, next(sustained), { kind: "CONCENTRATION_TEST", trigger: "TAKES_DAMAGE", target: "s", roll: d6(9) }).length).toBeGreaterThan(0);
    expect(refused(F, next(sustained), { kind: "BOUNDARY", boundary: "SUNSET" })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(F, next(sustained), { kind: "TIMING", timing: "every so often" })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(F, next(sustained), { kind: "EXTERNAL_END", activeEffectKey: "s", end: "DISPELLED", sourceKey: "" })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
  });

  it("negative / non-integer amounts, negative Resources and an unpayable Channel investment change nothing", () => {
    const ch = tx(F, { state: null, resources: pool({ AP: 1, ME: 0, MP: 20 }) }, { kind: "CHANNEL_START", channelKey: "c", ability: F.ability("fixture.wo13.spell.channel", 4, null) });
    expect(refused(F, next(ch), { kind: "CHANNEL_INVEST", amount: -1 })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(F, next(ch), { kind: "CHANNEL_INVEST", amount: 1.5 })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
    expect(refused(F, next(ch), { kind: "CHANNEL_INVEST", amount: 2 })).toEqual(["PROWESS_ACTIVE_MAGIC.INSUFFICIENT_RESOURCES"]);
    expect(refused(F, { state: null, resources: pool({ AP: -1, ME: 0, MP: 20 }) }, { kind: "ROUND_END" })).toEqual(expect.arrayContaining(["PROWESS_ACTIVE_MAGIC.INVALID_REQUEST"]));
  });

  it("a lock larger than the Maximum MP capacity is refused before anything changes (no negative available maximum)", () => {
    const huge = activeMagicFixture({ manaLock: { kind: "FIXED", amount: 999 } });
    const codes = refused(huge, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "l", ability: huge.ability("fixture.wo13.spell.locked") });
    expect(codes.length > 0 && codes.every((c) => c === "PROWESS_ACTIVE_MAGIC.INVALID_INPUT" || c === "PROWESS_ACTIVE_MAGIC.INSUFFICIENT_RESOURCES")).toBe(true);
  });

  it("activation needs a COMPLETE WO12 resolution, a VALID Spell, a matching PRO and a Spell (not a Maneuver)", () => {
    const a = F.ability("fixture.wo13.spell.rounds");
    expect(refused(F, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "x", ability: { ...a, execution: { targets: [], inputs: [] } } })).toEqual(expect.arrayContaining(["PROWESS_ACTIVE_MAGIC.INVALID_ABILITY"]));
    expect(refused(F, { state: null, resources: FULL, caster: caster({ PRO: 5 }) }, { kind: "ACTIVATE", activeEffectKey: "x", ability: a })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_INPUT"]);
    expect(refused(F, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "x", ability: { ...F.ability("fixture.wo11.maneuver.basic"), execution: { targets: [{ targetKey: "a" }], inputs: [] } } })).toEqual(["PROWESS_ACTIVE_MAGIC.SPELL_ONLY"]);
    expect(refused(F, { state: null, resources: FULL }, { kind: "ACTIVATE", activeEffectKey: "x", ability: { ...a, definitions: F.bundle } })).toEqual(["PROWESS_ACTIVE_MAGIC.INVALID_EVENT"]);
  });
});

describe("ownership boundaries, determinism and safety (M5-I335–I337)", () => {
  it("outcomes are pinned WO12 records, never applied: no HP / Condition / position state exists; HP is never touched", () => {
    const e = sustained.state.effects[0]!;
    expect([e.outcomes, e.executionKey.endsWith(":exec")]).toEqual([[{ targetKey: "ally", effectKey: "effect1", outcomeKey: "SUCCESS", definition: e.outcomes[0]!.definition }], true]);
    expect(JSON.stringify(sustained)).not.toMatch(/"(hp|currentHp|conditions|position|armor)"\s*:/i);
    expect(sustained.resourceChanges).toEqual([]);
  });

  it("inputs are never mutated; outputs are deep-frozen, JSON-safe and identical for identical requests", () => {
    const req = request(F, next(sustained), { kind: "MAINTENANCE" });
    const before = JSON.stringify(req);
    const a = transitionActiveMagic(req), b = transitionActiveMagic(JSON.parse(JSON.stringify(req)));
    expect(JSON.stringify(req)).toBe(before);
    expect(a).toEqual(b);
    expect(a.ok && Object.isFrozen(a.value.state.effects[0]!.sustain)).toBe(true);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("getters, functions, cycles and prototype keys are refused before anything is read", () => {
    const base = request(F, next(sustained), { kind: "ROUND_END" });
    const getter = { ...base };
    Object.defineProperty(getter, "event", { get: () => ({ kind: "ROUND_END" }), enumerable: true });
    const cyclic: Record<string, unknown> = { kind: "ROUND_END" };
    cyclic.self = cyclic;
    for (const bad of [getter, { ...base, event: { kind: "ROUND_END", f: () => 1 } }, { ...base, event: cyclic }, JSON.parse(`{"__proto__":{"polluted":1},"kind":"ROUND_END"}`)])
      expect(transitionActiveMagic(bad.kind ? { ...base, event: bad } : bad).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
