import { orchestrateRulesEvaluation } from "@prowess/rules";
import { describe, expect, it } from "vitest";
import { compileAbilityConstruction, evaluateAbilityConstruction, readAbilityConstructionRun } from "./construction/legality.js";
import { validateAbilityComposition } from "./construction/composition.js";
import { readComponentConstructionRules } from "./definition/ability-construction-payload.js";
import { COMPOSITION_ERROR_CODES as M, CONSTRUCTION_ERROR_CODES as K, DEFINITION_ERROR_CODES as C } from "./definition/codes.js";
import { Problems } from "./internal/problems.js";
import { CONSTRUCTION_PREREQUISITE_KINDS, CONSTRUCTION_SKILL_TRACKS, STACK_LIMIT_KINDS } from "./vocabulary/ability-construction.js";
import { PROWESS_DEFINITION_KINDS } from "./vocabulary/families.js";
import { codes } from "./testing/core-run.js";
import {
  CONSTRUCTION_CONTENT,
  CONSTRUCTION_MANIFEST_2,
  CONSTRUCTION_RULE_PAYLOAD,
  CONSTRUCTION_RULESET_2,
  constructionFixture,
  maneuverOf,
  requestOf,
  spellOf,
} from "./testing/construction-fixtures.js";
import { runConstruction } from "./testing/construction-run.js";

/**
 * M5-WO5 contracts (PAS-10 M5-WO5 §17–§24, §36–§44, §90–§131, §164–§169): canonical construction content, the
 * construction-rule and component sub-contract payloads, request validation, M4 primitives only, source mapping, exact
 * Ruleset history and isolation, plain-data safety, immutability, serialization and determinism.
 * Guard index (docs/architecture/m5-invariants.json): M5-I156 · M5-I157 · M5-I158.
 */
const F = constructionFixture();
const rule = () => JSON.parse(JSON.stringify(CONSTRUCTION_RULE_PAYLOAD)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const compile = (req: Record<string, unknown>) => compileAbilityConstruction(req);

describe("canonical construction content (§9, §13, §120–§127)", () => {
  it("one ABILITY_CONSTRUCTION_RULE, family ABILITY, version 1, reading the SKILL ladder", () => {
    expect(CONSTRUCTION_CONTENT.definitions.map((d) => [d.canonicalKey, d.definitionKind])).toEqual([["construction.ability_rules", "ABILITY_CONSTRUCTION_RULE"]]);
    expect(PROWESS_DEFINITION_KINDS.ABILITY_CONSTRUCTION_RULE).toEqual({ family: "ABILITY", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(rule().rankLadder).toBe("SKILL");
  });

  it("M5-I156 Arcane Authority: Arcana Skill rank, TRAINED minimum, 0 / 1 / 2 / 3 Effects and base Traits", () => {
    const a = rule().spell.arcaneAuthority;
    expect([a.skillKey, a.minimumRank]).toEqual(["skill.arcana", "TRAINED"]);
    expect(a.ranks.map((r: Record<string, unknown>) => [r.rankKey, r.effectCapacity, r.traitCapacity])).toEqual([["UNTRAINED", 0, 0], ["TRAINED", 1, 1], ["EXPERT", 2, 2], ["MASTER", 3, 3]]);
    expect(rule().spell.affinityAuthority).toEqual({ capacitySource: "AFFINITY_RANK_RULE" }); // §122: reused, not duplicated
  });

  it("M5-I157 Casting Condition capacity: source ARCANE_RANK, UNTRAINED 0 · TRAINED 1 · EXPERT 2 · MASTER 3", () => {
    const c = rule().spell.castingConditions;
    expect(c.capacitySource).toBe("ARCANE_RANK");
    expect(c.ranks.map((r: Record<string, unknown>) => [r.rankKey, r.capacity])).toEqual([["UNTRAINED", 0], ["TRAINED", 1], ["EXPERT", 2], ["MASTER", 3]]);
  });

  it("the Spell Trait exchange is 1 : 1 and keeps 1 Effect; a Spell needs 1 Effect", () => {
    expect(rule().spell.traitExchange).toEqual({ effectSlotsPerExchange: 1, traitSlotsPerExchange: 1, minimumEffectsRemaining: 1 });
    expect(rule().spell.minimumEffects).toBe(1);
  });

  it("M5-I158 Martial: Martial Skill rank, TRAINED minimum, Rank Value and Effects / Traits / Conditions 0 / 1 / 2 / 3; no Maneuver exchange; Foundation and 1 Effect required", () => {
    const m = rule().maneuver;
    expect([m.martial.skillKey, m.martial.minimumRank, m.traitExchange, m.minimumEffects, m.foundationRequired]).toEqual(["skill.martial", "TRAINED", null, 1, true]);
    expect(m.martial.ranks.map((r: Record<string, unknown>) => [r.rankKey, r.martialRankValue, r.effectCapacity, r.traitCapacity, r.conditionCapacity])).toEqual([
      ["UNTRAINED", 0, 0, 0, 0],
      ["TRAINED", 1, 1, 1, 1],
      ["EXPERT", 2, 2, 2, 2],
      ["MASTER", 3, 3, 3, 3],
    ]);
  });

  it("Signature policy: capacity = SIGNATURE_ABILITY_SLOTS, default 1 slot, exempt 0, no exemption authored yet", () => {
    expect(rule().signature).toEqual({ capacityStatistic: "SIGNATURE_ABILITY_SLOTS", defaultSlotCost: 1, exemptSlotCost: 0, exemptions: [] });
  });

  it("vocabularies are classifications only", () => {
    expect(CONSTRUCTION_SKILL_TRACKS).toEqual(["ARCANE", "MARTIAL"]);
    expect(CONSTRUCTION_PREREQUISITE_KINDS).toEqual(["SKILL_RANK_AT_LEAST", "AFFINITY_RANK_AT_LEAST"]);
    expect(STACK_LIMIT_KINDS).toEqual(["FIXED", "TRACK_RANK_VALUE"]);
  });
});

describe("construction-rule payload validation (§120–§127)", () => {
  const withRule = (payload: unknown) => {
    try {
      return constructionFixture({ revise: { "construction.ability_rules": payload as Record<string, unknown> } });
    } catch (e) {
      return String(e);
    }
  };
  it.each([
    ["a negative capacity", (r: Record<string, any>) => void (r.spell.arcaneAuthority.ranks[1].effectCapacity = -1)], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a fractional capacity", (r: Record<string, any>) => void (r.maneuver.martial.ranks[2].effectCapacity = 1.5)], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a duplicated rank row", (r: Record<string, any>) => void r.spell.castingConditions.ranks.push({ rankKey: "MASTER", capacity: 3 })], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a Casting Condition source other than ARCANE_RANK", (r: Record<string, any>) => void (r.spell.castingConditions.capacitySource = "AFFINITY_RANK")], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a second Affinity capacity table", (r: Record<string, any>) => void (r.spell.affinityAuthority = { capacitySource: "AFFINITY_RANK_RULE", ranks: [] })], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an exchange that gives up no Effect slot", (r: Record<string, any>) => void (r.spell.traitExchange.effectSlotsPerExchange = 0)], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an anonymous exemption", (r: Record<string, any>) => void r.signature.exemptions.push({ exemptionKey: "FREE" })], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an unknown field", (r: Record<string, any>) => void (r.spell.arcaneRankTrack = "MASTER")], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a missing construction Formula", (r: Record<string, any>) => void delete r.formulas.signatureAvailable], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])("refuses %s as INVALID_PAYLOAD", (_label, mutate) => {
    const r = rule();
    mutate(r);
    expect(withRule(r)).toContain(C.INVALID_PAYLOAD);
  });

  it.each([
    ["a Formula reading an input its slot does not supply (a Stat)", (r: Record<string, any>) => void (r.formulas.remainingEffects = { expression: "base_effects + pro", rounding: "NONE", variables: ["base_effects", "pro"] })], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an undeclared Formula variable", (r: Record<string, any>) => void (r.formulas.effectiveTraits.variables = ["base_traits"])], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an invalid M4 Formula program", (r: Record<string, any>) => void (r.formulas.signatureProjected.expression = "used_slots +")], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])("M5-I050 construction arithmetic is authored content, validated by M4: refuses %s as INVALID_FORMULA", (_label, mutate) => {
    const r = rule();
    mutate(r);
    expect(withRule(r)).toContain(C.INVALID_FORMULA);
  });

  it("every construction Formula program is authored in the rule (code names inputs only)", () => {
    expect(Object.keys(rule().formulas)).toEqual(["remainingEffects", "effectiveTraits", "maximumTrades", "signatureProjected", "signatureAvailable"]);
    expect(rule().formulas.maximumTrades.minimum).toBe(0);
  });

  it("a rank table that omits a ladder rank fails closed at compile time (no implicit zero row)", () => {
    const r = rule();
    r.spell.arcaneAuthority.ranks = r.spell.arcaneAuthority.ranks.filter((x: { rankKey: string }) => x.rankKey !== "UNTRAINED");
    const f = constructionFixture({ revise: { "construction.ability_rules": r } });
    expect(codes(compile(requestOf(f, spellOf(f), { arcana: "TRAINED" })))).toEqual([K.CONSTRUCTION_RULE_UNRESOLVED]);
  });

  it("a bundle without exactly one construction rule is MISSING_CONSTRUCTION_DEFINITION", () => {
    const f = constructionFixture({ omit: ["construction.ability_rules"] });
    expect(codes(compile(requestOf(f, spellOf(f), { arcana: "TRAINED" })))).toEqual([K.MISSING_CONSTRUCTION_DEFINITION]);
  });
});

describe("component `rules.construction` sub-contract (§36–§39, §52–§56, §128–§129)", () => {
  const read = (construction: unknown) => {
    const p = new Problems();
    const out = readComponentConstructionRules({ construction } as never, ["rules"], p);
    return out === null ? p.list.map((x) => x.code) : out;
  };
  it("absent → no prerequisites, not stackable, no Affinity access", () => {
    expect(readComponentConstructionRules({}, ["rules"], new Problems())).toEqual({ prerequisites: [], stacking: { stackable: false }, affinityAccess: [] });
  });
  it.each([
    ["a stackable Effect without an explicit limit (no default)", { stacking: { stackable: true } }],
    ["a stack limit below 1", { stacking: { stackable: true, limit: { kind: "FIXED", maximum: 0 } } }],
    ["an unknown stack-limit source", { stacking: { stackable: true, limit: { kind: "RANK_VALUE" } } }],
    ["a limit on a non-stackable Effect", { stacking: { stackable: false, limit: { kind: "FIXED", maximum: 2 } } }],
    ["a prose prerequisite", { prerequisites: [{ prerequisiteKey: "LORE", kind: "TEXT", text: "Requires expert magical knowledge" }] }],
    ["a prerequisite without a key", { prerequisites: [{ kind: "SKILL_RANK_AT_LEAST", skillKey: "skill.arcana", minimumRank: "EXPERT" }] }],
    ["an Affinity access that is not an AFFINITY reference", { affinityAccess: ["affinity.evocation"] }],
  ])("refuses %s", (_label, construction) => {
    expect(read(construction)).toEqual(expect.arrayContaining([K.INVALID_COMPONENT_CONSTRUCTION_RULES]));
  });

  it("a stack limit read from the Arcane track is unresolved: the rule authors no Arcane Rank Value (nothing guessed)", () => {
    expect(codes(compile(requestOf(F, spellOf(F, { effects: [{ c: "arcaneStack", stacks: 1 }] }), { arcana: "MASTER" })))).toEqual([K.CONSTRUCTION_RULE_UNRESOLVED]);
  });
});

describe("request validation (§21, §41, §61, §113, §129)", () => {
  it.each([
    ["a Spell with no Authority", () => requestOf(F, spellOf(F, { authority: null }), { arcana: "MASTER" }), K.AUTHORITY_REQUIRED],
    ["an unknown Authority token", () => requestOf(F, { ...spellOf(F), authority: { authority: "HIGHEST_RANK" } }, { arcana: "MASTER" }), K.AUTHORITY_REQUIRED],
    ["Affinity Authority without a governing Affinity", () => requestOf(F, spellOf(F, { authority: "AFFINITY_AUTHORITY" }), { arcana: "MASTER" }), K.AUTHORITY_REQUIRED],
    ["a Maneuver carrying a Spell Authority", () => requestOf(F, maneuverOf(F, { authority: "AFFINITY_AUTHORITY" }), { martial: "MASTER" }), K.AUTHORITY_NOT_APPLICABLE],
    ["a negative trade count", () => requestOf(F, spellOf(F), { arcana: "MASTER" }, { trades: -1 }), K.INVALID_CONSTRUCTION_REQUEST],
    ["a fractional trade count", () => requestOf(F, spellOf(F), { arcana: "MASTER" }, { trades: 1.5 }), K.INVALID_CONSTRUCTION_REQUEST],
    ["0 stacks", () => requestOf(F, spellOf(F, { effects: [{ c: "stackable3", stacks: 0 }] }), { arcana: "MASTER" }), K.INVALID_CONSTRUCTION_REQUEST],
    ["1.5 stacks", () => requestOf(F, spellOf(F, { effects: [{ c: "stackable3", stacks: 1.5 }] }), { arcana: "MASTER" }), K.INVALID_CONSTRUCTION_REQUEST],
    ["a negative used-slot count", () => requestOf(F, spellOf(F), { arcana: "MASTER" }, { usedSlots: -1 }), K.INVALID_CONSTRUCTION_REQUEST],
    ["an anonymous free slot use", () => requestOf(F, spellOf(F), { arcana: "MASTER" }, { candidate: { slotUse: "FREE" } }), K.INVALID_CONSTRUCTION_REQUEST],
    ["an isFree flag", () => requestOf(F, spellOf(F), { arcana: "MASTER" }, { candidate: { slotUse: "DEFAULT", isFree: true } }), K.INVALID_CONSTRUCTION_REQUEST],
  ])("%s is a malformed request, not an INVALID construction", (_label, build, code) => {
    expect(codes(compile(build()))).toContain(code);
  });

  it("§43–§44 Arcane / Martial Rank have ONE source: the Skill ranks — a separate arcaneRank / martialRank field is refused", () => {
    for (const field of ["arcaneRank", "martialRank"]) {
      const req = requestOf(F, spellOf(F), { arcana: "TRAINED" });
      (req.character as Record<string, unknown>)[field] = "MASTER";
      expect(codes(compile(req)), field).toContain(K.INVALID_CONSTRUCTION_CONTEXT);
    }
  });

  it("an unknown Skill rank and a twice-listed Skill are refused", () => {
    const req = requestOf(F, spellOf(F), { arcana: "TRAINED" });
    (req.character as { skillRanks: unknown[] }).skillRanks.push({ skillKey: "skill.arcana", rankKey: "MASTER" });
    expect(codes(compile(req))).toContain(K.INVALID_CONSTRUCTION_CONTEXT);
    expect(codes(compile(requestOf(F, spellOf(F), { arcana: "GRANDMASTER" })))).toContain(K.INVALID_CONSTRUCTION_CONTEXT);
  });

  it("§90 WO1 structure stays WO1's: a SPELL_EFFECT in a Maneuver slot is CROSS_BRANCH_DEFINITION; validateAbilityComposition never checks legality", () => {
    const m = maneuverOf(F);
    (m.effects as Record<string, unknown>[])[0] = { componentKey: "effect1", order: 10, definition: F.ref("spell.effect.direct_damage"), parameters: {} };
    expect(codes(compile(requestOf(F, m, { martial: "MASTER" })))).toContain(M.CROSS_BRANCH_DEFINITION);
    expect(validateAbilityComposition(spellOf(F, { effects: ["directDamage", "directDamage", "directDamage", "directDamage"] }), { bundle: F.bundle }).ok).toBe(true);
  });

  it("§16 a Maneuver Foundation is an exact MANEUVER_FOUNDATION Definition (structural v1 contract; no formula, no cost)", () => {
    expect(PROWESS_DEFINITION_KINDS.MANEUVER_FOUNDATION.schemaVersions).toEqual([1]);
    expect(F.bundle.definitions.find((d) => d.canonicalKey === "maneuver.foundation.weapon_attack")?.payload).toEqual(expect.objectContaining({ foundationKind: "WEAPON_ATTACK" }));
  });
});

describe("M4 primitives, source map and provenance (§40, §96–§97, §110, §166)", () => {
  it("every check is an M4 FORMULA / REQUIREMENT / KEYWORD step; capacity, trade and Signature arithmetic are Formulas", () => {
    const r = runConstruction(spellOf(F, { authority: "AFFINITY_AUTHORITY", affinity: "affinity.evocation", effects: ["evocationExpert"], traits: [{ trait: "focusTrait", appliesTo: "effect1" }] }), { arcana: "TRAINED", affinities: [["affinity.evocation", "EXPERT"]] }, { trades: 0 });
    expect([...new Set(r.plan.evaluationPlan.steps.map((s) => s.operation))].sort()).toEqual(["FORMULA", "KEYWORD", "REQUIREMENT"]);
    const formulas = r.plan.evaluationPlan.steps.filter((s) => s.operation === "FORMULA").map((s) => (s.input.program as { expression: string }).expression);
    expect(formulas).toEqual(expect.arrayContaining(["base_effects - trades * effect_slots_per_exchange", "base_traits + trades * trait_slots_per_exchange", "floor((base_effects - minimum_effects_remaining) / effect_slots_per_exchange)", "pro", "used_slots + candidate_slots", "capacity - projected"]));
    // Capacity comparisons read M4's Formula results through bindings — the compiler never pre-computes them.
    const effects = r.plan.evaluationPlan.steps.find((s) => s.stepKey.endsWith(":capacity.effects"));
    expect(effects?.bindings).toEqual([{ target: "/requirement/expected", source: { kind: "STEP", stepKey: r.plan.outputs.capacity.remainingEffectsStep, pointer: "/data/finalValue" } }]);
    const sig = r.plan.evaluationPlan.steps.find((s) => s.stepKey.endsWith(":signature.capacity"));
    expect(sig?.bindings.map((b) => b.target)).toEqual(["/requirement/expected", "/facts/numeric/0/value"]);
  });

  it("§110 each step cites its exact Definitions: access → construction rule + Skill ladder; Signature → the WO2 statistic; prerequisite → the component", () => {
    const r = runConstruction(spellOf(F, { effects: ["expertArcana"] }), { arcana: "EXPERT" });
    const cited = (suffix: string) => r.plan.sourceMap.entries.find((e) => e.stepKey.endsWith(suffix))?.definitions.map((d) => d.canonicalKey);
    expect(cited(":access")).toEqual(["construction.ability_rules", "core.rank_ladder.skill"]);
    expect(cited(":signature.capacity_formula")).toEqual(["core.derived.signature_ability_slots"]);
    expect(cited(":prerequisite.effect1.arcana_expert")).toEqual(["spell.effect.expert_lore", "core.rank_ladder.skill"]);
    expect(r.plan.sourceMap.entries).toHaveLength(r.plan.evaluationPlan.steps.length);
    expect(r.plan.rulesetProvenance.rulesetId).toBe(F.ruleset.rulesetId);
  });

  it("Affinity Authority capacity cites the WO4 AFFINITY_RANK_RULE (reused, never duplicated)", () => {
    const r = runConstruction(spellOf(F, { authority: "AFFINITY_AUTHORITY", affinity: "affinity.evocation" }), { affinities: [["affinity.evocation", "TRAINED"]] });
    expect(r.plan.sourceMap.entries.find((e) => e.stepKey.endsWith(":capacity.effects"))?.definitions.map((d) => d.canonicalKey)).toEqual(["construction.ability_rules", "affinity.rank_rule"]);
  });

  it("evaluateAbilityConstruction = compile + M4 + read; readAbilityConstructionRun refuses another plan's run", () => {
    const req = requestOf(F, spellOf(F), { arcana: "TRAINED" });
    const once = evaluateAbilityConstruction(req);
    expect(once.ok && once.value.status).toBe("VALID");
    const a = runConstruction(spellOf(F), { arcana: "TRAINED" });
    const b = runConstruction(maneuverOf(F), { martial: "TRAINED" });
    expect(codes(readAbilityConstructionRun({ plan: a.plan, run: b.run }))).toEqual([K.INCOMPLETE_RUN]);
  });
});

describe("exact Ruleset, history and isolation (§106–§109, §168–§169)", () => {
  const changed = () => {
    const r = rule();
    r.spell.arcaneAuthority.ranks[2].effectCapacity = 1; // R2 test value: Arcane Expert → 1 Effect
    return r;
  };
  it("a bundle of another Ruleset is refused (BUNDLE_RULESET_MISMATCH) — Rulesets never mix", () => {
    const other = constructionFixture({ rulesetId: CONSTRUCTION_RULESET_2, manifestId: CONSTRUCTION_MANIFEST_2 });
    expect(codes(compile({ ...requestOf(F, spellOf(F), { arcana: "TRAINED" }), ruleset: other.ruleset }))).not.toEqual([]);
  });

  it("§168 R1 re-evaluates identically after R2 changes the Arcane Expert capacity", () => {
    const spell = (f: ReturnType<typeof constructionFixture>) => spellOf(f, { effects: ["directDamage", "directDamage"] });
    const r1 = runConstruction(spell(F), { arcana: "EXPERT" });
    const f2 = constructionFixture({ rulesetId: CONSTRUCTION_RULESET_2, manifestId: CONSTRUCTION_MANIFEST_2, revise: { "construction.ability_rules": changed() } });
    const r2 = runConstruction(spell(f2), { arcana: "EXPERT" }, {}, f2);
    expect([r1.result.status, r2.result.status]).toEqual(["VALID", "INVALID"]);
    const again = runConstruction(spell(F), { arcana: "EXPERT" });
    expect([again.plan, again.result]).toEqual([r1.plan, r1.result]);
  });

  it("§169 R1 and R2 evaluated interleaved never cross-contaminate", () => {
    const f2 = constructionFixture({ rulesetId: CONSTRUCTION_RULESET_2, manifestId: CONSTRUCTION_MANIFEST_2, revise: { "construction.ability_rules": changed() } });
    const out = [F, f2, F, f2].map((f) => runConstruction(spellOf(f, { effects: ["directDamage", "directDamage"] }), { arcana: "EXPERT" }, {}, f).result.capacity.effects.remaining);
    expect(out).toEqual([2, 1, 2, 1]);
  });
});

describe("plain-data safety, immutability, serialization, determinism (§111–§115, §163)", () => {
  it.each([
    ["a getter", () => {
      const req = requestOf(F, spellOf(F), { arcana: "TRAINED" });
      Object.defineProperty(req.character as object, "skillRanks", { get: () => [], enumerable: true });
      return req;
    }],
    ["a cycle", () => {
      const req = requestOf(F, spellOf(F), { arcana: "TRAINED" });
      (req.options as unknown) = {};
      (req.options as Record<string, unknown>).self = req.options;
      return req;
    }],
    ["NaN", () => requestOf(F, spellOf(F), { arcana: "TRAINED" }, { usedSlots: Number.NaN })],
    ["Infinity", () => requestOf(F, spellOf(F), { arcana: "TRAINED" }, { trades: Number.POSITIVE_INFINITY })],
    ["an unsafe __proto__ key", () => JSON.parse(JSON.stringify(requestOf(F, spellOf(F), { arcana: "TRAINED" })).replace('"stats":{', '"stats":{"__proto__":{"polluted":1},')) as Record<string, unknown>],
    ["a function", () => ({ ...requestOf(F, spellOf(F), { arcana: "TRAINED" }), options: { effectSlotsTradedForTraits: () => 1 } })],
  ])("%s is refused safely, without invoking or retaining it", (_label, build) => {
    const out = compile(build() as Record<string, unknown>);
    expect(out.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("inputs are never mutated; outputs are frozen", () => {
    const req = requestOf(F, spellOf(F, { traits: [{ trait: "focusTrait", appliesTo: "effect1" }] }), { arcana: "EXPERT", affinities: [["affinity.evocation", "MASTER"]] }, { trades: 1, usedSlots: 1 });
    const before = JSON.stringify(req);
    const out = evaluateAbilityConstruction(req);
    expect(JSON.stringify(req)).toBe(before);
    expect(out.ok && Object.isFrozen(out.value) && Object.isFrozen(out.value.rules)).toBe(true);
  });

  it("plans and results survive JSON round-trips; equal requests give deep-equal plans, runs and results", () => {
    const run = () => runConstruction(spellOf(F, { authority: "AFFINITY_AUTHORITY", affinity: "affinity.evocation", effects: ["directDamage", "healing"] }), { arcana: "TRAINED", affinities: [["affinity.evocation", "MASTER"]] }, { usedSlots: 2 });
    const a = run();
    const b = run();
    expect([a.plan, a.run, a.result]).toEqual([b.plan, b.run, b.result]);
    expect(JSON.parse(JSON.stringify(a.result))).toEqual(a.result);
    const replay = orchestrateRulesEvaluation({ evaluationKey: "m5-wo5.test", contexts: { ruleset: F.ruleset }, plan: JSON.parse(JSON.stringify(a.plan.evaluationPlan)) });
    expect(replay.data).toEqual(a.run);
  });
});
