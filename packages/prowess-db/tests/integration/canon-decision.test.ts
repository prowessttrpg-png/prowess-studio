/**
 * CanonDecision & CanonDecisionSelection — database integration tests (PAS-10 M2-WO6 §39–§52, §66–§78).
 *
 * Runs only against prowess_studio_test (guarded). Torn down in foreign-key order: selections ->
 * decisions -> conflict candidates -> conflicts -> authority records -> policies -> manifests (parent
 * pointers nulled first) -> rulesets -> source rows -> versions -> entities.
 */
import { CANON_DECISION_ERROR_CODES, DomainError, SOURCE_DOCUMENT_TYPES, type CreateCanonDecisionInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCanonDecision,
  createCanonPolicy,
  createEntity,
  createEntityVersion,
  createRuleConflict,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  createSourceReference,
  getCanonDecision,
  getCanonPolicy,
  getRuleConflict,
  listCanonDecisions,
  listCanonDecisionsForConflict,
  prisma,
  resolveEffectiveEntityVersion,
  resolveEntityVersionFromManifest,
  transitionEntityVersionStatus,
} from "../../src/index";
import { insertCanonDecisionWithTransition } from "../../src/canon-decision/repository";
import { mapCanonDecisionWriteError } from "../../src/canon-decision/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { getTestDatabaseUrl } from "./env";

const tag = `${Date.now()}`;
let counter = 0;
const next = () => ++counter;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = "00000000-0000-4000-8000-000000000000";
const SOURCE_TITLE_PREFIX = "DecisionTest ";
const rulesetIds: string[] = [];
const entityIds: string[] = [];

async function ruleset(label: string, parentRulesetId?: string) {
  const r = await createRuleset({
    canonicalKey: `test.ruleset.cd_${label.toLowerCase()}_${tag}_${next()}`,
    name: `DecisionTest ${label}`,
    channel: "DEVELOPMENT",
    ...(parentRulesetId === undefined ? {} : { parentRulesetId }),
  });
  rulesetIds.push(r.id);
  return r;
}
async function entity(label: string) {
  const e = await createEntity({ entityType: "GENERIC_RULE", canonicalKey: `test.decision.${label.toLowerCase()}_${tag}_${next()}` });
  entityIds.push(e.id);
  return e;
}
const version = (entityId: string, name: string) => createEntityVersion(entityId, { displayName: name });
const sourceType: string = SOURCE_DOCUMENT_TYPES[0];
const reference = async (entityVersionId: string, label: string) =>
  createSourceReference(entityVersionId, {
    sourceDocumentId: (await createSourceDocument({ title: `${SOURCE_TITLE_PREFIX}${label} ${tag}_${next()}`, sourceType })).id,
  });
const policy = (rulesetId: string, name = "P", authorities: Array<{ sourceDocumentId: string; authorityStatus: string }> = []) =>
  createCanonPolicy(rulesetId, { name, authorities: authorities.map((a) => ({ ...a, scopeKey: "global" })) });

/** Ruleset R, Entity A with A1 + A2, an OPEN conflict A1 vs A2, and policy P1. */
async function scenario(label: string, rulesetId?: string) {
  const r = rulesetId === undefined ? await ruleset(label) : { id: rulesetId };
  const a = await entity(label);
  const [a1, a2] = [await version(a.id, `${label} A1`), await version(a.id, `${label} A2`)] as const;
  const conflict = await createRuleConflict(r.id, {
    entityId: a.id,
    conflictType: "MECHANICAL_DIVERGENCE",
    severity: "HIGH",
    title: `${label}: AP cost`,
    candidates: [{ entityVersionId: a1.id }, { entityVersionId: a2.id }],
  });
  const [cA1, cA2] = conflict.candidates as [(typeof conflict.candidates)[0], (typeof conflict.candidates)[0]];
  const p1 = await policy(r.id, "P1");
  return { r, a, a1, a2, conflict, cA1, cA2, p1 };
}

const selectRule = (canonPolicyId: string, candidateId: string, rationale = "Errata governs."): CreateCanonDecisionInput => ({
  canonPolicyId,
  decisionType: "SELECT_RULE",
  conflictDisposition: "RESOLVED",
  selectedCandidateIds: [candidateId],
  rationale,
});

async function expectCode(promise: Promise<unknown>, code: string, label?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, label).toBeInstanceOf(DomainError);
  expect((error as DomainError).code, label).toBe(code);
}

const decisionCounts = async (ruleConflictId: string) => ({
  decisions: await prisma.canonDecision.count({ where: { ruleConflictId } }),
  selections: await prisma.canonDecisionSelection.count({ where: { ruleConflictId } }),
});
const conflictStatus = async (id: string) => (await prisma.ruleConflict.findUniqueOrThrow({ where: { id } })).status;

/**
 * Everything a decision must NOT change, verbatim (§78): the Ruleset, its manifests and entries, its
 * policies and authority records, the Entity's Versions, the conflict's candidates, and source references.
 * (The conflict ROW is excluded: its status is the one permitted change, asserted separately.)
 */
async function worldSnapshot(rulesetId: string, entityId: string, ruleConflictId: string) {
  const versions = await prisma.entityVersion.findMany({ where: { entityId }, orderBy: { revisionNumber: "asc" } });
  return {
    ruleset: await prisma.ruleset.findUniqueOrThrow({ where: { id: rulesetId } }),
    manifests: await prisma.rulesetManifest.findMany({ where: { rulesetId }, orderBy: { manifestVersion: "asc" } }),
    entries: await prisma.rulesetManifestEntry.findMany({ where: { manifest: { rulesetId } }, orderBy: { id: "asc" } }),
    policies: await prisma.canonPolicy.findMany({ where: { rulesetId }, orderBy: { policyVersion: "asc" } }),
    records: await prisma.sourceAuthorityRecord.findMany({ where: { canonPolicy: { rulesetId } }, orderBy: { id: "asc" } }),
    versions,
    candidates: await prisma.ruleConflictCandidate.findMany({ where: { ruleConflictId }, orderBy: { id: "asc" } }),
    references: await prisma.sourceReference.findMany({ where: { entityVersionId: { in: versions.map((v) => v.id) } }, orderBy: { id: "asc" } }),
    conflictWithoutStatus: await prisma.ruleConflict
      .findUniqueOrThrow({ where: { id: ruleConflictId } })
      .then((row) => ({ ...row, status: "(excluded: the one permitted change)" })),
  };
}

describe("CanonDecision (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma.canonDecisionSelection.deleteMany({ where: { canonDecision: { rulesetId: { in: rulesetIds } } } });
    await prisma.canonDecision.deleteMany({ where: { rulesetId: { in: rulesetIds } } });
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

  describe("the four outcomes and their status mapping (§41, §47–§49, §68–§71)", () => {
    it("SELECT_RULE stores the exact context, resolves the conflict, and preserves the candidates (§68)", async () => {
      const { r, a, conflict, cA1, p1 } = await scenario("select");
      const before = await worldSnapshot(r.id, a.id, conflict.id);
      const at = Date.now();

      const d = await createCanonDecision(conflict.id, selectRule(p1.id, cA1.id, "  The 2026 errata governs AP cost.  "));

      expect(d.id).toMatch(UUID);
      expect(d).toMatchObject({
        rulesetId: r.id,
        ruleConflictId: conflict.id,
        canonPolicyId: p1.id,
        decisionType: "SELECT_RULE",
        conflictDisposition: "RESOLVED",
        resultEntityVersionId: null,
        rationale: "The 2026 errata governs AP cost.",
      });
      expect(d.createdAt.getTime()).toBeGreaterThan(at - 60_000);
      expect(d.selections.map((s) => [s.canonDecisionId, s.ruleConflictCandidateId])).toEqual([[d.id, cA1.id]]);
      expect(Object.keys(d).sort()).toEqual(
        ["canonPolicyId", "conflictDisposition", "createdAt", "decisionType", "id", "rationale", "resultEntityVersionId", "ruleConflictId", "rulesetId", "selections"].sort(),
      );
      expect(await getCanonDecision(d.id)).toEqual(d);
      expect(await conflictStatus(conflict.id)).toBe("RESOLVED");
      expect(await worldSnapshot(r.id, a.id, conflict.id)).toEqual(before); // §40, §78: status is the ONLY change
      expect((await getRuleConflict(conflict.id)).candidates).toEqual(conflict.candidates);
    });

    it("KEEP_SEPARATE keeps both candidates and produces ACCEPTED_DIVERGENCE; neither is a winner (§48, §69)", async () => {
      const { r, a, conflict, cA1, cA2, p1 } = await scenario("keep");
      const before = await worldSnapshot(r.id, a.id, conflict.id);
      const d = await createCanonDecision(conflict.id, {
        canonPolicyId: p1.id,
        decisionType: "KEEP_SEPARATE",
        conflictDisposition: "ACCEPTED_DIVERGENCE",
        selectedCandidateIds: [cA2.id, cA1.id],
        rationale: "Core keeps the simple chain; Experimental keeps branching.",
      });
      expect(d.selections.map((s) => s.ruleConflictCandidateId)).toEqual([cA1.id, cA2.id]); // revision order, not input order
      expect(await conflictStatus(conflict.id)).toBe("ACCEPTED_DIVERGENCE");
      expect(await worldSnapshot(r.id, a.id, conflict.id)).toEqual(before);
    });

    it("MERGE records the merged candidates and an existing same-Entity result; nothing is merged or created (§18, §47, §70)", async () => {
      const { r, a, conflict, cA1, cA2, p1 } = await scenario("merge");
      const a3 = await version(a.id, "merge A3 (reconciled)");
      const before = await worldSnapshot(r.id, a.id, conflict.id);
      const versionCount = await prisma.entityVersion.count({ where: { entityId: a.id } });

      const d = await createCanonDecision(conflict.id, {
        canonPolicyId: p1.id,
        decisionType: "MERGE",
        conflictDisposition: "RESOLVED",
        selectedCandidateIds: [cA1.id, cA2.id],
        resultEntityVersionId: a3.id,
        rationale: "A3 reconciles both.",
      });
      expect(d.resultEntityVersionId).toBe(a3.id);
      expect(d.selections).toHaveLength(2);
      expect(await conflictStatus(conflict.id)).toBe("RESOLVED");
      expect(await prisma.entityVersion.count({ where: { entityId: a.id } })).toBe(versionCount); // no Version was created
      expect(await worldSnapshot(r.id, a.id, conflict.id)).toEqual(before); // A1/A2/A3 byte-identical
    });

    it("RESOLVE_CONFLICT + DISMISSED with zero selections closes the conflict; it stays retrievable with its candidates (§21, §49, §71)", async () => {
      const { r, a, conflict, p1 } = await scenario("dismiss");
      const before = await worldSnapshot(r.id, a.id, conflict.id);
      const d = await createCanonDecision(conflict.id, {
        canonPolicyId: p1.id,
        decisionType: "RESOLVE_CONFLICT",
        conflictDisposition: "DISMISSED",
        selectedCandidateIds: [],
        rationale: "Duplicate of an earlier review issue.",
      });
      expect(d.selections).toEqual([]);
      const after = await getRuleConflict(conflict.id);
      expect(after.status).toBe("DISMISSED");
      expect(after.candidates).toEqual(conflict.candidates);
      expect(await worldSnapshot(r.id, a.id, conflict.id)).toEqual(before);
    });

    it("RESOLVE_CONFLICT + RESOLVED may cite candidates; an UNDER_REVIEW conflict is also decidable (§9, §20)", async () => {
      const { conflict, cA2, p1 } = await scenario("generic");
      await prisma.ruleConflict.update({ where: { id: conflict.id }, data: { status: "UNDER_REVIEW" } }); // no WO6 API sets it
      const d = await createCanonDecision(conflict.id, {
        canonPolicyId: p1.id,
        decisionType: "RESOLVE_CONFLICT",
        conflictDisposition: "RESOLVED",
        selectedCandidateIds: [cA2.id],
        rationale: "Resolved editorially by clarifying wording.",
      });
      expect(d.selections.map((s) => s.ruleConflictCandidateId)).toEqual([cA2.id]);
      expect(await conflictStatus(conflict.id)).toBe("RESOLVED");
    });
  });

  describe("rejections change nothing (§42–§46)", () => {
    it("a decided conflict cannot receive another decision: CONFLICT_ALREADY_DECIDED, no second decision (§9, §43)", async () => {
      const { conflict, cA1, cA2, p1 } = await scenario("twice");
      await createCanonDecision(conflict.id, selectRule(p1.id, cA1.id));
      await expectCode(createCanonDecision(conflict.id, selectRule(p1.id, cA2.id)), CANON_DECISION_ERROR_CODES.CONFLICT_ALREADY_DECIDED);
      await expectCode(
        createCanonDecision(conflict.id, { canonPolicyId: p1.id, decisionType: "RESOLVE_CONFLICT", conflictDisposition: "DISMISSED", selectedCandidateIds: [], rationale: "x" }),
        CANON_DECISION_ERROR_CODES.CONFLICT_ALREADY_DECIDED,
      );
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 1, selections: 1 });
      expect(await conflictStatus(conflict.id)).toBe("RESOLVED");
      for (const status of ["ACCEPTED_DIVERGENCE", "DISMISSED"] as const) {
        const s = await scenario(`terminal${status}`);
        await prisma.ruleConflict.update({ where: { id: s.conflict.id }, data: { status } });
        await expectCode(createCanonDecision(s.conflict.id, selectRule(s.p1.id, s.cA1.id)), CANON_DECISION_ERROR_CODES.CONFLICT_ALREADY_DECIDED, status);
        expect(await decisionCounts(s.conflict.id)).toEqual({ decisions: 0, selections: 0 });
      }
    });

    it("a policy from another Ruleset is INVALID_POLICY_CONTEXT; a missing one is POLICY_NOT_FOUND (§3, §44)", async () => {
      const { conflict, cA1 } = await scenario("wrongpolicy");
      const otherPolicy = await policy((await ruleset("otherpolicy")).id, "B's policy");
      await expectCode(createCanonDecision(conflict.id, selectRule(otherPolicy.id, cA1.id)), CANON_DECISION_ERROR_CODES.INVALID_POLICY_CONTEXT);
      for (const bad of [MISSING, "not-a-uuid"]) {
        await expectCode(createCanonDecision(conflict.id, selectRule(bad, cA1.id)), CANON_DECISION_ERROR_CODES.POLICY_NOT_FOUND, bad);
      }
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 0, selections: 0 });
      expect(await conflictStatus(conflict.id)).toBe("OPEN");
    });

    it("a candidate from another conflict, or a missing one, is INVALID_CANDIDATE (§14, §45)", async () => {
      const { conflict, cA1, p1 } = await scenario("wrongcand");
      const other = await scenario("othercand");
      await expectCode(createCanonDecision(conflict.id, selectRule(p1.id, other.cA1.id)), CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE);
      await expectCode(
        createCanonDecision(conflict.id, {
          canonPolicyId: p1.id,
          decisionType: "KEEP_SEPARATE",
          conflictDisposition: "ACCEPTED_DIVERGENCE",
          selectedCandidateIds: [cA1.id, other.cA2.id],
          rationale: "x",
        }),
        CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE,
      );
      for (const bad of [MISSING, "not-a-uuid"]) {
        await expectCode(createCanonDecision(conflict.id, selectRule(p1.id, bad)), CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE, bad);
      }
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 0, selections: 0 });
      expect(await conflictStatus(conflict.id)).toBe("OPEN");
      expect(await conflictStatus(other.conflict.id)).toBe("OPEN");
    });

    it("a MERGE result of another Entity, or a missing one, is INVALID_RESULT_VERSION (§26, §46)", async () => {
      const { conflict, cA1, cA2, p1 } = await scenario("mergewrong");
      const b1 = await version((await entity("mergeB")).id, "B1");
      const merge = (resultEntityVersionId: string): CreateCanonDecisionInput => ({
        canonPolicyId: p1.id,
        decisionType: "MERGE",
        conflictDisposition: "RESOLVED",
        selectedCandidateIds: [cA1.id, cA2.id],
        resultEntityVersionId,
        rationale: "x",
      });
      await expectCode(createCanonDecision(conflict.id, merge(b1.id)), CANON_DECISION_ERROR_CODES.INVALID_RESULT_VERSION);
      for (const bad of [MISSING, "not-a-uuid"]) {
        await expectCode(createCanonDecision(conflict.id, merge(bad)), CANON_DECISION_ERROR_CODES.INVALID_RESULT_VERSION, bad);
      }
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 0, selections: 0 });
      expect(await conflictStatus(conflict.id)).toBe("OPEN");
    });

    it("invalid type/disposition/count combinations are INVALID_INPUT; a missing conflict is CONFLICT_NOT_FOUND (§42)", async () => {
      const { conflict, cA1, cA2, p1 } = await scenario("matrix");
      const bad: Array<Partial<CreateCanonDecisionInput>> = [
        { conflictDisposition: "ACCEPTED_DIVERGENCE" },
        { selectedCandidateIds: [] },
        { selectedCandidateIds: [cA1.id, cA2.id] },
        { decisionType: "KEEP_SEPARATE", conflictDisposition: "RESOLVED", selectedCandidateIds: [cA1.id, cA2.id] },
        { decisionType: "KEEP_SEPARATE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [cA1.id] },
        { decisionType: "MERGE", selectedCandidateIds: [cA1.id, cA2.id] },
        { decisionType: "MERGE", selectedCandidateIds: [cA1.id], resultEntityVersionId: cA1.entityVersionId },
        { decisionType: "MERGE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [cA1.id, cA2.id], resultEntityVersionId: cA1.entityVersionId },
        { decisionType: "RESOLVE_CONFLICT", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [] },
        { decisionType: "KEEP_SEPARATE", conflictDisposition: "ACCEPTED_DIVERGENCE", selectedCandidateIds: [cA1.id, cA1.id] },
        { rationale: "  " },
      ];
      for (const over of bad) {
        await expectCode(createCanonDecision(conflict.id, { ...selectRule(p1.id, cA1.id), ...over }), CANON_DECISION_ERROR_CODES.INVALID_INPUT, JSON.stringify(over));
      }
      for (const id of [MISSING, "not-a-uuid"]) {
        await expectCode(createCanonDecision(id, selectRule(p1.id, cA1.id)), CANON_DECISION_ERROR_CODES.CONFLICT_NOT_FOUND, id);
        await expectCode(listCanonDecisionsForConflict(id), CANON_DECISION_ERROR_CODES.CONFLICT_NOT_FOUND, id);
        await expectCode(getCanonDecision(id), CANON_DECISION_ERROR_CODES.NOT_FOUND, id);
        await expectCode(listCanonDecisions(id), CANON_DECISION_ERROR_CODES.RULESET_NOT_FOUND, id);
      }
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 0, selections: 0 });
      expect(await conflictStatus(conflict.id)).toBe("OPEN");
    });
  });

  describe("atomicity and concurrency (§10, §50–§52)", () => {
    it("a database rejection AFTER the transition, the decision and one selection rolls everything back (§50)", async () => {
      const { r, conflict, cA1, p1 } = await scenario("rollback");
      const other = await scenario("rollbackother");
      // Bypasses the service: the second selection's composite key is what fails, late in the transaction.
      const error = await insertCanonDecisionWithTransition(
        {
          rulesetId: r.id,
          entityId: conflict.entityId,
          ruleConflictId: conflict.id,
          canonPolicyId: p1.id,
          decisionType: "KEEP_SEPARATE",
          conflictDisposition: "ACCEPTED_DIVERGENCE",
          resultEntityVersionId: null,
          rationale: "x",
        },
        [cA1.id, other.cA1.id],
      ).catch((e: unknown) => e);
      expect(String(error)).toMatch(/canon_decision_selections_candidate_fkey/);
      expect(mapCanonDecisionWriteError(error)).toMatchObject({ code: CANON_DECISION_ERROR_CODES.INVALID_CANDIDATE });
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 0, selections: 0 });
      expect(await conflictStatus(conflict.id)).toBe("OPEN"); // the transition was rolled back too
    });

    it("a decision whose policy belongs to another Ruleset fails in the database too, after the transition, and rolls back", async () => {
      const { r, conflict, cA1 } = await scenario("rollbackpolicy");
      const otherPolicy = await policy((await ruleset("rbother")).id);
      const error = await insertCanonDecisionWithTransition(
        { rulesetId: r.id, entityId: conflict.entityId, ruleConflictId: conflict.id, canonPolicyId: otherPolicy.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", resultEntityVersionId: null, rationale: "x" },
        [cA1.id],
      ).catch((e: unknown) => e);
      expect(String(error)).toMatch(/canon_decisions_policy_fkey/);
      expect(mapCanonDecisionWriteError(error)).toMatchObject({ code: CANON_DECISION_ERROR_CODES.INVALID_POLICY_CONTEXT });
      expect(await conflictStatus(conflict.id)).toBe("OPEN");
    });

    it("concurrent decisions for one OPEN conflict: exactly one succeeds, the rest get CONFLICT_ALREADY_DECIDED (§51, §52)", async () => {
      const { conflict, cA1, cA2, p1 } = await scenario("race");
      const attempts = Array.from({ length: 6 }, (_, i) => createCanonDecision(conflict.id, selectRule(p1.id, i % 2 === 0 ? cA1.id : cA2.id, `attempt ${i}`)));
      const results = await Promise.allSettled(attempts);
      const won = results.filter((x) => x.status === "fulfilled");
      const lost = results.filter((x): x is PromiseRejectedResult => x.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(5);
      for (const failure of lost) {
        expect(failure.reason).toBeInstanceOf(DomainError);
        expect([CANON_DECISION_ERROR_CODES.CONFLICT_ALREADY_DECIDED, CANON_DECISION_ERROR_CODES.DECISION_CONFLICT]).toContain((failure.reason as DomainError).code);
      }
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 1, selections: 1 });
      expect(await conflictStatus(conflict.id)).toBe("RESOLVED");
    });

    it("the race is decided by the database, not a pre-read: a transition from a stale OPEN view still loses", async () => {
      const { r, conflict, cA1, cA2, p1 } = await scenario("stale");
      const insert = (candidate: string) =>
        insertCanonDecisionWithTransition(
          { rulesetId: r.id, entityId: conflict.entityId, ruleConflictId: conflict.id, canonPolicyId: p1.id, decisionType: "SELECT_RULE", conflictDisposition: "RESOLVED", resultEntityVersionId: null, rationale: "x" },
          [candidate],
        );
      await insert(cA1.id);
      // Calling the write path directly skips the service's friendly pre-check entirely.
      const error = await insert(cA2.id).catch((e: unknown) => e);
      expect(mapCanonDecisionWriteError(error)).toMatchObject({ code: CANON_DECISION_ERROR_CODES.CONFLICT_ALREADY_DECIDED });
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 1, selections: 1 });
    });
  });

  describe("historical reproducibility (§39, §72, §73)", () => {
    it("the mandatory scenario: later policies, versions and manifests move nothing in the old decision (§39)", async () => {
      const r = await ruleset("history");
      const a = await entity("history");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const [s1, s2] = [await reference(a1.id, "supports A1"), await reference(a2.id, "supports A2")] as const;
      const conflict = await createRuleConflict(r.id, {
        entityId: a.id,
        conflictType: "SOURCE_CONTRADICTION",
        severity: "MEDIUM",
        title: "AP cost",
        candidates: [
          { entityVersionId: a1.id, sourceReferenceId: s1.id },
          { entityVersionId: a2.id, sourceReferenceId: s2.id },
        ],
      });
      const p1 = await policy(r.id, "P1", [
        { sourceDocumentId: s1.sourceDocumentId, authorityStatus: "GOVERNING" },
        { sourceDocumentId: s2.sourceDocumentId, authorityStatus: "CURRENT_SUPPLEMENTAL" },
      ]);
      const p1Snapshot = await getCanonPolicy(p1.id);
      const cA1 = conflict.candidates.find((c) => c.entityVersionId === a1.id)!;
      const d = await createCanonDecision(conflict.id, selectRule(p1.id, cA1.id, "A1's source governs under P1."));
      const snapshot = await getCanonDecision(d.id);

      const p2 = await policy(r.id, "P2", [
        { sourceDocumentId: s1.sourceDocumentId, authorityStatus: "SUPERSEDED" },
        { sourceDocumentId: s2.sourceDocumentId, authorityStatus: "GOVERNING" },
      ]);
      const a3 = await version(a.id, "A3");
      await version(a.id, "A4");
      await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a3.id }] });

      const after = await getCanonDecision(d.id);
      expect(after).toEqual(snapshot);
      expect(after.canonPolicyId).toBe(p1.id); // §72: still P1, never "latest" P2
      expect(after.canonPolicyId).not.toBe(p2.id);
      expect(after.selections.map((s) => s.ruleConflictCandidateId)).toEqual([cA1.id]); // §73: still A1's candidate
      expect(after.rationale).toBe("A1's source governs under P1.");
      expect(await getCanonPolicy(p1.id)).toEqual(p1Snapshot); // P1 itself never moved
      const stored = await getRuleConflict(conflict.id);
      expect(stored.candidates.map((c) => c.entityVersionId)).toEqual([a1.id, a2.id]); // A3/A4 never joined
      expect(stored.candidates.map((c) => c.sourceReferenceId)).toEqual([s1.id, s2.id]);
    });
  });

  describe("a decision records; it never applies (§27–§31, §53, §66, §74–§78)", () => {
    it("manifest regression: the manifest pins A2, SELECT_RULE chooses A1, the manifest still resolves A2 (§27, §74)", async () => {
      const { r, a, a2, conflict, cA1, p1 } = await scenario("manifest");
      const m = await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const before = await worldSnapshot(r.id, a.id, conflict.id);
      await createCanonDecision(conflict.id, selectRule(p1.id, cA1.id));
      expect((await resolveEntityVersionFromManifest(m.id, a.id))?.id).toBe(a2.id);
      expect(await worldSnapshot(r.id, a.id, conflict.id)).toEqual(before);
      expect(await prisma.rulesetManifest.count({ where: { rulesetId: r.id } })).toBe(1); // no manifest was created
    });

    it("inheritance regression: the child's explicit A2 stays the effective result after SELECT_RULE A1 (§75)", async () => {
      const parent = await ruleset("ip");
      const child = await ruleset("ic", parent.id);
      const { a, a1, a2, conflict, cA1, p1 } = await scenario("inherit", child.id);
      const pm = await createRulesetManifest(parent.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      const cm = await createRulesetManifest(child.id, { parentManifestId: pm.id, entries: [{ entityId: a.id, entityVersionId: a2.id }] });
      const before = await resolveEffectiveEntityVersion(cm.id, a.id);
      await createCanonDecision(conflict.id, selectRule(p1.id, cA1.id));
      const after = await resolveEffectiveEntityVersion(cm.id, a.id);
      expect(after).toMatchObject({ entityVersionId: a2.id, source: "EXPLICIT" });
      expect(after).toEqual(before);
    });

    it("authority regression: the policy calls A1's source GOVERNING, the decision selects A2, and A2 stays selected (§31, §76)", async () => {
      const r = await ruleset("authority");
      const a = await entity("authority");
      const [a1, a2] = [await version(a.id, "A1"), await version(a.id, "A2")] as const;
      const [s1, s2] = [await reference(a1.id, "A1 src"), await reference(a2.id, "A2 src")] as const;
      const conflict = await createRuleConflict(r.id, {
        entityId: a.id,
        conflictType: "OTHER",
        severity: "LOW",
        title: "t",
        candidates: [
          { entityVersionId: a1.id, sourceReferenceId: s1.id },
          { entityVersionId: a2.id, sourceReferenceId: s2.id },
        ],
      });
      const p = await policy(r.id, "favours A1", [
        { sourceDocumentId: s1.sourceDocumentId, authorityStatus: "GOVERNING" },
        { sourceDocumentId: s2.sourceDocumentId, authorityStatus: "REFERENCE_ONLY" },
      ]);
      const cA2 = conflict.candidates.find((c) => c.entityVersionId === a2.id)!;
      const before = await worldSnapshot(r.id, a.id, conflict.id);
      const d = await createCanonDecision(conflict.id, selectRule(p.id, cA2.id, "Playtest data favours A2 despite the source ranking."));
      expect(d.selections.map((s) => s.ruleConflictCandidateId)).toEqual([cA2.id]);
      expect((await getCanonDecision(d.id)).selections.map((s) => s.ruleConflictCandidateId)).toEqual([cA2.id]);
      expect(await worldSnapshot(r.id, a.id, conflict.id)).toEqual(before); // policy and records untouched (§30)
    });

    it("lifecycle regression: A1 CANON / A2 DRAFT stay exactly that when A2 is selected (§29, §77)", async () => {
      const { r, a, a1, a2, conflict, cA2, p1 } = await scenario("life");
      for (const status of ["IN_REVIEW", "APPROVED", "PLAYTEST", "CANON"]) await transitionEntityVersionStatus(a1.id, status);
      const before = await worldSnapshot(r.id, a.id, conflict.id);
      await createCanonDecision(conflict.id, selectRule(p1.id, cA2.id));
      const status = async (id: string) => (await prisma.entityVersion.findUniqueOrThrow({ where: { id } })).status;
      expect([await status(a1.id), await status(a2.id)]).toEqual(["CANON", "DRAFT"]);
      expect(await worldSnapshot(r.id, a.id, conflict.id)).toEqual(before);
    });

    it("nothing creates a decision implicitly: conflicts, policies and manifests produce zero decisions (§66)", async () => {
      const { r, a, a1, conflict } = await scenario("noauto");
      await policy(r.id, "P2");
      await createRulesetManifest(r.id, { entries: [{ entityId: a.id, entityVersionId: a1.id }] });
      expect(await decisionCounts(conflict.id)).toEqual({ decisions: 0, selections: 0 });
      expect(await prisma.canonDecision.count({ where: { rulesetId: r.id } })).toBe(0);
      expect(await conflictStatus(conflict.id)).toBe("OPEN");
    });

    it("exposes exactly four decision operations — nothing updates, applies, or deletes; no public conflict-status setter (§2, §28, §65)", async () => {
      const names = Object.keys(await import("../../src/index"));
      // M2-WO7's proposeChangeSetFromCanonDecision is a ChangeSet operation, audited in change-set.test.ts.
      expect(names.filter((n) => /decision/i.test(n) && !/changeset/i.test(n)).sort()).toEqual(["createCanonDecision", "getCanonDecision", "listCanonDecisions", "listCanonDecisionsForConflict"]);
      const forbidden = /^(update|edit|change|replace|delete|remove|apply|promote|set|transition|reopen|rollback|supersede)\w*(decision|outcome|selection|conflict(status)?|manifest(fromdecision)?|policy|candidate)/i;
      const control = ["updateDecision", "editDecision", "changeOutcome", "replacePolicy", "changeSelections", "deleteDecision", "applyDecision", "updateManifestFromDecision", "promoteSelectedCandidate", "setRuleConflictStatus", "transitionRuleConflict"];
      expect(control.filter((n) => forbidden.test(n))).toEqual(control);
      expect(names.filter((n) => forbidden.test(n))).toEqual([]);
    });
  });

  describe("listing (§35–§38)", () => {
    it("lists by conflict and by Ruleset with exact filters, in creation order", async () => {
      const r = await ruleset("list");
      const s1 = await scenario("list1", r.id);
      const s2 = await scenario("list2", r.id);
      const p2 = await policy(r.id, "list P2");
      const d1 = await createCanonDecision(s1.conflict.id, selectRule(s1.p1.id, s1.cA1.id));
      const d2 = await createCanonDecision(s2.conflict.id, {
        canonPolicyId: p2.id,
        decisionType: "RESOLVE_CONFLICT",
        conflictDisposition: "DISMISSED",
        selectedCandidateIds: [],
        rationale: "dup",
      });
      expect((await listCanonDecisionsForConflict(s1.conflict.id)).map((d) => d.id)).toEqual([d1.id]);
      expect((await listCanonDecisions(r.id)).map((d) => d.id)).toEqual([d1.id, d2.id]);
      expect((await listCanonDecisions(r.id)).every((d) => !("selections" in d))).toBe(true);
      expect((await listCanonDecisions(r.id, { ruleConflictId: s2.conflict.id })).map((d) => d.id)).toEqual([d2.id]);
      expect((await listCanonDecisions(r.id, { canonPolicyId: s1.p1.id })).map((d) => d.id)).toEqual([d1.id]);
      expect((await listCanonDecisions(r.id, { decisionType: "SELECT_RULE" })).map((d) => d.id)).toEqual([d1.id]);
      expect((await listCanonDecisions(r.id, { conflictDisposition: "DISMISSED" })).map((d) => d.id)).toEqual([d2.id]);
      expect(await listCanonDecisions(r.id, { decisionType: "MERGE" })).toEqual([]);
      expect(await listCanonDecisions(r.id, { ruleConflictId: MISSING })).toEqual([]);
      await expectCode(listCanonDecisions(r.id, { ruleConflictId: "not-a-uuid" }), CANON_DECISION_ERROR_CODES.INVALID_INPUT);
      await expectCode(listCanonDecisions(r.id, { decisionType: "PROMOTE" }), CANON_DECISION_ERROR_CODES.INVALID_INPUT);
      expect(await listCanonDecisionsForConflict((await scenario("listnone")).conflict.id)).toEqual([]);
      expect(await listCanonDecisions((await ruleset("listempty")).id)).toEqual([]);
    });
  });

  describe("the database enforces what it can (§14, §15, §24–§26, §58)", () => {
    const raw = async (label: string) => {
      const s = await scenario(label);
      const base = {
        rulesetId: s.r.id,
        entityId: s.conflict.entityId,
        ruleConflictId: s.conflict.id,
        canonPolicyId: s.p1.id,
        decisionType: "SELECT_RULE" as const,
        conflictDisposition: "RESOLVED" as const,
        rationale: "direct",
      };
      return { ...s, base };
    };

    it("even inserted directly: another Ruleset's policy, a mismatched Ruleset or Entity, or a foreign merge result is rejected (§24, §26)", async () => {
      const { base, r } = await raw("directdecision");
      const other = await scenario("directother");
      await expect(prisma.canonDecision.create({ data: { ...base, canonPolicyId: other.p1.id } })).rejects.toThrow(/canon_decisions_policy_fkey/);
      // Ruleset says B (with B's policy, which matches B) — but the conflict is A's: the conflict key rejects it.
      await expect(prisma.canonDecision.create({ data: { ...base, rulesetId: other.r.id, canonPolicyId: other.p1.id } })).rejects.toThrow(/canon_decisions_conflict_fkey/);
      await expect(prisma.canonDecision.create({ data: { ...base, entityId: other.conflict.entityId } })).rejects.toThrow(/canon_decisions_conflict_fkey/);
      await expect(prisma.canonDecision.create({ data: { ...base, decisionType: "MERGE", resultEntityVersionId: other.a1.id } })).rejects.toThrow(
        /canon_decisions_result_version_fkey/,
      );
      expect(await prisma.canonDecision.count({ where: { rulesetId: r.id } })).toBe(0);
    });

    it("even inserted directly: a selection of another conflict's candidate, a mismatched conflict copy, or a duplicate is rejected (§14, §15, §25)", async () => {
      const { base, cA1, conflict } = await raw("directselection");
      const other = await scenario("directselother");
      const d = await prisma.canonDecision.create({ data: base });
      await expect(prisma.canonDecisionSelection.create({ data: { canonDecisionId: d.id, ruleConflictId: conflict.id, ruleConflictCandidateId: other.cA1.id } })).rejects.toThrow(
        /canon_decision_selections_candidate_fkey/,
      );
      await expect(
        prisma.canonDecisionSelection.create({ data: { canonDecisionId: d.id, ruleConflictId: other.conflict.id, ruleConflictCandidateId: other.cA1.id } }),
      ).rejects.toThrow(/canon_decision_selections_decision_fkey/);
      await prisma.canonDecisionSelection.create({ data: { canonDecisionId: d.id, ruleConflictId: conflict.id, ruleConflictCandidateId: cA1.id } });
      const dup = await prisma.canonDecisionSelection
        .create({ data: { canonDecisionId: d.id, ruleConflictId: conflict.id, ruleConflictCandidateId: cA1.id } })
        .catch((e: unknown) => e);
      expect(String(dup)).toMatch(/canon_decision_selections_decision_candidate_key/);
      expect(mapCanonDecisionWriteError(dup)).toMatchObject({ code: CANON_DECISION_ERROR_CODES.INVALID_INPUT });
    });

    it("protects governance history: policy, conflict, candidate, merge result, Ruleset and decision cannot be deleted while referenced (RESTRICT, §58)", async () => {
      const { r, a, conflict, cA1, cA2, p1 } = await scenario("restrict");
      const a3 = await version(a.id, "A3");
      const d = await createCanonDecision(conflict.id, {
        canonPolicyId: p1.id,
        decisionType: "MERGE",
        conflictDisposition: "RESOLVED",
        selectedCandidateIds: [cA1.id, cA2.id],
        resultEntityVersionId: a3.id,
        rationale: "merged",
      });
      await expect(prisma.canonPolicy.delete({ where: { id: p1.id } })).rejects.toThrow(/canon_decisions_policy_fkey/);
      await expect(prisma.ruleConflictCandidate.delete({ where: { id: cA1.id } })).rejects.toThrow(/canon_decision_selections_candidate_fkey/);
      await expect(prisma.entityVersion.delete({ where: { id: a3.id } })).rejects.toThrow(/canon_decisions_result_version_fkey/);
      await expect(prisma.canonDecision.delete({ where: { id: d.id } })).rejects.toThrow(/canon_decision_selections_decision_fkey/);
      await expect(prisma.ruleConflict.delete({ where: { id: conflict.id } })).rejects.toThrow();
      await expect(prisma.ruleset.delete({ where: { id: r.id } })).rejects.toThrow();
      expect(await getCanonDecision(d.id)).toEqual(d);
    });

    it("every foreign key is RESTRICT with exactly the designed columns (§24–§26, §58)", async () => {
      const keys = await prisma.$queryRaw<Array<{ constraint_name: string; delete_rule: string; cols: string }>>`
        SELECT rc.constraint_name, rc.delete_rule,
               string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
        WHERE rc.constraint_name LIKE 'canon_decision%'
        GROUP BY rc.constraint_name, rc.delete_rule ORDER BY rc.constraint_name`;
      expect(keys).toEqual([
        { constraint_name: "canon_decision_selections_candidate_fkey", delete_rule: "RESTRICT", cols: "rule_conflict_candidate_id,rule_conflict_id" },
        { constraint_name: "canon_decision_selections_decision_fkey", delete_rule: "RESTRICT", cols: "canon_decision_id,rule_conflict_id" },
        { constraint_name: "canon_decisions_conflict_fkey", delete_rule: "RESTRICT", cols: "rule_conflict_id,ruleset_id,entity_id" },
        { constraint_name: "canon_decisions_policy_fkey", delete_rule: "RESTRICT", cols: "canon_policy_id,ruleset_id" },
        { constraint_name: "canon_decisions_result_version_fkey", delete_rule: "RESTRICT", cols: "result_entity_version_id,entity_id" },
        { constraint_name: "canon_decisions_ruleset_id_fkey", delete_rule: "RESTRICT", cols: "ruleset_id" },
      ]);
    });

    it("the tables have exactly the specified columns; no winner/active/current/latest/applied column; no UNIQUE(rule_conflict_id) (§22, §36)", async () => {
      const cols = async (table: string) =>
        (await prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY column_name`).map((c) => c.column_name);
      expect(await cols("canon_decisions")).toEqual([
        "canon_policy_id",
        "conflict_disposition",
        "created_at",
        "decision_type",
        "entity_id",
        "id",
        "rationale",
        "result_entity_version_id",
        "rule_conflict_id",
        "ruleset_id",
      ]);
      expect(await cols("canon_decision_selections")).toEqual(["canon_decision_id", "created_at", "id", "rule_conflict_candidate_id", "rule_conflict_id"]);
      const forbidden = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'canon_decision%'
          AND column_name ~* '(winner|active|current|latest|applied|updated_at|manifest)'`;
      expect(forbidden).toEqual([]);
      const uniques = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes WHERE tablename = 'canon_decisions' AND indexdef LIKE 'CREATE UNIQUE%'`;
      // M2-WO7 added "id, ruleset_id" — a PK-led composite-key target for ChangeSet, not a uniqueness on rule_conflict_id.
      expect(uniques.map((u) => u.indexdef.replace(/^.*\((.*)\)$/, "$1")).sort()).toEqual(["id", "id, rule_conflict_id", "id, ruleset_id"]);
    });

    it("the M2-WO6 migration is applied and finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261007010000_add_canon_decisions'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.finished_at).not.toBeNull();
      expect(rows[0]?.rolled_back_at).toBeNull();
    });
  });
});
