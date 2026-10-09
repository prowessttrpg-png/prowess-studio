/**
 * M3-WO2 — Import Batch & Extraction Candidate Foundation, database integration (prowess_studio_test only, guarded).
 * Uses WO1's deterministic SYNTHETIC DOCX fixtures; never the real Playtest Packet. Describe blocks are numbered by
 * the Work Order's test sections (§55–§77).
 */
import {
  DomainError,
  EXTRACTION_CANDIDATE_ERROR_CODES,
  IMPORT_BATCH_ERROR_CODES,
  type CreateExtractionCandidateInput,
  type CreateImportBatchInput,
  type SourceStructure,
} from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createImportBatch,
  createRuleset,
  createRulesetManifest,
  createSourceDocument,
  createSourceSnapshot,
  DOCX_MIME_TYPE,
  getExtractionCandidate,
  getImportBatch,
  getImportBatchSummary,
  getSourceStructure,
  ingestSourceSnapshot,
  listExtractionCandidates,
  listImportBatches,
  prisma,
  recordExtractionCandidates,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { docx, IMPORT_SCOPE } from "../fixtures/prowess-structure-fixtures";
import { getTestDatabaseUrl } from "./env";
import { cleanupM2GoldenHistories } from "./fixtures/m2-golden-history";

const STAMP = Date.now();
const PREFIX = `test.m3import.${STAMP}`;
const DOC_PREFIX = `M3I ${STAMP} `;
let n = 0;
const k = (s: string) => `${PREFIX}.${s}_${++n}`;
const IMPORT_TABLES = ["import_batches", "extraction_candidates", "extraction_candidate_sources"];

async function expectCode(promise: Promise<unknown>, code: string, label?: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, label).toBeInstanceOf(DomainError);
  expect((error as DomainError).code, label).toBe(code);
}
async function expectDbRejects(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, "the database must reject this write").not.toBeNull();
  expect(error).not.toBeInstanceOf(DomainError);
  expect(String((error as Error).message) + JSON.stringify((error as { meta?: unknown }).meta ?? null)).toMatch(pattern);
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

interface Fixture {
  structure: SourceStructure;
  section: (title: string) => string;
  node: (startsWith: string) => string;
}
async function ingested(label: string, doc = IMPORT_SCOPE, version = "V0.1", documentId?: string): Promise<Fixture & { documentId: string }> {
  const id = documentId ?? (await createSourceDocument({ title: `${DOC_PREFIX}${label}`, sourceType: "DOCUMENT" })).id;
  const { snapshot } = await ingestSourceSnapshot(id, docx(doc), { label: version, originalFilename: `${label}.docx`, mimeType: DOCX_MIME_TYPE });
  const structure = await getSourceStructure(snapshot.id);
  return {
    documentId: id,
    structure,
    section: (title) => structure.sections.find((s) => s.title === title)!.id,
    node: (startsWith) =>
      structure.nodes.find((x) => (x.nodeType === "BLOCK" ? x.block.rawText.startsWith(startsWith) : x.nodeType === "TABLE" ? (x.table.rawText ?? "").startsWith(startsWith) : false))!.id,
  };
}
const batchInput = (snapshotId: string, over: Partial<CreateImportBatchInput> = {}): CreateImportBatchInput => ({
  sourceSnapshotId: snapshotId,
  label: "Foundation batch",
  scope: { type: "SNAPSHOT" },
  extractorKey: "manual-foundation",
  extractorVersion: "1.0",
  ...over,
});
const cand = (ordinal: number, primary: { sectionId?: string; contentNodeId?: string }, over: Partial<CreateExtractionCandidateInput> = {}): CreateExtractionCandidateInput => ({
  ordinal,
  candidateKind: "ENTITY",
  displayLabel: `Candidate ${ordinal}`,
  confidence: "HIGH",
  payloadSchemaKey: "prowess.test.generic",
  payloadSchemaVersion: 1,
  payloadJson: { name: "Arcana", rank: "Expert" },
  primarySourceAnchor: primary,
  ...over,
});
const countFor = async (importBatchId: string) => ({
  candidates: await prisma.extractionCandidate.count({ where: { importBatchId } }),
  sources: await prisma.extractionCandidateSource.count({ where: { extractionCandidate: { importBatchId } } }),
});

describe("M3-WO2 import batches & extraction candidates (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    const docs = (await prisma.sourceDocument.findMany({ where: { title: { startsWith: DOC_PREFIX } }, select: { id: true } })).map((d) => d.id);
    const snaps = (await prisma.sourceSnapshot.findMany({ where: { sourceDocumentId: { in: docs } }, select: { id: true } })).map((s) => s.id);
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
    await cleanupM2GoldenHistories(PREFIX);
  }, 120_000);

  describe("§55 whole-Snapshot Batch", () => {
    it("pins the Snapshot and its exact WO1 structure hash, has no scope section, and is CREATED", async () => {
      const f = await ingested("snapshot-batch");
      const { batch, created } = await createImportBatch(batchInput(f.structure.snapshot.id, { description: "all of it" }));
      expect(created).toBe(true);
      expect(batch).toMatchObject({ sourceSnapshotId: f.structure.snapshot.id, sourceStructureHash: f.structure.ingestion!.structureHash, scopeType: "SNAPSHOT", scopeSectionId: null, reviewRulesetId: null, comparisonManifestId: null, extractorKey: "manual-foundation", extractorVersion: "1.0", extractorConfigHash: null, status: "CREATED", description: "all of it" });
      expect(batch.batchFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(await getImportBatch(batch.id)).toMatchObject({ ...batch, summary: { candidateCount: 0 } });
      expect((await listImportBatches({ sourceSnapshotId: f.structure.snapshot.id })).map((b) => b.id)).toEqual([batch.id]);
    });
  });

  describe("§56 / §57 section-subtree scope", () => {
    it("the root section, its descendants and their content are valid anchors", async () => {
      const f = await ingested("subtree");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id, { scope: { type: "SECTION_SUBTREE", sectionId: f.section("Spellcasting") } }));
      expect(batch.scopeSectionId).toBe(f.section("Spellcasting"));
      const r = await recordExtractionCandidates(batch.id, [
        cand(1, { sectionId: f.section("Spellcasting") }),
        cand(2, { sectionId: f.section("Targeting") }),
        cand(3, { contentNodeId: f.node("Damage equals") }),
        cand(4, { contentNodeId: f.node("Tier\tMP") }),
      ]);
      expect(r.createdCount).toBe(4);
    });

    it("an anchor in another chapter is OUTSIDE_BATCH_SCOPE and nothing of the call persists", async () => {
      const f = await ingested("outside");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id, { scope: { type: "SECTION_SUBTREE", sectionId: f.section("Spellcasting") } }));
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { sectionId: f.section("Targeting") }), cand(2, { sectionId: f.section("Skills") })]), EXTRACTION_CANDIDATE_ERROR_CODES.OUTSIDE_BATCH_SCOPE);
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { contentNodeId: f.node("Arcana covers") })]), EXTRACTION_CANDIDATE_ERROR_CODES.OUTSIDE_BATCH_SCOPE);
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { contentNodeId: f.node("Preface") })]), EXTRACTION_CANDIDATE_ERROR_CODES.OUTSIDE_BATCH_SCOPE, "content before any heading is outside every subtree");
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { sectionId: f.section("Effects") }, { supportingSourceAnchors: [{ sectionId: f.section("Arcana") }] })]), EXTRACTION_CANDIDATE_ERROR_CODES.OUTSIDE_BATCH_SCOPE, "supporting anchors too");
      expect(await countFor(batch.id)).toEqual({ candidates: 0, sources: 0 });
    });

    it("scope shape is validated: SNAPSHOT + section, SUBTREE without section, unknown or foreign section are INVALID_SCOPE", async () => {
      const f = await ingested("scope-shape");
      const g = await ingested("scope-shape-other");
      const s = f.structure.snapshot.id;
      await expectCode(createImportBatch(batchInput(s, { scope: { type: "SNAPSHOT", sectionId: f.section("Skills") } })), IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE);
      await expectCode(createImportBatch(batchInput(s, { scope: { type: "SECTION_SUBTREE" } })), IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE);
      await expectCode(createImportBatch(batchInput(s, { scope: { type: "SECTION_SUBTREE", sectionId: "00000000-0000-4000-8000-000000000000" } })), IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE);
      await expectCode(createImportBatch(batchInput(s, { scope: { type: "MULTI" as never } })), IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE);
      await expectCode(createImportBatch(batchInput(s, { scope: { type: "SECTION_SUBTREE", sectionId: g.section("Skills") } })), IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE, "§58 a section of another Snapshot");
    });
  });

  describe("§58 / §76 cross-Snapshot integrity (service AND database)", () => {
    it("a Candidate of a Batch for S1 cannot anchor structure of S2", async () => {
      const a = await ingested("cross-a");
      const b = await ingested("cross-b");
      const { batch } = await createImportBatch(batchInput(a.structure.snapshot.id));
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { sectionId: b.section("Skills") })]), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_SOURCE_ANCHOR);
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { contentNodeId: a.node("Damage") }, { supportingSourceAnchors: [{ contentNodeId: b.node("Damage") }] })]), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_SOURCE_ANCHOR);
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { contentNodeId: "00000000-0000-4000-8000-000000000000" })]), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_SOURCE_ANCHOR);
      expect(await countFor(batch.id)).toEqual({ candidates: 0, sources: 0 });
    });

    it("the database rejects rows whose redundant Snapshot context does not match their Batch / section / node", async () => {
      const a = await ingested("db-a");
      const b = await ingested("db-b");
      const { batch } = await createImportBatch(batchInput(a.structure.snapshot.id));
      const { candidates: [c] } = await recordExtractionCandidates(batch.id, [cand(1, { sectionId: a.section("Skills") })]);
      const row = { ordinal: 99, candidateKind: "UNKNOWN" as const, displayLabel: "x", confidence: "LOW" as const, payloadSchemaKey: "x", payloadSchemaVersion: 1, payloadJson: {}, candidateFingerprint: "f".repeat(64) };
      await expectDbRejects(prisma.extractionCandidate.create({ data: { ...row, importBatchId: batch.id, sourceSnapshotId: b.structure.snapshot.id, primarySourceSectionId: b.section("Skills") } }), /extraction_candidates_batch_fkey|Foreign key/i);
      await expectDbRejects(prisma.extractionCandidate.create({ data: { ...row, importBatchId: batch.id, sourceSnapshotId: a.structure.snapshot.id, primarySourceSectionId: b.section("Skills") } }), /primary_section_fkey|Foreign key/i);
      await expectDbRejects(prisma.extractionCandidate.create({ data: { ...row, importBatchId: batch.id, sourceSnapshotId: a.structure.snapshot.id, primarySourceContentNodeId: b.node("Damage") } }), /primary_content_node_fkey|Foreign key/i);
      await expectDbRejects(prisma.extractionCandidateSource.create({ data: { extractionCandidateId: c!.id, sourceSnapshotId: a.structure.snapshot.id, ordinal: 5, sourceContentNodeId: b.node("Damage") } }), /content_node_fkey|Foreign key/i);
      await expectDbRejects(prisma.extractionCandidateSource.create({ data: { extractionCandidateId: c!.id, sourceSnapshotId: b.structure.snapshot.id, ordinal: 6, sourceSectionId: b.section("Skills") } }), /candidate_fkey|Foreign key/i);
      await expectDbRejects(prisma.importBatch.create({ data: { sourceSnapshotId: a.structure.snapshot.id, sourceStructureHash: a.structure.ingestion!.structureHash, label: "x", scopeType: "SECTION_SUBTREE", scopeSectionId: b.section("Skills"), extractorKey: "x", extractorVersion: "1", batchFingerprint: "e".repeat(64) } }), /scope_section_fkey|Foreign key/i);
      await expectDbRejects(prisma.importBatch.create({ data: { sourceSnapshotId: a.structure.snapshot.id, sourceStructureHash: "0".repeat(64), label: "x", scopeType: "SNAPSHOT", extractorKey: "x", extractorVersion: "1", batchFingerprint: "d".repeat(64) } }), /structure_hash_fkey|Foreign key/i);
    });

    it("CHECK constraints: scope shape, comparison-requires-ruleset, exactly one anchor, object payload", async () => {
      const a = await ingested("db-checks");
      const { batch } = await createImportBatch(batchInput(a.structure.snapshot.id));
      const base = { sourceSnapshotId: a.structure.snapshot.id, sourceStructureHash: a.structure.ingestion!.structureHash, label: "x", extractorKey: "x", extractorVersion: "1" };
      await expectDbRejects(prisma.importBatch.create({ data: { ...base, scopeType: "SNAPSHOT", scopeSectionId: a.section("Skills"), batchFingerprint: "c".repeat(64) } }), /scope_check|check/i);
      await expectDbRejects(prisma.importBatch.create({ data: { ...base, scopeType: "SECTION_SUBTREE", batchFingerprint: "b".repeat(64) } }), /scope_check|check/i);
      await expectDbRejects(prisma.$executeRawUnsafe(`INSERT INTO import_batches (source_snapshot_id, source_structure_hash, label, scope_type, comparison_manifest_id, extractor_key, extractor_version, batch_fingerprint) VALUES ('${base.sourceSnapshotId}', '${base.sourceStructureHash}', 'x', 'SNAPSHOT', '00000000-0000-4000-8000-000000000000', 'x', '1', '${"a".repeat(64)}')`), /comparison_requires_ruleset|check/i);
      const row = { importBatchId: batch.id, sourceSnapshotId: a.structure.snapshot.id, ordinal: 1, candidateKind: "UNKNOWN" as const, displayLabel: "x", confidence: "LOW" as const, payloadSchemaKey: "x", payloadSchemaVersion: 1, candidateFingerprint: "9".repeat(64) };
      await expectDbRejects(prisma.extractionCandidate.create({ data: { ...row, payloadJson: {} } }), /exactly_one_primary_anchor|check/i);
      await expectDbRejects(prisma.extractionCandidate.create({ data: { ...row, payloadJson: {}, primarySourceSectionId: a.section("Skills"), primarySourceContentNodeId: a.node("Damage") } }), /exactly_one_primary_anchor|check/i);
      await expectDbRejects(prisma.extractionCandidate.create({ data: { ...row, payloadJson: [1, 2], primarySourceSectionId: a.section("Skills") } }), /payload_object|check/i);
      await expectDbRejects(prisma.extractionCandidate.create({ data: { ...row, ordinal: 0, payloadJson: {}, primarySourceSectionId: a.section("Skills") } }), /positive_check|check/i);
    });
  });

  describe("§59 structure not ready", () => {
    it("a Snapshot without completed structural ingestion cannot get a Batch, and nothing triggers ingestion", async () => {
      const d = await createSourceDocument({ title: `${DOC_PREFIX}not-ready`, sourceType: "DOCUMENT" });
      const s = await createSourceSnapshot(d.id, { label: "raw", originalFilename: "raw.docx", mimeType: DOCX_MIME_TYPE, contentHash: "1".repeat(64), byteSize: 1 });
      await expectCode(createImportBatch(batchInput(s.id)), IMPORT_BATCH_ERROR_CODES.SOURCE_STRUCTURE_NOT_READY);
      expect(await prisma.sourceSnapshotIngestion.count({ where: { sourceSnapshotId: s.id } })).toBe(0);
      await expectCode(createImportBatch(batchInput("00000000-0000-4000-8000-000000000000")), IMPORT_BATCH_ERROR_CODES.SOURCE_SNAPSHOT_NOT_FOUND);
      await expectCode(createImportBatch(batchInput("not-a-uuid")), IMPORT_BATCH_ERROR_CODES.SOURCE_SNAPSHOT_NOT_FOUND);
    });
  });

  describe("§60 / §77 Batch idempotency and concurrency", () => {
    it("the same extraction context returns the same Batch (labels are not identity); a new extractor version is a new Batch", async () => {
      const f = await ingested("idem");
      const s = f.structure.snapshot.id;
      const first = await createImportBatch(batchInput(s));
      const again = await createImportBatch(batchInput(s, { label: "Renamed", description: "different words" }));
      expect(again).toEqual({ batch: first.batch, created: false });
      expect(await prisma.importBatch.count({ where: { sourceSnapshotId: s } })).toBe(1);
      const v2 = await createImportBatch(batchInput(s, { extractorVersion: "1.1" }));
      expect(v2.created).toBe(true);
      expect(v2.batch.batchFingerprint).not.toBe(first.batch.batchFingerprint);
      const scoped = await createImportBatch(batchInput(s, { scope: { type: "SECTION_SUBTREE", sectionId: f.section("Skills") } }));
      const configured = await createImportBatch(batchInput(s, { extractorConfigHash: "2".repeat(64) }));
      expect(new Set([first, v2, scoped, configured].map((r) => r.batch.id)).size).toBe(4);
    });

    it("concurrent identical creates produce exactly one Batch", async () => {
      const f = await ingested("idem-race");
      const results = await Promise.all(Array.from({ length: 5 }, () => createImportBatch(batchInput(f.structure.snapshot.id))));
      expect(new Set(results.map((r) => r.batch.id)).size).toBe(1);
      expect(results.filter((r) => r.created).length).toBe(1);
      expect(await prisma.importBatch.count({ where: { sourceSnapshotId: f.structure.snapshot.id } })).toBe(1);
    });

    it("server-controlled fields cannot be supplied", async () => {
      const f = await ingested("forbidden-batch");
      for (const extra of [{ status: "COMPLETED" }, { batchFingerprint: "a".repeat(64) }, { sourceStructureHash: "a".repeat(64) }, { id: "x" }]) {
        await expectCode(createImportBatch({ ...batchInput(f.structure.snapshot.id), ...extra } as CreateImportBatchInput), IMPORT_BATCH_ERROR_CODES.INVALID_INPUT, JSON.stringify(extra));
      }
      await expectCode(createImportBatch(batchInput(f.structure.snapshot.id, { extractorKey: "Not A Key" })), IMPORT_BATCH_ERROR_CODES.INVALID_INPUT);
      await expectCode(createImportBatch(batchInput(f.structure.snapshot.id, { extractorConfigHash: "nothex" })), IMPORT_BATCH_ERROR_CODES.INVALID_INPUT);
    });
  });

  describe("§61 / §7 / §44 exact comparison context", () => {
    it("a Manifest of the review Ruleset is accepted; a Manifest of another Ruleset, or without a Ruleset, is not; nothing is inferred or mutated", async () => {
      const f = await ingested("context");
      const r1 = await createRuleset({ canonicalKey: k("r1"), name: `${PREFIX} R1`, channel: "CORE_PLAYTEST" });
      const r2 = await createRuleset({ canonicalKey: k("r2"), name: `${PREFIX} R2`, channel: "CORE_PLAYTEST" });
      const m1 = await createRulesetManifest(r1.id, { entries: [] });
      const m2 = await createRulesetManifest(r2.id, { entries: [] });
      const governance = ["rulesets", "ruleset_manifests", "ruleset_manifest_entries", "canon_policies", "source_authority_records", "ruleset_releases"];
      const before = await fingerprint(governance);
      const ok = await createImportBatch(batchInput(f.structure.snapshot.id, { reviewRulesetId: r1.id, comparisonManifestId: m1.id }));
      expect(ok.batch).toMatchObject({ reviewRulesetId: r1.id, comparisonManifestId: m1.id });
      const rulesetOnly = await createImportBatch(batchInput(f.structure.snapshot.id, { reviewRulesetId: r1.id }));
      expect(rulesetOnly.batch.comparisonManifestId).toBeNull(); // never the "latest" Manifest of R1
      await recordExtractionCandidates(ok.batch.id, [cand(1, { sectionId: f.section("Skills") })]);
      expect(await fingerprint(governance)).toEqual(before);
      await expectCode(createImportBatch(batchInput(f.structure.snapshot.id, { reviewRulesetId: r1.id, comparisonManifestId: m2.id })), IMPORT_BATCH_ERROR_CODES.INVALID_COMPARISON_CONTEXT);
      await expectCode(createImportBatch(batchInput(f.structure.snapshot.id, { comparisonManifestId: m1.id })), IMPORT_BATCH_ERROR_CODES.INVALID_COMPARISON_CONTEXT);
      await expectCode(createImportBatch(batchInput(f.structure.snapshot.id, { reviewRulesetId: "00000000-0000-4000-8000-000000000000" })), IMPORT_BATCH_ERROR_CODES.INVALID_COMPARISON_CONTEXT);
      await expectCode(createImportBatch(batchInput(f.structure.snapshot.id, { reviewRulesetId: r1.id, comparisonManifestId: "00000000-0000-4000-8000-000000000000" })), IMPORT_BATCH_ERROR_CODES.INVALID_COMPARISON_CONTEXT);
      await expectDbRejects(prisma.importBatch.create({ data: { sourceSnapshotId: f.structure.snapshot.id, sourceStructureHash: f.structure.ingestion!.structureHash, label: "x", scopeType: "SNAPSHOT", reviewRulesetId: r1.id, comparisonManifestId: m2.id, extractorKey: "x", extractorVersion: "1", batchFingerprint: "8".repeat(64) } }), /comparison_manifest_fkey|Foreign key/i);
    });
  });

  describe("§62 / §63 / §64 Candidates", () => {
    it("a basic Candidate is UNREVIEWED with its confidence, payload, exact anchor and fingerprint stored", async () => {
      const f = await ingested("basic");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const r = await recordExtractionCandidates(batch.id, [cand(10, { contentNodeId: f.node("Arcana covers") }, { candidateKind: "ENTITY", proposedEntityType: "GENERIC_RULE", proposedCanonicalKey: "skill.arcana", confidence: "MEDIUM", summary: "A skill", payloadSchemaKey: "prowess.entity.skill", payloadJson: { name: "Arcana", tiers: ["Trained", "Expert"], nested: { a: null } } })]);
      const c = r.candidates[0]!;
      expect(c).toMatchObject({ importBatchId: batch.id, sourceSnapshotId: f.structure.snapshot.id, ordinal: 10, candidateKind: "ENTITY", proposedEntityType: "GENERIC_RULE", proposedCanonicalKey: "skill.arcana", confidence: "MEDIUM", status: "UNREVIEWED", summary: "A skill", payloadSchemaKey: "prowess.entity.skill", payloadSchemaVersion: 1, primarySourceSectionId: null, primarySourceContentNodeId: f.node("Arcana covers"), supportingSources: [] });
      expect(c.payload).toEqual({ name: "Arcana", tiers: ["Trained", "Expert"], nested: { a: null } });
      expect(c.candidateFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(await getExtractionCandidate(c.id)).toEqual(c);
      expect(await prisma.entity.count({ where: { canonicalKey: "skill.arcana" } })).toBe(0); // a proposal, nothing looked up or created
    });

    it("callers cannot smuggle a status, a fingerprint or a Snapshot id (INVALID_INPUT)", async () => {
      const f = await ingested("smuggle");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      for (const extra of [{ status: "APPROVED" }, { status: "REJECTED" }, { status: "MATCHED" }, { candidateFingerprint: "a".repeat(64) }, { sourceSnapshotId: f.structure.snapshot.id }]) {
        await expectCode(recordExtractionCandidates(batch.id, [{ ...cand(1, { sectionId: f.section("Skills") }), ...extra } as CreateExtractionCandidateInput]), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT, JSON.stringify(extra));
      }
      expect(await countFor(batch.id)).toEqual({ candidates: 0, sources: 0 });
    });

    it("shape problems are INVALID_INPUT", async () => {
      const f = await ingested("shape");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const s = { sectionId: f.section("Skills") };
      for (const bad of [
        cand(0, s),
        cand(1, s, { candidateKind: "SPELL_EFFECT" as never }),
        cand(1, s, { confidence: "CERTAIN" as never }),
        cand(1, s, { payloadJson: [1] as never }),
        cand(1, s, { payloadJson: { at: new Date() } as never }),
        cand(1, s, { payloadSchemaVersion: 0 }),
        cand(1, s, { payloadSchemaKey: "No Spaces" }),
        cand(1, s, { candidateKind: "FORMULA", proposedEntityType: "GENERIC_RULE" }),
        cand(1, s, { proposedCanonicalKey: "Not A Key" }),
        cand(1, { sectionId: f.section("Skills"), contentNodeId: f.node("Damage") }),
        cand(1, {}),
      ]) await expectCode(recordExtractionCandidates(batch.id, [bad]), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT, JSON.stringify(bad).slice(0, 120));
      await expectCode(recordExtractionCandidates(batch.id, []), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT);
      await expectCode(recordExtractionCandidates("00000000-0000-4000-8000-000000000000", [cand(1, s)]), IMPORT_BATCH_ERROR_CODES.NOT_FOUND);
    });

    it("generic kinds (ENTITY, FORMULA, REQUIREMENT, KEYWORD, UNKNOWN) all record UNREVIEWED and create no domain records", async () => {
      const f = await ingested("kinds");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const domain = ["entities", "entity_versions", "entity_aliases", "keyword_definitions", "keyword_categories", "entity_keywords", "entity_version_keywords", "entity_relationships", "source_references"];
      const before = await fingerprint(domain);
      const kinds = ["ENTITY", "FORMULA", "REQUIREMENT", "KEYWORD", "UNKNOWN"] as const;
      const r = await recordExtractionCandidates(batch.id, kinds.map((kind, i) => cand(i + 1, { contentNodeId: f.node(kind === "FORMULA" ? "Damage equals" : "Arcana covers") }, { candidateKind: kind, displayLabel: kind, payloadSchemaKey: `prowess.test.${kind.toLowerCase()}` })));
      expect(r.candidates.map((c) => [c.candidateKind, c.status])).toEqual(kinds.map((kind) => [kind, "UNREVIEWED"]));
      expect(await fingerprint(domain)).toEqual(before);
    });
  });

  describe("§65 / §66 / §67 / §68 fingerprints, idempotency, ordinals", () => {
    it("payload key order does not change identity; array order does", async () => {
      const f = await ingested("canon");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const s = { sectionId: f.section("Arcana") };
      const a = await recordExtractionCandidates(batch.id, [cand(1, s, { payloadJson: { name: "Arcana", rank: "Expert" } })]);
      const b = await recordExtractionCandidates(batch.id, [cand(1, s, { payloadJson: { rank: "Expert", name: "Arcana" } })]);
      expect(b).toMatchObject({ createdCount: 0, reusedCount: 1 });
      expect(b.candidates[0]!.id).toBe(a.candidates[0]!.id);
      const c = await recordExtractionCandidates(batch.id, [cand(2, s, { payloadJson: { tiers: ["Trained", "Expert"] } })]);
      const d = await recordExtractionCandidates(batch.id, [cand(3, s, { payloadJson: { tiers: ["Expert", "Trained"] } })]);
      expect(c.candidates[0]!.candidateFingerprint).not.toBe(d.candidates[0]!.candidateFingerprint);
      expect(await countFor(batch.id)).toEqual({ candidates: 3, sources: 0 });
    });

    it("recording the exact same Candidate twice — even within one call — yields one Candidate", async () => {
      const f = await ingested("cand-idem");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const one = cand(5, { contentNodeId: f.node("Damage equals") }, { supportingSourceAnchors: [{ contentNodeId: f.node("Tier\tMP"), excerpt: "MP" }] });
      const r1 = await recordExtractionCandidates(batch.id, [one, one]);
      const r2 = await recordExtractionCandidates(batch.id, [one]);
      expect([r1.createdCount, r1.reusedCount, r2.createdCount, r2.reusedCount]).toEqual([1, 0, 0, 1]);
      expect(r2.candidates).toEqual(r1.candidates);
      expect(await countFor(batch.id)).toEqual({ candidates: 1, sources: 1 });
    });

    it("a different payload at the same anchor is a new Candidate under a new ordinal and never overwrites the first", async () => {
      const f = await ingested("different");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const s = { sectionId: f.section("Arcana") };
      const first = (await recordExtractionCandidates(batch.id, [cand(1, s, { payloadJson: { rank: "Expert" } })])).candidates[0]!;
      const second = (await recordExtractionCandidates(batch.id, [cand(2, s, { payloadJson: { rank: "Master" } })])).candidates[0]!;
      expect(second.id).not.toBe(first.id);
      expect(await getExtractionCandidate(first.id)).toEqual(first);
    });

    it("a different Candidate at an owned ordinal is ORDINAL_CONFLICT (stored or within one call); nothing is renumbered", async () => {
      const f = await ingested("ordinal");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const s = { sectionId: f.section("Arcana") };
      await recordExtractionCandidates(batch.id, [cand(10, s, { payloadJson: { a: 1 } })]);
      await expectCode(recordExtractionCandidates(batch.id, [cand(10, s, { payloadJson: { a: 2 } })]), EXTRACTION_CANDIDATE_ERROR_CODES.ORDINAL_CONFLICT);
      await expectCode(recordExtractionCandidates(batch.id, [cand(20, s, { payloadJson: { b: 1 } }), cand(20, s, { payloadJson: { b: 2 } })]), EXTRACTION_CANDIDATE_ERROR_CODES.ORDINAL_CONFLICT);
      await expectCode(recordExtractionCandidates(batch.id, [cand(11, s, { payloadJson: { a: 1 }, displayLabel: "Candidate 10" })]), EXTRACTION_CANDIDATE_ERROR_CODES.CANDIDATE_CONFLICT, "same content, other ordinal");
      await expectCode(recordExtractionCandidates(batch.id, [cand(10, s, { payloadJson: { a: 1 }, summary: "changed" })]), EXTRACTION_CANDIDATE_ERROR_CODES.CANDIDATE_CONFLICT, "same content, other summary");
      expect((await listExtractionCandidates(batch.id)).map((c) => c.ordinal)).toEqual([10]);
    });
  });

  describe("§69 supporting anchors", () => {
    it("supporting anchors (paragraphs, a table, a section) are kept in the given order with verbatim excerpts", async () => {
      const f = await ingested("support");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id, { scope: { type: "SECTION_SUBTREE", sectionId: f.section("Spellcasting") } }));
      const { candidates: [c] } = await recordExtractionCandidates(batch.id, [
        cand(1, { contentNodeId: f.node("Spells are built") }, { candidateKind: "FORMULA", supportingSourceAnchors: [
          { contentNodeId: f.node("Damage equals"), excerpt: "(Power × 2) + Tier" },
          { contentNodeId: f.node("Tier\tMP") },
          { sectionId: f.section("Effects"), excerpt: "Effects" },
        ] }),
      ]);
      expect(c!.supportingSources.map((s) => [s.ordinal, s.sourceContentNodeId, s.sourceSectionId, s.excerpt])).toEqual([
        [1, f.node("Damage equals"), null, "(Power × 2) + Tier"],
        [2, f.node("Tier\tMP"), null, null],
        [3, null, f.section("Effects"), "Effects"],
      ]);
      expect(c!.supportingSources.every((s) => s.sourceSnapshotId === f.structure.snapshot.id)).toBe(true);
    });

    it("an excerpt that is not verbatim source text is INVALID_SOURCE_ANCHOR (never paraphrased)", async () => {
      const f = await ingested("excerpt");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { sectionId: f.section("Effects") }, { supportingSourceAnchors: [{ contentNodeId: f.node("Damage equals"), excerpt: "Damage is Power times two" }] })]), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_SOURCE_ANCHOR);
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { sectionId: f.section("Effects") }, { primarySourceAnchor: { sectionId: f.section("Effects"), excerpt: "x" } as never })]), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT, "no excerpt on the primary anchor");
      expect(await countFor(batch.id)).toEqual({ candidates: 0, sources: 0 });
    });
  });

  describe("§70 bulk atomicity", () => {
    it("two valid Candidates and one with a bad anchor: none of the call persists", async () => {
      const f = await ingested("atomic");
      const g = await ingested("atomic-other");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      await expectCode(recordExtractionCandidates(batch.id, [cand(1, { sectionId: f.section("Skills") }), cand(2, { sectionId: f.section("Arcana") }), cand(3, { sectionId: g.section("Arcana") })]), EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_SOURCE_ANCHOR);
      expect(await countFor(batch.id)).toEqual({ candidates: 0, sources: 0 });
    });

    it("a database failure late in the transaction rolls back every Candidate and source of the call", async () => {
      const f = await ingested("atomic-db");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const nul = cand(3, { sectionId: f.section("Arcana") }, { displayLabel: "bad\u0000label" });
      const error = await recordExtractionCandidates(batch.id, [cand(1, { sectionId: f.section("Skills") }, { supportingSourceAnchors: [{ sectionId: f.section("Arcana") }] }), cand(2, { sectionId: f.section("Arcana") }), nul]).then(() => null, (e: unknown) => e);
      expect(error).not.toBeNull();
      expect(error).not.toBeInstanceOf(DomainError); // a raw database failure propagates; it is not relabelled or swallowed
      expect(await countFor(batch.id)).toEqual({ candidates: 0, sources: 0 });
    });
  });

  describe("§71 derived summary", () => {
    it("counts by kind / confidence / status are computed from Candidates; no counter column exists", async () => {
      const f = await ingested("summary");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const s = { sectionId: f.section("Arcana") };
      await recordExtractionCandidates(batch.id, [
        cand(1, s, { candidateKind: "ENTITY", confidence: "HIGH", payloadJson: { i: 1 } }),
        cand(2, s, { candidateKind: "ENTITY", confidence: "LOW", payloadJson: { i: 2 } }),
        cand(3, s, { candidateKind: "FORMULA", confidence: "MEDIUM", payloadJson: { i: 3 } }),
        cand(4, s, { candidateKind: "UNKNOWN", confidence: "LOW", payloadJson: { i: 4 } }),
      ]);
      const summary = await getImportBatchSummary(batch.id);
      expect(summary.candidateCount).toBe(4);
      expect(summary.byConfidence).toEqual({ HIGH: 1, MEDIUM: 1, LOW: 2 });
      expect(summary.byStatus).toEqual({ UNREVIEWED: 4, MATCHED: 0, NEW_ENTITY: 0, CONFLICT: 0, NEEDS_MAPPING: 0, REJECTED: 0, APPROVED: 0 });
      expect(summary.byKind).toEqual({ ENTITY: 2, ENTITY_FIELD: 0, FORMULA: 1, REQUIREMENT: 0, KEYWORD: 0, RELATIONSHIP: 0, REFERENCE: 0, UNKNOWN: 1 });
      expect((await getImportBatch(batch.id)).summary).toEqual(summary);
      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_name = 'import_batches' AND column_name ~* '(count|total)'`;
      expect(cols).toEqual([]);
    });
  });

  describe("§72 historical source reproducibility", () => {
    it("a Batch on V0.1 keeps V0.1, its hash, anchors and payloads after V0.2 is ingested", async () => {
      const f = await ingested("history", IMPORT_SCOPE, "V0.1");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      await recordExtractionCandidates(batch.id, [cand(1, { contentNodeId: f.node("Damage equals") }, { supportingSourceAnchors: [{ sectionId: f.section("Effects") }] })]);
      const batchBefore = await getImportBatch(batch.id);
      const candidatesBefore = await listExtractionCandidates(batch.id);
      const v2 = await ingested("history", { ...IMPORT_SCOPE, blocks: [...IMPORT_SCOPE.blocks, { kind: "p", text: "Added in V0.2." }] }, "V0.2", f.documentId);
      expect(v2.structure.snapshot.id).not.toBe(f.structure.snapshot.id);
      expect(await getImportBatch(batch.id)).toEqual(batchBefore);
      expect(await listExtractionCandidates(batch.id)).toEqual(candidatesBefore);
      expect((await listImportBatches({ sourceSnapshotId: v2.structure.snapshot.id }))).toEqual([]);
    });
  });

  describe("§73 / §45 confidence is not authority", () => {
    it("a HIGH-confidence Candidate leaves SourceDocument authority, CanonPolicy, SourceAuthorityRecord and Ruleset byte-identical", async () => {
      const d = await createSourceDocument({ title: `${DOC_PREFIX}authority`, sourceType: "DOCUMENT", authorityStatus: "REFERENCE_ONLY" });
      const f = await ingested("authority", IMPORT_SCOPE, "V0.1", d.id);
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const tables = ["source_documents", "canon_policies", "source_authority_records", "rulesets"];
      const before = await fingerprint(tables);
      const r = await recordExtractionCandidates(batch.id, [cand(1, { sectionId: f.section("Arcana") }, { confidence: "HIGH" })]);
      expect(r.candidates[0]!.confidence).toBe("HIGH");
      expect(await fingerprint(tables)).toEqual(before);
      expect((await prisma.sourceDocument.findUnique({ where: { id: d.id } }))!.authorityStatus).toBe("REFERENCE_ONLY");
    });
  });

  describe("§74 / §43 no domain mutation", () => {
    it("creating Batches and recording Candidates changes only the three import tables", async () => {
      const f = await ingested("isolation");
      const before = await fingerprint(undefined, IMPORT_TABLES);
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id, { scope: { type: "SECTION_SUBTREE", sectionId: f.section("Spellcasting") } }));
      await recordExtractionCandidates(batch.id, [cand(1, { sectionId: f.section("Effects") }, { candidateKind: "FORMULA", supportingSourceAnchors: [{ contentNodeId: f.node("Damage equals") }] }), cand(2, { contentNodeId: f.node("A spell targets") }, { candidateKind: "REQUIREMENT" })]);
      await getImportBatchSummary(batch.id);
      expect(await fingerprint(undefined, IMPORT_TABLES)).toEqual(before);
    });
  });

  describe("§75 RESTRICT protects import evidence", () => {
    it("referenced Snapshot, Section and ContentNode cannot be deleted; nor can a Batch or Candidate with dependents", async () => {
      const f = await ingested("restrict");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const { candidates: [c] } = await recordExtractionCandidates(batch.id, [cand(1, { contentNodeId: f.node("Damage equals") }, { supportingSourceAnchors: [{ sectionId: f.section("Skills") }] })]);
      await expect(prisma.sourceSnapshot.delete({ where: { id: f.structure.snapshot.id } })).rejects.toThrow();
      await expect(prisma.sourceSection.delete({ where: { id: f.section("Skills") } })).rejects.toThrow();
      await expect(prisma.sourceContentNode.delete({ where: { id: f.node("Damage equals") } })).rejects.toThrow();
      await expect(prisma.importBatch.delete({ where: { id: batch.id } })).rejects.toThrow();
      await expect(prisma.extractionCandidate.delete({ where: { id: c!.id } })).rejects.toThrow();
      expect(await getExtractionCandidate(c!.id)).toEqual(c);
    });
  });

  describe("§77 Candidate concurrency", () => {
    it("concurrent recording of the exact same Candidates yields one copy; competing different data at one ordinal stays a conflict", async () => {
      const f = await ingested("cand-race");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      const group = [cand(1, { sectionId: f.section("Skills") }), cand(2, { sectionId: f.section("Arcana") }, { supportingSourceAnchors: [{ contentNodeId: f.node("Arcana covers") }] })];
      const results = await Promise.all(Array.from({ length: 4 }, () => recordExtractionCandidates(batch.id, group)));
      expect(results.reduce((sum, r) => sum + r.createdCount, 0)).toBe(2);
      expect(new Set(results.map((r) => r.candidates.map((c) => c.id).join()))).toEqual(new Set([results[0]!.candidates.map((c) => c.id).join()]));
      expect(await countFor(batch.id)).toEqual({ candidates: 2, sources: 1 });

      const competing = await Promise.all([
        recordExtractionCandidates(batch.id, [cand(7, { sectionId: f.section("Arcana") }, { payloadJson: { v: "a" } })]).then(() => "ok", (e: unknown) => (e as DomainError).code),
        recordExtractionCandidates(batch.id, [cand(7, { sectionId: f.section("Arcana") }, { payloadJson: { v: "b" } })]).then(() => "ok", (e: unknown) => (e as DomainError).code),
      ]);
      expect(competing.sort()).toEqual([EXTRACTION_CANDIDATE_ERROR_CODES.ORDINAL_CONFLICT, "ok"].sort());
      expect(await prisma.extractionCandidate.count({ where: { importBatchId: batch.id, ordinal: 7 } })).toBe(1);
    });
  });

  describe("reads and controlled errors", () => {
    it("Candidates list in ordinal order; unknown / malformed ids are NOT_FOUND", async () => {
      const f = await ingested("reads");
      const { batch } = await createImportBatch(batchInput(f.structure.snapshot.id));
      await recordExtractionCandidates(batch.id, [cand(30, { sectionId: f.section("Skills") }), cand(5, { sectionId: f.section("Arcana") }), cand(12, { sectionId: f.section("Effects") })]);
      expect((await listExtractionCandidates(batch.id)).map((c) => c.ordinal)).toEqual([5, 12, 30]);
      await expectCode(getImportBatch("00000000-0000-4000-8000-000000000000"), IMPORT_BATCH_ERROR_CODES.NOT_FOUND);
      await expectCode(getImportBatch("nope"), IMPORT_BATCH_ERROR_CODES.NOT_FOUND);
      await expectCode(getImportBatchSummary("nope"), IMPORT_BATCH_ERROR_CODES.NOT_FOUND);
      await expectCode(listExtractionCandidates("nope"), IMPORT_BATCH_ERROR_CODES.NOT_FOUND);
      await expectCode(getExtractionCandidate("00000000-0000-4000-8000-000000000000"), EXTRACTION_CANDIDATE_ERROR_CODES.NOT_FOUND);
      await expectCode(listImportBatches({ sourceSnapshotId: "nope" }), IMPORT_BATCH_ERROR_CODES.INVALID_INPUT);
    });

    it("no update, delete, status-setter or review operation exists in the public surface", async () => {
      const surface = Object.keys(await import("../../src/index"));
      expect(surface.filter((x) => /ImportBatch|ExtractionCandidate|Candidate/.test(x)).filter((x) => /^(update|delete|remove|set|replace|change|approve|reject|match|transition|decide)/.test(x))).toEqual([]);
    });
  });
});
