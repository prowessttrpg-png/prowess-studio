import { orchestrateRulesEvaluation } from "@prowess/rules";
import { describe, expect, it } from "vitest";
import { compileAbilityTargeting, evaluateAbilityTargeting, readAbilityTargetingRun } from "./targeting/compile.js";
import { DEFINITION_ERROR_CODES as C, TARGETING_ERROR_CODES as T } from "./definition/codes.js";
import { TARGETING_SEMANTIC_SHAPES } from "./vocabulary/construction.js";
import { PROWESS_DEFINITION_KINDS } from "./vocabulary/families.js";
import { BASE_TARGETING_SHAPES, HISTORICAL_ADD_ON_SHAPES, TARGETING_ADD_ONS, TARGETING_RANGE_MODELS } from "./vocabulary/targeting.js";
import { codes } from "./testing/core-run.js";
import {
  TARGETING_CONTENT,
  TARGETING_MANIFEST_2,
  TARGETING_RULESET_2,
  T_FIXTURE,
  maneuverWith,
  measureOf,
  runTargeting,
  spellWith,
  targetingFixture,
  targetingRequest,
} from "./testing/targeting-fixtures.js";

/**
 * M5-WO6 contracts (PAS-10 M5-WO6 §19–§23, §51–§58, §101–§128): the canonical Targeting catalogs, the `rules.targeting`
 * sub-contract and typed cost contributions, request validation, M4 primitives only, Keyword provenance, the source map,
 * exact Ruleset history and isolation, plain-data safety, immutability, serialization and determinism.
 * Guard index (docs/architecture/m5-invariants.json): M5-I159 · M5-I160 · M5-I161 · M5-I162 · M5-I163 · M5-I164 ·
 * M5-I170 · M5-I171 · M5-I172 · M5-I175 · M5-I176 · M5-I177 · M5-I178.
 */
const F = T_FIXTURE();
type Def = { canonicalKey: string; definitionKind: string; payload: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const defs = TARGETING_CONTENT.definitions as unknown as Def[];
const payloadOf = (key: string) => JSON.parse(JSON.stringify(defs.find((d) => d.canonicalKey === key)?.payload)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const revised = (key: string, edit: (p: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = payloadOf(key);
  edit(p);
  try {
    targetingFixture({ revise: { [key]: p } });
    return "accepted";
  } catch (e) {
    return String(e);
  }
};
const spellReq = (key: string, parameters: Record<string, unknown> = {}, stats: Record<string, number> = { PER: 4, PRO: 4 }) => targetingRequest(F, spellWith(F, `spell.targeting.${key}`, { parameters }), { stats });

describe("canonical Targeting catalogs (§19, §81, M5-I162–I164)", () => {
  it("the Spell catalog is exactly Self, Touch, Single Target, Multi-Target, Projectile, Line, Cone, Radius, Zone, Aura — no Trigger / Glyph", () => {
    expect(defs.filter((d) => d.definitionKind === "SPELL_TARGETING").map((d) => d.payload.semanticShape)).toEqual(["SELF", "TOUCH", "SINGLE_TARGET", "MULTI_TARGET", "PROJECTILE", "LINE", "CONE", "RADIUS", "ZONE", "AURA"]);
    expect(defs.map((d) => d.canonicalKey)).not.toEqual(expect.arrayContaining(["spell.targeting.trigger_based"]));
    for (const k of ["spell.targeting.trigger_based", "spell.targeting.glyph", "spell.targeting.anchor"]) expect(defs.some((d) => d.canonicalKey === k), k).toBe(false);
  });

  it("the Maneuver catalog is Self, Touch, Single Target, Multi-Target, Line, Cone, Radius, Chain, Zone — no Aura, no cost, no Save", () => {
    const m = defs.filter((d) => d.definitionKind === "MANEUVER_TARGETING");
    expect(m.map((d) => d.payload.semanticShape)).toEqual(["SELF", "TOUCH", "SINGLE_TARGET", "MULTI_TARGET", "LINE", "CONE", "RADIUS", "CHAIN", "ZONE"]);
    for (const d of m) expect([d.canonicalKey, d.payload.costContributions], d.canonicalKey).toEqual([d.canonicalKey, []]);
    expect(JSON.stringify(m)).not.toMatch(/save|attack|"AP"|damage/i);
  });

  it("both families are stored as EntityType TARGETING; the DefinitionKind keeps them apart (§111, M5-I162)", () => {
    expect([PROWESS_DEFINITION_KINDS.SPELL_TARGETING.entityTypes, PROWESS_DEFINITION_KINDS.MANEUVER_TARGETING.entityTypes]).toEqual([["TARGETING"], ["TARGETING"]]);
    expect([PROWESS_DEFINITION_KINDS.SPELL_TARGETING.branch, PROWESS_DEFINITION_KINDS.MANEUVER_TARGETING.branch]).toEqual(["SPELL", "MANEUVER"]);
  });

  it("vocabularies: PROJECTILE is a semantic shape; TRIGGERED / ANCHOR stay readable historically but are never base shapes; add-ons are TRIGGER / ANCHOR", () => {
    expect(TARGETING_SEMANTIC_SHAPES).toContain("PROJECTILE");
    expect(HISTORICAL_ADD_ON_SHAPES).toEqual(["TRIGGERED", "ANCHOR"]);
    expect(BASE_TARGETING_SHAPES).not.toEqual(expect.arrayContaining(["TRIGGERED"]));
    expect(BASE_TARGETING_SHAPES).not.toEqual(expect.arrayContaining(["ANCHOR"]));
    expect(TARGETING_ADD_ONS).toEqual(["TRIGGER", "ANCHOR"]);
    expect(TARGETING_RANGE_MODELS).toEqual(["SELF", "TOUCH", "DEFAULT_SPELL_RANGE", "FOUNDATION_RANGE", "FIXED", "EFFECT_DEFINED", "SPECIAL"]);
  });

  it("M5-I170 the superseded '+10 ft Radius / Zone / Aura → +3 MP' scaling is absent; Widen Area is not a Targeting option (Trait-owned)", () => {
    for (const k of ["spell.targeting.radius", "spell.targeting.zone", "spell.targeting.aura"]) {
      const p = payloadOf(k);
      expect(p.rules.targeting.parameters.map((x: { parameter: string }) => x.parameter), k).not.toEqual(expect.arrayContaining(["areaExtension"]));
      expect(JSON.stringify(p.costContributions), k).not.toMatch(/radius_extension|area_extension|widen/i);
      expect(p.rules.targeting.radiusCapable, k).toBe(true);
    }
    expect(payloadOf("spell.targeting.line").rules.targeting.radiusCapable).toBe(false);
  });

  it("the deferred register names exactly M5-SC-039 (Projectile base MP) and M5-SC-040 (Line width)", () => {
    expect(TARGETING_CONTENT.deferred.map((d) => [d.conflictKey, d.subject])).toEqual([["M5-SC-039", "spell.targeting.projectile"], ["M5-SC-040", "spell.targeting.line"]]);
  });
});

describe("`rules.targeting` sub-contract and typed cost contributions (§53–§54, §61, §108)", () => {
  it.each<[string, string, (p: Record<string, any>) => void, string]>([ // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a Save Stat on Spell Radius (§174)", "spell.targeting.radius", (p: Record<string, any>) => void (p.rules.targeting.saveStat = "AGI"), C.TARGETING_IMPLIES_OUTCOME], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an Attack Roll on Single Target (§175)", "spell.targeting.single_target", (p: Record<string, any>) => void (p.rules.targeting.attackRoll = { stat: "PER" }), C.TARGETING_IMPLIES_OUTCOME], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a Save Profile on Maneuver Radius (§185)", "maneuver.targeting.radius", (p: Record<string, any>) => void (p.rules.targeting.saveProfile = ["AGI", "PRO"]), C.TARGETING_IMPLIES_OUTCOME], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a +3 AP cost on Maneuver Radius (§186)", "maneuver.targeting.radius", (p: Record<string, any>) => void p.costContributions.push({ contributionKey: "targeting.conversion", currency: "AP", data: { kind: "BASE", amount: 3 } }), T.MANEUVER_TARGETING_COST], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a guessed Projectile base of 2 MP with no deferred conflict (§177)", "spell.targeting.projectile", (p: Record<string, any>) => void p.costContributions.push({ contributionKey: "targeting.base_guess", currency: "MP", data: { kind: "BASE", amount: 2 } }), T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a deferred measure with no conflict key", "spell.targeting.line", (p: Record<string, any>) => void delete p.rules.targeting.measures[1].conflictKey, T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["default Spell Range not reading BASE_RANGE", "spell.targeting.single_target", (p: Record<string, any>) => void (p.rules.targeting.range.formula = { expression: "15 * per", rounding: "NONE", unit: "ft", variables: [{ variable: "per", source: { kind: "STAT", stat: "PER" } }] }), T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a Formula reading an undeclared parameter", "spell.targeting.radius", (p: Record<string, any>) => void (p.rules.targeting.measures[0].formula = { expression: "5 * pro + radius_extension", rounding: "NONE", unit: "ft", variables: [{ variable: "pro", source: { kind: "STAT", stat: "PRO" } }, { variable: "radius_extension", source: { kind: "PARAMETER", parameter: "areaExtension" } }] }), T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["radiusCapable inferred without a RADIUS measure", "spell.targeting.cone", (p: Record<string, any>) => void (p.rules.targeting.radiusCapable = true), T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a Multi-Target minimum of 1", "spell.targeting.multi_target", (p: Record<string, any>) => void (p.rules.targeting.cardinality.minimum = 1), T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an invented default target count", "spell.targeting.multi_target", (p: Record<string, any>) => void (p.rules.targeting.parameters[0].default = 2), T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a Spell Targeting cost in ME", "spell.targeting.radius", (p: Record<string, any>) => void (p.costContributions[0].currency = "AP"), T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a Foundation range on a Spell", "spell.targeting.single_target", (p: Record<string, any>) => void (p.rules.targeting.range = { model: "FOUNDATION_RANGE" }), T.INVALID_TARGETING_RULES], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an executable TRIGGERED base Targeting (§178)", "spell.targeting.single_target", (p: Record<string, any>) => void (p.semanticShape = "TRIGGERED"), T.TARGETING_ADD_ON_AS_BASE], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an executable ANCHOR base Targeting (§179)", "spell.targeting.zone", (p: Record<string, any>) => void (p.semanticShape = "ANCHOR"), T.TARGETING_ADD_ON_AS_BASE], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])("refuses %s", (_label, key, edit, code) => {
    expect(revised(key, edit)).toContain(code);
  });

  it("the canonical catalog itself is accepted", () => {
    expect(revised("spell.targeting.radius", () => undefined)).toBe("accepted");
  });
});

describe("request validation (§51–§52, §125)", () => {
  it.each([
    ["an undeclared parameter (radius 5000)", () => spellReq("radius", { radius: 5000 }), T.UNDECLARED_TARGETING_PARAMETER],
    ["a fractional target count", () => spellReq("multi_target", { targetCount: 2.5 }), T.INVALID_TARGETING_PARAMETER],
    ["a negative range extension", () => spellReq("single_target", { rangeExtension: -1 }), T.INVALID_TARGETING_PARAMETER],
    ["a non-boolean flag", () => spellReq("zone", { mobile: "yes" }), T.INVALID_TARGETING_PARAMETER],
    ["an Aura source the Definition does not author", () => spellReq("aura", { sourceRef: "CREATURE" }), T.INVALID_TARGETING_PARAMETER],
    ["a missing PER", () => spellReq("single_target", {}, { PRO: 4 }), T.INVALID_TARGETING_CONTEXT],
    ["a WO1-era Targeting with no executable rule", () => targetingRequest(F, spellWith(F, "spell.targeting.legacy_single")), T.TARGETING_RULE_MISSING],
    ["a modifier naming the Targeting itself", () => ({ ...spellReq("radius"), targetingModifiers: [{ componentKey: "targeting", sourceKey: "spell.trait.x" }] }), T.INVALID_TARGETING_REQUEST],
  ])("%s is a malformed request, not an INVALID Targeting", (_label, build, code) => {
    expect(codes(compileAbilityTargeting(build()))).toContain(code);
  });

  it("an unknown Martial rank is refused; parameters never override a canonical Formula", () => {
    expect(codes(compileAbilityTargeting(targetingRequest(F, maneuverWith(F, "maneuver.targeting.radius"), { martial: "GRANDMASTER" })))).toContain(T.INVALID_TARGETING_CONTEXT);
    expect(codes(compileAbilityTargeting(spellReq("radius", { radius: 5000 })))).toEqual([T.UNDECLARED_TARGETING_PARAMETER]);
  });
});

describe("M4 primitives, Keywords, source map and provenance (§101–§107, §114, M5-I175–I176)", () => {
  it("geometry and range are M4 FORMULA steps over content programs; bounds are REQUIREMENTs; nothing else", () => {
    const r = runTargeting(spellReq("multi_target", { targetCount: 3 }));
    expect([...new Set(r.plan.evaluationPlan.steps.map((s) => s.operation))].sort()).toEqual(["FORMULA", "REQUIREMENT"]);
    const exprs = r.plan.evaluationPlan.steps.filter((s) => s.operation === "FORMULA").map((s) => (s.input.program as { expression: string }).expression);
    expect(exprs).toEqual(["15 * per", "base_range + range_extension * 15"]);
    const range = r.plan.evaluationPlan.steps.find((s) => s.stepKey === r.plan.outputs.range.stepKey);
    expect(range?.bindings).toEqual([{ target: "/variables/base_range", source: { kind: "STEP", stepKey: r.plan.outputs.range.baseRangeStepKey, pointer: "/data/finalValue" } }]);
  });

  it("Targeting Keywords are explicit content only, contributed through ONE M4 KEYWORD step with the exact Targeting source", () => {
    expect(runTargeting(spellReq("radius")).plan.outputs.keywordsStepKey).toBeNull(); // no Keyword inferred from geometry (§106)
    const p = payloadOf("spell.targeting.radius");
    p.keywords = ["keyword.area_effect"];
    const f = targetingFixture({ revise: { "spell.targeting.radius": p } });
    const r = runTargeting(targetingRequest(f, spellWith(f, "spell.targeting.radius")), f);
    expect(r.result.keywords.map((k) => k.canonicalKey)).toEqual(["keyword.area_effect"]);
    const step = r.plan.evaluationPlan.steps.find((s) => s.operation === "KEYWORD");
    expect(((step?.input.contributions as { source: { sourceId: string } }[])[0])?.source.sourceId).toBe(f.ref("spell.targeting.radius").entityVersionId);
  });

  it("each step cites its exact Definitions: range → the Targeting + BASE_RANGE; Maneuver radius → the Targeting + the Skill ladder", () => {
    const s = runTargeting(spellReq("radius"));
    const cite = (r: typeof s, suffix: string) => r.plan.sourceMap.entries.find((e) => e.stepKey.endsWith(suffix))?.definitions.map((d) => d.canonicalKey);
    expect(cite(s, ":range")).toEqual(["spell.targeting.radius", "core.derived.base_range"]);
    expect(cite(s, ":geometry.radius")).toEqual(["spell.targeting.radius"]);
    const m = runTargeting(targetingRequest(F, maneuverWith(F, "maneuver.targeting.radius"), { martial: "MASTER", stats: { STR: 4 } }));
    expect(cite(m, ":geometry.radius")).toEqual(["maneuver.targeting.radius", "core.rank_ladder.skill"]);
    expect(s.plan.sourceMap.entries).toHaveLength(s.plan.evaluationPlan.steps.length);
    expect(s.plan.rulesetProvenance.rulesetId).toBe(F.ruleset.rulesetId);
  });

  it("M5-I177 Targeting reports LISTED contributions only: no total, no final MP / AP, no payment", () => {
    const r = runTargeting(spellReq("zone", { rangeExtension: 1, mobile: true }));
    expect(r.result.cost.base).toEqual({ status: "LISTED", currency: "MP", amount: 8, contributionKey: "targeting.base" });
    expect(r.result.cost.scaling.map((s) => [s.contributionKey, s.selected])).toEqual([["targeting.mobile_zone", true], ["targeting.range_extension", 1]]);
    expect(JSON.stringify(r.result)).not.toMatch(/total|finalMp|finalAp|payment|spent/i);
  });

  it("evaluateAbilityTargeting = compile + M4 + read; a foreign run is refused", () => {
    const one = evaluateAbilityTargeting(spellReq("radius"));
    expect(one.ok && one.value.status).toBe("VALID");
    const a = runTargeting(spellReq("radius"));
    const b = runTargeting(spellReq("cone"));
    expect(codes(readAbilityTargetingRun({ plan: a.plan, run: b.run }))).toEqual([T.INCOMPLETE_RUN]);
  });
});

describe("exact Ruleset, history and isolation (§112–§116, §190–§191)", () => {
  const r2Payload = () => {
    const p = payloadOf("spell.targeting.radius");
    p.rules.targeting.measures[0].formula.expression = "10 * pro"; // R2 test-only geometry
    return p;
  };
  it("a bundle of another Ruleset is refused — Rulesets never mix", () => {
    const other = targetingFixture({ rulesetId: TARGETING_RULESET_2, manifestId: TARGETING_MANIFEST_2 });
    expect(codes(compileAbilityTargeting({ ...spellReq("radius"), ruleset: other.ruleset }))).not.toEqual([]);
  });

  it("§190 R1 re-evaluates identically (result and provenance) after R2 changes the Radius test geometry", () => {
    const r1 = runTargeting(spellReq("radius"));
    const f2 = targetingFixture({ rulesetId: TARGETING_RULESET_2, manifestId: TARGETING_MANIFEST_2, revise: { "spell.targeting.radius": r2Payload() } });
    const r2 = runTargeting(targetingRequest(f2, spellWith(f2, "spell.targeting.radius"), { stats: { PER: 4, PRO: 4 } }), f2);
    expect([measureOf(r1, "RADIUS")?.value, measureOf(r2, "RADIUS")?.value]).toEqual([20, 40]);
    const again = runTargeting(spellReq("radius"));
    expect([again.plan, again.result]).toEqual([r1.plan, r1.result]);
  });

  it("§191 R1 and R2 evaluated interleaved never cross-contaminate range, area, cost or provenance", () => {
    const f2 = targetingFixture({ rulesetId: TARGETING_RULESET_2, manifestId: TARGETING_MANIFEST_2, revise: { "spell.targeting.radius": r2Payload() } });
    const out = [F, f2, F, f2].map((f) => {
      const r = runTargeting(targetingRequest(f, spellWith(f, "spell.targeting.radius"), { stats: { PER: 4, PRO: 4 } }), f);
      return [measureOf(r, "RADIUS")?.value, r.result.range.value, r.result.targeting.definition.entityVersionId === f.ref("spell.targeting.radius").entityVersionId];
    });
    expect(out).toEqual([[20, 60, true], [40, 60, true], [20, 60, true], [40, 60, true]]);
  });
});

describe("plain-data safety, immutability, serialization, determinism (§125–§128, M5-I178)", () => {
  it.each([
    ["a getter", () => {
      const req = spellReq("radius");
      Object.defineProperty(req.character as object, "stats", { get: () => ({}), enumerable: true });
      return req;
    }],
    ["a cycle", () => {
      const req = spellReq("radius") as Record<string, unknown>;
      const loop: Record<string, unknown> = {};
      loop.self = loop;
      req.targetingModifiers = [loop];
      return req;
    }],
    ["NaN", () => spellReq("single_target", { rangeExtension: Number.NaN })],
    ["Infinity", () => spellReq("multi_target", { targetCount: Number.POSITIVE_INFINITY })],
    ["an unsafe __proto__ key", () => JSON.parse(JSON.stringify(spellReq("radius")).replace('"stats":{', '"stats":{"__proto__":{"polluted":1},')) as Record<string, unknown>],
    ["a function", () => ({ ...spellReq("radius"), targetingModifiers: () => [] })],
  ])("%s is refused safely", (_label, build) => {
    expect(compileAbilityTargeting(build()).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("inputs are never mutated; outputs are frozen", () => {
    const req = spellReq("multi_target", { targetCount: 4, rangeExtension: 1 });
    const before = JSON.stringify(req);
    const out = evaluateAbilityTargeting(req);
    expect(JSON.stringify(req)).toBe(before);
    expect(out.ok && Object.isFrozen(out.value) && Object.isFrozen(out.value.geometry)).toBe(true);
  });

  it("plans and results survive JSON round-trips; equal requests give deep-equal plans, runs, results and source maps", () => {
    const run = () => runTargeting(targetingRequest(F, maneuverWith(F, "maneuver.targeting.radius", { parameters: { originMode: "RANGED_IMPACT" } }), { martial: "EXPERT", stats: { STR: 6 } }));
    const a = run();
    const b = run();
    expect([a.plan, a.run, a.result]).toEqual([b.plan, b.run, b.result]);
    expect(JSON.parse(JSON.stringify(a.result))).toEqual(a.result);
    const replay = orchestrateRulesEvaluation({ evaluationKey: "m5-wo6.test", contexts: { ruleset: F.ruleset }, plan: JSON.parse(JSON.stringify(a.plan.evaluationPlan)) });
    expect(replay.data).toEqual(a.run);
  });
});
