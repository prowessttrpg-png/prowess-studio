/**
 * M5-WO13: active magic over REAL EntityVersion storage and exact published Release history (prowess_studio_test only).
 * R1 pins the active-magic policy with Sustain AP 1; R2 replaces the ABILITY_CONSTRUCTION_RULE with a version whose policy
 * says Sustain AP 2. An Active Effect created under R1 keeps paying 1 AP after R2 is published (identical transitions on a
 * re-materialized R1), R1 state under R2 is refused, an R2 activation pins 2 AP, and no transition writes anything.
 * Guards M5-I333 · M5-I337.
 */
import { randomUUID } from "node:crypto";
import type { EntityType, JsonObject } from "@prowess/model";
import { PROWESS_DEFINITION_KINDS, PROWESS_DEFINITION_STORAGE_KEY, transitionActiveMagic, type ProwessDefinitionRef } from "@prowess/game";
import { activeMagicFixture, caster, pool } from "../../../prowess-game/src/testing/active-magic-fixtures.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveChangeSet, approveRuleset, createCanonPolicy, createChangeSet, createEntityVersion, createRuleset, createRulesetManifest, materializeProwessDefinitionsFromRelease, prisma, publishRulesetRelease, submitChangeSetForReview, submitRulesetForReview, transitionEntityVersionStatus } from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = randomUUID().replaceAll("-", ""), entityIds: string[] = [], rulesetIds: string[] = [];
const fixture = activeMagicFixture();
const ids = new Map<string, { entityId: string; entityVersionId: string; canonicalKey: string }>(fixture.bundle.definitions.map(d => [d.entityId, { entityId: randomUUID(), entityVersionId: randomUUID(), canonicalKey: `test.wo13.${tag}.${d.canonicalKey}` }]));
const remap = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(remap);
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>, id = typeof o.entityId === "string" ? ids.get(o.entityId) : undefined;
  if (id && typeof o.entityVersionId === "string") return { ...o, ...id };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, remap(v)]));
};
const stored = (d: typeof fixture.bundle.definitions[number], payload: unknown = remap(d.payload)) => ({ [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: d.schemaVersion, definitionKind: d.definitionKind, systemFamily: d.systemFamily, payload } });
const key = (canonicalKey: string) => `test.wo13.${tag}.${canonicalKey}`;
async function snapshot() {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  const rows: unknown[] = [];
  for (const { table_name } of tables) {
    if (!/^[a-z_]+$/.test(table_name)) throw new Error("unexpected table");
    rows.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS hash FROM "${table_name}" t`));
  }
  return rows;
}
const SPELL = "fixture.wo13.spell.sustained";
const FULL = pool({ AP: 3, ME: 3, MP: 20 });
type Materialized = Awaited<ReturnType<typeof materializeProwessDefinitionsFromRelease>>;
function ability(m: Materialized) {
  const d = m.bundle.definitions.find(d => d.canonicalKey === key(SPELL))!;
  const definition: ProwessDefinitionRef = { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
  return { ...fixture.ability(SPELL), definition };
}
const requestOf = (m: Materialized, state: unknown, resources: unknown, event: Record<string, unknown>) => ({ contractVersion: 1, definitions: m.bundle, ruleset: m.ruleset, caster: caster(), casterKey: "caster.1", resources, state, event });
function transition(m: Materialized, state: unknown, resources: unknown, event: Record<string, unknown>) {
  const out = transitionActiveMagic(requestOf(m, state, resources, event));
  if (!out.ok) throw new Error(JSON.stringify(out.problems, null, 2));
  return out.value;
}
const apSpent = (t: { resourceChanges: readonly { resourceKey: string; amount: number }[] }) => t.resourceChanges.filter(c => c.resourceKey === "AP").map(c => c.amount).reduce((a, b) => a + b, 0);

describe("M5-WO13 active magic over exact stored Release history", () => {
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
  it("an R1 Active Effect keeps R1's pinned Sustain AP after R2 changes the policy; R1 state under R2 is refused; nothing is written", async () => {
    const r = await createRuleset({ canonicalKey: `test.wo13.ruleset_${tag}`, name: "WO13 historical test", channel: "CORE_PLAYTEST", versionLabel: "WO13" }); rulesetIds.push(r.id);
    await submitRulesetForReview(r.id); await approveRuleset(r.id);
    for (const d of fixture.bundle.definitions) entityIds.push(ids.get(d.entityId)!.entityId);
    await prisma.entity.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityId, entityType: PROWESS_DEFINITION_KINDS[d.definitionKind].entityTypes[0] as EntityType, canonicalKey: key(d.canonicalKey) })) });
    await prisma.entityVersion.createMany({ data: fixture.bundle.definitions.map(d => ({ id: ids.get(d.entityId)!.entityVersionId, entityId: ids.get(d.entityId)!.entityId, revisionNumber: 1, status: "APPROVED", displayName: d.canonicalKey, structuredData: stored(d) as JsonObject })) });
    const manifest = await createRulesetManifest(r.id, { entries: [...ids.values()].map(({ entityId, entityVersionId }) => ({ entityId, entityVersionId })) });
    const policy = await createCanonPolicy(r.id, { name: "WO13 test policy", authorities: [] });
    const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: manifest.id, canonPolicyId: policy.id, versionLabel: "WO13 R1" });
    const first = await materializeProwessDefinitionsFromRelease(r1.id);
    const before = await snapshot();
    const activated = transition(first, null, FULL, { kind: "ACTIVATE", activeEffectKey: "s", ability: ability(first) });
    const state = activated.state, kept = transition(first, state, activated.resources, { kind: "MAINTENANCE" });
    expect(await snapshot()).toEqual(before); // no persistence
    expect([state.effects[0]!.sustain!.apCost, apSpent(kept)]).toEqual([1, 1]);

    const rule = fixture.bundle.definitions.find(d => d.definitionKind === "ABILITY_CONSTRUCTION_RULE")!, ruleId = ids.get(rule.entityId)!;
    const changed = JSON.parse(JSON.stringify(remap(rule.payload))) as { activeMagicPolicy: { sustainApPerRound: number } };
    changed.activeMagicPolicy.sustainApPerRound = 2;
    const v2 = await createEntityVersion(ruleId.entityId, { displayName: "construction rule v2", structuredData: stored(rule, changed) });
    await transitionEntityVersionStatus(v2.id, "IN_REVIEW"); await transitionEntityVersionStatus(v2.id, "APPROVED");
    const cs = await createChangeSet(r.id, { name: "WO13 policy v2", operations: [{ operationType: "REPLACE_ENTITY_VERSION", targetEntityId: ruleId.entityId, fromEntityVersionId: ruleId.entityVersionId, toEntityVersionId: v2.id }] });
    await submitChangeSetForReview(cs.id); await approveChangeSet(cs.id);
    const r2 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: r1.manifestId, canonPolicyId: policy.id, changeSetId: cs.id, versionLabel: "WO13 R2" });
    const second = await materializeProwessDefinitionsFromRelease(r2.id);
    const fresh = transition(second, null, FULL, { kind: "ACTIVATE", activeEffectKey: "s", ability: ability(second) });
    expect([fresh.state.effects[0]!.sustain!.apCost, apSpent(transition(second, fresh.state, fresh.resources, { kind: "MAINTENANCE" }))]).toEqual([2, 2]);

    const again = await materializeProwessDefinitionsFromRelease(r1.id); expect(again).toEqual(first);
    expect(transition(again, state, activated.resources, { kind: "MAINTENANCE" })).toEqual(kept);
    const mixed = transitionActiveMagic(requestOf(second, state, activated.resources, { kind: "MAINTENANCE" }));
    expect(mixed.ok ? [] : mixed.problems.map(q => q.code)).toContain("PROWESS_ACTIVE_MAGIC.CROSS_RULESET");
  }, 900_000);
});
