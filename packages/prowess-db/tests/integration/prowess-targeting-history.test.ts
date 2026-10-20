/**
 * M5-WO6 Targeting against the REAL database — exact Release history, cross-Ruleset isolation and no persistence (PAS-10
 * M5-WO6 §112–§116, §122, §190–§191). Runs only against prowess_studio_test (guarded).
 *
 * The canonical Targeting Definitions (packages/prowess-game/src/content/core-playtest-v0.1/targeting.json) are stored,
 * with the WO2 / WO3 core content, the WO4 Affinity content and neutral test components, as ordinary EntityVersions
 * (structuredData.prowessDefinition) under EntityType TARGETING (both Targeting families) and the component entity types
 * — no schema change, no migration.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I176 Targeting plans cite the exact Targeting
 * EntityVersion of each Release · R1 reproduces after R2 pins a new Radius version; Rulesets never mix.
 */
import type { CreateChangeSetOperationInput } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, compileAbilityTargeting, readAbilityTargetingRun, type ProwessDefinitionBundle } from "@prowess/game";
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
import { KEYWORD_CONTENT, TARGETING_DEFINITIONS, characterOf, spellWith, type ContentDefinition } from "../fixtures/m5-wo6-targeting-catalog";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const rulesetIds: string[] = [];
const entityIds: string[] = [];
const createdKeywordIds: string[] = [];
let createdCategoryId: string | null = null;
let catalog: { keywordId: string; canonicalKey: string; categoryId: string | null }[] = [];
const RADIUS = "spell.targeting.radius";

const stored = (d: ContentDefinition, payload: Record<string, unknown> = d.payload) => ({
  [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: d.schemaVersion, systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family, definitionKind: d.definitionKind, payload, ...(d.canonicalKey === "affinity.evocation" ? { legacyTerms: [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }] } : {}) },
});
async function version(entityId: string, name: string, structuredData: object) {
  const v = await createEntityVersion(entityId, { displayName: name, structuredData });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}

async function keywordCatalog() {
  const existingCategory = await prisma.keywordCategory.findUnique({ where: { canonicalKey: KEYWORD_CONTENT.keywordCategory.canonicalKey } });
  const category = existingCategory ?? (await createKeywordCategory({ canonicalKey: KEYWORD_CONTENT.keywordCategory.canonicalKey, name: KEYWORD_CONTENT.keywordCategory.name }));
  if (existingCategory === null) createdCategoryId = category.id;
  const out: typeof catalog = [];
  for (const k of KEYWORD_CONTENT.keywords) {
    const found = await prisma.keywordDefinition.findUnique({ where: { canonicalKey: k.canonicalKey } });
    const kw = found ?? (await createKeywordDefinition({ canonicalKey: k.canonicalKey, name: k.name, categoryId: category.id }));
    if (found === null) createdKeywordIds.push(kw.id);
    out.push({ keywordId: kw.id, canonicalKey: kw.canonicalKey, categoryId: kw.categoryId ?? null });
  }
  return out;
}

async function publishR1(label: string) {
  const r = await createRuleset({ canonicalKey: `test.ruleset.m5targeting_${label}_${tag}_${next()}`, name: `M5 Targeting ${label}`, channel: "CORE_PLAYTEST", versionLabel: `m5 targeting ${label}` });
  rulesetIds.push(r.id);
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const pins: { entityId: string; entityVersionId: string; key: string }[] = [];
  for (const d of TARGETING_DEFINITIONS) {
    const e = await createEntity({ entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as string, canonicalKey: `test.m5targeting.${d.canonicalKey.replace(/\./g, "_")}_${tag}_${next()}` });
    entityIds.push(e.id);
    const v = await version(e.id, `${d.canonicalKey} v1`, stored(d));
    pins.push({ entityId: e.id, entityVersionId: v.id, key: d.canonicalKey });
  }
  const m = await createRulesetManifest(r.id, { entries: pins.map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
  const policy = await createCanonPolicy(r.id, { name: `P ${next()}`, authorities: [] });
  const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: `${label} R1` });
  return { r, pins, policy, r1 };
}

/** R2: the same Ruleset with a test-only revised Spell Radius (radius 10 × PRO) through a ChangeSet. */
async function publishR2(g: Awaited<ReturnType<typeof publishR1>>, label: string) {
  const pin = g.pins.find((p) => p.key === RADIUS)!;
  const def = TARGETING_DEFINITIONS.find((d) => d.canonicalKey === RADIUS)!;
  const payload = JSON.parse(JSON.stringify(def.payload)) as { rules: { targeting: { measures: { formula: { expression: string } }[] } } };
  payload.rules.targeting.measures[0]!.formula.expression = "10 * pro";
  const v2 = await version(pin.entityId, `${RADIUS} v2`, stored(def, payload as unknown as Record<string, unknown>));
  const operations: CreateChangeSetOperationInput[] = [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: pin.entityId, fromEntityVersionId: pin.entityVersionId, toEntityVersionId: v2.id }];
  const cs = await createChangeSet(g.r.id, { name: `cs ${next()}`, operations });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  return publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: g.r1.manifestId, canonPolicyId: g.policy.id, changeSetId: cs.id, versionLabel: label });
}

type Pins = { entityId: string; key: string }[];
function evaluate(materialized: { ruleset: RulesetContext; bundle: ProwessDefinitionBundle }, pins: Pins) {
  const ref = (key: string) => {
    const entityId = pins.find((p) => p.key === key)!.entityId;
    const d = materialized.bundle.definitions.find((x) => x.entityId === entityId)!;
    return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  };
  const plan = compileAbilityTargeting({ contractVersion: 1, subjectKey: "history", composition: spellWith(ref, RADIUS), definitions: materialized.bundle, ruleset: materialized.ruleset, character: characterOf({ PER: 5, PRO: 3 }), keywords: catalog });
  if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo6.history", contexts: { ruleset: materialized.ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(JSON.stringify(response.errors));
  const reading = readAbilityTargetingRun({ plan: plan.value, run: response.data });
  if (!reading.ok) throw new Error(JSON.stringify(reading.problems));
  const radius = reading.value.geometry.find((g) => g.measure === "RADIUS")?.value;
  return { plan: plan.value, run: response.data, result: reading.value, summary: [reading.value.range.value, radius, reading.value.cost.base] };
}

async function fingerprint() {
  const [entities, versions, rulesets, releases, keywords] = await Promise.all([prisma.entity.count(), prisma.entityVersion.count(), prisma.ruleset.count(), prisma.rulesetRelease.count(), prisma.keywordDefinition.count()]);
  return { entities, versions, rulesets, releases, keywords };
}

describe("M5-WO6 Targeting — exact Release history and isolation (prowess_studio_test only)", () => {
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

  it("§190 R1 evaluates; after R2 pins a new Radius version, R1 re-materializes and re-evaluates identically; evaluation writes nothing (M5-I176)", async () => {
    const g = await publishR1("history");
    const first = await materializeProwessDefinitionsFromRelease(g.r1.id);
    const radius = first.bundle.definitions.find((d) => d.entityId === g.pins.find((p) => p.key === RADIUS)!.entityId)!;
    expect([radius.definitionKind, radius.schemaVersion]).toEqual(["SPELL_TARGETING", 1]);
    expect(first.bundle.definitions.filter((d) => d.definitionKind === "SPELL_TARGETING")).toHaveLength(10);
    expect(first.bundle.definitions.filter((d) => d.definitionKind === "MANEUVER_TARGETING")).toHaveLength(9);
    const before = await fingerprint();
    const r1 = evaluate(first, g.pins);
    expect(await fingerprint()).toEqual(before); // §122: evaluation persists nothing
    expect(r1.summary).toEqual([75, 15, { status: "LISTED", currency: "MP", amount: 6, contributionKey: "targeting.base" }]);
    expect(r1.plan.rulesetProvenance.release).toEqual({ releaseId: g.r1.id, releaseNumber: 1, versionLabel: "history R1" });
    const cited = new Set(r1.plan.sourceMap.entries.flatMap((e) => e.definitions.map((d) => d.entityVersionId as string)));
    expect(cited.has(radius.entityVersionId)).toBe(true);

    const release2 = await publishR2(g, "history R2");
    const second = await materializeProwessDefinitionsFromRelease(release2.id);
    expect(evaluate(second, g.pins).summary).toEqual([75, 30, { status: "LISTED", currency: "MP", amount: 6, contributionKey: "targeting.base" }]);

    const again = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(again).toEqual(first);
    const r1Again = evaluate(again, g.pins);
    expect([r1Again.plan, r1Again.run, r1Again.result]).toEqual([r1.plan, r1.run, r1.result]);
  });

  it("§191 R1 and R2 evaluate concurrently with their own exact Radius; a bundle never runs under another Release", async () => {
    const g = await publishR1("isolation");
    const release2 = await publishR2(g, "isolation R2");
    const [a, b] = await Promise.all([materializeProwessDefinitionsFromRelease(g.r1.id), materializeProwessDefinitionsFromRelease(release2.id)]);
    expect([evaluate(a, g.pins).summary[1], evaluate(b, g.pins).summary[1], evaluate(a, g.pins).summary[1]]).toEqual([15, 30, 15]);
    const pin = g.pins.find((p) => p.key === RADIUS)!;
    const v2 = b.bundle.definitions.find((d) => d.entityId === pin.entityId)!.entityVersionId;
    expect(v2).not.toBe(pin.entityVersionId);
    expect([evaluate(a, g.pins).result.targeting.definition.entityVersionId, evaluate(b, g.pins).result.targeting.definition.entityVersionId]).toEqual([pin.entityVersionId, v2]);
    const ref = (key: string) => {
      const d = a.bundle.definitions.find((x) => x.entityId === g.pins.find((p) => p.key === key)!.entityId)!;
      return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
    };
    const mixed = compileAbilityTargeting({ contractVersion: 1, subjectKey: "x", composition: spellWith(ref, RADIUS), definitions: a.bundle, ruleset: b.ruleset, character: characterOf({ PER: 5, PRO: 3 }), keywords: catalog });
    expect(mixed.ok).toBe(false);
  });
});
