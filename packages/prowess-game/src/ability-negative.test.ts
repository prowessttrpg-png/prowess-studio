import { describe, expect, it, vi } from "vitest";
import { evaluateAbilityDefinition } from "./ability/compile.js";
import { createProwessDefinitionBundle } from "./bundle/bundle.js";
import { deserializeAuthoredAbilityDefinition } from "./definition/authored-ability-payload.js";
import { abilityDefinitionFixture } from "./testing/ability-definition-fixtures.js";
import { effectCharacter } from "./testing/effect-fixtures.js";
import { uuid } from "./testing/fixtures.js";

vi.setConfig({ testTimeout: 60_000 });

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate malformed boundary inputs
type ObjectData = Record<string, any>;
const cases: readonly [string, string, (p: ObjectData, f: ReturnType<typeof abilityDefinitionFixture>) => void, ReturnType<typeof effectCharacter>?][] = [
  ["01 unknown Trait", "spell.simple", p => { p.composition.traits[0].definition.canonicalKey = "trait.unknown"; }],
  ["02 wrong Ruleset Trait version", "spell.simple", p => { p.composition.traits[0].definition.entityVersionId = uuid(99991); }],
  ["03 Spell Trait on Maneuver", "maneuver.multi", (p, f) => { p.composition.traits[0].definition = f.ref("fixture.trait.spell"); }],
  ["04 Maneuver Trait on Spell", "spell.simple", (p, f) => { p.composition.traits[0].definition = f.ref("fixture.trait.maneuver"); }],
  ["05 illegal parameter", "spell.simple", p => { p.composition.traits[0].parameters.extra = 1; }],
  ["06 out-of-range parameter", "spell.simple", (p, f) => { Object.assign(p.composition.traits[0], { definition: f.ref("fixture.trait.stackable"), parameters: { stacks: 0 }, appliesTo: { scope: "ABILITY_WIDE", componentKey: null } }); }],
  ["07 unsupported scope", "spell.simple", p => { p.composition.traits[0].appliesTo.scope = "ANYWHERE"; }],
  ["08 stack limit", "spell.simple", (p, f) => { Object.assign(p.composition.traits[0], { definition: f.ref("fixture.trait.stackable"), parameters: { stacks: 4 }, appliesTo: { scope: "ABILITY_WIDE", componentKey: null } }); }],
  ["09 no Targeting", "spell.simple", p => { delete p.composition.targeting; }],
  ["10 no Effect", "spell.simple", p => { p.composition.effects = []; p.composition.traits = []; }],
  ["11 Effect capacity", "spell.simple", p => { for (let i = 2; i <= 4; i++) p.composition.effects.push({ ...copy(p.composition.effects[0]), componentKey: `effect${i}`, order: i * 10 }); }],
  ["12 Trait capacity", "spell.simple", p => { for (let i = 2; i <= 4; i++) p.composition.traits.push({ ...copy(p.composition.traits[0]), componentKey: `trait${i}`, order: i * 10 }); }],
  ["13 Effect incompatible with Targeting", "spell.simple", (p, f) => { p.composition.targeting.definition = f.ref("spell.targeting.radius"); p.composition.traits = []; }],
  ["14 invalid Arcane authority", "spell.simple", () => {}, effectCharacter({ arcana: "UNTRAINED" })],
  ["15 invalid Affinity authority", "spell.affinity", () => {}],
  ["16 Affinity Strength violation", "spell.affinity", () => {}],
  ["17 Maneuver no Effect", "maneuver.basic", p => { p.composition.effects = []; p.effectAttachments = []; }],
  ["18 Maneuver Effect capacity", "maneuver.basic", p => { for (let i = 2; i <= 4; i++) { p.composition.effects.push({ ...copy(p.composition.effects[0]), componentKey: `effect${i}`, order: i * 10 }); p.effectAttachments.push({ effectKey: `effect${i}`, actionKeys: ["attack1"] }); } }],
  ["19 Maneuver missing Rank", "maneuver.modified", () => {}, effectCharacter({ martial: "TRAINED" })],
  ["20 illegal attack requirement", "maneuver.multi", (p, f) => { p.actions[0].definition = f.ref("fixture.foundation.bow"); }],
  ["21 foreign Targeting", "spell.simple", p => { p.composition.targeting.definition.entityVersionId = uuid(99992); }],
  ["22 foreign Effect", "spell.simple", p => { p.composition.effects[0].definition.entityVersionId = uuid(99993); }],
  ["23 foreign Trait", "spell.simple", p => { p.composition.traits[0].definition.entityId = uuid(99994); }],
  ["26 executable payload injection", "spell.simple", p => { p.composition.branch.data = { applyDamage: "return actor.hp -= 5" }; }],
  ["null parameter", "spell.simple", p => { p.composition.traits[0].parameters.damageType = null; }],
  ["scope cannot mutate unrelated Effect", "spell.multi", p => { p.composition.traits[0].appliesTo.componentKey = "absent.effect"; }],
  ["foundation override", "maneuver.basic", p => { p.actions[0].parameters = { damage: 999 }; }],
  ["undeclared extra damage", "spell.simple", p => { p.composition.traits[0].parameters = { damage: 999, healing: 99 }; }],
];

describe("WO8 required negative controls", () => {
  it.each(cases)("rejects %s", (name, suffix, mutate, character) => {
    const f = abilityDefinitionFixture(), key = `fixture.${suffix}`;
    const definitions = copy(f.bundle.definitions), env = definitions.find(d => d.canonicalKey === key)!;
    mutate(env.payload, f);
    if (name.startsWith("16")) definitions.find(d => d.canonicalKey === "fixture.trait.affinity")!.payload.keywords = ["keyword.healing"];
    const bundle = createProwessDefinitionBundle({ ruleset: f.ruleset, definitions });
    if (!bundle.ok) { expect(bundle.problems.length).toBeGreaterThan(0); return; }
    const req = { ...f.request(key), definitions: bundle.value, character: character ?? effectCharacter() };
    const checked = name.startsWith("16") ? { ...req, character: { ...req.character, affinityProfile: { affinities: [{ affinity: f.ref("affinity.evocation"), rank: "MASTER", role: "PRIMARY", acquisition: null }] } } } : req;
    const a = evaluateAbilityDefinition(checked), b = evaluateAbilityDefinition(copy(checked));
    expect(a).toEqual(b); expect(a.ok && a.value.valid).toBe(false);
    if (a.ok) {
      expect(a.value.problems.length).toBeGreaterThan(0);
      if (/^(11|12|18)/.test(name)) expect(a.value.construction.valid).toBe(false);
      if (name.startsWith("16")) expect(a.value.problems.some(p => p.path === "trait.trait1.strength")).toBe(true);
    } else expect(a.problems.length).toBeGreaterThan(0);
  });
  it.each(["SPELL_DEFINITION", "MANEUVER_DEFINITION"] as const)("24/25 rejects malformed serialized %s", kind => {
    expect(deserializeAuthoredAbilityDefinition(kind, "{").ok).toBe(false);
    expect(deserializeAuthoredAbilityDefinition(kind, '{"name":"empty"}').ok).toBe(false);
    expect(deserializeAuthoredAbilityDefinition(kind, '{"__proto__":{"polluted":true}}').ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
