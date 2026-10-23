/**
 * M5-WO11: final Maneuver cost over REAL EntityVersion storage and exact published Release history (prowess_studio_test only).
 * R1 pins Effect v1 (+1 AP); R2 pins Effect v2 (+2 AP) and the dependent authored Maneuver version. R1 keeps its cost,
 * a mixed R1 Maneuver + R2 bundle is refused, and evaluation writes nothing. Guards M5-I277 · M5-I279 · M5-I280.
 */
import { randomUUID } from "node:crypto";
import type { EntityType, JsonObject } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, compileManeuverCost, evaluateManeuverCost, type ProwessDefinitionRef } from "@prowess/game";
import { maneuverCostFixture } from "../../../prowess-game/src/testing/maneuver-cost-fixtures.js";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { it } from "vitest";
import { approveChangeSet, approveRuleset, createCanonPolicy, createChangeSet, createEntityVersion, createRuleset, createRulesetManifest, materializeProwessDefinitionsFromRelease, prisma, publishRulesetRelease, submitChangeSetForReview, submitRulesetForReview, transitionEntityVersionStatus } from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = randomUUID().replaceAll("-", ""), entityIds: string[] = [], rulesetIds: string[] = [];
const fixture = maneuverCostFixture();
const ids = new Map<string, { entityId: string; entityVersionId: string; canonicalKey: string }>(fixture.bundle.definitions.map(d => [d.entityId, { entityId: randomUUID(), entityVersionId: randomUUID(), canonicalKey: `test.wo11.${tag}.${d.canonicalKey}` }]));
const remap = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(remap);
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>, id = typeof o.entityId === "string" ? ids.get(o.entityId) : undefined;
  if (id && typeof o.entityVersionId === "string") return { ...o, ...id };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, remap(v)]));
};
const stored = (d: typeof fixture.bundle.definitions[number], payload: unknown = remap(d.payload)) => ({ [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: d.schemaVersion, definitionKind: d.definitionKind, systemFamily: d.systemFamily, payload } });
const key = (canonicalKey: string) => `test.wo11.${tag}.${canonicalKey}`;
async function snapshot() {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  const rows: unknown[] = [];
  for (const { table_name } of tables) {
    if (!/^[a-z_]+$/.test(table_name)) throw new Error("unexpected table");
    rows.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS hash FROM "${table_name}" t`));
  }
  return rows;
}
function request(m: Awaited<ReturnType<typeof materializeProwessDefinitionsFromRelease>>, name: string, signature = false) {
  const d = m.bundle.definitions.find(d => d.canonicalKey === key(name))!;
  const definition: ProwessDefinitionRef = { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  return { ...fixture.request(name, signature), definition, definitions: m.bundle, ruleset: m.ruleset };
}

describe("M5-WO11 final Maneuver cost over exact stored Release history", () => {
  beforeAll(() => assertRunningAgainstTestDatabase(getTestDatabaseUrl()));
  afterAll(async () => {
    await prisma.rulesetRelease.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSetOperation.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.changeSet.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.canonPolicy.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.updateMany({ where: { rulesetId: { in: rulesetIds } }, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });
  it("R1 cost reproduces after R2 replaces the Effect and its dependent Maneuver pin; evaluation writes nothing; mixing fails", async () => {
    const r = await createRuleset({ canonicalKey: `test.wo11.ruleset_${tag}`, name: "WO11 historical test", channel: "CORE_PLAYTEST", versionLabel: "WO11" }); rulesetIds.push(r.id);
    await submitRulesetForReview(r.id); await approveRuleset(r.id);
    for (const d of fixture.bundle.definitions) entityIds.push(ids.get(d.entityId)!.entityId);
    await prisma.entity.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityId, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as EntityType, canonicalKey: key(d.canonicalKey) })) });
    await prisma.entityVersion.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityVersionId, entityId: ids.get(d.entityId)!.entityId, revisionNumber: 1, status: "APPROVED", displayName: d.canonicalKey, structuredData: stored(d) as JsonObject })) });
    const manifest = await createRulesetManifest(r.id, { entries: [...ids.values()].map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
    const policy = await createCanonPolicy(r.id, { name: "WO11 test policy", authorities: [] });
    const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "WO11 R1" });
    const first = await materializeProwessDefinitionsFromRelease(r1.id);
    const before = await snapshot();
    const oldPlan = compileManeuverCost(request(first, "fixture.wo11.maneuver.basic")), oldResult = evaluateManeuverCost(request(first, "fixture.wo11.maneuver.basic"));
    const blow = evaluateManeuverCost(request(first, "fixture.wo11.maneuver.powerful_blow")), signature = evaluateManeuverCost(request(first, "fixture.wo11.maneuver.signature_multi", true));
    expect(await snapshot()).toEqual(before); // no persistence, no resource mutation
    expect(oldResult.ok && [oldResult.value.status, oldResult.value.ap.baseApCost, oldResult.value.ap.finalApCost, oldResult.value.mp.finalMpCost]).toEqual(["VALID", 3, 2, 0]);
    expect(blow.ok && [blow.value.ap.baseApCost, blow.value.structure.separateAttackResolutions, blow.value.ap.finalApCost]).toEqual([8, 1, 5]);
    expect(signature.ok && [signature.value.ap.conditionAttackFloor, signature.value.ap.postConditionApCost, signature.value.ap.finalApCost]).toEqual([2, 2, 1]);
    const effect = fixture.bundle.definitions.find(d => d.canonicalKey === "fixture.wo11.effect.push")!, effectId = ids.get(effect.entityId)!;
    const changed = JSON.parse(JSON.stringify(remap(effect.payload))) as JsonObject;
    changed.costContributions = [{ contributionKey: "effect.push.ap", currency: "AP", data: { kind: "FIXED", amount: 2 } }];
    const v2 = await createEntityVersion(effectId.entityId, { displayName: "fixture.wo11.effect.push v2", structuredData: stored(effect, changed) });
    await transitionEntityVersionStatus(v2.id, "IN_REVIEW"); await transitionEntityVersionStatus(v2.id, "APPROVED");
    const operations: { operationType: "REPLACE_ENTITY_VERSION"; targetEntityId: string; fromEntityVersionId: string; toEntityVersionId: string }[] = [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: effectId.entityId, fromEntityVersionId: effectId.entityVersionId, toEntityVersionId: v2.id }];
    const maneuver = fixture.bundle.definitions.find(d => d.canonicalKey === "fixture.wo11.maneuver.basic")!, maneuverId = ids.get(maneuver.entityId)!;
    const repinned = JSON.parse(JSON.stringify(remap(maneuver.payload)).replaceAll(effectId.entityVersionId, v2.id)) as JsonObject;
    const m2 = await createEntityVersion(maneuverId.entityId, { displayName: "fixture.wo11.maneuver.basic v2", structuredData: stored(maneuver, repinned) });
    await transitionEntityVersionStatus(m2.id, "IN_REVIEW"); await transitionEntityVersionStatus(m2.id, "APPROVED");
    operations.push({ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: maneuverId.entityId, fromEntityVersionId: maneuverId.entityVersionId, toEntityVersionId: m2.id });
    const cs = await createChangeSet(r.id, { name: "WO11 Effect v2", operations }); await submitChangeSetForReview(cs.id); await approveChangeSet(cs.id);
    const r2 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: r1.manifestId, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "WO11 R2" });
    const second = await materializeProwessDefinitionsFromRelease(r2.id), result = evaluateManeuverCost(request(second, "fixture.wo11.maneuver.basic"));
    expect(result.ok && [result.value.status, result.value.ap.baseApCost, result.value.ap.finalApCost]).toEqual(["VALID", 4, 3]);
    const again = await materializeProwessDefinitionsFromRelease(r1.id); expect(again).toEqual(first);
    expect(compileManeuverCost(request(again, "fixture.wo11.maneuver.basic"))).toEqual(oldPlan);
    expect(evaluateManeuverCost(request(again, "fixture.wo11.maneuver.basic"))).toEqual(oldResult);
    expect(compileManeuverCost({ ...request(first, "fixture.wo11.maneuver.basic"), definitions: second.bundle }).ok).toBe(false);
  }, 180_000);
});
