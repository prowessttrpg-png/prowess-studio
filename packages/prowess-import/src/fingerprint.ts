import { createHash } from "node:crypto";
import type { ExtractionCandidateKind, ExtractionConfidence, ImportBatchScopeType, JsonObject } from "@prowess/model";
import { canonicalJson } from "./canonical-json.js";

/**
 * Deterministic, versioned fingerprints (PAS-10 M3-WO2). Both are SHA-256 over the UTF-8 bytes of a documented
 * preimage, stored as lowercase hexadecimal. A format change MUST introduce a new version tag (…_V2) — never
 * silently alter V1, because stored fingerprints are identities.
 */
export const IMPORT_BATCH_FINGERPRINT_VERSION = "PROWESS_IMPORT_BATCH_V1";
export const EXTRACTION_CANDIDATE_FINGERPRINT_VERSION = "PROWESS_EXTRACTION_CANDIDATE_V1";

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Absent optional values are written as the literal `null`; UUIDs are lowercased (their canonical text form). */
const v = (value: string | null | undefined) => (value === null || value === undefined ? "null" : value);
const id = (value: string | null | undefined) => (value === null || value === undefined ? "null" : value.toLowerCase());

/** The extraction context that defines a Batch's identity. Label, description, ids and timestamps are excluded. */
export interface ImportBatchFingerprintInput {
  sourceSnapshotId: string;
  sourceStructureHash: string;
  scopeType: ImportBatchScopeType;
  scopeSectionId: string | null;
  reviewRulesetId: string | null;
  comparisonManifestId: string | null;
  extractorKey: string;
  extractorVersion: string;
  extractorConfigHash: string | null;
}

/**
 * ```
 * PROWESS_IMPORT_BATCH_V1
 * sourceSnapshot=<uuid>
 * structureHash=<sha256>
 * scopeType=SNAPSHOT|SECTION_SUBTREE
 * scopeSection=<uuid|null>
 * reviewRuleset=<uuid|null>
 * comparisonManifest=<uuid|null>
 * extractorKey=<key>
 * extractorVersion=<version>
 * configHash=<sha256|null>
 * ```
 * Lines are joined with "\n" (no trailing newline). Values cannot contain newlines: ids are UUIDs, hashes are hex,
 * and extractor key / version are validated identifiers without whitespace.
 */
export function importBatchFingerprintPreimage(input: ImportBatchFingerprintInput): string {
  for (const [k, value] of Object.entries(input)) {
    if (typeof value === "string" && /[\r\n]/.test(value)) throw new Error(`fingerprint field ${k} may not contain a newline`);
  }
  return [
    IMPORT_BATCH_FINGERPRINT_VERSION,
    `sourceSnapshot=${id(input.sourceSnapshotId)}`,
    `structureHash=${v(input.sourceStructureHash)}`,
    `scopeType=${input.scopeType}`,
    `scopeSection=${id(input.scopeSectionId)}`,
    `reviewRuleset=${id(input.reviewRulesetId)}`,
    `comparisonManifest=${id(input.comparisonManifestId)}`,
    `extractorKey=${v(input.extractorKey)}`,
    `extractorVersion=${v(input.extractorVersion)}`,
    `configHash=${v(input.extractorConfigHash)}`,
  ].join("\n");
}

export function importBatchFingerprint(input: ImportBatchFingerprintInput): string {
  return sha256Hex(importBatchFingerprintPreimage(input));
}

/** A resolved structural anchor: exactly one of the two ids. */
export interface FingerprintAnchor {
  sectionId: string | null;
  contentNodeId: string | null;
  excerpt?: string | null;
}

/** The extracted content that defines a Candidate's identity. Status, ordinal, summary, ids and timestamps are excluded. */
export interface ExtractionCandidateFingerprintInput {
  candidateKind: ExtractionCandidateKind;
  proposedEntityType: string | null;
  proposedCanonicalKey: string | null;
  displayLabel: string;
  confidence: ExtractionConfidence;
  payloadSchemaKey: string;
  payloadSchemaVersion: number;
  payload: JsonObject;
  primaryAnchor: FingerprintAnchor;
  /** In the extractor's order — the order is part of the content. */
  supportingAnchors: readonly FingerprintAnchor[];
}

const anchor = (a: FingerprintAnchor, withExcerpt: boolean) => {
  const base = a.sectionId !== null ? { kind: "SECTION", id: a.sectionId.toLowerCase() } : { kind: "CONTENT_NODE", id: (a.contentNodeId as string).toLowerCase() };
  return withExcerpt ? { ...base, excerpt: a.excerpt ?? null } : base;
};

/**
 * `PROWESS_EXTRACTION_CANDIDATE_V1` + "\n" + canonicalJson({ candidateKind, proposedEntityType, proposedCanonicalKey,
 * displayLabel, confidence, payloadSchemaKey, payloadSchemaVersion, payload, primaryAnchor, supportingAnchors }).
 * Anchors are `{kind: "SECTION"|"CONTENT_NODE", id}`; supporting anchors also carry `excerpt` (or null).
 */
export function extractionCandidateFingerprintPreimage(input: ExtractionCandidateFingerprintInput): string {
  return `${EXTRACTION_CANDIDATE_FINGERPRINT_VERSION}\n${canonicalJson({
    candidateKind: input.candidateKind,
    proposedEntityType: input.proposedEntityType,
    proposedCanonicalKey: input.proposedCanonicalKey,
    displayLabel: input.displayLabel,
    confidence: input.confidence,
    payloadSchemaKey: input.payloadSchemaKey,
    payloadSchemaVersion: input.payloadSchemaVersion,
    payload: input.payload,
    primaryAnchor: anchor(input.primaryAnchor, false),
    supportingAnchors: input.supportingAnchors.map((a) => anchor(a, true)),
  })}`;
}

export function extractionCandidateFingerprint(input: ExtractionCandidateFingerprintInput): string {
  return sha256Hex(extractionCandidateFingerprintPreimage(input));
}
