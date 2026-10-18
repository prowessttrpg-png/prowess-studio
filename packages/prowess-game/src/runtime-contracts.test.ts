import { describe, expect, it } from "vitest";
import { createProwessDefinitionBundle } from "./bundle/bundle.js";
import { DEFINITION_ERROR_CODES as C, RUNTIME_ERROR_CODES as R } from "./definition/codes.js";
import { resolveRollSignals } from "./core/dice.js";
import { resolveInitiativeOrder } from "./runtime/combat.js";
import { buildRuntimeContexts, compileRuntime } from "./runtime/compile.js";
import { indexRuntimeDefinitions } from "./runtime/definitions.js";
import { confirmActionPayment, readRuntimeRun } from "./runtime/results.js";
import { validateCombatTiming, validateRuntimeResources } from "./runtime/resources.js";
import { PROWESS_DEFINITION_KINDS } from "./vocabulary/families.js";
import { RESOURCE_CONTEXT_KEYS, RUNTIME_RESOURCE_KEYS } from "./vocabulary/runtime.js";
import { coreBundle, coreRuleset, RUNTIME_CONTENT, RUNTIME_DEFINITIONS } from "./testing/core-fixtures.js";
import { codes } from "./testing/core-run.js";
import { compileRuntimeWith, evaluateRuntime, payForAction, resources, runRuntime, runtimeCharacter } from "./testing/runtime-run.js";

/**
 * M5-WO3 runtime contracts (PAS-10 M5-WO3 §19–21, §53–59, §100–103, §166–172, §196–201): payload contracts, the action
 * catalog as content, plain-data security, immutability, serialization, determinism, provenance, two-phase safety and
 * historical / cross-Ruleset isolation.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I076 Size movement values are explicit only ·
 * M5-I080 distinct Resources · M5-I081 maximum vs current · M5-I090 ME eligibility explicit · M5-I091 listed cost ·
 * M5-I092 atomic payment · M5-I095 transitions through M4 Resource operations · M5-I097 action costs are content ·
 * M5-I103 Initiative tie-break from the exact Definition · M5-I105 no persistence · M5-I106 provenance · M5-I108
 * occupied space ≠ speed · M5-I110 ordinary costs are atomic.
 */
const fixture = coreBundle();
const payloadOf = (key: string) => JSON.parse(JSON.stringify(RUNTIME_DEFINITIONS.find((d) => d.canonicalKey === key)?.payload)) as Record<string, unknown>;
const bundleWith = (key: string, payload: Record<string, unknown>) => {
  const { ruleset, definitions } = coreRuleset({ revise: { [key]: payload } });
  return createProwessDefinitionBundle({ ruleset, definitions });
};
const rejects = (key: string, patch: Record<string, unknown>, code: string = C.INVALID_PAYLOAD) => expect(codes(bundleWith(key, { ...payloadOf(key), ...patch })), JSON.stringify(patch)).toContain(code);
const ch = runtimeCharacter();

describe("canonical runtime content (§100–§101, §166)", () => {
  it("is one versioned content document of 26 Definitions: 6 Resources, 13 Actions, 5 Sizes, 2 Terrains", () => {
    expect(RUNTIME_CONTENT.contentKey).toBe("prowess.core_playtest.v0_1.runtime_resources");
    const kinds = RUNTIME_DEFINITIONS.map((d) => d.definitionKind);
    expect([kinds.filter((k) => k === "RESOURCE").length, kinds.filter((k) => k === "ACTION").length, kinds.filter((k) => k === "CREATURE_SIZE").length, kinds.filter((k) => k === "TERRAIN").length]).toEqual([6, 13, 5, 2]);
    expect(new Set(RUNTIME_DEFINITIONS.map((d) => d.canonicalKey)).size).toBe(26);
  });

  it("RESOURCE / ACTION / CREATURE_SIZE / TERRAIN have v1 contracts; RESOURCE keeps its M1 RESOURCE storage type", () => {
    for (const kind of ["RESOURCE", "ACTION", "CREATURE_SIZE", "TERRAIN"] as const) expect(PROWESS_DEFINITION_KINDS[kind].schemaVersions, kind).toEqual([1]);
    expect(PROWESS_DEFINITION_KINDS.RESOURCE.entityTypes).toEqual(["RESOURCE"]);
    expect(PROWESS_DEFINITION_KINDS.ACTION.entityTypes).toEqual(["GENERIC_RULE"]);
  });

  it("M5-I080 / M5-I081 the five runtime Resources and the movement tracker are distinct Definitions; maxima are WO2 statistics, never current values", () => {
    const index = indexRuntimeDefinitions(fixture.bundle);
    if (!index.ok) throw new Error("index");
    expect(RUNTIME_RESOURCE_KEYS.map((k) => [k, index.value.resources[k].payload.m4Kind, index.value.resources[k].payload.maximum])).toEqual([
      ["HP", "POOL", { source: "DERIVED", statistic: "MAXIMUM_HP" }],
      ["MP", "POOL", { source: "DERIVED", statistic: "MAXIMUM_MP" }],
      ["ME", "TEMPORARY_POOL", { source: "DERIVED", statistic: "BASE_MANA_EFFICIENCY" }],
      ["AP", "ACTION", { source: "DERIVED", statistic: "BASE_AP_CAPACITY" }],
      ["COUNTER_ACTION", "SLOT", { source: "DERIVED", statistic: "COUNTER_ACTION_CAPACITY" }],
      ["MOVEMENT_ALLOWANCE", "TRACKER", { source: "UNBOUNDED" }],
    ]);
    for (const d of RUNTIME_DEFINITIONS.filter((x) => x.definitionKind === "RESOURCE")) expect(Object.keys(d.payload), d.canonicalKey).not.toContain("current");
    rejects("resource.hp", { current: 10 });
  });

  it("M5-I097 core Action costs are structured content (s44, s432) — FIXED / RANGE / MINIMUM / VARIABLE / NONE", () => {
    const cost = (key: string) => payloadOf(key).actionPointCost;
    expect(Object.fromEntries(RUNTIME_DEFINITIONS.filter((d) => d.definitionKind === "ACTION").map((d) => [d.payload.actionKey, cost(d.canonicalKey)]))).toEqual({
      MOVE: { model: "FIXED", amount: 1 },
      SPRINT: { model: "FIXED", amount: 3 },
      LIGHT_ATTACK: { model: "FIXED", amount: 1 },
      BALANCED_ATTACK: { model: "FIXED", amount: 2 },
      HEAVY_ATTACK: { model: "FIXED", amount: 3 },
      BLOCK: { model: "FIXED", amount: 2 },
      DODGE_ACTION: { model: "FIXED", amount: 3 },
      RELOAD: { model: "FIXED", amount: 1 },
      INTERACT: { model: "MINIMUM", minimum: 1 },
      GRAPPLE: { model: "RANGE", minimum: 1, maximum: 2 },
      CAST_SPELL: { model: "VARIABLE", determinedBy: "SPELL" },
      USE_SKILL_ACTION: { model: "VARIABLE", determinedBy: "SKILL_ACTION" },
      COUNTER_REACTION: { model: "NONE" },
    });
  });

  it("§57 the Dodge Action and the Dodge defense are distinct identities", () => {
    const action = RUNTIME_DEFINITIONS.find((d) => d.payload.actionKey === "DODGE_ACTION");
    expect([action?.canonicalKey, action?.definitionKind]).toEqual(["action.dodge", "ACTION"]);
    expect(fixture.bundle.definitions.find((d) => d.canonicalKey === "core.derived.dodge")?.definitionKind).toBe("DERIVED_STAT");
  });

  it("M5-I076 / M5-I108 / M5-I113 Sizes carry occupied space only; a Size Base Movement value is refused (M5-SC-033)", () => {
    expect(RUNTIME_DEFINITIONS.filter((d) => d.definitionKind === "CREATURE_SIZE").map((d) => [d.payload.sizeKey, d.payload.occupiedSpaceFeet, d.payload.orLarger, d.payload.baseMovement])).toEqual([
      ["SMALL", [5], false, null],
      ["MEDIUM", [5], false, null],
      ["LARGE", [10, 10], false, null],
      ["HUGE", [15, 15], false, null],
      ["MASSIVE", [20, 20], true, null],
    ]);
    rejects("creature_size.large", { baseMovement: { kind: "ADD", feet: 10 } }, C.DEFERRED_PENDING_CANON);
    rejects("creature_size.large", { baseMovement: 10 }, C.DEFERRED_PENDING_CANON); // occupied 10 × 10 ft is never Base Movement
    rejects("creature_size.large", { movementAdjustment: null }); // the WO3 field name is gone (post-WO3 amendment)
    rejects("creature_size.large", { occupiedSpaceFeet: [] });
  });
});

describe("RESOURCE / ACTION / TERRAIN payloads fail closed (§167–§169, §196)", () => {
  it("RESOURCE: known key and M4 kind, non-negative minimum, explicit timing, reservation needs a bound", () => {
    rejects("resource.hp", { resourceKey: "STAMINA" });
    rejects("resource.hp", { m4Kind: "HEALTH" });
    rejects("resource.hp", { minimum: -1 });
    rejects("resource.ap", { refresh: [{ timing: "WHENEVER", target: "TO_NOMINAL_MAXIMUM" }] });
    rejects("resource.ap", { expiry: [{ timing: "START_OF_TURN", setTo: "MINIMUM", preservableByExplicitRule: true }] }); // two rules at one timing
    rejects("resource.movement_allowance", { supportsReservation: true });
    rejects("resource.counter_action", { spending: "DIRECT" }); // usage-restricted → PAYMENT_ONLY
    rejects("resource.me", { payment: [{ policy: "ME_ELIGIBLE_MAGICAL_COST", order: 0 }, { policy: "ME_ELIGIBLE_MAGICAL_COST", order: 1 }] });
  });

  it("ACTION: explicit cost model; RANGE minimum below maximum; outside-turn actions need a trigger; grants read DERIVED only", () => {
    rejects("action.grapple", { actionPointCost: { model: "RANGE", minimum: 2, maximum: 2 } });
    rejects("action.move", { actionPointCost: { model: "FIXED", amount: -1 } });
    rejects("action.move", { actionPointCost: { model: "SLOTS", amount: 1 } });
    rejects("action.counter_reaction", { requiresTrigger: false });
    rejects("action.move", { movementGrant: { formula: { expression: "5 * agi", rounding: "NONE", variables: [{ variable: "agi", source: { kind: "STAT", stat: "AGI" } }] } } });
    rejects("action.move", { otherCosts: [{ costKey: "AP", policy: "ACTION_POINT_COST", amount: 1 }] });
  });

  it("TERRAIN: an M4 Formula reading the distance moved exactly once", () => {
    rejects("terrain.difficult", { allowanceCost: { expression: "2", rounding: "NONE", variables: [] } });
    rejects("terrain.difficult", { allowanceCost: { expression: "distance *", rounding: "NONE", variables: [{ variable: "distance", source: { kind: "MOVEMENT_DISTANCE" } }] } }, C.INVALID_FORMULA);
  });

  it("two Definitions claiming one runtime role, or one payment position, fail closed", () => {
    const { ruleset, definitions } = coreRuleset({ extra: [{ canonicalKey: "resource.ap_copy", definitionKind: "RESOURCE", payload: payloadOf("resource.ap") }] });
    const bundle = createProwessDefinitionBundle({ ruleset, definitions });
    if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems));
    expect(codes(indexRuntimeDefinitions(bundle.value))).toContain(R.AMBIGUOUS_RUNTIME_DEFINITION);
    const swapped = coreBundle({ revise: { "resource.me": { ...payloadOf("resource.me"), payment: [{ policy: "ME_ELIGIBLE_MAGICAL_COST", order: 1 }] } } });
    expect(codes(indexRuntimeDefinitions(swapped.bundle))).toContain(R.INCONSISTENT_RUNTIME_DEFINITIONS);
  });
});

describe("runtime inputs are plain data and fail closed (§196)", () => {
  const index = (() => {
    const i = indexRuntimeDefinitions(fixture.bundle);
    if (!i.ok) throw new Error("index");
    return i.value;
  })();
  it("rejects getters, functions, cycles, unsafe keys, non-finite and negative values, unknown or duplicate Resources", () => {
    const getter = { resources: [{ resourceKey: "AP", get current() { return 3; } }] };
    const cyclic: Record<string, unknown> = { resources: [] };
    cyclic.self = cyclic;
    expect(codes(validateRuntimeResources(getter, index))).not.toEqual([]);
    expect(codes(validateRuntimeResources({ resources: [{ resourceKey: "AP", current: () => 3 }] }, index))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(validateRuntimeResources(cyclic, index))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(validateRuntimeResources(JSON.parse('{"resources":[{"resourceKey":"AP","current":1,"__proto__":{"x":1}}]}'), index))).not.toEqual([]);
    expect(codes(validateRuntimeResources({ resources: [{ resourceKey: "AP", current: Number.POSITIVE_INFINITY }] }, index))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(validateRuntimeResources({ resources: [{ resourceKey: "AP", current: -1 }] }, index))).toEqual([R.NEGATIVE_RESOURCE_VALUE]);
    expect(codes(validateRuntimeResources({ resources: [{ resourceKey: "MP", current: 1, reservedCapacity: -2 }] }, index))).toEqual([R.NEGATIVE_RESOURCE_VALUE]);
    expect(codes(validateRuntimeResources({ resources: [{ resourceKey: "AP", current: 1, reservedCapacity: 1 }] }, index))).toEqual([R.TRANSITION_NOT_SUPPORTED]);
    expect(codes(validateRuntimeResources({ resources: [{ resourceKey: "STAMINA", current: 1 }] }, index))).toEqual([R.INVALID_RESOURCE_STATE]);
    expect(codes(validateRuntimeResources({ resources: [{ resourceKey: "AP", current: 1 }, { resourceKey: "AP", current: 2 }] }, index))).toEqual([R.INVALID_RESOURCE_STATE]);
  });

  it("combat timing: integer round from 1, explicit surprised flag", () => {
    expect(validateCombatTiming({ round: 1, surprised: false }).ok).toBe(true);
    for (const bad of [{ round: 0, surprised: false }, { round: 1.5, surprised: false }, { round: 1 }, { round: 1, surprised: "yes" }]) expect(codes(validateCombatTiming(bad)), JSON.stringify(bad)).toContain(R.INVALID_TIMING);
  });

  it("current above maximum is diagnosed by M4 itself (no TypeScript clamp)", () => {
    const plan = compileRuntimeWith({ kind: "RESOURCE_STATE", subjectKey: "s" }, { character: runtimeCharacter({ AGI: 3 }), resources: resources(["AP", 9]) });
    if (!plan.ok) throw new Error("compile");
    const { run } = evaluateRuntime(plan.value, { character: runtimeCharacter({ AGI: 3 }), resources: resources(["AP", 9]) });
    expect(run.steps.at(-1)?.response?.errors.map((e) => e.code)).toEqual(["RESOURCE.INVALID_STATE"]);
  });
});

describe("runtime requests fail closed", () => {
  /** `combat: null` omits the combat position. */
  const c = (subject: Record<string, unknown>, state = resources(["AP", 3], ["COUNTER_ACTION", 1], ["MOVEMENT_ALLOWANCE", 0]), combat: unknown = { round: 1, surprised: false }) =>
    codes(compileRuntimeWith(subject, { character: ch, resources: state, ...(combat === null ? {} : { combat }) }));
  it("transitions a Resource does not support (no generic AP restore, no HP reservation, no direct Counter spend)", () => {
    expect(c({ kind: "RESOURCE_TRANSITIONS", subjectKey: "x", transitions: [{ resourceKey: "AP", operation: "RESTORE", amount: 1 }] })).toEqual([R.TRANSITION_NOT_SUPPORTED]);
    expect(c({ kind: "RESOURCE_TRANSITIONS", subjectKey: "x", transitions: [{ resourceKey: "HP", operation: "RESERVE_CAPACITY", amount: 1 }] }, resources(["HP", 3]))).toEqual([R.TRANSITION_NOT_SUPPORTED]);
    expect(c({ kind: "RESOURCE_TRANSITIONS", subjectKey: "x", transitions: [{ resourceKey: "COUNTER_ACTION", operation: "SPEND", amount: 1 }] })).toEqual([R.TRANSITION_NOT_SUPPORTED]);
    expect(c({ kind: "RESOURCE_TRANSITIONS", subjectKey: "x", transitions: [{ resourceKey: "AP", operation: "REFRESH", amount: 1 }] })).toEqual([R.TRANSITION_NOT_SUPPORTED]);
    expect(c({ kind: "RESOURCE_TRANSITIONS", subjectKey: "x", transitions: [{ resourceKey: "AP", operation: "SPEND", amount: -1 }] })).toEqual([R.NEGATIVE_RESOURCE_VALUE]);
    expect(c({ kind: "RESOURCE_TRANSITIONS", subjectKey: "x", transitions: [{ resourceKey: "HP", operation: "SPEND", amount: 1 }] })).toEqual([R.MISSING_RESOURCE_STATE]);
  });

  it("action requests: unknown action, wrong window, missing trigger, fixed cost restated, range / minimum / variable costs explicit", () => {
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "FIREBALL", window: "OWN_TURN" })).toEqual([R.UNKNOWN_ACTION]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "MOVE", window: "OUTSIDE_OWN_TURN" })).toEqual([R.ACTION_TIMING_MISMATCH]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "COUNTER_REACTION", window: "OUTSIDE_OWN_TURN" })).toEqual([R.TRIGGER_REQUIRED]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "MOVE", window: "OWN_TURN", actionPointCost: 0 })).toEqual([R.INVALID_ACTION_COST]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "GRAPPLE", window: "OWN_TURN" })).toEqual([R.INVALID_ACTION_COST]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "GRAPPLE", window: "OWN_TURN", actionPointCost: 3 })).toEqual([R.INVALID_ACTION_COST]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "INTERACT", window: "OWN_TURN", actionPointCost: 0 })).toEqual([R.INVALID_ACTION_COST]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "CAST_SPELL", window: "OWN_TURN", actionPointCost: 2 })).toEqual([R.INVALID_ACTION_COST]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "GRAPPLE", window: "OWN_TURN", actionPointCost: 2 })).toEqual([]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "INTERACT", window: "OWN_TURN", actionPointCost: 3 })).toEqual([]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "CAST_SPELL", window: "OWN_TURN", actionPointCost: 2, costSourceKey: "spell.test_bolt" })).toEqual([]);
    expect(c({ kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "COUNTER_REACTION", window: "OUTSIDE_OWN_TURN", trigger: { triggerKey: "t", sourceKey: "feature.guard" } }, resources(["COUNTER_ACTION", 1]), null)).toEqual([R.INVALID_RUNTIME_REQUEST]);
  });

  it("§59 a core cost is a default: an explicit override (with its source rule) replaces a FIXED cost; the listed amount is the override", () => {
    const { confirmation } = payForAction({ actionKey: "RELOAD", window: "OWN_TURN", costOverride: { amount: 2, sourceKey: "weapon.test_heavy_crossbow" } }, { character: ch, resources: resources(["AP", 3]) });
    expect([confirmation.status, confirmation.payments[0]?.listedAmount]).toEqual(["PAID", 2]);
  });

  it("timing needs combat position; preserving a non-preservable Resource is refused", () => {
    expect(c({ kind: "RESOURCE_TIMING", subjectKey: "t", event: "START_OF_TURN" }, resources(["AP", 1]), null)).toEqual([R.INVALID_TIMING]);
    expect(c({ kind: "RESOURCE_TIMING", subjectKey: "t", event: "START_OF_ROUND", preserve: [{ resourceKey: "ME", sourceKey: "feature.x" }] }, resources(["ME", 1]))).toEqual([R.PRESERVATION_NOT_ALLOWED]);
    expect(c({ kind: "RESOURCE_TIMING", subjectKey: "t", event: "SOMETIME" })).toEqual([R.INVALID_TIMING]);
  });

  it("M5-I090 ME eligibility must be stated explicitly", () => {
    expect(c({ kind: "MAGICAL_PAYMENT", subjectKey: "m", costKey: "x", listedAmount: 3 }, resources(["MP", 3], ["ME", 1]))).toEqual(["PROWESS_COMPILATION.INVALID_REQUEST"]);
  });
});

describe("M5-I095 every runtime transition is an M4 Resource operation; nothing is calculated in TypeScript", () => {
  it("plans contain only FORMULA, REQUIREMENT and RESOURCE_* operations, and resource steps carry no precomputed result", () => {
    const plans = [
      compileRuntimeWith({ kind: "MAGICAL_PAYMENT", subjectKey: "m", costKey: "x", listedAmount: 8, meEligible: true }, { character: ch, resources: resources(["MP", 9], ["ME", 3]) }),
      compileRuntimeWith({ kind: "RESOURCE_TIMING", subjectKey: "t", event: "START_OF_ROUND" }, { character: ch, resources: resources(["ME", 1], ["COUNTER_ACTION", 0]), combat: { round: 1, surprised: false } }),
      compileRuntimeWith({ kind: "MOVEMENT", subjectKey: "mv", segments: [{ distance: 5, terrainKey: "DIFFICULT" }] }, { character: ch, resources: resources(["MOVEMENT_ALLOWANCE", 20]) }),
    ];
    for (const plan of plans) {
      if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
      for (const step of plan.value.evaluationPlan.steps) {
        expect(step.operation, step.stepKey).toMatch(/^(FORMULA|REQUIREMENT|RESOURCE_(SPEND|RESTORE|SET_CURRENT|RESERVE_CAPACITY|RELEASE_CAPACITY|REFRESH|PAYMENT_PREVIEW|PAYMENT_APPLY))$/);
        expect(JSON.stringify(step.input), step.stepKey).not.toMatch(/"(currentAfter|resultingResources|canPay|finalValue)"/);
      }
    }
  });

  it("M5-I091 the payment's listed amount is the literal listed cost; no step lowers it by ME", () => {
    const plan = compileRuntimeWith({ kind: "MAGICAL_PAYMENT", subjectKey: "m", costKey: "x", listedAmount: 8, meEligible: true }, { character: runtimeCharacter({ PRO: 5 }, { baseMp: 17 }), resources: resources(["MP", 18], ["ME", 5]) });
    if (!plan.ok) throw new Error("compile");
    const apply = plan.value.evaluationPlan.steps.find((s) => s.stepKey === plan.value.outputs.payments[0]?.apply);
    expect((apply?.input as { payment: { listedAmount: number } }).payment.listedAmount).toBe(8);
    expect(apply?.bindings.some((b) => b.target.startsWith("/payment/listedAmount"))).toBe(false);
  });
});

describe("§103 / §106 PROVENANCE — every step maps to its exact RESOURCE / ACTION / TERRAIN / derived Definition (M5-I106)", () => {
  it("one source-map entry per step, each citing exact bundle Definitions; Resource steps cite their RESOURCE Definition", () => {
    const { result } = payForAction({ actionKey: "SPRINT", window: "OWN_TURN" }, { character: runtimeCharacter({ AGI: 4 }), resources: resources(["AP", 4]) });
    const plan = result.plan;
    expect(plan.sourceMap.entries.map((e) => e.stepKey)).toEqual(plan.evaluationPlan.steps.map((s) => s.stepKey));
    const apply = plan.sourceMap.entries.find((e) => e.stepKey === plan.outputs.payments[0]?.apply);
    expect(apply?.definitions.map((d) => d.canonicalKey).sort()).toEqual(["action.sprint", "core.derived.base_ap_capacity", "resource.ap"]);
    const capacity = plan.sourceMap.entries.find((e) => e.stepKey === plan.outputs.derived.BASE_AP_CAPACITY);
    expect(capacity?.definitions.map((d) => d.canonicalKey).sort()).toEqual(["core.derived.ap_agility_bonus", "core.derived.base_ap_capacity"]);
    for (const entry of plan.sourceMap.entries) for (const d of entry.definitions) expect(fixture.bundle.definitions.some((x) => x.entityVersionId === d.entityVersionId)).toBe(true);
    expect(plan.rulesetProvenance).toEqual(fixture.bundle.rulesetProvenance);
  });

  it("M4 rule provenance on payments and transitions names the exact Definition versions", () => {
    const r = runRuntime({ kind: "MAGICAL_PAYMENT", subjectKey: "m", costKey: "x", listedAmount: 2, meEligible: true }, { character: ch, resources: resources(["MP", 3], ["ME", 1]) });
    const step = r.run.steps.find((s) => s.stepKey === r.plan.outputs.payments[0]?.apply);
    const sources = (step?.response?.data as { allocations: { provenance: { canonicalKey: string } }[] }).allocations.map((a) => a.provenance.canonicalKey);
    expect(sources).toEqual(["resource.me", "resource.mp"]);
  });
});

describe("§97–§99 / §197–§199 immutability, serialization, determinism, no persistence (M5-I105)", () => {
  it("caller-owned runtime state is never mutated; outputs are deep-frozen and JSON round-trip without loss", () => {
    const state = resources(["MP", 18], ["ME", 5]);
    const before = JSON.stringify(state);
    const r = runRuntime({ kind: "MAGICAL_PAYMENT", subjectKey: "m", costKey: "x", listedAmount: 8, meEligible: true }, { character: runtimeCharacter({ PRO: 5 }, { baseMp: 17 }), resources: state });
    expect(JSON.stringify(state)).toBe(before);
    expect(Object.isFrozen(r.plan) && Object.isFrozen(r.plan.evaluationPlan.steps[0]) && Object.isFrozen(r.reading.resources.resources[0])).toBe(true);
    for (const value of [r.plan, r.reading, resolveRollSignals({ advantage: ["a"], disadvantage: ["b"] })]) expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it("equal requests give deep-equal plans and runs", () => {
    const subject = { kind: "ACTION_PAYMENT", subjectKey: "a", actionKey: "GRAPPLE", window: "OWN_TURN", actionPointCost: 2 };
    const inputs = { character: ch, resources: resources(["AP", 3]) };
    expect(runRuntime(subject, inputs).plan).toEqual(runRuntime(subject, inputs).plan);
    expect(runRuntime(subject, inputs).run).toEqual(runRuntime(subject, inputs).run);
  });

  it("no compile or read API takes a persistence target, and contexts carry only the supplied runtime state", () => {
    const contexts = buildRuntimeContexts({ definitions: fixture.bundle, character: ch, resources: resources(["MP", 4, 2]), combat: { round: 2, surprised: true } });
    if (!contexts.ok) throw new Error("contexts");
    expect(contexts.value.runtime.resourceValues).toEqual({ [RESOURCE_CONTEXT_KEYS.MP]: 4 });
    expect(contexts.value.runtime.reservedCapacity).toEqual({ [RESOURCE_CONTEXT_KEYS.MP]: 2 });
    expect(contexts.value.runtime.state).toEqual({ "combat.round": 2, "combat.surprised": 1 });
    expect(codes(compileRuntime({ contractVersion: 1, subject: { kind: "RESOURCE_STATE", subjectKey: "s" }, definitions: fixture.bundle, ruleset: fixture.ruleset, character: ch, resources: resources(["AP", 1]), persist: true }))).toEqual(["PROWESS_COMPILATION.INVALID_REQUEST"]);
  });
});

describe("§76–§77 TWO-PHASE SAFETY and atomic action costs (M5-I092 / M5-I110)", () => {
  it("a foreign, forged or stale receipt never compiles a follow-on", () => {
    const { confirmation } = payForAction({ actionKey: "MOVE", window: "OWN_TURN" }, { character: ch, resources: resources(["AP", 3], ["MOVEMENT_ALLOWANCE", 0]) });
    const follow = (receipt: unknown, state: unknown = confirmation.resources, f = fixture) =>
      codes(compileRuntime({ contractVersion: 1, subject: { kind: "ACTION_FOLLOW_ON", subjectKey: "f", receipt }, definitions: f.bundle, ruleset: f.ruleset, character: ch, resources: state }));
    expect(follow(confirmation)).toEqual([]);
    expect(follow({ ...confirmation, status: "CANNOT_PAY" })).toEqual([R.PAYMENT_NOT_CONFIRMED]);
    expect(follow(confirmation, resources(["AP", 3], ["MOVEMENT_ALLOWANCE", 0]))).toEqual([R.INVALID_PAYMENT_RECEIPT]); // state before the payment
    const other = coreBundle({ rulesetId: "00000000-0000-4000-8000-000000007011", manifestId: "00000000-0000-4000-8000-000000007012" });
    expect(follow(confirmation, confirmation.resources, other)).toEqual([R.INVALID_PAYMENT_RECEIPT]);
  });

  it("confirming a run that is not of the plan fails closed; a non-payment plan is never confirmed", () => {
    const { result } = payForAction({ actionKey: "LIGHT_ATTACK", window: "OWN_TURN" }, { character: ch, resources: resources(["AP", 3]) });
    expect(codes(confirmActionPayment({ plan: result.plan, run: { steps: [] }, resources: result.before }))).toContain(R.INCOMPLETE_RUN);
    const timing = runRuntime({ kind: "RESOURCE_TIMING", subjectKey: "t", event: "END_OF_TURN" }, { character: ch, resources: resources(["AP", 1]), combat: { round: 1, surprised: false } });
    expect(codes(confirmActionPayment({ plan: timing.plan, run: timing.run, resources: timing.before }))).toEqual([R.INVALID_PAYMENT_RECEIPT]);
    expect(codes(readRuntimeRun({ plan: timing.plan, run: { steps: [{ stepKey: "x" }] }, resources: timing.before }))).toContain(R.INCOMPLETE_RUN);
  });

  it("an action costing 3 with 2 AP is never partially paid and never becomes a multi-turn debt", () => {
    const { result, confirmation } = payForAction({ actionKey: "DODGE_ACTION", window: "OWN_TURN" }, { character: ch, resources: resources(["AP", 2]) });
    expect(result.reading.payments[0]?.allocations).toEqual([{ resourceKey: "AP", order: 0, amountPaid: 2, currentBefore: 2, currentAfter: 0 }]); // projected only
    expect([result.current("AP"), confirmation.status, confirmation.resources]).toEqual([2, "CANNOT_PAY", result.before]);
    expect(JSON.stringify(result.plan)).not.toMatch(/channel|debt|commit/i);
  });
});

describe("§200–§201 historical reproducibility and Ruleset isolation (in memory; the database twin runs in @prowess/db)", () => {
  it("R2 with a different test Action cost changes R2 only; R1 evaluates identically; concurrent runs never mix", () => {
    const r1 = coreBundle();
    const r2 = coreBundle({ rulesetId: "00000000-0000-4000-8000-000000007011", manifestId: "00000000-0000-4000-8000-000000007012", revise: { "action.attack.heavy": { ...payloadOf("action.attack.heavy"), actionPointCost: { model: "FIXED", amount: 4 } } } });
    const pay = (f: typeof r1) => payForAction({ actionKey: "HEAVY_ATTACK", window: "OWN_TURN" }, { character: runtimeCharacter({ AGI: 6 }), resources: resources(["AP", 5]) }, f);
    const [a, b, again] = [pay(r1), pay(r2), pay(r1)];
    expect([a.confirmation.payments[0]?.listedAmount, b.confirmation.payments[0]?.listedAmount]).toEqual([3, 4]);
    expect([a.confirmation.resources.resources[0]?.current, b.confirmation.resources.resources[0]?.current]).toEqual([2, 1]);
    expect(again.result.plan).toEqual(a.result.plan);
    expect(again.result.run).toEqual(a.result.run);
    const cited = (x: typeof a) => new Set<string>(x.result.plan.sourceMap.entries.flatMap((e) => e.definitions.map((d) => d.entityVersionId as string)));
    const heavy = (f: typeof r1) => f.bundle.definitions.find((d) => d.canonicalKey === "action.attack.heavy")?.entityVersionId as string;
    expect(heavy(r1)).not.toBe(heavy(r2));
    expect(cited(a).has(heavy(r1)) && !cited(a).has(heavy(r2))).toBe(true);
    expect(cited(b).has(heavy(r2)) && !cited(b).has(heavy(r1))).toBe(true);
    const mixed = compileRuntime({ contractVersion: 1, subject: { kind: "RESOURCE_STATE", subjectKey: "s" }, definitions: r1.bundle, ruleset: r2.ruleset, character: ch, resources: resources(["AP", 1]) });
    expect(mixed.ok).toBe(false);
  });

  it("initiative tie-break comes from the exact INITIATIVE Definition (a revised order is that Ruleset's order)", () => {
    const initiative = (coreRuleset().definitions.find((d) => d.canonicalKey === "core.resolution.initiative")?.payload ?? {}) as Record<string, unknown>;
    const agiFirst = coreBundle({ revise: { "core.resolution.initiative": { ...initiative, tiebreak: [{ kind: "HIGHEST_STAT", stat: "AGI" }, { kind: "HIGHEST_STAT", stat: "PER" }, { kind: "REROLL" }] } } });
    const sideA = { sideKey: "A", initiative: 10, members: [{ creatureKey: "a", stats: { PER: 5, AGI: 1 } }] };
    const sideB = { sideKey: "B", initiative: 10, members: [{ creatureKey: "b", stats: { PER: 4, AGI: 6 } }] };
    const sides = [sideA, sideB];
    const order = (f: typeof fixture) => {
      const r = resolveInitiativeOrder({ definitions: f.bundle, sides });
      return r.ok ? r.value.order : null;
    };
    expect([order(fixture), order(agiFirst)]).toEqual([[["A"], ["B"]], [["B"], ["A"]]]);
    expect(codes(resolveInitiativeOrder({ definitions: fixture.bundle, sides: [sideA] }))).toEqual([R.INVALID_INITIATIVE]);
    expect(codes(resolveInitiativeOrder({ definitions: fixture.bundle, sides: [sideA, { ...sideB, initiative: Number.NaN }] }))).toContain(C.NOT_PLAIN_DATA);
  });
});
