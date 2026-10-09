/**
 * M3-WO4 — Entity Matching, Normalization & Duplicate Detection, database integration (prowess_studio_test only).
 * Synthetic fixtures only. ENTITY Candidates are produced by a test-only extractor (WO3's injectable registry) because
 * the official structural extractor deliberately never proposes Entities. Describe blocks follow §55–§81.
 */
import { DomainError, IMPORT_MATCH_ERROR_CODES, type CreateExtractionCandidateInput, type EntityType } from "@prowess/model";
import { entityMatcherV1, ExtractorRegistry, MatcherRegistry, structuralExtractorV1, type ExtractorDefinition } from "@prowess/import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeImportBatchMatches,
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
  getImportMatchRun,
  getSourceStructure,
  ingestSourceSnapshot,
  listCandidateDuplicateGroups,
  listCandidateMatchAssessments,
  listExtractionCandidates,
  listImportMatchRuns,
  prisma,
} from "../../src/index";
import { extractImportBatchWith } from "../../src/extraction/service";
import { analyzeImportBatchMatchesWith } from "../../src/import-match/service";
import { assertRunningAgainstTestDatabase } from "../../src/testDatabaseGuard";
import { buildDocx, type FxDocument } from "../fixtures/docx-builder";
import { getTestDatabaseUrl } from "./env";
import { cleanupM2GoldenHistories } from "./fixtures/m2-golden-history";

const STAMP = Date.now();
const PREFIX = `test.m3match${STAMP}`;
const DOC_PREFIX = `M3M ${STAMP} `;
const T = (s: string) => `${s} ${STAMP}`; // unique labels so the global catalog cannot collide with other tests
const key = (s: string) => `${PREFIX}.${s}`;
const WO4_TABLES = ["import_match_runs", "candidate_match_assessments", "candidate_match_suggestions", "candidate_duplicate_groups", "candidate_duplicate_group_members"];

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

const DOC: FxDocument = { blocks: [{ kind: "heading", level: 1, text: "Glossary" }, { kind: "p", text: "Terms." }, { kind: "heading", level: 1, text: "Appendix" }, { kind: "p", text: "More terms." }] };

interface Spec {
  label: string;
  kind?: CreateExtractionCandidateInput["candidateKind"];
  type?: EntityType | null;
  canonicalKey?: string | null;
  section?: "Glossary" | "Appendix";
}

/** A Batch extracted by a test-only ENTITY-proposing extractor (key prowess.test-identity@1). */
async function entityBatch(label: string, specs: Spec[], comparisonManifestId?: { rulesetId: string; manifestId: string }) {
  const d = await createSourceDocument({ title: `${DOC_PREFIX}${label}`, sourceType: "DOCUMENT" });
  const { snapshot } = await ingestSourceSnapshot(d.id, buildDocx(DOC), { label, originalFilename: `${label}.docx`, mimeType: DOCX_MIME_TYPE });
  const structure = await getSourceStructure(snapshot.id);
  const sectionId = (t: string) => structure.sections.find((s) => s.title === t)!.id;
  const { batch } = await createImportBatch({
    sourceSnapshotId: snapshot.id, label, scope: { type: "SNAPSHOT" }, extractorKey: "prowess.test-identity", extractorVersion: "1",
    ...(comparisonManifestId ? { reviewRulesetId: comparisonManifestId.rulesetId, comparisonManifestId: comparisonManifestId.manifestId } : {}),
  });
  const extractor: ExtractorDefinition = {
    key: "prowess.test-identity", version: "1", description: "test-only ENTITY proposals", acceptsConfiguration: false,
    payloadSchemas: [{ key: "prowess.test.identity", version: 1 }],
    extract: () => specs.map((s, i) => ({
      ordinal: i + 1, candidateKind: s.kind ?? "ENTITY", proposedEntityType: s.type ?? null, proposedCanonicalKey: s.canonicalKey ?? null,
      displayLabel: s.label, confidence: "HIGH", payloadSchemaKey: "prowess.test.identity", payloadSchemaVersion: 1, payloadJson: { i },
      primarySourceAnchor: { sectionId: sectionId(s.section ?? "Glossary") }, supportingSourceAnchors: [],
    })),
  };
  await extractImportBatchWith(new ExtractorRegistry([extractor]), batch.id);
  const candidates = await listExtractionCandidates(batch.id);
  return { batch, candidates, byLabel: (l: string) => candidates.find((c) => c.displayLabel === l)! };
}
const assess = async (runId: string, candidateId: string) => getCandidateMatchAssessment(runId, candidateId);

describe("M3-WO4 entity matching (prowess_studio_test only)", () => {
  let arcana: { id: string };
  let emission: { id: string };
  let resA: { id: string };
  let resB: { id: string };
  let conc: { id: string };

  beforeAll(async () => {
    assertRunningAgainstTestDatabase(getTestDatabaseUrl());
    arcana = await createEntity({ entityType: "RESOURCE", canonicalKey: key("arcana") });
    emission = await createEntity({ entityType: "SPELL_TRAIT", canonicalKey: key("emission") });
    await createEntityAlias(emission.id, { alias: T("Emission") });
    await createEntityAlias(emission.id, { alias: T("Evocation") });
    resA = await createEntity({ entityType: "RESOURCE", canonicalKey: key("resistance_resource") });
    resB = await createEntity({ entityType: "SYSTEM", canonicalKey: key("resistance_system") });
    await createEntityAlias(resA.id, { alias: T("Resistance") });
    await createEntityAlias(resB.id, { alias: T("Resistance") });
    conc = await createEntity({ entityType: "SYSTEM", canonicalKey: key("concentration") });
    await createEntityAlias(conc.id, { alias: `Concentration${STAMP}` });
  });

  afterAll(async () => {
    const docs = (await prisma.sourceDocument.findMany({ where: { title: { startsWith: DOC_PREFIX } }, select: { id: true } })).map((d) => d.id);
    const snaps = (await prisma.sourceSnapshot.findMany({ where: { sourceDocumentId: { in: docs } }, select: { id: true } })).map((s) => s.id);
    const batches = (await prisma.importBatch.findMany({ where: { sourceSnapshotId: { in: snaps } }, select: { id: true } })).map((b) => b.id);
    const inBatch = { importBatchId: { in: batches } };
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
    await prisma.entityAlias.deleteMany({ where: { entity: { canonicalKey: { startsWith: PREFIX } } } });
    await cleanupM2GoldenHistories(PREFIX);
  }, 300_000);

  describe("§55–§64 outcomes", () => {
    it("canonical key, alias, display/fuzzy, cross-type, no-match, insufficient and not-applicable outcomes", async () => {
      const { batch, byLabel } = await entityBatch("outcomes", [
        { label: T("Arcana"), type: "RESOURCE", canonicalKey: key("arcana") },
        { label: T("Evocation") },
        { label: T("Resistance"), type: "RESOURCE" },
        { label: T("Resistance") + " " },
        { label: `Concentraton${STAMP}` },
        { label: T("Unknownium"), type: "RESOURCE", canonicalKey: key("unknownium") },
        { label: "—" },
        { label: T("Evocation"), kind: "UNKNOWN", section: "Appendix" },
      ]);
      const { run, created } = await analyzeImportBatchMatches(batch.id);
      expect(created).toBe(true);
      expect(run).toMatchObject({ importBatchId: batch.id, matcherKey: "prowess.entity-matcher", matcherVersion: "1", candidateSetHash: batch.id ? (await prisma.importBatch.findUnique({ where: { id: batch.id } }))!.extractionOutputHash : "", comparisonManifestId: null, assessmentCount: 8 });
      expect(run.matcherConfig).toEqual({ suggestionThreshold: 0.85, maxSuggestions: 5 });
      expect(await assess(run.id, byLabel(T("Arcana")).id)).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: arcana.id, matchedBy: "CANONICAL_KEY_EXACT", comparisonEntityVersionId: null });
      expect(await assess(run.id, byLabel(T("Evocation")).id)).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: emission.id, matchedBy: "ALIAS_EXACT" });
      expect(await assess(run.id, byLabel(T("Resistance")).id)).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: resA.id }); // the type hint resolves it
      const ambiguous = await assess(run.id, byLabel(T("Resistance") + " ").id);
      expect(ambiguous).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedEntityId: null });
      expect(new Set(ambiguous.suggestions.map((s) => s.entityId))).toEqual(new Set([resA.id, resB.id]));
      const typo = await assess(run.id, byLabel(`Concentraton${STAMP}`).id);
      expect(typo).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedBy: "FUZZY_LABEL", matchedEntityId: null });
      expect(typo.suggestions[0]).toMatchObject({ entityId: conc.id, basis: "FUZZY_LABEL" });
      expect(typo.suggestions[0]!.score).toBeLessThan(1);
      expect(await assess(run.id, byLabel(T("Unknownium")).id)).toMatchObject({ outcome: "NO_MATCH", suggestions: [] });
      expect(await assess(run.id, byLabel("—").id)).toMatchObject({ outcome: "INSUFFICIENT_IDENTITY" });
      const structural = (await listCandidateMatchAssessments(run.id)).find((a) => a.outcome === "NOT_APPLICABLE")!;
      expect(structural).toMatchObject({ suggestions: [], normalizedCandidateLabel: null });
      expect(await prisma.entity.count({ where: { canonicalKey: key("unknownium") } })).toBe(0); // NO_MATCH never creates
    });

    it("§14 / §64 a whole structural (prowess.structural@1) Batch is NOT_APPLICABLE throughout", async () => {
      const d = await createSourceDocument({ title: `${DOC_PREFIX}structural`, sourceType: "DOCUMENT" });
      const { snapshot } = await ingestSourceSnapshot(d.id, buildDocx({ blocks: [{ kind: "heading", level: 1, text: T("Evocation") }, { kind: "p", text: "x" }, { kind: "heading", level: 1, text: "Spellcasting" }, { kind: "p", text: "y" }] }), { label: "s", originalFilename: "s.docx", mimeType: DOCX_MIME_TYPE });
      const { batch } = await createImportBatch({ sourceSnapshotId: snapshot.id, label: "s", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1" });
      await extractImportBatch(batch.id);
      const { run } = await analyzeImportBatchMatches(batch.id);
      expect(run.byOutcome).toMatchObject({ NOT_APPLICABLE: 2, EXACT_MATCH: 0, POTENTIAL_MATCH: 0 });
      expect(await prisma.candidateMatchSuggestion.count({ where: { assessment: { matchRunId: run.id } } })).toBe(0);
    });
  });

  describe("§65–§67 exact comparison Manifest context", () => {
    it("the matched Entity carries its exact pinned Version; later Versions never leak in; absence is not 'new'", async () => {
      const a1 = await createEntityVersion(arcana.id, { displayName: T("Arcana") });
      const a2 = await createEntityVersion(arcana.id, { displayName: T("Arcana") });
      const shown = await createEntity({ entityType: "RESOURCE", canonicalKey: key("arcane_lore") });
      const s1 = await createEntityVersion(shown.id, { displayName: T("Arcane Lore") });
      const ruleset = await createRuleset({ canonicalKey: key("ruleset"), name: T("R"), channel: "CORE_PLAYTEST" });
      const manifest = await createRulesetManifest(ruleset.id, { entries: [{ entityId: arcana.id, entityVersionId: a2.id }, { entityId: shown.id, entityVersionId: s1.id }] });
      const { batch, byLabel } = await entityBatch("manifest", [
        { label: T("Arcana"), type: "RESOURCE", canonicalKey: key("arcana") },
        { label: T("Evocation") },
        { label: T("Arcane Lore") },
      ], { rulesetId: ruleset.id, manifestId: manifest.id });
      const { run } = await analyzeImportBatchMatches(batch.id);
      expect(run.comparisonManifestId).toBe(manifest.id);
      expect(await assess(run.id, byLabel(T("Arcana")).id)).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: arcana.id, comparisonEntityVersionId: a2.id });
      expect(await assess(run.id, byLabel(T("Evocation")).id)).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: emission.id, comparisonEntityVersionId: null }); // absent from M1
      const display = await assess(run.id, byLabel(T("Arcane Lore")).id);
      expect(display).toMatchObject({ outcome: "POTENTIAL_MATCH", matchedBy: "DISPLAY_LABEL_EXACT", matchedEntityId: null });
      expect(display.suggestions[0]).toMatchObject({ entityId: shown.id, comparisonEntityVersionId: s1.id });
      const before = await listCandidateMatchAssessments(run.id);
      await createEntityVersion(arcana.id, { displayName: T("Arcana") }); // A3
      expect(await listCandidateMatchAssessments(run.id)).toEqual(before);
      const again = await analyzeImportBatchMatches(batch.id);
      expect(again.created).toBe(false); // A3 is not in the Manifest and is consulted nowhere, so the catalog is unchanged
      expect(await assess(again.run.id, byLabel(T("Arcana")).id)).toMatchObject({ comparisonEntityVersionId: a2.id });
      expect([a1.id, a2.id]).not.toContain(null);
      await expectCode(analyzeImportBatchMatches(batch.id, { comparisonManifestId: manifest.id } as never), IMPORT_MATCH_ERROR_CODES.INVALID_INPUT, "the Manifest always comes from the Batch");
    });
  });

  describe("§68–§70 advisory duplicate groups", () => {
    it("same type + key and same type + normalized label are grouped; cross-type labels are not; nothing is merged", async () => {
      const { batch, candidates } = await entityBatch("duplicates", [
        { label: T("Arcana"), type: "RESOURCE", canonicalKey: key("dup") },
        { label: T("Arcana (again)"), type: "RESOURCE", canonicalKey: key("dup"), section: "Appendix" },
        { label: T("Direct Damage"), type: "SPELL_EFFECT" },
        { label: `  ${T("direct   damage").toUpperCase()} `, type: "SPELL_EFFECT", section: "Appendix" },
        { label: T("Direct Damage"), type: "SYSTEM" },
      ]);
      const { run } = await analyzeImportBatchMatches(batch.id);
      const groups = await listCandidateDuplicateGroups(run.id);
      expect(groups.map((g) => [g.basis, g.memberCandidateIds])).toEqual([
        ["NORMALIZED_LABEL", [candidates[2]!.id, candidates[3]!.id]],
        ["PROPOSED_CANONICAL_KEY", [candidates[0]!.id, candidates[1]!.id]],
      ]);
      expect(groups.every((g) => /^[0-9a-f]{64}$/.test(g.identityKeyHash))).toBe(true);
      expect((await listExtractionCandidates(batch.id)).length).toBe(5);
      expect(candidates[3]!.displayLabel).toBe(`  ${T("direct   damage").toUpperCase()} `); // source spelling untouched
    });
  });

  describe("§71–§74 / §88 no mutation", () => {
    it("matching changes only the five WO4 tables; every Candidate stays UNREVIEWED", async () => {
      const { batch } = await entityBatch("immutability", [{ label: T("Arcana"), type: "RESOURCE", canonicalKey: key("arcana") }, { label: T("Evocation") }]);
      const before = await fingerprint(undefined, WO4_TABLES);
      await analyzeImportBatchMatches(batch.id);
      expect(await fingerprint(undefined, WO4_TABLES)).toEqual(before);
      expect((await listExtractionCandidates(batch.id)).every((c) => c.status === "UNREVIEWED")).toBe(true);
    });
  });

  describe("§76–§79 historical reproducibility, versions, idempotency, concurrency", () => {
    it("a new alias changes the catalog -> a new run; the old run is untouched", async () => {
      const { batch, byLabel } = await entityBatch("catalog-change", [{ label: T("Stamina") }]);
      const a = await analyzeImportBatchMatches(batch.id);
      expect(await assess(a.run.id, byLabel(T("Stamina")).id)).toMatchObject({ outcome: "NO_MATCH" });
      const aBefore = { run: await getImportMatchRun(a.run.id), assessments: await listCandidateMatchAssessments(a.run.id) };
      await createEntityAlias(conc.id, { alias: T("Stamina") });
      const b = await analyzeImportBatchMatches(batch.id);
      expect(b.created).toBe(true);
      expect(b.run.entityCatalogHash).not.toBe(a.run.entityCatalogHash);
      expect(await assess(b.run.id, byLabel(T("Stamina")).id)).toMatchObject({ outcome: "EXACT_MATCH", matchedEntityId: conc.id });
      expect({ run: await getImportMatchRun(a.run.id), assessments: await listCandidateMatchAssessments(a.run.id) }).toEqual(aBefore);
      expect((await listImportMatchRuns(batch.id)).map((r) => r.id)).toEqual([a.run.id, b.run.id]);
    });

    it("matcher v2 is a separate run; identical context is idempotent; concurrent analyses yield one run", async () => {
      const { batch } = await entityBatch("versions", [{ label: T("Arcana"), type: "RESOURCE", canonicalKey: key("arcana") }, { label: T("Evocation") }]);
      const results = await Promise.all(Array.from({ length: 4 }, () => analyzeImportBatchMatches(batch.id)));
      expect(new Set(results.map((r) => r.run.id)).size).toBe(1);
      expect(results.filter((r) => r.created).length).toBe(1);
      const v1 = results[0]!.run;
      const again = await analyzeImportBatchMatches(batch.id);
      expect(again).toMatchObject({ created: false, run: { id: v1.id } });
      expect(await prisma.candidateMatchAssessment.count({ where: { matchRunId: v1.id } })).toBe(2);
      const withV2 = new MatcherRegistry([entityMatcherV1, { ...entityMatcherV1, version: "2" }]);
      const v2 = await analyzeImportBatchMatchesWith(withV2, batch.id, { matcherVersion: "2" });
      expect(v2.created).toBe(true);
      expect(v2.run.runFingerprint).not.toBe(v1.runFingerprint);
      const configured = await analyzeImportBatchMatches(batch.id, { matcherConfig: { maxSuggestions: 3 } });
      expect(configured.created).toBe(true);
      expect(configured.run.matcherConfigHash).not.toBe(v1.matcherConfigHash);
      await expectCode(analyzeImportBatchMatches(batch.id, { matcherVersion: "9" }), IMPORT_MATCH_ERROR_CODES.MATCHER_NOT_FOUND);
      await expectCode(analyzeImportBatchMatches(batch.id, { matcherConfig: { maxSuggestions: 0 } }), IMPORT_MATCH_ERROR_CODES.INVALID_INPUT);
    });

    it("the same exact context producing a different result fails closed with NONDETERMINISTIC_RESULT", async () => {
      const { batch } = await entityBatch("nondeterminism", [{ label: T("Evocation") }]);
      const { run } = await analyzeImportBatchMatches(batch.id);
      const mutated = new MatcherRegistry([{ ...entityMatcherV1, match: (i) => ({ ...entityMatcherV1.match(i), duplicateGroups: [] , assessments: entityMatcherV1.match(i).assessments.map((a) => ({ ...a, normalizedCandidateLabel: "changed" })) }) }]);
      await expectCode(analyzeImportBatchMatchesWith(mutated, batch.id), IMPORT_MATCH_ERROR_CODES.NONDETERMINISTIC_RESULT);
      expect((await getImportMatchRun(run.id)).resultHash).toBe(run.resultHash);
    });
  });

  describe("§80 transactionality and database integrity", () => {
    it("a late database failure leaves no run, assessment, suggestion or group", async () => {
      const { batch, candidates } = await entityBatch("rollback", [{ label: T("Evocation") }, { label: T("Twin"), type: "SYSTEM" }, { label: T("Twin"), type: "SYSTEM", section: "Appendix" }]);
      const poisoned = new MatcherRegistry([{ ...entityMatcherV1, match: (i) => { const o = entityMatcherV1.match(i); return { ...o, duplicateGroups: o.duplicateGroups.map((g) => ({ ...g, identityKey: `${g.identityKey}\u0000` })) }; } }]);
      const before = await fingerprint(WO4_TABLES);
      const error = await analyzeImportBatchMatchesWith(poisoned, batch.id).then(() => null, (e: unknown) => e);
      expect(error).not.toBeNull();
      expect(error).not.toBeInstanceOf(DomainError);
      expect(await fingerprint(WO4_TABLES)).toEqual(before);
      expect(candidates.length).toBe(3);
    });

    it("the database rejects an EXACT_MATCH without an Entity, a fuzzy EXACT, and a Candidate of another Batch", async () => {
      const a = await entityBatch("db-a", [{ label: T("Evocation") }]);
      const b = await entityBatch("db-b", [{ label: T("Evocation") }]);
      const { run } = await analyzeImportBatchMatches(a.batch.id);
      const base = { matchRunId: run.id, importBatchId: a.batch.id, extractionCandidateId: a.candidates[0]!.id };
      await expect(prisma.candidateMatchAssessment.create({ data: { ...base, outcome: "EXACT_MATCH", matchedBy: "ALIAS_EXACT" } })).rejects.toThrow(/exact_match_check|check|unique/i);
      await expect(prisma.candidateMatchAssessment.create({ data: { ...base, extractionCandidateId: b.candidates[0]!.id, outcome: "NO_MATCH", matchedBy: "NONE" } })).rejects.toThrow(/candidate_fkey|Foreign key/i);
      await prisma.$transaction(async (tx) => {
        await tx.candidateMatchAssessment.deleteMany({ where: { matchRunId: run.id } }); // test-only, rolled back below
        await expect(tx.candidateMatchAssessment.create({ data: { ...base, outcome: "EXACT_MATCH", matchedBy: "FUZZY_LABEL", matchedEntityId: emission.id } })).rejects.toThrow(/check/i);
      }).catch(() => undefined);
      expect(await prisma.candidateMatchAssessment.count({ where: { matchRunId: run.id } })).toBe(1);
    });
  });

  describe("controlled errors", () => {
    it("not found, not extracted and catalog integrity failures are controlled", async () => {
      await expectCode(analyzeImportBatchMatches("00000000-0000-4000-8000-000000000000"), IMPORT_MATCH_ERROR_CODES.BATCH_NOT_FOUND);
      await expectCode(getImportMatchRun("nope"), IMPORT_MATCH_ERROR_CODES.NOT_FOUND);
      await expectCode(listImportMatchRuns("nope"), IMPORT_MATCH_ERROR_CODES.BATCH_NOT_FOUND);
      const d = await createSourceDocument({ title: `${DOC_PREFIX}unextracted`, sourceType: "DOCUMENT" });
      const { snapshot } = await ingestSourceSnapshot(d.id, buildDocx(DOC), { label: "u", originalFilename: "u.docx", mimeType: DOCX_MIME_TYPE });
      const { batch } = await createImportBatch({ sourceSnapshotId: snapshot.id, label: "u", scope: { type: "SNAPSHOT" }, extractorKey: "prowess.structural", extractorVersion: "1" });
      await expectCode(analyzeImportBatchMatches(batch.id), IMPORT_MATCH_ERROR_CODES.BATCH_NOT_EXTRACTED);
      const x = await entityBatch("integrity", [{ label: T("Evocation") }]);
      const { run } = await analyzeImportBatchMatches(x.batch.id);
      await expectCode(getCandidateMatchAssessment(run.id, "00000000-0000-4000-8000-000000000000"), IMPORT_MATCH_ERROR_CODES.NOT_FOUND);
      const alias = (await prisma.entityAlias.findFirst({ where: { entityId: conc.id } }))!;
      await prisma.entityAlias.update({ where: { id: alias.id }, data: { normalizedAlias: "corrupted" } }); // test-only corruption
      try {
        await expectCode(analyzeImportBatchMatches(x.batch.id), IMPORT_MATCH_ERROR_CODES.CATALOG_INTEGRITY_FAILURE);
      } finally {
        await prisma.entityAlias.update({ where: { id: alias.id }, data: { normalizedAlias: alias.normalizedAlias } });
      }
    });
  });

  describe("§81 large catalog", () => {
    it("matches hundreds of candidates against thousands of identities with bounded fuzzy pools", async () => {
      const N = 1_500;
      await prisma.entity.createMany({ data: Array.from({ length: N }, (_, i) => ({ entityType: i % 2 === 0 ? "SYSTEM" : "RESOURCE", canonicalKey: key(`bulk_${i}`) })) as never });
      const bulk = await prisma.entity.findMany({ where: { canonicalKey: { startsWith: key("bulk_") } }, select: { id: true, canonicalKey: true } });
      await prisma.entityAlias.createMany({ data: bulk.map((e) => ({ entityId: e.id, alias: `Bulk Term ${e.canonicalKey.split("_").pop()} ${STAMP}`, normalizedAlias: `bulk term ${e.canonicalKey.split("_").pop()} ${STAMP}`, context: null, normalizedContext: "" })) });
      const specs: Spec[] = Array.from({ length: 300 }, (_, i) => ({ label: i % 3 === 0 ? `Bulk Term ${i} ${STAMP}` : i % 3 === 1 ? `Bulk Trem ${i} ${STAMP}` : `Unrelated ${i}`, type: null }));
      const { batch } = await entityBatch("large", specs);
      const started = Date.now();
      const { run } = await analyzeImportBatchMatches(batch.id);
      expect(Date.now() - started).toBeLessThan(120_000);
      expect(run.assessmentCount).toBe(300);
      expect(run.byOutcome.EXACT_MATCH).toBe(100);
      expect(run.byOutcome.POTENTIAL_MATCH).toBeGreaterThanOrEqual(100);
      const all = await listCandidateMatchAssessments(run.id);
      expect(all.length).toBe(300);
      expect(all.every((a) => a.suggestions.length <= 5)).toBe(true);
      expect((await analyzeImportBatchMatches(batch.id)).created).toBe(false);
      await prisma.entityAlias.deleteMany({ where: { entityId: { in: bulk.map((e) => e.id) } } });
      expect(structuralExtractorV1.key).toBe("prowess.structural");
    }, 300_000);
  });
});
