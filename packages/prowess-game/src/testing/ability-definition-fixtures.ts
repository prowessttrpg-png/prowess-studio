import { createRulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle } from "../bundle/bundle.js";
import { definitionRefOf, type ProwessDefinitionEnvelope, type ProwessDefinitionRef } from "../definition/envelope.js";
import { PROWESS_DEFINITION_KINDS, type ProwessDefinitionKind } from "../vocabulary/families.js";
import { effectFixture, spellEffectAbility, effectCharacter } from "./effect-fixtures.js";
import { keywordCatalog } from "./affinity-fixtures.js";
import { uuid } from "./fixtures.js";
import { WIDEN_AREA_TRAIT_CONTENT } from "../content/core-playtest-v0.1/traits.js";

/** Neutral reference mechanics are TEST fixtures, not additions to the canonical Maneuver Trait catalog. */
const common = (extra: object = {}) => ({ keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {}, ...extra });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Row = { canonicalKey: string; definitionKind: ProwessDefinitionKind; payload: Record<string, unknown> };
export function abilityDefinitionFixture(options: { rulesetId?: string; manifestId?: string; revise?: Readonly<Record<string, Record<string, unknown>>> } = {}) {
  const base = effectFixture({ rulesetId: options.rulesetId, manifestId: options.manifestId, revise: options.revise });
  const rows: Row[] = [];
  const add = (key: string, kind: ProwessDefinitionKind, payload: Record<string, unknown>) => { rows.push({ canonicalKey: key, definitionKind: kind, payload }); };
  const ref = (key: string): ProwessDefinitionRef => {
    const i = rows.findIndex(x => x.canonicalKey === key);
    if (i < 0) return base.ref(key);
    const row = rows[i]!;
    return { entityId: uuid(61000 + i), entityVersionId: uuid((options.revise?.[key] || (row.definitionKind.endsWith("_DEFINITION") && Object.keys(options.revise ?? {}).length > 0) ? 64000 : 62000) + i), canonicalKey: key, definitionKind: row.definitionKind, systemFamily: PROWESS_DEFINITION_KINDS[row.definitionKind].family } as ProwessDefinitionRef;
  };
  const conversion = (family: "SPELL" | "MANEUVER" | "SHARED", affinity = false) => common({ traitFamily: "DAMAGE_CONVERSION", scope: "EFFECT_SPECIFIC", keywords: ["keyword.direct_damage"], costContributions: [{ contributionKey: "trait.mp", currency: "MP", data: { kind: "FIXED", amount: 4 } }],
    rules: { construction: { prerequisites: affinity ? [{ prerequisiteKey: "AFFINITY_TRAINED", kind: "AFFINITY_RANK_AT_LEAST", affinity: ref("affinity.evocation"), minimumRank: "TRAINED" }] : [], stacking: { stackable: false }, affinityAccess: [] },
      trait: { family, name: "Reference conversion", description: "Changes only an existing Damage Effect's type; adds no damage or Condition.", parameters: [{ parameter: "damageType", kind: "TOKEN", allowed: ["FIRE", "ICE"], default: "FIRE" }], modifications: [{ kind: "DAMAGE_TYPE", parameter: "damageType" }], effectFamilies: ["DAMAGE"], foundationCategories: family === "MANEUVER" ? ["MELEE"] : [], incompatibleTraits: [], affinity: affinity ? ref("affinity.evocation") : null } } });
  add("fixture.trait.spell", "SPELL_TRAIT", conversion("SPELL"));
  add("fixture.trait.maneuver", "MANEUVER_TRAIT", conversion("MANEUVER"));
  add("fixture.trait.shared", "SHARED_TRAIT", conversion("SHARED"));
  add("fixture.trait.affinity", "SPELL_TRAIT", conversion("SPELL", true));
  add("spell.trait.widen_area", "SPELL_TRAIT", clone(WIDEN_AREA_TRAIT_CONTENT.payload) as unknown as Record<string, unknown>);
  add("fixture.trait.stackable", "SPELL_TRAIT", common({ traitFamily: "COST_CONFIGURATION", scope: "ABILITY_WIDE", rules: {
    construction: { stacking: { stackable: true, limit: { kind: "FIXED", maximum: 3 } } },
    trait: { family: "SPELL", name: "Reference stackable cost component", description: "Test-only supported cost property; final pricing belongs to WO10.", parameters: [{ parameter: "stacks", kind: "COUNT", minimum: 1, maximum: { kind: "FIXED", value: 3 }, increment: 1, default: 1 }], modifications: [{ kind: "COST", parameter: "stacks", currency: "MP", operation: "ADD" }], effectFamilies: [], foundationCategories: [], incompatibleTraits: [], affinity: null },
  } }));
  const targeting = { componentKey: "targeting", definition: ref("maneuver.targeting.single_target"), parameters: {} };
  const attack = (category: "MELEE" | "RANGED") => common({ foundationKind: "WEAPON_ATTACK", rules: { attack: { category, targeting, range: { kind: "WEAPON_RANGE", feet: category === "MELEE" ? 5 : 60 }, resolution: { mode: "ATTACK_ROLL", stat: category === "MELEE" ? "STR" : "AGI" }, damage: { kind: "WEAPON", weaponKey: category === "MELEE" ? "fixture.weapon.blade" : "fixture.weapon.bow", baseDice: "1d6", power: 2, stat: "STR", enchantments: [] } } } });
  add("fixture.foundation.blade", "MANEUVER_FOUNDATION", attack("MELEE"));
  add("fixture.foundation.bow", "MANEUVER_FOUNDATION", attack("RANGED"));
  const trait = (key: string, componentKey = "trait1", target = "effect1", scope = "EFFECT_SPECIFIC", parameters = {}) => ({ componentKey, order: 10, definition: ref(key), parameters, appliesTo: { scope, componentKey: scope === "ABILITY_WIDE" ? null : target } });
  const s = (name: string, multi = false, affinity = false) => {
    const composition = spellEffectAbility(base, "spell.effect.direct_damage", "spell.targeting.single_target", { dice: 1 });
    composition.compositionKey = name;
    if (multi) composition.effects.push({ componentKey: "effect2", order: 20, definition: ref("spell.effect.direct_healing"), parameters: { dice: 1 } });
    const raw = composition as unknown as Record<string, unknown>;
    raw.traits = [trait(affinity ? "fixture.trait.affinity" : "fixture.trait.spell")];
    if (affinity) { raw.authority = { authority: "AFFINITY_AUTHORITY" }; raw.affinity = { componentKey: "affinity", definition: ref("affinity.evocation"), parameters: {} }; }
    return { name, description: "Deterministic reference Spell", composition, additionalAffinityTraits: [] };
  };
  add("fixture.spell.simple", "SPELL_DEFINITION", s("reference.spell.simple"));
  add("fixture.spell.multi", "SPELL_DEFINITION", s("reference.spell.multi", true));
  add("fixture.spell.affinity", "SPELL_DEFINITION", s("reference.spell.affinity", false, true));
  const m = (key: string, conversionEffect = false, multi = false) => {
    const actions = [{ componentKey: "attack1", order: 10, definition: ref("fixture.foundation.blade"), parameters: {} }];
    if (multi) actions.push({ componentKey: "attack2", order: 20, definition: ref("fixture.foundation.blade"), parameters: {} });
    const effects = [{ componentKey: "effect1", order: 10, definition: ref(conversionEffect ? "maneuver.effect.line_attack_conversion" : "maneuver.effect.elemental_damage_conversion"), parameters: conversionEffect ? {} : { damageType: "FIRE" } }];
    if (multi) effects.push({ componentKey: "effect2", order: 20, definition: ref("maneuver.effect.sweep_attack"), parameters: {} });
    return { name: key, description: "Deterministic reference Maneuver", composition: { compositionKey: key, abilityKind: "MANEUVER", affinity: null, authority: null, keywords: [], effects, traits: multi ? [trait("fixture.trait.maneuver")] : [], duration: { componentKey: "duration", definition: ref("maneuver.duration.instant"), parameters: {} }, conditions: [] }, actions, effectAttachments: effects.map(e => ({ effectKey: e.componentKey, actionKeys: multi ? ["attack1", "attack2"] : ["attack1"] })), powerfulBlow: multi ? { actionKeys: ["attack1", "attack2"] } : null };
  };
  add("fixture.maneuver.basic", "MANEUVER_DEFINITION", m("reference.maneuver.basic"));
  add("fixture.maneuver.modified", "MANEUVER_DEFINITION", m("reference.maneuver.modified", true));
  add("fixture.maneuver.multi", "MANEUVER_DEFINITION", m("reference.maneuver.multi", false, true));
  const context = createRulesetContext({ ...base.ruleset, rules: [...base.ruleset.rules, ...rows.map(row => ({ ...ref(row.canonicalKey), entityType: PROWESS_DEFINITION_KINDS[row.definitionKind].entityTypes[0], sourceRulesetId: base.ruleset.rulesetId, sourceManifestId: base.ruleset.manifestId }))].map(({ entityId, entityVersionId, canonicalKey, entityType, sourceRulesetId, sourceManifestId }) => ({ entityId, entityVersionId, canonicalKey, entityType, sourceRulesetId, sourceManifestId })) });
  if (!context.ok) throw new Error(JSON.stringify(context.errors));
  const definitions = [...base.bundle.definitions, ...rows.map(row => ({ ...ref(row.canonicalKey), schemaVersion: 1, payload: options.revise?.[row.canonicalKey] ?? row.payload, provenance: { rulesetId: context.value.rulesetId, manifestId: context.value.manifestId, releaseId: null, sourceRulesetId: context.value.rulesetId, sourceManifestId: context.value.manifestId, legacyTerms: [] } }))];
  const bundle = createProwessDefinitionBundle({ ruleset: context.value, definitions }); if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems, null, 2));
  return { ruleset: context.value, bundle: bundle.value, ref, rows, request: (key: string, character: ReturnType<typeof effectCharacter> = effectCharacter()) => ({ contractVersion: 1, subjectKey: "fixture.authored", definition: ref(key), definitions: bundle.value, ruleset: context.value, character, keywords: keywordCatalog(), signature: { usedSlots: 0, candidate: { slotUse: "DEFAULT" } }, ...(key === "fixture.spell.affinity" ? { accessGrants: ["targeting", "effect1", "trait1", "duration"].map(componentKey => ({ componentKey, sourceKey: "fixture.explicit.evocation_access" })) } : {}) }) };
}
export const authoredFixturePayload = (f: ReturnType<typeof abilityDefinitionFixture>, key: string): Record<string, unknown> => clone(f.bundle.definitions.find(d => d.canonicalKey === key)!.payload);
export const authoredFixtureEnvelope = (f: ReturnType<typeof abilityDefinitionFixture>, key: string): ProwessDefinitionEnvelope => f.bundle.definitions.find(d => d.canonicalKey === key)!;
export const fixtureDefinitionRefs = (f: ReturnType<typeof abilityDefinitionFixture>) => f.bundle.definitions.map(definitionRefOf);
