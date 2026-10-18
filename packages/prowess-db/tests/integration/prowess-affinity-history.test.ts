/**
 * M5-WO4 Affinity against the REAL database — exact Release history, cross-Ruleset isolation and real M1 Keyword
 * identity (PAS-10 M5-WO4 §146, §170, §173, §197–§198, §273–§275). Runs only against prowess_studio_test (guarded).
 *
 * The canonical Affinity Definitions come from packages/prowess-game/src/content/core-playtest-v0.1/affinity.json and are
 * stored as ordinary EntityVersions (structuredData.prowessDefinition, AFFINITY payload schemaVersion 2) under
 * GENERIC_RULE — no schema change, no migration. The Keywords the rules match are real M1 KeywordDefinition rows: the
 * catalog handed to the pure compiler is read from the database, so Affinity matching uses exact M1 Keyword identity.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I146 Affinity Definitions, rank rules and Keyword
 * contributions preserve exact Ruleset / EntityVersion provenance · M5-I147 historical Affinity evaluation never
 * resolves through latest or current content (R1 reproduces after R2 pins a new Evocation version).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CreateChangeSetOperationInput } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, compileAffinity, readAffinityRun, type ProwessDefinitionBundle, type ProwessDefinitionKind } from "@prowess/game";
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
import { getTestDatabaseUrl } from "./env";

interface ContentDefinition {
  canonicalKey: string;
  definitionKind: ProwessDefinitionKind;
  schemaVersion: number;
  payload: Record<string, unknown>;
}
const CONTENT = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../prowess-game/src/content/core-playtest-v0.1/affinity.json"), "utf8")) as {
  definitions: ContentDefinition[];
  keywords: { canonicalKey: string; name: string }[];
  keywordCategory: { canonicalKey: string; name: string };
};
/** Neutral test components: they only state explicit Keywords (the Spell Effect catalog is a later Work Order). */
const component = (canonicalKey: string, definitionKind: ProwessDefinitionKind, payload: Record<string, unknown>): ContentDefinition => ({ canonicalKey, definitionKind, schemaVersion: 1, payload });
const DEFINITIONS: ContentDefinition[] = [
  ...CONTENT.definitions,
  component("spell.targeting.single", "SPELL_TARGETING", { semanticShape: "SINGLE_TARGET", geometry: { origin: "CASTER" } }),
  component("spell.effect.direct_damage", "SPELL_EFFECT", { effectFamily: "DAMAGE", resolution: null, outcomes: [], keywords: ["keyword.direct_damage"] }),
  component("spell.effect.healing", "SPELL_EFFECT", { effectFamily: "HEALING", resolution: null, outcomes: [], keywords: ["keyword.healing"] }),
  component("spell.duration.instant", "SPELL_DURATION", { durationConcept: "INSTANT" }),
];

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const rulesetIds: string[] = [];
const entityIds: string[] = [];
const createdKeywordIds: string[] = [];
let createdCategoryId: string | null = null;
let catalog: { keywordId: string; canonicalKey: string; categoryId: string | null }[] = [];

const stored = (d: ContentDefinition, payload: Record<string, unknown> = d.payload) => ({
  [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: d.schemaVersion, systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family, definitionKind: d.definitionKind, payload, ...(d.canonicalKey === "affinity.evocation" ? { legacyTerms: [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }] } : {}) },
});
async function version(entityId: string, name: string, structuredData: object) {
  const v = await createEntityVersion(entityId, { displayName: name, structuredData });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}

/** The exact M1 Keywords the Affinity rules name: reused when present, created (and later removed) when not. */
async function keywordCatalog() {
  const existingCategory = await prisma.keywordCategory.findUnique({ where: { canonicalKey: CONTENT.keywordCategory.canonicalKey } });
  const category = existingCategory ?? (await createKeywordCategory({ canonicalKey: CONTENT.keywordCategory.canonicalKey, name: CONTENT.keywordCategory.name }));
  if (existingCategory === null) createdCategoryId = category.id;
  const out: typeof catalog = [];
  for (const k of CONTENT.keywords) {
    const found = await prisma.keywordDefinition.findUnique({ where: { canonicalKey: k.canonicalKey } });
    const kw = found ?? (await createKeywordDefinition({ canonicalKey: k.canonicalKey, name: k.name, categoryId: category.id }));
    if (found === null) createdKeywordIds.push(kw.id);
    out.push({ keywordId: kw.id, canonicalKey: kw.canonicalKey, categoryId: kw.categoryId ?? null });
  }
  return out;
}

/** R1: every canonical Affinity Definition plus the neutral test components, published as an exact Release. */
async function publishR1(label: string) {
  const r = await createRuleset({ canonicalKey: `test.ruleset.m5affinity_${label}_${tag}_${next()}`, name: `M5 Affinity ${label}`, channel: "CORE_PLAYTEST", versionLabel: `m5 affinity ${label}` });
  rulesetIds.push(r.id);
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const pins: { entityId: string; entityVersionId: string; key: string }[] = [];
  for (const d of DEFINITIONS) {
    const e = await createEntity({ entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as string, canonicalKey: `test.m5affinity.${d.canonicalKey.replace(/\./g, "_")}_${tag}_${next()}` });
    entityIds.push(e.id);
    const v = await version(e.id, `${d.canonicalKey} v1`, stored(d));
    pins.push({ entityId: e.id, entityVersionId: v.id, key: d.canonicalKey });
  }
  const m = await createRulesetManifest(r.id, { entries: pins.map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
  const policy = await createCanonPolicy(r.id, { name: `P ${next()}`, authorities: [] });
  const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: `${label} R1` });
  return { r, pins, policy, r1 };
}

/** R2: the same Ruleset with a test-only revised Evocation (a new EntityVersion through a ChangeSet). */
async function publishR2(g: Awaited<ReturnType<typeof publishR1>>, revise: Record<string, Record<string, unknown>>, label: string) {
  const operations: CreateChangeSetOperationInput[] = [];
  for (const [key, payload] of Object.entries(revise)) {
    const pin = g.pins.find((p) => p.key === key)!;
    const def = DEFINITIONS.find((d) => d.canonicalKey === key)!;
    const v2 = await version(pin.entityId, `${key} v2`, stored(def, payload));
    operations.push({ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: pin.entityId, fromEntityVersionId: pin.entityVersionId, toEntityVersionId: v2.id });
  }
  const cs = await createChangeSet(g.r.id, { name: `cs ${next()}`, operations });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  return publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: g.r1.manifestId, canonPolicyId: g.policy.id, changeSetId: cs.id, versionLabel: label });
}

/** Compile (pure domain) → evaluate (frozen M4) → read, for one exact materialized Release. */
type Pins = { entityId: string; key: string }[];
function evaluateAffinity(materialized: { ruleset: RulesetContext; bundle: ProwessDefinitionBundle }, pins: Pins, rank = "EXPERT") {
  // Stored Entities carry test-unique canonical keys, so a content key is resolved through its pinned Entity id.
  const ref = (key: string) => {
    const entityId = pins.find((p) => p.key === key)!.entityId;
    const d = materialized.bundle.definitions.find((x) => x.entityId === entityId)!;
    return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  };
  const composition = {
    compositionKey: "composition.spell.history",
    abilityKind: "SPELL",
    affinity: { componentKey: "affinity", definition: ref("affinity.evocation"), parameters: {} },
    authority: null,
    keywords: [],
    targeting: { componentKey: "targeting", definition: ref("spell.targeting.single"), parameters: {} },
    effects: [
      { componentKey: "damage", order: 10, definition: ref("spell.effect.direct_damage"), parameters: {} },
      { componentKey: "healing", order: 20, definition: ref("spell.effect.healing"), parameters: {} },
    ],
    traits: [],
    duration: { componentKey: "duration", definition: ref("spell.duration.instant"), parameters: {} },
    conditions: [],
    branch: { kind: "SPELL", effectChain: null, sustain: null, concentration: null, data: {} },
  };
  const profile = { affinities: [{ affinity: ref("affinity.evocation"), rank, role: "PRIMARY", acquisition: null }] };
  const plan = compileAffinity({ contractVersion: 1, subject: { kind: "SPELL_AFFINITY_COST", subjectKey: "history", composition, costTarget: "LISTED_MP_COST", baseCost: 100 }, definitions: materialized.bundle, ruleset: materialized.ruleset, profile, keywords: catalog });
  if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo4.history", contexts: { ruleset: materialized.ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(JSON.stringify(response.errors));
  const reading = readAffinityRun({ plan: plan.value, run: response.data });
  if (!reading.ok) throw new Error(JSON.stringify(reading.problems));
  return { plan: plan.value, run: response.data, reading: reading.value, summary: { alignment: reading.value.alignment?.alignment, cost: reading.value.cost?.affinityAdjustedCost, discount: reading.value.alignment?.effectiveStrengthDiscountPercent, weakness: reading.value.alignment?.selectedWeaknessPercent } };
}

async function fingerprint() {
  const [entities, versions, rulesets, releases, keywords] = await Promise.all([prisma.entity.count(), prisma.entityVersion.count(), prisma.ruleset.count(), prisma.rulesetRelease.count(), prisma.keywordDefinition.count()]);
  return { entities, versions, rulesets, releases, keywords };
}

describe("M5-WO4 Affinity — exact Release history, isolation and M1 Keyword identity (prowess_studio_test only)", () => {
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

  it("§197 / §273–§274 R1 evaluates; after R2 pins a new Evocation version, R1 re-materializes and re-evaluates identically; evaluation writes nothing (M5-I146, M5-I147)", async () => {
    const g = await publishR1("history");
    const first = await materializeProwessDefinitionsFromRelease(g.r1.id);
    const evocation = first.bundle.definitions.find((d) => d.entityId === g.pins.find((p) => p.key === "affinity.evocation")!.entityId)!;
    expect([evocation.definitionKind, evocation.schemaVersion]).toEqual(["AFFINITY", 2]);
    expect(first.bundle.definitions.filter((d) => d.definitionKind === "AFFINITY")).toHaveLength(6);
    const before = await fingerprint();
    const r1 = evaluateAffinity(first, g.pins);
    expect(await fingerprint()).toEqual(before); // §173: evaluation persists nothing (no rank, choice, canon or Keyword change)
    expect(r1.summary).toEqual({ alignment: "STRENGTH_AND_WEAKNESS", cost: 104, discount: 20, weakness: 30 });
    expect(r1.plan.rulesetProvenance.release).toEqual({ releaseId: g.r1.id, releaseNumber: 1, versionLabel: "history R1" });
    // M5-I146: the plan cites exact EntityVersions of THIS Release; the matched Keyword names its exact contributor.
    const cited = new Set(r1.plan.sourceMap.entries.flatMap((e) => e.definitions.map((d) => d.entityVersionId as string)));
    expect(cited.has(evocation.entityVersionId)).toBe(true);
    const strength = r1.reading.alignment?.strengths.find((s) => s.matched);
    expect(strength?.matchedKeywords[0]?.keywordId).toBe(catalog.find((k) => k.canonicalKey === "keyword.direct_damage")?.keywordId);
    expect(strength?.matchedKeywords[0]?.contributors[0]?.definition?.entityVersionId).toBe(first.bundle.definitions.find((d) => d.entityId === g.pins.find((p) => p.key === "spell.effect.direct_damage")!.entityId)!.entityVersionId);

    const payload = DEFINITIONS.find((d) => d.canonicalKey === "affinity.evocation")!.payload;
    const release2 = await publishR2(g, { "affinity.evocation": { ...payload, strengths: [{ strengthKey: "AREA_EFFECT", matchAny: ["keyword.area_effect"] }] } }, "history R2");
    const second = await materializeProwessDefinitionsFromRelease(release2.id);
    expect(evaluateAffinity(second, g.pins).summary).toEqual({ alignment: "WEAKNESS", cost: 130, discount: 0, weakness: 30 });

    const again = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(again).toEqual(first);
    const r1Again = evaluateAffinity(again, g.pins);
    expect(r1Again.summary).toEqual(r1.summary);
    expect(r1Again.plan).toEqual(r1.plan);
    expect(r1Again.run).toEqual(r1.run);
  });

  it("§198 / §275 R1 and R2 evaluate concurrently with their own exact Affinity Definition; a bundle never runs under another Release", async () => {
    const g = await publishR1("isolation");
    const pin = g.pins.find((p) => p.key === "affinity.evocation")!;
    const payload = DEFINITIONS.find((d) => d.canonicalKey === "affinity.evocation")!.payload;
    const weaknesses = (payload.weaknesses as { weaknessKey: string }[]).map((w) => (w.weaknessKey === "HEALING" ? { ...w, activationPenaltyPercent: 50, severity: null } : w));
    const release2 = await publishR2(g, { "affinity.evocation": { ...payload, weaknesses } }, "isolation R2");
    const [a, b] = await Promise.all([materializeProwessDefinitionsFromRelease(g.r1.id), materializeProwessDefinitionsFromRelease(release2.id)]);
    const [ra, rb] = [evaluateAffinity(a, g.pins), evaluateAffinity(b, g.pins)];
    expect([ra.summary.cost, rb.summary.cost]).toEqual([104, 120]);
    const v2 = b.bundle.definitions.find((d) => d.entityId === pin.entityId)!.entityVersionId as string;
    expect(v2).not.toBe(pin.entityVersionId);
    expect([ra.reading.alignment?.governingAffinity.affinity.entityVersionId, rb.reading.alignment?.governingAffinity.affinity.entityVersionId]).toEqual([pin.entityVersionId, v2]);
    const mixed = compileAffinity({ contractVersion: 1, subject: { kind: "AFFINITY_ACCESS", subjectKey: "x", requirements: [] }, definitions: a.bundle, ruleset: b.ruleset, profile: { affinities: [] }, keywords: catalog });
    expect(mixed.ok).toBe(false);
  });
});
