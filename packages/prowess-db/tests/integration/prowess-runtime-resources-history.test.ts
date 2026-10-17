/**
 * M5-WO3 runtime Resources and action economy against the REAL database — exact Release history and cross-Ruleset
 * isolation (PAS-10 M5-WO3 §200–§201). Runs only against prowess_studio_test (guarded). The canonical Core Playtest
 * Definitions come from packages/prowess-game/src/content/core-playtest-v0.1/{core-resolution,runtime-resources}.json
 * and are stored as ordinary EntityVersions (structuredData.prowessDefinition) under the M1 EntityType each Definition
 * kind requires (RESOURCE for RESOURCE, GENERIC_RULE otherwise) — no schema change, no migration, no Encounter table.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I097 core Action costs are versioned Definitions —
 * an R2 cost change never alters R1 · M5-I105 runtime evaluation never persists Resource state (row fingerprint
 * unchanged by evaluation) · M5-I106 every step cites exact EntityVersions of exactly its Release.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CreateChangeSetOperationInput } from "@prowess/model";
import {
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_STORAGE_KEY,
  buildRuntimeContexts,
  compileRuntime,
  confirmActionPayment,
  readRuntimeRun,
  type ProwessDefinitionBundle,
  type ProwessDefinitionKind,
} from "@prowess/game";
import { orchestrateRulesEvaluation, type RulesetContext } from "@prowess/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveChangeSet,
  approveRuleset,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityVersion,
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
  payload: Record<string, unknown>;
}
const CONTENT_DIR = path.resolve(import.meta.dirname, "../../../prowess-game/src/content/core-playtest-v0.1");
const load = (file: string) => (JSON.parse(readFileSync(path.join(CONTENT_DIR, file), "utf8")) as { definitions: ContentDefinition[] }).definitions;
const DEFINITIONS = [...load("core-resolution.json"), ...load("runtime-resources.json")];

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const rulesetIds: string[] = [];
const entityIds: string[] = [];

const stored = (d: ContentDefinition, payload: Record<string, unknown> = d.payload) => ({
  [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: 1, systemFamily: PROWESS_DEFINITION_KINDS[d.definitionKind].family, definitionKind: d.definitionKind, payload },
});
async function version(entityId: string, name: string, structuredData: object) {
  const v = await createEntityVersion(entityId, { displayName: name, structuredData });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}

/** R1: every canonical Core Playtest Definition (core + runtime), v1, published as an exact Release. */
async function publishR1(label: string) {
  const r = await createRuleset({ canonicalKey: `test.ruleset.m5runtime_${label}_${tag}_${next()}`, name: `M5 Runtime ${label}`, channel: "CORE_PLAYTEST", versionLabel: `m5 runtime ${label}` });
  rulesetIds.push(r.id);
  await submitRulesetForReview(r.id);
  await approveRuleset(r.id);
  const pins: { entityId: string; entityVersionId: string; key: string }[] = [];
  for (const d of DEFINITIONS) {
    const e = await createEntity({ entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as string, canonicalKey: `test.m5runtime.${d.canonicalKey.replace(/\./g, "_")}_${tag}_${next()}` });
    entityIds.push(e.id);
    const v = await version(e.id, `${d.canonicalKey} v1`, stored(d));
    pins.push({ entityId: e.id, entityVersionId: v.id, key: d.canonicalKey });
  }
  const m = await createRulesetManifest(r.id, { entries: pins.map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
  const policy = await createCanonPolicy(r.id, { name: `P ${next()}`, authorities: [] });
  const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: `${label} R1` });
  return { r, pins, policy, r1 };
}

/** R2: the same Ruleset with test-only revised Definition payloads (new EntityVersions through a ChangeSet). */
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

const CHARACTER = { level: 1, characterDie: { dieKey: "D4" }, stats: { STR: 3, AGI: 6, CON: 3, PER: 3, RES: 3, PRO: 5 }, baseHp: 10, baseMp: 15, skillRanks: [], explicitBonuses: [] };

/** Compile (pure domain) → evaluate (frozen M4) → read, for one exact materialized Release. */
function evaluateRuntime(materialized: { ruleset: RulesetContext; bundle: ProwessDefinitionBundle }) {
  const run = (subject: Record<string, unknown>, resources: unknown, combat?: unknown) => {
    const request = { contractVersion: 1, subject, definitions: materialized.bundle, ruleset: materialized.ruleset, character: CHARACTER, resources, ...(combat === undefined ? {} : { combat }) };
    const plan = compileRuntime(request);
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    const ctx = buildRuntimeContexts({ definitions: materialized.bundle, character: CHARACTER, resources, ...(combat === undefined ? {} : { combat }) });
    if (!ctx.ok) throw new Error(JSON.stringify(ctx.problems));
    const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo3.history", contexts: { ruleset: materialized.ruleset, actor: ctx.value.actor, runtime: ctx.value.runtime }, plan: plan.value.evaluationPlan });
    if (!response.success || response.data === null) throw new Error(JSON.stringify(response.errors));
    const reading = readRuntimeRun({ plan: plan.value, run: response.data, resources: ctx.value.resources });
    if (!reading.ok) throw new Error(JSON.stringify(reading.problems));
    return { plan: plan.value, run: response.data, reading: reading.value, before: ctx.value.resources };
  };
  const heavy = run({ kind: "ACTION_PAYMENT", subjectKey: "strike", actionKey: "HEAVY_ATTACK", window: "OWN_TURN" }, { resources: [{ resourceKey: "AP", current: 5 }] });
  const confirmation = confirmActionPayment({ plan: heavy.plan, run: heavy.run, resources: heavy.before });
  if (!confirmation.ok) throw new Error(JSON.stringify(confirmation.problems));
  const mana = run({ kind: "MAGICAL_PAYMENT", subjectKey: "cast", costKey: "spell.test", listedAmount: 8, meEligible: true }, { resources: [{ resourceKey: "MP", current: 18 }, { resourceKey: "ME", current: 5 }] });
  const round = run({ kind: "RESOURCE_TIMING", subjectKey: "round", event: "START_OF_ROUND" }, { resources: [{ resourceKey: "ME", current: 1 }, { resourceKey: "COUNTER_ACTION", current: 0 }] }, { round: 1, surprised: false });
  const current = (r: { reading: { resources: { resources: readonly { resourceKey: string; current: number }[] } } }, key: string) => r.reading.resources.resources.find((s) => s.resourceKey === key)?.current;
  return {
    heavy,
    summary: {
      heavyListed: heavy.reading.payments[0]?.listedAmount,
      heavyStatus: confirmation.value.status,
      apAfterHeavy: confirmation.value.resources.resources[0]?.current,
      manaAllocations: mana.reading.payments[0]?.allocations.map((a) => [a.resourceKey, a.amountPaid]),
      mpAfter: current(mana, "MP"),
      meAfterRefresh: current(round, "ME"),
      counterAfterRefresh: current(round, "COUNTER_ACTION"),
    },
  };
}

async function fingerprint() {
  const [entities, versions, rulesets, releases] = await Promise.all([prisma.entity.count(), prisma.entityVersion.count(), prisma.ruleset.count(), prisma.rulesetRelease.count()]);
  return { entities, versions, rulesets, releases };
}

describe("M5-WO3 runtime Resources — exact Release history and isolation (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
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
  });

  it("§200 R1 evaluates the runtime fixture; after R2 changes an Action cost, R1 re-evaluates identically; evaluation writes nothing", async () => {
    const g = await publishR1("history");
    const first = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(first.bundle.definitions).toHaveLength(DEFINITIONS.length);
    expect(first.bundle.definitions.filter((d) => d.definitionKind === "RESOURCE")).toHaveLength(6);
    const before = await fingerprint();
    const r1 = evaluateRuntime(first);
    expect(await fingerprint()).toEqual(before); // M5-I105: evaluation persists nothing
    expect(r1.summary).toEqual({ heavyListed: 3, heavyStatus: "PAID", apAfterHeavy: 2, manaAllocations: [["ME", 5], ["MP", 3]], mpAfter: 15, meAfterRefresh: 5, counterAfterRefresh: 1 });
    expect(r1.heavy.plan.rulesetProvenance.release).toEqual({ releaseId: g.r1.id, releaseNumber: 1, versionLabel: "history R1" });

    const heavy = DEFINITIONS.find((d) => d.canonicalKey === "action.attack.heavy")!;
    const release2 = await publishR2(g, { "action.attack.heavy": { ...heavy.payload, actionPointCost: { model: "FIXED", amount: 4 } } }, "history R2");
    const second = await materializeProwessDefinitionsFromRelease(release2.id);
    const r2 = evaluateRuntime(second);
    expect(r2.summary).toEqual({ ...r1.summary, heavyListed: 4, apAfterHeavy: 1 });

    const again = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(again).toEqual(first);
    const r1Again = evaluateRuntime(again);
    expect(r1Again.summary).toEqual(r1.summary);
    expect(r1Again.heavy.plan).toEqual(r1.heavy.plan);
    expect(r1Again.heavy.run).toEqual(r1.heavy.run);
  });

  it("§201 R1 and R2 evaluate concurrently without cross-contamination; a bundle never runs under another Release", async () => {
    const g = await publishR1("isolation");
    const pin = g.pins.find((p) => p.key === "action.attack.heavy")!;
    const heavy = DEFINITIONS.find((d) => d.canonicalKey === "action.attack.heavy")!;
    const release2 = await publishR2(g, { "action.attack.heavy": { ...heavy.payload, actionPointCost: { model: "FIXED", amount: 5 } } }, "isolation R2");
    const [a, b] = await Promise.all([materializeProwessDefinitionsFromRelease(g.r1.id), materializeProwessDefinitionsFromRelease(release2.id)]);
    const [ra, rb] = [evaluateRuntime(a), evaluateRuntime(b)];
    expect([ra.summary.heavyListed, rb.summary.heavyListed]).toEqual([3, 5]);
    const cited = (x: typeof ra) => new Set<string>(x.heavy.plan.sourceMap.entries.flatMap((e) => e.definitions.map((d) => d.entityVersionId as string)));
    const v2 = b.bundle.definitions.find((d) => d.entityId === pin.entityId)!.entityVersionId as string;
    expect(v2).not.toBe(pin.entityVersionId);
    expect(cited(ra).has(pin.entityVersionId) && !cited(ra).has(v2)).toBe(true);
    expect(cited(rb).has(v2) && !cited(rb).has(pin.entityVersionId)).toBe(true);
    const mixed = compileRuntime({ contractVersion: 1, subject: { kind: "RESOURCE_STATE", subjectKey: "s" }, definitions: a.bundle, ruleset: b.ruleset, character: CHARACTER, resources: { resources: [{ resourceKey: "AP", current: 1 }] } });
    expect(mixed.ok).toBe(false);
  });
});
