import { describe, expect, it, vi } from "vitest";
import { compileAbilityDefinition, evaluateAbilityDefinition } from "./ability/compile.js";
import { durationConditionFixture, fixtureRequestWith, copy, setPath, WO9_REFERENCE_KEYS as K } from "./testing/duration-condition-fixtures.js";
import { effectCharacter } from "./testing/effect-fixtures.js";
vi.setConfig({ testTimeout: 60_000 });
const f = durationConditionFixture(), key = K[1]!, maneuver = K[8]!;
const req = (path: string, value: unknown, name = key) => fixtureRequestWith(f, name, path, value);
const component = (canonicalKey: string, path: string, value: unknown, name = key) => {
  const r = copy(f.request(name)); setPath(r.definitions.definitions.find(d => d.canonicalKey === canonicalKey)!.payload, path, value); return r;
};
const onlyCondition = (canonicalKey: string, parameters = {}, name = key) => req("composition/conditions", [{ componentKey: "condition1", order: 1, definition: f.ref(canonicalKey), parameters }], name);
const relevance = (restriction: string, fact: string) => {
  const r = component("spell.casting_condition.verbal", "restriction/restrictionKey", restriction, K[0]!);
  const d = r.definitions.definitions.find(d => d.canonicalKey === "spell.casting_condition.verbal")!;
  setPath(d.payload, "rules/condition/applicability", { kind: "NUMERIC_COMPARE", factKey: fact, operator: ">=", expected: 1 });
  setPath(r.definitions.definitions.find(d => d.canonicalKey === K[0])!.payload, "composition/conditions", [{ componentKey: "condition1", order: 1, definition: f.ref("spell.casting_condition.verbal"), parameters: {} }]);
  return r;
};
const cases: readonly (readonly [string, () => unknown])[] = [
  ["01 missing Spell Duration", () => req("composition/duration", null)],
  ["02 multiple base Durations", () => req("composition/duration", [{ definition: f.ref("spell.duration.instant") }, { definition: f.ref("spell.duration.rounds") }])],
  ["03 Spell using Maneuver Duration", () => req("composition/duration/definition", f.ref("maneuver.duration.instant"))],
  ["04 Maneuver using Spell Duration", () => req("composition/duration/definition", f.ref("spell.duration.instant"), maneuver)],
  ["05 cross-Ruleset Duration", () => ({ ...f.request(), definitions: durationConditionFixture({ manifestId: "00000000-0000-4000-8000-000000009911" }).bundle })],
  ["06 stale Duration Version", () => req("composition/duration/definition/entityVersionId", "00000000-0000-4000-8000-000000009911")],
  ...([0, -1, 1.5, "3", null] as const).map((v, i) => [`${i + 7} invalid ROUNDS ${v}`, () => req("composition/duration/parameters", { rounds: v }, K[2]!)] as const),
  ["12 unknown Duration parameter", () => req("composition/duration/parameters", { rounds: 2, execute: true }, K[2]!)],
  ["13 incompatible Effect Duration", () => req("composition/duration", { componentKey: "duration", definition: f.ref("spell.duration.rounds"), parameters: { rounds: 3 } })],
  ["14 illegal Trait Duration mutation", () => { const r = req("composition/traits", [{ componentKey: "t", order: 1, definition: f.ref("fixture.trait.spell"), parameters: {}, appliesTo: { scope: "DURATION", componentKey: "duration" } }]); setPath(r.definitions.definitions.find(d => d.canonicalKey === "fixture.trait.spell")!.payload, "rules/trait/modifications", [{ kind: "DURATION", mode: "PERMANENT_BY_SPECIAL_RULE" }]); return r; }],
  ["15 Sustain execution", () => component("spell.duration.sustained", "rules/executeSustain", true, K[6]!)],
  ["16 Mana Lock resource mutation", () => component("spell.duration.instant", "rules/reserveMp", 100)],
  ["17 Casting Condition wrong branch", () => onlyCondition("maneuver.condition.no_counter_action", { benefit: "AP" })],
  ["18 unknown Casting Condition", () => req("composition/conditions/0/definition/canonicalKey", "unknown.condition.x")],
  ["19 stale Casting Condition", () => req("composition/conditions/0/definition/entityVersionId", "00000000-0000-4000-8000-000000009912")],
  ["20 invalid Casting parameter", () => onlyCondition("spell.casting_condition.charge", { extraAp: -1 })],
  ["21 Attack requirement without Attack", () => f.request(K[4]!)],
  ["22 Save requirement without Save", () => relevance("SAVE_RESTRICTION", "mechanic.save")],
  ["23 AoE requirement on single target", () => relevance("AREA_RESTRICTION", "mechanic.area")],
  ["24 Sustain requirement without Sustained", () => relevance("SUSTAIN_RESTRICTION", "mechanic.sustained")],
  ["25 Casting Condition slot capacity exceeded", () => ({ ...f.request(), character: effectCharacter({ arcana: "TRAINED" }) })],
  ["26 bypass 30 percent maximum", () => component("construction.ability_rules", "conditionPolicy/spellMpPercentMaximum", 100)],
  ["27 reintroduce rank cap table", () => component("construction.ability_rules", "conditionPolicy/rankCaps", { TRAINED: 20, EXPERT: 30, MASTER: 40 })],
  ["28 final Spell MP", () => req("finalMp", 10)],
  ["29 final Spell AP", () => req("finalAp", 1)],
  ["30 Maneuver Condition wrong branch", () => onlyCondition("spell.casting_condition.verbal", {}, maneuver)],
  ["31 Maneuver slot capacity exceeded", () => ({ ...f.request(K[9]!), character: effectCharacter({ martial: "TRAINED" }) })],
  ["32 Maneuver AP reduction over three", () => f.request(K[9]!)],
  ["33 AP and MP chosen together", () => onlyCondition("maneuver.condition.no_counter_action", { benefit: ["AP", "MP"] }, maneuver)],
  ["34 arbitrary GM-set reduction", () => onlyCondition("spell.casting_condition.focus", { discount: 90 })],
  ["35 final Maneuver cost", () => req("finalCost", 1, maneuver)],
  ["36 Condition applies Status", () => component("spell.casting_condition.verbal", "restriction/data/appliesStatus", "STUNNED")],
  ["37 latest Duration selector", () => req("composition/duration/definition", { latestDuration: "spell.duration.instant" })],
  ["38 cross-Ruleset component mixing", () => ({ ...f.request(), ruleset: durationConditionFixture({ rulesetId: "00000000-0000-4000-8000-000000009913" }).ruleset })],
  ["39 executable prose", () => component("spell.casting_condition.verbal", "rules/condition/applicability", "return true; SELECT * FROM characters")],
  ["40 SC042 silently granted", () => req("additionalAffinityTraits", ["trait1"])],
  ["41 missing AP/MP choice", () => onlyCondition("maneuver.condition.no_counter_action", {}, maneuver)],
  ["42 incompatible movement restrictions", () => req("composition/conditions", ["stationary", "must_move_first"].map((k, i) => ({ componentKey: `condition${i}`, order: i, definition: f.ref(`maneuver.condition.${k}`), parameters: {} })), maneuver)],
  ["43 duplicate restriction discounted twice", () => req("composition/conditions", [1, 2].map(i => ({ componentKey: `condition${i}`, order: i, definition: f.ref("spell.casting_condition.verbal"), parameters: {} })))],
  ["44 conflicting Cannot Move source", () => onlyCondition("maneuver.condition.cannot_move_this_turn", {}, maneuver)],
  ["45 old Once per Mission minus five", () => onlyCondition("maneuver.condition.once_per_mission", {}, maneuver)],
  ["46 Permanent without exact access", () => req("composition/duration/definition", f.ref("spell.duration.permanent_by_special_rule"))],
  ["47 generic Material without exact subject", () => onlyCondition("spell.casting_condition.material")],
  ["48 dependency present in bundle but not selected", () => component("spell.casting_condition.verbal", "rules/condition/dependencies", [f.ref("spell.effect.direct_healing")])],
  ["49 stale dependency Version", () => component("spell.casting_condition.verbal", "rules/condition/dependencies", [{ ...f.ref("spell.effect.direct_damage"), entityVersionId: "00000000-0000-4000-8000-000000009912" }])],
  ["50 unsupported runtime contract", () => component("spell.casting_condition.verbal", "rules/condition/runtimeRequirements/0/requirement", { kind: "CALL", fn: "spendMp" })],
  ["51 AP-or-MP implicit default", () => component("maneuver.condition.no_counter_action", "rules/condition/parameters/0/default", "AP", maneuver)],
  ["52 fabricated slot exemption", () => component("spell.casting_condition.verbal", "rules/condition/consumesSlot", false)],
  ["53 mixed-version requirement provenance", () => component("spell.casting_condition.verbal", "rules/condition/applicability/provenance", { entityId: f.ref("spell.casting_condition.verbal").entityId, entityVersionId: "00000000-0000-4000-8000-000000009914", canonicalKey: "spell.casting_condition.verbal", rulesetId: f.ruleset.rulesetId, manifestId: f.ruleset.manifestId })],
  ["54 foreign runtime subject", () => component("spell.casting_condition.verbal", "rules/condition/runtimeRequirements/0/references", [{ ...f.ref("fixture.foundation.blade"), entityVersionId: "00000000-0000-4000-8000-000000009914" }])],
  ["55 ownership requirement without exact subject", () => component("spell.casting_condition.verbal", "rules/condition/runtimeRequirements/0/requirement", { kind: "ENTITY_OWNED", entityId: f.ref("fixture.foundation.blade").entityId })],
  ["56 intrinsic restriction cannot bypass its mechanic", () => { const r = relevance("SAVE_RESTRICTION", "mechanic.present"); return r; }],
  ["57 one OR option smuggles two benefits", () => {
    const d = f.bundle.definitions.find(d => d.canonicalKey === "maneuver.condition.no_counter_action")!;
    const costs = copy(d.payload.costContributions) as { contributionKey: string; data: Record<string, unknown> }[];
    const extra = copy(costs.find(c => c.data.option === "MP")!); extra.contributionKey = "duplicate.mp"; extra.data.option = "AP"; costs.push(extra);
    return component(d.canonicalKey, "costContributions", costs, maneuver);
  }],
  ["58 alternative currencies cannot be relabeled ALL", () => {
    const r = component("maneuver.condition.no_counter_action", "rules/condition/choice", { kind: "ALL" }, maneuver);
    const d = r.definitions.definitions.find(d => d.canonicalKey === "maneuver.condition.no_counter_action")!;
    setPath(d.payload, "costContributions", (d.payload.costContributions as { data: Record<string, unknown> }[]).map(c => { const out = copy(c); delete out.data.option; return out; })); return r;
  }],
];
describe("M5-WO9 behavioral negative controls", () => {
  it.each(cases)("rejects %s", (_name, make) => { const r = evaluateAbilityDefinition(make()); expect(r.ok && r.value.valid).toBe(false); });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite round count %s", rounds => expect(compileAbilityDefinition(req("composition/duration/parameters", { rounds }, K[2]!)).ok).toBe(false));
  it("rejects forged or missing provenance and retains pure inputs", () => {
    const r = copy(f.request()), bytes = JSON.stringify(r);
    expect(evaluateAbilityDefinition(r).ok).toBe(true); expect(JSON.stringify(r)).toBe(bytes);
    setPath(r, "definitions/rulesetProvenance/manifestId", "00000000-0000-4000-8000-000000009911"); expect(compileAbilityDefinition(r).ok).toBe(false);
  });
});
