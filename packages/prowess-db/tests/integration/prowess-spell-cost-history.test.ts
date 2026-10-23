/**
 * M5-WO10: final Spell cost over REAL EntityVersion storage and exact published Release history (prowess_studio_test only).
 * R1 pins Trait v1 (+2 MP); R2 pins Trait v2 (+4 MP) and the dependent authored Spell version. R1 keeps its cost, a mixed
 * R1 Spell + R2 bundle is refused, and evaluation writes nothing. Guards M5-I254 · M5-I257 · M5-I258.
 */
import { randomUUID } from "node:crypto";
import type { EntityType, JsonObject } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, compileSpellCost, evaluateSpellCost, type ProwessDefinitionRef } from "@prowess/game";
import { spellCostCharacter, spellCostFixture } from "../../../prowess-game/src/testing/spell-cost-fixtures.js";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { it } from "vitest";
import { approveChangeSet, approveRuleset, createCanonPolicy, createChangeSet, createEntityVersion, createRuleset, createRulesetManifest, materializeProwessDefinitionsFromRelease, prisma, publishRulesetRelease, submitChangeSetForReview, submitRulesetForReview, transitionEntityVersionStatus } from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = randomUUID().replaceAll("-", ""), entityIds: string[] = [], rulesetIds: string[] = [];
const fixture = spellCostFixture();
const ids = new Map<string, { entityId: string; entityVersionId: string; canonicalKey: string }>(fixture.bundle.definitions.map(d => [d.entityId, { entityId: randomUUID(), entityVersionId: randomUUID(), canonicalKey: `test.wo10.${tag}.${d.canonicalKey}` }]));
const remap = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(remap);
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>, id = typeof o.entityId === "string" ? ids.get(o.entityId) : undefined;
  if (id && typeof o.entityVersionId === "string") return { ...o, ...id };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, remap(v)]));
};
const stored = (d: typeof fixture.bundle.definitions[number], payload: unknown = remap(d.payload)) => ({ [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: d.schemaVersion, definitionKind: d.definitionKind, systemFamily: d.systemFamily, payload } });
const key = (canonicalKey: string) => `test.wo10.${tag}.${canonicalKey}`;
async function snapshot() {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  const rows: unknown[] = [];
  for (const { table_name } of tables) {
    if (!/^[a-z_]+$/.test(table_name)) throw new Error("unexpected table");
    rows.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS hash FROM "${table_name}" t`));
  }
  return rows;
}
function request(m: Awaited<ReturnType<typeof materializeProwessDefinitionsFromRelease>>, name: string) {
  const d = m.bundle.definitions.find(d => d.canonicalKey === key(name))!;
  const definition: ProwessDefinitionRef = { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  const affinity = m.bundle.definitions.find(x => x.canonicalKey === key("affinity.transmutation"))!;
  const character = name.includes("combined") ? spellCostCharacter(4, [{ entityId: affinity.entityId, entityVersionId: affinity.entityVersionId, canonicalKey: affinity.canonicalKey, definitionKind: affinity.definitionKind, systemFamily: affinity.systemFamily } as ProwessDefinitionRef, "EXPERT"]) : spellCostCharacter();
  return { ...fixture.request(name, character), definition, definitions: m.bundle, ruleset: m.ruleset };
}

describe("M5-WO10 final Spell cost over exact stored Release history", () => {
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
  it("R1 cost reproduces after R2 replaces the Trait and its dependent Spell pin; evaluation writes nothing; mixing fails", async () => {
    const r = await createRuleset({ canonicalKey: `test.wo10.ruleset_${tag}`, name: "WO10 historical test", channel: "CORE_PLAYTEST", versionLabel: "WO10" }); rulesetIds.push(r.id);
    await submitRulesetForReview(r.id); await approveRuleset(r.id);
    for (const d of fixture.bundle.definitions) entityIds.push(ids.get(d.entityId)!.entityId);
    await prisma.entity.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityId, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as EntityType, canonicalKey: key(d.canonicalKey) })) });
    await prisma.entityVersion.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityVersionId, entityId: ids.get(d.entityId)!.entityId, revisionNumber: 1, status: "APPROVED", displayName: d.canonicalKey, structuredData: stored(d) as JsonObject })) });
    const manifest = await createRulesetManifest(r.id, { entries: [...ids.values()].map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
    const policy = await createCanonPolicy(r.id, { name: "WO10 test policy", authorities: [] });
    const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "WO10 R1" });
    const first = await materializeProwessDefinitionsFromRelease(r1.id);
    const before = await snapshot();
    const oldPlan = compileSpellCost(request(first, "fixture.wo10.spell.simple")), oldResult = evaluateSpellCost(request(first, "fixture.wo10.spell.simple"));
    const combined = evaluateSpellCost(request(first, "fixture.wo10.spell.combined"));
    expect(await snapshot()).toEqual(before); // no persistence, no resource mutation
    expect(oldResult.ok && [oldResult.value.status, oldResult.value.finalMpCost, oldResult.value.ap.finalApCost]).toEqual(["VALID", 13, 3]);
    expect(combined.ok && [combined.value.netCostPercent, combined.value.finalMpCost]).toEqual([80, 16]);
    const trait = fixture.bundle.definitions.find(d => d.canonicalKey === "fixture.wo10.trait.flat")!, traitId = ids.get(trait.entityId)!;
    const changed = JSON.parse(JSON.stringify(remap(trait.payload))) as JsonObject;
    changed.costContributions = [{ contributionKey: "trait.wo10.flat", currency: "MP", data: { kind: "FIXED", amount: 4 } }];
    const v2 = await createEntityVersion(traitId.entityId, { displayName: "fixture.wo10.trait.flat v2", structuredData: stored(trait, changed) });
    await transitionEntityVersionStatus(v2.id, "IN_REVIEW"); await transitionEntityVersionStatus(v2.id, "APPROVED");
    const operations: { operationType: "REPLACE_ENTITY_VERSION"; targetEntityId: string; fromEntityVersionId: string; toEntityVersionId: string }[] = [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: traitId.entityId, fromEntityVersionId: traitId.entityVersionId, toEntityVersionId: v2.id }];
    const spell = fixture.bundle.definitions.find(d => d.canonicalKey === "fixture.wo10.spell.simple")!, spellId = ids.get(spell.entityId)!;
    const repinned = JSON.parse(JSON.stringify(remap(spell.payload)).replaceAll(traitId.entityVersionId, v2.id)) as JsonObject;
    const s2 = await createEntityVersion(spellId.entityId, { displayName: "fixture.wo10.spell.simple v2", structuredData: stored(spell, repinned) });
    await transitionEntityVersionStatus(s2.id, "IN_REVIEW"); await transitionEntityVersionStatus(s2.id, "APPROVED");
    operations.push({ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: spellId.entityId, fromEntityVersionId: spellId.entityVersionId, toEntityVersionId: s2.id });
    const cs = await createChangeSet(r.id, { name: "WO10 Trait v2", operations }); await submitChangeSetForReview(cs.id); await approveChangeSet(cs.id);
    const r2 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: r1.manifestId, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "WO10 R2" });
    const second = await materializeProwessDefinitionsFromRelease(r2.id), result = evaluateSpellCost(request(second, "fixture.wo10.spell.simple"));
    expect(result.ok && [result.value.status, result.value.finalMpCost]).toEqual(["VALID", 15]);
    const again = await materializeProwessDefinitionsFromRelease(r1.id); expect(again).toEqual(first);
    expect(compileSpellCost(request(again, "fixture.wo10.spell.simple"))).toEqual(oldPlan);
    expect(evaluateSpellCost(request(again, "fixture.wo10.spell.simple"))).toEqual(oldResult);
    expect(compileSpellCost({ ...request(first, "fixture.wo10.spell.simple"), definitions: second.bundle }).ok).toBe(false);
  }, 180_000);
});
