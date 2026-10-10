#!/usr/bin/env node
// Developer-only real-source ingestion (PAS-10 M3-WO9). NOT a production upload path and NOT an API.
//
//   pnpm import:source --file "<path-to-docx>" [--title "…"] [--label "…"] [--declared-version V0.1] [--draft-state "…"] [--verify]
//
// A thin wrapper around the EXISTING public @prowess/db services: it reads the local bytes and calls
// `ingestSourceSnapshot` (which hashes the bytes, parses the DOCX with the approved WO1 parser, creates or REUSES the
// exact Snapshot, and ingests the structure once, atomically). It implements no parsing, hashing or persistence of its
// own, writes no game / governance table, and never stores the local file path (only the file NAME, as WO1's
// originalFilename). Source metadata is descriptive only: no authority status is assigned — ingestion is not Canon.
//
// --verify re-reads the whole stored structure through the services and checks it against a fresh parse of the same
// bytes (structure hash, section / node / block / table / asset counts and every block's raw text), read-only.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStudioEnv } from "../../../scripts/load-studio-env.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const file = opt("file");
if (!file) {
  console.error('Usage: pnpm import:source --file "<path-to-docx>" [--title …] [--label …] [--declared-version …] [--draft-state …] [--verify]');
  process.exit(2);
}
loadStudioEnv();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — aborting.");
  process.exit(1);
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = await import(path.join(packageDir, "dist", "src", "index.js"));
// Canonical JSON (sorted keys) for comparing stored JSONB table structures with a fresh parse: PostgreSQL JSONB does
// not preserve object key order, so a plain JSON.stringify comparison would report false mismatches.
const { canonicalJson } = await import("@prowess/import");

const title = opt("title", "Prowess Core Playtest Packet V0.1");
const label = opt("label", "Core Playtest V0.1");
const declaredVersion = opt("declared-version", "V0.1");
const declaredDraftState = opt("draft-state", "Working / unfinished Playtest source");
const filename = path.basename(file);
const mimeType = filename.toLowerCase().endsWith(".docx") ? db.DOCX_MIME_TYPE : null;
if (!mimeType) {
  console.error("Only .docx sources are supported by the approved WO1 parser.");
  process.exit(2);
}

const started = performance.now();
const bytes = readFileSync(file);
const byteSize = statSync(file).size;

// Reuse the SourceDocument with this exact title, or register it (descriptive metadata only; no authority, no path).
const existing = (await db.listSourceDocuments()).find((d) => d.title === title);
const document =
  existing ??
  (await db.createSourceDocument({ title, sourceType: "DOCUMENT", versionLabel: declaredVersion, notes: declaredDraftState }));

const result = await db.ingestSourceSnapshot(document.id, bytes, { label, originalFilename: filename, mimeType, declaredVersion, declaredDraftState });
const ingestMs = performance.now() - started;
const structure = await db.getSourceStructure(result.snapshot.id);
const count = (type) => structure.nodes.filter((n) => n.nodeType === type).length;

const lines = [
  ["Source", title],
  ["File", `${filename} (${byteSize.toLocaleString("en-US")} bytes)`],
  ["SHA-256", result.snapshot.contentHash],
  ["Source Document", existing ? "reused" : "created"],
  ["Snapshot", result.createdSnapshot ? "created" : "reused"],
  ["Structure", result.createdStructure ? "ingested" : "already ingested (identical)"],
  ["Parser", `${result.ingestion.parserName}@${result.ingestion.parserVersion}`],
  ["Structure Hash", result.ingestion.structureHash],
  ["Page count", result.snapshot.pageCount === null ? "not declared by the DOCX" : String(result.snapshot.pageCount)],
  ["Sections", String(structure.sections.length)],
  ["Content nodes", String(structure.nodes.length)],
  ["Blocks", String(count("BLOCK"))],
  ["Tables", String(count("TABLE"))],
  ["Asset placements", String(count("ASSET_PLACEMENT"))],
  ["Assets", String(structure.assets.length)],
  ["Duration", `${(ingestMs / 1000).toFixed(1)} s (hash + parse + persist + reuse checks)`],
];

if (args.includes("--verify")) {
  const t0 = performance.now();
  const fresh = db.parseDocxStructure(bytes).structure;
  const parseMs = performance.now() - t0;
  const freshHash = db.hashSourceStructure(fresh);
  const freshBlocks = fresh.nodes.filter((n) => n.nodeType === "BLOCK").map((n) => n.block.rawText);
  const storedBlocks = structure.nodes.filter((n) => n.nodeType === "BLOCK").map((n) => n.block.rawText);
  const checks = [
    ["structure hash reproduces", freshHash === result.ingestion.structureHash],
    ["section count", fresh.sections.length === structure.sections.length],
    ["section titles in order", fresh.sections.every((s, i) => structure.sections[i]?.title === s.title)],
    ["content node count", fresh.nodes.length === structure.nodes.length],
    ["node types in order", fresh.nodes.every((n, i) => structure.nodes[i]?.nodeType === n.nodeType)],
    ["every block's raw text verbatim", freshBlocks.length === storedBlocks.length && freshBlocks.every((t, i) => storedBlocks[i] === t)],
    ["every table's rows / cells / headers verbatim", (() => {
      const f = fresh.nodes.filter((n) => n.nodeType === "TABLE").map((n) => canonicalJson(n.table.structure));
      const s = structure.nodes.filter((n) => n.nodeType === "TABLE").map((n) => canonicalJson(n.table.structure));
      return f.length === s.length && f.every((t, i) => s[i] === t);
    })()],
    ["asset count and content hashes", fresh.assets.length === structure.assets.length && fresh.assets.every((a, i) => structure.assets[i]?.contentHash === a.contentHash)],
  ];
  lines.push(["Fresh parse", `${(parseMs / 1000).toFixed(1)} s`]);
  for (const [name, ok] of checks) lines.push([`Verify: ${name}`, ok ? "OK" : "MISMATCH"]);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

const width = Math.max(...lines.map(([k]) => k.length));
for (const [k, v] of lines) console.log(`${k.padEnd(width)}  ${v}`);
await db.prisma.$disconnect();
