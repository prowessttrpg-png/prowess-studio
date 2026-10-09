import { isValidCanonicalKey } from "./canonical-key.js";
import { isEntityType, type EntityType } from "./entity-type.js";
import { DomainError, EXTRACTION_CANDIDATE_ERROR_CODES, IMPORT_BATCH_ERROR_CODES } from "./errors.js";
import type {
  ExtractionCandidateId,
  ExtractionCandidateSourceId,
  ImportBatchId,
  RulesetId,
  RulesetManifestId,
  SourceContentNodeId,
  SourceSectionId,
  SourceSnapshotId,
} from "./ids.js";
import type { JsonObject } from "./json.js";

/**
 * Import Batches & Extraction Candidates (PAS-10 M3-WO2).
 *
 * ```
 * SourceDocument -> SourceSnapshot -> ImportBatch -> ExtractionCandidate (UNREVIEWED)
 * ```
 *
 * An ImportBatch is one reproducible extraction attempt against ONE exact, structurally-ingested SourceSnapshot.
 * An ExtractionCandidate is one immutable PROPOSED piece of extracted information with exact structural provenance.
 * Candidates are proposals only: recording one never creates or changes an Entity, EntityVersion, Keyword,
 * relationship, Ruleset, Manifest, Canon policy, conflict, decision, ChangeSet, Release or MigrationPlan.
 *
 * Extraction confidence is not source authority, and an APPROVED candidate (a future import-review outcome) is not
 * Canon. See docs/architecture/m3-import-batches-candidates.md.
 */

// ---------------------------------------------------------------------------------------------------------------
// Vocabularies (each mirrored exactly by a Prisma enum — see the M1 audit enum-parity test)
// ---------------------------------------------------------------------------------------------------------------

/** What part of the Snapshot a Batch covers. Arbitrary multi-section scopes are deliberately unsupported. */
export const IMPORT_BATCH_SCOPE_TYPES = ["SNAPSHOT", "SECTION_SUBTREE"] as const;
export type ImportBatchScopeType = (typeof IMPORT_BATCH_SCOPE_TYPES)[number];
export const isImportBatchScopeType = (v: unknown): v is ImportBatchScopeType =>
  typeof v === "string" && (IMPORT_BATCH_SCOPE_TYPES as readonly string[]).includes(v);

/**
 * Batch lifecycle vocabulary. RESERVED in WO2: every Batch is created CREATED and no transition exists yet
 * (extraction transitions belong to WO3, review/completion to WO6).
 */
export const IMPORT_BATCH_STATUSES = ["CREATED", "EXTRACTING", "READY_FOR_REVIEW", "REVIEWING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];
export const isImportBatchStatus = (v: unknown): v is ImportBatchStatus =>
  typeof v === "string" && (IMPORT_BATCH_STATUSES as readonly string[]).includes(v);
/** The only status WO2 ever writes for a Batch. */
export const INITIAL_IMPORT_BATCH_STATUS = "CREATED" satisfies ImportBatchStatus;

/** Generic extraction kinds — infrastructure vocabulary, never game-specific (no SPELL_EFFECT, WEAPON_RULE, ...). */
export const EXTRACTION_CANDIDATE_KINDS = ["ENTITY", "ENTITY_FIELD", "FORMULA", "REQUIREMENT", "KEYWORD", "RELATIONSHIP", "REFERENCE", "UNKNOWN"] as const;
export type ExtractionCandidateKind = (typeof EXTRACTION_CANDIDATE_KINDS)[number];
export const isExtractionCandidateKind = (v: unknown): v is ExtractionCandidateKind =>
  typeof v === "string" && (EXTRACTION_CANDIDATE_KINDS as readonly string[]).includes(v);
/** Kinds for which `proposedEntityType` is meaningful. For every other kind it must be null. */
export const ENTITY_TYPED_CANDIDATE_KINDS = ["ENTITY", "ENTITY_FIELD"] as const satisfies readonly ExtractionCandidateKind[];

/**
 * How confident the EXTRACTION PROCESS was that it identified / interpreted the candidate correctly.
 * It is NOT source authority, Canon priority, balance confidence or design approval: a HIGH-confidence candidate
 * from a REFERENCE_ONLY source outranks nothing, and a LOW-confidence candidate from a GOVERNING source does not
 * become Canon.
 */
export const EXTRACTION_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type ExtractionConfidence = (typeof EXTRACTION_CONFIDENCES)[number];
export const isExtractionConfidence = (v: unknown): v is ExtractionConfidence =>
  typeof v === "string" && (EXTRACTION_CONFIDENCES as readonly string[]).includes(v);

/**
 * The approved PAS-07 candidate vocabulary. WO2 writes only UNREVIEWED; no transition exists yet (matching is WO4,
 * review decisions WO6). APPROVED will mean "approved through the import review workflow" — never Canon,
 * published, part of a Manifest, or EntityVersion status CANON.
 */
export const EXTRACTION_CANDIDATE_STATUSES = ["UNREVIEWED", "MATCHED", "NEW_ENTITY", "CONFLICT", "NEEDS_MAPPING", "REJECTED", "APPROVED"] as const;
export type ExtractionCandidateStatus = (typeof EXTRACTION_CANDIDATE_STATUSES)[number];
export const isExtractionCandidateStatus = (v: unknown): v is ExtractionCandidateStatus =>
  typeof v === "string" && (EXTRACTION_CANDIDATE_STATUSES as readonly string[]).includes(v);
/** The only status WO2 ever writes for a Candidate. */
export const INITIAL_EXTRACTION_CANDIDATE_STATUS = "UNREVIEWED" satisfies ExtractionCandidateStatus;

/** Documented limits. */
export const MAX_IMPORT_BATCH_LABEL_LENGTH = 300;
export const MAX_IMPORT_TEXT_LENGTH = 4000;
export const MAX_EXTRACTOR_KEY_LENGTH = 200;
export const MAX_PAYLOAD_SCHEMA_KEY_LENGTH = 200;
export const MAX_SUPPORTING_ANCHORS = 100;
export const MAX_CANDIDATES_PER_CALL = 5000;
/** Extractor key / payload schema key syntax: lowercase dotted / dashed identifiers, e.g. "prowess.entity.skill". */
export const IMPORT_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[.\-_][a-z0-9]+)*$/;
/** The documented extractor key for synthetic / manual foundation work before WO3's extractor exists. */
export const MANUAL_FOUNDATION_EXTRACTOR_KEY = "manual-foundation";

// ---------------------------------------------------------------------------------------------------------------
// Persisted domain shapes
// ---------------------------------------------------------------------------------------------------------------

export interface ImportBatch {
  id: ImportBatchId;
  sourceSnapshotId: SourceSnapshotId;
  /** The exact WO1 ingestion `structureHash` of the Snapshot when the Batch was created (composite-key pinned). */
  sourceStructureHash: string;
  label: string;
  description: string | null;
  scopeType: ImportBatchScopeType;
  /** Root section of a SECTION_SUBTREE Batch; null for SNAPSHOT. Always a section of `sourceSnapshotId`. */
  scopeSectionId: SourceSectionId | null;
  /** Review CONTEXT only — never a destination, an import target, or anything that is mutated. */
  reviewRulesetId: RulesetId | null;
  /** An EXACT historical comparison baseline of `reviewRulesetId` — never a "latest" Manifest. */
  comparisonManifestId: RulesetManifestId | null;
  extractorKey: string;
  extractorVersion: string;
  extractorConfigHash: string | null;
  /** SHA-256 (lowercase hex) of the versioned extraction-context preimage (PROWESS_IMPORT_BATCH_V1). */
  batchFingerprint: string;
  status: ImportBatchStatus;
  createdAt: Date;
}

/** Derived (never persisted) counts over a Batch's Candidates. Every vocabulary value is present, zero or not. */
export interface ImportBatchSummary {
  candidateCount: number;
  byConfidence: Record<ExtractionConfidence, number>;
  byStatus: Record<ExtractionCandidateStatus, number>;
  byKind: Record<ExtractionCandidateKind, number>;
}

export interface ImportBatchWithSummary extends ImportBatch {
  summary: ImportBatchSummary;
}

/** A supporting source anchor: additional evidence for a Candidate, never another Candidate. */
export interface ExtractionCandidateSource {
  id: ExtractionCandidateSourceId;
  extractionCandidateId: ExtractionCandidateId;
  sourceSnapshotId: SourceSnapshotId;
  /** Exactly one of sourceSectionId / sourceContentNodeId is non-null. */
  sourceSectionId: SourceSectionId | null;
  sourceContentNodeId: SourceContentNodeId | null;
  /** 1-based position among the Candidate's supporting anchors (the order the extractor gave). */
  ordinal: number;
  /** A verbatim excerpt of the anchored block / table text, or null. Never paraphrase. */
  excerpt: string | null;
  createdAt: Date;
}

export interface ExtractionCandidate {
  id: ExtractionCandidateId;
  importBatchId: ImportBatchId;
  /** Always the Batch's Snapshot (composite-key enforced). */
  sourceSnapshotId: SourceSnapshotId;
  /** Positive extractor-output / review order within the Batch. Not priority, authority, confidence or Canon order. */
  ordinal: number;
  candidateKind: ExtractionCandidateKind;
  /** An extractor PROPOSAL only — never looked up, never matched in WO2. */
  proposedEntityType: EntityType | null;
  /** An extractor PROPOSAL only — syntax-checked, never looked up, never matched in WO2. */
  proposedCanonicalKey: string | null;
  displayLabel: string;
  summary: string | null;
  confidence: ExtractionConfidence;
  status: ExtractionCandidateStatus;
  payloadSchemaKey: string;
  payloadSchemaVersion: number;
  payload: JsonObject;
  /** SHA-256 (lowercase hex) of the versioned content preimage (PROWESS_EXTRACTION_CANDIDATE_V1). */
  candidateFingerprint: string;
  /** Exactly one of the two primary anchors is non-null. */
  primarySourceSectionId: SourceSectionId | null;
  primarySourceContentNodeId: SourceContentNodeId | null;
  supportingSources: ExtractionCandidateSource[];
  createdAt: Date;
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------------------------

export interface ImportBatchScopeInput {
  type: ImportBatchScopeType;
  sectionId?: string | null;
}

export interface CreateImportBatchInput {
  sourceSnapshotId: string;
  label: string;
  description?: string | null;
  scope: ImportBatchScopeInput;
  reviewRulesetId?: string | null;
  comparisonManifestId?: string | null;
  extractorKey: string;
  extractorVersion: string;
  extractorConfigHash?: string | null;
}

/** Exactly one of sectionId / contentNodeId. `excerpt` is allowed only on supporting anchors. */
export interface ExtractionSourceAnchorInput {
  sectionId?: string | null;
  contentNodeId?: string | null;
  excerpt?: string | null;
}

export interface CreateExtractionCandidateInput {
  ordinal: number;
  candidateKind: ExtractionCandidateKind;
  proposedEntityType?: EntityType | null;
  proposedCanonicalKey?: string | null;
  displayLabel: string;
  summary?: string | null;
  confidence: ExtractionConfidence;
  payloadSchemaKey: string;
  payloadSchemaVersion: number;
  payloadJson: JsonObject;
  primarySourceAnchor: ExtractionSourceAnchorInput;
  supportingSourceAnchors?: ExtractionSourceAnchorInput[];
}

export interface ListImportBatchesFilter {
  sourceSnapshotId?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Validation (pure, strict: unknown and server-controlled fields are rejected, never silently ignored)
// ---------------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuidString = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isSha256 = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isOptional = (v: unknown, check: (x: unknown) => boolean) => v === undefined || v === null || check(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], fail: (m: string) => DomainError, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw fail(`${where}: field ${JSON.stringify(key)} is not accepted (server-controlled or unknown)`);
  }
}

export const CREATE_IMPORT_BATCH_FIELDS = ["sourceSnapshotId", "label", "description", "scope", "reviewRulesetId", "comparisonManifestId", "extractorKey", "extractorVersion", "extractorConfigHash"] as const;

/** Throws IMPORT_BATCH.INVALID_INPUT / INVALID_SCOPE / INVALID_COMPARISON_CONTEXT for shape problems. */
export function validateCreateImportBatchInput(input: CreateImportBatchInput): void {
  const bad = (m: string) => new DomainError(IMPORT_BATCH_ERROR_CODES.INVALID_INPUT, m);
  const scopeError = (m: string) => new DomainError(IMPORT_BATCH_ERROR_CODES.INVALID_SCOPE, m);
  const contextError = (m: string) => new DomainError(IMPORT_BATCH_ERROR_CODES.INVALID_COMPARISON_CONTEXT, m);
  if (!isPlainObject(input)) throw bad("input must be an object");
  assertOnlyKeys(input, CREATE_IMPORT_BATCH_FIELDS, bad, "createImportBatch");
  if (typeof input.sourceSnapshotId !== "string" || input.sourceSnapshotId.length === 0) throw bad("sourceSnapshotId is required");
  if (!isText(input.label, MAX_IMPORT_BATCH_LABEL_LENGTH)) throw bad(`label is required (at most ${MAX_IMPORT_BATCH_LABEL_LENGTH} characters)`);
  if (!isOptional(input.description, (v) => typeof v === "string" && v.length <= MAX_IMPORT_TEXT_LENGTH)) throw bad("description must be a string");
  if (!isText(input.extractorKey, MAX_EXTRACTOR_KEY_LENGTH) || !IMPORT_IDENTIFIER_PATTERN.test(input.extractorKey)) throw bad("extractorKey must be a lowercase dotted identifier");
  if (!isText(input.extractorVersion, 100) || /\s/.test(input.extractorVersion)) throw bad("extractorVersion is required and contains no whitespace");
  if (!isOptional(input.extractorConfigHash, isSha256)) throw bad("extractorConfigHash must be a lowercase SHA-256 hex digest");

  if (!isPlainObject(input.scope)) throw scopeError("scope is required");
  assertOnlyKeys(input.scope, ["type", "sectionId"], scopeError, "scope");
  if (!isImportBatchScopeType(input.scope.type)) throw scopeError(`scope.type must be one of ${IMPORT_BATCH_SCOPE_TYPES.join(", ")}`);
  const sectionId = input.scope.sectionId ?? null;
  if (input.scope.type === "SNAPSHOT" && sectionId !== null) throw scopeError("a SNAPSHOT scope has no sectionId");
  if (input.scope.type === "SECTION_SUBTREE" && sectionId === null) throw scopeError("a SECTION_SUBTREE scope requires sectionId");

  const rulesetId = input.reviewRulesetId ?? null;
  const manifestId = input.comparisonManifestId ?? null;
  if (rulesetId !== null && typeof rulesetId !== "string") throw contextError("reviewRulesetId must be a string id");
  if (manifestId !== null && typeof manifestId !== "string") throw contextError("comparisonManifestId must be a string id");
  if (manifestId !== null && rulesetId === null) throw contextError("comparisonManifestId requires reviewRulesetId (the Manifest must belong to that exact Ruleset)");
}

export const CREATE_EXTRACTION_CANDIDATE_FIELDS = [
  "ordinal", "candidateKind", "proposedEntityType", "proposedCanonicalKey", "displayLabel", "summary", "confidence",
  "payloadSchemaKey", "payloadSchemaVersion", "payloadJson", "primarySourceAnchor", "supportingSourceAnchors",
] as const;

function assertAnchor(anchor: unknown, where: string, allowExcerpt: boolean): void {
  const bad = (m: string) => new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT, `${where}: ${m}`);
  if (!isPlainObject(anchor)) throw bad("anchor must be an object");
  assertOnlyKeys(anchor, allowExcerpt ? ["sectionId", "contentNodeId", "excerpt"] : ["sectionId", "contentNodeId"], (m) => bad(m), "anchor");
  const targets = [anchor.sectionId, anchor.contentNodeId].filter((v) => v !== undefined && v !== null);
  if (targets.length !== 1) throw bad("exactly one of sectionId / contentNodeId is required");
  if (typeof targets[0] !== "string" || (targets[0] as string).length === 0) throw bad("anchor ids must be strings");
  if (allowExcerpt && !isOptional(anchor.excerpt, (v) => isText(v, MAX_IMPORT_TEXT_LENGTH))) throw bad(`excerpt must be non-empty text of at most ${MAX_IMPORT_TEXT_LENGTH} characters`);
}

/** Throws EXTRACTION_CANDIDATE.INVALID_INPUT for any shape problem (anchor EXISTENCE / scope are service checks). */
export function validateCreateExtractionCandidateInput(input: CreateExtractionCandidateInput, where = "candidate"): void {
  const bad = (m: string) => new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT, `${where}: ${m}`);
  if (!isPlainObject(input)) throw bad("candidate must be an object");
  assertOnlyKeys(input, CREATE_EXTRACTION_CANDIDATE_FIELDS, (m) => new DomainError(EXTRACTION_CANDIDATE_ERROR_CODES.INVALID_INPUT, m), where);
  if (typeof input.ordinal !== "number" || !Number.isInteger(input.ordinal) || input.ordinal < 1 || input.ordinal > 2_147_483_647) throw bad("ordinal must be a positive integer");
  if (!isExtractionCandidateKind(input.candidateKind)) throw bad(`candidateKind must be one of ${EXTRACTION_CANDIDATE_KINDS.join(", ")}`);
  if (input.proposedEntityType !== undefined && input.proposedEntityType !== null) {
    if (typeof input.proposedEntityType !== "string" || !isEntityType(input.proposedEntityType)) throw bad("proposedEntityType must be a controlled EntityType");
    if (!(ENTITY_TYPED_CANDIDATE_KINDS as readonly string[]).includes(input.candidateKind)) throw bad(`proposedEntityType applies only to ${ENTITY_TYPED_CANDIDATE_KINDS.join(" / ")} candidates`);
  }
  if (!isOptional(input.proposedCanonicalKey, (v) => typeof v === "string" && isValidCanonicalKey(v))) throw bad("proposedCanonicalKey must be valid canonical-key syntax (it is a proposal; nothing is looked up)");
  if (!isText(input.displayLabel, MAX_IMPORT_BATCH_LABEL_LENGTH)) throw bad(`displayLabel is required (at most ${MAX_IMPORT_BATCH_LABEL_LENGTH} characters)`);
  if (!isOptional(input.summary, (v) => isText(v, MAX_IMPORT_TEXT_LENGTH))) throw bad("summary must be non-empty text when present");
  if (!isExtractionConfidence(input.confidence)) throw bad(`confidence must be one of ${EXTRACTION_CONFIDENCES.join(", ")}`);
  if (!isText(input.payloadSchemaKey, MAX_PAYLOAD_SCHEMA_KEY_LENGTH) || !IMPORT_IDENTIFIER_PATTERN.test(input.payloadSchemaKey)) throw bad("payloadSchemaKey must be a lowercase dotted identifier, e.g. \"prowess.entity.skill\"");
  if (typeof input.payloadSchemaVersion !== "number" || !Number.isInteger(input.payloadSchemaVersion) || input.payloadSchemaVersion < 1 || input.payloadSchemaVersion > 1_000_000) throw bad("payloadSchemaVersion must be a positive integer");
  if (!isPlainObject(input.payloadJson)) throw bad("payloadJson must be a JSON object");
  assertAnchor(input.primarySourceAnchor, `${where} primarySourceAnchor`, false);
  const supporting = input.supportingSourceAnchors ?? [];
  if (!Array.isArray(supporting) || supporting.length > MAX_SUPPORTING_ANCHORS) throw bad(`supportingSourceAnchors must be an array of at most ${MAX_SUPPORTING_ANCHORS}`);
  supporting.forEach((a, i) => assertAnchor(a, `${where} supportingSourceAnchors[${i}]`, true));
}

/** Every vocabulary value mapped to zero — the base of a derived summary. */
export function emptyImportBatchSummary(): ImportBatchSummary {
  const zeros = <T extends string>(values: readonly T[]) => Object.fromEntries(values.map((v) => [v, 0])) as Record<T, number>;
  return { candidateCount: 0, byConfidence: zeros(EXTRACTION_CONFIDENCES), byStatus: zeros(EXTRACTION_CANDIDATE_STATUSES), byKind: zeros(EXTRACTION_CANDIDATE_KINDS) };
}
