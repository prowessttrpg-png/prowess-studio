/**
 * RuleConflict & RuleConflictCandidate — database integration tests (PAS-10 M2-WO5 §43–§62).
 *
 * Runs only against prowess_studio_test (guarded). Every row is tracked and torn down in
 * foreign-key order: candidates -> conflicts -> authority records -> policies -> manifests
 * (parent pointers nulled first) -> rulesets -> source rows -> versions -> entities.
 */
import {
  DomainError,
  RULE_CONFLICT_ERROR_CODES,
  SOURCE_DOCUMENT_TYPES,
  type CreateRuleConflictCandidateInput,
  type CreateRuleConflictInput,
} from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCanonPolicy,
  createEntity,
  createEntityVersion,
  createRuleConflict,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  createSourceReference,
  getEntityVersion,
  getRuleConflict,
  getRuleset,
  getRulesetManifest,
  listRuleConflicts,
  listRuleConflictsForEntity,
  prisma,
  resolveEffectiveEntityVersion,
  resolveEntityVersionFromManifest,
  resolveSourceAuthority,
  transitionEntityVersionStatus,
} from "../../src/index";
import { insertRuleConflictWithCandidates } from "../../src/rule-conflict/repository";
import { mapRuleConflictWriteError } from "../../src/rule-conflict/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = "00000000-0000-4000-8000-000000000000";
const SOURCE_TITLE_PREFIX = "ConflictTest ";
const rulesetIds: string[] = [];
const entityIds: string[] = [];

async function ruleset(label: string, parentRulesetId?: string) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.rc_${label.toLowerCase()}_${tag}_${next()}`,
    name: `ConflictTest ${label}`,
    channel: "DEVELOPMENT",
    ...(parentRulesetId === undefined ? {} : { parentRulesetId }),
  });
  rulesetIds.push(r.id);
  return r;
}

async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.conflict.${label.toLowerCase()}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}

const version = (entityId: string, name: string) => createEntityVersion(entityId, { displayName: name });
const sourceType: string = SOURCE_DOCUMENT_TYPES[0];
const source = (label: string) => createSourceDocument({ title: `${SOURCE_TITLE_PREFIX}${label} ${tag}_${next()}`, sourceType });
const reference = async (entityVersionId: string, label: string) =>
  createSourceReference(entityVersionId, { sourceDocumentId: (await source(label)).id, sectionLabel: label });

const cand = (entityVersionId: string, extra: Partial<CreateRuleConflictCandidateInput> = {}): CreateRuleConflictCandidateInput => ({
  entityVersionId,
  ...extra,
});
const conflictInput = (entityId: string, candidates: CreateRuleConflictCandidateInput[], extra: Partial<CreateRuleConflictInput> = {}): CreateRuleConflictInput => ({
  entityId,
  conflictType: "MECHANICAL_DIVERGENCE",
  severity: "HIGH",
  title: "AP cost disagreement",
  candidates,
  ...extra,
});

/** Row counts for one Ruleset's conflict tables, and in total (to prove "nothing persisted"). */
const counts = async (rulesetId: string) => ({
  conflicts: await prisma.ruleConflict.count({ where: { rulesetId } }),
  candidates: await prisma.ruleConflictCandidate.count({ where: { ruleConflict: { rulesetId } } }),
});

/** Every Version row of an Entity, verbatim — used to prove a conflict changes no Version data or status. */
const versionRows = (entityId: string) => prisma.entityVersion.findMany({ where: { entityId }, orderBy: { revisionNumber: "asc" } });

async function expectCode(promise: Promise<unknown>, code: string, label?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, label).toBeInstanceOf(DomainError);
  expect((error as DomainError).code, label).toBe(code);
}

describe("RuleConflict (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.ruleConflictCandidate.deleteMany({ where: { ruleConflict: { rulesetId: { in: rulesetIds } } } });
    await prisma.ruleConflict.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
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

  describe("creation and history (§43, §44, §49, §51)", () => {
    it("creates an OPEN conflict with exactly two exact candidates (§43)", async () => {
      const r = await ruleset("basic");
      const a = await entity("basic");
      const [a1, a2] = [await version(a.id, "Evocation"), await version(a.id, "Emission")] as const;
      const before = Date.now();

      const c = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id, { label: "Older" }), cand(a2.id, { positionSummary: "renamed" })], { description: "d" }));

      expect(c.id).toMatch(UUID);
      expect(c).toMatchObject({
        rulesetId: r.id,
        entityId: a.id,
        conflictType: "MECHANICAL_DIVERGENCE",
        severity: "HIGH",
        status: "OPEN",
        title: "AP cost disagreement",
        description: "d",
      });
      expect(c.createdAt.getTime()).toBeGreaterThan(before - 60_000);
      expect(c.candidates.map((x) => [x.entityVersionId, x.sourceReferenceId, x.label, x.positionSummary, x.ruleConflictId])).toEqual([
        [a1.id, null, "Older", null, c.id],
        [a2.id, null, null, "renamed", c.id],
      ]);
      for (const x of c.candidates) expect(x.id).toMatch(UUID);
      expect(await getRuleConflict(c.id)).toEqual(c);
      expect(await counts(r.id)).toEqual({ conflicts: 1, candidates: 2 });
    });

    it("a smuggled status or winner is ignored: the conflict is OPEN and stores no winner (§7, §29)", async () => {
      const r = await ruleset("smuggle");
      const a = await entity("smuggle");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const c = await createRuleConflict(r.id, {
        ...conflictInput(a.id, [cand(a1.id), cand(a2.id)]),
        status: "RESOLVED",
        winningVersionId: a1.id,
      } as unknown as CreateRuleConflictInput);
      expect(c.status).toBe("OPEN");
      expect(Object.keys(c).sort()).toEqual(["candidates", "conflictType", "createdAt", "description", "entityId", "id", "rulesetId", "severity", "status", "title"]);
    });

    it("a later revision is NOT silently added: the conflict still names exactly A1 and A2 after A3 exists (§10, §44)", async () => {
      const r = await ruleset("history");
      const a = await entity("history");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const c = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)]));
      const snapshot = await getRuleConflict(c.id);

      const a3 = await version(a.id, "A3");
      for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a3.id, status);

      const after = await getRuleConflict(c.id);
      expect(after).toEqual(snapshot);
      expect(after.candidates.map((x) => x.entityVersionId)).toEqual([a1.id, a2.id]);
    });

    it("candidates are ordered by revision ascending regardless of input order (§28)", async () => {
      const r = await ruleset("order");
      const a = await entity("order");
      const [a1, a2, a3] = [await version(a.id, "A1"), await version(a.id, "A2"), await version(a.id, "A3")] as const;
      const c = await createRuleConflict(r.id, conflictInput(a.id, [cand(a3.id), cand(a1.id), cand(a2.id)]));
      expect(c.candidates.map((x) => x.entityVersionId)).toEqual([a1.id, a2.id, a3.id]);
    });

    it("accepts a SourceReference that belongs to the candidate's Version as evidence (§14, §49)", async () => {
      const r = await ruleset("srmatch");
      const a = await entity("srmatch");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const s1 = await reference(a1.id, "Spell AP Cost");
      const c = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id, { sourceReferenceId: s1.id }), cand(a2.id)]));
      expect(c.candidates.map((x) => x.sourceReferenceId)).toEqual([s1.id, null]);
    });

    it("succeeds with no SourceReference at all — provenance is optional (§15, §51)", async () => {
      const r = await ruleset("nosr");
      const a = await entity("nosr");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const c = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id, { sourceReferenceId: null })], { conflictType: "OTHER", severity: "LOW" }));
      expect(c.candidates.every((x) => x.sourceReferenceId === null)).toBe(true);
    });
  });

  describe("rejections persist nothing (§45–§48, §50, §52)", () => {
    it("rejects a candidate Version of another Entity with VERSION_ENTITY_MISMATCH (§11, §45)", async () => {
      const r = await ruleset("mismatch");
      const [a, b] = [await entity("mmA"), await entity("mmB")] as const;
      const [a1, b1] = [await version(a.id, "A1"), await version(b.id, "B1")] as const;
      await expectCode(createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(b1.id)])), RULE_CONFLICT_ERROR_CODES.VERSION_ENTITY_MISMATCH);
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
    });

    it("rejects A1 twice with DUPLICATE_CANDIDATE (§13, §46)", async () => {
      const r = await ruleset("dup");
      const a = await entity("dup");
      const a1 = await version(a.id, "A1");
      await expectCode(createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a1.id)])), RULE_CONFLICT_ERROR_CODES.DUPLICATE_CANDIDATE);
      await expectCode(
        createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(` ${a1.id.toUpperCase()} `)])),
        RULE_CONFLICT_ERROR_CODES.DUPLICATE_CANDIDATE,
        "case-insensitive",
      );
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
    });

    it("rejects zero or one candidate with INSUFFICIENT_CANDIDATES (§12, §47)", async () => {
      const r = await ruleset("insufficient");
      const a = await entity("insufficient");
      const a1 = await version(a.id, "A1");
      await expectCode(createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id)])), RULE_CONFLICT_ERROR_CODES.INSUFFICIENT_CANDIDATES);
      await expectCode(createRuleConflict(r.id, conflictInput(a.id, [])), RULE_CONFLICT_ERROR_CODES.INSUFFICIENT_CANDIDATES);
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
    });

    it("rejects a missing or malformed Version with VERSION_NOT_FOUND, persisting nothing (§48)", async () => {
      const r = await ruleset("missingv");
      const a = await entity("missingv");
      const a1 = await version(a.id, "A1");
      for (const bad of [MISSING, "not-a-uuid"]) {
        await expectCode(createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(bad)])), RULE_CONFLICT_ERROR_CODES.VERSION_NOT_FOUND, bad);
      }
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
    });

    it("rejects a SourceReference belonging to ANOTHER Version (A2's evidence on A1) with INVALID_SOURCE_REFERENCE (§14, §50)", async () => {
      const r = await ruleset("srmismatch");
      const a = await entity("srmismatch");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const s2 = await reference(a2.id, "belongs to A2");
      await expectCode(
        createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id, { sourceReferenceId: s2.id }), cand(a2.id)])),
        RULE_CONFLICT_ERROR_CODES.INVALID_SOURCE_REFERENCE,
      );
      for (const bad of [MISSING, "not-a-uuid"]) {
        await expectCode(
          createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id, { sourceReferenceId: bad }), cand(a2.id)])),
          RULE_CONFLICT_ERROR_CODES.INVALID_SOURCE_REFERENCE,
          bad,
        );
      }
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
    });

    it("a request whose FIFTH candidate is invalid after four valid ones persists nothing (§24, §52, service level)", async () => {
      const r = await ruleset("atomic5");
      const [a, b] = [await entity("atomicA"), await entity("atomicB")] as const;
      const valid = [];
      for (let i = 1; i <= 4; i++) valid.push(await version(a.id, `A${i}`));
      const b1 = await version(b.id, "B1");
      await expectCode(
        createRuleConflict(r.id, conflictInput(a.id, [...valid.map((v) => cand(v.id)), cand(b1.id)])),
        RULE_CONFLICT_ERROR_CODES.VERSION_ENTITY_MISMATCH,
      );
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
    });

    it("the WRITE itself is atomic: a database rejection after the conflict and earlier candidates were inserted rolls everything back (§24, §52)", async () => {
      // Bypasses the service on purpose, so the composite foreign key is what fails — AFTER the header and two rows.
      const r = await ruleset("atomicdb");
      const [a, b] = [await entity("adbA"), await entity("adbB")] as const;
      const [a1, a2, b1] = [await version(a.id, "A1"), await version(a.id, "A2"), await version(b.id, "B1")] as const;
      const header = { rulesetId: r.id, entityId: a.id, conflictType: "OTHER", severity: "LOW", title: "t", description: null } as const;
      const row = (entityVersionId: string) => ({ entityVersionId, sourceReferenceId: null, label: null, positionSummary: null });

      const error = await insertRuleConflictWithCandidates(header, [row(a1.id), row(a2.id), row(b1.id)]).catch((e: unknown) => e);
      expect(String(error)).toMatch(/rule_conflict_candidates_version_entity_fkey/);
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });

      // And the service's write-error mapper recognizes the REAL error shape.
      expect(mapRuleConflictWriteError(error)).toMatchObject({ code: RULE_CONFLICT_ERROR_CODES.VERSION_ENTITY_MISMATCH });
    });

    it("the database rejection of a duplicate or a foreign SourceReference maps to the controlled codes too", async () => {
      const r = await ruleset("mapper");
      const a = await entity("mapper");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const s2 = await reference(a2.id, "A2's");
      const header = { rulesetId: r.id, entityId: a.id, conflictType: "OTHER", severity: "LOW", title: "t", description: null } as const;
      const row = (entityVersionId: string, sourceReferenceId: string | null = null) => ({ entityVersionId, sourceReferenceId, label: null, positionSummary: null });

      const dup = await insertRuleConflictWithCandidates(header, [row(a1.id), row(a1.id)]).catch((e: unknown) => e);
      expect(mapRuleConflictWriteError(dup)).toMatchObject({ code: RULE_CONFLICT_ERROR_CODES.DUPLICATE_CANDIDATE });
      const foreign = await insertRuleConflictWithCandidates(header, [row(a1.id, s2.id), row(a2.id)]).catch((e: unknown) => e);
      expect(String(foreign)).toMatch(/rule_conflict_candidates_source_reference_fkey/);
      expect(mapRuleConflictWriteError(foreign)).toMatchObject({ code: RULE_CONFLICT_ERROR_CODES.INVALID_SOURCE_REFERENCE });
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
      const unrelated = new Error("something else");
      expect(mapRuleConflictWriteError(unrelated)).toBe(unrelated);
    });

    it("reports a missing Ruleset / Entity, and invalid shapes, with controlled codes", async () => {
      const r = await ruleset("refs");
      const a = await entity("refs");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const good = conflictInput(a.id, [cand(a1.id), cand(a2.id)]);
      for (const id of [MISSING, "not-a-uuid"]) {
        await expectCode(createRuleConflict(id, good), RULE_CONFLICT_ERROR_CODES.RULESET_NOT_FOUND, id);
        await expectCode(createRuleConflict(r.id, { ...good, entityId: id }), RULE_CONFLICT_ERROR_CODES.ENTITY_NOT_FOUND, id);
        await expectCode(listRuleConflicts(id), RULE_CONFLICT_ERROR_CODES.RULESET_NOT_FOUND, id);
        await expectCode(listRuleConflictsForEntity(id, a.id), RULE_CONFLICT_ERROR_CODES.RULESET_NOT_FOUND, id);
        await expectCode(listRuleConflictsForEntity(r.id, id), RULE_CONFLICT_ERROR_CODES.ENTITY_NOT_FOUND, id);
        await expectCode(listRuleConflicts(r.id, { entityId: id }), RULE_CONFLICT_ERROR_CODES.ENTITY_NOT_FOUND, id);
        await expectCode(getRuleConflict(id), RULE_CONFLICT_ERROR_CODES.NOT_FOUND, id);
      }
      for (const bad of [{ title: " " }, { conflictType: "BALANCE" }, { severity: "BLOCKER" }]) {
        await expectCode(createRuleConflict(r.id, { ...good, ...bad }), RULE_CONFLICT_ERROR_CODES.INVALID_INPUT, JSON.stringify(bad));
      }
      await expectCode(listRuleConflicts(r.id, { status: "open" }), RULE_CONFLICT_ERROR_CODES.INVALID_INPUT);
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
    });
  });

  describe("scope and listing (§2, §26, §27, §53, §62)", () => {
    it("the same Versions conflict independently in two Rulesets: no global conflict state (§2, §53)", async () => {
      const [ra, rb] = [await ruleset("sepA"), await ruleset("sepB")] as const;
      const a = await entity("sep");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const ca = await createRuleConflict(ra.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)]));
      const cb = await createRuleConflict(rb.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { severity: "LOW" }));
      expect(ca.id).not.toBe(cb.id);
      expect((await listRuleConflicts(ra.id)).map((c) => c.id)).toEqual([ca.id]);
      expect((await listRuleConflicts(rb.id)).map((c) => c.id)).toEqual([cb.id]);
      expect((await listRuleConflictsForEntity(ra.id, a.id)).map((c) => c.id)).toEqual([ca.id]);
      expect(await listRuleConflicts((await ruleset("sepEmpty")).id)).toEqual([]);
    });

    it("two OPEN conflicts may share the same candidate pair when they ask different questions (§62)", async () => {
      const r = await ruleset("twoq");
      const a = await entity("twoq");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const terms = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { conflictType: "TERMINOLOGY_DIVERGENCE" }));
      const mech = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { conflictType: "MECHANICAL_DIVERGENCE" }));
      const same = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { conflictType: "MECHANICAL_DIVERGENCE" }));
      expect(new Set([terms.id, mech.id, same.id]).size).toBe(3);
      expect(await counts(r.id)).toEqual({ conflicts: 3, candidates: 6 });
    });

    it("lists headers in creation order with simple equality filters; per-Entity listing stays inside the Ruleset (§26, §27)", async () => {
      const r = await ruleset("list");
      const [a, b] = [await entity("listA"), await entity("listB")] as const;
      const [a1, a2, b1, b2] = [await version(a.id, "A1"), await version(a.id, "A2"), await version(b.id, "B1"), await version(b.id, "B2")] as const;
      const c1 = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { severity: "CRITICAL", conflictType: "SOURCE_CONTRADICTION" }));
      const c2 = await createRuleConflict(r.id, conflictInput(b.id, [cand(b1.id), cand(b2.id)], { severity: "LOW", conflictType: "SOURCE_CONTRADICTION" }));
      const c3 = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { severity: "LOW", conflictType: "STRUCTURAL_DIVERGENCE" }));

      const all = await listRuleConflicts(r.id);
      expect(all.map((c) => c.id)).toEqual([c1.id, c2.id, c3.id]);
      expect(all.every((c) => !("candidates" in c))).toBe(true); // headers only
      expect((await listRuleConflicts(r.id, { entityId: a.id })).map((c) => c.id)).toEqual([c1.id, c3.id]);
      expect((await listRuleConflicts(r.id, { severity: "LOW" })).map((c) => c.id)).toEqual([c2.id, c3.id]);
      expect((await listRuleConflicts(r.id, { conflictType: "SOURCE_CONTRADICTION", severity: "LOW" })).map((c) => c.id)).toEqual([c2.id]);
      expect((await listRuleConflicts(r.id, { status: "OPEN" })).map((c) => c.id)).toEqual([c1.id, c2.id, c3.id]);
      expect(await listRuleConflicts(r.id, { status: "RESOLVED" })).toEqual([]);
      expect((await listRuleConflictsForEntity(r.id, b.id)).map((c) => c.id)).toEqual([c2.id]);
      expect(await listRuleConflictsForEntity((await ruleset("listOther")).id, a.id)).toEqual([]);
    });
  });

  describe("a conflict records; it never resolves (§17, §19–§22, §54–§57, §59–§61)", () => {
    it("manifest independence: the pin of A2 resolves A2 before and after, and no manifest row changes (§19, §54)", async () => {
      const r = await ruleset("manifest");
      const a = await entity("manifest");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const rows = async () => ({
        manifests: await prisma.rulesetManifest.findMany({ where: { rulesetId: r.id } }),
        entries: await prisma.rulesetManifestEntry.findMany({ where: { manifest: { rulesetId: r.id } } }),
      });
      const before = { resolved: await resolveEntityVersionFromManifest(m.id, a.id), manifest: await getRulesetManifest(m.id), rows: await rows() };
      expect(before.resolved?.id).toBe(a2.id);

      await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { severity: "CRITICAL" }));

      expect((await resolveEntityVersionFromManifest(m.id, a.id))?.id).toBe(a2.id);
      expect(await getRulesetManifest(m.id)).toEqual(before.manifest);
      expect(await rows()).toEqual(before.rows);
    });

    it("inheritance independence: the child's explicit override still resolves A2 / EXPLICIT (§20, §55)", async () => {
      const parent = await ruleset("ip");
      const child = await ruleset("ic", parent.id);
      const a = await entity("inherit");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const p1 = await createRulesetManifest(parent.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      const c1 = await createRulesetManifest(child.id, { parentManifestId: p1.id, entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const before = await resolveEffectiveEntityVersion(c1.id, a.id);

      await createRuleConflict(child.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)]));
      await createRuleConflict(parent.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)]));

      const after = await resolveEffectiveEntityVersion(c1.id, a.id);
      expect(after).toMatchObject({ entityVersionId: a2.id, source: "EXPLICIT", resolvedFromManifestId: c1.id });
      expect(after).toEqual(before);
    });

    it("lifecycle independence: A1 stays CANON and A2 stays DRAFT; no Version row changes (§21, §56)", async () => {
      const r = await ruleset("life");
      const a = await entity("life");
      const a1 = await version(a.id, "A1");
      for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a1.id, status);
      const a2 = await version(a.id, "A2");
      const before = await versionRows(a.id);

      await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { severity: "CRITICAL", conflictType: "AUTHORING_STANDARD_CONFLICT" }));

      expect([(await getEntityVersion(a1.id)).status, (await getEntityVersion(a2.id)).status]).toEqual(["CANON", "DRAFT"]);
      expect(await versionRows(a.id)).toEqual(before); // byte-for-byte, including updatedAt
    });

    it("source authority picks no winner: GOVERNING vs REFERENCE_ONLY leaves both candidates, OPEN, and no policy or manifest change (§17, §22, §57)", async () => {
      const r = await ruleset("authority");
      const a = await entity("authority");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const [s1, s2] = [await reference(a1.id, "supports A1"), await reference(a2.id, "supports A2")] as const;
      const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const policy = await createCanonPolicy(r.id, {
        name: "favours A1",
        authorities: [
          { sourceDocumentId: s1.sourceDocumentId, scopeKey: "global", authorityStatus: "GOVERNING" },
          { sourceDocumentId: s2.sourceDocumentId, scopeKey: "global", authorityStatus: "REFERENCE_ONLY" },
        ],
      });
      const policyRows = async () => ({
        policies: await prisma.canonPolicy.findMany({ where: { rulesetId: r.id } }),
        records: await prisma.sourceAuthorityRecord.findMany({ where: { canonPolicy: { rulesetId: r.id } }, orderBy: { id: "asc" } }),
      });
      const before = await policyRows();

      const c = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id, { sourceReferenceId: s1.id }), cand(a2.id, { sourceReferenceId: s2.id })]));

      expect(c.status).toBe("OPEN");
      expect(c.candidates.map((x) => x.entityVersionId)).toEqual([a1.id, a2.id]);
      for (const x of c.candidates) expect(Object.keys(x).sort()).toEqual(["createdAt", "entityVersionId", "id", "label", "positionSummary", "ruleConflictId", "sourceReferenceId"]);
      expect(await policyRows()).toEqual(before);
      expect((await resolveSourceAuthority(policy.id, s1.sourceDocumentId, "global")).authorityStatus).toBe("GOVERNING");
      expect((await resolveEntityVersionFromManifest(m.id, a.id))?.id).toBe(a2.id); // not switched to the GOVERNING-backed A1
    });

    it("type and severity carry no behavior: a CRITICAL conflict of every type changes no Ruleset, manifest, or Version (§59, §60)", async () => {
      const r = await ruleset("nobehavior");
      const a = await entity("nobehavior");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      const snapshot = async () => ({
        ruleset: await getRuleset(r.id),
        manifests: await prisma.rulesetManifest.count({ where: { rulesetId: r.id } }),
        entries: await prisma.rulesetManifestEntry.findMany({ where: { manifest: { rulesetId: r.id } } }),
        versions: await versionRows(a.id),
      });
      const before = await snapshot();
      for (const conflictType of ["SOURCE_CONTRADICTION", "MECHANICAL_DIVERGENCE", "TERMINOLOGY_DIVERGENCE", "STRUCTURAL_DIVERGENCE", "AUTHORING_STANDARD_CONFLICT", "OTHER"]) {
        await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)], { conflictType, severity: "CRITICAL" }));
      }
      expect(await snapshot()).toEqual(before);
      expect(before.ruleset.status).toBe("DRAFT");
    });

    it("there is no automatic detection: diverging Versions, sources and a policy create zero conflicts (§61)", async () => {
      const r = await ruleset("nodetect");
      const a = await entity("nodetect");
      const [a1, a2] = [await version(a.id, "Evocation"), await version(a.id, "Emission")] as const;
      const s = await reference(a1.id, "Spellcasting.pdf");
      await reference(a2.id, "Errata.pdf");
      await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      await createCanonPolicy(r.id, { name: "P", authorities: [{ sourceDocumentId: s.sourceDocumentId, scopeKey: "global", authorityStatus: "GOVERNING" }] });
      expect(await counts(r.id)).toEqual({ conflicts: 0, candidates: 0 });
      expect(await prisma.ruleConflict.count({ where: { entityId: a.id } })).toBe(0);
    });

    it("exposes exactly four conflict operations, none of which transitions, edits, resolves, or deletes (§29–§31)", async () => {
      const surface = await import("../../src/index");
      const names = Object.keys(surface);
      expect(names.filter((n) => /conflict/i.test(n)).sort()).toEqual(["createRuleConflict", "getRuleConflict", "listRuleConflicts", "listRuleConflictsForEntity"]);
      const mutatorVerb = /^(set|change|update|resolve|dismiss|accept|choose|select|close|reopen|add|remove|delete|patch|upsert|edit)/i;
      const mutators = (list: string[]) => list.filter((n) => /conflict|candidate|divergence|winner/i.test(n) && mutatorVerb.test(n));
      expect(mutators(["resolveConflict", "dismissConflict", "acceptDivergence", "setConflictStatus", "chooseWinner", "addConflictCandidate"])).toHaveLength(6);
      expect(mutators(names)).toEqual([]);
    });
  });

  describe("the database enforces what it can (§11, §13, §14, §36–§41)", () => {
    const setup = async (label: string) => {
      const r = await ruleset(label);
      const [a, b] = [await entity(`${label}A`), await entity(`${label}B`)] as const;
      const [a1, a2, b1] = [await version(a.id, "A1"), await version(a.id, "A2"), await version(b.id, "B1")] as const;
      const c = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id), cand(a2.id)]));
      return { r, a, b, a1, a2, b1, c };
    };

    it("even inserted directly, a candidate cannot carry another Entity's Version, nor claim another Entity than its conflict's (§11, §39)", async () => {
      const { a, b, b1, c } = await setup("directfk");
      // The redundant entity_id says B (true for B1) — the conflict-side composite key rejects it: the conflict concerns A.
      await expect(
        prisma.ruleConflictCandidate.create({ data: { ruleConflictId: c.id, entityId: b.id, entityVersionId: b1.id } }),
      ).rejects.toThrow(/rule_conflict_candidates_conflict_entity_fkey/);
      // The redundant entity_id says A (true for the conflict) — the version-side composite key rejects B1.
      await expect(
        prisma.ruleConflictCandidate.create({ data: { ruleConflictId: c.id, entityId: a.id, entityVersionId: b1.id } }),
      ).rejects.toThrow(/rule_conflict_candidates_version_entity_fkey/);
      expect((await getRuleConflict(c.id)).candidates).toHaveLength(2);
    });

    it("even inserted directly, a duplicate Version or another Version's SourceReference is rejected (§13, §14, §39)", async () => {
      const { a, a1, a2, c } = await setup("directuniq");
      await expect(prisma.ruleConflictCandidate.create({ data: { ruleConflictId: c.id, entityId: a.id, entityVersionId: a1.id } })).rejects.toThrow(
        /rule_conflict_candidates_conflict_version_key/,
      );
      const s2 = await reference(a2.id, "A2's");
      const a3 = await version(a.id, "A3");
      await expect(
        prisma.ruleConflictCandidate.create({ data: { ruleConflictId: c.id, entityId: a.id, entityVersionId: a3.id, sourceReferenceId: s2.id } }),
      ).rejects.toThrow(/rule_conflict_candidates_source_reference_fkey/);
    });

    it("protects governance history: Ruleset, Entity, Version, SourceReference and conflict cannot be deleted while referenced (RESTRICT, §31, §37)", async () => {
      const r = await ruleset("restrict");
      const a = await entity("restrict");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const s1 = await reference(a1.id, "evidence");
      const c = await createRuleConflict(r.id, conflictInput(a.id, [cand(a1.id, { sourceReferenceId: s1.id }), cand(a2.id)]));

      await expect(prisma.sourceReference.delete({ where: { id: s1.id } })).rejects.toThrow(/rule_conflict_candidates_source_reference_fkey/);
      await expect(prisma.entityVersion.delete({ where: { id: a2.id } })).rejects.toThrow(/rule_conflict_candidates_version_entity_fkey/);
      await expect(prisma.ruleConflict.delete({ where: { id: c.id } })).rejects.toThrow(/rule_conflict_candidates_conflict_entity_fkey/);
      await expect(prisma.ruleset.delete({ where: { id: r.id } })).rejects.toThrow(/rule_conflicts_ruleset_id_fkey/);
      // The Entity is protected by its Versions already; the conflict's own key is RESTRICT as well (checked below).
      await expect(prisma.entity.delete({ where: { id: a.id } })).rejects.toThrow();
      expect(await getRuleConflict(c.id)).toEqual(c);
    });

    it("every foreign key is RESTRICT, and the composite keys have exactly the designed columns (§37, §39)", async () => {
      const rules = await prisma.$queryRaw<Array<{ constraint_name: string; delete_rule: string }>>`
        SELECT constraint_name, delete_rule FROM information_schema.referential_constraints
        WHERE constraint_name IN ('rule_conflicts_ruleset_id_fkey', 'rule_conflicts_entity_id_fkey',
          'rule_conflict_candidates_conflict_entity_fkey', 'rule_conflict_candidates_version_entity_fkey',
          'rule_conflict_candidates_source_reference_fkey')
        ORDER BY constraint_name`;
      expect(rules).toHaveLength(5);
      expect(rules.every((rule) => rule.delete_rule === "RESTRICT")).toBe(true);

      const columns = await prisma.$queryRaw<Array<{ constraint_name: string; cols: string }>>`
        SELECT tc.constraint_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
        WHERE tc.table_name = 'rule_conflict_candidates' AND tc.constraint_type = 'FOREIGN KEY'
        GROUP BY tc.constraint_name ORDER BY tc.constraint_name`;
      expect(columns).toEqual([
        { constraint_name: "rule_conflict_candidates_conflict_entity_fkey", cols: "rule_conflict_id,entity_id" },
        { constraint_name: "rule_conflict_candidates_source_reference_fkey", cols: "source_reference_id,entity_version_id" },
        { constraint_name: "rule_conflict_candidates_version_entity_fkey", cols: "entity_version_id,entity_id" },
      ]);
    });

    it("the tables have exactly the specified columns; no winner / resolution / policy / authority column exists (§4, §9, §18, §63, §64)", async () => {
      const cols = async (table: string) =>
        (await prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY column_name`).map(
          (c) => c.column_name,
        );
      expect(await cols("rule_conflicts")).toEqual(["conflict_type", "created_at", "description", "entity_id", "id", "ruleset_id", "severity", "status", "title"]);
      expect(await cols("rule_conflict_candidates")).toEqual([
        "created_at",
        "entity_id",
        "entity_version_id",
        "id",
        "label",
        "position_summary",
        "rule_conflict_id",
        "source_reference_id",
      ]);
      const forbidden = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~* '(winner|winning|selected|resolved|preferred|active_candidate|current_candidate|canon_decision|resolution|canon_policy|authority)'
          AND table_name LIKE 'rule_conflict%'`;
      expect(forbidden).toEqual([]);
      const touched = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name NOT LIKE 'rule_conflict%' AND column_name ~* 'conflict'`;
      expect(touched).toEqual([]); // no other table points at a conflict
    });

    it("the status column defaults to OPEN and the enums hold exactly the domain vocabularies (§7, §58, §66)", async () => {
      const enumValues = async (name: string) =>
        (await prisma.$queryRaw<Array<{ v: string }>>`
          SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = ${name} ORDER BY e.enumsortorder`).map((x) => x.v);
      expect(await enumValues("RuleConflictStatus")).toEqual(["OPEN", "UNDER_REVIEW", "RESOLVED", "ACCEPTED_DIVERGENCE", "DISMISSED"]);
      expect(await enumValues("RuleConflictSeverity")).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
      expect(await enumValues("RuleConflictType")).toHaveLength(6);
      const [def] = await prisma.$queryRaw<Array<{ column_default: string }>>`
        SELECT column_default FROM information_schema.columns WHERE table_name = 'rule_conflicts' AND column_name = 'status'`;
      expect(def?.column_default).toMatch(/^'OPEN'/);
      // No conflict anywhere in this run reached a non-OPEN state: nothing can transition one yet.
      expect(await prisma.ruleConflict.count({ where: { rulesetId: { in: rulesetIds }, NOT: { status: "OPEN" } } })).toBe(0);
    });

    it("the M2-WO5 migration is applied and finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261006010000_add_rule_conflicts'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });
  });
});
