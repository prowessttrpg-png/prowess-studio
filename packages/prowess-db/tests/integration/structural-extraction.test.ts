/**
 * M3-WO3 — Structural Segmentation & Automated Extraction, database integration (prowess_studio_test only, guarded).
 * Synthetic deterministic DOCX fixtures only (never the real Playtest Packet). Describe blocks follow §54–§74.
 */
import { DomainError, EXTRACTION_CANDIDATE_ERROR_CODES, IMPORT_BATCH_ERROR_CODES, type CreateExtractionCandidateInput, type CreateImportBatchInput } from "@prowess/model";
import { defaultExtractorRegistry, ExtractorRegistry, structuralExtractorV1, type ExtractorDefinition } from "@prowess/import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createImportBatch,
  createSourceDocument,
  DOCX_MIME_TYPE,
  extractImportBatch,
  getExtractionResult,
  getImportBatch,
  getSourceStructure,
  ingestSourceSnapshot,
  listExtractionCandidates,
  prisma,
  recordExtractionCandidates,
  verifyExtractionOutput,
} from "../../src/index";
import { extractImportBatchWith, verifyExtractionOutputWith } from "../../src/extraction/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { buildDocx, makePng, type FxBlock, type FxDocument } from "../fixtures/docx-builder";
import { IMPORT_SCOPE, MISSION_TABLES, TABLES } from "../fixtures/prowess-structure-fixtures";
import { getTestDatabaseUrl } from "./env";

const STAMP = Date.now();
const DOC_PREFIX = `M3X ${STAMP} `;
const IMPORT_TABLES = ["import_batches", "extraction_candidates", "extraction_candidate_sources"];
const SOURCE_TABLES = ["source_documents", "source_snapshots", "source_snapshot_ingestions", "source_sections", "source_blocks", "source_tables", "source_assets", "source_asset_placements", "source_content_nodes", "source_references"];

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

const SCOPED: FxDocument = {
  blocks: [
    { kind: "p", text: "Preface before any heading." },
    { kind: "heading", level: 1, text: "Combat" },
    { kind: "p", text: "Combat happens in rounds." },
    { kind: "heading", level: 1, text: "Skills" },
    { kind: "p", text: "Skills have tiers." },
    { kind: "heading", level: 1, text: "Spellcasting" },
    { kind: "heading", level: 2, text: "Targeting" },
    { kind: "p", text: "A spell targets one creature." },
    { kind: "heading", level: 2, text: "Effects" },
    { kind: "p", text: "Spell AP = floor(Final MP / PRO), minimum 1." },
    { kind: "p", text: "Requires Expert Emission." },
    { kind: "table", headerRows: 1, caption: "Difficulty Classes", rows: [["Task", "DC"], ["Easy", "10"], ["Hard", "20"]] },
    { kind: "heading", level: 1, text: "Maneuvers" },
    ...Array.from({ length: 10 }, (_, i) => ({ kind: "bullet", text: `Maneuver item ${i + 1}` }) as FxBlock),
    { kind: "heading", level: 1, text: "Art" },
    { kind: "image", media: "art.png", alt: "Illustration" },
  ],
  media: { "art.png": makePng(4, 4, 9) },
};

async function ingested(label: string, doc: FxDocument = SCOPED, documentId?: string) {
  const id = documentId ?? (await createSourceDocument({ title: `${DOC_PREFIX}${label}`, sourceType: "DOCUMENT" })).id;
  const { snapshot } = await ingestSourceSnapshot(id, buildDocx(doc), { label, originalFilename: `${label}.docx`, mimeType: DOCX_MIME_TYPE });
  const structure = await getSourceStructure(snapshot.id);
  return { documentId: id, structure, section: (title: string) => structure.sections.find((s) => s.title === title)!.id };
}
const batchFor = (snapshotId: string, over: Partial<CreateImportBatchInput> = {}) =>
  createImportBatch({ sourceSnapshotId: snapshotId, label: "Structural extraction", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1", ...over }).then((r) => r.batch);
const registryWith = (extract: ExtractorDefinition["extract"], over: Partial<ExtractorDefinition> = {}) => new ExtractorRegistry([{ ...structuralExtractorV1, ...over, extract }]);
const counts = async (importBatchId: string) => ({
  candidates: await prisma.extractionCandidate.count({ where: { importBatchId } }),
  sources: await prisma.extractionCandidateSource.count({ where: { extractionCandidate: { importBatchId } } }),
});

describe("M3-WO3 structural extraction (prowess_studio_test only)", () => {
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
  }, 300_000);

  describe("§54 / §73 basic extraction -> READY_FOR_REVIEW", () => {
    it("a section with direct paragraphs becomes one HIGH, UNREVIEWED, section-anchored candidate; the Batch commits its output", async () => {
      const f = await ingested("basic", { blocks: [{ kind: "heading", level: 1, text: "Core Rules" }, { kind: "p", text: "One." }, { kind: "p", text: "Two." }, { kind: "p", text: "Three." }] });
      const batch = await batchFor(f.structure.snapshot.id);
      expect([batch.status, batch.extractionOutputHash, batch.extractedAt]).toEqual(["CREATED", null, null]);
      const r = await extractImportBatch(batch.id);
      expect(r).toMatchObject({ alreadyExtracted: false, candidateCount: 1, batch: { id: batch.id, status: "READY_FOR_REVIEW" } });
      expect(r.extractionOutputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.batch.extractedAt).toBeInstanceOf(Date);
      expect(r.batch.batchFingerprint).toBe(batch.batchFingerprint); // extraction never changes Batch identity
      const [c] = await listExtractionCandidates(batch.id);
      expect(c).toMatchObject({ ordinal: 1, candidateKind: "UNKNOWN", confidence: "HIGH", status: "UNREVIEWED", displayLabel: "Core Rules", proposedEntityType: null, proposedCanonicalKey: null, payloadSchemaKey: "prowess.structural.section", payloadSchemaVersion: 1, primarySourceSectionId: f.section("Core Rules"), primarySourceContentNodeId: null });
      expect(c!.supportingSources.map((s) => s.sourceContentNodeId)).toEqual(f.structure.nodes.slice(1).map((n) => n.id));
      expect(c!.supportingSources.every((s) => s.excerpt === null)).toBe(true);
      expect(r.summary.byStatus.UNREVIEWED).toBe(1);
    });
  });

  describe("§55–§61 segmentation over real ingested structure", () => {
    it("containers are skipped; tables are REFERENCE; lists stay with their section; formula/requirement text stays structural; image-only yields nothing; preface is ROOT_CONTENT", async () => {
      const f = await ingested("segmentation");
      const batch = await batchFor(f.structure.snapshot.id);
      await extractImportBatch(batch.id);
      const cs = await listExtractionCandidates(batch.id);
      expect(cs.map((c) => `${c.ordinal}|${c.candidateKind}|${c.confidence}|${c.displayLabel}`)).toEqual([
        "1|UNKNOWN|MEDIUM|Preface content",
        "2|UNKNOWN|HIGH|Combat",
        "3|UNKNOWN|HIGH|Skills",
        "4|UNKNOWN|HIGH|Targeting",
        "5|UNKNOWN|HIGH|Effects",
        "6|REFERENCE|HIGH|Difficulty Classes",
        "7|UNKNOWN|HIGH|Maneuvers",
      ]);
      expect(cs.some((c) => ["FORMULA", "REQUIREMENT", "KEYWORD", "ENTITY"].includes(c.candidateKind))).toBe(false);
      expect(cs.find((c) => c.displayLabel === "Maneuvers")!.supportingSources.length).toBe(10);
      expect(cs.find((c) => c.displayLabel === "Difficulty Classes")!.payload).toMatchObject({ unitType: "TABLE", rowCount: 3, columnCount: 2, hasHeader: true, caption: "Difficulty Classes" });
      expect(cs.some((c) => c.displayLabel === "Art" || c.displayLabel === "Spellcasting")).toBe(false);
      expect(await prisma.sourceAsset.count({ where: { sourceSnapshotId: f.structure.snapshot.id } })).toBe(1); // the image is preserved, not interpreted
      expect(JSON.stringify(cs.map((c) => c.payload))).not.toMatch(/floor|Requires Expert/);
    });
  });

  describe("§62 / §63 scope", () => {
    it("every anchor of a SNAPSHOT Batch belongs to its Snapshot", async () => {
      const f = await ingested("snapshot-scope");
      const other = await ingested("snapshot-scope-other");
      const batch = await batchFor(f.structure.snapshot.id);
      await extractImportBatch(batch.id);
      const own = new Set<string>([...f.structure.sections.map((s) => s.id), ...f.structure.nodes.map((n) => n.id)]);
      for (const c of await listExtractionCandidates(batch.id)) {
        expect(c.sourceSnapshotId).toBe(f.structure.snapshot.id);
        for (const id of [c.primarySourceSectionId, c.primarySourceContentNodeId, ...c.supportingSources.flatMap((s) => [s.sourceSectionId, s.sourceContentNodeId])].filter(Boolean)) expect(own.has(id as string)).toBe(true);
      }
      expect(await prisma.extractionCandidate.count({ where: { sourceSnapshotId: other.structure.snapshot.id } })).toBe(0);
    });

    it("a SECTION_SUBTREE Batch on Spellcasting extracts only that subtree", async () => {
      const f = await ingested("subtree");
      const batch = await batchFor(f.structure.snapshot.id, { scope: { type: "SECTION_SUBTREE", sectionId: f.section("Spellcasting") } });
      await extractImportBatch(batch.id);
      expect((await listExtractionCandidates(batch.id)).map((c) => c.displayLabel)).toEqual(["Targeting", "Effects", "Difficulty Classes"]);
    });
  });

  describe("§65 / §66 / §67 reruns, nondeterminism, versions", () => {
    it("re-extracting returns the same committed set: same ids, fingerprints and hash, no new rows", async () => {
      const f = await ingested("rerun");
      const batch = await batchFor(f.structure.snapshot.id);
      const first = await extractImportBatch(batch.id);
      const before = await listExtractionCandidates(batch.id);
      const again = await extractImportBatch(batch.id);
      expect(again.alreadyExtracted).toBe(true);
      expect(again.extractionOutputHash).toBe(first.extractionOutputHash);
      expect(again.batch).toEqual(first.batch);
      expect(await listExtractionCandidates(batch.id)).toEqual(before);
      expect(await getExtractionResult(batch.id)).toEqual({ ...again });
      expect(await verifyExtractionOutput(batch.id)).toMatchObject({ persistedSetMatches: true, extractorOutputMatches: true, storedOutputHash: first.extractionOutputHash });
    });

    it("the same key@version producing different output fails closed with NONDETERMINISTIC_OUTPUT; history is unchanged", async () => {
      const f = await ingested("nondeterminism");
      const batch = await batchFor(f.structure.snapshot.id);
      await extractImportBatch(batch.id);
      const before = { batch: await getImportBatch(batch.id), candidates: await listExtractionCandidates(batch.id) };
      const mutated = registryWith((ctx) => structuralExtractorV1.extract(ctx).map((c) => ({ ...c, displayLabel: `${c.displayLabel} (changed)` })));
      await expectCode(extractImportBatchWith(mutated, batch.id), IMPORT_BATCH_ERROR_CODES.NONDETERMINISTIC_OUTPUT);
      expect(await verifyExtractionOutputWith(mutated, batch.id)).toMatchObject({ persistedSetMatches: true, extractorOutputMatches: false });
      expect({ batch: await getImportBatch(batch.id), candidates: await listExtractionCandidates(batch.id) }).toEqual(before);
    });

    it("prowess.structural@2 is a different Batch; extracting it never touches the @1 Batch", async () => {
      const f = await ingested("versions");
      const v1 = await batchFor(f.structure.snapshot.id);
      const v2 = await batchFor(f.structure.snapshot.id, { extractorVersion: "2" });
      expect(v2.batchFingerprint).not.toBe(v1.batchFingerprint);
      await extractImportBatch(v1.id);
      const v1Before = { batch: await getImportBatch(v1.id), candidates: await listExtractionCandidates(v1.id) };
      await expectCode(extractImportBatch(v2.id), IMPORT_BATCH_ERROR_CODES.EXTRACTOR_NOT_FOUND, "v2 is not registered officially");
      const withV2 = new ExtractorRegistry([structuralExtractorV1, { ...structuralExtractorV1, version: "2", extract: (ctx) => structuralExtractorV1.extract(ctx).slice(0, 2) }]);
      const r2 = await extractImportBatchWith(withV2, v2.id);
      expect(r2.candidateCount).toBe(2);
      expect({ batch: await getImportBatch(v1.id), candidates: await listExtractionCandidates(v1.id) }).toEqual(v1Before);
    });
  });

  describe("§68 / §69 controlled failures write nothing and leave the Batch CREATED", () => {
    it("an unregistered exact extractor (e.g. manual-foundation) is EXTRACTOR_NOT_FOUND", async () => {
      const f = await ingested("unknown");
      const batch = await batchFor(f.structure.snapshot.id, { extractorKey: "manual-foundation", extractorVersion: "1.0" });
      await expectCode(extractImportBatch(batch.id), IMPORT_BATCH_ERROR_CODES.EXTRACTOR_NOT_FOUND);
      const configured = await batchFor(f.structure.snapshot.id, { extractorConfigHash: "e".repeat(64) });
      await expectCode(extractImportBatch(configured.id), IMPORT_BATCH_ERROR_CODES.EXTRACTOR_NOT_FOUND, "v1 accepts no configuration");
      for (const b of [batch, configured]) {
        expect(await counts(b.id)).toEqual({ candidates: 0, sources: 0 });
        expect((await getImportBatch(b.id)).status).toBe("CREATED");
      }
      await expectCode(getExtractionResult(batch.id), IMPORT_BATCH_ERROR_CODES.NOT_EXTRACTED);
    });

    it("duplicate ordinals, a foreign anchor, an undeclared schema, a paraphrased excerpt, or a thrown extractor reject the WHOLE output", async () => {
      const f = await ingested("invalid");
      const other = await ingested("invalid-other");
      const foreign = other.structure.nodes[1]!.id;
      const bad: Array<[string, ExtractorRegistry]> = [
        ["duplicate ordinal", registryWith((ctx) => structuralExtractorV1.extract(ctx).map((c) => ({ ...c, ordinal: 1 })))],
        ["foreign anchor", registryWith((ctx) => structuralExtractorV1.extract(ctx).map((c, i) => (i === 2 ? { ...c, supportingSourceAnchors: [{ contentNodeId: foreign }] } : c)))],
        ["undeclared schema", registryWith((ctx) => structuralExtractorV1.extract(ctx).map((c) => ({ ...c, payloadSchemaKey: "prowess.semantic.skill" })))],
        ["paraphrased excerpt (database validation)", registryWith((ctx) => structuralExtractorV1.extract(ctx).map((c, i) => (i === 1 ? { ...c, supportingSourceAnchors: [{ ...c.supportingSourceAnchors![0]!, excerpt: "Combat is fought in turns" }] } : c)))],
        ["thrown", registryWith(() => { throw new Error("extractor crashed"); })],
      ];
      const batch = await batchFor(f.structure.snapshot.id);
      for (const [label, registry] of bad) {
        await expectCode(extractImportBatchWith(registry, batch.id), IMPORT_BATCH_ERROR_CODES.INVALID_EXTRACTOR_OUTPUT, label);
        expect(await counts(batch.id), label).toEqual({ candidates: 0, sources: 0 });
        expect(await getImportBatch(batch.id), label).toMatchObject({ status: "CREATED", extractionOutputHash: null, extractedAt: null });
      }
      expect((await extractImportBatch(batch.id)).alreadyExtracted).toBe(false); // ...and the Batch still extracts cleanly afterwards
    });

    it("a database failure inside the commit rolls everything back (no Candidates, no hash, still CREATED)", async () => {
      const f = await ingested("rollback");
      const batch = await batchFor(f.structure.snapshot.id);
      const poisoned = registryWith((ctx) => structuralExtractorV1.extract(ctx).map((c, i, all) => (i === all.length - 1 ? { ...c, displayLabel: "bad\u0000label" } : c)));
      const error = await extractImportBatchWith(poisoned, batch.id).then(() => null, (e: unknown) => e);
      expect(error).not.toBeNull();
      expect(error).not.toBeInstanceOf(DomainError); // a raw database failure is neither swallowed nor relabelled
      expect(await counts(batch.id)).toEqual({ candidates: 0, sources: 0 });
      expect(await getImportBatch(batch.id)).toMatchObject({ status: "CREATED", extractionOutputHash: null, extractedAt: null });
    });
  });

  describe("manual recording and extraction never mix", () => {
    it("a Batch holding manual Candidates cannot be auto-extracted; an extracted Batch accepts no more Candidates", async () => {
      const f = await ingested("manual-mix");
      const manual = await batchFor(f.structure.snapshot.id, { extractorConfigHash: null, label: "manual first" });
      const anchor: CreateExtractionCandidateInput = { ordinal: 1, candidateKind: "UNKNOWN", displayLabel: "m", confidence: "LOW", payloadSchemaKey: "prowess.test", payloadSchemaVersion: 1, payloadJson: {}, primarySourceAnchor: { sectionId: f.section("Combat") } };
      await recordExtractionCandidates(manual.id, [anchor]);
      await expectCode(extractImportBatch(manual.id), IMPORT_BATCH_ERROR_CODES.EXTRACTION_CONFLICT);
      expect(await counts(manual.id)).toEqual({ candidates: 1, sources: 0 });

      const g = await ingested("manual-after");
      const extracted = await batchFor(g.structure.snapshot.id);
      await extractImportBatch(extracted.id);
      await expectCode(recordExtractionCandidates(extracted.id, [{ ...anchor, ordinal: 999, primarySourceAnchor: { sectionId: g.section("Combat") } }]), IMPORT_BATCH_ERROR_CODES.EXTRACTION_CONFLICT);
      expect(EXTRACTION_CANDIDATE_ERROR_CODES.NOT_FOUND).toBeDefined();
    });
  });

  describe("§70 concurrency", () => {
    it("concurrent extractions of one Batch commit exactly one Candidate set", async () => {
      const f = await ingested("concurrent");
      const batch = await batchFor(f.structure.snapshot.id);
      const results = await Promise.all(Array.from({ length: 4 }, () => extractImportBatch(batch.id)));
      expect(results.filter((r) => !r.alreadyExtracted).length).toBe(1);
      expect(new Set(results.map((r) => r.extractionOutputHash)).size).toBe(1);
      const cs = await listExtractionCandidates(batch.id);
      expect(cs.map((c) => c.ordinal)).toEqual(cs.map((_, i) => i + 1));
      expect(await counts(batch.id)).toEqual({ candidates: 7, sources: cs.reduce((n, c) => n + c.supportingSources.length, 0) });
      expect((await getImportBatch(batch.id)).status).toBe("READY_FOR_REVIEW");
    });
  });

  describe("§71 / §72 / §44–§47 immutability", () => {
    it("extraction changes nothing but the three import tables — source structure, M1 domain and M2 governance are byte-identical", async () => {
      const f = await ingested("immutability");
      const batch = await batchFor(f.structure.snapshot.id);
      const source = await fingerprint(SOURCE_TABLES);
      const everythingElse = await fingerprint(undefined, IMPORT_TABLES);
      await extractImportBatch(batch.id);
      await verifyExtractionOutput(batch.id);
      expect(await fingerprint(SOURCE_TABLES)).toEqual(source);
      expect(await fingerprint(undefined, IMPORT_TABLES)).toEqual(everythingElse);
    });
  });

  describe("lifecycle guards and database CHECKs", () => {
    it("a Batch in review is ALREADY_REVIEWING; the database refuses a READY_FOR_REVIEW Batch without an output hash", async () => {
      const f = await ingested("lifecycle");
      const batch = await batchFor(f.structure.snapshot.id);
      await extractImportBatch(batch.id);
      await prisma.importBatch.update({ where: { id: batch.id }, data: { status: "REVIEWING" } }); // test-only: WO6 will own this transition
      await expectCode(extractImportBatch(batch.id), IMPORT_BATCH_ERROR_CODES.ALREADY_REVIEWING);
      const fresh = await batchFor(f.structure.snapshot.id, { scope: { type: "SECTION_SUBTREE", sectionId: f.section("Skills") } });
      await expect(prisma.importBatch.update({ where: { id: fresh.id }, data: { status: "READY_FOR_REVIEW" } })).rejects.toThrow(/extraction_status_check|check/i);
      await expect(prisma.importBatch.update({ where: { id: fresh.id }, data: { extractionOutputHash: "a".repeat(64) } })).rejects.toThrow(/check/i);
      await expect(prisma.importBatch.update({ where: { id: fresh.id }, data: { status: "READY_FOR_REVIEW", extractionOutputHash: "NOT-HEX", extractedAt: new Date() } })).rejects.toThrow(/check/i);
      expect(await getImportBatch(fresh.id)).toMatchObject({ status: "CREATED", extractionOutputHash: null });
    });
  });

  describe("§74 large structure (beyond PostgreSQL's 32,767 bind-parameter limit)", () => {
    it("extracts, commits, re-verifies and reads back thousands of units and >32,767 supporting anchors in order", async () => {
      const blocks: FxBlock[] = [{ kind: "p", text: "Preface." }];
      for (let c = 0; c < 60; c += 1) {
        blocks.push({ kind: "heading", level: 1, text: `Chapter ${c}` });
        for (let s = 0; s < 10; s += 1) {
          blocks.push({ kind: "heading", level: 2, text: `Section ${c}.${s}` });
          for (let p = 0; p < 50; p += 1) blocks.push({ kind: p % 7 === 0 ? "bullet" : "p", text: `Paragraph ${c}.${s}.${p}.` });
          blocks.push(...(TABLES.blocks.slice(1) as FxBlock[]), ...(MISSION_TABLES.blocks.slice(2) as FxBlock[]));
        }
      }
      const f = await ingested("large", { blocks });
      const batch = await batchFor(f.structure.snapshot.id);
      const r = await extractImportBatch(batch.id);
      const sections = 600; // chapter headings are pure containers
      const tables = 600 * 4;
      expect(r.candidateCount).toBe(1 + sections + tables);
      const c = await counts(batch.id);
      expect(c.sources).toBeGreaterThan(32_767);
      const cs = await listExtractionCandidates(batch.id);
      expect(cs.length).toBe(r.candidateCount);
      expect(cs.map((x) => x.ordinal)).toEqual(cs.map((_, i) => i + 1));
      expect(cs[0]!.displayLabel).toBe("Preface content");
      expect(cs[1]!.displayLabel).toBe("Section 0.0");
      expect(await verifyExtractionOutput(batch.id)).toMatchObject({ persistedSetMatches: true, extractorOutputMatches: true });
      expect((await extractImportBatch(batch.id)).alreadyExtracted).toBe(true);
    }, 300_000);
  });

  describe("registry", () => {
    it("the default registry is exactly the official structural extractor", () => {
      expect(defaultExtractorRegistry.keys()).toEqual(["prowess.structural@1"]);
    });
    it("IMPORT_SCOPE fixture still extracts (WO2 fixtures remain usable)", async () => {
      const f = await ingested("import-scope", IMPORT_SCOPE);
      const batch = await batchFor(f.structure.snapshot.id);
      expect((await extractImportBatch(batch.id)).candidateCount).toBeGreaterThan(0);
    });
  });
});
