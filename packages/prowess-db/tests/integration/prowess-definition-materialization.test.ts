/**
 * Exact Prowess Definition materialization — database integration tests (PAS-10 M5-WO1 §88–92, §129–132, §209).
 * Runs only against prowess_studio_test (guarded). Uses the REAL M4-WO2 exact resolver; torn down in FK order.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I005 exact EntityVersion identity · M5-I007 Ruleset
 * provenance preserved through materialization · M5-I008 only pinned versions · M5-I009 no Ruleset mixing · M5-I010 /
 * M5-I027 no latest / current selection · M5-I029 determinism · M5-I037 Evocation stored canonically with the legacy
 * "Emission" source term only in provenance.
 */
import { DomainError, RULESET_RESOLUTION_ERROR_CODES, type CreateChangeSetOperationInput, type EntityType } from "@prowess/model";
import {
  MATERIALIZATION_ERROR_CODES,
  PROWESS_COMPILATION_CONTRACT_VERSION,
  PROWESS_DEFINITION_STORAGE_KEY,
  compileProwessAbility,
  type ProwessDefinitionBundle,
} from "@prowess/game";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  approveChangeSet,
  approveRuleset,
  createCanonPolicy,
  createChangeSet,
  createEntity,
  createEntityVersion,
  createRuleset,
  createRulesetManifest,
  materializeProwessDefinitionBundle,
  materializeProwessDefinitionsFromManifest,
  materializeProwessDefinitionsFromRelease,
  prisma,
  publishRulesetRelease,
  resolveRulesetContextFromManifest,
  submitChangeSetForReview,
  submitRulesetForReview,
  transitionEntityVersionStatus,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const rulesetIds: string[] = [];
const entityIds: string[] = [];

const stored = (definitionKind: string, systemFamily: string, payload: object, legacyTerms: object[] = []) => ({
  [PROWESS_DEFINITION_STORAGE_KEY]: { schemaVersion: 1, systemFamily, definitionKind, payload, ...(legacyTerms.length > 0 ? { legacyTerms } : {}) },
});
const radius = (label: string) => stored("SPELL_TARGETING", "SPELL", { semanticShape: "RADIUS", geometry: { label } });
const damage = (label: string) => stored("SPELL_EFFECT", "SPELL", { effectFamily: "DAMAGE", outcomes: [{ outcomeKey: label, data: {} }] });
const evocation = () => stored("AFFINITY", "AFFINITY", { affinity: "EVOCATION" }, [{ legacyTerm: "Emission", canonicalTerm: "Evocation" }]);

async function ruleset(label: string, opts: { approved?: boolean; parentRulesetId?: string } = {}) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.m5mat_${label.toLowerCase()}_${tag}_${next()}`,
    name: `M5 Materialization ${label}`,
    channel: "CORE_PLAYTEST",
    versionLabel: `m5 ${label}`,
    ...(opts.parentRulesetId === undefined ? {} : { parentRulesetId: opts.parentRulesetId }),
  });
  rulesetIds.push(r.id);
  if (opts.approved === true) {
    await submitRulesetForReview(r.id);
    await approveRuleset(r.id);
  }
  return r;
}
async function entity(entityType: EntityType, label: string) {
  const e = await createEntity({ entityType, canonicalKey: `test.m5mat.${label.toLowerCase()}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}
async function version(entityId: string, name: string, structuredData: object) {
  const v = await createEntityVersion(entityId, { displayName: name, structuredData });
  await transitionEntityVersionStatus(v.id, "IN_REVIEW");
  return transitionEntityVersionStatus(v.id, "APPROVED");
}
const pin = (entityId: string, entityVersionId: string) => ({ entityId, entityVersionId });
const versionsOf = (b: ProwessDefinitionBundle) => Object.fromEntries(b.definitions.map((d) => [d.entityId, d.entityVersionId]));
async function approvedChangeSet(rulesetId: string, operations: CreateChangeSetOperationInput[]) {
  const cs = await createChangeSet(rulesetId, { name: `cs ${next()}`, operations });
  await submitChangeSetForReview(cs.id);
  await approveChangeSet(cs.id);
  return cs;
}
async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}
async function fingerprintAll(): Promise<Record<string, string>> {
  const tables = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`,
  );
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string; n: bigint }>>(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h, count(*) AS n FROM "${t}" x`);
    out[t] = `${row?.n ?? 0}:${row?.h ?? ""}`;
  }
  return out;
}

/** The §130 golden: R1 = Spell Radius v1 + Spell Damage v1 + Evocation v1. */
async function goldenR1(label: string) {
  const r = await ruleset(label, { approved: true });
  const [rad, dmg, evo] = [await entity("TARGETING", `${label}Radius`), await entity("SPELL_EFFECT", `${label}Damage`), await entity("GENERIC_RULE", `${label}Evocation`)];
  const [rad1, dmg1, evo1] = [await version(rad.id, "Radius v1", radius("v1")), await version(dmg.id, "Damage v1", damage("v1")), await version(evo.id, "Evocation v1", evocation())];
  const m = await createRulesetManifest(r.id, { entries: [pin(rad.id, rad1.id), pin(dmg.id, dmg1.id), pin(evo.id, evo1.id)] });
  const policy = await createCanonPolicy(r.id, { name: `P ${next()}`, authorities: [] });
  const r1 = await publishRulesetRelease({ rulesetId: r.id, baseManifestId: m.id, canonPolicyId: policy.id, versionLabel: `${label} R1` });
  return { r, rad, dmg, evo, rad1, dmg1, evo1, m, policy, r1 };
}

describe("Exact Prowess Definition materialization (prowess_studio_test only)", () => {
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
    await prisma.ruleset.updateMany({ where: { id: { in: rulesetIds } }, data: { parentRulesetId: null } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    await prisma.entityVersion.updateMany({ where: { entityId: { in: entityIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  it("materializes an exact Manifest: exact versions, exact provenance, generic rules skipped (§88)", async () => {
    const r = await ruleset("manifest");
    const [rad, generic] = [await entity("TARGETING", "mRadius"), await entity("GENERIC_RULE", "mGeneric")];
    const [rad1, gen1] = [await version(rad.id, "Radius", radius("m")), await version(generic.id, "Generic", { value: 10 })];
    const m = await createRulesetManifest(r.id, { entries: [pin(rad.id, rad1.id), pin(generic.id, gen1.id)] });

    const { ruleset: ctx, bundle } = await materializeProwessDefinitionsFromManifest(m.id);
    expect(bundle.rulesetProvenance).toEqual({ rulesetId: r.id, manifestId: m.id, manifestHash: null, rulesetVersionLabel: "m5 manifest", release: null });
    expect(bundle.definitions).toHaveLength(1);
    expect(bundle.definitions[0]).toMatchObject({
      definitionKind: "SPELL_TARGETING",
      entityId: rad.id,
      entityVersionId: rad1.id,
      canonicalKey: rad.canonicalKey,
      provenance: { rulesetId: r.id, manifestId: m.id, releaseId: null, sourceRulesetId: r.id, sourceManifestId: m.id, legacyTerms: [] },
    });
    expect(ctx.rules).toHaveLength(2);
    expect(Object.isFrozen(bundle.definitions[0])).toBe(true);
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
  });

  it("§130 golden: R1 materializes its exact original versions after v2 content and Release R2 exist", async () => {
    const g = await goldenR1("golden");
    const first = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(versionsOf(first.bundle)).toEqual({ [g.rad.id]: g.rad1.id, [g.dmg.id]: g.dmg1.id, [g.evo.id]: g.evo1.id });
    expect(first.bundle.rulesetProvenance.release).toEqual({ releaseId: g.r1.id, releaseNumber: 1, versionLabel: "golden R1" });
    const evo = first.bundle.definitions.find((d) => d.definitionKind === "AFFINITY");
    expect(evo?.payload).toEqual({ affinity: "EVOCATION" });
    expect(evo?.provenance.legacyTerms).toEqual([{ legacyTerm: "Emission", canonicalTerm: "Evocation" }]);

    const [rad2, dmg2, evo2] = [await version(g.rad.id, "Radius v2", radius("v2")), await version(g.dmg.id, "Damage v2", damage("v2")), await version(g.evo.id, "Evocation v2", evocation())];
    const cs = await approvedChangeSet(g.r.id, [
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: g.rad.id, fromEntityVersionId: g.rad1.id, toEntityVersionId: rad2.id },
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: g.dmg.id, fromEntityVersionId: g.dmg1.id, toEntityVersionId: dmg2.id },
      { operationType: "REPLACE_ENTITY_VERSION", targetEntityId: g.evo.id, fromEntityVersionId: g.evo1.id, toEntityVersionId: evo2.id },
    ]);
    const r2 = await publishRulesetRelease({ rulesetId: g.r.id, baseManifestId: g.r1.manifestId, canonPolicyId: g.policy.id, changeSetId: cs.id, versionLabel: "golden R2" });

    const second = await materializeProwessDefinitionsFromRelease(r2.id);
    expect(versionsOf(second.bundle)).toEqual({ [g.rad.id]: rad2.id, [g.dmg.id]: dmg2.id, [g.evo.id]: evo2.id });
    const again = await materializeProwessDefinitionsFromRelease(g.r1.id);
    expect(again).toEqual(first); // R2 never changes R1
  });

  it("a historical Manifest keeps its exact versions after later versions exist (§209)", async () => {
    const r = await ruleset("histm");
    const dmg = await entity("SPELL_EFFECT", "hDamage");
    const d1 = await version(dmg.id, "D1", damage("d1"));
    const m1 = await createRulesetManifest(r.id, { entries: [pin(dmg.id, d1.id)] });
    const before = await materializeProwessDefinitionsFromManifest(m1.id);
    const d2 = await version(dmg.id, "D2", damage("d2"));
    await createRulesetManifest(r.id, { entries: [pin(dmg.id, d2.id)] });
    expect(await materializeProwessDefinitionsFromManifest(m1.id)).toEqual(before);
    expect(versionsOf(before.bundle)).toEqual({ [dmg.id]: d1.id });
  });

  it("inheritance: inherited Definitions keep the exact supplying Ruleset / Manifest provenance (§209)", async () => {
    const rp = await ruleset("parent");
    const rc = await ruleset("child", { parentRulesetId: rp.id });
    const [rad, dmg] = [await entity("TARGETING", "iRadius"), await entity("SPELL_EFFECT", "iDamage")];
    const [rad1, dmg1, dmg2] = [await version(rad.id, "R1", radius("p")), await version(dmg.id, "D1", damage("p")), await version(dmg.id, "D2", damage("c"))];
    const p1 = await createRulesetManifest(rp.id, { entries: [pin(rad.id, rad1.id), pin(dmg.id, dmg1.id)] });
    const c1 = await createRulesetManifest(rc.id, { parentManifestId: p1.id, entries: [pin(dmg.id, dmg2.id)] });
    const { bundle } = await materializeProwessDefinitionsFromManifest(c1.id);
    const byEntity = Object.fromEntries(bundle.definitions.map((d) => [d.entityId, [d.entityVersionId, d.provenance.sourceRulesetId, d.provenance.sourceManifestId]]));
    expect(byEntity).toEqual({ [rad.id]: [rad1.id, rp.id, p1.id], [dmg.id]: [dmg2.id, rc.id, c1.id] });
    expect(bundle.rulesetProvenance.manifestId).toBe(c1.id);
  });

  it("§131 Ruleset isolation: two Rulesets pinning different versions of one Definition stay isolated", async () => {
    const [rx, ry] = [await ruleset("isoX"), await ruleset("isoY")];
    const dmg = await entity("SPELL_EFFECT", "isoDamage");
    const [d1, d2] = [await version(dmg.id, "D1", damage("x")), await version(dmg.id, "D2", damage("y"))];
    const x = await materializeProwessDefinitionsFromManifest((await createRulesetManifest(rx.id, { entries: [pin(dmg.id, d1.id)] })).id);
    const y = await materializeProwessDefinitionsFromManifest((await createRulesetManifest(ry.id, { entries: [pin(dmg.id, d2.id)] })).id);
    expect(versionsOf(x.bundle)).toEqual({ [dmg.id]: d1.id });
    expect(versionsOf(y.bundle)).toEqual({ [dmg.id]: d2.id });
    expect(x.bundle.definitions[0]?.provenance.rulesetId).toBe(rx.id);
    expect(y.bundle.definitions[0]?.provenance.rulesetId).toBe(ry.id);
  });

  it("refuses a tampered Release — no context, no bundle (§209)", async () => {
    const g = await goldenR1("tamper");
    const other = await version(g.dmg.id, "Damage tamper", damage("t"));
    const entry = await prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: g.r1.manifestId, entityId: g.dmg.id } });
    try {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${other.id}::uuid WHERE id = ${entry.id}::uuid`; // test-only corruption
      await expectCode(materializeProwessDefinitionsFromRelease(g.r1.id), RULESET_RESOLUTION_ERROR_CODES.RELEASE_INTEGRITY_FAILURE);
    } finally {
      await prisma.$executeRaw`UPDATE ruleset_manifest_entries SET entity_version_id = ${entry.entityVersionId}::uuid WHERE id = ${entry.id}::uuid`;
    }
    expect(versionsOf((await materializeProwessDefinitionsFromRelease(g.r1.id)).bundle)[g.dmg.id]).toBe(g.dmg1.id);
  });

  it("fails closed on malformed stored Definitions, Emission as canonical, and a storage EntityType mismatch", async () => {
    const r = await ruleset("bad");
    const [a, b, c] = [await entity("GENERIC_RULE", "badAff"), await entity("GENERIC_RULE", "badEmission"), await entity("GENERIC_RULE", "badType")];
    const bad1 = await version(a.id, "bad", stored("AFFINITY", "AFFINITY", { affinity: "FIRE" }));
    const bad2 = await version(b.id, "emission", stored("AFFINITY", "AFFINITY", { affinity: "EMISSION" }));
    const bad3 = await version(c.id, "wrong type", radius("generic")); // SPELL_TARGETING must be stored as TARGETING
    for (const [entityId, versionId] of [[a.id, bad1.id], [b.id, bad2.id], [c.id, bad3.id]] as const) {
      const m = await createRulesetManifest(r.id, { entries: [pin(entityId, versionId)] });
      await expectCode(materializeProwessDefinitionsFromManifest(m.id), MATERIALIZATION_ERROR_CODES.INVALID_STORED_DEFINITION);
    }
  });

  it("fails closed when a supplied context pins a version it cannot load exactly (never falls back)", async () => {
    const r = await ruleset("missing");
    const dmg = await entity("SPELL_EFFECT", "missDamage");
    const d1 = await version(dmg.id, "D1", damage("m"));
    const ctx = await resolveRulesetContextFromManifest((await createRulesetManifest(r.id, { entries: [pin(dmg.id, d1.id)] })).id);
    const forged = { ...ctx, rules: ctx.rules.map((rule) => ({ ...rule, entityVersionId: "00000000-0000-4000-8000-00000000dead" as typeof rule.entityVersionId })) };
    await expectCode(materializeProwessDefinitionBundle(forged), MATERIALIZATION_ERROR_CODES.PINNED_VERSION_MISSING);
  });

  it("is read-only, deterministic and loads every pin in one query (no N+1, no per-entity 'latest' read)", async () => {
    const g = await goldenR1("readonly");
    const before = await fingerprintAll();
    const first = JSON.stringify(await materializeProwessDefinitionsFromRelease(g.r1.id));
    for (let i = 0; i < 3; i += 1) expect(JSON.stringify(await materializeProwessDefinitionsFromRelease(g.r1.id))).toBe(first);
    expect(await fingerprintAll()).toEqual(before);

    const ctx = (await materializeProwessDefinitionsFromRelease(g.r1.id)).ruleset;
    const spies = [vi.spyOn(prisma.entityVersion, "findMany"), vi.spyOn(prisma.entityVersion, "findFirst"), vi.spyOn(prisma.entityVersion, "findUnique")];
    try {
      await materializeProwessDefinitionBundle(ctx);
      expect(spies.map((s) => s.mock.calls.length)).toEqual([1, 0, 0]);
      expect(JSON.stringify(spies[0]!.mock.calls[0]![0])).not.toMatch(/orderBy":\{"(createdAt|revisionNumber)"|desc/);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("end to end: a materialized exact bundle compiles a Spell under its exact Release (M4 plan, no mechanics yet)", async () => {
    const g = await goldenR1("compile");
    const { ruleset: ctx, bundle } = await materializeProwessDefinitionsFromRelease(g.r1.id);
    const ref = (entityId: string) => {
      const d = bundle.definitions.find((x) => x.entityId === entityId)!;
      return { entityId: d.entityId, entityVersionId: d.entityVersionId, canonicalKey: d.canonicalKey, definitionKind: d.definitionKind, systemFamily: d.systemFamily };
    };
    const composition = {
      compositionKey: "composition.e2e",
      abilityKind: "SPELL",
      affinity: { componentKey: "affinity", definition: ref(g.evo.id) },
      targeting: { componentKey: "area", definition: ref(g.rad.id), parameters: { radius: 2 } },
      effects: [{ componentKey: "damage", order: 1, definition: ref(g.dmg.id) }],
      branch: { kind: "SPELL" },
    };
    const compiled = compileProwessAbility({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subject: { kind: "SPELL", composition }, definitions: bundle, ruleset: ctx });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.value.rulesetProvenance.release?.releaseId).toBe(g.r1.id);
  });
});
