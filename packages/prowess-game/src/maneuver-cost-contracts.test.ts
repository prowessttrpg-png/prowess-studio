import { orchestrateRulesEvaluation } from "@prowess/rules";
import { describe, expect, it, vi } from "vitest";
import { MANEUVER_COST_ERROR_CODES as K, compileManeuverCost, evaluateManeuverCost, readManeuverCostRun } from "./ability/maneuver-cost.js";
import { AUTHORED_ABILITY_ERROR_CODES as A } from "./definition/authored-ability-payload.js";
import { DURATION_CONDITION_ERRORS as D } from "./definition/duration-condition-payload.js";
import { codes } from "./testing/core-run.js";
import { copy, setPath } from "./testing/duration-condition-fixtures.js";
import { maneuverCostCharacter, maneuverCostFixture, runManeuverCost, type ManeuverSpec } from "./testing/maneuver-cost-fixtures.js";
import { uuid } from "./testing/fixtures.js";

vi.setConfig({ testTimeout: 120_000 });

/**
 * M5-WO11 contracts and negative controls: exact-Ruleset history (R1 / R2) and isolation, fail-closed contributions,
 * explicit cost choices, attachment / Powerful Blow legality, Signature assignment, the resource / runtime / Spell
 * boundaries, unresolved conflicts, plain-data safety, immutability, serialization and determinism.
 * Guard index (docs/architecture/m5-invariants.json): M5-I261 · M5-I265 · M5-I273 · M5-I276 · M5-I277 · M5-I278 · M5-I279 ·
 * M5-I280 · M5-I281 · M5-I282 · M5-I285 · M5-I286 · M5-I288 · M5-I290 · M5-I293.
 */
const F = maneuverCostFixture();
const R2 = uuid(9201), M2 = uuid(9202);
const req = (key = "fixture.wo11.maneuver.basic", signature = false, character?: Record<string, unknown>) => F.request(key, signature, character) as Record<string, unknown>;
const with_ = (maneuvers: Record<string, ManeuverSpec>, extra: Parameters<typeof maneuverCostFixture>[0] = {}) => maneuverCostFixture({ ...extra, maneuvers });
const problems = (r: ReturnType<typeof compileManeuverCost>) => (r.ok ? [] : r.problems.map((q) => q.code));

describe("exact Ruleset history and isolation (M5-I279–I280)", () => {
  const r2Push = () => { const e = F.rowPayload("fixture.wo11.effect.push"); setPath(e, "costContributions", [{ contributionKey: "effect.push.ap", currency: "AP", data: { kind: "FIXED", amount: 2 } }]); return e; };
  it("R1 Effect v1 = +1 AP; R2 Effect v2 = +2 AP; the R1 Maneuver keeps +1 AP and re-evaluates identically", () => {
    const r1 = runManeuverCost(req());
    const g = maneuverCostFixture({ rulesetId: R2, manifestId: M2, revise: { "fixture.wo11.effect.push": r2Push() } });
    const r2 = runManeuverCost(g.request("fixture.wo11.maneuver.basic") as Record<string, unknown>);
    expect([r1.result.ap.baseApCost, r2.result.ap.baseApCost]).toEqual([3, 4]);
    expect(r2.result.ap.contributions.find((c) => c.source === "EFFECT")!.definition.entityVersionId).not.toBe(r1.result.ap.contributions.find((c) => c.source === "EFFECT")!.definition.entityVersionId);
    const again = runManeuverCost(req());
    expect([again.plan, again.run, again.result]).toEqual([r1.plan, r1.run, r1.result]);
  });

  it("R1 Signature rule stays R1: an R2 rule with a different reduction never leaks into R1", () => {
    const g = maneuverCostFixture({ rulesetId: R2, manifestId: M2, policy: { signatureApReduction: 2 } });
    const [r1, r2] = [runManeuverCost(req("fixture.wo11.maneuver.high", true)), runManeuverCost(g.request("fixture.wo11.maneuver.high", true) as Record<string, unknown>)];
    expect([r1.result.ap.finalApCost, r2.result.ap.finalApCost]).toEqual([4, 3]);
  });

  it("a Maneuver against another Ruleset's context or bundle is refused; a stale / foreign EntityVersion is refused", () => {
    const g = maneuverCostFixture({ rulesetId: R2, manifestId: M2 });
    expect(compileManeuverCost({ ...req(), ruleset: g.ruleset }).ok).toBe(false);
    expect(compileManeuverCost({ ...req(), definitions: g.bundle }).ok).toBe(false);
    const stale = req();
    stale.definition = { ...(stale.definition as object), entityVersionId: uuid(99999) };
    expect(compileManeuverCost(stale).ok).toBe(false);
  });
});

describe("fail-closed costs, explicit choices and policy (M5-I261, M5-I265, M5-I281)", () => {
  it("an AP-or-MP option without an authored choice is refused — never the cheapest, never both", () => {
    expect(problems(compileManeuverCost(req("fixture.wo11.maneuver.option_missing")))).toContain(K.MISSING_COST_CHOICE);
  });

  it("a foundation with no authored AP cost is never priced from its name", () => {
    const g = with_({ "fixture.wo11.maneuver.unpriced": { actions: [["attack1", "attack.unpriced"]], effects: [["effect1", "push", ["attack1"]]] } });
    expect(problems(compileManeuverCost(g.request("fixture.wo11.maneuver.unpriced")))).toEqual([K.UNRESOLVED_CONTRIBUTION]);
  });

  it("M5-SC-048: the canonical Elemental Damage Conversion cost is unresolved and fails closed", () => {
    const r = compileManeuverCost(req("fixture.wo11.maneuver.elemental_canonical"));
    expect(r.ok ? [] : r.problems.map((q) => [q.code, q.message])).toEqual([[K.UNRESOLVED_CONTRIBUTION, "the exact Effect cost is unresolved (M5-SC-048)"]]);
  });

  it("a Ruleset without a Maneuver cost policy is refused: Signature / minimum values are never defaulted", () => {
    expect(problems(compileManeuverCost(maneuverCostFixture({ policy: null }).request("fixture.wo11.maneuver.basic")))).toEqual([K.MISSING_POLICY]);
  });

  it("Spells are refused (final Spell cost is WO10); unknown freeform discount fields are refused", () => {
    expect(problems(compileManeuverCost({ ...req(), definition: F.ref("fixture.spell.simple") }))).toEqual([K.MANEUVER_ONLY]);
    expect(compileManeuverCost({ ...req(), discount: 2 }).ok).toBe(false);
    expect(compileManeuverCost({ ...req(), apCostOverride: 1 }).ok).toBe(false);
  });

  it("Once per Mission −5 AP and Weapon Lock stay deferred (M5-SC-044): refused, never a discount", () => {
    for (const k of ["once_per_mission", "weapon_lock"]) {
      const g = with_({ [`fixture.wo11.maneuver.${k}`]: { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "push", ["attack1"]]], conditions: [[k]] } });
      expect(problems(compileManeuverCost(g.request(`fixture.wo11.maneuver.${k}`)))).toContain(D.DEFERRED);
    }
  });

  it("restating the Attack's own weapon requirement as an executable Weapon Lock Condition is refused (no double dip)", () => {
    const base = maneuverCostFixture();
    const lock = copy(base.bundle.definitions.find((d) => d.canonicalKey === "maneuver.condition.weapon_lock")!.payload) as Record<string, unknown>;
    setPath(lock, "rules/condition/availability", "EXECUTABLE");
    setPath(lock, "rules/condition/deferralKey", null);
    setPath(lock, "costContributions", [{ contributionKey: "weapon_lock.ap", currency: "AP", data: { kind: "FIXED", amount: 1, modifier: "AP_REDUCTION" } }]);
    const g = maneuverCostFixture({ revise: { "maneuver.condition.weapon_lock": lock }, maneuvers: { "fixture.wo11.maneuver.lock": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "push", ["attack1"]]], conditions: [["weapon_lock"]] } } });
    expect(problems(compileManeuverCost(g.request("fixture.wo11.maneuver.lock")))).toEqual([K.REDUNDANT_RESTRICTION]);
  });
});

describe("attachment graph and Powerful Blow legality (M5-I282, M5-I286, M5-I288, M5-I290, M5-I293)", () => {
  const spec = (s: ManeuverSpec) => compileManeuverCost(with_({ "fixture.wo11.maneuver.x": s }).request("fixture.wo11.maneuver.x"));
  it("Powerful Blow cannot combine different Attacks (Longsword + Shield Bash) or include a non-attack action", () => {
    expect(problems(spec({ actions: [["attack1", "attack.longsword"], ["attack2", "attack.shield_bash"]], effects: [["effect1", "push", ["attack1", "attack2"]]], powerfulBlow: ["attack1", "attack2"] }))).toContain(A.FOUNDATION);
    expect(problems(spec({ actions: [["attack1", "attack.longsword"], ["action1", "action.move"]], effects: [["effect1", "push", ["attack1", "action1"]]], powerfulBlow: ["attack1", "action1"] }))).toContain(A.FOUNDATION);
  });

  it("an Attack-scoped Effect is never broadcast: attaching one instance to two separate Attacks, or to part of a Powerful Blow, is refused", () => {
    expect(problems(spec({ actions: [["attack1", "attack.longsword"], ["attack2", "attack.longsword"]], effects: [["effect1", "push", ["attack1", "attack2"]]] }))).toContain(A.FOUNDATION);
    expect(problems(spec({ actions: [["attack1", "attack.longsword"], ["attack2", "attack.longsword"]], effects: [["effect1", "push", ["attack1"]]], powerfulBlow: ["attack1", "attack2"] }))).toContain(A.FOUNDATION);
  });

  it("an Effect with no attachment, or attached to an unknown Attack use, is refused by the authored contract", () => {
    expect(() => with_({ "fixture.wo11.maneuver.x": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "push", ["attack9"]]] } })).toThrow(/attachment names one Effect and exact committed actions/);
    const r = copy(req());
    const d = (r.definitions as { definitions: { canonicalKey: string; payload: Record<string, unknown> }[] }).definitions.find((x) => x.canonicalKey === "fixture.wo11.maneuver.basic")!;
    d.payload = { ...d.payload, effectAttachments: [] };
    expect(compileManeuverCost(r).ok).toBe(false);
  });

  it("repeated uses of one Attack stay distinct contributions (never deduplicated by Definition)", () => {
    const r = runManeuverCost(req("fixture.wo11.maneuver.multi"));
    expect(r.result.ap.contributions.filter((c) => c.source === "FOUNDATION").map((c) => [c.componentKey, c.definition.canonicalKey, c.value])).toEqual([["attack1", "fixture.wo11.attack.longsword", 2], ["attack2", "fixture.wo11.attack.longsword", 2]]);
  });
});

describe("Signature assignment (M5-I273)", () => {
  it("the assignment is explicit: missing → refused; Signature without occupying a Signature slot → refused", () => {
    const missing = req();
    delete missing.signatureManeuver;
    expect(problems(compileManeuverCost(missing))).toEqual([K.INVALID_SIGNATURE]);
    expect(problems(compileManeuverCost({ ...req("fixture.wo11.maneuver.basic", true), signature: { usedSlots: 0, candidate: { slotUse: "EXEMPT", exemptionKey: null } } }))).toEqual([K.INVALID_SIGNATURE]);
  });

  it("a Maneuver's name never makes it a Signature Maneuver", () => {
    const g = with_({ "fixture.wo11.maneuver.signature_strike": { actions: [["attack1", "attack.longsword"]], effects: [["effect1", "push", ["attack1"]]] } });
    expect(runManeuverCost(g.request("fixture.wo11.maneuver.signature_strike") as Record<string, unknown>).result.ap.signature).toEqual({ assigned: false, reduction: 0, applied: false });
  });
});

describe("runtime and Spell boundaries (M5-I277–I278)", () => {
  it("only FORMULA / MODIFIER / REQUIREMENT / KEYWORD / EXPLANATION steps: nothing is spent, rolled, moved or executed", () => {
    const r = runManeuverCost(req("fixture.wo11.maneuver.mana"));
    for (const s of r.plan.evaluationPlan.steps) expect(["EXPLANATION", "FORMULA", "KEYWORD", "MODIFIER", "REQUIREMENT"]).toContain(s.operation);
    const wo11 = r.plan.evaluationPlan.steps.filter((s) => s.stepKey.startsWith("wo11."));
    expect(JSON.stringify(wo11)).not.toMatch(/RESOURCE|currentAp|currentMp|apRemaining|damageRoll|attackRoll|moveFeet|pro\b|percent/i);
    expect(r.plan.evaluationPlan.primaryStepKey).toBe(r.plan.steps.finalAp);
  });

  it("high-AP Maneuvers are reported, never rejected for exceeding 3 AP", () => {
    const r = runManeuverCost(req("fixture.wo11.maneuver.high"));
    expect([r.result.status, r.result.ap.finalApCost]).toEqual(["VALID", 5]);
  });
});

describe("plain-data safety, immutability, serialization, determinism (M5-I280)", () => {
  it.each([
    ["a getter", () => { const r = req(); Object.defineProperty(r, "signatureManeuver", { get: () => true, enumerable: true }); return r; }],
    ["a function", () => ({ ...req(), signatureManeuver: () => true })],
    ["a cycle", () => { const r = req(); const loop: Record<string, unknown> = {}; loop.self = loop; r.accessGrants = [loop]; return r; }],
    ["an unsafe __proto__ key", () => JSON.parse(JSON.stringify(req()).replace('"stats":{', '"stats":{"__proto__":{"polluted":1},')) as Record<string, unknown>],
    ["a non-boolean Signature assignment", () => ({ ...req(), signatureManeuver: "yes" })],
  ])("%s is refused safely", (_label, build) => {
    expect(compileManeuverCost(build()).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("inputs are never mutated; outputs are deep-frozen", () => {
    const r = req("fixture.wo11.maneuver.elemental", false, maneuverCostCharacter([F.ref("affinity.transmutation"), "EXPERT"]));
    const before = JSON.stringify(r);
    const out = evaluateManeuverCost(r);
    expect(JSON.stringify(r)).toBe(before);
    expect(out.ok && Object.isFrozen(out.value) && Object.isFrozen(out.value.ap.contributions) && Object.isFrozen(out.value.structure)).toBe(true);
  });

  it("equal requests give deep-equal plans, runs and results; plans replay through M4 after a JSON round-trip", () => {
    const a = runManeuverCost(req("fixture.wo11.maneuver.mixed"));
    const b = runManeuverCost(req("fixture.wo11.maneuver.mixed"));
    expect([a.plan, a.run, a.result]).toEqual([b.plan, b.run, b.result]);
    expect(JSON.parse(JSON.stringify(a.result))).toEqual(a.result);
    const replay = orchestrateRulesEvaluation({ evaluationKey: "m5-wo11.test", contexts: { ruleset: F.ruleset }, plan: JSON.parse(JSON.stringify(a.plan.evaluationPlan)) });
    expect(replay.data).toEqual(a.run);
  });

  it("a foreign or incomplete run is refused", () => {
    const a = runManeuverCost(req());
    expect(codes(readManeuverCostRun(a.plan, { ...a.run, steps: a.run.steps.slice(1) }))).toEqual([K.INCOMPLETE_RUN]);
    const other = runManeuverCost(req("fixture.wo11.maneuver.high"));
    expect(readManeuverCostRun(a.plan, other.run).ok).toBe(false);
  });
});
