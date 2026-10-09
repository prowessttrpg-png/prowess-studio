/**
 * M3-WO5 — Formula, Requirement & Keyword Semantic Extraction, database integration (prowess_studio_test only).
 * Synthetic DOCX fixtures ingested through WO1; semantic extraction runs through the EXISTING WO2/WO3 services
 * (createImportBatch + extractImportBatch) with extractor prowess.semantic-foundation@1. No schema change.
 */
import { DomainError, type CreateImportBatchInput } from "@prowess/model";
import { ExtractorRegistry, semanticFoundationExtractorV1, structuralExtractorV1 } from "@prowess/import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEntity,
  createEntityAlias,
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
  verifyExtractionOutput,
} from "../../src/index";
import { extractImportBatchWith } from "../../src/extraction/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { buildDocx, type FxBlock, type FxDocument } from "../fixtures/docx-builder";
import { getTestDatabaseUrl } from "./env";

const STAMP = Date.now();
const DOC_PREFIX = `M3SEM ${STAMP} `;
const KEY_PREFIX = `test.m3sem${STAMP}`;
const IMPORT_TABLES = ["import_batches", "extraction_candidates", "extraction_candidate_sources"];
const SOURCE_TABLES = ["source_documents", "source_snapshots", "source_snapshot_ingestions", "source_sections", "source_blocks", "source_tables", "source_assets", "source_asset_placements", "source_content_nodes", "source_references"];

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

const SOURCE: FxDocument = {
  blocks: [
    { kind: "heading", level: 1, text: "Combat" },
    { kind: "p", text: "Keywords: Melee, Reach" },
    { kind: "p", text: "This calculation requires the player to know their Prowess score." },
    { kind: "heading", level: 1, text: "Skills" },
    { kind: "p", text: "Prerequisite: Trained Arcana" },
    { kind: "heading", level: 1, text: "Spellcasting" },
    { kind: "p", text: "Spell AP = floor(Final MP / PRO), minimum 1." },
    { kind: "p", text: "Formula: Range = 15 × PER. Keywords: Range, Magic." },
    { kind: "p", text: "Requires: Expert Emission" },
    { kind: "p", text: "This spell deals Damage over time. The Mage may move 15 feet." },
    { kind: "table", headerRows: 1, rows: [["Name", "Keywords", "Formula"], ["Bolt", "Damage, Ongoing", "HP = CON × 5"]] },
  ],
};

async function ingested(label: string, doc: FxDocument = SOURCE) {
  const d = await createSourceDocument({ title: `${DOC_PREFIX}${label}`, sourceType: "DOCUMENT", authorityStatus: "REFERENCE_ONLY" });
  const { snapshot } = await ingestSourceSnapshot(d.id, buildDocx(doc), { label, originalFilename: `${label}.docx`, mimeType: DOCX_MIME_TYPE });
  const structure = await getSourceStructure(snapshot.id);
  return { snapshotId: snapshot.id, structure, section: (t: string) => structure.sections.find((s) => s.title === t)!.id };
}
const semantic = (snapshotId: string, over: Partial<CreateImportBatchInput> = {}) =>
  createImportBatch({ sourceSnapshotId: snapshotId, label: "Semantic", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.semantic-foundation", extractorVersion: "1", ...over }).then((r) => r.batch);

describe("M3-WO5 semantic extraction (prowess_studio_test only)", () => {
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
    await prisma.entityAlias.deleteMany({ where: { entity: { canonicalKey: { startsWith: KEY_PREFIX } } } });
    await prisma.entity.deleteMany({ where: { canonicalKey: { startsWith: KEY_PREFIX } } });
  }, 300_000);

  it("§59–§69 explicit statements become FORMULA / REQUIREMENT / KEYWORD candidates in source order; prose yields nothing", async () => {
    const f = await ingested("explicit");
    const batch = await semantic(f.snapshotId);
    const r = await extractImportBatch(batch.id);
    expect(r).toMatchObject({ alreadyExtracted: false, batch: { status: "READY_FOR_REVIEW" } });
    const cs = await listExtractionCandidates(batch.id);
    expect(cs.map((c) => `${c.candidateKind}|${c.displayLabel}|${c.confidence}`)).toEqual([
      "KEYWORD|Melee|HIGH",
      "KEYWORD|Reach|HIGH",
      "REQUIREMENT|Prerequisite: Trained Arcana|HIGH",
      "FORMULA|Spell AP|HIGH",
      "FORMULA|Range|HIGH",
      "KEYWORD|Range|HIGH",
      "KEYWORD|Magic|HIGH",
      "REQUIREMENT|Requires: Expert Emission|HIGH",
      "KEYWORD|Damage|HIGH",
      "KEYWORD|Ongoing|HIGH",
      "FORMULA|HP|MEDIUM",
    ]);
    expect(cs.every((c) => c.status === "UNREVIEWED" && c.proposedEntityType === null && c.proposedCanonicalKey === null)).toBe(true);
    expect(cs.find((c) => c.displayLabel === "Spell AP")!.payload).toMatchObject({ leftHandText: "Spell AP", expressionText: "floor(Final MP / PRO)", qualifiers: ["minimum 1"], terms: ["Final MP", "PRO"], sectionPath: "Spellcasting" });
    expect(cs.find((c) => c.displayLabel === "Damage")!.payload).toMatchObject({ rowIndex: 1, columnIndex: 1, headerText: "Keywords" });
    // §29 every cited text is an exact substring of the anchored source (also enforced by the database's excerpt check)
    const nodes = new Map(f.structure.nodes.map((n) => [n.id as string, n]));
    for (const c of cs) {
      const node = nodes.get(c.primarySourceContentNodeId as string)!;
      const p = c.payload as Record<string, unknown>;
      const text = node.nodeType === "BLOCK" ? node.block.rawText : node.nodeType === "TABLE" ? node.table.structure.rows[p.rowIndex as number]!.cells.find((x) => x.columnIndex === p.columnIndex)!.rawText : "";
      const cited = (p.rawText ?? p.rawRequirementText ?? p.authoredLabel) as string;
      expect(text.slice(p.startOffset as number, p.endOffset as number)).toBe(cited);
      expect(c.supportingSources[0]).toMatchObject({ sourceContentNodeId: c.primarySourceContentNodeId, excerpt: cited });
    }
  });

  it("§70 / §47 a structural Batch and a semantic Batch over the same Snapshot are independent and immutable", async () => {
    const f = await ingested("two-extractors");
    const structural = (await createImportBatch({ sourceSnapshotId: f.snapshotId, label: "S", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1" })).batch;
    await extractImportBatch(structural.id);
    const structuralBefore = { batch: await getImportBatch(structural.id), candidates: await listExtractionCandidates(structural.id) };
    const sem = await semantic(f.snapshotId);
    expect(sem.batchFingerprint).not.toBe(structural.batchFingerprint);
    await extractImportBatch(sem.id);
    expect({ batch: await getImportBatch(structural.id), candidates: await listExtractionCandidates(structural.id) }).toEqual(structuralBefore);
    expect((await listExtractionCandidates(structural.id)).every((c) => ["UNKNOWN", "REFERENCE"].includes(c.candidateKind))).toBe(true);
    expect((await listExtractionCandidates(sem.id)).every((c) => ["FORMULA", "REQUIREMENT", "KEYWORD"].includes(c.candidateKind))).toBe(true);
  });

  it("§71 / §72 reruns are idempotent; a v2 semantic extractor is a separate Batch and never touches v1", async () => {
    const f = await ingested("rerun");
    const v1 = await semantic(f.snapshotId);
    const first = await extractImportBatch(v1.id);
    const before = await listExtractionCandidates(v1.id);
    const again = await extractImportBatch(v1.id);
    expect(again).toMatchObject({ alreadyExtracted: true, extractionOutputHash: first.extractionOutputHash });
    expect(await listExtractionCandidates(v1.id)).toEqual(before);
    expect(await verifyExtractionOutput(v1.id)).toMatchObject({ persistedSetMatches: true, extractorOutputMatches: true });
    const v2 = await semantic(f.snapshotId, { extractorVersion: "2" });
    expect(v2.batchFingerprint).not.toBe(v1.batchFingerprint);
    const withV2 = new ExtractorRegistry([structuralExtractorV1, semanticFoundationExtractorV1, { ...semanticFoundationExtractorV1, version: "2", extract: (ctx) => semanticFoundationExtractorV1.extract(ctx).filter((c) => c.candidateKind === "KEYWORD").map((c, i) => ({ ...c, ordinal: i + 1 })) }]);
    await extractImportBatchWith(withV2, v2.id);
    expect((await listExtractionCandidates(v2.id)).every((c) => c.candidateKind === "KEYWORD")).toBe(true);
    expect(await listExtractionCandidates(v1.id)).toEqual(before);
    expect((await getExtractionResult(v1.id)).extractionOutputHash).toBe(first.extractionOutputHash);
  });

  it("§73 a Spellcasting-scoped semantic Batch extracts only that subtree", async () => {
    const f = await ingested("scope");
    const batch = await semantic(f.snapshotId, { scope: { type: "SECTION_SUBTREE", sectionId: f.section("Spellcasting") } });
    await extractImportBatch(batch.id);
    const labels = (await listExtractionCandidates(batch.id)).map((c) => c.displayLabel);
    expect(labels).not.toContain("Melee");
    expect(labels).not.toContain("Prerequisite: Trained Arcana");
    expect(labels[0]).toBe("Spell AP");
  });

  it("§77 / §78 / §79 / §44–§46 confidence is not authority, keywords carry no mechanics, nothing is matched or created", async () => {
    const emission = await createEntity({ entityType: "SPELL_TRAIT", canonicalKey: `${KEY_PREFIX}.emission` });
    await createEntityAlias(emission.id, { alias: "Emission" });
    const f = await ingested("isolation");
    const batch = await semantic(f.snapshotId);
    const source = await fingerprint(SOURCE_TABLES);
    const everythingElse = await fingerprint(undefined, IMPORT_TABLES);
    await extractImportBatch(batch.id);
    expect(await fingerprint(SOURCE_TABLES)).toEqual(source);
    expect(await fingerprint(undefined, IMPORT_TABLES)).toEqual(everythingElse); // no definitions, Entities, governance, authority change
    const req = (await listExtractionCandidates(batch.id)).find((c) => c.displayLabel === "Requires: Expert Emission")!;
    expect(req.payload).toMatchObject({ rawRequirementText: "Expert Emission", terms: ["Expert", "Emission"] });
    expect(JSON.stringify(req)).not.toContain(emission.id);
    expect(await prisma.candidateMatchAssessment.count({ where: { importBatchId: batch.id } })).toBe(0); // WO4 is never run automatically
  });

  it("§74 thousands of declarations: bounded, ordered, chunk-safe, hashed and re-verifiable", async () => {
    const blocks: FxBlock[] = [{ kind: "heading", level: 1, text: "Catalogue" }];
    for (let i = 0; i < 1000; i += 1) blocks.push({ kind: "p", text: `Formula: Cost${i} = MP × ${i + 1}. Keywords: Tag${i}, Mark${i}. Requires: Expert Thing${i}` });
    const f = await ingested("large", { blocks });
    const batch = await semantic(f.snapshotId);
    const r = await extractImportBatch(batch.id);
    expect(r.candidateCount).toBe(4000);
    expect(r.summary.byKind).toMatchObject({ FORMULA: 1000, KEYWORD: 2000, REQUIREMENT: 1000 });
    const cs = await listExtractionCandidates(batch.id);
    expect(cs.slice(0, 4).map((c) => c.displayLabel)).toEqual(["Cost0", "Tag0", "Mark0", "Requires: Expert Thing0"]);
    expect(cs.map((c) => c.ordinal)).toEqual(cs.map((_, i) => i + 1));
    expect(await verifyExtractionOutput(batch.id)).toMatchObject({ persistedSetMatches: true, extractorOutputMatches: true });
    expect(DomainError).toBeDefined();
  }, 300_000);
});
