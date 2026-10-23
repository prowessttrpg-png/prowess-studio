import { createRulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle } from "../bundle/bundle.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import { abilityDefinitionFixture } from "./ability-definition-fixtures.js";
import { uuid } from "./fixtures.js";
import { DURATION_CONDITION_CONTENT } from "../content/core-playtest-v0.1/duration-conditions.js";
import { effectCharacter } from "./effect-fixtures.js";
export const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export function setPath(x: unknown, path: string, value: unknown): void {
  const keys = path.split("/"); let r = x as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) r = r[k] as Record<string, unknown>;
  r[keys[keys.length - 1]!] = value;
}
export const WO9_REFERENCE_KEYS = ["fixture.wo9.spell.instant", "fixture.wo9.spell.components", "fixture.wo9.spell.timed", "fixture.wo9.spell.attack", "fixture.wo9.spell.no_attack", "fixture.wo9.spell.cap", "fixture.wo9.spell.sustained", "fixture.wo9.maneuver.simple", "fixture.wo9.maneuver.choice", "fixture.wo9.maneuver.cap", "fixture.wo9.maneuver.duration"];
type Row = { canonicalKey: string; definitionKind: ProwessDefinitionKind; payload: Record<string, unknown> };
/** Canonical listed components plus clearly separated test-only relevance/maintenance fixtures. No new game mechanics. */
export function durationConditionFixture(options: { rulesetId?: string; manifestId?: string; revise?: Readonly<Record<string, Record<string, unknown>>> } = {}) {
  const old = abilityDefinitionFixture(), existing = new Map<string, typeof old.bundle.definitions[number]>(old.bundle.definitions.map(d => [d.canonicalKey, d]));
  const rule = copy(DURATION_CONDITION_CONTENT.constructionRule.payload) as Record<string, unknown>;
  const canonical = DURATION_CONDITION_CONTENT.definitions as unknown as Row[];
  const revision: Record<string, Record<string, unknown>> = { "construction.ability_rules": rule };
  for (const row of canonical) if (existing.has(row.canonicalKey)) revision[row.canonicalKey] = row.payload;
  for (const [key, value] of Object.entries(options.revise ?? {})) if (existing.has(key)) revision[key] = value;
  const base = abilityDefinitionFixture({ ...options, revise: revision });
  const rows: Row[] = canonical.filter(x => !existing.has(x.canonicalKey)).map(copy);
  const ref = (key: string): ProwessDefinitionRef => {
    const i = rows.findIndex(x => x.canonicalKey === key); if (i < 0) return base.ref(key);
    const row = rows[i]!;
    const revised = !!options.revise?.[key] || row.definitionKind.endsWith("_DEFINITION") && Object.keys(options.revise ?? {}).length > 0;
    return { entityId: uuid(71000 + i), entityVersionId: uuid((revised ? 75000 : 73000) + i), canonicalKey: key, definitionKind: row.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[row.definitionKind].family } as ProwessDefinitionRef;
  };
  const add = (key: string, kind: ProwessDefinitionKind, payload: Record<string, unknown>) => rows.push({ canonicalKey: key, definitionKind: kind, payload });
  const neutral = copy(base.bundle.definitions.find(d => d.canonicalKey === "spell.effect.reinforce")!.payload);
  setPath(neutral, "rules/effect/duration", { allowed: ["INSTANT", "ROUNDS", "COMBAT", "SCENE", "MISSION", "SUSTAINED", "MANA_LOCK"], default: "INSTANT", sustainEligible: true, manaLockEligible: true });
  add("fixture.wo9.effect.maintenance", "SPELL_EFFECT", neutral);
  const restriction = copy(canonical.find(d => d.canonicalKey === "spell.casting_condition.verbal")!.payload);
  setPath(restriction, "restriction/restrictionKey", "ATTACK_RESTRICTION");
  setPath(restriction, "rules/condition/applicability", { kind: "NUMERIC_COMPARE", factKey: "mechanic.attack", operator: ">=", expected: 1 });
  add("fixture.wo9.condition.attack", "SPELL_CASTING_CONDITION", restriction);
  const use = (key: string, componentKey: string, parameters = {}) => ({ componentKey, definition: ref(key), parameters });
  const condition = (key: string, componentKey: string, parameters = {}) => ({ ...use(key, componentKey, parameters), order: 10 + Number(componentKey.replace(/\D/g, "") || 0) });
  const spell = (key: string, mode: string, conds: ReturnType<typeof condition>[], effect = "spell.effect.direct_damage") => {
    const d = copy(base.bundle.definitions.find(d => d.canonicalKey === "fixture.spell.simple")!.payload);
    setPath(d, "name", key); setPath(d, "composition/compositionKey", key);
    setPath(d, "composition/traits", []); setPath(d, "composition/conditions", conds);
    setPath(d, "composition/duration", use(`spell.duration.${mode}`, "duration", mode === "rounds" ? { rounds: 3 } : {}));
    setPath(d, "composition/effects", [{ ...use(effect, "effect1", effect === "fixture.wo9.effect.maintenance" ? { amount: 1 } : { dice: 1 }), order: 10 }]);
    add(key, "SPELL_DEFINITION", d);
  };
  spell(WO9_REFERENCE_KEYS[0]!, "instant", []);
  spell(WO9_REFERENCE_KEYS[1]!, "instant", [condition("spell.casting_condition.verbal", "condition1"), condition("spell.casting_condition.somatic", "condition2")]);
  spell(WO9_REFERENCE_KEYS[2]!, "rounds", [], "fixture.wo9.effect.maintenance");
  spell(WO9_REFERENCE_KEYS[3]!, "instant", [condition("fixture.wo9.condition.attack", "condition1")]);
  spell(WO9_REFERENCE_KEYS[4]!, "instant", [condition("fixture.wo9.condition.attack", "condition1")], "spell.effect.direct_healing");
  spell(WO9_REFERENCE_KEYS[5]!, "instant", [condition("spell.casting_condition.verbal", "condition1"), condition("spell.casting_condition.charge", "condition2", { extraAp: 4 })]);
  spell(WO9_REFERENCE_KEYS[6]!, "sustained", [], "fixture.wo9.effect.maintenance");
  const maneuver = (key: string, conds: ReturnType<typeof condition>[], mode = "instant") => {
    const d = copy(base.bundle.definitions.find(d => d.canonicalKey === "fixture.maneuver.basic")!.payload);
    setPath(d, "name", key); setPath(d, "composition/compositionKey", key); setPath(d, "composition/conditions", conds);
    setPath(d, "composition/duration", use(`maneuver.duration.${mode}`, "duration"));
    add(key, "MANEUVER_DEFINITION", d);
  };
  maneuver(WO9_REFERENCE_KEYS[7]!, [condition("maneuver.condition.stationary", "condition1")]);
  maneuver(WO9_REFERENCE_KEYS[8]!, [condition("maneuver.condition.no_counter_action", "condition1", { benefit: "MP" })]);
  maneuver(WO9_REFERENCE_KEYS[9]!, [condition("maneuver.condition.stationary", "condition1"), condition("maneuver.condition.target_unaware", "condition2"), condition("maneuver.condition.no_counter_action", "condition3", { benefit: "AP" })]);
  maneuver(WO9_REFERENCE_KEYS[10]!, []);
  const context = createRulesetContext({ ...base.ruleset, rules: [...base.ruleset.rules, ...rows.map(r => ({ entityId: ref(r.canonicalKey).entityId, entityVersionId: ref(r.canonicalKey).entityVersionId, canonicalKey: r.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[r.definitionKind].entityTypes[0], sourceRulesetId: base.ruleset.rulesetId, sourceManifestId: base.ruleset.manifestId }))] });
  if (!context.ok) throw new Error(JSON.stringify(context.errors));
  const definitions = [...base.bundle.definitions, ...rows.map(row => ({ ...ref(row.canonicalKey), schemaVersion: 1, payload: options.revise?.[row.canonicalKey] ?? row.payload, provenance: { rulesetId: context.value.rulesetId, manifestId: context.value.manifestId, releaseId: null, sourceRulesetId: context.value.rulesetId, sourceManifestId: context.value.manifestId, legacyTerms: [] } }))];
  const bundle = createProwessDefinitionBundle({ ruleset: context.value, definitions }); if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems, null, 2));
  return { ruleset: context.value, bundle: bundle.value, ref, request: (key = WO9_REFERENCE_KEYS[1]!, character = effectCharacter()) => ({ ...base.request("fixture.spell.simple", character), definition: ref(key), definitions: bundle.value, ruleset: context.value }) };
}
export function fixtureRequestWith(f: ReturnType<typeof durationConditionFixture>, key: string, path: string, value: unknown) {
  const r = copy(f.request(key)), d = r.definitions.definitions.find(d => d.canonicalKey === key)!;
  setPath(d.payload, path, value); return r;
}
