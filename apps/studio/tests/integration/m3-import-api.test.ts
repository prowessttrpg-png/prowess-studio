/**
 * M3 Import HTTP API (PAS-10 M3-WO7) — calls the REAL Next.js route handlers against the real prowess_studio_test
 * database. Fixture setup that has no HTTP route by design (SourceDocuments, structural ingestion, Entities) uses the
 * public services; ENTITY candidates are seeded directly as a committed extraction because no official extractor
 * proposes Entities. The flows under test (snapshots, batches, extraction, matching, conflicts, decisions, review)
 * run entirely through the routes.
 */
import { createHash, randomUUID } from "node:crypto";
import { assertRunningAgainstTestDatabase, createEntity, createSourceDocument, ingestSourceStructure, prisma } from "@prowess/db";
import type { SourceStructureInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, fingerprint } from "./m2-api-harness";
import * as R from "./m3-import-routes";

const STAMP = Date.now();
const PREFIX = `test.m3api${STAMP}`;
const DOC_PREFIX = `M3API ${STAMP} `;
const MISSING = "00000000-0000-4000-8000-000000000000";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const LEAK = /prisma|P20\d\d|select |insert |\/home\/|\/usr\/|postgres(ql)?:\/\/|at \w+ \(|\.ts:\d+|DEVELOPMENT_MODE/i;

async function allTables(): Promise<string[]> {
  return (await prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`).map((r) => r.table_name);
}

const STRUCTURE = (assetHash: string): SourceStructureInput => ({
  parserName: "test-structure",
  parserVersion: "1",
  sections: [
    { key: "rules", parentKey: null, title: "Spellcasting", headingLevel: 1, ordinal: 0, pageLocationBasis: "UNAVAILABLE" },
    { key: "costs", parentKey: "rules", title: "Costs", headingLevel: 2, ordinal: 1, pageLocationBasis: "UNAVAILABLE" },
  ],
  assets: [{ key: "img", assetType: "IMAGE", mimeType: "image/png", contentHash: assetHash, byteSize: 10 }],
  nodes: [
    { ordinal: 0, sectionKey: "rules", nodeType: "BLOCK", block: { blockType: "HEADING", rawText: "Spellcasting", pageLocationBasis: "UNAVAILABLE" } },
    { ordinal: 1, sectionKey: "costs", nodeType: "BLOCK", block: { blockType: "HEADING", rawText: "Costs", pageLocationBasis: "UNAVAILABLE" } },
    { ordinal: 2, sectionKey: "costs", nodeType: "BLOCK", block: { blockType: "PARAGRAPH", rawText: "Formula: Spell AP = floor(Final MP / PRO), minimum 1", pageLocationBasis: "UNAVAILABLE" } },
    { ordinal: 3, sectionKey: "costs", nodeType: "BLOCK", block: { blockType: "PARAGRAPH", rawText: "Keywords: Cost, Magic", pageLocationBasis: "UNAVAILABLE" } },
    { ordinal: 4, sectionKey: "costs", nodeType: "TABLE", table: { pageLocationBasis: "UNAVAILABLE", structure: { schemaVersion: 1, rowCount: 1, columnCount: 1, rows: [{ index: 0, isHeader: true, cells: [{ index: 0, columnIndex: 0, rowSpan: 1, colSpan: 1, isHeader: true, rawText: "Tier", nestedTables: [] }] }] } } },
    { ordinal: 5, sectionKey: "costs", nodeType: "ASSET_PLACEMENT", placement: { assetKey: "img", pageLocationBasis: "UNAVAILABLE" } },
  ],
});

/** A Snapshot registered THROUGH the API, then structurally ingested through the service (no HTTP ingestion exists). */
async function apiSnapshot(label: string) {
  const doc = await createSourceDocument({ title: `${DOC_PREFIX}${label}`, sourceType: "DOCUMENT" });
  const r = await call(R.SourceSnapshots.POST, "POST", "/api/import/source-snapshots", {}, { sourceDocumentId: doc.id, label, originalFilename: `${label}.docx`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", contentHash: sha(`${label}${STAMP}`), byteSize: 1234, declaredVersion: "V0.1" });
  expect(r.status).toBe(201);
  await ingestSourceStructure(r.data.id, STRUCTURE(sha(`asset${label}${STAMP}`)));
  return { documentId: doc.id, snapshotId: r.data.id as string };
}
const apiBatch = async (snapshotId: string, extractorKey = "prowess.semantic-foundation", extractorVersion = "1") => {
  const r = await call(R.Batches.POST, "POST", "/api/import/batches", {}, { sourceSnapshotId: snapshotId, label: "API batch", scope: { type: "SNAPSHOT" }, extractorKey, extractorVersion });
  expect([200, 201]).toContain(r.status);
  return r.data.batch as { id: string; status: string };
};
const decide = (candidate: { id: string; candidateFingerprint: string }, body: Record<string, unknown>) =>
  call(R.CandidatesDecisions.POST, "POST", "", { candidateId: candidate.id }, { candidateFingerprint: candidate.candidateFingerprint, ...body });

interface Seed { label: string; type: string; key: string | null; payload: Record<string, unknown> }
/** Seeds ENTITY candidates as a committed extraction (WO3 commit shape: candidates + READY_FOR_REVIEW + set hash). */
async function seedEntityExtraction(batchId: string, snapshotId: string, specs: Seed[]) {
  const sectionId = (await prisma.sourceSection.findFirst({ where: { sourceSnapshotId: snapshotId, ordinal: 1 } }))!.id;
  const rows = specs.map((s, i) => ({
    id: randomUUID(), importBatchId: batchId, sourceSnapshotId: snapshotId, ordinal: i + 1, candidateKind: "ENTITY" as const, proposedEntityType: s.type as "RESOURCE", proposedCanonicalKey: s.key,
    displayLabel: s.label, confidence: "HIGH" as const, status: "UNREVIEWED" as const, payloadSchemaKey: "prowess.test.entity", payloadSchemaVersion: 1, payloadJson: s.payload as object,
    candidateFingerprint: sha(`${batchId}:${i}`), primarySourceSectionId: sectionId,
  }));
  await prisma.extractionCandidate.createMany({ data: rows });
  const hash = sha(["PROWESS_EXTRACTION_SET_V1", ...rows.map((r) => `${r.ordinal}:${r.candidateFingerprint}`)].join("\n"));
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "READY_FOR_REVIEW", extractionOutputHash: hash, extractedAt: new Date() } });
}

describe("M3 Import API (prowess_studio_test only)", () => {
  let e1: { id: string };
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
    e1 = await createEntity({ entityType: "RESOURCE", canonicalKey: `${PREFIX}.alpha` });
  });

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
    await prisma.sourceAssetPlacement.deleteMany({ where: inSnap });
    await prisma.sourceBlock.deleteMany({ where: inSnap });
    await prisma.sourceTable.deleteMany({ where: inSnap });
    await prisma.sourceAsset.deleteMany({ where: inSnap });
    for (const s of await prisma.sourceSection.findMany({ where: inSnap, select: { id: true }, orderBy: { ordinal: "desc" } })) await prisma.sourceSection.delete({ where: { id: s.id } });
    await prisma.sourceSnapshotIngestion.deleteMany({ where: inSnap });
    await prisma.sourceSnapshot.deleteMany({ where: { id: { in: snaps } } });
    await prisma.sourceDocument.deleteMany({ where: { id: { in: docs } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: PREFIX } } });
  }, 120_000);

  it("§4 / §5 source snapshots and structure are readable (outline + per-section content, never the whole flow at once)", async () => {
    const { documentId, snapshotId } = await apiSnapshot("structure");
    const list = await call(R.SourceSnapshots.GET, "GET", `/api/import/source-snapshots?sourceDocumentId=${documentId}`);
    expect(list.status).toBe(200);
    expect(list.body.pagination).toMatchObject({ page: 1, total: 1 });
    expect((await call(R.SourceSnapshotsItem.GET, "GET", "/x", { snapshotId })).data).toMatchObject({ id: snapshotId, declaredVersion: "V0.1", pageCount: null });
    const outline = await call(R.SourceSnapshotsStructure.GET, "GET", "/x", { snapshotId });
    expect(outline.data).toMatchObject({ snapshot: { id: snapshotId }, ingestion: { parserName: "test-structure" }, assetCount: 1, contentNodeCount: 6 });
    expect(outline.data.sections.map((s: { title: string }) => s.title)).toEqual(["Spellcasting", "Costs"]);
    expect(outline.data.nodes).toBeUndefined();
    const [rules, costs] = outline.data.sections as Array<{ id: string }>;
    expect((await call(R.SourceSectionsItem.GET, "GET", "/x", { sectionId: rules!.id })).data.title).toBe("Spellcasting");
    expect((await call(R.SourceSectionsChildren.GET, "GET", "/x", { sectionId: rules!.id })).data.map((s: { id: string }) => s.id)).toEqual([costs!.id]);
    const contents = await call(R.SourceSectionsContents.GET, "GET", "/x?pageSize=2", { sectionId: costs!.id });
    expect(contents.body.pagination).toMatchObject({ pageSize: 2, total: 5, totalPages: 3 });
    const all = (await call(R.SourceSectionsContents.GET, "GET", "/x?pageSize=100", { sectionId: costs!.id })).data as Array<{ nodeType: string; block?: { id: string }; table?: { id: string }; asset?: { id: string } }>;
    expect((await call(R.SourceBlocksItem.GET, "GET", "/x", { blockId: all[1]!.block!.id })).data.rawText).toBe("Formula: Spell AP = floor(Final MP / PRO), minimum 1");
    expect((await call(R.SourceTablesItem.GET, "GET", "/x", { tableId: all.find((n) => n.nodeType === "TABLE")!.table!.id })).data.structure.rowCount).toBe(1);
    expect((await call(R.SourceAssetsItem.GET, "GET", "/x", { assetId: all.find((n) => n.nodeType === "ASSET_PLACEMENT")!.asset!.id })).data.mimeType).toBe("image/png");
    expect((await call(R.SourceSnapshots.GET, "GET", "/api/import/source-snapshots")).body.error).toMatchObject({ code: "API.INVALID_QUERY", field: "sourceDocumentId" });
  });

  it("§46 semantic flow: batch -> extract -> candidates -> APPROVE_SEMANTIC -> complete; no definitions are created", async () => {
    const { snapshotId } = await apiSnapshot("semantic");
    const created = await call(R.Batches.POST, "POST", "/api/import/batches", {}, { sourceSnapshotId: snapshotId, label: "Semantic", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.semantic-foundation", extractorVersion: "1" });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ created: true, batch: { status: "CREATED", extractionOutputHash: null, scopeSectionId: null } });
    const again = await call(R.Batches.POST, "POST", "/api/import/batches", {}, { sourceSnapshotId: snapshotId, label: "Renamed", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.semantic-foundation", extractorVersion: "1" });
    expect(again.status).toBe(200);
    const batchId = created.data.batch.id as string;
    expect((await call(R.Batches.GET, "GET", `/api/import/batches?sourceSnapshotId=${snapshotId}`)).data.map((b: { id: string }) => b.id)).toEqual([batchId]);

    const extracted = await call(R.BatchesExtract.POST, "POST", "", { batchId });
    expect(extracted.status).toBe(200);
    expect(extracted.data).toMatchObject({ alreadyExtracted: false, candidateCount: 3, batch: { status: "READY_FOR_REVIEW" } });
    expect(extracted.data.batch.extractedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((await call(R.BatchesExtractionResult.GET, "GET", "/x", { batchId })).data.extractionOutputHash).toBe(extracted.data.extractionOutputHash);
    expect((await call(R.BatchesVerifyExtraction.GET, "GET", "/x", { batchId })).data).toMatchObject({ persistedSetMatches: true, extractorOutputMatches: true });
    expect((await call(R.BatchesSummary.GET, "GET", "/x", { batchId })).data).toMatchObject({ candidateCount: 3, byKind: { FORMULA: 1, KEYWORD: 2 } });

    const page1 = await call(R.BatchesCandidates.GET, "GET", "/x?pageSize=2", { batchId });
    expect(page1.body.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const candidates = (await call(R.BatchesCandidates.GET, "GET", "/x", { batchId })).data as Array<{ id: string; candidateFingerprint: string; candidateKind: string; payload: Record<string, unknown> }>;
    expect(candidates.map((c) => c.candidateKind)).toEqual(["FORMULA", "KEYWORD", "KEYWORD"]);
    expect(candidates[0]!.payload).toMatchObject({ leftHandText: "Spell AP", expressionText: "floor(Final MP / PRO)", qualifiers: ["minimum 1"] });
    expect((await call(R.CandidatesItem.GET, "GET", "/x", { candidateId: candidates[1]!.id })).data.displayLabel).toBe("Cost");

    const keywordDefinitions = await prisma.keywordDefinition.count();
    for (const c of candidates) expect((await decide(c, { decisionType: "APPROVE_SEMANTIC" })).status).toBe(201);
    expect((await call(R.BatchesReviewSummary.GET, "GET", "/x", { batchId })).data).toMatchObject({ totalCandidates: 3, decisionCount: 3, byStatus: { APPROVED: 3 }, potentialConflictCount: null });
    expect((await call(R.BatchesDecisions.GET, "GET", "/x", { batchId })).body.pagination).toMatchObject({ total: 3 });
    const completed = await call(R.BatchesCompleteReview.POST, "POST", "", { batchId });
    expect(completed.status).toBe(200);
    expect(completed.data.status).toBe("COMPLETED");
    expect((await call(R.BatchesItem.GET, "GET", "/x", { batchId })).data).toMatchObject({ status: "COMPLETED", summary: { byStatus: { APPROVED: 3 } } });
    expect(await prisma.keywordDefinition.count()).toBe(keywordDefinitions);
  });

  it("§45 / §47–§53 entity flow: match, assess, conflicts, classify / approve, manual override, invalid transition, wrong run, completion", async () => {
    const { snapshotId } = await apiSnapshot("entity");
    const batch = await apiBatch(snapshotId, "prowess.test-entities", "1");
    await seedEntityExtraction(batch.id, snapshotId, [
      { label: "Alpha", type: "RESOURCE", key: `${PREFIX}.alpha`, payload: { name: "Alpha" } },
      { label: "Bolt", type: "SPELL_EFFECT", key: `${PREFIX}.bolt`, payload: { cost: 4 } },
      { label: "Bolt (alt)", type: "SPELL_EFFECT", key: `${PREFIX}.bolt`, payload: { cost: 6 } },
      { label: "Mystery", type: "RESOURCE", key: null, payload: {} },
      { label: "Fresh", type: "RESOURCE", key: null, payload: {} },
    ]);
    const run = await call(R.BatchesMatchRuns.POST, "POST", "", { batchId: batch.id }, {});
    expect(run.status).toBe(201);
    expect((await call(R.BatchesMatchRuns.POST, "POST", "", { batchId: batch.id }, {})).status).toBe(200); // identical context
    const runId = run.data.run.id as string;
    expect((await call(R.BatchesMatchRuns.GET, "GET", "/x", { batchId: batch.id })).data.map((r: { id: string }) => r.id)).toEqual([runId]);
    expect((await call(R.MatchRunsItem.GET, "GET", "/x", { matchRunId: runId })).data).toMatchObject({ assessmentCount: 5, matcherKey: "prowess.entity-matcher" });
    expect((await call(R.MatchRunsAssessments.GET, "GET", "/x?pageSize=2", { matchRunId: runId })).body.pagination).toMatchObject({ total: 5 });
    const candidates = (await call(R.BatchesCandidates.GET, "GET", "/x", { batchId: batch.id })).data as Array<{ id: string; candidateFingerprint: string }>;
    const [alpha, bolt, , mystery, fresh] = candidates;
    const assessment = await call(R.MatchRunsCandidatesAssessment.GET, "GET", "/x", { matchRunId: runId, candidateId: alpha!.id });
    expect(assessment.data).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: e1.id, matchedBy: "CANONICAL_KEY_EXACT" });
    expect((await call(R.MatchRunsDuplicateGroups.GET, "GET", "/x", { matchRunId: runId })).data.length).toBe(1);

    const conflicts = await call(R.BatchesConflicts.GET, "GET", `/x?matchRunId=${runId}`, { batchId: batch.id });
    expect(conflicts.data).toMatchObject([{ type: "POTENTIAL_CONTENT_CONFLICT", candidateIds: [bolt!.id, candidates[2]!.id] }]);
    expect(await prisma.extractionCandidate.count({ where: { importBatchId: batch.id, status: { not: "UNREVIEWED" } } })).toBe(0); // §50 statuses unchanged

    const entities = await fingerprint(["entities", "entity_versions", "entity_aliases"]);
    const classify = await decide(alpha!, { decisionType: "CLASSIFY_MATCHED", matchBasis: "EXACT_MATCH", targetEntityId: e1.id, matchRunId: runId, matchAssessmentId: assessment.data.id });
    expect(classify.status).toBe(201);
    expect(classify.data).toMatchObject({ created: true, decision: { sequenceNumber: 1, toStatus: "MATCHED" } });
    expect((await decide(alpha!, { decisionType: "APPROVE_MATCHED", targetEntityId: e1.id })).data.decision.toStatus).toBe("APPROVED");
    const history = await call(R.CandidatesDecisions.GET, "GET", "/x", { candidateId: alpha!.id });
    expect(history.data.map((d: { decisionType: string }) => d.decisionType)).toEqual(["CLASSIFY_MATCHED", "APPROVE_MATCHED"]);
    expect((await call(R.DecisionsItem.GET, "GET", "/x", { decisionId: history.data[0].id })).data.id).toBe(history.data[0].id);
    expect(await fingerprint(["entities", "entity_versions", "entity_aliases"])).toEqual(entities); // §47 E1 unchanged

    const noRationale = await decide(mystery!, { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: e1.id });
    expect([noRationale.status, noRationale.body.error?.code]).toEqual([400, "IMPORT_DECISION.MANUAL_RATIONALE_REQUIRED"]);
    expect((await decide(mystery!, { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: e1.id, rationale: "Known alias." })).status).toBe(201); // §48

    const direct = await decide(fresh!, { decisionType: "APPROVE_NEW_ENTITY" });
    expect([direct.status, direct.body.error?.code]).toEqual([409, "IMPORT_DECISION.INVALID_TRANSITION"]); // §49

    const other = await apiSnapshot("entity-other");
    const otherBatch = await apiBatch(other.snapshotId, "prowess.test-entities", "1");
    await seedEntityExtraction(otherBatch.id, other.snapshotId, [{ label: "Alpha", type: "RESOURCE", key: `${PREFIX}.alpha`, payload: {} }]);
    const otherRun = (await call(R.BatchesMatchRuns.POST, "POST", "", { batchId: otherBatch.id }, {})).data.run.id;
    const before = await fingerprint(["import_decisions", "extraction_candidates"]);
    const wrongRun = await decide(fresh!, { decisionType: "CLASSIFY_NEW_ENTITY", matchRunId: otherRun });
    expect([wrongRun.status, wrongRun.body.error?.code]).toEqual([400, "IMPORT_DECISION.MATCH_RUN_MISMATCH"]); // §51
    expect(await fingerprint(["import_decisions", "extraction_candidates"])).toEqual(before);

    const early = await call(R.BatchesCompleteReview.POST, "POST", "", { batchId: batch.id });
    expect([early.status, early.body.error?.code]).toEqual([409, "IMPORT_REVIEW.INCOMPLETE"]); // §52
    expect((await call(R.BatchesReviewSummary.GET, "GET", `/x?matchRunId=${runId}`, { batchId: batch.id })).data.potentialConflictCount).toBe(1);
    for (const c of [bolt!, candidates[2]!, fresh!]) await decide(c, { decisionType: "REJECT", rationale: "out of scope" });
    await decide(mystery!, { decisionType: "APPROVE_MATCHED", targetEntityId: e1.id });
    expect((await call(R.BatchesCompleteReview.POST, "POST", "", { batchId: batch.id })).data.status).toBe("COMPLETED"); // §53
  });

  it("§54 every read route is read-only", async () => {
    const { snapshotId } = await apiSnapshot("readonly");
    const batch = await apiBatch(snapshotId);
    await call(R.BatchesExtract.POST, "POST", "", { batchId: batch.id });
    const run = (await call(R.BatchesMatchRuns.POST, "POST", "", { batchId: batch.id }, {})).data.run.id;
    const [candidate] = (await call(R.BatchesCandidates.GET, "GET", "/x", { batchId: batch.id })).data as Array<{ id: string; candidateFingerprint: string }>;
    const decision = (await decide(candidate!, { decisionType: "APPROVE_SEMANTIC" })).data.decision.id;
    const structure = (await call(R.SourceSnapshotsStructure.GET, "GET", "/x", { snapshotId })).data;
    const sectionId = structure.sections[1].id;
    const tables = await allTables();
    const before = await fingerprint(tables);
    const reads: Array<[unknown, Record<string, string>, string]> = [
      [R.SourceSnapshotsItem.GET, { snapshotId }, "/x"], [R.SourceSnapshotsStructure.GET, { snapshotId }, "/x"], [R.SourceSectionsItem.GET, { sectionId }, "/x"],
      [R.SourceSectionsChildren.GET, { sectionId }, "/x"], [R.SourceSectionsContents.GET, { sectionId }, "/x"], [R.BatchesItem.GET, { batchId: batch.id }, "/x"],
      [R.BatchesExtractionResult.GET, { batchId: batch.id }, "/x"], [R.BatchesVerifyExtraction.GET, { batchId: batch.id }, "/x"], [R.BatchesCandidates.GET, { batchId: batch.id }, "/x"],
      [R.CandidatesItem.GET, { candidateId: candidate!.id }, "/x"], [R.BatchesSummary.GET, { batchId: batch.id }, "/x"], [R.BatchesMatchRuns.GET, { batchId: batch.id }, "/x"],
      [R.MatchRunsItem.GET, { matchRunId: run }, "/x"], [R.MatchRunsAssessments.GET, { matchRunId: run }, "/x"], [R.MatchRunsDuplicateGroups.GET, { matchRunId: run }, "/x"],
      [R.MatchRunsCandidatesAssessment.GET, { matchRunId: run, candidateId: candidate!.id }, "/x"], [R.BatchesConflicts.GET, { batchId: batch.id }, `/x?matchRunId=${run}`],
      [R.BatchesReviewSummary.GET, { batchId: batch.id }, "/x"], [R.BatchesDecisions.GET, { batchId: batch.id }, "/x"], [R.CandidatesDecisions.GET, { candidateId: candidate!.id }, "/x"],
      [R.DecisionsItem.GET, { decisionId: decision }, "/x"],
    ];
    for (const [handler, params, path] of reads) expect((await call(handler, "GET", path, params)).status, path).toBe(200);
    expect(await fingerprint(tables)).toEqual(before);
  });

  it("§55–§58 strict input: smuggled server fields, malformed UUIDs, unknown queries and malformed JSON are controlled 400s", async () => {
    const { snapshotId } = await apiSnapshot("strict");
    const smuggled = await call(R.Batches.POST, "POST", "", {}, { sourceSnapshotId: snapshotId, label: "x", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1", status: "COMPLETED" });
    expect([smuggled.status, smuggled.body.error?.code, smuggled.body.error?.field]).toEqual([400, "API.INVALID_BODY", "status"]);
    for (const field of ["batchFingerprint", "sourceStructureHash", "extractionOutputHash", "extractedAt"]) {
      expect((await call(R.Batches.POST, "POST", "", {}, { sourceSnapshotId: snapshotId, label: "x", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1", [field]: "x" })).body.error?.code, field).toBe("API.INVALID_BODY");
    }
    const batch = await apiBatch(snapshotId);
    expect((await call(R.BatchesExtract.POST, "POST", "", { batchId: batch.id }, { extractorVersion: "2" })).body.error).toMatchObject({ code: "API.INVALID_BODY", field: "extractorVersion" });
    await call(R.BatchesExtract.POST, "POST", "", { batchId: batch.id });
    const [c] = (await call(R.BatchesCandidates.GET, "GET", "/x", { batchId: batch.id })).data as Array<{ id: string; candidateFingerprint: string }>;
    for (const field of ["sequenceNumber", "decisionFingerprint", "fromStatus", "toStatus", "candidateSetHash", "createdAt", "status"]) {
      expect((await decide(c!, { decisionType: "APPROVE_SEMANTIC", [field]: 1 })).body.error, field).toMatchObject({ code: "API.INVALID_BODY", field });
    }
    expect((await call(R.BatchesMatchRuns.POST, "POST", "", { batchId: batch.id }, { comparisonManifestId: MISSING })).body.error).toMatchObject({ code: "API.INVALID_BODY", field: "comparisonManifestId" });
    expect((await call(R.BatchesItem.GET, "GET", "/x", { batchId: "not-a-uuid" })).body.error).toMatchObject({ code: "API.INVALID_UUID", field: "batchId" });
    expect((await call(R.BatchesCandidates.GET, "GET", "/x?statuz=APPROVED", { batchId: batch.id })).body.error).toMatchObject({ code: "API.INVALID_QUERY", field: "statuz" });
    expect((await call(R.BatchesConflicts.GET, "GET", "/x", { batchId: batch.id })).body.error).toMatchObject({ code: "API.INVALID_QUERY", field: "matchRunId" });
    const malformed = await call(R.Batches.POST, "POST", "", {}, "{ not json");
    expect([malformed.status, malformed.body.error?.code]).toEqual([400, "API.INVALID_BODY"]);
    expect(JSON.stringify(malformed.body)).not.toMatch(/SyntaxError|Unexpected token|at /);
    expect((await call(R.BatchesCompleteReview.POST, "POST", "", { batchId: batch.id }, "{ not json")).body.error?.code).toBe("API.INVALID_BODY");
  });

  it("§60 representative status mappings: 404 addressed / 400 referenced / 409 state", async () => {
    const cases: Array<[unknown, Record<string, string>, number, string]> = [
      [R.BatchesItem.GET, { batchId: MISSING }, 404, "IMPORT_BATCH.NOT_FOUND"],
      [R.CandidatesItem.GET, { candidateId: MISSING }, 404, "EXTRACTION_CANDIDATE.NOT_FOUND"],
      [R.MatchRunsItem.GET, { matchRunId: MISSING }, 404, "IMPORT_MATCH.NOT_FOUND"],
      [R.DecisionsItem.GET, { decisionId: MISSING }, 404, "IMPORT_DECISION.NOT_FOUND"],
      [R.SourceSnapshotsItem.GET, { snapshotId: MISSING }, 404, "SOURCE_SNAPSHOT.NOT_FOUND"],
      [R.BatchesExtractionResult.GET, { batchId: MISSING }, 404, "IMPORT_BATCH.NOT_FOUND"],
    ];
    for (const [handler, params, status, code] of cases) {
      const r = await call(handler, "GET", "/x", params);
      expect([r.status, r.body.error?.code], code).toEqual([status, code]);
      expect(JSON.stringify(r.body)).not.toMatch(LEAK);
    }
    const referenced = await call(R.Batches.POST, "POST", "", {}, { sourceSnapshotId: MISSING, label: "x", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1" });
    expect([referenced.status, referenced.body.error?.code]).toEqual([400, "IMPORT_BATCH.SOURCE_SNAPSHOT_NOT_FOUND"]);
    const { snapshotId } = await apiSnapshot("status");
    const batch = await apiBatch(snapshotId);
    expect((await call(R.BatchesCompleteReview.POST, "POST", "", { batchId: batch.id })).status).toBe(409);
    expect((await call(R.BatchesExtractionResult.GET, "GET", "/x", { batchId: batch.id })).body.error?.code).toBe("IMPORT_BATCH.NOT_EXTRACTED");
  });

  it("§31 / §32 / §59 an unexpected server error fails closed: opaque 500, nothing internal leaks", async () => {
    vi.resetModules();
    vi.doMock("@prowess/db", async (original) => ({
      ...(await original<typeof import("@prowess/db")>()),
      getImportBatch: async () => {
        throw new Error("boom at /home/runner/work/db.ts:12 postgres://user:password@host/db P2003 SELECT * FROM import_batches\n    at Object.<anonymous> (/home/runner/x.ts:1:1)");
      },
    }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { GET } = await import("../../app/api/import/batches/[batchId]/route");
    const r = await call(GET, "GET", "/x", { batchId: MISSING });
    expect(r.status).toBe(500);
    expect(r.body.error?.code).toBe("INTERNAL.UNEXPECTED_ERROR");
    expect(JSON.stringify(r.body)).not.toMatch(/boom|runner|postgres|password|P2003|SELECT|at Object/);
    spy.mockRestore();
    vi.doUnmock("@prowess/db");
  });
});
