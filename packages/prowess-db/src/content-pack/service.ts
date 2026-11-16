import { canonicalJson } from "@prowess/import";
import sharp from "sharp";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../client.js";
import { readContentPack, sha256, writeContentPack } from "./archive.js";
import { catalog, kinds, parseRecord, rowKey, type Records, type Row, type StoredRecordKind } from "./catalog.js";
import { ancestryOrder, countRecords, inspectPackJson, links, releaseHeader, sortedRows, uniqueKeys, validateGraph } from "./graph.js";
import { ContentPackManifestError, readPackJson, type ContentPackManifest, type ContentPackRecordKind, type ManifestBody } from "./manifest.js";

type Tx = Prisma.TransactionClient;
type Filters = Record<string, unknown>;
interface CatalogDelegate {
  findMany(args: { where: Filters; select: Record<string, boolean>; take: number }): Promise<Row[]>;
  createMany(args: { data: Row[] }): Promise<{ count: number }>;
}

const MAX_RECORDS = 100_000;
const batchSize = 150;
const isUuid = (value: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const sortText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const normalize = (kind: ContentPackRecordKind, row: Row) => parseRecord(kind, JSON.parse(JSON.stringify(row)) as unknown);
const delegate = (tx: Tx, kind: StoredRecordKind) => tx[catalog[kind].model] as unknown as CatalogDelegate;

function batches<T>(values: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < values.length; i += batchSize) groups.push(values.slice(i, i + batchSize));
  return groups;
}

async function selectedRows(tx: Tx, kind: StoredRecordKind, where: Filters): Promise<Row[]> {
  const rows = await delegate(tx, kind).findMany({ where, select: catalog[kind].select, take: MAX_RECORDS + 1 });
  if (rows.length > MAX_RECORDS) throw new ContentPackManifestError("Release exceeds portable record limit");
  return rows.map((row) => normalize(kind, row));
}

async function sourceLocations(tx: Tx, references: Row[]): Promise<Row[]> {
  const result: Row[] = [];
  for (const group of batches(references)) {
    const ids = group.map((row) => row.id as string);
    const imported = await tx.contentPackSourceLocation.findMany({ where: { id: { in: ids } } });
    const importedIds = new Set(imported.map((row) => row.id));
    for (const row of imported) result.push(normalize("source-locations", row));
    const originals = await tx.sourceReference.findMany({
      where: { id: { in: ids.filter((id) => !importedIds.has(id)) }, sourceSnapshotId: { not: null } },
      select: {
        id: true, sourceDocumentId: true, sourceSnapshot: { select: { id: true, contentHash: true } },
        sourceSectionId: true, sourceBlockId: true, sourceTableId: true,
      },
    });
    for (const row of originals) {
      if (!row.sourceSnapshot) throw new ContentPackManifestError(`Missing snapshot for source reference ${row.id}`);
      result.push(parseRecord("source-locations", {
        id: row.id, sourceDocumentId: row.sourceDocumentId, snapshotId: row.sourceSnapshot.id, contentHash: row.sourceSnapshot.contentHash,
        sectionId: row.sourceSectionId, blockId: row.sourceBlockId, tableId: row.sourceTableId,
      }));
    }
  }
  return result;
}

async function collectRelease(tx: Tx, releaseId: string): Promise<Records> {
  const byKind = new Map<StoredRecordKind, Map<string, Row>>();
  const queried = new Set<string>();
  let pending = new Map<StoredRecordKind, Filters[]>();
  let count = 0;
  const request = (kind: StoredRecordKind, where: Filters) => {
    const key = canonicalJson([kind, where]);
    if (queried.has(key)) return;
    queried.add(key);
    const queue = pending.get(kind) ?? [];
    queue.push(where);
    pending.set(kind, queue);
  };
  request("releases", { id: releaseId });
  for (let depth = 0; pending.size > 0; depth++) {
    if (depth > 64) throw new ContentPackManifestError("Release dependency depth exceeds limits");
    const current = pending;
    pending = new Map();
    for (const [kind, filters] of current) {
      const rows = byKind.get(kind) ?? new Map<string, Row>();
      for (const group of batches(filters)) {
        for (const row of await selectedRows(tx, kind, { OR: group })) {
          const key = rowKey(kind, row);
          if (rows.has(key)) continue;
          rows.set(key, row);
          if (++count > MAX_RECORDS) throw new ContentPackManifestError("Release exceeds portable record limit");
          for (const link of links(kind, row)) if (link.kind !== "source-locations") request(link.kind, link.where);
        }
      }
      byKind.set(kind, rows);
    }
  }

  const records: Records = new Map([...byKind].map(([kind, rows]) => [kind, [...rows.values()]]));
  if (!records.get("releases")?.length) throw new ContentPackManifestError("Published Release was not found");
  const entities = new Set((records.get("entities") ?? []).map((row) => row.id));
  const relationships: Row[] = [];
  for (const ids of batches([...entities])) {
    const outgoing = await selectedRows(tx, "relationships", { sourceEntityId: { in: ids } });
    relationships.push(...outgoing.filter((row) => entities.has(row.targetEntityId)));
  }
  records.set("relationships", relationships);
  records.set("source-locations", await sourceLocations(tx, records.get("source-references") ?? []));
  if (countRecords(records) > MAX_RECORDS) throw new ContentPackManifestError("Release exceeds portable record limit");
  return records;
}

export type ContentPackExportOptions = Pick<ManifestBody, "producerId" | "label" | "provenance">;

/** Export an exact Release in one snapshot, with no source writes. */
export async function exportContentPack(releaseId: string, options: ContentPackExportOptions, database = prisma) {
  if (!isUuid(releaseId)) throw new ContentPackManifestError("Published Release ID is invalid");
  const { records, assetRows } = await database.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const records = await collectRelease(tx, releaseId);
    const receipt = await tx.contentPackReceipt.findUnique({ where: { releaseId } });
    const source = receipt?.manifest as unknown as ContentPackManifest | undefined;
    const assets = source?.files.filter((file) => file.type === "asset") ?? [];
    const assetRows = [];
    for (const file of assets) {
      const asset = await tx.contentPackAsset.findUnique({ where: { sha256: file.sha256 } });
      if (asset === null || asset.mediaType !== file.mediaType || sha256(asset.bytes) !== file.sha256) {
        throw new ContentPackManifestError(`Missing or damaged offline asset ${file.sha256}`);
      }
      assetRows.push({ file, bytes: asset.bytes });
    }
    return { records, assetRows };
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });

  const release = releaseHeader(records.get("releases")![0]!);
  const compatibility = validateGraph(records, release);
  const files = new Map<string, Uint8Array>();
  const inventory: ManifestBody["files"] = [];
  for (const [kind, rows] of records) {
    if (rows.length === 0) continue;
    const bytes = Buffer.from(canonicalJson(sortedRows(kind, rows)));
    const path = `records/${kind}.json`;
    files.set(path, bytes);
    inventory.push({ type: "records", kind, path, byteSize: bytes.byteLength, recordCount: rows.length, sha256: sha256(bytes) });
  }
  for (const { file, bytes } of assetRows) {
    files.set(file.path, bytes);
    inventory.push(file);
  }
  inventory.sort((a, b) => sortText(a.path, b.path));
  return writeContentPack({
    ...options, format: "prowess.content-pack", formatVersion: 1, files: inventory, release, compatibility,
  }, files);
}

async function validateIncoming(bytes: Uint8Array) {
  const archive = readContentPack(bytes);
  const records: Records = new Map();
  const assets = [];
  for (const file of archive.manifest.files) {
    const payload = archive.files.get(file.path)!;
    if (file.type === "asset") {
      try {
        const decoder = sharp(payload, { failOn: "warning", limitInputPixels: 16_777_216 });
        const { format, width, height, pages } = await decoder.metadata();
        if (`image/${format}` !== file.mediaType || !width || !height || width > 4096 || height > 4096 || (pages ?? 1) !== 1) {
          throw new Error("Unsupported image");
        }
        await decoder.stats();
      } catch {
        throw new ContentPackManifestError(`Offline asset has an invalid image format or size: ${file.path}`);
      }
      assets.push({ sha256: file.sha256, mediaType: file.mediaType, bytes: Uint8Array.from(payload) });
      continue;
    }
    const { text, value } = readPackJson(payload, file.path);
    if (!Array.isArray(value) || value.length !== file.recordCount) {
      throw new ContentPackManifestError(`Record count does not match manifest: ${file.path}`);
    }
    const rows = value.map((row: unknown) => parseRecord(file.kind, row));
    records.set(file.kind, rows);
    // Validate bounded JSON before recursing through canonical serialization.
    for (const row of rows) {
      if (file.kind === "entity-versions" || file.kind === "relationships") {
        const column = file.kind === "entity-versions" ? "structuredData" : "metadata";
        checkPortableData(row[column]);
      }
    }
    if (text !== canonicalJson(sortedRows(file.kind, rows))) {
      throw new ContentPackManifestError(`Records must be canonical and ordered: ${file.path}`);
    }
  }
  const capabilities = validateGraph(records, archive.manifest.release);
  if (canonicalJson(capabilities) !== canonicalJson(archive.manifest.compatibility)) {
    throw new ContentPackManifestError("Definition payload does not match declared compatibility");
  }
  return { ...archive, records, assets };
}

function checkPortableData(value: unknown) {
  // Use the graph's bounded format walker on JSON that does not contain a Definition as well.
  inspectPackJson(value);
}

const compatibleFields: Partial<Record<StoredRecordKind, readonly string[]>> = {
  rulesets: ["id", "canonicalKey", "parentRulesetId"],
  "keyword-categories": ["id", "canonicalKey"],
  "keyword-definitions": ["id", "canonicalKey", "categoryId"],
  "source-documents": ["id", "title", "sourceType", "versionLabel"],
};

function protectedPayload(kind: StoredRecordKind, row: Row): string {
  const fields = compatibleFields[kind];
  if (fields) return canonicalJson(fields.map((name) => row[name]));
  const content = { ...row };
  delete content.updatedAt;
  if (kind === "entity-versions" && row.status !== "DRAFT" && row.status !== "IN_REVIEW") delete content.status;
  return canonicalJson(content);
}

type Incoming = Awaited<ReturnType<typeof validateIncoming>>;
export interface ContentPackPreview {
  manifest: ContentPackManifest;
  archiveSha256: string;
  previewFingerprint: string;
  trust: "Unverified source";
  state: "Ready" | "Already installed" | "Conflict";
  added: number;
  reused: number;
  conflicts: string[];
}

async function plan(tx: Tx, incoming: Incoming) {
  const { manifest, archiveSha256 } = incoming;
  const toInsert = new Map<StoredRecordKind, Row[]>();
  const observed: Array<[ContentPackRecordKind, string, string]> = [];
  const conflicts: string[] = [];
  let reused = 0;
  const receipt = await tx.contentPackReceipt.findUnique({ where: { releaseId: manifest.release.releaseId } });
  if (receipt && receipt.contentDigest !== manifest.contentDigest) {
    conflicts.push(`Release ${manifest.release.releaseId} already has a different pack receipt`);
  }
  for (const kind of kinds) {
    const rows = incoming.records.get(kind) ?? [];
    if (rows.length === 0) continue;
    const disjunction = rows.flatMap((row) => uniqueKeys(kind, row).map(([, where]) => where));
    const found = new Map<string, Row>();
    for (const group of batches(disjunction)) {
      for (const row of await selectedRows(tx, kind, { OR: group })) {
        for (const [key] of uniqueKeys(kind, row)) found.set(key, row);
      }
    }
    const missing: Row[] = [];
    for (const row of rows) {
      const key = rowKey(kind, row);
      const current = new Set(uniqueKeys(kind, row).map(([id]) => found.get(id)).filter((value) => value !== undefined));
      if (current.size === 0) {
        missing.push(row);
        continue;
      }
      let compatible = false;
      for (const existing of current) {
        const protectedState = protectedPayload(kind, existing);
        observed.push([kind, rowKey(kind, existing), protectedState]);
        compatible = rowKey(kind, existing) === key && protectedState === protectedPayload(kind, row);
      }
      if (current.size === 1 && compatible) reused++;
      else conflicts.push(`Conflicting ${kind} identity ${key}`);
    }
    toInsert.set(kind, missing);
  }

  const locations = [];
  for (const row of incoming.records.get("source-locations") ?? []) {
    const existing = await tx.contentPackSourceLocation.findUnique({ where: { id: row.id as string } });
    if (existing === null) locations.push(row);
    else {
      const payload = canonicalJson(existing);
      observed.push(["source-locations", rowKey("source-locations", row), payload]);
      if (payload !== canonicalJson(row)) conflicts.push(`Conflicting source locator ${row.id}`);
      else reused++;
    }
  }
  const missingAssets = [];
  for (const asset of incoming.assets) {
    const existing = await tx.contentPackAsset.findUnique({ where: { sha256: asset.sha256 } });
    if (existing === null) missingAssets.push(asset);
    else {
      const digest = sha256(existing.bytes);
      if (digest !== asset.sha256 || existing.mediaType !== asset.mediaType) conflicts.push(`Conflicting asset ${asset.sha256}`);
      else reused++;
    }
  }
  const added = [...toInsert.values()].reduce((total, rows) => total + rows.length, locations.length + missingAssets.length);
  if (receipt?.contentDigest === manifest.contentDigest && added > 0) conflicts.push("Installed pack is missing records or assets");
  const state = conflicts.length > 0 ? "Conflict" : receipt ? "Already installed" : "Ready";
  const payload = [manifest.contentDigest, archiveSha256, receipt?.contentDigest ?? null, observed, added, reused, conflicts];
  const preview: ContentPackPreview = {
    manifest, archiveSha256, trust: "Unverified source", state, added, reused, conflicts,
    previewFingerprint: sha256(canonicalJson(payload)),
  };
  return { preview, toInsert, locations, missingAssets };
}

export async function previewContentPack(bytes: Uint8Array, database = prisma): Promise<ContentPackPreview> {
  const incoming = await validateIncoming(bytes);
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return (await plan(tx, incoming)).preview;
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}

export class ContentPackInstallConflict extends Error {
  constructor(readonly preview: ContentPackPreview) {
    super(preview.conflicts[0] ?? "Content pack or catalog changed. Preview the file again.");
    this.name = "ContentPackInstallConflict";
  }
}

export async function installContentPack(bytes: Uint8Array, previewFingerprint: string, database = prisma) {
  const incoming = await validateIncoming(bytes);
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(812346572, 2)`;
    // Keep the catalog observed by this plan stable until the receipt commits. Ordinary reads still run.
    await tx.$executeRaw`LOCK TABLE rulesets, entities, keyword_categories, keyword_definitions,
      entity_versions, entity_aliases, entity_keywords, entity_version_keywords, entity_relationships,
      source_documents, source_references, ruleset_manifests, ruleset_manifest_entries, canon_policies,
      source_authority_records, rule_conflicts, rule_conflict_candidates, canon_decisions, canon_decision_selections,
      change_sets, change_set_operations, ruleset_releases IN SHARE ROW EXCLUSIVE MODE`;
    const prepared = await plan(tx, incoming);
    const preview = prepared.preview;
    if (preview.state === "Conflict") throw new ContentPackInstallConflict(preview);
    if (preview.state === "Already installed") return { ...preview, state: "Already installed" as const };
    if (preview.previewFingerprint !== previewFingerprint) throw new ContentPackInstallConflict(preview);

    await tx.$executeRaw`SET LOCAL prowess.content_pack_transfer = 'on'`;
    const ownership: Array<{ kind: StoredRecordKind; identity: string; contentDigest: string }> = [];
    for (const kind of kinds) {
      const rows = ancestryOrder(kind, prepared.toInsert.get(kind) ?? []);
      for (const group of batches(rows)) {
        await delegate(tx, kind).createMany({ data: group });
        for (const row of group) {
          const identity = catalog[kind].primary.map((key) => row[key]).join(":");
          ownership.push({ kind, identity, contentDigest: incoming.manifest.contentDigest });
        }
      }
    }
    for (const group of batches(prepared.locations)) {
      await tx.contentPackSourceLocation.createMany({ data: group as unknown as Prisma.ContentPackSourceLocationCreateManyInput[] });
    }
    for (const asset of prepared.missingAssets) await tx.contentPackAsset.create({ data: asset });
    await tx.contentPackReceipt.create({ data: {
      contentDigest: incoming.manifest.contentDigest,
      archiveSha256: incoming.archiveSha256,
      producerId: incoming.manifest.producerId,
      releaseId: incoming.manifest.release.releaseId,
      manifest: incoming.manifest,
    } });
    for (const group of batches(ownership)) await tx.contentPackOwnership.createMany({ data: group });
    return { ...preview, state: "Installed" as const };
  }, { timeout: 30_000 });
}

export async function listInstalledContentPacks() {
  return (await prisma.contentPackReceipt.findMany({ orderBy: [{ installedAt: "desc" }, { contentDigest: "asc" }], take: 200 }))
    .map(({ installedAt, manifest }) => ({ installedAt: installedAt.toISOString(), manifest: manifest as unknown as ContentPackManifest, trust: "Unverified source" as const }));
}
