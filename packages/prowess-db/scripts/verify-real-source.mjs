#!/usr/bin/env node
// Developer-only real-source verification (PAS-10 M3-WO9). Requires an explicit local file; CI never runs it.
//
//   pnpm import:verify-real-source --file "<path-to-docx>" [--pilot "<exact section title>"]… [--json <out.json>]
//
// Uses ONLY public @prowess/db services: re-ingests the file (an idempotent reuse of the exact Snapshot), runs a
// whole-Snapshot `prowess.structural@1` Batch (extract, re-extract, verify), then one SECTION_SUBTREE
// `prowess.semantic-foundation@1` Batch per --pilot section (first section whose title equals it exactly), each
// extracted twice and verified, and an explicit WO4 MatchRun per pilot. Pilot titles are caller input — no source-
// specific logic lives here. It records no decisions, creates no domain or governance rows, never stores the path.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStudioEnv } from "../../../scripts/load-studio-env.mjs";

const args = process.argv.slice(2);
const values = (name) => args.flatMap((a, i) => (a === `--${name}` && i + 1 < args.length ? [args[i + 1]] : []));
const file = values("file")[0];
if (!file) {
  console.error('Usage: pnpm import:verify-real-source --file "<path-to-docx>" [--pilot "<section title>"]… [--json <out.json>]');
  process.exit(2);
}
loadStudioEnv();
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = await import(path.join(packageDir, "dist", "src", "index.js"));
const title = values("title")[0] ?? "Prowess Core Playtest Packet V0.1";
const ms = (t) => Math.round(performance.now() - t);

const bytes = readFileSync(file);
const document = (await db.listSourceDocuments()).find((d) => d.title === title);
if (!document) {
  console.error(`No SourceDocument titled "${title}" — run pnpm import:source first.`);
  process.exit(1);
}
const ingest = await db.ingestSourceSnapshot(document.id, bytes, { label: values("label")[0] ?? "Core Playtest V0.1", originalFilename: path.basename(file), mimeType: db.DOCX_MIME_TYPE });
const snapshot = ingest.snapshot;
const structure = await db.getSourceStructure(snapshot.id);
const report = { snapshot: { contentHash: snapshot.contentHash, byteSize: snapshot.byteSize, structureHash: ingest.ingestion.structureHash, reused: !ingest.createdSnapshot && !ingest.createdStructure }, batches: [] };

async function runBatch(label, scope, extractorKey) {
  const { batch, created } = await db.createImportBatch({ sourceSnapshotId: snapshot.id, label, scope, extractorKey, extractorVersion: "1" });
  // A Batch already in review (REVIEWING / COMPLETED) is closed to extraction (WO3): re-read and re-verify it instead.
  const extractable = batch.status === "CREATED" || batch.status === "READY_FOR_REVIEW";
  let t = performance.now();
  const first = extractable ? await db.extractImportBatch(batch.id) : await db.getExtractionResult(batch.id);
  const extractMs = ms(t);
  const ids1 = (await db.listExtractionCandidates(batch.id)).map((c) => `${c.id}:${c.candidateFingerprint}`);
  t = performance.now();
  const again = extractable ? await db.extractImportBatch(batch.id) : await db.getExtractionResult(batch.id);
  const rerunMs = ms(t);
  const candidates = await db.listExtractionCandidates(batch.id);
  const ids2 = candidates.map((c) => `${c.id}:${c.candidateFingerprint}`);
  const verification = await db.verifyExtractionOutput(batch.id);
  const byKind = {};
  const byUnit = {};
  for (const c of candidates) {
    byKind[c.candidateKind] = (byKind[c.candidateKind] ?? 0) + 1;
    if (c.payload.unitType) byUnit[c.payload.unitType] = (byUnit[c.payload.unitType] ?? 0) + 1;
  }
  return {
    batchId: batch.id, label, scope, extractor: `${extractorKey}@1`, batchCreated: created, batchFingerprint: batch.batchFingerprint,
    candidateCount: first.candidateCount, extractionOutputHash: first.extractionOutputHash, byKind, byUnit,
    firstRunAlreadyExtracted: first.alreadyExtracted, extractMs, rerunMs,
    rerunIdentical: again.alreadyExtracted && again.extractionOutputHash === first.extractionOutputHash && ids1.join() === ids2.join(),
    verified: verification.persistedSetMatches && verification.extractorOutputMatches,
    status: (await db.getImportBatch(batch.id)).status,
  };
}

console.log(`Snapshot ${snapshot.contentHash} — structure ${ingest.ingestion.structureHash} (${report.snapshot.reused ? "reused" : "created"})`);
const structural = await runBatch(`${title} — whole-document structural`, { type: "SNAPSHOT" }, "prowess.structural");
report.batches.push(structural);
console.log(`Structural: ${structural.candidateCount} candidates ${JSON.stringify(structural.byUnit)} · ${structural.extractMs} ms (rerun ${structural.rerunMs} ms) · rerun identical ${structural.rerunIdentical} · verified ${structural.verified}`);

for (const pilot of values("pilot")) {
  const section = structure.sections.find((s) => s.title === pilot);
  if (!section) {
    console.log(`Pilot "${pilot}": no section with that exact title`);
    continue;
  }
  const r = await runBatch(`${title} — semantic pilot: ${pilot}`, { type: "SECTION_SUBTREE", sectionId: section.id }, "prowess.semantic-foundation");
  const t = performance.now();
  const match = await db.analyzeImportBatchMatches(r.batchId);
  r.matchRun = { created: match.created, runFingerprint: match.run.runFingerprint, resultHash: match.run.resultHash, byOutcome: match.run.byOutcome, ms: ms(t) };
  r.decisions = (await db.listImportDecisionsForBatch(r.batchId)).map((d) => d.decisionFingerprint);
  r.sectionOrdinal = section.ordinal;
  report.batches.push(r);
  console.log(`Pilot "${pilot}": ${r.candidateCount} ${JSON.stringify(r.byKind)} · ${r.extractMs} ms · rerun identical ${r.rerunIdentical} · verified ${r.verified} · matching ${JSON.stringify(r.matchRun.byOutcome)}`);
}
const out = values("json")[0];
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
await db.prisma.$disconnect();
