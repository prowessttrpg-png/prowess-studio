/**
 * PAS-10 M6-WO1 — Compendium Administration Foundation: HTTP-level integration proof (§71–75, §84).
 *
 * Every step goes through a REAL route handler against the real prowess_studio_test database: the new authoring routes
 * for authoring, the existing M1 routes to reload, the existing M2 routes for Rulesets / Manifests / ChangeSets, and the
 * existing server materializer for the M5 bridge. Fixture content is test-only (`test.m6wo1.*`, and the WO's worked
 * example key `spell.effect.m6_test_force_push`) and never becomes game canon.
 *
 * Invariants exercised: M6-I001 storage · M6-I003 M5 validation · M6-I004 immutable history · M6-I005 M2-owned
 * publication · M6-I006 exact references · M6-I007 side-effect-free validation / preview · M6-I008 server-allocated
 * revisions · M6-I010 no inferred kind.
 */
import { assertRunningAgainstTestDatabase, createEntity, createEntityVersion, createKeywordDefinition, createSourceDocument, materializeProwessDefinitionsFromManifest, prisma, transitionEntityVersionStatus } from "@prowess/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Catalog from "../../app/api/compendium-authoring/catalog/route";
import * as Validate from "../../app/api/compendium-authoring/validate/route";
import * as Definitions from "../../app/api/compendium-authoring/definitions/route";
import * as Draft from "../../app/api/compendium-authoring/entity-versions/[versionId]/route";
import * as StoredValidation from "../../app/api/compendium-authoring/entity-versions/[versionId]/validation/route";
import * as SubmitReview from "../../app/api/compendium-authoring/entity-versions/[versionId]/submit-review/route";
import * as Proposals from "../../app/api/compendium-authoring/entity-versions/[versionId]/change-set-proposals/route";
import * as Revisions from "../../app/api/compendium-authoring/entities/[entityId]/revisions/route";
import * as References from "../../app/api/compendium-authoring/definition-references/route";
import * as Keywords from "../../app/api/compendium-authoring/keywords/route";
import * as M1Versions from "../../app/api/entities/[entityId]/versions/route";
import * as M1Version from "../../app/api/entity-versions/[versionId]/route";
import * as M1Status from "../../app/api/entity-versions/[versionId]/status/route";
import * as M1EntityKeywords from "../../app/api/entities/[entityId]/keywords/route";
import * as M1VersionKeywords from "../../app/api/entity-versions/[versionId]/keywords/route";
import * as M1Sources from "../../app/api/entity-versions/[versionId]/sources/route";
import * as R from "./m2-routes";
import { call, cleanupM2Rulesets, fingerprint } from "./m2-api-harness";
import { cleanupFixtures } from "./cleanup";

const PREFIX = "test.m6wo1";
const WORKED_KEY = "spell.effect.m6_test_force_push";
let n = 0;
const key = (label: string) => `${PREFIX}.${label}_${Date.now()}_${++n}`;
const READ_ONLY_TABLES = ["entities", "entity_versions", "entity_keywords", "entity_version_keywords", "source_references", "change_sets", "change_set_operations", "ruleset_manifests", "ruleset_releases"];

let control: { id: string; canonicalKey: string };
let forced: { id: string; canonicalKey: string };
let sourceDocumentId: string;

/** A valid version-1 SPELL_EFFECT content for the test-only Force Push example (§56). */
const forcePush = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  systemFamily: "SPELL",
  definitionKind: "SPELL_EFFECT",
  payload: {
    effectFamily: "MOVEMENT",
    keywords: [control.canonicalKey, forced.canonicalKey],
    parameters: {},
    compatibility: [{ relation: "TARGETING", allow: ["SINGLE_TARGET"] }],
    costContributions: [{ contributionKey: "effect.mp", currency: "MP", data: { kind: "FIXED", amount: 2 } }],
    rules: {},
    resolution: { mode: "SAVING_THROW", data: { saveStat: "STR" } },
    outcomes: [{ outcomeKey: "push", data: { feet: 10 } }],
    ...extra,
  },
});

async function cleanup() {
  // FK order: Rulesets (manifests / ChangeSets pin the entities) → the worked example (it carries the prefix's
  // Keywords and SourceDocument) → everything under the prefix.
  await cleanupM2Rulesets(PREFIX);
  await cleanupFixtures({ entityPrefix: WORKED_KEY });
  await cleanupFixtures({ entityPrefix: PREFIX, keywordPrefix: PREFIX, documentTitlePrefix: PREFIX });
}

async function createDefinition(body: Record<string, unknown>) {
  return call(Definitions.POST, "POST", "/api/compendium-authoring/definitions", {}, body);
}
const createBody = (canonicalKey: string, extra: Record<string, unknown> = {}) => ({ definitionKind: "SPELL_EFFECT", canonicalKey, displayName: "Force Push (test)", prowessDefinition: forcePush(), ...extra });
const save = (versionId: string, body: Record<string, unknown>) => call(Draft.PUT, "PUT", `/api/compendium-authoring/entity-versions/${versionId}`, { versionId }, body);
const reload = async (versionId: string) => (await call(M1Version.GET, "GET", `/api/entity-versions/${versionId}`, { versionId })).data;

describe("M6-WO1 Compendium authoring API (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
    await cleanup();
    const a = await createKeywordDefinition({ canonicalKey: `${PREFIX}.control_${Date.now()}`, name: "Control (test)" });
    const b = await createKeywordDefinition({ canonicalKey: `${PREFIX}.forced_movement_${Date.now()}`, name: "Forced Movement (test)" });
    control = { id: a.id, canonicalKey: a.canonicalKey };
    forced = { id: b.id, canonicalKey: b.canonicalKey };
    sourceDocumentId = (await createSourceDocument({ title: `${PREFIX} Core Playtest excerpt`, sourceType: "DOCUMENT" })).id;
  });
  afterAll(cleanup);

  describe("catalog and side-effect-free validation", () => {
    it("serves the authoring catalog derived from the M5 registry: kinds, allowed EntityTypes, schema versions, vocabularies", async () => {
      const r = await call(Catalog.GET, "GET", "/api/compendium-authoring/catalog");
      expect(r.status).toBe(200);
      const effect = r.data.kinds.find((k: { definitionKind: string }) => k.definitionKind === "SPELL_EFFECT");
      expect(effect).toEqual({ definitionKind: "SPELL_EFFECT", systemFamily: "SPELL", branch: "SPELL", sharedContract: "EFFECT", allowedEntityTypes: ["SPELL_EFFECT"], supportedSchemaVersions: [1], authoringSchemaVersion: 1, authorable: true });
      expect(r.data.kinds.find((k: { definitionKind: string }) => k.definitionKind === "WEAPON")).toMatchObject({ authorable: false, supportedSchemaVersions: [] });
      expect(r.data.vocabularies.resolutionModes).toContain("SAVING_THROW");
      expect(r.data.legacyTerms).toContainEqual({ legacyTerm: "Emission", canonicalTerm: "Evocation" });
    });

    it("M6-I003 / M6-I007 validates an unsaved candidate through M5 — PASS, FAIL with a usable path, and no persistence", async () => {
      const before = await fingerprint(READ_ONLY_TABLES);
      const pass = await call(Validate.POST, "POST", "/api/compendium-authoring/validate", {}, { definitionKind: "SPELL_EFFECT", prowessDefinition: forcePush() });
      expect(pass.status).toBe(200);
      expect(pass.data).toMatchObject({ status: "PASS", definitionKind: "SPELL_EFFECT", issues: [], refused: false });
      expect(pass.data.normalized.payload.effectFamily).toBe("MOVEMENT");
      const fail = await call(Validate.POST, "POST", "/api/compendium-authoring/validate", {}, { definitionKind: "SPELL_EFFECT", prowessDefinition: forcePush({ resolution: { mode: "TELEPATHY", data: {} } }) });
      expect(fail.data.status).toBe("FAIL");
      expect(fail.data.issues).toContainEqual(expect.objectContaining({ code: "PROWESS_DEFINITION.INVALID_PAYLOAD", path: "payload.resolution.mode", definitionKind: "SPELL_EFFECT", component: "resolution", severity: "ERROR" }));
      expect(JSON.stringify(fail.body)).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+|stack/);
      expect(await fingerprint(READ_ONLY_TABLES)).toEqual(before);
    });

    it("M6-I009 §22 an unknown payload Keyword fails validation instead of becoming an implicit rule", async () => {
      const r = await call(Validate.POST, "POST", "/api/compendium-authoring/validate", {}, { definitionKind: "SPELL_EFFECT", prowessDefinition: forcePush({ keywords: ["test.m6wo1.no_such_keyword"] }) });
      expect(r.data.status).toBe("FAIL");
      expect(r.data.issues).toContainEqual(expect.objectContaining({ code: "COMPENDIUM_AUTHORING.UNKNOWN_KEYWORD", path: "payload.keywords[0]", source: "REFERENCE" }));
    });

    it("§57 Targeting may not carry Damage / outcome / Save fields — M5 decides, the editor does not", async () => {
      const targeting = { schemaVersion: 1, systemFamily: "SPELL", definitionKind: "SPELL_TARGETING", payload: { semanticShape: "RADIUS", geometry: { radius: 10, damage: "2d6" }, keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {} } };
      const r = await call(Validate.POST, "POST", "/api/compendium-authoring/validate", {}, { definitionKind: "SPELL_TARGETING", prowessDefinition: targeting });
      expect(r.data.issues).toContainEqual(expect.objectContaining({ code: "PROWESS_DEFINITION.TARGETING_IMPLIES_OUTCOME", path: "payload.geometry.damage" }));
    });
  });

  describe("§84 worked example: create → save → reload → validate → materialize → Keyword → provenance → revision 2", () => {
    let entityId: string;
    let rev1: { id: string; updatedAt: string };
    let rev2: { id: string; updatedAt: string };

    it("M6-I001 creates the Entity and Revision 1 as DRAFT holding the exact authored prowessDefinition, with Keywords and provenance", async () => {
      const r = await createDefinition(createBody(WORKED_KEY, {
        shortDescription: "Pushes a creature away (test-only fixture).",
        rulesText: "Test-only rules text. Never parsed into mechanics.",
        changeSummary: "Initial authoring.",
        entityKeywordIds: [control.id],
        versionKeywordIds: [forced.id],
        sources: [{ sourceDocumentId, sectionLabel: "Spell Effects", pageReference: "p. 212", sourceExcerptNote: "Force Push entry" }],
      }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.data.entity).toMatchObject({ entityType: "SPELL_EFFECT", canonicalKey: WORKED_KEY });
      expect(r.data.version).toMatchObject({ revisionNumber: 1, status: "DRAFT", displayName: "Force Push (test)", parentVersionId: null });
      expect(r.data.version.structuredData).toEqual({ prowessDefinition: forcePush() });
      expect(r.data.validation.status).toBe("PASS");
      entityId = r.data.entity.id;
      rev1 = r.data.version;
    });

    it("reloads through the existing M1 routes: content, Entity- and Version-level Keywords and provenance are exactly as authored", async () => {
      const versions = await call(M1Versions.GET, "GET", `/api/entities/${entityId}/versions`, { entityId });
      expect(versions.data.map((v: { revisionNumber: number }) => v.revisionNumber)).toEqual([1]);
      expect((await reload(rev1.id)).structuredData).toEqual({ prowessDefinition: forcePush() });
      const ek = await call(M1EntityKeywords.GET, "GET", `/api/entities/${entityId}/keywords`, { entityId });
      const vk = await call(M1VersionKeywords.GET, "GET", `/api/entity-versions/${rev1.id}/keywords`, { versionId: rev1.id });
      expect(ek.data.map((a: { keyword: { id: string } }) => a.keyword.id)).toEqual([control.id]);
      expect(vk.data.map((a: { keyword: { id: string } }) => a.keyword.id)).toEqual([forced.id]);
      const sources = await call(M1Sources.GET, "GET", `/api/entity-versions/${rev1.id}/sources`, { versionId: rev1.id });
      expect(sources.data).toEqual([expect.objectContaining({ sourceDocumentId, sectionLabel: "Spell Effects", pageReference: "p. 212", sourceExcerptNote: "Force Push entry" })]);
    });

    it("saves the DRAFT in place (no new revision) and protects newer work with expectedUpdatedAt", async () => {
      const edited = forcePush({ outcomes: [{ outcomeKey: "push", data: { feet: 15 } }] });
      const ok = await save(rev1.id, { expectedUpdatedAt: rev1.updatedAt, displayName: "Force Push (test, edited)", prowessDefinition: edited, changeSummary: "Push distance edited." });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.data.version).toMatchObject({ id: rev1.id, revisionNumber: 1, status: "DRAFT", displayName: "Force Push (test, edited)", changeSummary: "Push distance edited." });
      expect(ok.data.validation.status).toBe("PASS");
      const stale = await save(rev1.id, { expectedUpdatedAt: rev1.updatedAt, displayName: "Overwrite attempt" });
      expect([stale.status, stale.body.error?.code]).toEqual([409, "COMPENDIUM_AUTHORING.STALE_REVISION"]);
      expect((await reload(rev1.id)).displayName).toBe("Force Push (test, edited)");
      const versions = await call(M1Versions.GET, "GET", `/api/entities/${entityId}/versions`, { entityId });
      expect(versions.data).toHaveLength(1);
      rev1 = ok.data.version;
    });

    it("a Draft may be saved incomplete (FAIL is reported, not refused); a kind change or an unstorable candidate is refused", async () => {
      const incomplete = await save(rev1.id, { expectedUpdatedAt: rev1.updatedAt, prowessDefinition: forcePush({ resolution: { mode: "TELEPATHY", data: {} } }) });
      expect(incomplete.status).toBe(200);
      expect(incomplete.data.validation.status).toBe("FAIL");
      rev1 = incomplete.data.version;
      const kindChange = await save(rev1.id, { expectedUpdatedAt: rev1.updatedAt, prowessDefinition: { ...forcePush(), definitionKind: "SPELL_TRAIT" } });
      expect([kindChange.status, kindChange.body.error?.code]).toEqual([409, "COMPENDIUM_AUTHORING.DEFINITION_KIND_CHANGE"]);
      const crossBranch = await save(rev1.id, { expectedUpdatedAt: rev1.updatedAt, prowessDefinition: { ...forcePush(), systemFamily: "MANEUVER" } });
      expect([crossBranch.status, crossBranch.body.error?.code]).toEqual([400, "COMPENDIUM_AUTHORING.DEFINITION_REFUSED"]);
      const fixed = await save(rev1.id, { expectedUpdatedAt: rev1.updatedAt, prowessDefinition: forcePush() });
      expect(fixed.data.validation.status).toBe("PASS");
      rev1 = fixed.data.version;
    });

    it("validates the STORED revision on demand, read-only", async () => {
      const before = await fingerprint(READ_ONLY_TABLES);
      const r = await call(StoredValidation.GET, "GET", `/api/compendium-authoring/entity-versions/${rev1.id}/validation`, { versionId: rev1.id });
      expect(r.data).toMatchObject({ status: "PASS", definitionKind: "SPELL_EFFECT" });
      expect(await fingerprint(READ_ONLY_TABLES)).toEqual(before);
    });

    it("§72 M5 BRIDGE: the exact saved revision materializes through the existing server path to the authored content", async () => {
      await call(SubmitReview.POST, "POST", `/api/compendium-authoring/entity-versions/${rev1.id}/submit-review`, { versionId: rev1.id });
      const approved = await call(M1Status.POST, "POST", `/api/entity-versions/${rev1.id}/status`, { versionId: rev1.id }, { status: "APPROVED" });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const ruleset = await call(R.Rulesets.POST, "POST", "/api/rulesets", {}, { canonicalKey: key("bridge_ruleset"), name: "M6-WO1 bridge (test)", channel: "CORE_PLAYTEST" });
      const manifest = await call(R.Manifests.POST, "POST", `/api/rulesets/${ruleset.data.id}/manifests`, { rulesetId: ruleset.data.id }, { entries: [{ entityId, entityVersionId: rev1.id }] });
      expect(manifest.status, JSON.stringify(manifest.body)).toBe(201);
      const { bundle } = await materializeProwessDefinitionsFromManifest(manifest.data.id);
      const envelope = bundle.definitions.find((d) => d.entityVersionId === rev1.id);
      expect(envelope).toMatchObject({ entityId, canonicalKey: WORKED_KEY, definitionKind: "SPELL_EFFECT", systemFamily: "SPELL", schemaVersion: 1 });
      const validated = await call(Validate.POST, "POST", "/api/compendium-authoring/validate", {}, { definitionKind: "SPELL_EFFECT", prowessDefinition: forcePush() });
      expect(envelope!.payload).toEqual(validated.data.normalized.payload);
    });

    it("M6-I004 an approved revision is immutable: Save is refused and the revision stays byte-for-byte unchanged", async () => {
      const row = async () => JSON.stringify(await prisma.entityVersion.findUnique({ where: { id: rev1.id } }));
      const before = await row();
      const current = await reload(rev1.id);
      const r = await save(rev1.id, { expectedUpdatedAt: current.updatedAt, displayName: "Rewrite history" });
      expect([r.status, r.body.error?.code]).toEqual([409, "ENTITY_VERSION.IMMUTABLE"]);
      expect(await row()).toBe(before);
    });

    it("M6-I008 Create New Revision: same Entity, server-allocated number 2, DRAFT, parent = base, content and Version Keywords copied", async () => {
      const refused = await call(Revisions.POST, "POST", `/api/compendium-authoring/entities/${entityId}/revisions`, { entityId }, { baseVersionId: rev1.id, revisionNumber: 7 });
      expect([refused.status, refused.body.error?.code]).toEqual([400, "API.INVALID_BODY"]);
      const r = await call(Revisions.POST, "POST", `/api/compendium-authoring/entities/${entityId}/revisions`, { entityId }, { baseVersionId: rev1.id, changeType: "MECHANICAL_PATCH", changeSummary: "Updated push distance." });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.data).toMatchObject({ entityId, revisionNumber: 2, status: "DRAFT", parentVersionId: rev1.id, changeType: "MECHANICAL_PATCH", changeSummary: "Updated push distance." });
      expect(r.data.structuredData).toEqual((await reload(rev1.id)).structuredData);
      const vk = await call(M1VersionKeywords.GET, "GET", `/api/entity-versions/${r.data.id}/keywords`, { versionId: r.data.id });
      expect(vk.data.map((a: { keyword: { id: string } }) => a.keyword.id)).toEqual([forced.id]);
      rev2 = r.data;
    });

    it("§74 editing Revision 2 leaves Revision 1 byte-for-byte unchanged; Revision 2 stays DRAFT", async () => {
      const row = async () => JSON.stringify(await prisma.entityVersion.findUnique({ where: { id: rev1.id } }));
      const before = await row();
      const r = await save(rev2.id, { expectedUpdatedAt: rev2.updatedAt, prowessDefinition: forcePush({ outcomes: [{ outcomeKey: "push", data: { feet: 20 } }] }), changeSummary: "Updated Radius scaling." });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.data.version).toMatchObject({ id: rev2.id, revisionNumber: 2, status: "DRAFT" });
      expect(await row()).toBe(before);
      rev2 = r.data.version;
    });

    it("§73 M2 BRIDGE: a passing revision enters the M2 workflow as an ordinary DRAFT ChangeSet — nothing applied or published", async () => {
      const ruleset = await call(R.Rulesets.POST, "POST", "/api/rulesets", {}, { canonicalKey: key("proposal_ruleset"), name: "M6-WO1 proposal (test)", channel: "CORE_PLAYTEST" });
      const before = await fingerprint(["ruleset_manifests", "ruleset_manifest_entries", "ruleset_releases", "entity_versions"]);
      const r = await call(Proposals.POST, "POST", `/api/compendium-authoring/entity-versions/${rev2.id}/change-set-proposals`, { versionId: rev2.id }, { rulesetId: ruleset.data.id, name: "Force Push revision 2", description: "From Compendium Admin" });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.data).toMatchObject({ rulesetId: ruleset.data.id, status: "DRAFT", name: "Force Push revision 2" });
      expect(r.data.operations).toEqual([expect.objectContaining({ operationType: "PIN_ENTITY_VERSION", targetEntityId: entityId, toEntityVersionId: rev2.id })]);
      const listed = await call(R.ChangeSets.GET, "GET", `/api/rulesets/${ruleset.data.id}/change-sets`, { rulesetId: ruleset.data.id });
      expect(listed.data.map((c: { id: string }) => c.id)).toEqual([r.data.id]);
      expect(await fingerprint(["ruleset_manifests", "ruleset_manifest_entries", "ruleset_releases", "entity_versions"])).toEqual(before);
    });

    it("a revision that does not pass validation cannot be proposed or submitted for review", async () => {
      const bad = await save(rev2.id, { expectedUpdatedAt: rev2.updatedAt, prowessDefinition: forcePush({ keywords: ["test.m6wo1.unknown_keyword"] }) });
      rev2 = bad.data.version;
      const ruleset = await call(R.Rulesets.POST, "POST", "/api/rulesets", {}, { canonicalKey: key("refused_ruleset"), name: "M6-WO1 refused (test)", channel: "CORE_PLAYTEST" });
      const proposal = await call(Proposals.POST, "POST", `/api/compendium-authoring/entity-versions/${rev2.id}/change-set-proposals`, { versionId: rev2.id }, { rulesetId: ruleset.data.id, name: "x" });
      expect([proposal.status, proposal.body.error?.code]).toEqual([409, "COMPENDIUM_AUTHORING.DEFINITION_NOT_VALID"]);
      const review = await call(SubmitReview.POST, "POST", `/api/compendium-authoring/entity-versions/${rev2.id}/submit-review`, { versionId: rev2.id });
      expect([review.status, review.body.error?.code]).toEqual([409, "COMPENDIUM_AUTHORING.DEFINITION_NOT_VALID"]);
      expect((await reload(rev2.id)).status).toBe("DRAFT");
    });

    it("lists the Definition for authoring discovery with kind, latest revision and structural validation", async () => {
      const r = await call(Definitions.GET, "GET", `/api/compendium-authoring/definitions?canonicalKey=${WORKED_KEY}`);
      expect(r.status).toBe(200);
      expect(r.data).toEqual([expect.objectContaining({ entity: expect.objectContaining({ id: entityId }), definitionKind: "SPELL_EFFECT", latestRevision: expect.objectContaining({ revisionNumber: 2, status: "DRAFT" }), structuralValidation: "PASS" })]);
    });

    it("M6-I006 the reference picker returns exact revisions with full exact references; a bad exact reference fails validation", async () => {
      const r = await call(References.GET, "GET", `/api/compendium-authoring/definition-references?search=${WORKED_KEY}&definitionKind=SPELL_EFFECT`);
      expect(r.data.map((c: { ref: { entityVersionId: string } }) => c.ref.entityVersionId)).toEqual([rev1.id, rev2.id]);
      expect(r.data[0].ref).toEqual({ entityId, entityVersionId: rev1.id, canonicalKey: WORKED_KEY, definitionKind: "SPELL_EFFECT", systemFamily: "SPELL" });
      const good = r.data[0].ref;
      const ok = await call(Validate.POST, "POST", "/api/compendium-authoring/validate", {}, { definitionKind: "SPELL_EFFECT", prowessDefinition: forcePush({ rules: { pairsWith: good } }) });
      expect(ok.data.issues.filter((i: { source: string }) => i.source === "REFERENCE")).toEqual([]);
      for (const bad of [{ ...good, canonicalKey: "spell.effect.other" }, { ...good, entityVersionId: "00000000-0000-4000-8000-000000000999" }, { ...good, definitionKind: "SPELL_TRAIT" }]) {
        const v = await call(Validate.POST, "POST", "/api/compendium-authoring/validate", {}, { definitionKind: "SPELL_EFFECT", prowessDefinition: forcePush({ rules: { pairsWith: bad } }) });
        expect(v.data.issues, JSON.stringify(bad)).toContainEqual(expect.objectContaining({ code: "COMPENDIUM_AUTHORING.INVALID_DEFINITION_REFERENCE", path: "payload.rules.pairsWith" }));
      }
      const kw = await call(Keywords.GET, "GET", `/api/compendium-authoring/keywords?search=${PREFIX}`);
      expect(kw.data.map((k: { id: string }) => k.id).sort()).toEqual([control.id, forced.id].sort());
    });
  });

  describe("§75 negative paths", () => {
    it("duplicate canonical key → 409, and no partial content", async () => {
      const k = key("duplicate");
      expect((await createDefinition(createBody(k))).status).toBe(201);
      const again = await createDefinition(createBody(k));
      expect([again.status, again.body.error?.code]).toEqual([409, "ENTITY.CANONICAL_KEY_CONFLICT"]);
      expect(await prisma.entity.count({ where: { canonicalKey: k } })).toBe(1);
    });

    it.each([
      ["unknown Definition kind", { definitionKind: "SPELL_FIREBALL" }, 400, "COMPENDIUM_AUTHORING.UNSUPPORTED_DEFINITION_KIND"],
      ["reserved Definition kind", { definitionKind: "WEAPON" }, 400, "COMPENDIUM_AUTHORING.UNSUPPORTED_DEFINITION_KIND"],
      ["incompatible EntityType", { entityType: "TARGETING" }, 400, "COMPENDIUM_AUTHORING.INCOMPATIBLE_ENTITY_TYPE"],
      ["unsupported schema version", { prowessDefinition: { ...forcePushStatic(), schemaVersion: 9 } }, 400, "COMPENDIUM_AUTHORING.DEFINITION_REFUSED"],
      ["cross-branch content", { prowessDefinition: { ...forcePushStatic(), systemFamily: "MANEUVER" } }, 400, "COMPENDIUM_AUTHORING.DEFINITION_REFUSED"],
      ["stored blob claiming identity", { prowessDefinition: { ...forcePushStatic(), entityVersionId: "00000000-0000-4000-8000-000000000001" } }, 400, "COMPENDIUM_AUTHORING.DEFINITION_REFUSED"],
      ["client-supplied revision number", { revisionNumber: 3 }, 400, "API.INVALID_BODY"],
      ["fake published state", { status: "CANON" }, 400, "API.INVALID_BODY"],
      ["unknown Keyword id", { versionKeywordIds: ["00000000-0000-4000-8000-000000000123"] }, 400, "COMPENDIUM_AUTHORING.REFERENCE_NOT_FOUND"],
    ])("refuses %s before writing anything", async (_name, extra, status, code) => {
      const k = key("refused");
      const r = await createDefinition({ ...createBody(k), ...extra });
      expect([r.status, r.body.error?.code], JSON.stringify(r.body)).toEqual([status, code]);
      expect(await prisma.entity.count({ where: { canonicalKey: k } })).toBe(0);
    });

    it("unsafe structured data (a __proto__ key) is refused as untrusted input — no authoring bypass", async () => {
      const k = key("proto");
      const raw = `{"definitionKind":"SPELL_EFFECT","canonicalKey":"${k}","displayName":"x","prowessDefinition":{"schemaVersion":1,"systemFamily":"SPELL","definitionKind":"SPELL_EFFECT","payload":{"effectFamily":"MOVEMENT","__proto__":{"polluted":true}}}}`;
      const r = await call(Definitions.POST, "POST", "/api/compendium-authoring/definitions", {}, raw);
      expect([r.status, r.body.error?.code]).toEqual([400, "COMPENDIUM_AUTHORING.DEFINITION_REFUSED"]);
      expect(await prisma.entity.count({ where: { canonicalKey: k } })).toBe(0);
    });

    it("M6-I010 generic content is shown as generic: no Definition is inferred or attached by authoring", async () => {
      const entity = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: key("spell_effect_lookalike") });
      const version = await createEntityVersion(entity.id, { displayName: "Fire Damage Effect" });
      const listed = await call(Definitions.GET, "GET", `/api/compendium-authoring/definitions?canonicalKey=${entity.canonicalKey}`);
      expect(listed.data[0]).toMatchObject({ definitionKind: null, structuralValidation: "NOT_A_DEFINITION" });
      const validation = await call(StoredValidation.GET, "GET", `/api/compendium-authoring/entity-versions/${version.id}/validation`, { versionId: version.id });
      expect([validation.status, validation.body.error?.code]).toEqual([409, "COMPENDIUM_AUTHORING.NOT_A_DEFINITION"]);
      const attach = await save(version.id, { expectedUpdatedAt: version.updatedAt.toISOString(), prowessDefinition: forcePushStatic() });
      expect([attach.status, attach.body.error?.code]).toEqual([409, "COMPENDIUM_AUTHORING.NOT_A_DEFINITION"]);
    });

    it("a base revision of another Entity is refused; unknown routes ids are 404s; preview of an unsaved candidate creates nothing", async () => {
      const a = await createDefinition(createBody(key("base_a")));
      const b = await createDefinition(createBody(key("base_b")));
      const r = await call(Revisions.POST, "POST", `/api/compendium-authoring/entities/${a.data.entity.id}/revisions`, { entityId: a.data.entity.id }, { baseVersionId: b.data.version.id });
      expect([r.status, r.body.error?.code]).toEqual([400, "COMPENDIUM_AUTHORING.INVALID_BASE_REVISION"]);
      const missing = await save("00000000-0000-4000-8000-000000000777", { expectedUpdatedAt: new Date().toISOString() });
      expect([missing.status, missing.body.error?.code]).toEqual([404, "ENTITY_VERSION.NOT_FOUND"]);
      const before = await prisma.entityVersion.count();
      await call(Validate.POST, "POST", "/api/compendium-authoring/validate", {}, { definitionKind: "SPELL_EFFECT", prowessDefinition: forcePushStatic() });
      expect(await prisma.entityVersion.count()).toBe(before);
    });

    it("a revision already in review is not editable through authoring until it returns to DRAFT", async () => {
      const created = await createDefinition(createBody(key("in_review")));
      await transitionEntityVersionStatus(created.data.version.id, "IN_REVIEW");
      const r = await save(created.data.version.id, { expectedUpdatedAt: created.data.version.updatedAt, displayName: "x" });
      expect([r.status, r.body.error?.code]).toEqual([409, "ENTITY_VERSION.IMMUTABLE"]);
    });
  });
});

/** forcePush() for it.each tables, which are built before beforeAll seeds the Keywords: no payload Keywords. */
function forcePushStatic() {
  return {
    schemaVersion: 1,
    systemFamily: "SPELL",
    definitionKind: "SPELL_EFFECT",
    payload: { effectFamily: "MOVEMENT", keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {}, resolution: { mode: "SAVING_THROW", data: {} }, outcomes: [] },
  };
}
