/**
 * M5-WO5 shared ability construction against the REAL database — exact Release history, cross-Ruleset isolation and no
 * persistence (PAS-10 M5-WO5 §106–§109, §168–§169). Runs only against prowess_studio_test (guarded).
 *
 * The canonical ABILITY_CONSTRUCTION_RULE (packages/prowess-game/src/content/core-playtest-v0.1/ability-construction.json)
 * is stored, with the WO2 / WO3 core content, the WO4 Affinity content and neutral test components, as ordinary
 * EntityVersions (structuredData.prowessDefinition) under GENERIC_RULE and the component entity types — no schema
 * change, no migration. The Keyword catalog handed to the pure compiler is read from real M1 KeywordDefinition rows.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I156 the Arcane Authority capacity is read from the
 * exact construction-rule EntityVersion of each Release · M5-I158 Martial capacity likewise; R1 reproduces after R2.
 */
import type { CreateChangeSetOperationInput } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, compileAbilityConstruction, readAbilityConstructionRun, type ProwessDefinitionBundle } from "@prowess/game";
import { orchestrateRulesEvaluation, type RulesetContext } from "@prowess/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  approveRuleset,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityVersion,
  createKeywordCategory,
  createKeywordDefinition,
  createRuleset,
  createRulesetManifest,
  materializeProwessDefinitionsFromRelease,
  prisma,
  publishRulesetRelease,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { AFFINITY_CONTENT, CONSTRUCTION_DEFINITIONS, characterOf, maneuverComposition, spellComposition, type ContentDefinition } from "../fixtures/m5-wo5-construction-catalog";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const rulesetIds: string[] = [];
const entityIds: string[] = [];
const createdKeywordIds: string[] = [];
let createdCategoryId: string | null = null;
let catalog: { keywordId: string; canonicalKey: string; categoryId: string | null }[] = [];
const RULE_KEY = "construction.ability_rules";

const stored = (d: ContentDefinition, payload: Record<string, unknown> = d.payload) => ({
  [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: d.schemaVersion, systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family, definitionKind: d.definitionKind, payload, ...(d.canonicalKey === "affinity.evocation" ? { legacyTerms: [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }] } : {}) },
});
async function version(entityId: string, name: string, structuredData: object) {
  const v = await createEntityVersion(entityId, { displayName: name, structuredData });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}

async function keywordCatalog() {
  const existingCategory = await prisma.keywordCategory.findUnique({ where: { canonicalKey: AFFINITY_CONTENT.keywordCategory.canonicalKey } });
  const category = existingCategory ?? (await createKeywordCategory({ canonicalKey: AFFINITY_CONTENT.keywordCategory.canonicalKey, name: AFFINITY_CONTENT.keywordCategory.name }));
  if (existingCategory === null) createdCategoryId = category.id;
  const out: typeof catalog = [];
  for (const k of AFFINITY_CONTENT.keywords) {
    const found = await prisma.keywordDefinition.findUnique({ where: { canonicalKey: k.canonicalKey } });
    const kw = found ?? (await createKeywordDefinition({ canonicalKey: k.canonicalKey, name: k.name, categoryId: category.id }));
    if (found === null) createdKeywordIds.push(kw.id);
    out.push({ keywordId: kw.id, canonicalKey: kw.canonicalKey, categoryId: kw.categoryId ?? null });
  }
  return out;
}

async function publishR1(label: string) {
  const r = await createRuleset({ canonicalKey: `test.ruleset.m5construction_${label}_${tag}_${next()}`, name: `M5 Construction ${label}`, channel: "CORE_PLAYTEST", versionLabel: `m5 construction ${label}` });
  rulesetIds.push(r.id);
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const pins: { entityId: string; entityVersionId: string; key: string }[] = [];
  for (const d of CONSTRUCTION_DEFINITIONS) {
    const e = await createEntity({ entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as string, canonicalKey: `test.m5construction.${d.canonicalKey.replace(/\./g, "_")}_${tag}_${next()}` });
    entityIds.push(e.id);
    const v = await version(e.id, `${d.canonicalKey} v1`, stored(d));
    pins.push({ entityId: e.id, entityVersionId: v.id, key: d.canonicalKey });
  }
  const m = await createRulesetManifest(r.id, { entries: pins.map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
  const policy = await createCanonPolicy(r.id, { name: `P ${next()}`, authorities: [] });
  const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: `${label} R1` });
  return { r, pins, policy, r1 };
}

/** R2: the same Ruleset with a test-only revised construction rule (Arcane Expert → 1 Effect; Martial Trained → 2). */
async function publishR2(g: Awaited<ReturnType<typeof publishR1>>, label: string) {
  const pin = g.pins.find((p) => p.key === RULE_KEY)!;
  const def = CONSTRUCTION_DEFINITIONS.find((d) => d.canonicalKey === RULE_KEY)!;
  const payload = JSON.parse(JSON.stringify(def.payload)) as { spell: { arcaneAuthority: { ranks: { rankKey: string; effectCapacity: number }[] } }; maneuver: { martial: { ranks: { rankKey: string; effectCapacity: number }[] } } };
  payload.spell.arcaneAuthority.ranks.find((x) => x.rankKey === "EXPERT")!.effectCapacity = 1;
  payload.maneuver.martial.ranks.find((x) => x.rankKey === "TRAINED")!.effectCapacity = 2;
  const v2 = await version(pin.entityId, `${RULE_KEY} v2`, stored(def, payload));
  const operations: CreateChangeSetOperationInput[] = [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: pin.entityId, fromEntityVersionId: pin.entityVersionId, toEntityVersionId: v2.id }];
  const cs = await createChangeSet(g.r.id, { name: `cs ${next()}`, operations });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  return publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: g.r1.manifestId, canonPolicyId: g.policy.id, changeSetId: cs.id, versionLabel: label });
}

type Pins = { entityId: string; key: string }[];
function evaluate(materialized: { ruleset: RulesetContext; bundle: ProwessDefinitionBundle }, pins: Pins, kind: "SPELL" | "MANEUVER") {
  const ref = (key: string) => {
    const entityId = pins.find((p) => p.key === key)!.entityId;
    const d = materialized.bundle.definitions.find((x) => x.entityId === entityId)!;
    return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  };
  const composition = kind === "SPELL" ? spellComposition(ref, ["spell.effect.direct_damage", "spell.effect.healing"]) : maneuverComposition(ref, ["maneuver.effect.strike", "maneuver.effect.sweep"]);
  const character = characterOf(kind === "SPELL" ? { "skill.arcana": "EXPERT" } : { "skill.martial": "TRAINED" });
  // The materialized bundle carries test-unique canonical keys; the Skill keys the rule reads are content keys.
  const plan = compileAbilityConstruction({ contractVersion: 1, subjectKey: "history", composition, definitions: materialized.bundle, ruleset: materialized.ruleset, character, keywords: catalog, signature: { usedSlots: 0, candidate: { slotUse: "DEFAULT" } } });
  if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo5.history", contexts: { ruleset: materialized.ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(JSON.stringify(response.errors));
  const reading = readAbilityConstructionRun({ plan: plan.value, run: response.data });
  if (!reading.ok) throw new Error(JSON.stringify(reading.problems));
  return { plan: plan.value, run: response.data, result: reading.value, summary: [reading.value.status, reading.value.capacity.effects.remaining] };
}

async function fingerprint() {
  const [entities, versions, rulesets, releases, keywords] = await Promise.all([prisma.entity.count(), prisma.entityVersion.count(), prisma.ruleset.count(), prisma.rulesetRelease.count(), prisma.keywordDefinition.count()]);
  return { entities, versions, rulesets, releases, keywords };
}

describe("M5-WO5 shared ability construction — exact Release history and isolation (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    catalog = await keywordCatalog();
  });

  afterAll(async () => {
    await prisma.rulesetRelease.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSetOperation.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSet.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: { rulesetId: { in: rulesetIds } } } });
    await prisma.canonPolicy.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.updateMany({ where: { rulesetId: { in: rulesetIds } }, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    await prisma.entityVersion.updateMany({ where: { entityId: { in: entityIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
    await prisma.keywordDefinition.deleteMany({ where: { id: { in: createdKeywordIds } } });
    if (createdCategoryId !== null) await prisma.keywordCategory.deleteMany({ where: { id: createdCategoryId } });
  });

  it("§168 R1 evaluates; after R2 pins a new construction rule, R1 re-materializes and re-evaluates identically; evaluation writes nothing (M5-I156, M5-I158)", async () => {
    const g = await publishR1("history");
    const first = await materializeProwessDefinitionsFromRelease(g.r1.id);
    const rule = first.bundle.definitions.find((d) => d.entityId === g.pins.find((p) => p.key === RULE_KEY)!.entityId)!;
    expect([rule.definitionKind, rule.schemaVersion]).toEqual(["ABILITY_CONSTRUCTION_RULE", 1]);
    const before = await fingerprint();
    const spell = evaluate(first, g.pins, "SPELL");
    const maneuver = evaluate(first, g.pins, "MANEUVER");
    expect(await fingerprint()).toEqual(before); // evaluation persists nothing
    expect([spell.summary, maneuver.summary]).toEqual([["VALID", 2], ["INVALID", 1]]);
    expect(spell.plan.rulesetProvenance.release).toEqual({ releaseId: g.r1.id, releaseNumber: 1, versionLabel: "history R1" });
    const cited = new Set(spell.plan.sourceMap.entries.flatMap((e) => e.definitions.map((d) => d.entityVersionId as string)));
    expect(cited.has(rule.entityVersionId)).toBe(true);

    const release2 = await publishR2(g, "history R2");
    const second = await materializeProwessDefinitionsFromRelease(release2.id);
    expect([evaluate(second, g.pins, "SPELL").summary, evaluate(second, g.pins, "MANEUVER").summary]).toEqual([["INVALID", 1], ["VALID", 2]]);

    const again = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(again).toEqual(first);
    const spellAgain = evaluate(again, g.pins, "SPELL");
    expect([spellAgain.plan, spellAgain.run, spellAgain.result]).toEqual([spell.plan, spell.run, spell.result]);
  });

  it("§169 R1 and R2 evaluate concurrently with their own exact construction rule; a bundle never runs under another Release", async () => {
    const g = await publishR1("isolation");
    const release2 = await publishR2(g, "isolation R2");
    const [a, b] = await Promise.all([materializeProwessDefinitionsFromRelease(g.r1.id), materializeProwessDefinitionsFromRelease(release2.id)]);
    expect([evaluate(a, g.pins, "SPELL").summary, evaluate(b, g.pins, "SPELL").summary, evaluate(a, g.pins, "SPELL").summary]).toEqual([["VALID", 2], ["INVALID", 1], ["VALID", 2]]);
    const pin = g.pins.find((p) => p.key === RULE_KEY)!;
    expect(b.bundle.definitions.find((d) => d.entityId === pin.entityId)!.entityVersionId).not.toBe(pin.entityVersionId);
    const ref = (key: string) => {
      const d = a.bundle.definitions.find((x) => x.entityId === g.pins.find((p) => p.key === key)!.entityId)!;
      return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
    };
    const mixed = compileAbilityConstruction({ contractVersion: 1, subjectKey: "x", composition: spellComposition(ref, ["spell.effect.direct_damage"]), definitions: a.bundle, ruleset: b.ruleset, character: characterOf({ "skill.arcana": "EXPERT" }), keywords: catalog, signature: { usedSlots: 0, candidate: { slotUse: "DEFAULT" } } });
    expect(mixed.ok).toBe(false);
  });
});
