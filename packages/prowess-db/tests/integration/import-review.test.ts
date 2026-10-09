/**
 * M3-WO6 — Conflict Detection & Import Review Decisions, database integration (prowess_studio_test only).
 * Candidates come from test-only extractors (WO3's injectable registry); matching evidence from WO4. Describe blocks
 * follow §68–§104.
 */
import {
  DomainError,
  IMPORT_DECISION_ERROR_CODES,
  IMPORT_REVIEW_ERROR_CODES,
  type CreateExtractionCandidateInput,
  type EntityType,
  type ExtractionCandidate,
  type JsonObject,
  type ReviewImportCandidateInput,
} from "@prowess/model";
import { ExtractorRegistry, type ExtractorDefinition } from "@prowess/import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeImportBatchMatches,
  analyzeImportConflicts,
  completeImportReview,
  createEntity,
  createEntityAlias,
  createEntityVersion,
  createImportBatch,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  DOCX_MIME_TYPE,
  getCandidateMatchAssessment,
  getImportBatch,
  getImportDecision,
  getImportReviewSummary,
  getSourceStructure,
  ingestSourceSnapshot,
  listCandidateDuplicateGroups,
  listExtractionCandidates,
  listImportDecisionsForBatch,
  listImportDecisionsForCandidate,
  prisma,
  reviewImportCandidate,
} from "../../src/index";
import { extractImportBatchWith } from "../../src/extraction/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { buildDocx } from "../fixtures/docx-builder";
import { getTestDatabaseUrl } from "./env";
import { cleanupM2GoldenHistories } from "./fixtures/m2-golden-history";

const STAMP = Date.now();
const PREFIX = `test.m3review${STAMP}`;
const DOC_PREFIX = `M3R ${STAMP} `;
const T = (s: string) => `${s} ${STAMP}`;
const key = (s: string) => `${PREFIX}.${s}`;
const REVIEW_WRITES = ["import_decisions", "extraction_candidates", "import_batches"];

async function expectCode(promise: Promise<unknown>, code: string, label?: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, label).toBeInstanceOf(DomainError);
  expect((error as DomainError).code, label).toBe(code);
}
async function fingerprint(tables?: string[], exclude: string[] = []): Promise<Record<string, string>> {
  const all = (await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`).map((r) => r.table_name);
  const out: Record<string, string> = {};
  for (const t of tables ?? all) {
    if (exclude.includes(t)) continue;
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${t}" t`);
    out[t] = row?.h ?? "";
  }
  return out;
}
/** Candidate content columns (everything except status) — must never change through review. */
async function candidateContent(importBatchId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ h: string }>>(
    `SELECT md5(coalesce(string_agg(concat_ws('|', id, ordinal, candidate_kind, proposed_entity_type, proposed_canonical_key, display_label, summary, confidence, payload_schema_key, payload_schema_version, payload_json::text, candidate_fingerprint, primary_source_section_id, primary_source_content_node_id), '#' ORDER BY id), '')) AS h FROM extraction_candidates WHERE import_batch_id = $1::uuid`,
    importBatchId,
  );
  const sources = await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(s::text, '#' ORDER BY s.id), '')) AS h FROM extraction_candidate_sources s JOIN extraction_candidates c ON c.id = s.extraction_candidate_id WHERE c.import_batch_id = $1::uuid`, importBatchId);
  return `${rows[0]?.h}/${sources[0]?.h}`;
}

interface Spec {
  label: string;
  kind?: CreateExtractionCandidateInput["candidateKind"];
  type?: EntityType | null;
  canonicalKey?: string | null;
  payload?: Record<string, unknown>;
  schemaVersion?: number;
}

async function reviewBatch(label: string, specs: Spec[], comparison?: { rulesetId: string; manifestId: string }) {
  const d = await createSourceDocument({ title: `${DOC_PREFIX}${label}`, sourceType: "DOCUMENT" });
  const { snapshot } = await ingestSourceSnapshot(d.id, buildDocx({ blocks: [{ kind: "heading", level: 1, text: "Glossary" }, { kind: "p", text: "Terms." }] }), { label, originalFilename: `${label}.docx`, mimeType: DOCX_MIME_TYPE });
  const sectionId = (await getSourceStructure(snapshot.id)).sections[0]!.id;
  const { batch } = await createImportBatch({ sourceSnapshotId: snapshot.id, label, scope: { type: "SNAPSHOT" }, extractorKey: "prowess.test-review", extractorVersion: "1", ...(comparison ? { reviewRulesetId: comparison.rulesetId, comparisonManifestId: comparison.manifestId } : {}) });
  const extractor: ExtractorDefinition = {
    key: "prowess.test-review", version: "1", description: "test-only", acceptsConfiguration: false,
    payloadSchemas: [{ key: "prowess.test.review", version: 1 }, { key: "prowess.test.review", version: 2 }],
    extract: () => specs.map((s, i) => ({
      ordinal: i + 1, candidateKind: s.kind ?? "ENTITY", proposedEntityType: s.type ?? null, proposedCanonicalKey: s.canonicalKey ?? null, displayLabel: s.label, confidence: "HIGH",
      payloadSchemaKey: "prowess.test.review", payloadSchemaVersion: s.schemaVersion ?? 1, payloadJson: (s.payload ?? { i }) as JsonObject, primarySourceAnchor: { sectionId }, supportingSourceAnchors: [],
    })),
  };
  await extractImportBatchWith(new ExtractorRegistry([extractor]), batch.id);
  const candidates = await listExtractionCandidates(batch.id);
  return { batch, candidates, c: (n: number) => candidates[n - 1] as ExtractionCandidate };
}
const decide = (c: ExtractionCandidate, input: Omit<ReviewImportCandidateInput, "extractionCandidateId" | "candidateFingerprint">) =>
  reviewImportCandidate({ extractionCandidateId: c.id, candidateFingerprint: c.candidateFingerprint, ...input });
const statusOf = async (c: ExtractionCandidate) => (await prisma.extractionCandidate.findUnique({ where: { id: c.id } }))!.status;

describe("M3-WO6 import review (prowess_studio_test only)", () => {
  let e1: { id: string };
  let e2: { id: string };
  let e3: { id: string };
  let e4: { id: string };
  let a1: { id: string };
  let manifest: { rulesetId: string; manifestId: string };
  let f: Awaited<ReturnType<typeof reviewBatch>>;
  let runId: string;

  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    e1 = await createEntity({ entityType: "RESOURCE", canonicalKey: key("alpha") });
    e2 = await createEntity({ entityType: "RESOURCE", canonicalKey: key("shared_a") });
    e3 = await createEntity({ entityType: "RESOURCE", canonicalKey: key("shared_b") });
    e4 = await createEntity({ entityType: "RESOURCE", canonicalKey: key("unsuggested") });
    await createEntityAlias(e2.id, { alias: T("Shared") });
    await createEntityAlias(e3.id, { alias: T("Shared") });
    a1 = await createEntityVersion(e1.id, { displayName: T("Alpha") });
    const ruleset = await createRuleset({ canonicalKey: key("ruleset"), name: T("R"), channel: "CORE_PLAYTEST" });
    const m = await createRulesetManifest(ruleset.id, { entries: [{ entityId: e1.id, entityVersionId: a1.id }] });
    manifest = { rulesetId: ruleset.id, manifestId: m.id };
    f = await reviewBatch("main", [
      { label: T("Alpha"), type: "RESOURCE", canonicalKey: key("alpha") }, // 1 EXACT_MATCH e1 (comparison A1)
      { label: T("Shared"), type: "RESOURCE" }, // 2 POTENTIAL e2 / e3
      { label: T("Brand New"), type: "RESOURCE", canonicalKey: key("brand_new") }, // 3 NO_MATCH
      { label: T("Dup Conflict"), type: "SPELL_EFFECT", canonicalKey: key("dd"), payload: { cost: 4 } }, // 4 ┐ potential content conflict
      { label: T("Dup Conflict 2"), type: "SPELL_EFFECT", canonicalKey: key("dd"), payload: { cost: 6 } }, // 5 ┘
      { label: T("Dup Same"), type: "SYSTEM", canonicalKey: key("same"), payload: { rule: "x" } }, // 6 ┐ equivalent
      { label: T("Dup Same 2"), type: "SYSTEM", canonicalKey: key("same"), payload: { rule: "x" } }, // 7 ┘
      { label: T("Dup Schema"), type: "SYSTEM", canonicalKey: key("schema"), payload: { a: 1 } }, // 8 ┐ uncomparable
      { label: T("Dup Schema 2"), type: "SYSTEM", canonicalKey: key("schema"), payload: { a: 1 }, schemaVersion: 2 }, // 9 ┘
      { label: "Spell AP", kind: "FORMULA" }, // 10
      { label: "Damage", kind: "KEYWORD" }, // 11
      { label: "Spellcasting", kind: "UNKNOWN" }, // 12
      { label: T("Needs Map"), type: "RESOURCE" }, // 13
      { label: T("Conflicted"), type: "RESOURCE" }, // 14
      { label: T("Reject Me"), type: "RESOURCE" }, // 15
    ], manifest);
    runId = (await analyzeImportBatchMatches(f.batch.id)).run.id;
  }, 120_000);

  afterAll(async () => {
    const docs = (await prisma.sourceDocument.findMany({ where: { title: { startsWith: DOC_PREFIX } }, select: { id: true } })).map((d) => d.id);
    const snaps = (await prisma.sourceSnapshot.findMany({ where: { sourceDocumentId: { in: docs } }, select: { id: true } })).map((s) => s.id);
    const batches = (await prisma.importBatch.findMany({ where: { sourceSnapshotId: { in: snaps } }, select: { id: true } })).map((b) => b.id);
    const inBatch = { importBatchId: { in: batches } };
    await prisma.importDecision.deleteMany({ where: inBatch });
    await prisma.candidateDuplicateGroupMember.deleteMany({ where: inBatch });
    await prisma.candidateDuplicateGroup.deleteMany({ where: inBatch });
    await prisma.candidateMatchSuggestion.deleteMany({ where: { assessment: inBatch } });
    await prisma.candidateMatchAssessment.deleteMany({ where: inBatch });
    await prisma.importMatchRun.deleteMany({ where: inBatch });
    const inSnap = { sourceSnapshotId: { in: snaps } };
    await prisma.extractionCandidateSource.deleteMany({ where: inSnap });
    await prisma.extractionCandidate.deleteMany({ where: inSnap });
    await prisma.importBatch.deleteMany({ where: inSnap });
    await prisma.sourceContentNode.deleteMany({ where: inSnap });
    await prisma.sourceBlock.deleteMany({ where: inSnap });
    for (const s of await prisma.sourceSection.findMany({ where: inSnap, select: { id: true }, orderBy: { ordinal: "desc" } })) await prisma.sourceSection.delete({ where: { id: s.id } });
    await prisma.sourceSnapshotIngestion.deleteMany({ where: inSnap });
    await prisma.sourceSnapshot.deleteMany({ where: { id: { in: snaps } } });
    await prisma.sourceDocument.deleteMany({ where: { id: { in: docs } } });
    await prisma.entityAlias.deleteMany({ where: { entity: { canonicalKey: { startsWith: PREFIX } } } });
    await cleanupM2GoldenHistories(PREFIX);
  }, 300_000);

  describe("§68–§71 conflict signals are derived and read-only", () => {
    it("equivalent / potential conflict / uncomparable, deterministic, and nothing anywhere changes", async () => {
      const before = await fingerprint();
      const signals = await analyzeImportConflicts(f.batch.id, runId);
      expect(await fingerprint()).toEqual(before);
      expect(await analyzeImportConflicts(f.batch.id, runId)).toEqual(signals);
      const byMembers = (a: number, b: number) => signals.find((s) => s.candidateIds.join() === [f.c(a).id, f.c(b).id].join())!;
      expect(byMembers(4, 5)).toMatchObject({ type: "POTENTIAL_CONTENT_CONFLICT", payloadSchemaKey: "prowess.test.review", payloadSchemaVersion: 1, distinctPayloadCount: 2 });
      expect(byMembers(6, 7)).toMatchObject({ type: "DUPLICATE_EQUIVALENT", distinctPayloadCount: 1 });
      expect(byMembers(8, 9)).toMatchObject({ type: "UNCOMPARABLE_DUPLICATE", payloadSchemaKey: null });
      expect((await listExtractionCandidates(f.batch.id)).every((c) => c.status === "UNREVIEWED")).toBe(true);
      const other = await reviewBatch("other-run", [{ label: T("Alpha"), type: "RESOURCE", canonicalKey: key("alpha") }]);
      const otherRun = (await analyzeImportBatchMatches(other.batch.id)).run.id;
      await expectCode(analyzeImportConflicts(f.batch.id, otherRun), IMPORT_DECISION_ERROR_CODES.MATCH_RUN_MISMATCH);
      expect((await getImportReviewSummary(f.batch.id, { matchRunId: runId })).potentialConflictCount).toBe(1);
      expect((await getImportReviewSummary(f.batch.id)).potentialConflictCount).toBeNull(); // never a "latest" run
    });
  });

  describe("§72–§76 match classification", () => {
    it("exact, suggested and manual classifications validate their evidence; new-Entity classification creates nothing", async () => {
      const content = await candidateContent(f.batch.id);
      const wo4 = await fingerprint(["import_match_runs", "candidate_match_assessments", "candidate_match_suggestions", "candidate_duplicate_groups", "candidate_duplicate_group_members"]);
      const exactA = await getCandidateMatchAssessment(runId, f.c(1).id);
      expect(exactA).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: e1.id, comparisonEntityVersionId: a1.id });
      const batchBefore = await getImportBatch(f.batch.id);
      expect(batchBefore.status).toBe("READY_FOR_REVIEW");
      const r1 = await decide(f.c(1), { decisionType: "CLASSIFY_MATCHED", matchBasis: "EXACT_MATCH", targetEntityId: e1.id, matchRunId: runId, matchAssessmentId: exactA.id, comparisonEntityVersionId: a1.id });
      expect(r1).toMatchObject({ created: true, decision: { sequenceNumber: 1, fromStatus: "UNREVIEWED", toStatus: "MATCHED", matchBasis: "EXACT_MATCH", targetEntityId: e1.id, comparisonEntityVersionId: a1.id, candidateFingerprint: f.c(1).candidateFingerprint, candidateSetHash: batchBefore.extractionOutputHash } });
      expect(await statusOf(f.c(1))).toBe("MATCHED");
      expect((await getImportBatch(f.batch.id)).status).toBe("REVIEWING"); // §92 first decision moves the Batch, atomically

      const potentialA = await getCandidateMatchAssessment(runId, f.c(2).id);
      await expectCode(decide(f.c(2), { decisionType: "CLASSIFY_MATCHED", matchBasis: "EXACT_MATCH", targetEntityId: e2.id, matchRunId: runId, matchAssessmentId: potentialA.id }), IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, "§73");
      await expectCode(decide(f.c(2), { decisionType: "CLASSIFY_MATCHED", matchBasis: "SUGGESTED_MATCH", targetEntityId: e4.id, matchRunId: runId, matchAssessmentId: potentialA.id }), IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, "not a suggestion");
      expect((await decide(f.c(2), { decisionType: "CLASSIFY_MATCHED", matchBasis: "SUGGESTED_MATCH", targetEntityId: e3.id, matchRunId: runId, matchAssessmentId: potentialA.id })).decision).toMatchObject({ toStatus: "MATCHED", targetEntityId: e3.id }); // §74 — the reviewer chose rank 2 explicitly

      await expectCode(decide(f.c(3), { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: e4.id }), IMPORT_DECISION_ERROR_CODES.MANUAL_RATIONALE_REQUIRED, "§75 without rationale");
      expect((await decide(f.c(3), { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: e4.id, rationale: "  Known synonym per design notes.  " })).decision).toMatchObject({ matchBasis: "MANUAL_OVERRIDE", rationale: "  Known synonym per design notes.  " });

      const entities = await fingerprint(["entities", "entity_versions", "entity_aliases"]);
      expect((await decide(f.c(13), { decisionType: "CLASSIFY_NEW_ENTITY" })).decision.toStatus).toBe("NEW_ENTITY"); // §76
      expect(await fingerprint(["entities", "entity_versions", "entity_aliases"])).toEqual(entities);
      await expectCode(decide(f.c(14), { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: "00000000-0000-4000-8000-000000000000", rationale: "x" }), IMPORT_DECISION_ERROR_CODES.INVALID_TARGET_ENTITY);
      expect(await candidateContent(f.batch.id)).toEqual(content); // §91 only status changes
      expect(await fingerprint(["import_match_runs", "candidate_match_assessments", "candidate_match_suggestions", "candidate_duplicate_groups", "candidate_duplicate_group_members"])).toEqual(wo4); // §102
    });
  });

  describe("§77–§80 conflict, mapping, rejection", () => {
    it("MARK_CONFLICT cites an exact group of which the Candidate is a member; no M2 RuleConflict is created", async () => {
      const groups = await listCandidateDuplicateGroups(runId);
      const g45 = groups.find((g) => g.memberCandidateIds.includes(f.c(4).id))!;
      const g67 = groups.find((g) => g.memberCandidateIds.includes(f.c(6).id))!;
      const ruleConflicts = await prisma.ruleConflict.count();
      await expectCode(decide(f.c(4), { decisionType: "MARK_CONFLICT", matchRunId: runId, duplicateGroupId: g67.id }), IMPORT_DECISION_ERROR_CODES.DUPLICATE_GROUP_MISMATCH, "§78");
      expect((await decide(f.c(4), { decisionType: "MARK_CONFLICT", matchRunId: runId, duplicateGroupId: g45.id, rationale: "cost 4 vs 6" })).decision).toMatchObject({ toStatus: "CONFLICT", duplicateGroupId: g45.id });
      expect(await prisma.ruleConflict.count()).toBe(ruleConflicts);
    });

    it("NEEDS_MAPPING and REJECT; rejection is terminal and needs a rationale", async () => {
      expect((await decide(f.c(12), { decisionType: "MARK_NEEDS_MAPPING" })).decision.toStatus).toBe("NEEDS_MAPPING"); // §79 a structural Candidate
      await expectCode(decide(f.c(15), { decisionType: "REJECT" }), IMPORT_DECISION_ERROR_CODES.INVALID_INPUT, "no rationale");
      expect((await decide(f.c(15), { decisionType: "REJECT", rationale: "Not a rule." })).decision.toStatus).toBe("REJECTED");
      await expectCode(decide(f.c(15), { decisionType: "CLASSIFY_NEW_ENTITY" }), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, "§80 / §90 terminal");
      expect((await prisma.extractionCandidate.count({ where: { id: f.c(15).id } }))).toBe(1); // never deleted
    });
  });

  describe("§81–§90 approvals", () => {
    it("semantic Candidates approve directly; Keyword approval has no mechanics; structural ones cannot be approved", async () => {
      const domain = await fingerprint(undefined, REVIEW_WRITES);
      expect((await decide(f.c(10), { decisionType: "APPROVE_SEMANTIC" })).decision).toMatchObject({ fromStatus: "UNREVIEWED", toStatus: "APPROVED" });
      expect((await decide(f.c(11), { decisionType: "APPROVE_SEMANTIC" })).decision.toStatus).toBe("APPROVED");
      expect(await fingerprint(undefined, REVIEW_WRITES)).toEqual(domain); // no definitions, keywords, Entities, governance
      await expectCode(decide(f.c(12), { decisionType: "APPROVE_SEMANTIC" }), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, "structural");
    });

    it("Entity Candidates must be classified before approval; the approval target cannot change; terminal afterwards", async () => {
      await expectCode(decide(f.c(14), { decisionType: "APPROVE_NEW_ENTITY" }), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, "§83");
      await expectCode(decide(f.c(1), { decisionType: "APPROVE_MATCHED", targetEntityId: e2.id }), IMPORT_DECISION_ERROR_CODES.INVALID_TARGET_ENTITY, "§85");
      const before = await fingerprint(["entities", "entity_versions"]);
      expect((await decide(f.c(1), { decisionType: "APPROVE_MATCHED", targetEntityId: e1.id })).decision).toMatchObject({ sequenceNumber: 2, fromStatus: "MATCHED", toStatus: "APPROVED" }); // §84
      expect((await decide(f.c(13), { decisionType: "APPROVE_NEW_ENTITY" })).decision.toStatus).toBe("APPROVED"); // §86
      expect(await fingerprint(["entities", "entity_versions"])).toEqual(before);
      await expectCode(decide(f.c(1), { decisionType: "REJECT", rationale: "late" }), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, "§89");
      await expectCode(decide(f.c(4), { decisionType: "APPROVE_MATCHED", targetEntityId: e1.id }), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, "§33 CONFLICT never approves directly");
      await expectCode(decide(f.c(12), { decisionType: "APPROVE_NEW_ENTITY" }), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, "§34");
    });

    it("§87 / §88 / §98 resolution paths keep the full, gap-free history", async () => {
      await decide(f.c(4), { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: e4.id, rationale: "resolved by designer" });
      await decide(f.c(4), { decisionType: "APPROVE_MATCHED", targetEntityId: e4.id });
      expect((await listImportDecisionsForCandidate(f.c(4).id)).map((d) => [d.sequenceNumber, d.decisionType, d.toStatus])).toEqual([[1, "MARK_CONFLICT", "CONFLICT"], [2, "CLASSIFY_MATCHED", "MATCHED"], [3, "APPROVE_MATCHED", "APPROVED"]]);
      await decide(f.c(14), { decisionType: "MARK_NEEDS_MAPPING", rationale: "ambiguous term" });
      await decide(f.c(14), { decisionType: "CLASSIFY_NEW_ENTITY" });
      await decide(f.c(14), { decisionType: "APPROVE_NEW_ENTITY" });
      expect((await listImportDecisionsForCandidate(f.c(14).id)).map((d) => d.toStatus)).toEqual(["NEEDS_MAPPING", "NEW_ENTITY", "APPROVED"]);
      const all = await listImportDecisionsForBatch(f.batch.id);
      expect(all.length).toBe((await getImportReviewSummary(f.batch.id)).decisionCount);
      expect(await getImportDecision(all[0]!.id)).toEqual(all[0]);
    });
  });

  describe("§93–§95 Batch review lifecycle", () => {
    it("cannot complete early; completes when every Candidate is APPROVED or REJECTED; COMPLETED materializes nothing", async () => {
      const g = await reviewBatch("lifecycle", [{ label: "Range", kind: "FORMULA" }, { label: "Keep out", kind: "UNKNOWN" }, { label: "Later", kind: "KEYWORD" }]);
      await expectCode(completeImportReview(g.batch.id), IMPORT_REVIEW_ERROR_CODES.NOT_READY, "READY_FOR_REVIEW, no decision yet");
      await decide(g.c(1), { decisionType: "APPROVE_SEMANTIC" });
      await decide(g.c(2), { decisionType: "REJECT", rationale: "structural only" });
      await expectCode(completeImportReview(g.batch.id), IMPORT_REVIEW_ERROR_CODES.INCOMPLETE);
      expect((await getImportBatch(g.batch.id)).status).toBe("REVIEWING");
      await decide(g.c(3), { decisionType: "APPROVE_SEMANTIC" });
      const domain = await fingerprint(undefined, REVIEW_WRITES);
      expect((await completeImportReview(g.batch.id)).status).toBe("COMPLETED");
      expect(await fingerprint(undefined, REVIEW_WRITES)).toEqual(domain);
      await expectCode(decide(g.c(3), { decisionType: "REJECT", rationale: "x" }), IMPORT_REVIEW_ERROR_CODES.NOT_READY, "completed Batches accept no decisions");
      expect(await getImportReviewSummary(g.batch.id)).toMatchObject({ totalCandidates: 3, decisionCount: 3, byStatus: { APPROVED: 2, REJECTED: 1, UNREVIEWED: 0 } });
    });
  });

  describe("§96 / §97 idempotency and concurrency", () => {
    it("an exact retry returns the same decision; contradictory concurrent decisions: exactly one wins", async () => {
      const g = await reviewBatch("concurrency", [{ label: T("Race"), type: "RESOURCE" }, { label: T("Retry"), type: "RESOURCE" }]);
      const first = await decide(g.c(2), { decisionType: "REJECT", rationale: "duplicate entry" });
      const retry = await decide(g.c(2), { decisionType: "REJECT", rationale: "duplicate entry" });
      expect(retry).toEqual({ decision: first.decision, created: false });
      expect((await listImportDecisionsForCandidate(g.c(2).id)).length).toBe(1);
      await expectCode(decide(g.c(2), { decisionType: "REJECT", rationale: "different words" }), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION, "a different request is not a retry");

      const outcomes = await Promise.all([
        decide(g.c(1), { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: e4.id, rationale: "A" }).then(() => "ok", (e: unknown) => (e as DomainError).code),
        decide(g.c(1), { decisionType: "REJECT", rationale: "B" }).then(() => "ok", (e: unknown) => (e as DomainError).code),
      ]);
      expect(outcomes.filter((o) => o === "ok").length).toBe(1);
      expect(outcomes.filter((o) => o !== "ok")[0]).toMatch(/IMPORT_DECISION\.(DECISION_CONFLICT|INVALID_TRANSITION)/);
      expect((await listImportDecisionsForCandidate(g.c(1).id)).map((d) => d.sequenceNumber)).toEqual([1]);
      const identical = await Promise.all(Array.from({ length: 3 }, () => decide(g.c(1), { decisionType: "MARK_NEEDS_MAPPING" }).then((r) => r.created, () => "err")));
      expect(identical.filter((x) => x === true).length).toBeLessThanOrEqual(1);
    });
  });

  describe("§99 / §100 exact evidence", () => {
    it("a MatchRun of another Batch is rejected; pinned R1 / A1 stay R1 / A1 after R2 and A2 exist", async () => {
      const other = await reviewBatch("evidence-other", [{ label: T("Alpha"), type: "RESOURCE", canonicalKey: key("alpha") }]);
      const otherRun = (await analyzeImportBatchMatches(other.batch.id)).run.id;
      const g = await reviewBatch("evidence", [{ label: T("Alpha"), type: "RESOURCE", canonicalKey: key("alpha") }], manifest);
      const r1 = (await analyzeImportBatchMatches(g.batch.id)).run.id;
      await expectCode(decide(g.c(1), { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: e1.id, matchRunId: otherRun, rationale: "x" }), IMPORT_DECISION_ERROR_CODES.MATCH_RUN_MISMATCH);
      const assessment = await getCandidateMatchAssessment(r1, g.c(1).id);
      const { decision } = await decide(g.c(1), { decisionType: "CLASSIFY_MATCHED", matchBasis: "EXACT_MATCH", targetEntityId: e1.id, matchRunId: r1, matchAssessmentId: assessment.id, comparisonEntityVersionId: a1.id });
      await createEntityVersion(e1.id, { displayName: T("Alpha") }); // A2
      await createEntityAlias(e4.id, { alias: T("Evidence Alias") }); // changes the catalog -> R2
      const r2 = (await analyzeImportBatchMatches(g.batch.id)).run.id;
      expect(r2).not.toBe(r1);
      expect(await getImportDecision(decision.id)).toMatchObject({ matchRunId: r1, matchAssessmentId: assessment.id, comparisonEntityVersionId: a1.id });
      await expectCode(decide(g.c(1), { decisionType: "APPROVE_MATCHED", targetEntityId: e1.id, matchRunId: r1, matchAssessmentId: assessment.id, comparisonEntityVersionId: "00000000-0000-4000-8000-000000000000" }), IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE, "a Version the assessment never supplied");
    });

    it("a wrong fingerprint, a missing Candidate and an unextracted Batch are controlled errors; the database refuses inconsistent rows", async () => {
      await expectCode(reviewImportCandidate({ extractionCandidateId: f.c(6).id, candidateFingerprint: "f".repeat(64), decisionType: "MARK_NEEDS_MAPPING" }), IMPORT_DECISION_ERROR_CODES.INVALID_EVIDENCE);
      await expectCode(reviewImportCandidate({ extractionCandidateId: "00000000-0000-4000-8000-000000000000", candidateFingerprint: "f".repeat(64), decisionType: "MARK_NEEDS_MAPPING" }), IMPORT_DECISION_ERROR_CODES.CANDIDATE_NOT_FOUND);
      await expectCode(getImportDecision("nope"), IMPORT_DECISION_ERROR_CODES.NOT_FOUND);
      const batch = await getImportBatch(f.batch.id);
      const row = { importBatchId: f.batch.id, extractionCandidateId: f.c(6).id, candidateFingerprint: f.c(6).candidateFingerprint, candidateSetHash: batch.extractionOutputHash!, sequenceNumber: 1, fromStatus: "UNREVIEWED" as const, decisionFingerprint: "e".repeat(64) };
      await expect(prisma.importDecision.create({ data: { ...row, decisionType: "CLASSIFY_NEW_ENTITY", toStatus: "APPROVED" } })).rejects.toThrow(/type_status_check|check/i);
      await expect(prisma.importDecision.create({ data: { ...row, decisionType: "CLASSIFY_NEW_ENTITY", toStatus: "NEW_ENTITY", targetEntityId: e1.id } })).rejects.toThrow(/target_entity_check|check/i);
      await expect(prisma.importDecision.create({ data: { ...row, decisionType: "REJECT", toStatus: "REJECTED" } })).rejects.toThrow(/rationale_check|check/i);
      await expect(prisma.importDecision.create({ data: { ...row, decisionType: "MARK_NEEDS_MAPPING", toStatus: "NEEDS_MAPPING", candidateFingerprint: f.c(7).candidateFingerprint } })).rejects.toThrow(/candidate_fingerprint_fkey|Foreign key/i);
      await expect(prisma.importDecision.create({ data: { ...row, decisionType: "MARK_CONFLICT", toStatus: "CONFLICT", matchRunId: runId, duplicateGroupId: (await listCandidateDuplicateGroups(runId)).find((g) => !g.memberCandidateIds.includes(f.c(6).id))!.id } })).rejects.toThrow(/duplicate_member_fkey|Foreign key/i);
    });
  });

  describe("§101–§104 immutability of everything else", () => {
    it("review writes only import_decisions, Candidate status and Batch status", async () => {
      const g = await reviewBatch("immutability", [{ label: "Range", kind: "FORMULA" }, { label: T("Thing"), type: "RESOURCE" }]);
      const run = (await analyzeImportBatchMatches(g.batch.id)).run.id;
      const before = await fingerprint(undefined, REVIEW_WRITES);
      const content = await candidateContent(g.batch.id);
      await decide(g.c(1), { decisionType: "APPROVE_SEMANTIC" });
      await decide(g.c(2), { decisionType: "CLASSIFY_NEW_ENTITY", matchRunId: run });
      await decide(g.c(2), { decisionType: "APPROVE_NEW_ENTITY" });
      await completeImportReview(g.batch.id);
      expect(await fingerprint(undefined, REVIEW_WRITES)).toEqual(before); // source, WO4, Entities, governance unchanged
      expect(await candidateContent(g.batch.id)).toEqual(content);
    });
  });
});
