/**
 * M5-WO12: Effect-chain execution over REAL EntityVersion storage and exact published Release history (prowess_studio_test
 * only). R1 pins a Spell whose first Effect is SUCCESS_ONLY; R2 replaces it with a version whose first Effect is CONTINUE.
 * After R2 is published, R1 still routes a miss to SUCCESS_ONLY_FAILURE (Effect 2 never reached) with an identical plan
 * and result, R2 continues to Effect 2, a mixed R1 Spell + R2 bundle is refused, and execution writes nothing.
 * Guards M5-I315.
 */
import { randomUUID } from "node:crypto";
import type { EntityType, JsonObject } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, compileAbilityExecution, executeAbilityResolution, type ProwessDefinitionRef } from "@prowess/game";
import { attackInput, executionFixture, playExecution, saveInput, type ExecutionAnswer } from "../../../prowess-game/src/testing/effect-execution-fixtures.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveChangeSet, approveRuleset, createCanonPolicy, createChangeSet, createEntityVersion, createRuleset, createRulesetManifest, materializeProwessDefinitionsFromRelease, prisma, publishRulesetRelease, submitChangeSetForReview, submitRulesetForReview, transitionEntityVersionStatus } from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = randomUUID().replaceAll("-", ""), entityIds: string[] = [], rulesetIds: string[] = [];
const fixture = executionFixture();
const ids = new Map<string, { entityId: string; entityVersionId: string; canonicalKey: string }>(fixture.bundle.definitions.map(d => [d.entityId, { entityId: randomUUID(), entityVersionId: randomUUID(), canonicalKey: `test.wo12.${tag}.${d.canonicalKey}` }]));
const remap = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(remap);
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>, id = typeof o.entityId === "string" ? ids.get(o.entityId) : undefined;
  if (id && typeof o.entityVersionId === "string") return { ...o, ...id };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, remap(v)]));
};
const stored = (d: typeof fixture.bundle.definitions[number], payload: unknown = remap(d.payload)) => ({ [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: d.schemaVersion, definitionKind: d.definitionKind, systemFamily: d.systemFamily, payload } });
const key = (canonicalKey: string) => `test.wo12.${tag}.${canonicalKey}`;
async function snapshot() {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  const rows: unknown[] = [];
  for (const { table_name } of tables) {
    if (!/^[a-z_]+$/.test(table_name)) throw new Error("unexpected table");
    rows.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS hash FROM "${table_name}" t`));
  }
  return rows;
}
const SPELL = "fixture.wo12.spell.success_only";
function request(m: Awaited<ReturnType<typeof materializeProwessDefinitionsFromRelease>>, name: string) {
  const d = m.bundle.definitions.find(d => d.canonicalKey === key(name))!;
  const definition: ProwessDefinitionRef = { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  return { ...fixture.ability(name), definition, definitions: m.bundle, ruleset: m.ruleset } as Record<string, unknown>;
}
/** Effect 1 misses; Effect 2's target fails its Save if it is ever asked. */
const answer: ExecutionAnswer = (q) => (q.kind === "ATTACK_ROLL" ? attackInput("", "", 1) : q.kind === "SAVING_THROW" ? saveInput("", "", 1) : null);
const one = [{ targetKey: "goblin" }];

describe("M5-WO12 Effect-chain execution over exact stored Release history", () => {
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
  it("R1 routing (SUCCESS_ONLY) reproduces after R2 (CONTINUE); execution writes nothing; mixing fails", async () => {
    const r = await createRuleset({ canonicalKey: `test.wo12.ruleset_${tag}`, name: "WO12 historical test", channel: "CORE_PLAYTEST", versionLabel: "WO12" }); rulesetIds.push(r.id);
    await submitRulesetForReview(r.id); await approveRuleset(r.id);
    for (const d of fixture.bundle.definitions) entityIds.push(ids.get(d.entityId)!.entityId);
    await prisma.entity.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityId, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as EntityType, canonicalKey: key(d.canonicalKey) })) });
    await prisma.entityVersion.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityVersionId, entityId: ids.get(d.entityId)!.entityId, revisionNumber: 1, status: "APPROVED", displayName: d.canonicalKey, structuredData: stored(d) as JsonObject })) });
    const manifest = await createRulesetManifest(r.id, { entries: [...ids.values()].map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
    const policy = await createCanonPolicy(r.id, { name: "WO12 test policy", authorities: [] });
    const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "WO12 R1" });
    const first = await materializeProwessDefinitionsFromRelease(r1.id);
    const before = await snapshot();
    const oldPlan = compileAbilityExecution(request(first, SPELL));
    const old = playExecution(request(first, SPELL), one, answer);
    expect(await snapshot()).toEqual(before); // no persistence, no state mutation
    expect([old.result.targets![0]!.nodes.map(n => n.status), old.result.targets![0]!.termination]).toEqual([["EXECUTED_FAILURE", "NOT_REACHED"], "SUCCESS_ONLY_FAILURE"]);

    const spell = fixture.bundle.definitions.find(d => d.canonicalKey === SPELL)!, spellId = ids.get(spell.entityId)!;
    const changed = JSON.parse(JSON.stringify(remap(spell.payload))) as { composition: { branch: { effectChain: { nodes: { behavior: string }[] } } } };
    changed.composition.branch.effectChain.nodes[0]!.behavior = "CONTINUE";
    const v2 = await createEntityVersion(spellId.entityId, { displayName: `${SPELL} v2`, structuredData: stored(spell, changed) });
    await transitionEntityVersionStatus(v2.id, "IN_REVIEW"); await transitionEntityVersionStatus(v2.id, "APPROVED");
    const cs = await createChangeSet(r.id, { name: "WO12 Spell v2", operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: spellId.entityId, fromEntityVersionId: spellId.entityVersionId, toEntityVersionId: v2.id }] });
    await submitChangeSetForReview(cs.id); await approveChangeSet(cs.id);
    const r2 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: r1.manifestId, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "WO12 R2" });
    const second = await materializeProwessDefinitionsFromRelease(r2.id);
    const fresh = playExecution(request(second, SPELL), one, answer);
    expect([fresh.result.targets![0]!.nodes.map(n => n.status), fresh.result.outcomes.map(o => [o.effectKey, o.result])]).toEqual([["EXECUTED_FAILURE", "EXECUTED_SUCCESS"], [["effect1", "FAILURE"], ["effect2", "SUCCESS"]]]);

    const again = await materializeProwessDefinitionsFromRelease(r1.id); expect(again).toEqual(first);
    expect(compileAbilityExecution(request(again, SPELL))).toEqual(oldPlan);
    expect(playExecution(request(again, SPELL), one, answer)).toEqual(old);
    expect(compileAbilityExecution({ ...request(first, SPELL), definitions: second.bundle }).ok).toBe(false);
    expect(executeAbilityResolution({ ...request(first, SPELL), definitions: second.bundle, execution: { targets: one, inputs: [] } }).ok).toBe(false);
  }, 600_000);
});
