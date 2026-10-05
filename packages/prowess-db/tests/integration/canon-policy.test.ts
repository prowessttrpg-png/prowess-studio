/**
 * CanonPolicy & SourceAuthorityRecord — database integration tests (PAS-10 M2-WO4 §40–§52).
 *
 * Runs only against prowess_studio_test (guarded). Every row is tracked by id and torn down
 * in foreign-key order: authority records -> policies -> manifests (parent pointers nulled
 * first) -> rulesets -> source rows -> versions -> entities. An incomplete cleanup here
 * would poison every later file's prefix-wide cleanup.
 */
import { CANON_POLICY_ERROR_CODES, DomainError, SOURCE_AUTHORITY_ERROR_CODES, SOURCE_DOCUMENT_TYPES, type CreateCanonPolicyInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCanonPolicy,
  createEntity,
  createEntityVersion,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  createSourceReference,
  getCanonPolicy,
  getLatestCanonPolicy,
  getRulesetManifest,
  getSourceAuthorityRecord,
  listCanonPolicies,
  prisma,
  resolveEffectiveEntityVersion,
  resolveEntityVersionFromManifest,
  resolveSourceAuthority,
  transitionEntityVersionStatus,
} from "../../src/index";
import { insertCanonPolicyWithAuthorities } from "../../src/canon-policy/repository";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = "00000000-0000-4000-8000-000000000000";
const SOURCE_TITLE_PREFIX = "PolicyTest ";
const rulesetIds: string[] = [];
const entityIds: string[] = [];

async function ruleset(label: string, parentRulesetId?: string) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.pol_${label}_${tag}_${next()}`,
    name: `PolicyTest ${label}`,
    channel: "DEVELOPMENT",
    ...(parentRulesetId === undefined ? {} : { parentRulesetId }),
  });
  rulesetIds.push(r.id);
  return r;
}

const sourceType: string = SOURCE_DOCUMENT_TYPES[0];
const source = (label: string, authorityStatus?: string) =>
  createSourceDocument({
    title: `${SOURCE_TITLE_PREFIX}${label} ${tag}_${next()}`,
    sourceType,
    ...(authorityStatus === undefined ? {} : { authorityStatus }),
  });

async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.policy.${label}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}

const version = (entityId: string, name: string) => createEntityVersion(entityId, { displayName: name });
const auth = (sourceDocumentId: string, scopeKey: string, authorityStatus: string, rationale?: string) => ({
  sourceDocumentId,
  scopeKey,
  authorityStatus,
  ...(rationale === undefined ? {} : { rationale }),
});
const counts = async (rulesetId: string) => ({
  policies: await prisma.canonPolicy.count({ where: { rulesetId } }),
  records: await prisma.sourceAuthorityRecord.count({ where: { canonPolicy: { rulesetId } } }),
});

describe("CanonPolicy (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.sourceAuthorityRecord.deleteMany({ where: { canonPolicy: { rulesetId: { in: rulesetIds } } } });
    await prisma.canonPolicy.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.rulesetManifestEntry.deleteMany({ where: { manifest: { rulesetId: { in: rulesetIds } } } });
    await prisma.rulesetManifest.updateMany({ where: { rulesetId: { in: rulesetIds } }, data: { parentManifestId: null } });
    await prisma.rulesetManifest.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
    await prisma.ruleset.updateMany({ where: { id: { in: rulesetIds } }, data: { parentRulesetId: null } });
    await prisma.ruleset.deleteMany({ where: { id: { in: rulesetIds } } });
    const versions = await prisma.entityVersion.findMany({ where: { entityId: { in: entityIds } }, select: { id: true } });
    const versionIds = versions.map((v: { id: string }) => v.id);
    await prisma.sourceReference.deleteMany({ where: { entityVersionId: { in: versionIds } } });
    await prisma.sourceDocument.deleteMany({ where: { title: { startsWith: SOURCE_TITLE_PREFIX } } });
    await prisma.entityVersion.updateMany({ where: { id: { in: versionIds } }, data: { parentVersionId: null } });
    await prisma.entityVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
  });

  describe("snapshots and history (§2, §3, §20, §40, §41)", () => {
    it("creates Policy 1 with exactly the supplied authority records (§40)", async () => {
      const r = await ruleset("basic");
      const [a, b] = [await source("A"), await source("B")] as const;
      const before = Date.now();
      const p1 = await createCanonPolicy(r.id, {
        name: "Policy 1",
        description: "The first policy",
        authorities: [auth(b.id, "global", "CURRENT_SUPPLEMENTAL"), auth(a.id, "global", "CURRENT_PRIMARY", "The core rulebook")],
      });

      expect(p1.id).toMatch(UUID);
      expect(p1.rulesetId).toBe(r.id);
      expect(p1.policyVersion).toBe(1);
      expect(p1.name).toBe("Policy 1");
      expect(p1.description).toBe("The first policy");
      expect(Number.isNaN(p1.createdAt.getTime())).toBe(false);
      expect(p1.createdAt.getTime()).toBeGreaterThan(before - 60_000);
      expect(p1.authorities).toHaveLength(2);
      const byDoc = new Map(p1.authorities.map((x) => [x.sourceDocumentId as string, x]));
      expect(byDoc.get(a.id)).toMatchObject({ scopeKey: "global", authorityStatus: "CURRENT_PRIMARY", rationale: "The core rulebook", canonPolicyId: p1.id });
      expect(byDoc.get(b.id)).toMatchObject({ scopeKey: "global", authorityStatus: "CURRENT_SUPPLEMENTAL", rationale: null });
      expect(await getCanonPolicy(p1.id)).toEqual(p1);
    });

    it("creating Policy 2 never changes Policy 1: A stays CURRENT_PRIMARY (§20, §41)", async () => {
      const r = await ruleset("history");
      const [a, b] = [await source("A"), await source("B")] as const;
      const p1 = await createCanonPolicy(r.id, { name: "P1", authorities: [auth(a.id, "global", "CURRENT_PRIMARY")] });
      const snapshot = await getCanonPolicy(p1.id);

      const p2 = await createCanonPolicy(r.id, { name: "P2", authorities: [auth(a.id, "global", "SUPERSEDED"), auth(b.id, "global", "CURRENT_PRIMARY")] });

      expect(p2.policyVersion).toBe(2);
      expect(await getCanonPolicy(p1.id)).toEqual(snapshot); // exactly what it was
      expect((await resolveSourceAuthority(p1.id, a.id, "global")).authorityStatus).toBe("CURRENT_PRIMARY");
      expect((await resolveSourceAuthority(p2.id, a.id, "global")).authorityStatus).toBe("SUPERSEDED");
      expect((await listCanonPolicies(r.id)).map((p) => p.policyVersion)).toEqual([1, 2]);
      expect((await getLatestCanonPolicy(r.id))?.id).toBe(p2.id);
    });

    it("policy numbering is scoped per Ruleset, never caller-supplied, and an empty policy is allowed (§3, §12)", async () => {
      const [r1, r2] = [await ruleset("scope1"), await ruleset("scope2")] as const;
      const m1 = await createCanonPolicy(r1.id, { name: "a", authorities: [] });
      const m2 = await createCanonPolicy(r2.id, { name: "b", authorities: [] });
      expect([m1.policyVersion, m2.policyVersion]).toEqual([1, 1]);
      expect(m1.authorities).toEqual([]);
      const smuggled = await createCanonPolicy(r1.id, { name: "c", authorities: [], policyVersion: 99 } as unknown as CreateCanonPolicyInput);
      expect(smuggled.policyVersion).toBe(2);
      expect(await listCanonPolicies((await ruleset("nopolicies")).id)).toEqual([]);
      expect(await getLatestCanonPolicy((await ruleset("nopolicies2")).id)).toBeNull();
    });
  });

  describe("scope resolution: exact -> global -> UNRESOLVED, inside one policy (§15, §16, §17, §21, §22, §42, §43)", () => {
    it("an exact scope beats global; another scope falls back to global; the answer says which (§21, §42)", async () => {
      const r = await ruleset("scopes");
      const a = await source("A");
      const p = await createCanonPolicy(r.id, {
        name: "P",
        authorities: [auth(a.id, "global", "CURRENT_SUPPLEMENTAL"), auth(a.id, "entity_type.spell_effect", "GOVERNING")],
      });

      expect(await resolveSourceAuthority(p.id, a.id, "entity_type.spell_effect")).toEqual({
        policyId: p.id,
        sourceDocumentId: a.id,
        requestedScopeKey: "entity_type.spell_effect",
        resolvedScopeKey: "entity_type.spell_effect",
        authorityStatus: "GOVERNING",
        source: "EXACT",
      });
      expect(await resolveSourceAuthority(p.id, a.id, "entity_type.skill")).toEqual({
        policyId: p.id,
        sourceDocumentId: a.id,
        requestedScopeKey: "entity_type.skill",
        resolvedScopeKey: "global",
        authorityStatus: "CURRENT_SUPPLEMENTAL",
        source: "GLOBAL_FALLBACK",
      });
      expect(await resolveSourceAuthority(p.id, a.id, "global")).toMatchObject({ source: "EXACT", authorityStatus: "CURRENT_SUPPLEMENTAL" });
    });

    it("missing authority resolves UNRESOLVED with no resolved scope, and writes NOTHING (§22, §43)", async () => {
      const r = await ruleset("unres");
      const [a, c] = [await source("A"), await source("C")] as const;
      const p = await createCanonPolicy(r.id, { name: "P", authorities: [auth(a.id, "global", "GOVERNING")] });
      const before = await counts(r.id);

      for (const scope of ["global", "entity_type.skill"]) {
        expect(await resolveSourceAuthority(p.id, c.id, scope)).toEqual({
          policyId: p.id,
          sourceDocumentId: c.id,
          requestedScopeKey: scope,
          resolvedScopeKey: null,
          authorityStatus: "UNRESOLVED",
          source: "UNRESOLVED",
        });
      }
      // A document that does not exist, or whose id is malformed, is simply unresolved — never an error, never a row.
      expect((await resolveSourceAuthority(p.id, MISSING, "global")).source).toBe("UNRESOLVED");
      expect((await resolveSourceAuthority(p.id, "not-a-uuid", "global")).source).toBe("UNRESOLVED");

      expect(await counts(r.id)).toEqual(before);
      expect(await prisma.sourceAuthorityRecord.count({ where: { sourceDocumentId: c.id } })).toBe(0);
      expect(await prisma.sourceAuthorityRecord.count({ where: { canonPolicyId: p.id, authorityStatus: "UNRESOLVED" } })).toBe(0);
    });

    it("a specific-scope declaration does not imply global, and a different specific scope does not inherit it", async () => {
      const r = await ruleset("specific");
      const a = await source("A");
      const p = await createCanonPolicy(r.id, { name: "P", authorities: [auth(a.id, "entity_type.spell_effect", "GOVERNING")] });
      expect((await resolveSourceAuthority(p.id, a.id, "entity_type.spell_effect")).source).toBe("EXACT");
      expect((await resolveSourceAuthority(p.id, a.id, "global")).source).toBe("UNRESOLVED");
      expect((await resolveSourceAuthority(p.id, a.id, "entity_type.skill")).source).toBe("UNRESOLVED");
    });

    it("exact lookup never falls back: asking for a scope with no record returns null even though global exists (§15)", async () => {
      const r = await ruleset("exactonly");
      const a = await source("A");
      const p = await createCanonPolicy(r.id, { name: "P", authorities: [auth(a.id, "global", "CURRENT_PRIMARY")] });
      expect(await getSourceAuthorityRecord(p.id, a.id, "entity_type.spell_effect")).toBeNull();
      expect(await getSourceAuthorityRecord(p.id, a.id, "global")).toMatchObject({ authorityStatus: "CURRENT_PRIMARY" });
    });

    it("a declaration that is itself UNRESOLVED still answers EXACT and blocks the global fallback", async () => {
      const r = await ruleset("explicitunres");
      const a = await source("A");
      const p = await createCanonPolicy(r.id, {
        name: "P",
        authorities: [auth(a.id, "global", "GOVERNING"), auth(a.id, "entity_type.skill", "UNRESOLVED")],
      });
      expect(await resolveSourceAuthority(p.id, a.id, "entity_type.skill")).toMatchObject({ source: "EXACT", authorityStatus: "UNRESOLVED" });
    });

    it("reports an unknown policy as NOT_FOUND and a malformed scope as INVALID_SCOPE (lookups and resolution)", async () => {
      const r = await ruleset("lookuperr");
      const a = await source("A");
      const p = await createCanonPolicy(r.id, { name: "P", authorities: [] });
      for (const id of [MISSING, "not-a-uuid"]) {
        await expect(resolveSourceAuthority(id, a.id, "global"), id).rejects.toMatchObject({ code: CANON_POLICY_ERROR_CODES.NOT_FOUND });
        await expect(getSourceAuthorityRecord(id, a.id, "global"), id).rejects.toMatchObject({ code: CANON_POLICY_ERROR_CODES.NOT_FOUND });
        await expect(getCanonPolicy(id), id).rejects.toMatchObject({ code: CANON_POLICY_ERROR_CODES.NOT_FOUND });
      }
      for (const scope of ["Global", "page.12", "", "has space"]) {
        await expect(resolveSourceAuthority(p.id, a.id, scope), scope).rejects.toMatchObject({ code: SOURCE_AUTHORITY_ERROR_CODES.INVALID_SCOPE });
        await expect(getSourceAuthorityRecord(p.id, a.id, scope), scope).rejects.toMatchObject({ code: SOURCE_AUTHORITY_ERROR_CODES.INVALID_SCOPE });
      }
    });
  });

  describe("no fallback across policies or Rulesets (§18, §19)", () => {
    it("Policy 2 with no declaration for Source A does NOT read Policy 1 (§18)", async () => {
      const r = await ruleset("xpol");
      const a = await source("A");
      const p1 = await createCanonPolicy(r.id, { name: "P1", authorities: [auth(a.id, "global", "GOVERNING")] });
      const p2 = await createCanonPolicy(r.id, { name: "P2", authorities: [] });
      expect((await resolveSourceAuthority(p1.id, a.id, "global")).authorityStatus).toBe("GOVERNING"); // P1 does declare it...
      expect(await resolveSourceAuthority(p2.id, a.id, "global")).toMatchObject({ source: "UNRESOLVED", authorityStatus: "UNRESOLVED", resolvedScopeKey: null });
    });

    it("a child Ruleset's policy does NOT consult its parent Ruleset's policy (§19)", async () => {
      const parent = await ruleset("pp");
      const child = await ruleset("pc", parent.id);
      const a = await source("A");
      await createCanonPolicy(parent.id, { name: "parent policy", authorities: [auth(a.id, "global", "GOVERNING")] });
      const childPolicy = await createCanonPolicy(child.id, { name: "child policy", authorities: [] });
      expect(await resolveSourceAuthority(childPolicy.id, a.id, "global")).toMatchObject({ source: "UNRESOLVED", authorityStatus: "UNRESOLVED" });
    });
  });

  describe("validation and atomicity (§10, §11, §31, §44–§47)", () => {
    it("rejects the same Source + scope twice with DUPLICATE_SOURCE_SCOPE, persisting nothing (§44)", async () => {
      const r = await ruleset("dup");
      const a = await source("A");
      const attempt = createCanonPolicy(r.id, { name: "P", authorities: [auth(a.id, "global", "GOVERNING"), auth(a.id, "global", "SUPERSEDED")] });
      await expect(attempt).rejects.toMatchObject({ code: SOURCE_AUTHORITY_ERROR_CODES.DUPLICATE_SOURCE_SCOPE });
      await expect(attempt.catch((e: unknown) => e)).resolves.toBeInstanceOf(DomainError);
      expect(await counts(r.id)).toEqual({ policies: 0, records: 0 });
    });

    it("allows one Source in several scopes, and both persist (§10, §45)", async () => {
      const r = await ruleset("multi");
      const a = await source("A");
      const p = await createCanonPolicy(r.id, {
        name: "P",
        authorities: [auth(a.id, "entity_type.spell_effect", "GOVERNING"), auth(a.id, "global", "CURRENT_PRIMARY")],
      });
      expect(p.authorities.map((x) => [x.scopeKey, x.authorityStatus])).toEqual([
        ["entity_type.spell_effect", "GOVERNING"],
        ["global", "CURRENT_PRIMARY"],
      ]);
      expect(await prisma.sourceAuthorityRecord.count({ where: { canonPolicyId: p.id, sourceDocumentId: a.id } })).toBe(2);
    });

    it("rejects a record for a nonexistent SourceDocument and rolls the whole policy back (§46, service level)", async () => {
      const r = await ruleset("nosrc");
      const [a, b] = [await source("A"), await source("B")] as const;
      for (const badId of [MISSING, "not-a-uuid"]) {
        await expect(
          createCanonPolicy(r.id, { name: "P", authorities: [auth(a.id, "global", "GOVERNING"), auth(b.id, "global", "CURRENT_PRIMARY"), auth(badId, "global", "HISTORICAL")] }),
          badId,
        ).rejects.toMatchObject({ code: SOURCE_AUTHORITY_ERROR_CODES.SOURCE_NOT_FOUND });
      }
      expect(await counts(r.id)).toEqual({ policies: 0, records: 0 });
    });

    it("the WRITE itself is atomic: a failure inside the transaction, after valid records were inserted, rolls everything back (§31)", async () => {
      // Bypasses the service's validation on purpose: the foreign key is what fails, AFTER the policy and two records were inserted.
      const r = await ruleset("atomic");
      const [a, b] = [await source("A"), await source("B")] as const;
      await expect(
        insertCanonPolicyWithAuthorities(r.id, "P", null, [
          { sourceDocumentId: a.id, scopeKey: "global", authorityStatus: "GOVERNING", rationale: null },
          { sourceDocumentId: b.id, scopeKey: "global", authorityStatus: "CURRENT_PRIMARY", rationale: null },
          { sourceDocumentId: MISSING, scopeKey: "global", authorityStatus: "HISTORICAL", rationale: null },
        ]),
      ).rejects.toThrow(/source_authority_records_source_document_id_fkey/);
      expect(await counts(r.id)).toEqual({ policies: 0, records: 0 });
      expect((await createCanonPolicy(r.id, { name: "after", authorities: [] })).policyVersion).toBe(1); // no version was consumed
    });

    it("reports a missing Ruleset, including a malformed id, with its own controlled code (§47)", async () => {
      const a = await source("A");
      for (const id of [MISSING, "not-a-uuid"]) {
        await expect(createCanonPolicy(id, { name: "P", authorities: [auth(a.id, "global", "GOVERNING")] }), id).rejects.toMatchObject({
          code: CANON_POLICY_ERROR_CODES.RULESET_NOT_FOUND,
        });
        await expect(listCanonPolicies(id), id).rejects.toMatchObject({ code: CANON_POLICY_ERROR_CODES.RULESET_NOT_FOUND });
        await expect(getLatestCanonPolicy(id), id).rejects.toMatchObject({ code: CANON_POLICY_ERROR_CODES.RULESET_NOT_FOUND });
      }
    });

    it("rejects invalid scopes, statuses, and shapes with controlled codes, persisting nothing", async () => {
      const r = await ruleset("invalid");
      const a = await source("A");
      const bad: Array<[string, unknown, string]> = [
        ["scope Global", { name: "P", authorities: [auth(a.id, "Global", "GOVERNING")] }, SOURCE_AUTHORITY_ERROR_CODES.INVALID_SCOPE],
        ["scope page.12", { name: "P", authorities: [auth(a.id, "page.12", "GOVERNING")] }, SOURCE_AUTHORITY_ERROR_CODES.INVALID_SCOPE],
        ["status BOGUS", { name: "P", authorities: [auth(a.id, "global", "BOGUS")] }, CANON_POLICY_ERROR_CODES.INVALID_INPUT],
        ["blank name", { name: "  ", authorities: [] }, CANON_POLICY_ERROR_CODES.INVALID_INPUT],
        ["authorities not an array", { name: "P", authorities: "nope" }, CANON_POLICY_ERROR_CODES.INVALID_INPUT],
      ];
      for (const [label, input, code] of bad) {
        await expect(createCanonPolicy(r.id, input as CreateCanonPolicyInput), label).rejects.toMatchObject({ code });
      }
      expect(await counts(r.id)).toEqual({ policies: 0, records: 0 });
    });

    it("orders authority records by scope_key then source document id, regardless of input order (§37)", async () => {
      const r = await ruleset("order");
      const docs = [await source("o1"), await source("o2"), await source("o3")] as const;
      const p = await createCanonPolicy(r.id, {
        name: "P",
        authorities: [
          auth(docs[2].id, "global", "GOVERNING"),
          auth(docs[0].id, "magic.spellcasting", "GOVERNING"),
          auth(docs[1].id, "global", "GOVERNING"),
          auth(docs[0].id, "entity_type.skill", "GOVERNING"),
        ],
      });
      const ids = [docs[1].id, docs[2].id].sort();
      expect(p.authorities.map((x) => `${x.scopeKey}|${x.sourceDocumentId}`)).toEqual([
        `entity_type.skill|${docs[0].id}`,
        `global|${ids[0]}`,
        `global|${ids[1]}`,
        `magic.spellcasting|${docs[0].id}`,
      ]);
    });
  });

  describe("concurrency (§32, §48)", () => {
    it("concurrent creations for one Ruleset all succeed with distinct, gap-free versions and no lost policy", async () => {
      const r = await ruleset("race");
      const a = await source("A");
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => createCanonPolicy(r.id, { name: `P${i}`, authorities: [auth(a.id, "global", "GOVERNING")] })),
      );
      expect(results.map((p) => p.policyVersion).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
      expect(new Set(results.map((p) => p.id)).size).toBe(5);
      expect(await counts(r.id)).toEqual({ policies: 5, records: 5 }); // every policy got its record
    });
  });

  describe("SourceDocument.authorityStatus is a distinct, unsynchronized fact (§7, §50)", () => {
    it("the document's own status and a Ruleset-scoped record coexist and never affect each other", async () => {
      const [ra, rb] = [await ruleset("meta_a"), await ruleset("meta_b")] as const;
      const doc = await source("meta", "PLAYTEST_REFERENCE");
      const pa = await createCanonPolicy(ra.id, { name: "A/1", authorities: [auth(doc.id, "global", "GOVERNING")] });
      const pb = await createCanonPolicy(rb.id, { name: "B/1", authorities: [auth(doc.id, "global", "REFERENCE_ONLY")] });

      // All three facts at once:
      expect((await prisma.sourceDocument.findUnique({ where: { id: doc.id } }))?.authorityStatus).toBe("PLAYTEST_REFERENCE");
      expect((await resolveSourceAuthority(pa.id, doc.id, "global")).authorityStatus).toBe("GOVERNING");
      expect((await resolveSourceAuthority(pb.id, doc.id, "global")).authorityStatus).toBe("REFERENCE_ONLY");

      // Changing one does not silently change the other (there is deliberately no sync).
      await prisma.sourceDocument.update({ where: { id: doc.id }, data: { authorityStatus: "HISTORICAL" } });
      expect((await resolveSourceAuthority(pa.id, doc.id, "global")).authorityStatus).toBe("GOVERNING");
      await createCanonPolicy(ra.id, { name: "A/2", authorities: [auth(doc.id, "global", "SUPERSEDED")] });
      expect((await prisma.sourceDocument.findUnique({ where: { id: doc.id } }))?.authorityStatus).toBe("HISTORICAL");

      // A document with NO descriptive status at all is not "unresolved" in policy terms either.
      const bare = await source("bare");
      expect(bare.authorityStatus).toBeNull();
      const p = await createCanonPolicy(ra.id, { name: "A/3", authorities: [auth(bare.id, "global", "CURRENT_PRIMARY")] });
      expect((await resolveSourceAuthority(p.id, bare.id, "global")).authorityStatus).toBe("CURRENT_PRIMARY");
    });
  });

  describe("source authority never selects content (§1, §23–§25, §51, §52)", () => {
    it("manifest pinning stays authoritative: an explicit pin of the DRAFT resolves, whatever the policy says (§23, §25, §51)", async () => {
      const r = await ruleset("mf");
      const a = await entity("manifest");
      const a1 = await version(a.id, "A1 (CANON)");
      for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a1.id, status);
      const a2 = await version(a.id, "A2 (draft)");
      const [srcA, srcB] = [await source("supports A1", "GOVERNING"), await source("supports A2", "REFERENCE_ONLY")] as const;
      await createSourceReference(a1.id, { sourceDocumentId: srcA.id });
      await createSourceReference(a2.id, { sourceDocumentId: srcB.id });

      const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const manifestBefore = await getRulesetManifest(m.id);
      const manifestRows = async () => ({
        manifests: await prisma.rulesetManifest.count({ where: { rulesetId: r.id } }),
        entries: await prisma.rulesetManifestEntry.count({ where: { manifest: { rulesetId: r.id } } }),
      });
      const rowsBefore = await manifestRows();

      // Governance that, if it mattered, would favour A1: A's source GOVERNING, A2's source REFERENCE_ONLY.
      const p = await createCanonPolicy(r.id, {
        name: "favours A1",
        authorities: [auth(srcA.id, "global", "GOVERNING", "supports A1"), auth(srcB.id, "global", "REFERENCE_ONLY", "supports A2")],
      });
      expect((await resolveSourceAuthority(p.id, srcA.id, "global")).authorityStatus).toBe("GOVERNING");

      expect((await resolveEntityVersionFromManifest(m.id, a.id))?.id).toBe(a2.id); // still A2
      expect(await getRulesetManifest(m.id)).toEqual(manifestBefore); // the manifest is byte-for-byte unchanged
      expect(await manifestRows()).toEqual(rowsBefore); // and no manifest or entry was added
    });

    it("EntityVersion lifecycle is untouched by policy creation: statuses are exactly as they were (§25)", async () => {
      const r = await ruleset("life");
      const a = await entity("life");
      const a1 = await version(a.id, "A1");
      for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a1.id, status);
      const a2 = await version(a.id, "A2");
      const doc = await source("life");
      await createSourceReference(a2.id, { sourceDocumentId: doc.id });
      await createCanonPolicy(r.id, { name: "P", authorities: [auth(doc.id, "global", "GOVERNING")] });
      const status = async (id: string) => (await prisma.entityVersion.findUnique({ where: { id } }))?.status;
      expect([await status(a1.id), await status(a2.id)]).toEqual(["CANON", "DRAFT"]);
    });

    it("inheritance stays authoritative: a child's explicit pin resolves over an inherited one, whatever the policy says (§24, §52)", async () => {
      const parent = await ruleset("ip");
      const child = await ruleset("ic", parent.id);
      const a = await entity("inherit");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const src = await source("supports A1", "GOVERNING");
      await createSourceReference(a1.id, { sourceDocumentId: src.id });
      const p1 = await createRulesetManifest(parent.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [{ entityId: a.id, entityVersionId: a2.id }] });

      await createCanonPolicy(parent.id, { name: "parent: A1's source GOVERNING", authorities: [auth(src.id, "global", "GOVERNING")] });
      await createCanonPolicy(child.id, { name: "child: same", authorities: [auth(src.id, "global", "GOVERNING")] });

      const resolved = await resolveEffectiveEntityVersion(c1.id, a.id);
      expect(resolved).toMatchObject({ entityVersionId: a2.id, resolutionDepth: 0, source: "EXPLICIT", resolvedFromManifestId: c1.id });
    });

    it("exposes exactly six policy operations, and none that changes a policy, its records, or its version (§13, §14)", async () => {
      const surface = await import("../../src/index");
      const names = Object.keys(surface);
      expect(names.filter((n) => /canonpolic|authority/i.test(n)).sort()).toEqual([
        "createCanonPolicy",
        "getCanonPolicy",
        "getLatestCanonPolicy",
        "getSourceAuthorityRecord",
        "listCanonPolicies",
        "resolveSourceAuthority",
      ]);
      // Anchored at the START of the name (an unanchored pattern would match "Ruleset"/"Policy" fragments), with a
      // control proving the check can fail: it must flag genuine mutators and nothing that is actually exported.
      const mutatorVerb = /^(set|change|rebase|reparent|update|add|remove|delete|patch|upsert|activate|publish|promote)/i;
      const mutators = (list: string[]) => list.filter((n) => /polic|authority|scope/i.test(n) && mutatorVerb.test(n));
      expect(mutators(["updateCanonPolicy", "setSourceAuthority", "removeSourceAuthorityRecord", "activateCanonPolicy", "addAuthorityRecord"])).toHaveLength(5);
      expect(mutators(names)).toEqual([]);
    });
  });

  describe("the database enforces what it can (§33, §36, §49, §53)", () => {
    it("rejects a duplicate (policy, document, scope) and a duplicate (ruleset, version) even when inserted directly", async () => {
      const r = await ruleset("directdup");
      const a = await source("A");
      const p = await createCanonPolicy(r.id, { name: "P", authorities: [auth(a.id, "global", "GOVERNING")] });
      await expect(
        prisma.sourceAuthorityRecord.create({ data: { canonPolicyId: p.id, sourceDocumentId: a.id, scopeKey: "global", authorityStatus: "HISTORICAL" } }),
      ).rejects.toThrow(/source_authority_records_policy_source_scope_key/);
      await expect(prisma.canonPolicy.create({ data: { rulesetId: r.id, policyVersion: p.policyVersion, name: "dup" } })).rejects.toThrow(
        /canon_policies_ruleset_id_policy_version_key/,
      );
    });

    it("protects governance history: a Ruleset with a policy, a policy with records, and a document with an authority record cannot be deleted (RESTRICT)", async () => {
      const r = await ruleset("restrict");
      const a = await source("A");
      const p = await createCanonPolicy(r.id, { name: "P", authorities: [auth(a.id, "global", "GOVERNING")] });

      await expect(prisma.sourceDocument.delete({ where: { id: a.id } })).rejects.toThrow(/source_authority_records_source_document_id_fkey/);
      await expect(prisma.canonPolicy.delete({ where: { id: p.id } })).rejects.toThrow(/source_authority_records_canon_policy_id_fkey/);
      await expect(prisma.ruleset.delete({ where: { id: r.id } })).rejects.toThrow(/canon_policies_ruleset_id_fkey/);
      expect(await getCanonPolicy(p.id)).toMatchObject({ id: p.id }); // the whole history survived every attempt
      expect((await getCanonPolicy(p.id)).authorities).toHaveLength(1);
    });

    it("the three foreign keys, their columns, and every delete rule are what the design says", async () => {
      const rules = await prisma.$queryRaw<Array<{ constraint_name: string; delete_rule: string }>>`
        SELECT constraint_name, delete_rule FROM information_schema.referential_constraints
        WHERE constraint_name IN ('canon_policies_ruleset_id_fkey', 'source_authority_records_canon_policy_id_fkey',
                                  'source_authority_records_source_document_id_fkey')
        ORDER BY constraint_name`;
      expect(rules).toHaveLength(3);
      expect(rules.every((rule) => rule.delete_rule === "RESTRICT")).toBe(true);
    });

    it("the tables have exactly the specified columns; nothing anywhere points at a current/active policy; no derived authority is stored (§53)", async () => {
      const cols = async (table: string) =>
        (await prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY column_name`)
          .map((c) => c.column_name);
      expect(await cols("canon_policies")).toEqual(["created_at", "description", "id", "name", "policy_version", "ruleset_id"]);
      expect(await cols("source_authority_records")).toEqual([
        "authority_status",
        "canon_policy_id",
        "created_at",
        "id",
        "rationale",
        "scope_key",
        "source_document_id",
      ]);
      const pointers = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~* '(current_policy|active_policy|effective_policy|use_latest_policy|is_current|is_active)'`;
      expect(pointers).toEqual([]);
      const touched = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('rulesets', 'ruleset_manifests', 'ruleset_manifest_entries', 'entity_versions', 'source_documents')
          AND column_name ~* '(polic|authority_record)'`;
      expect(touched).toEqual([]); // no column on Ruleset / manifest / EntityVersion / SourceDocument points at a policy
    });

    it("the M2-WO4 migration is applied and finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261005220000_add_canon_policy'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });
  });
});
