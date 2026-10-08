/**
 * M3-WO1 — Source Document & Source Structure Foundation, database integration (prowess_studio_test only, guarded).
 *
 * CI verification uses small deterministic SYNTHETIC DOCX fixtures (tests/fixtures/), never the real ~898-page
 * "Prowess Core Playtest Packet V0.1". The numbered describe blocks map to the Work Order's required tests 1–18.
 */
import {
  DomainError,
  SOURCE_ASSET_ERROR_CODES,
  SOURCE_DOCUMENT_ERROR_CODES,
  SOURCE_PARSE_ERROR_CODES,
  SOURCE_REFERENCE_ERROR_CODES,
  SOURCE_SNAPSHOT_ERROR_CODES,
  SOURCE_STRUCTURE_ERROR_CODES,
  type SourceStructure,
  type SourceStructureInput,
} from "@prowess/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEntity,
  createEntityVersion,
  createSourceDocument,
  createSourceReference,
  createSourceSnapshot,
  DOCX_MIME_TYPE,
  getEffectiveManifestEntries,
  getRulesetManifest,
  getRulesetRelease,
  getSourceAsset,
  getSourceBlock,
  getSourceDocument,
  getSourceReference,
  getSourceSection,
  getSourceSectionContent,
  getSourceSnapshot,
  getSourceSnapshotIngestion,
  getSourceStructure,
  getSourceTable,
  ingestSourceSnapshot,
  ingestSourceStructure,
  listSourceAssetPlacements,
  listSourceAssets,
  listSourceReferencesForVersion,
  listSourceSectionChildren,
  listSourceSnapshots,
  parseDocxStructure,
  prisma,
  verifyRulesetReleaseManifestHash,
} from "../../src/index";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { buildDocx, type FxBlock } from "../fixtures/docx-builder";
import { CORE_RULES, docx, ILLUSTRATED, MISSION_TABLES, PLAYTEST_PACKET_MINIATURE, SKILL_TIERS, TABLES } from "../fixtures/prowess-structure-fixtures";
import { getTestDatabaseUrl } from "./env";
import { buildM2GoldenHistory, cleanupM2GoldenHistories } from "./fixtures/m2-golden-history";

const PREFIX = `test.m3source.${Date.now()}`;
const GOLDEN_PREFIX = `test.m3golden.${Date.now()}`;
const DOC_PREFIX = `M3S ${Date.now()} `;
let n = 0;
const k = (s: string) => `${PREFIX}.${s}_${++n}`;

const SOURCE_TABLES = [
  "source_snapshots",
  "source_snapshot_ingestions",
  "source_sections",
  "source_blocks",
  "source_tables",
  "source_assets",
  "source_asset_placements",
  "source_content_nodes",
];

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
async function fingerprint(exclude: string[] = []): Promise<Record<string, string>> {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    if (exclude.includes(table_name)) continue;
    const [row] = await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${table_name}" t`);
    out[table_name] = row?.h ?? "";
  }
  return out;
}
const countsFor = async (sourceSnapshotId: string) => ({
  ingestions: await prisma.sourceSnapshotIngestion.count({ where: { sourceSnapshotId } }),
  sections: await prisma.sourceSection.count({ where: { sourceSnapshotId } }),
  blocks: await prisma.sourceBlock.count({ where: { sourceSnapshotId } }),
  tables: await prisma.sourceTable.count({ where: { sourceSnapshotId } }),
  assets: await prisma.sourceAsset.count({ where: { sourceSnapshotId } }),
  placements: await prisma.sourceAssetPlacement.count({ where: { sourceSnapshotId } }),
  nodes: await prisma.sourceContentNode.count({ where: { sourceSnapshotId } }),
});
const doc = (label: string, extra: Record<string, unknown> = {}) => createSourceDocument({ title: `${DOC_PREFIX}${label}`, sourceType: "DOCUMENT", ...extra });
const ingest = (documentId: string, bytes: Buffer, label = "V0.1") =>
  ingestSourceSnapshot(documentId, bytes, { label, originalFilename: `packet-${label}.docx`, mimeType: DOCX_MIME_TYPE, declaredVersion: label, declaredDraftState: "Playtest" });
const flow = (s: SourceStructure) =>
  s.nodes.map((node) => (node.nodeType === "BLOCK" ? `B:${node.block.rawText}` : node.nodeType === "TABLE" ? `T:${node.table.ordinal}` : `I:${node.asset.contentHash.slice(0, 8)}`));
/** A structure the validator accepts but PostgreSQL rejects late (NUL byte in the LAST block), to force a rollback. */
function poisoned(input: SourceStructureInput): SourceStructureInput {
  const copy = structuredClone(input);
  const last = [...copy.nodes].reverse().find((x) => x.nodeType === "BLOCK");
  if (last && last.nodeType === "BLOCK") last.block.rawText = `${last.block.rawText}\u0000`;
  return copy;
}

describe("M3-WO1 source structure (prowess_studio_test only)", () => {
  beforeAll(() => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
  });

  afterAll(async () => {
    await cleanupM2GoldenHistories(GOLDEN_PREFIX); // first: it owns conflict candidates that cite its references
    const docs = (await prisma.sourceDocument.findMany({ where: { title: { startsWith: DOC_PREFIX } }, select: { id: true } })).map((d) => d.id);
    const snaps = (await prisma.sourceSnapshot.findMany({ where: { sourceDocumentId: { in: docs } }, select: { id: true } })).map((s) => s.id);
    const inSnap = { sourceSnapshotId: { in: snaps } };
    await prisma.sourceReference.deleteMany({ where: { sourceDocumentId: { in: docs } } });
    await prisma.sourceContentNode.deleteMany({ where: inSnap });
    await prisma.sourceAssetPlacement.deleteMany({ where: inSnap });
    await prisma.sourceBlock.deleteMany({ where: inSnap });
    await prisma.sourceTable.deleteMany({ where: inSnap });
    await prisma.sourceAsset.deleteMany({ where: inSnap });
    // Sections reference their parent (RESTRICT): delete children first — a child's ordinal is always greater.
    const sections = await prisma.sourceSection.findMany({ where: inSnap, select: { id: true }, orderBy: [{ ordinal: "desc" }] });
    for (const s of sections) await prisma.sourceSection.delete({ where: { id: s.id } });
    await prisma.sourceSnapshotIngestion.deleteMany({ where: inSnap });
    await prisma.sourceSnapshot.deleteMany({ where: { id: { in: snaps } } });
    const entityIds = (await prisma.entity.findMany({ where: { canonicalKey: { startsWith: PREFIX } }, select: { id: true } })).map((e) => e.id);
    await prisma.sourceReference.deleteMany({ where: { entityVersion: { entityId: { in: entityIds } } } });
    await prisma.entityVersion.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
    await prisma.sourceDocument.deleteMany({ where: { id: { in: docs } } });
  }, 120_000);

  describe("1 + 3. a stable SourceDocument can have multiple immutable Snapshots; changed bytes create a new one", () => {
    it("Draft V0.1 -> Draft V0.2 creates a second Snapshot of the SAME document and never overwrites V0.1", async () => {
      const d = await doc("versions");
      const v1 = await ingest(d.id, docx(CORE_RULES), "V0.1");
      const v1Before = await getSourceStructure(v1.snapshot.id);
      const v2 = await ingest(d.id, docx({ ...CORE_RULES, blocks: [...CORE_RULES.blocks, { kind: "p", text: "Added in V0.2." }] }), "V0.2");
      expect(v2.createdSnapshot).toBe(true);
      expect(v2.snapshot.id).not.toBe(v1.snapshot.id);
      expect(v2.snapshot.sourceDocumentId).toBe(d.id);
      expect(v2.snapshot.contentHash).not.toBe(v1.snapshot.contentHash);
      expect((await listSourceSnapshots(d.id)).map((s) => s.label)).toEqual(["V0.1", "V0.2"]);
      expect(await getSourceStructure(v1.snapshot.id)).toEqual(v1Before);
      expect(flow(await getSourceStructure(v2.snapshot.id)).at(-1)).toBe("B:Added in V0.2.");
      expect(await getSourceDocument(d.id)).toEqual(d); // the document itself is untouched
    });

    it("Snapshot metadata is exact and descriptive only: declared version/draft state never set document authority", async () => {
      const d = await doc("metadata");
      const bytes = docx(CORE_RULES);
      const { snapshot } = await ingest(d.id, bytes, "V0.1");
      expect(snapshot).toMatchObject({ label: "V0.1", originalFilename: "packet-V0.1.docx", mimeType: DOCX_MIME_TYPE, byteSize: bytes.length, pageCount: 12, declaredVersion: "V0.1", declaredDraftState: "Playtest" });
      expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect((await getSourceDocument(d.id)).authorityStatus).toBeNull();
    });
  });

  describe("2. duplicate exact Snapshot content", () => {
    it("explicit createSourceSnapshot with already-known bytes is SOURCE_SNAPSHOT.DUPLICATE_CONTENT", async () => {
      const d = await doc("dup-explicit");
      const { snapshot } = await ingest(d.id, docx(CORE_RULES));
      await expectCode(
        createSourceSnapshot(d.id, { label: "again", originalFilename: "x.docx", mimeType: DOCX_MIME_TYPE, contentHash: snapshot.contentHash, byteSize: snapshot.byteSize }),
        SOURCE_SNAPSHOT_ERROR_CODES.DUPLICATE_CONTENT,
      );
    });

    it("re-ingesting the same bytes is idempotent: same Snapshot, no new rows", async () => {
      const d = await doc("dup-ingest");
      const bytes = docx(PLAYTEST_PACKET_MINIATURE);
      const first = await ingest(d.id, bytes);
      const counts = await countsFor(first.snapshot.id);
      const again = await ingest(d.id, Buffer.from(bytes), "relabelled");
      expect([again.createdSnapshot, again.createdStructure]).toEqual([false, false]);
      expect(again.snapshot).toEqual(first.snapshot);
      expect(again.ingestion).toEqual(first.ingestion);
      expect(await countsFor(first.snapshot.id)).toEqual(counts);
      expect(await prisma.sourceSnapshot.count({ where: { sourceDocumentId: d.id } })).toBe(1);
    });

    it("the same bytes under a DIFFERENT document are that document's own Snapshot", async () => {
      const bytes = docx(SKILL_TIERS);
      const a = await ingest((await doc("same-bytes-a")).id, bytes);
      const b = await ingest((await doc("same-bytes-b")).id, bytes);
      expect(b.createdSnapshot).toBe(true);
      expect(b.snapshot.id).not.toBe(a.snapshot.id);
      expect(b.snapshot.contentHash).toBe(a.snapshot.contentHash);
    });

    it("concurrent ingestion of the same bytes yields exactly one Snapshot and one structure", async () => {
      const d = await doc("dup-race");
      const bytes = docx(TABLES);
      const results = await Promise.all([ingest(d.id, bytes), ingest(d.id, bytes), ingest(d.id, bytes)]);
      expect(new Set(results.map((r) => r.snapshot.id)).size).toBe(1);
      expect(results.filter((r) => r.createdStructure).length).toBe(1);
      expect((await countsFor(results[0]!.snapshot.id)).ingestions).toBe(1);
    });
  });

  describe("Snapshot immutability after structural ingestion", () => {
    it("re-ingesting a DIFFERENT structure into an ingested Snapshot is SOURCE_SNAPSHOT.IMMUTABLE and writes nothing", async () => {
      const d = await doc("immutable");
      const { snapshot } = await ingest(d.id, docx(CORE_RULES));
      const before = await getSourceStructure(snapshot.id);
      await expectCode(ingestSourceStructure(snapshot.id, parseDocxStructure(docx(SKILL_TIERS)).structure), SOURCE_SNAPSHOT_ERROR_CODES.IMMUTABLE);
      expect(await getSourceStructure(snapshot.id)).toEqual(before);
    });

    it("re-ingesting the SAME structure is a safe no-op", async () => {
      const d = await doc("repeatable");
      const { snapshot, ingestion } = await ingest(d.id, docx(CORE_RULES));
      const again = await ingestSourceStructure(snapshot.id, parseDocxStructure(docx(CORE_RULES)).structure);
      expect(again).toEqual({ ingestion, created: false });
    });

    it("concurrent ingestion of different structures: exactly one wins, every other is IMMUTABLE", async () => {
      const d = await doc("structure-race");
      const snapshot = await createSourceSnapshot(d.id, { label: "s", originalFilename: "s.docx", mimeType: DOCX_MIME_TYPE, contentHash: "b".repeat(64), byteSize: 1 });
      const inputs = [CORE_RULES, SKILL_TIERS, TABLES].map((f) => parseDocxStructure(docx(f)).structure);
      const outcomes = await Promise.all(inputs.map((i) => ingestSourceStructure(snapshot.id, i).then(() => "ok", (e: unknown) => (e as DomainError).code)));
      expect(outcomes.filter((o) => o === "ok").length).toBe(1);
      expect(outcomes.filter((o) => o === SOURCE_SNAPSHOT_ERROR_CODES.IMMUTABLE).length).toBe(2);
      expect((await countsFor(snapshot.id)).ingestions).toBe(1);
    });

    it("no update or delete service exists for Snapshots or structure", async () => {
      const surface = await import("../../src/index");
      const names = Object.keys(surface).filter((x) => /Source(Snapshot|Structure|Section|Block|Table|Asset|ContentNode)/.test(x));
      expect(names.filter((x) => /^(update|delete|remove|set|replace|edit|patch)/.test(x))).toEqual([]);
    });
  });

  describe("4 + 5. nested sections and parent validity", () => {
    it("sections nest recursively and read back through parent links and child listings", async () => {
      const { snapshot } = await ingest((await doc("nesting")).id, docx(SKILL_TIERS));
      const { sections } = await getSourceStructure(snapshot.id);
      const byId = new Map<string, (typeof sections)[number]>(sections.map((s) => [s.id, s]));
      const path = (id: string): string[] => {
        const s = byId.get(id)!;
        return s.parentSectionId ? [...path(s.parentSectionId), s.title] : [s.title];
      };
      const master = sections.find((s) => s.title === "Master")!;
      expect(path(master.id)).toEqual(["Skills", "Athletics", "Master"]);
      const athletics = sections.find((s) => s.title === "Athletics")!;
      expect((await listSourceSectionChildren(athletics.id)).map((s) => s.title)).toEqual(["Trained", "Expert", "Master"]);
      expect(await getSourceSection(master.id)).toEqual(master);
      expect((await getSourceSectionContent(master.id)).map((x) => (x.nodeType === "BLOCK" ? x.block.rawText : x.nodeType))).toEqual(["Master", "You may climb while carrying an ally."]);
    });

    it("the service rejects an invalid parent before anything is written (SOURCE_STRUCTURE.INVALID_PARENT)", async () => {
      const d = await doc("bad-parent");
      const snapshot = await createSourceSnapshot(d.id, { label: "p", originalFilename: "p.docx", mimeType: DOCX_MIME_TYPE, contentHash: "c".repeat(64), byteSize: 1 });
      const input = parseDocxStructure(docx(SKILL_TIERS)).structure;
      (input.sections[1] as { parentKey: string }).parentKey = "does-not-exist";
      await expectCode(ingestSourceStructure(snapshot.id, input), SOURCE_STRUCTURE_ERROR_CODES.INVALID_PARENT);
      expect(await countsFor(snapshot.id)).toEqual({ ingestions: 0, sections: 0, blocks: 0, tables: 0, assets: 0, placements: 0, nodes: 0 });
    });

    it("the DATABASE rejects a section whose parent belongs to another Snapshot", async () => {
      const a = await ingest((await doc("cross-parent-a")).id, docx(CORE_RULES));
      const b = await ingest((await doc("cross-parent-b")).id, docx(SKILL_TIERS));
      const foreignParent = (await getSourceStructure(a.snapshot.id)).sections[0]!;
      await expectDbRejects(
        prisma.sourceSection.create({ data: { sourceSnapshotId: b.snapshot.id, parentSectionId: foreignParent.id, title: "x", headingLevel: 2, ordinal: 999, pageLocationBasis: "UNAVAILABLE" } }),
        /source_sections_parent_fkey|Foreign key/i,
      );
    });
  });

  describe("6 + 7. ordering is preserved", () => {
    it("block order equals source order, with per-kind ordinals contiguous from 0", async () => {
      const bytes = docx(PLAYTEST_PACKET_MINIATURE);
      const parsed = parseDocxStructure(bytes).structure;
      const { snapshot } = await ingest((await doc("block-order")).id, bytes);
      const s = await getSourceStructure(snapshot.id);
      const blocks = s.nodes.flatMap((x) => (x.nodeType === "BLOCK" ? [x.block] : []));
      expect(blocks.map((b) => b.rawText)).toEqual(parsed.nodes.flatMap((x) => (x.nodeType === "BLOCK" ? [x.block.rawText] : [])));
      expect(blocks.map((b) => b.ordinal)).toEqual(blocks.map((_, i) => i));
    });

    it("mixed Block / Table / Asset flow round-trips in exactly the parsed order", async () => {
      const bytes = docx(PLAYTEST_PACKET_MINIATURE);
      const parsed = parseDocxStructure(bytes).structure;
      const { snapshot } = await ingest((await doc("mixed-order")).id, bytes);
      const s = await getSourceStructure(snapshot.id);
      expect(s.nodes.map((x) => x.nodeType)).toEqual(parsed.nodes.map((x) => x.nodeType));
      expect(s.nodes.map((x) => x.ordinal)).toEqual(s.nodes.map((_, i) => i));
      expect(new Set(s.nodes.map((x) => x.nodeType))).toEqual(new Set(["BLOCK", "TABLE", "ASSET_PLACEMENT"]));
      // each node's section is its target's section
      for (const x of s.nodes) {
        const target = x.nodeType === "BLOCK" ? x.block : x.nodeType === "TABLE" ? x.table : x.placement;
        expect(target.sourceSectionId).toBe(x.sourceSectionId);
      }
    });
  });

  describe("8. tables preserve cell structure", () => {
    it("structureJson round-trips exactly (headers, row/col spans, nested tables, verbatim cells)", async () => {
      const bytes = docx(TABLES);
      const parsed = parseDocxStructure(bytes).structure;
      const { snapshot } = await ingest((await doc("tables")).id, bytes);
      const stored = (await getSourceStructure(snapshot.id)).nodes.flatMap((x) => (x.nodeType === "TABLE" ? [x.table] : []));
      const expected = parsed.nodes.flatMap((x) => (x.nodeType === "TABLE" ? [x.table] : []));
      expect(stored.map((t) => t.structure)).toEqual(expected.map((t) => t.structure));
      expect(stored.map((t) => t.caption)).toEqual([null, "Weapon Groups"]);
      expect(await getSourceTable(stored[1]!.id)).toEqual(stored[1]);
      expect(stored[1]!.structure.rows[0]!.cells[0]).toMatchObject({ rawText: "Group", rowSpan: 2 });
    });
  });

  describe("9. assets are represented without semantic analysis", () => {
    it("one asset per distinct bytes, every placement explicit and ordered, metadata from the source only", async () => {
      const { snapshot } = await ingest((await doc("assets")).id, docx(ILLUSTRATED));
      const assets = await listSourceAssets(snapshot.id);
      expect(assets.length).toBe(3);
      expect(assets.map((a) => [a.assetType, a.mimeType, a.width, a.height])).toEqual([["IMAGE", "image/png", 3, 2], ["IMAGE", "image/png", 5, 4], ["IMAGE", "image/png", 2, 7]]);
      const placementsOfFirst = await listSourceAssetPlacements(assets[0]!.id);
      expect(placementsOfFirst.map((p) => p.altTextFromSource)).toEqual(["A full-page illustration", "The same illustration again"]);
      expect(await getSourceAsset(assets[0]!.id)).toEqual(assets[0]);
      expect(Object.keys(assets[0]!).sort()).toEqual(["altTextFromSource", "assetType", "byteSize", "caption", "contentHash", "createdAt", "height", "id", "mimeType", "sourceFilename", "sourceSnapshotId", "width"]);
    });
  });

  describe("10 + 15. cross-snapshot integrity and RESTRICT are enforced by PostgreSQL", () => {
    it("a content node cannot target a block, table, placement or section of another Snapshot", async () => {
      const a = await getSourceStructure((await ingest((await doc("cross-a")).id, docx(PLAYTEST_PACKET_MINIATURE))).snapshot.id);
      const b = await getSourceStructure((await ingest((await doc("cross-b")).id, docx(ILLUSTRATED))).snapshot.id);
      const aBlock = a.nodes.find((x) => x.nodeType === "BLOCK")!;
      const aTable = a.nodes.find((x) => x.nodeType === "TABLE")!;
      const aPlacement = a.nodes.find((x) => x.nodeType === "ASSET_PLACEMENT")!;
      const base = { sourceSnapshotId: b.snapshot.id, ordinal: 10_000 };
      await expectDbRejects(prisma.sourceContentNode.create({ data: { ...base, nodeType: "BLOCK", blockId: aBlock.blockId } }), /source_content_nodes_block_fkey|Unique|Foreign key/i);
      await expectDbRejects(prisma.sourceContentNode.create({ data: { ...base, nodeType: "TABLE", tableId: aTable.tableId } }), /source_content_nodes_table_fkey|Unique|Foreign key/i);
      await expectDbRejects(prisma.sourceContentNode.create({ data: { ...base, nodeType: "ASSET_PLACEMENT", assetPlacementId: aPlacement.assetPlacementId } }), /source_content_nodes_asset_placement_fkey|Unique|Foreign key/i);
      await expectDbRejects(prisma.sourceBlock.create({ data: { sourceSnapshotId: b.snapshot.id, sourceSectionId: a.sections[0]!.id, blockType: "PARAGRAPH", ordinal: 10_000, rawText: "x", pageLocationBasis: "UNAVAILABLE" } }), /source_blocks_section_fkey|Foreign key/i);
      await expectDbRejects(prisma.sourceAssetPlacement.create({ data: { sourceSnapshotId: b.snapshot.id, sourceAssetId: a.assets[0]!.id, ordinal: 10_000, pageLocationBasis: "UNAVAILABLE" } }), /source_asset_placements_asset_fkey|Foreign key/i);
    });

    it("CHECK constraints: a node must have exactly the one target its type names; UNAVAILABLE pages must be null", async () => {
      const s = await getSourceStructure((await ingest((await doc("checks")).id, docx(ILLUSTRATED))).snapshot.id);
      const block = s.nodes.find((x) => x.nodeType === "BLOCK")!;
      await expectDbRejects(prisma.sourceContentNode.create({ data: { sourceSnapshotId: s.snapshot.id, ordinal: 10_001, nodeType: "TABLE" } }), /exactly_one_target|check/i);
      await expectDbRejects(prisma.$executeRawUnsafe(`INSERT INTO source_content_nodes (source_snapshot_id, ordinal, node_type, block_id, table_id) VALUES ('${s.snapshot.id}', 10002, 'BLOCK', '${block.blockId}', '${s.nodes.find((x) => x.nodeType === "TABLE")!.tableId}')`), /exactly_one_target|check|unique/i);
      await expectDbRejects(prisma.sourceBlock.create({ data: { sourceSnapshotId: s.snapshot.id, blockType: "PARAGRAPH", ordinal: 10_003, rawText: "x", pageStart: 4, pageLocationBasis: "UNAVAILABLE" } }), /page_location_check|check/i);
    });

    it("structure cannot be deleted out from under itself, and a document with Snapshots cannot be deleted", async () => {
      const d = await doc("restrict");
      const s = await getSourceStructure((await ingest(d.id, docx(PLAYTEST_PACKET_MINIATURE))).snapshot.id);
      const block = s.nodes.find((x) => x.nodeType === "BLOCK")!;
      await expect(prisma.sourceBlock.delete({ where: { id: block.blockId! } })).rejects.toThrow();
      await expect(prisma.sourceSection.delete({ where: { id: s.sections[0]!.id } })).rejects.toThrow();
      await expect(prisma.sourceAsset.delete({ where: { id: s.assets[0]!.id } })).rejects.toThrow();
      await expect(prisma.sourceSnapshot.delete({ where: { id: s.snapshot.id } })).rejects.toThrow();
      await expect(prisma.sourceDocument.delete({ where: { id: d.id } })).rejects.toThrow();
      expect(await getSourceStructure(s.snapshot.id)).toEqual(s);
    });
  });

  describe("11 + 12. SourceReferences: exact structural locations, M1 references unchanged", () => {
    it("a reference can cite an exact Snapshot / Section / Block / Table, and reads it back", async () => {
      const d = await doc("ref-exact");
      const s = await getSourceStructure((await ingest(d.id, docx(PLAYTEST_PACKET_MINIATURE))).snapshot.id);
      const version = await createEntityVersion((await createEntity({ entityType: "GENERIC_RULE", canonicalKey: k("ref_exact") })).id, { displayName: "Direct Damage" });
      const block = s.nodes.find((x) => x.nodeType === "BLOCK" && x.block.rawText.startsWith("Damage equals"))!;
      const table = s.nodes.find((x) => x.nodeType === "TABLE")!;
      const ref = await createSourceReference(version.id, {
        sourceDocumentId: d.id,
        sectionLabel: "Direct Damage",
        structuralLocation: { sourceSnapshotId: s.snapshot.id, sourceSectionId: block.sourceSectionId, sourceBlockId: block.blockId, sourceTableId: table.tableId },
      });
      expect(ref.structuralLocation).toEqual({ sourceSnapshotId: s.snapshot.id, sourceSectionId: block.sourceSectionId, sourceBlockId: block.blockId, sourceTableId: table.tableId });
      expect(await getSourceReference(ref.id)).toEqual(ref);
      expect((await getSourceBlock(block.blockId!)).rawText).toBe("Damage equals (Power × 2) + Tier − Resistance, minimum 1.");
      const snapshotOnly = await createSourceReference(version.id, { sourceDocumentId: d.id, structuralLocation: { sourceSnapshotId: s.snapshot.id } });
      expect(snapshotOnly.structuralLocation).toEqual({ sourceSnapshotId: s.snapshot.id, sourceSectionId: null, sourceBlockId: null, sourceTableId: null });
    });

    it("mismatched locations are SOURCE_REFERENCE.INVALID_INPUT (wrong document, foreign structure, unknown ids)", async () => {
      const d = await doc("ref-bad");
      const other = await doc("ref-bad-other");
      const mine = await getSourceStructure((await ingest(d.id, docx(CORE_RULES))).snapshot.id);
      const theirs = await getSourceStructure((await ingest(other.id, docx(SKILL_TIERS))).snapshot.id);
      const version = await createEntityVersion((await createEntity({ entityType: "GENERIC_RULE", canonicalKey: k("ref_bad") })).id, { displayName: "x" });
      const bad = (structuralLocation: Record<string, unknown>) => createSourceReference(version.id, { sourceDocumentId: d.id, structuralLocation: structuralLocation as never });
      await expectCode(bad({ sourceSnapshotId: theirs.snapshot.id }), SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT, "snapshot of another document");
      await expectCode(bad({ sourceSnapshotId: mine.snapshot.id, sourceSectionId: theirs.sections[0]!.id }), SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT, "section of another snapshot");
      await expectCode(bad({ sourceSnapshotId: mine.snapshot.id, sourceBlockId: theirs.nodes.find((x) => x.nodeType === "BLOCK")!.blockId }), SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT, "block of another snapshot");
      await expectCode(bad({ sourceSnapshotId: "00000000-0000-4000-8000-000000000000" }), SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT, "unknown snapshot");
      await expectCode(bad({ sourceSnapshotId: "not-a-uuid" }), SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT, "malformed snapshot id");
      await expectCode(bad({ sourceSectionId: mine.sections[0]!.id }), SOURCE_REFERENCE_ERROR_CODES.INVALID_INPUT, "locator without snapshot");
      expect(await listSourceReferencesForVersion(version.id)).toEqual([]);
    });

    it("the DATABASE independently rejects a mismatched or snapshot-less locator", async () => {
      const d = await doc("ref-db");
      const other = await doc("ref-db-other");
      const mine = await getSourceStructure((await ingest(d.id, docx(CORE_RULES))).snapshot.id);
      const theirs = await getSourceStructure((await ingest(other.id, docx(SKILL_TIERS))).snapshot.id);
      const version = await createEntityVersion((await createEntity({ entityType: "GENERIC_RULE", canonicalKey: k("ref_db") })).id, { displayName: "x" });
      const base = { sourceDocumentId: d.id, entityVersionId: version.id };
      await expectDbRejects(prisma.sourceReference.create({ data: { ...base, sourceSnapshotId: theirs.snapshot.id } }), /source_references_snapshot_fkey|Foreign key/i);
      await expectDbRejects(prisma.sourceReference.create({ data: { ...base, sourceSnapshotId: mine.snapshot.id, sourceSectionId: theirs.sections[0]!.id } }), /source_references_section_fkey|Foreign key/i);
      await expectDbRejects(prisma.sourceReference.create({ data: { ...base, sourceSectionId: mine.sections[0]!.id } }), /locator_requires_snapshot|check/i);
    });

    it("M1-style references (no structural location) are created and read exactly as before", async () => {
      const d = await doc("ref-m1");
      const version = await createEntityVersion((await createEntity({ entityType: "GENERIC_RULE", canonicalKey: k("ref_m1") })).id, { displayName: "Legacy" });
      const ref = await createSourceReference(version.id, { sourceDocumentId: d.id, sectionLabel: "Spell AP Cost", pageReference: "14-16", sourceExcerptNote: "note" });
      expect(ref).toMatchObject({ sectionLabel: "Spell AP Cost", pageReference: "14-16", sourceExcerptNote: "note", structuralLocation: null });
      expect(await listSourceReferencesForVersion(version.id)).toEqual([ref]);
      const row = await prisma.sourceReference.findUnique({ where: { id: ref.id } });
      expect([row?.sourceSnapshotId, row?.sourceSectionId, row?.sourceBlockId, row?.sourceTableId]).toEqual([null, null, null, null]);
    });
  });

  describe("13. an old Snapshot reads back identically after newer Snapshots exist", () => {
    it("re-reading V0.1 after V0.2 and V0.3 returns byte-identical structure", async () => {
      const d = await doc("reread");
      const v1 = await ingest(d.id, docx(PLAYTEST_PACKET_MINIATURE), "V0.1");
      const before = JSON.stringify(await getSourceStructure(v1.snapshot.id));
      await ingest(d.id, docx({ ...PLAYTEST_PACKET_MINIATURE, blocks: PLAYTEST_PACKET_MINIATURE.blocks.slice(5) }), "V0.2");
      await ingest(d.id, docx({ ...PLAYTEST_PACKET_MINIATURE, blocks: [...PLAYTEST_PACKET_MINIATURE.blocks].reverse() }), "V0.3");
      expect(JSON.stringify(await getSourceStructure(v1.snapshot.id))).toBe(before);
      expect(await getSourceSnapshotIngestion(v1.snapshot.id)).toEqual(v1.ingestion);
    });
  });

  describe("14. structural ingestion changes nothing outside the source-structure tables", () => {
    it("Entities, Versions, Rulesets, Manifests, policies, conflicts, decisions, ChangeSets and Releases are byte-identical; M2 history still verifies", async () => {
      const g = await buildM2GoldenHistory(GOLDEN_PREFIX);
      const historical = async () => ({
        R1: await getRulesetRelease(g.releases.R1.id),
        R2: await getRulesetRelease(g.releases.R2.id),
        M1: await getRulesetManifest(g.manifests.M1.id),
        M2effective: await getEffectiveManifestEntries(g.manifests.M2.id),
      });
      const historyBefore = await historical();
      const d = await doc("isolation");
      const before = await fingerprint([...SOURCE_TABLES, "source_documents"]);
      await ingest(d.id, docx(PLAYTEST_PACKET_MINIATURE));
      await ingest(d.id, docx(CORE_RULES), "V0.2");
      expect(await fingerprint([...SOURCE_TABLES, "source_documents"])).toEqual(before);
      expect(await historical()).toEqual(historyBefore);
      for (const r of [g.releases.R1, g.releases.R2]) expect((await verifyRulesetReleaseManifestHash(r.id)).valid).toBe(true);
    }, 60_000);
  });

  describe("16. a failed ingestion rolls back completely", () => {
    it("a database failure late in the transaction leaves no ingestion, section, block, table, asset, placement or node", async () => {
      const d = await doc("rollback");
      const snapshot = await createSourceSnapshot(d.id, { label: "r", originalFilename: "r.docx", mimeType: DOCX_MIME_TYPE, contentHash: "d".repeat(64), byteSize: 1 });
      const good = parseDocxStructure(docx(PLAYTEST_PACKET_MINIATURE)).structure;
      const failure = await ingestSourceStructure(snapshot.id, poisoned(good)).then(() => null, (e: unknown) => e);
      expect(failure).not.toBeNull();
      expect(failure).not.toBeInstanceOf(DomainError); // a raw database failure is NOT swallowed or relabelled
      expect(await countsFor(snapshot.id)).toEqual({ ingestions: 0, sections: 0, blocks: 0, tables: 0, assets: 0, placements: 0, nodes: 0 });
      // ...and ingestion is safely repeatable afterwards
      expect((await ingestSourceStructure(snapshot.id, good)).created).toBe(true);
      expect((await countsFor(snapshot.id)).nodes).toBe(good.nodes.length);
    });

    it("malformed or unsupported bytes write nothing at all", async () => {
      const d = await doc("bad-bytes");
      await expectCode(ingest(d.id, Buffer.from("not a docx")), SOURCE_PARSE_ERROR_CODES.MALFORMED_SOURCE);
      await expectCode(ingestSourceSnapshot(d.id, docx(CORE_RULES), { label: "pdf", originalFilename: "x.pdf", mimeType: "application/pdf" }), SOURCE_PARSE_ERROR_CODES.UNSUPPORTED_FORMAT);
      expect(await listSourceSnapshots(d.id)).toEqual([]);
    });
  });

  describe("17. migration history", () => {
    it("the M3-WO1 migration is applied after every M1/M2 migration, and every migration finished", async () => {
      const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
      const names = rows.filter((r) => r.rolled_back_at === null).map((r) => r.migration_name);
      expect(names.at(-1)).toBe("20261011010000_add_source_structure");
      expect(names.length).toBe(18);
      expect(rows.every((r) => r.rolled_back_at !== null || r.finished_at !== null)).toBe(true);
    });
  });

  describe("document scale (regression: the Playtest Packet is ~898 pages)", () => {
    it("ingests and reads back a >33,000-node synthetic document (beyond PostgreSQL's 32,767 bind-parameter limit) intact", async () => {
      const blocks: FxBlock[] = [];
      for (let c = 0; c < 60; c += 1) {
        blocks.push({ kind: "heading", level: 1, text: `Chapter ${c}` });
        for (let sct = 0; sct < 10; sct += 1) {
          blocks.push({ kind: "heading", level: 2, text: `Section ${c}.${sct}` });
          for (let p = 0; p < 50; p += 1) blocks.push({ kind: p % 7 === 0 ? "bullet" : "p", text: `Paragraph ${c}.${sct}.${p}: Damage = (Power × 2) + Tier.` });
          blocks.push(...(TABLES.blocks.slice(1) as FxBlock[]), ...(MISSION_TABLES.blocks.slice(2) as FxBlock[]));
        }
      }
      const bytes = buildDocx({ blocks, pages: 898 });
      const { snapshot, ingestion } = await ingest((await doc("scale")).id, bytes);
      expect(ingestion.nodeCount).toBeGreaterThan(32_767);
      const s = await getSourceStructure(snapshot.id);
      expect(s.nodes.length).toBe(ingestion.nodeCount);
      expect(s.sections.length).toBe(660);
      expect(s.nodes.map((x) => x.ordinal)).toEqual(s.nodes.map((_, i) => i));
      expect(snapshot.pageCount).toBe(898);
    }, 300_000);
  });

  describe("controlled errors", () => {
    it("unknown or malformed ids map to the documented NOT_FOUND codes; a missing document is SOURCE_DOCUMENT.NOT_FOUND", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";
      await expectCode(getSourceSnapshot(missing), SOURCE_SNAPSHOT_ERROR_CODES.NOT_FOUND);
      await expectCode(getSourceSnapshot("nope"), SOURCE_SNAPSHOT_ERROR_CODES.NOT_FOUND);
      await expectCode(getSourceStructure(missing), SOURCE_SNAPSHOT_ERROR_CODES.NOT_FOUND);
      await expectCode(getSourceSection(missing), SOURCE_STRUCTURE_ERROR_CODES.NOT_FOUND);
      await expectCode(getSourceBlock("nope"), SOURCE_STRUCTURE_ERROR_CODES.NOT_FOUND);
      await expectCode(getSourceTable(missing), SOURCE_STRUCTURE_ERROR_CODES.NOT_FOUND);
      await expectCode(getSourceAsset(missing), SOURCE_ASSET_ERROR_CODES.NOT_FOUND);
      await expectCode(listSourceSnapshots(missing), SOURCE_DOCUMENT_ERROR_CODES.NOT_FOUND);
      await expectCode(ingest(missing, docx(CORE_RULES)), SOURCE_DOCUMENT_ERROR_CODES.NOT_FOUND);
    });

    it("invalid Snapshot metadata is SOURCE_SNAPSHOT.INVALID_INPUT", async () => {
      const d = await doc("bad-meta");
      await expectCode(createSourceSnapshot(d.id, { label: "", originalFilename: "x", mimeType: "y", contentHash: "e".repeat(64), byteSize: 1 }), SOURCE_SNAPSHOT_ERROR_CODES.INVALID_INPUT);
      await expectCode(createSourceSnapshot(d.id, { label: "l", originalFilename: "x", mimeType: "y", contentHash: "short", byteSize: 1 }), SOURCE_SNAPSHOT_ERROR_CODES.INVALID_INPUT);
    });

    it("a snapshot whose structure was never ingested reads as an empty structure with no ingestion", async () => {
      const d = await doc("empty");
      const snapshot = await createSourceSnapshot(d.id, { label: "e", originalFilename: "e.docx", mimeType: "application/octet-stream", contentHash: "f".repeat(64), byteSize: 0 });
      expect(await getSourceStructure(snapshot.id)).toEqual({ snapshot, ingestion: null, sections: [], assets: [], nodes: [] });
    });
  });
});
