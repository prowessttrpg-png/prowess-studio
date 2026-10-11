/**
 * M3-WO10 §46 / §47 — condensed Golden lifecycle through the REAL /api/import route handlers, then HTTP historical
 * reproducibility: after later activity, the old Snapshot, Batch, Candidates, MatchRun and decision history are
 * re-fetched and must still describe the original state and evidence (M3-I16), plus representative error classes.
 */
import { createHash } from "node:crypto";
import { assertRunningAgainstTestDatabase, createEntity, createEntityAlias, createEntityVersion, createSourceDocument, ingestSourceStructure, prisma } from "@prowess/db";
import type { SourceStructureInput } from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "./m2-api-harness";
import * as R from "./m3-import-routes";

const STAMP = Date.now();
const DOC = `M3 final API ${STAMP}`;
const PREFIX = `test.m3finalapi${STAMP}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const structure = (extra: string): SourceStructureInput => ({
  parserName: "test-structure",
  parserVersion: "1",
  sections: [{ key: "a", parentKey: null, title: "Golden Costs", headingLevel: 1, ordinal: 0, pageLocationBasis: "UNAVAILABLE" }],
  assets: [],
  nodes: [
    { ordinal: 0, sectionKey: "a", nodeType: "BLOCK", block: { blockType: "HEADING", rawText: "Golden Costs", pageLocationBasis: "UNAVAILABLE" } },
    { ordinal: 1, sectionKey: "a", nodeType: "BLOCK", block: { blockType: "PARAGRAPH", rawText: `Spell AP = floor(Total MP / PRO), minimum 1.${extra}`, pageLocationBasis: "UNAVAILABLE" } },
    { ordinal: 2, sectionKey: "a", nodeType: "BLOCK", block: { blockType: "PARAGRAPH", rawText: "Keywords: Damage, Fire", pageLocationBasis: "UNAVAILABLE" } },
  ],
});

async function snapshot(documentId: string, label: string, extra: string) {
  const r = await call(R.SourceSnapshots.POST, "POST", "", {}, { sourceDocumentId: documentId, label, originalFilename: `${label}.docx`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", contentHash: sha(`${label}${STAMP}`), byteSize: 10 });
  await ingestSourceStructure(r.data.id, structure(extra));
  return r.data.id as string;
}
async function lifecycle(snapshotId: string) {
  const batchId = (await call(R.Batches.POST, "POST", "", {}, { sourceSnapshotId: snapshotId, label: "golden", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.semantic-foundation", extractorVersion: "1" })).data.batch.id as string;
  await call(R.BatchesExtract.POST, "POST", "", { batchId });
  const runId = (await call(R.BatchesMatchRuns.POST, "POST", "", { batchId }, {})).data.run.id as string;
  return { batchId, runId };
}
const read = async (snapshotId: string, batchId: string, runId: string) => {
  const candidates = (await call(R.BatchesCandidates.GET, "GET", "/x", { batchId })).data as Array<{ id: string }>;
  return {
    snapshot: (await call(R.SourceSnapshotsItem.GET, "GET", "/x", { snapshotId })).data,
    structure: (await call(R.SourceSnapshotsStructure.GET, "GET", "/x", { snapshotId })).data,
    batch: (await call(R.BatchesItem.GET, "GET", "/x", { batchId })).data,
    candidates,
    run: (await call(R.MatchRunsItem.GET, "GET", "/x", { matchRunId: runId })).data,
    assessments: (await call(R.MatchRunsAssessments.GET, "GET", "/x", { matchRunId: runId })).data,
    decisions: (await call(R.BatchesDecisions.GET, "GET", "/x", { batchId })).data,
    history: await Promise.all(candidates.map(async (c) => (await call(R.CandidatesDecisions.GET, "GET", "/x", { candidateId: c.id })).data)),
  };
};

describe("M3-WO10 HTTP historical reproducibility (prowess_studio_test only)", () => {
  let documentId = "";
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
    documentId = (await createSourceDocument({ title: DOC, sourceType: "DOCUMENT" })).id;
  });
  afterAll(async () => {
    const snaps = (await prisma.sourceSnapshot.findMany({ where: { sourceDocumentId: documentId }, select: { id: true } })).map((s) => s.id);
    const batches = (await prisma.importBatch.findMany({ where: { sourceSnapshotId: { in: snaps } }, select: { id: true } })).map((b) => b.id);
    const inBatch = { importBatchId: { in: batches } };
    await prisma.importDecision.deleteMany({ where: inBatch });
    await prisma.candidateMatchSuggestion.deleteMany({ where: { assessment: inBatch } });
    await prisma.candidateMatchAssessment.deleteMany({ where: inBatch });
    await prisma.importMatchRun.deleteMany({ where: inBatch });
    const inSnap = { sourceSnapshotId: { in: snaps } };
    await prisma.extractionCandidateSource.deleteMany({ where: inSnap });
    await prisma.extractionCandidate.deleteMany({ where: inSnap });
    await prisma.importBatch.deleteMany({ where: inSnap });
    await prisma.sourceContentNode.deleteMany({ where: inSnap });
    await prisma.sourceBlock.deleteMany({ where: inSnap });
    await prisma.sourceSection.deleteMany({ where: inSnap });
    await prisma.sourceSnapshotIngestion.deleteMany({ where: inSnap });
    await prisma.sourceSnapshot.deleteMany({ where: { id: { in: snaps } } });
    await prisma.sourceDocument.deleteMany({ where: { id: documentId } });
    await prisma.entityAlias.deleteMany({ where: { entity: { canonicalKey: { startsWith: PREFIX } } } });
    await prisma.entityVersion.deleteMany({ where: { entity: { canonicalKey: { startsWith: PREFIX } } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: PREFIX } } });
    expect(await prisma.sourceDocument.count({ where: { title: DOC } })).toBe(0);
  }, 120_000);

  it("old Snapshot / Batch / Candidates / MatchRun / decisions still describe the original state after later activity", async () => {
    const s1 = await snapshot(documentId, "s1", "");
    const { batchId, runId } = await lifecycle(s1);
    const candidates = (await call(R.BatchesCandidates.GET, "GET", "/x", { batchId })).data as Array<{ id: string; candidateFingerprint: string; candidateKind: string }>;
    const decide = (c: { id: string; candidateFingerprint: string }, body: Record<string, unknown>) => call(R.CandidatesDecisions.POST, "POST", "", { candidateId: c.id }, { candidateFingerprint: c.candidateFingerprint, ...body });
    expect((await decide(candidates[0]!, { decisionType: "APPROVE_SEMANTIC" })).status).toBe(201);
    const early = await call(R.BatchesCompleteReview.POST, "POST", "", { batchId });
    expect([early.status, early.body.error?.code]).toEqual([409, "IMPORT_REVIEW.INCOMPLETE"]);
    for (const c of candidates.slice(1)) expect((await decide(c, { decisionType: "REJECT", rationale: "golden audit" })).status).toBe(201);
    expect((await call(R.BatchesCompleteReview.POST, "POST", "", { batchId })).data.status).toBe("COMPLETED");
    const before = await read(s1, batchId, runId);

    // later activity: another Snapshot / Batch / extraction / MatchRun, a later Version and Alias
    const s2 = await snapshot(documentId, "s2", " Revised.");
    await lifecycle(s2);
    const e = await createEntity({ entityType: "RESOURCE", canonicalKey: `${PREFIX}.later` });
    await createEntityVersion(e.id, { displayName: "Later" });
    await createEntityAlias(e.id, { alias: "Damage" });
    const later = await call(R.CandidatesDecisions.POST, "POST", "", { candidateId: candidates[0]!.id }, { candidateFingerprint: candidates[0]!.candidateFingerprint, decisionType: "REJECT", rationale: "x" });
    expect([later.status, later.body.error?.code]).toEqual([409, "IMPORT_REVIEW.NOT_READY"]); // completed is read-only

    expect(await read(s1, batchId, runId)).toEqual(before);
    expect(before.batch).toMatchObject({ sourceSnapshotId: s1, status: "COMPLETED" });
    expect(before.history.map((h) => (h as unknown[]).length)).toEqual(candidates.map(() => 1));
  });

  it("§47 representative error classes stay strict and fail closed", async () => {
    const cases: Array<[number, string, Promise<{ status: number; body: { error?: { code: string } } }>]> = [
      [400, "API.INVALID_BODY", call(R.Batches.POST, "POST", "", {}, { sourceSnapshotId: "00000000-0000-4000-8000-000000000000", label: "x", scope: { type: "SNAPSHOT" }, extractorKey: "k", extractorVersion: "1", status: "COMPLETED" })],
      [400, "API.INVALID_UUID", call(R.BatchesItem.GET, "GET", "/x", { batchId: "nope" })],
      [400, "API.INVALID_QUERY", call(R.Batches.GET, "GET", "/x?latest=true")],
      [400, "API.INVALID_BODY", call(R.Batches.POST, "POST", "", {}, "{ not json")],
      [404, "IMPORT_BATCH.NOT_FOUND", call(R.BatchesItem.GET, "GET", "/x", { batchId: "00000000-0000-4000-8000-000000000000" })],
      [404, "IMPORT_DECISION.CANDIDATE_NOT_FOUND", call(R.CandidatesDecisions.POST, "POST", "", { candidateId: "00000000-0000-4000-8000-000000000000" }, { candidateFingerprint: "a".repeat(64), decisionType: "APPROVE_SEMANTIC" })],
    ];
    for (const [status, code, p] of cases) {
      const r = await p;
      expect([r.status, r.body.error?.code], code).toEqual([status, code]);
      expect(JSON.stringify(r.body)).not.toMatch(/prisma|P20\d\d|select |postgres|\/home\/|at \w+ \(/i);
    }
  });
});
