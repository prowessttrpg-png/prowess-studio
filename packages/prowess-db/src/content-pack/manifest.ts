import { createHash } from "node:crypto";
import {
  PROWESS_DEFINITION_KIND_NAMES,
  PROWESS_SYSTEM_FAMILIES,
  definitionKindSpec,
} from "@prowess/game";
import { canonicalJson } from "@prowess/import";
import { MAX_RELEASE_NOTES_LENGTH, MAX_RELEASE_VERSION_LABEL_LENGTH, RULESET_CHANNELS } from "@prowess/model";
import { z } from "zod";
import { computeManifestHash } from "../ruleset-release/hash.js";

export const CONTENT_PACK_MANIFEST_PATH = "manifest.json";
const FORMAT = "prowess.content-pack";
const VERSION = 1;
const DIGEST_DOMAIN = "PROWESS_CONTENT_PACK_V1\n";
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_PAYLOAD_BYTES = 128 * 1024 * 1024;
const MAX_RECORD_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 512;
const MAX_RECORDS = 100_000;

export const RECORD_KINDS = [
  "aliases", "canon-decisions", "canon-decision-selections", "canon-policies", "change-sets",
  "change-set-operations", "entities", "entity-versions", "entity-keywords", "entity-version-keywords",
  "keyword-categories", "keyword-definitions", "manifests", "manifest-entries", "relationships", "releases",
  "rule-conflicts", "rule-conflict-candidates", "rulesets", "source-authorities", "source-documents",
  "source-references", "source-locations",
] as const;
const CORE_RECORD_KINDS = ["canon-policies", "manifests", "releases", "rulesets"] as const;
const ASSET_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const EXACT_RELEASE = "prowess.exact-release.v1";
const STRUCTURED_DEFINITIONS = "prowess.structured-definitions.v1";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nonblankText = (length: number) => z.string().min(1).max(length).refine((text) => text === text.trim());
const timestamp = z.iso.datetime({ precision: 3 });

const recordFile = z.strictObject({
  type: z.literal("records"),
  kind: z.enum(RECORD_KINDS),
  path: z.string().max(128),
  byteSize: z.int().positive().max(MAX_RECORD_FILE_BYTES),
  recordCount: z.int().positive().max(MAX_RECORDS),
  sha256,
});

const assetFile = z.strictObject({
  type: z.literal("asset"),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  path: z.string().max(128),
  byteSize: z.int().positive().max(MAX_ASSET_BYTES),
  sha256,
});

const manifestBody = z.strictObject({
  format: z.literal(FORMAT),
  formatVersion: z.literal(VERSION),
  producerId: uuid,
  label: nonblankText(200),
  provenance: z.strictObject({
    claimedCreator: nonblankText(200),
    category: z.enum(["sample", "community", "official"]),
  }),
  release: z.strictObject({
    rulesetId: uuid,
    releaseId: uuid,
    manifestId: uuid,
    canonPolicyId: uuid,
    changeSetId: uuid.nullable(),
    releaseNumber: z.int().positive().max(2_147_483_647),
    versionLabel: nonblankText(MAX_RELEASE_VERSION_LABEL_LENGTH),
    channel: z.enum(RULESET_CHANNELS),
    manifestHash: sha256,
    releaseNotes: z.string().max(MAX_RELEASE_NOTES_LENGTH).nullable(),
    publishedAt: timestamp,
  }),
  compatibility: z.strictObject({
    capabilities: z.array(z.enum([EXACT_RELEASE, STRUCTURED_DEFINITIONS])).max(2),
    definitionSchemas: z.array(z.strictObject({
      kind: z.enum(PROWESS_DEFINITION_KIND_NAMES),
      family: z.enum(PROWESS_SYSTEM_FAMILIES),
      schemaVersion: z.int().positive(),
    })).max(256),
  }),
  files: z.array(z.discriminatedUnion("type", [recordFile, assetFile])).min(CORE_RECORD_KINDS.length).max(MAX_FILES),
  exportedAt: timestamp.optional(),
});

const manifestSchema = manifestBody.extend({ contentDigest: sha256 });
const manifestEntry = z.strictObject({ id: uuid, manifestId: uuid, entityId: uuid, entityVersionId: uuid, createdAt: timestamp });
export type ManifestBody = z.infer<typeof manifestBody>;
export type ContentPackRecordKind = (typeof RECORD_KINDS)[number];
export type ContentPackManifest = z.infer<typeof manifestSchema>;

export class ContentPackManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentPackManifestError";
  }
}

function parseManifest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const problem = result.error.issues[0];
  throw new ContentPackManifestError(`Invalid pack manifest at ${problem?.path.join(".") || "root"}: ${problem?.message ?? "invalid value"}`);
}

function assertSortedUnique(keys: readonly string[], label: string): void {
  for (let i = 1; i < keys.length; i++) {
    if (keys[i - 1]! >= keys[i]!) throw new ContentPackManifestError(`${label} must be unique and sorted`);
  }
}

function checkManifestSemantics(body: ManifestBody): void {
  const { capabilities, definitionSchemas } = body.compatibility;
  assertSortedUnique(capabilities, "Capabilities");
  if (!capabilities.includes(EXACT_RELEASE) || capabilities.includes(STRUCTURED_DEFINITIONS) !== (definitionSchemas.length > 0)) {
    throw new ContentPackManifestError("Capabilities do not cover the declared Release and Definition schemas");
  }
  assertSortedUnique(definitionSchemas.map(({ kind, schemaVersion }) => `${kind}:${schemaVersion}`), "Definition schemas");
  for (const schema of definitionSchemas) {
    const known = definitionKindSpec(schema.kind);
    if (known.family !== schema.family || !known.schemaVersions.includes(schema.schemaVersion)) {
      throw new ContentPackManifestError(`Unsupported Definition schema: ${schema.family}/${schema.kind}@${schema.schemaVersion}`);
    }
  }

  assertSortedUnique(body.files.map((file) => file.path), "File paths");
  const recordKinds = new Set<string>();
  let bytes = 0;
  let records = 0;
  for (const file of body.files) {
    const expected = file.type === "records"
      ? `records/${file.kind}.json`
      : `assets/${file.sha256}.${ASSET_EXTENSIONS[file.mediaType]}`;
    if (file.path !== expected) throw new ContentPackManifestError(`Invalid payload path for ${file.type}: expected ${expected}`);
    bytes += file.byteSize;
    if (file.type === "records") {
      recordKinds.add(file.kind);
      records += file.recordCount;
      if (file.kind === "releases" && file.recordCount !== 1) {
        throw new ContentPackManifestError("A pack must carry exactly one selected Release");
      }
    }
  }
  if (bytes > MAX_PAYLOAD_BYTES || records > MAX_RECORDS) {
    throw new ContentPackManifestError("Payload inventory exceeds pack limits");
  }
  for (const kind of CORE_RECORD_KINDS) {
    if (!recordKinds.has(kind)) throw new ContentPackManifestError(`Missing required record group: ${kind}`);
  }
}

function hash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function packDigest(body: ManifestBody): string {
  const content = { ...body };
  delete content.exportedAt;
  return hash(DIGEST_DOMAIN + canonicalJson(content));
}

export function readPackJson(bytes: Uint8Array, label: string): { text: string; value: unknown } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    throw new ContentPackManifestError(`${label} must be valid UTF-8 JSON`);
  }
}

/** Encode the root manifest after the exporter has inventoried its record and asset bytes. */
export function encodeContentPackManifest(input: ManifestBody): Uint8Array {
  const body = parseManifest(manifestBody, input);
  checkManifestSemantics(body);
  const bytes = Buffer.from(canonicalJson({ ...body, contentDigest: packDigest(body) }), "utf8");
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new ContentPackManifestError("Pack manifest exceeds the size limit");
  return bytes;
}

/** Verify canonical UTF-8 and the envelope digest before resolving any records or assets. */
export function decodeContentPackManifest(bytes: Uint8Array): ContentPackManifest {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new ContentPackManifestError("Pack manifest exceeds the size limit");
  const { text, value } = readPackJson(bytes, "Pack manifest");
  const manifest = parseManifest(manifestSchema, value);
  if (canonicalJson(manifest) !== text) throw new ContentPackManifestError("Pack manifest must be canonical JSON");
  const { contentDigest, ...body } = manifest;
  checkManifestSemantics(body);
  if (contentDigest !== packDigest(body)) throw new ContentPackManifestError("Pack content digest does not match the inventory");
  return manifest;
}

/** Compare the verified manifest to bytes from the bounded archive reader, excluding manifest.json. */
export function verifyContentPackInventory(manifest: ContentPackManifest, files: ReadonlyMap<string, Uint8Array>): void {
  if (files.size !== manifest.files.length) throw new ContentPackManifestError("Pack file count does not match the inventory");
  for (const file of manifest.files) {
    const bytes = files.get(file.path);
    if (bytes === undefined) throw new ContentPackManifestError(`Missing payload file: ${file.path}`);
    if (file.byteSize !== bytes.byteLength || file.sha256 !== hash(bytes)) {
      throw new ContentPackManifestError(`Payload bytes do not match the inventory: ${file.path}`);
    }
  }
}

/** Check the selected Release's original composition independently of the new pack digest. */
export function verifyContentPackReleaseComposition(manifest: ContentPackManifest, files: ReadonlyMap<string, Uint8Array>): void {
  verifyContentPackInventory(manifest, files);
  const inventory = manifest.files.find((file) => file.type === "records" && file.kind === "manifest-entries");
  const selectedPins = [];
  if (inventory?.type === "records") {
    const { text, value } = readPackJson(files.get(inventory.path)!, "Manifest entries");
    if (!Array.isArray(value) || value.length !== inventory.recordCount) {
      throw new ContentPackManifestError("Manifest entries do not match the declared record count");
    }
    const parsed = z.array(manifestEntry).safeParse(value);
    if (!parsed.success || canonicalJson(parsed.data) !== text) {
      throw new ContentPackManifestError("Manifest entries must be canonical JSON with exact pin identities");
    }
    const selectedEntities = new Set<string>();
    for (const entry of parsed.data) {
      if (entry.manifestId !== manifest.release.manifestId) continue;
      if (selectedEntities.has(entry.entityId)) throw new ContentPackManifestError(`Duplicate Release pin for Entity ${entry.entityId}`);
      selectedEntities.add(entry.entityId);
      selectedPins.push(entry);
    }
  }
  if (computeManifestHash(selectedPins) !== manifest.release.manifestHash) {
    throw new ContentPackManifestError(`Selected Release ${manifest.release.releaseId} does not match its original manifest hash`);
  }
}
