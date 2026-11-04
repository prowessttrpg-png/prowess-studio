import { createRulesetContext } from "@prowess/rules";
import { createProwessDefinitionBundle } from "../bundle/bundle.js";
import { definitionRefOf, type ProwessDefinitionRef } from "../definition/envelope.js";
import { M6_WO8_COST_EXTENSION, performanceConditionCandidate } from "../content-updates/m6-wo8-amendment-a.js";
import { maneuverCostFixture } from "./maneuver-cost-fixtures.js";
import { ACTIVE_MAGIC_CONTENT } from "../content/core-playtest-v0.1/active-magic.js";
import { weaponFixture } from "./weapon-fixtures.js";
import { PROWESS_DEFINITION_KINDS } from "../vocabulary/families.js";
import { uuid } from "./fixtures.js";

/** Exact test Release: existing M5 examples + WO6 Weapons + the approved NEW policy and Performance candidate.
 * Only fixtures materialize these Definitions; the production Release/catalog is never supplemented. */
export function signatureManeuverFixture() {
  const w = weaponFixture(), m = maneuverCostFixture();
  const defs = [...w.bundle.definitions, ...m.bundle.definitions.filter(d => !w.bundle.definitions.some(x => x.canonicalKey === d.canonicalKey))];
  const skill = { entityId: uuid(160001), entityVersionId: uuid(160002), canonicalKey: "test.wo8.skill.performance", definitionKind: "SKILL", systemFamily: "SKILL" } as ProwessDefinitionRef;
  const condition = { entityId: uuid(160003), entityVersionId: uuid(160004), canonicalKey: "maneuver.condition.performance", definitionKind: "MANEUVER_CONDITION", systemFamily: "MANEUVER" } as ProwessDefinitionRef;
  const trait = { entityId: uuid(160005), entityVersionId: uuid(160006), canonicalKey: "test.wo8.trait.block_addition", definitionKind: "MANEUVER_TRAIT", systemFamily: "MANEUVER" } as ProwessDefinitionRef;
  const traitPayload = {
    traitFamily: "COST_MODIFICATION", scope: "ACTION_SPECIFIC", keywords: [], parameters: {}, compatibility: [],
    costContributions: [{ contributionKey: "block_addition.mp", currency: "MP", data: { kind: "FIXED", amount: 4 } }],
    rules: { construction: { prerequisites: [], stacking: { stackable: false } }, trait: { family: "MANEUVER", name: "Block addition fixture", description: "Test-only, explicitly priced Action-scoped addition", parameters: [{ parameter: "ap", kind: "COUNT", minimum: 1, maximum: { kind: "FIXED", value: 1 }, increment: 1, default: 1 }], modifications: [{ kind: "COST", currency: "AP", operation: "ADD", parameter: "ap" }], effectFamilies: [], foundationCategories: ["DEFENSE"], incompatibleTraits: [], affinity: null } },
  };
  const enhancement = { entityId: uuid(160007), entityVersionId: uuid(160008), canonicalKey: "test.wo8.effect.enhancement", definitionKind: "MANEUVER_EFFECT", systemFamily: "MANEUVER" } as ProwessDefinitionRef;
  const enhancementPayload = m.rowPayload("fixture.wo11.effect.surge");
  enhancementPayload.costContributions = [{ contributionKey: "enhancement.ap", currency: "AP", data: { kind: "FIXED", amount: 1 } }, { contributionKey: "enhancement.mp", currency: "MP", data: { kind: "FIXED", amount: 5 } }];
  const targetingTrait = { entityId: uuid(160011), entityVersionId: uuid(160012), canonicalKey: "test.wo8.trait.exact_range", definitionKind: "MANEUVER_TRAIT", systemFamily: "MANEUVER" } as ProwessDefinitionRef;
  const targetingTraitPayload = {
    traitFamily: "TARGETING_MODIFICATION", scope: "TARGETING", keywords: [], parameters: {}, compatibility: [],
    costContributions: [{ contributionKey: "exact_range.mp", currency: "MP", data: { kind: "FIXED", amount: 2 } }],
    rules: { construction: { prerequisites: [], stacking: { stackable: false } }, trait: { family: "MANEUVER", name: "Exact range fixture", description: "Test-only scoped range modification", parameters: [{ parameter: "feet", kind: "COUNT", minimum: 5, maximum: { kind: "FIXED", value: 5 }, increment: 5, default: 5 }], modifications: [{ kind: "TARGETING_MEASURE", parameter: "feet", measure: "RANGE", operation: "ADD" }], effectFamilies: [], foundationCategories: ["MELEE"], incompatibleTraits: [], affinity: null } },
  };
  const reference = { entityId: uuid(160009), entityVersionId: uuid(160010), canonicalKey: "test.wo8.maneuver.master_reference", definitionKind: "MANEUVER_DEFINITION", systemFamily: "MANEUVER" } as ProwessDefinitionRef;
  const ref = (key: string) => key === reference.canonicalKey ? reference : key === targetingTrait.canonicalKey ? targetingTrait : key === enhancement.canonicalKey ? enhancement : key === trait.canonicalKey ? trait : key === skill.canonicalKey ? skill : key === condition.canonicalKey ? condition : definitionRefOf(defs.find(d => d.canonicalKey === key)!);
  const referencePayload = {
    name: "Master reference fixture", description: "Exact structured WO8 reference prices",
    actions: [["move", "fixture.wo11.action.move"], ["attack", "fixture.wo11.attack.longsword"], ["block", "fixture.wo11.action.block"]].map(([componentKey, key], order) => ({ componentKey, order, definition: ref(key!), parameters: {} })),
    composition: { compositionKey: "test.wo8.master_reference", abilityKind: "MANEUVER", affinity: null, authority: null, keywords: [], effects: [{ componentKey: "effect", order: 1, definition: enhancement, parameters: {} }], traits: [{ componentKey: "trait", order: 1, definition: trait, parameters: {}, appliesTo: { scope: "ACTION_SPECIFIC", componentKey: "block" } }], duration: { componentKey: "duration", definition: ref("maneuver.duration.instant"), parameters: {} }, conditions: [] },
    effectAttachments: [{ effectKey: "effect", actionKeys: ["attack"] }], powerfulBlow: null,
  };
  const remap = (v: unknown): unknown => Array.isArray(v) ? v.map(remap) : v && typeof v === "object" ? "entityVersionId" in v && "definitionKind" in v ? ref((v as ProwessDefinitionRef).canonicalKey) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)])) : v;
  const construction = { ...ACTIVE_MAGIC_CONTENT.constructionRule.payload, maneuverCostPolicy: { ...ACTIVE_MAGIC_CONTENT.constructionRule.payload.maneuverCostPolicy, extension: M6_WO8_COST_EXTENSION } };
  const definitions = defs.map(d => ({ ...d, payload: remap(d.definitionKind === "ABILITY_CONSTRUCTION_RULE" ? construction : d.payload), provenance: { ...d.provenance, rulesetId: w.ruleset.rulesetId, manifestId: w.ruleset.manifestId, sourceRulesetId: w.ruleset.rulesetId, sourceManifestId: w.ruleset.manifestId } }));
  for (const [r, payload] of [[skill, { ladderKey: "SKILL", source: { locators: ["s29"], conflicts: [] } }], [condition, performanceConditionCandidate(skill)], [trait, traitPayload], [enhancement, enhancementPayload], [targetingTrait, targetingTraitPayload], [reference, referencePayload]] as const) definitions.push({ ...r, schemaVersion: 1, payload, provenance: { rulesetId: w.ruleset.rulesetId, manifestId: w.ruleset.manifestId, sourceRulesetId: w.ruleset.rulesetId, sourceManifestId: w.ruleset.manifestId, releaseId: null, legacyTerms: [] } });
  const ruleset = createRulesetContext({ ...w.ruleset, rules: definitions.map(d => ({ entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0], sourceRulesetId: w.ruleset.rulesetId, sourceManifestId: w.ruleset.manifestId })) });
  if (!ruleset.ok) throw new Error(JSON.stringify(ruleset.errors));
  const bundle = createProwessDefinitionBundle({ ruleset: ruleset.value, definitions });
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.problems));
  return { ...w, ref, bundle: bundle.value, ruleset: ruleset.value, request: (key: string, signatureManeuver = false) => ({ ...m.request("fixture.wo11.maneuver.basic", signatureManeuver), definitions: bundle.value, ruleset: ruleset.value, definition: ref(key) }) };
}

/** Published only inside isolated DB/API/E2E fixtures, never production content. */
export function signatureManeuverWorldContent() {
  const f = signatureManeuverFixture();
  const toRefs = (v: unknown): unknown => Array.isArray(v) ? v.map(toRefs) : v && typeof v === "object" ? "entityVersionId" in v && "definitionKind" in v ? { $ref: (v as ProwessDefinitionRef).canonicalKey } : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toRefs(x)])) : v;
  const kinds = ["MANEUVER_TARGETING", "MANEUVER_EFFECT", "MANEUVER_TRAIT", "MANEUVER_DURATION", "MANEUVER_CONDITION", "ABILITY_CONSTRUCTION_RULE"];
  const definitions = f.bundle.definitions.filter(d => kinds.includes(d.definitionKind) || d.canonicalKey === "test.wo8.skill.performance" || d.definitionKind === "MANEUVER_FOUNDATION" && (d.payload as { rules: { action?: unknown } }).rules.action !== undefined).map(d => ({ canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, schemaVersion: d.schemaVersion, payload: toRefs(d.payload) }));
  const keywords = new Set<string>();
  const collect = (v: unknown): void => { if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (["keywords", "matchAny"].includes(k) && Array.isArray(x)) x.forEach(k => keywords.add(String(k))); else collect(x); } };
  f.bundle.definitions.forEach(d => collect(d.payload));
  return { $comment: "M6-WO8 TEST Release content. Generated from testing/signature-maneuver-fixtures.ts; never imported by runtime.", keywords: [...keywords].sort(), definitions };
}
