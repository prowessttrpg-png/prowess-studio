/**
 * M3-WO10 — the Golden M3 Import Lifecycle (final integration reference, prowess_studio_test only).
 *
 *   SOURCE → STRUCTURE → BATCH → EXTRACTION → MATCHING → CONFLICT EVIDENCE → REVIEW → COMPLETED
 *
 * One deterministic synthetic DOCX (no real Rulebook) drives every layer through the PUBLIC services, and every
 * historical layer is re-read by CONTENT (not merely ids) after later activity. ENTITY Candidates come from the same
 * approved test-only committed-extraction setup used since WO4 (the official extractors never propose Entities).
 * Invariant ids (M3-Ixx) refer to docs/architecture/m3-final-audit.md. Steps run in order and share state.
 */
import { DomainError, IMPORT_BATCH_ERROR_CODES, IMPORT_DECISION_ERROR_CODES, IMPORT_REVIEW_ERROR_CODES, type ExtractionCandidate, type JsonObject } from "@prowess/model";
import { ExtractorRegistry, semanticFoundationExtractorV1, structuralExtractorV1, type ExtractorDefinition } from "@prowess/import";
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
  extractImportBatch,
  getCandidateMatchAssessment,
  getImportBatch,
  getImportMatchRun,
  getSourceStructure,
  ingestSourceSnapshot,
  listCandidateDuplicateGroups,
  listCandidateMatchAssessments,
  listExtractionCandidates,
  listImportDecisionsForBatch,
  listImportDecisionsForCandidate,
  listImportMatchRuns,
  prisma,
  reviewImportCandidate,
  verifyExtractionOutput,
} from "../../src/index";
import { extractImportBatchWith } from "../../src/extraction/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { buildDocx, type FxDocument } from "../fixtures/docx-builder";
import { getTestDatabaseUrl } from "./env";
import { cleanupM2GoldenHistories } from "./fixtures/m2-golden-history";

const STAMP = Date.now();
const PREFIX = `test.m3golden${STAMP}`;
const DOC = `M3 Golden ${STAMP}`;
const key = (s: string) => `${PREFIX}.${s}`;

const SOURCE: FxDocument = {
  pages: 3,
  blocks: [
    { kind: "heading", level: 1, text: "Golden Rules" },
    { kind: "p", text: "Golden preface paragraph." },
    { kind: "heading", level: 2, text: "Costs" },
    { kind: "p", text: "Spell AP = floor(Total MP / PRO), minimum 1." },
    { kind: "p", text: "Keywords: Damage, Fire" },
    { kind: "table", headerRows: 1, rows: [["Component", "Requirement"], ["Verbal", "Speak; Gesture"]] },
    { kind: "heading", level: 2, text: "Identity" },
    { kind: "p", text: `Identity notes ${STAMP}.` },
  ],
};
const SAME_STRUCTURE_OTHER_BYTES: FxDocument = { ...SOURCE, pages: 4 }; // declared metadata only: new bytes, same structure
const CHANGED_CONTENT: FxDocument = { ...SOURCE, blocks: [...SOURCE.blocks, { kind: "p", text: "A later paragraph." }] };

async function tableHashes(): Promise<Record<string, string>> {
  const tables = (await prisma.$queryRaw<Array<{ t: string }>>`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1`).map((r) => r.t);
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = (await prisma.$queryRawUnsafe<Array<{ h: string }>>(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`))[0]!.h;
  return out;
}
const changed = (a: Record<string, string>, b: Record<string, string>) => Object.keys(b).filter((t) => a[t] !== b[t]).sort();
const GOVERNANCE = ["rulesets", "ruleset_manifests", "ruleset_manifest_entries", "canon_policies", "source_authority_records", "rule_conflicts", "rule_conflict_candidates", "canon_decisions", "canon_decision_selections", "change_sets", "change_set_operations", "ruleset_releases", "migration_plans", "migration_plan_items"];
const DOMAIN = ["entities", "entity_versions", "entity_aliases", "keyword_definitions", "keyword_categories", "entity_keywords", "entity_version_keywords", "entity_relationships", "source_references"];
const pick = (h: Record<string, string>, names: string[]) => Object.fromEntries(names.filter((n) => n in h).map((n) => [n, h[n]]));

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
}
/** A Candidate without its workflow status — the content that must never change (M3-I07). */
const omitStatus = (c: ExtractionCandidate) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== "status"));
const decide = (c: ExtractionCandidate, body: Record<string, unknown>) => reviewImportCandidate({ extractionCandidateId: c.id, candidateFingerprint: c.candidateFingerprint, ...body } as never);

/** Every historical layer of a Batch, by CONTENT (M3-I16). */
async function history(snapshotId: string, batchId: string, runIds: string[]) {
  return {
    structure: await getSourceStructure(snapshotId),
    batch: await getImportBatch(batchId),
    candidates: await listExtractionCandidates(batchId),
    runs: await Promise.all(runIds.map((id) => getImportMatchRun(id))),
    assessments: await Promise.all(runIds.map((id) => listCandidateMatchAssessments(id))),
    groups: await Promise.all(runIds.map((id) => listCandidateDuplicateGroups(id))),
    decisions: await listImportDecisionsForBatch(batchId),
  };
}

const s: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("M3-WO10 Golden M3 Import Lifecycle (prowess_studio_test only)", () => {
  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    // Fixture prerequisites (M1 / M2), created BEFORE the governance / domain baseline.
    s.alpha = await createEntity({ entityType: "RESOURCE", canonicalKey: key("alpha") });
    s.alphaV1 = await createEntityVersion(s.alpha.id, { displayName: `Alpha ${STAMP}` });
    s.other = await createEntity({ entityType: "RESOURCE", canonicalKey: key("other") });
    const ruleset = await createRuleset({ canonicalKey: key("ruleset"), name: `Golden ${STAMP}`, channel: "CORE_PLAYTEST" });
    s.manifest = await createRulesetManifest(ruleset.id, { entries: [{ entityId: s.alpha.id, entityVersionId: s.alphaV1.id }] });
    s.rulesetId = ruleset.id;
    s.document = await createSourceDocument({ title: DOC, sourceType: "DOCUMENT" });
    s.baseline = await tableHashes();
  });

  afterAll(async () => {
    const snaps = (await prisma.sourceSnapshot.findMany({ where: { sourceDocumentId: s.document.id }, select: { id: true } })).map((x) => x.id);
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
    for (const x of await prisma.sourceSection.findMany({ where: inSnap, select: { id: true }, orderBy: { ordinal: "desc" } })) await prisma.sourceSection.delete({ where: { id: x.id } });
    await prisma.sourceSnapshotIngestion.deleteMany({ where: inSnap });
    await prisma.sourceSnapshot.deleteMany({ where: { id: { in: snaps } } });
    await prisma.sourceDocument.deleteMany({ where: { id: s.document.id } });
    await prisma.entityAlias.deleteMany({ where: { entity: { canonicalKey: { startsWith: PREFIX } } } });
    await cleanupM2GoldenHistories(PREFIX);
    // §96: nothing of this fixture remains
    expect(await prisma.sourceDocument.count({ where: { title: DOC } })).toBe(0);
    expect(await prisma.entity.count({ where: { canonicalKey: { startsWith: PREFIX } } })).toBe(0);
  }, 300_000);

  it("§6–§9 M3-I01 / M3-I02 / M3-I03 exact Snapshot identity, structure determinism, and the bytes-vs-structure distinction", async () => {
    const before = await tableHashes();
    const a = await ingestSourceSnapshot(s.document.id, buildDocx(SOURCE), { label: "A", originalFilename: "golden.docx", mimeType: DOCX_MIME_TYPE });
    expect(a).toMatchObject({ createdSnapshot: true, createdStructure: true });
    expect(a.snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.ingestion.parserName).toBe("prowess-docx-structure");
    expect(changed(before, await tableHashes()).every((t) => t.startsWith("source_"))).toBe(true); // §37 ingestion writes source tables only
    s.a = a;
    s.aStructure = await getSourceStructure(a.snapshot.id);
    expect(s.aStructure.sections.map((x: { title: string }) => x.title)).toEqual(["Golden Rules", "Costs", "Identity"]);
    const afterA = await tableHashes();
    const again = await ingestSourceSnapshot(s.document.id, buildDocx(SOURCE), { label: "A again", originalFilename: "golden.docx", mimeType: DOCX_MIME_TYPE });
    expect(again).toMatchObject({ createdSnapshot: false, createdStructure: false, snapshot: { id: a.snapshot.id } });
    expect(await tableHashes()).toEqual(afterA); // identical bytes: reused, no row changed

    const v = await ingestSourceSnapshot(s.document.id, buildDocx(SAME_STRUCTURE_OTHER_BYTES), { label: "V", originalFilename: "golden-v.docx", mimeType: DOCX_MIME_TYPE });
    expect(v.snapshot.id).not.toBe(a.snapshot.id);
    expect(v.snapshot.contentHash).not.toBe(a.snapshot.contentHash); // SourceSnapshot identity = exact bytes
    expect(v.ingestion.structureHash).toBe(a.ingestion.structureHash); // structureHash = parsed structural equivalence
    expect(v.snapshot.sourceDocumentId).toBe(a.snapshot.sourceDocumentId); // one SourceDocument, several Snapshots
    expect(await getSourceStructure(a.snapshot.id)).toEqual(s.aStructure);
  });

  it("§10 cross-Snapshot integrity is enforced by the database", async () => {
    const other = await ingestSourceSnapshot(s.document.id, buildDocx(CHANGED_CONTENT), { label: "C", originalFilename: "golden-c.docx", mimeType: DOCX_MIME_TYPE });
    s.c = other;
    const aSection = s.aStructure.sections[0];
    const cBlock = (await getSourceStructure(other.snapshot.id)).nodes.find((n: { nodeType: string }) => n.nodeType === "BLOCK");
    await expect(prisma.sourceSection.create({ data: { sourceSnapshotId: other.snapshot.id, parentSectionId: aSection.id, title: "x", headingLevel: 2, ordinal: 99, pageLocationBasis: "UNAVAILABLE" } })).rejects.toThrow(/foreign key|Foreign key|fkey/i);
    await expect(prisma.sourceContentNode.create({ data: { sourceSnapshotId: s.a.snapshot.id, ordinal: 999, nodeType: "BLOCK", blockId: (cBlock as { blockId: string }).blockId } })).rejects.toThrow(/foreign key|Foreign key|fkey/i);
    await expect(prisma.sourceBlock.create({ data: { sourceSnapshotId: s.a.snapshot.id, sourceSectionId: (await getSourceStructure(other.snapshot.id)).sections[0]!.id, blockType: "PARAGRAPH", ordinal: 999, rawText: "x", pageLocationBasis: "UNAVAILABLE" } })).rejects.toThrow(/foreign key|Foreign key|fkey/i);
  });

  it("§11–§13 M3-I04 / M3-I17 Batch exact context and fingerprint reuse; a later Snapshot never retargets it", async () => {
    const input = { sourceSnapshotId: s.a.snapshot.id, label: "Golden semantic", scope: { type: "SNAPSHOT" as const }, extractorKey: "prowess.semantic-foundation", extractorVersion: "1", reviewRulesetId: s.rulesetId, comparisonManifestId: s.manifest.id };
    const first = await createImportBatch(input);
    const again = await createImportBatch({ ...input, label: "renamed" });
    expect([first.created, again.created, again.batch.id]).toEqual([true, false, first.batch.id]);
    const subtree = await createImportBatch({ ...input, scope: { type: "SECTION_SUBTREE", sectionId: s.aStructure.sections[1].id } });
    expect(subtree.batch.batchFingerprint).not.toBe(first.batch.batchFingerprint);
    expect(first.batch).toMatchObject({ sourceSnapshotId: s.a.snapshot.id, sourceStructureHash: s.a.ingestion.structureHash, scopeType: "SNAPSHOT", extractorKey: "prowess.semantic-foundation", extractorVersion: "1", comparisonManifestId: s.manifest.id });
    s.semantic = first.batch;
    s.structural = (await createImportBatch({ ...input, label: "Golden structural", extractorKey: "prowess.structural", reviewRulesetId: undefined, comparisonManifestId: undefined })).batch;
    // Snapshot V and C exist (later than A): the Batch is still pinned to A (M3-I17 no hidden latest Snapshot)
    expect((await getImportBatch(first.batch.id)).sourceSnapshotId).toBe(s.a.snapshot.id);
  });

  it("§14–§19 M3-I05 / M3-I06 / M3-I07 extraction determinism, exact provenance, versioned extractors and integrity verification", async () => {
    for (const b of [s.structural, s.semantic]) {
      const before = await tableHashes();
      const r1 = await extractImportBatch(b.id);
      expect(changed(before, await tableHashes())).toEqual(["extraction_candidate_sources", "extraction_candidates", "import_batches"]); // §37
      const c1 = await listExtractionCandidates(b.id);
      const r2 = await extractImportBatch(b.id);
      expect(r2).toMatchObject({ alreadyExtracted: true, extractionOutputHash: r1.extractionOutputHash });
      expect(await listExtractionCandidates(b.id)).toEqual(c1); // ids, fingerprints, ordinals, payloads, anchors
      expect(await verifyExtractionOutput(b.id)).toMatchObject({ persistedSetMatches: true, extractorOutputMatches: true });
    }
    const semantic = await listExtractionCandidates(s.semantic.id);
    expect(semantic.map((c) => `${c.candidateKind}:${c.displayLabel}`)).toEqual(["FORMULA:Spell AP", "KEYWORD:Damage", "KEYWORD:Fire", "REQUIREMENT:Requirement: Speak", "REQUIREMENT:Requirement: Gesture"]);
    const nodes = new Map(s.aStructure.nodes.map((n: { id: string }) => [n.id, n]));
    for (const c of semantic) {
      const node = nodes.get(c.primarySourceContentNodeId as string) as { sourceSnapshotId: string; nodeType: string; block?: { rawText: string }; table?: { structure: { rows: Array<{ cells: Array<{ columnIndex: number; rawText: string }> }> } } };
      expect(node.sourceSnapshotId).toBe(s.a.snapshot.id);
      const p = c.payload as Record<string, unknown>;
      const [row, col, start, end] = [p.rowIndex, p.columnIndex, p.startOffset, p.endOffset] as number[];
      const text = node.nodeType === "BLOCK" ? node.block!.rawText : node.table!.structure.rows[row as number]!.cells.find((x) => x.columnIndex === col)!.rawText;
      const cited = (p.rawText ?? p.rawRequirementText ?? p.authoredLabel) as string;
      expect(text.slice(start, end)).toBe(cited);
      expect(c.supportingSources[0]?.excerpt).toBe(cited);
      if (node.nodeType === "TABLE") expect([p.rowIndex, p.columnIndex, p.headerText]).toEqual([1, 1, "Requirement"]);
    }
    // a v2 extractor is a separate Batch; v1 untouched (§16)
    const v1Before = await listExtractionCandidates(s.semantic.id);
    const v2 = (await createImportBatch({ sourceSnapshotId: s.a.snapshot.id, label: "v2", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.semantic-foundation", extractorVersion: "2" })).batch;
    await extractImportBatchWith(new ExtractorRegistry([structuralExtractorV1, semanticFoundationExtractorV1, { ...semanticFoundationExtractorV1, version: "2" }]), v2.id);
    expect(await listExtractionCandidates(s.semantic.id)).toEqual(v1Before);
    // test-only tampering is detected, then restored (§19)
    const victim = v1Before[0]!;
    await prisma.extractionCandidate.update({ where: { id: victim.id }, data: { candidateFingerprint: "0".repeat(64) } });
    expect(await verifyExtractionOutput(s.semantic.id)).toMatchObject({ persistedSetMatches: false });
    await prisma.extractionCandidate.update({ where: { id: victim.id }, data: { candidateFingerprint: victim.candidateFingerprint } });
    expect(await verifyExtractionOutput(s.semantic.id)).toMatchObject({ persistedSetMatches: true, extractorOutputMatches: true });
  });

  it("§20–§24 M3-I08 / M3-I09 / M3-I17 MatchRun snapshot semantics, reproducibility, no rewrite on later catalog change, derived conflicts", async () => {
    const section = s.aStructure.sections[2].id;
    const golden: ExtractorDefinition = {
      key: "prowess.test-golden-entities", version: "1", description: "test-only ENTITY proposals", acceptsConfiguration: false, payloadSchemas: [{ key: "prowess.test.golden", version: 1 }],
      extract: () => [
        { label: `Alpha ${STAMP}`, key: key("alpha"), payload: { cost: 1 } },
        { label: "Twin", key: key("twin"), payload: { cost: 4 } },
        { label: "Twin (alt)", key: key("twin"), payload: { cost: 6 } },
        { label: "Mystery", key: null, payload: {} },
        { label: "Discard", key: null, payload: {} },
      ].map((x, i) => ({ ordinal: i + 1, candidateKind: "ENTITY" as const, proposedEntityType: "RESOURCE" as const, proposedCanonicalKey: x.key, displayLabel: x.label, confidence: "HIGH" as const, payloadSchemaKey: "prowess.test.golden", payloadSchemaVersion: 1, payloadJson: x.payload as JsonObject, primarySourceAnchor: { sectionId: section }, supportingSourceAnchors: [] }) as never),
    };
    s.entities = (await createImportBatch({ sourceSnapshotId: s.a.snapshot.id, label: "Golden entities", scope: { type: "SNAPSHOT" }, extractorKey: golden.key, extractorVersion: "1", reviewRulesetId: s.rulesetId, comparisonManifestId: s.manifest.id })).batch;
    await extractImportBatchWith(new ExtractorRegistry([golden]), s.entities.id);
    s.ec = await listExtractionCandidates(s.entities.id);

    const before = await tableHashes();
    const r1 = await analyzeImportBatchMatches(s.entities.id);
    expect(changed(before, await tableHashes())).toEqual(["candidate_duplicate_group_members", "candidate_duplicate_groups", "candidate_match_assessments", "candidate_match_suggestions", "import_match_runs"]); // §37
    expect(r1.run).toMatchObject({ importBatchId: s.entities.id, comparisonManifestId: s.manifest.id, matcherKey: "prowess.entity-matcher", matcherVersion: "1", candidateSetHash: (await getImportBatch(s.entities.id)).extractionOutputHash });
    expect(Object.keys(r1.run)).not.toContain("current");
    expect(await getCandidateMatchAssessment(r1.run.id, s.ec[0].id)).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: s.alpha.id, comparisonEntityVersionId: s.alphaV1.id });
    s.r1 = r1.run;
    s.r1Content = { run: await getImportMatchRun(r1.run.id), assessments: await listCandidateMatchAssessments(r1.run.id), groups: await listCandidateDuplicateGroups(r1.run.id) };
    expect(await analyzeImportBatchMatches(s.entities.id)).toMatchObject({ created: false, run: { id: r1.run.id } });

    await createEntityVersion(s.alpha.id, { displayName: `Alpha ${STAMP}` }); // a later Version: not pinned by the Manifest
    await createEntityAlias(s.other.id, { alias: "Mystery" }); // a later Alias: changes the catalog
    const r2 = await analyzeImportBatchMatches(s.entities.id);
    expect(r2.created).toBe(true);
    expect(r2.run.entityCatalogHash).not.toBe(s.r1.entityCatalogHash);
    expect({ run: await getImportMatchRun(r1.run.id), assessments: await listCandidateMatchAssessments(r1.run.id), groups: await listCandidateDuplicateGroups(r1.run.id) }).toEqual(s.r1Content);
    expect((await getCandidateMatchAssessment(r2.run.id, s.ec[0].id)).comparisonEntityVersionId).toBe(s.alphaV1.id); // still the pinned Version, never "latest"
    expect((await listImportMatchRuns(s.entities.id)).map((r) => r.id)).toEqual([r1.run.id, r2.run.id]);

    const conflictBefore = await tableHashes();
    const signals = await analyzeImportConflicts(s.entities.id, r1.run.id);
    expect(await tableHashes()).toEqual(conflictBefore); // derived, read-only
    expect(signals).toMatchObject([{ type: "POTENTIAL_CONTENT_CONFLICT", candidateIds: [s.ec[1].id, s.ec[2].id] }]);
  });

  it("§25–§36 M3-I10 / M3-I11 / M3-I12 / M3-I13 / M3-I14 / M3-I15 / M3-I20 decisions: append-only history, idempotency, concurrency, terminal states, completion, isolation", async () => {
    const candidateContent = async () => (await listExtractionCandidates(s.entities.id)).map(omitStatus);
    const content = await candidateContent();
    const ruleConflicts = await prisma.ruleConflict.count();
    const [alpha, twin, twinAlt, mystery, discard] = s.ec as ExtractionCandidate[];
    const group = (await listCandidateDuplicateGroups(s.r1.id))[0]!;
    const before = await tableHashes();

    expect((await decide(twin!, { decisionType: "MARK_CONFLICT", matchRunId: s.r1.id, duplicateGroupId: group.id, rationale: "cost 4 vs 6" })).decision.sequenceNumber).toBe(1);
    expect(changed(before, await tableHashes())).toEqual(["extraction_candidates", "import_batches", "import_decisions"]); // §37 review boundary
    expect(await prisma.ruleConflict.count()).toBe(ruleConflicts); // M3-I10
    await decide(twin!, { decisionType: "CLASSIFY_MATCHED", matchBasis: "MANUAL_OVERRIDE", targetEntityId: s.other.id, rationale: "designer resolved" });
    const approve = await decide(twin!, { decisionType: "APPROVE_MATCHED", targetEntityId: s.other.id });
    const seq = await listImportDecisionsForCandidate(twin!.id);
    expect(seq.map((d) => [d.sequenceNumber, d.fromStatus, d.toStatus])).toEqual([[1, "UNREVIEWED", "CONFLICT"], [2, "CONFLICT", "MATCHED"], [3, "MATCHED", "APPROVED"]]);
    expect(seq.every((d) => d.candidateFingerprint === twin!.candidateFingerprint && d.candidateSetHash === s.r1.candidateSetHash)).toBe(true);
    expect(await decide(twin!, { decisionType: "APPROVE_MATCHED", targetEntityId: s.other.id })).toEqual({ decision: approve.decision, created: false }); // §28
    for (const attempt of [{ decisionType: "REJECT", rationale: "late" }, { decisionType: "CLASSIFY_NEW_ENTITY" }, { decisionType: "MARK_CONFLICT" }]) await expectCode(decide(twin!, attempt), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION); // §30

    const race = await Promise.all([
      decide(mystery!, { decisionType: "REJECT", rationale: "A" }).then(() => "ok", (e: DomainError) => e.code),
      decide(mystery!, { decisionType: "CLASSIFY_NEW_ENTITY" }).then(() => "ok", (e: DomainError) => e.code),
    ]);
    expect(race.filter((r) => r === "ok").length).toBe(1); // §29
    expect((await listImportDecisionsForCandidate(mystery!.id)).length).toBe(1);

    await decide(discard!, { decisionType: "REJECT", rationale: "not an identity" });
    for (const attempt of [{ decisionType: "CLASSIFY_NEW_ENTITY" }, { decisionType: "MARK_NEEDS_MAPPING" }]) await expectCode(decide(discard!, attempt), IMPORT_DECISION_ERROR_CODES.INVALID_TRANSITION); // §31
    await expectCode(completeImportReview(s.entities.id), IMPORT_REVIEW_ERROR_CODES.INCOMPLETE); // §34
    const assessment = await getCandidateMatchAssessment(s.r1.id, alpha!.id);
    await decide(alpha!, { decisionType: "CLASSIFY_MATCHED", matchBasis: "EXACT_MATCH", targetEntityId: s.alpha.id, matchRunId: s.r1.id, matchAssessmentId: assessment.id, comparisonEntityVersionId: s.alphaV1.id });
    await decide(alpha!, { decisionType: "APPROVE_MATCHED", targetEntityId: s.alpha.id });
    await decide(twinAlt!, { decisionType: "REJECT", rationale: "superseded variant" });
    const m = (await listExtractionCandidates(s.entities.id)).find((c) => c.id === mystery!.id)!;
    if (m.status === "NEW_ENTITY") await decide(m, { decisionType: "APPROVE_NEW_ENTITY" });
    const isolation = await tableHashes();
    expect((await completeImportReview(s.entities.id)).status).toBe("COMPLETED"); // §33 READY_FOR_REVIEW → REVIEWING → COMPLETED
    expect(changed(isolation, await tableHashes())).toEqual(["import_batches"]); // §36 completion materializes nothing
    await expectCode(decide(alpha!, { decisionType: "REJECT", rationale: "too late" }), IMPORT_REVIEW_ERROR_CODES.NOT_READY); // §35

    expect(await candidateContent()).toEqual(content); // §18 M3-I07 only status changed
    const after = await tableHashes();
    expect(pick(after, GOVERNANCE)).toEqual(pick(s.baseline, GOVERNANCE)); // §32 / §38 M3-I13 / I20
    expect(pick(after, DOMAIN.filter((t) => t !== "entity_versions" && t !== "entity_aliases"))).toEqual(pick(s.baseline, DOMAIN.filter((t) => t !== "entity_versions" && t !== "entity_aliases"))); // §39 (versions / aliases changed only by the fixture's deliberate later records)
    expect(await prisma.entityVersion.count({ where: { entity: { canonicalKey: { startsWith: PREFIX } } } })).toBe(2);
  });

  it("§40 / §41 / §27 M3-I16 / M3-I18 historical reproducibility by content after later Snapshots, Batches, MatchRuns, Versions, Aliases and Decisions", async () => {
    const runs = (await listImportMatchRuns(s.entities.id)).map((r) => r.id);
    const s1 = await history(s.a.snapshot.id, s.entities.id, runs);
    const semanticHistory = await history(s.a.snapshot.id, s.semantic.id, []);
    // later activity
    const s2 = await ingestSourceSnapshot(s.document.id, buildDocx({ ...CHANGED_CONTENT, pages: 9 }), { label: "S2", originalFilename: "golden-s2.docx", mimeType: DOCX_MIME_TYPE });
    const b2 = (await createImportBatch({ sourceSnapshotId: s2.snapshot.id, label: "B2", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.semantic-foundation", extractorVersion: "1" })).batch;
    await extractImportBatch(b2.id);
    await analyzeImportBatchMatches(b2.id);
    await createEntityVersion(s.other.id, { displayName: `Other ${STAMP}` });
    await createEntityAlias(s.alpha.id, { alias: `Alpha Later ${STAMP}` });
    for (const c of await listExtractionCandidates(s.semantic.id)) await decide(c, { decisionType: "APPROVE_SEMANTIC" });
    await expectCode(extractImportBatch(s.entities.id), IMPORT_BATCH_ERROR_CODES.ALREADY_REVIEWING);
    // re-read the whole S1 / B1 history by content
    expect(await history(s.a.snapshot.id, s.entities.id, runs)).toEqual(s1);
    const semanticNow = await history(s.a.snapshot.id, s.semantic.id, []);
    expect(semanticNow.structure).toEqual(semanticHistory.structure);
    expect(semanticNow.candidates.map(omitStatus)).toEqual(semanticHistory.candidates.map(omitStatus));
    expect((await getImportBatch(s.entities.id)).sourceSnapshotId).toBe(s.a.snapshot.id);
  });
});
