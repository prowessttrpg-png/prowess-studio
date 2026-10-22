/** WO8: real EntityVersion storage, exact published Release history, and read-only evaluation. */
import { randomUUID } from "node:crypto";
import type { EntityType, JsonObject } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, compileAbilityDefinition, evaluateAbilityDefinition, type ProwessDefinitionRef } from "@prowess/game";
import { abilityDefinitionFixture } from "../../../prowess-game/src/testing/ability-definition-fixtures.js";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { it } from "vitest";
import { approveChangeSet, approveRuleset, createCanonPolicy, createChangeSet, createEntityVersion, createRuleset, createRulesetManifest, materializeProwessDefinitionsFromRelease, prisma, publishRulesetRelease, submitChangeSetForReview, submitRulesetForReview, transitionEntityVersionStatus } from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = randomUUID().replaceAll("-", ""), entityIds: string[] = [], rulesetIds: string[] = [];
const fixture = abilityDefinitionFixture();
const ids = new Map<string, { entityId: string; entityVersionId: string; canonicalKey: string }>(fixture.bundle.definitions.map(d => [d.entityId, { entityId: randomUUID(), entityVersionId: randomUUID(), canonicalKey: `test.wo8.${tag}.${d.canonicalKey}` }]));
const remap = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(remap);
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>, id = typeof o.entityId === "string" ? ids.get(o.entityId) : undefined;
  if (id && typeof o.entityVersionId === "string") return { ...o, ...id };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, remap(v)]));
};
const stored = (d: typeof fixture.bundle.definitions[number], payload: unknown = remap(d.payload)) => ({ [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: d.schemaVersion, definitionKind: d.definitionKind, systemFamily: d.systemFamily, payload } });
const key = (canonicalKey: string) => `test.wo8.${tag}.${canonicalKey}`;
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
  return { ...fixture.request(name), definition, definitions: m.bundle, ruleset: m.ruleset };
}

describe("WO8 stored authored objects retain exact Release history", () => {
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
  it("stores Traits/Spells/Maneuvers without migration; R1 reproduces after R2 changes Trait cost and explicit dependent pins", async () => {
    const r = await createRuleset({ canonicalKey: `test.wo8.ruleset_${tag}`, name: "WO8 historical test", channel: "CORE_PLAYTEST", versionLabel: "WO8" }); rulesetIds.push(r.id);
    await submitRulesetForReview(r.id); await approveRuleset(r.id);
    // Direct fixture seeding supplies preallocated exact IDs for references; publishing uses normal governance services.
    for (const d of fixture.bundle.definitions) entityIds.push(ids.get(d.entityId)!.entityId);
    await prisma.entity.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityId, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as EntityType, canonicalKey: key(d.canonicalKey) })) });
    await prisma.entityVersion.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityVersionId, entityId: ids.get(d.entityId)!.entityId, revisionNumber: 1, status: "APPROVED", displayName: d.canonicalKey, structuredData: stored(d) as JsonObject })) });
    const manifest = await createRulesetManifest(r.id, { entries: [...ids.values()].map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
    const policy = await createCanonPolicy(r.id, { name: "WO8 test policy", authorities: [] });
    const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "WO8 R1" });
    const first = await materializeProwessDefinitionsFromRelease(r1.id);
    const before = await snapshot(), oldPlan = compileAbilityDefinition(request(first, "fixture.spell.simple")), oldResult = evaluateAbilityDefinition(request(first, "fixture.spell.simple"));
    expect(oldPlan.ok).toBe(true); expect(oldResult.ok && oldResult.value.valid).toBe(true);
    expect(evaluateAbilityDefinition(request(first, "fixture.maneuver.multi")).ok).toBe(true);
    expect(await snapshot()).toEqual(before);
    const trait = fixture.bundle.definitions.find(d => d.canonicalKey === "fixture.trait.spell")!, traitId = ids.get(trait.entityId)!;
    const changed = JSON.parse(JSON.stringify(remap(trait.payload))) as JsonObject;
    changed.costContributions = [{ contributionKey: "trait.mp", currency: "MP", data: { kind: "FIXED", amount: 7 } }];
    const version = await createEntityVersion(traitId.entityId, { displayName: "Trait v2", structuredData: stored(trait, changed) });
    await transitionEntityVersionStatus(version.id, "IN_REVIEW"); await transitionEntityVersionStatus(version.id, "APPROVED");
    const operations = [{ operationType: "REPLACE_ENTITY_VERSION" as const, targetEntityId: traitId.entityId, fromEntityVersionId: traitId.entityVersionId, toEntityVersionId: version.id }];
    const replaceVersion = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replaceAll(traitId.entityVersionId, version.id));
    for (const d of fixture.bundle.definitions.filter(d => d.definitionKind === "SPELL_DEFINITION" && JSON.stringify(d.payload).includes(trait.entityVersionId))) {
      const pin = ids.get(d.entityId)!, child = await createEntityVersion(pin.entityId, { displayName: `${d.canonicalKey} v2`, structuredData: stored(d, replaceVersion(remap(d.payload))) });
      await transitionEntityVersionStatus(child.id, "IN_REVIEW"); await transitionEntityVersionStatus(child.id, "APPROVED");
      operations.push({ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: pin.entityId, fromEntityVersionId: pin.entityVersionId, toEntityVersionId: child.id });
    }
    const cs = await createChangeSet(r.id, { name: "WO8 exact dependent pins", operations }); await submitChangeSetForReview(cs.id); await approveChangeSet(cs.id);
    const r2 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: r1.manifestId, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "WO8 R2" });
    const second = await materializeProwessDefinitionsFromRelease(r2.id), result = evaluateAbilityDefinition(request(second, "fixture.spell.simple"));
    expect(result.ok && result.value.valid).toBe(true);
    if (oldResult.ok && result.ok) { expect(oldResult.value.traits[0]!.costs[0]).toMatchObject({ amount: 4 }); expect(result.value.traits[0]!.costs[0]).toMatchObject({ amount: 7 }); }
    const again = await materializeProwessDefinitionsFromRelease(r1.id); expect(again).toEqual(first);
    expect(compileAbilityDefinition(request(again, "fixture.spell.simple"))).toEqual(oldPlan); expect(evaluateAbilityDefinition(request(again, "fixture.spell.simple"))).toEqual(oldResult);
    expect(compileAbilityDefinition({ ...request(first, "fixture.spell.simple"), definitions: second.bundle }).ok).toBe(false);
  }, 120_000);
});
