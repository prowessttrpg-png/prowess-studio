import {
  DomainError,
  validateCreateExtractionCandidateInput,
  type CreateExtractionCandidateInput,
  type ImportBatchScopeType,
  type ResolvedSourceContentNode,
  type SourceSection,
} from "@prowess/model";
import { CanonicalJsonError } from "./canonical-json.js";
import { extractionCandidateFingerprint, extractionSetHash } from "./fingerprint.js";
import { sectionSubtree } from "./scope.js";

/**
 * Extractor registry and runner (PAS-10 M3-WO3) — pure. An extractor receives an in-scope, source-ordered view of ONE
 * Snapshot's structure and returns Candidate drafts. It never touches a database, a network, an AI service, Canon,
 * Rulesets or source authority. Lookup is by the EXACT key + version recorded on the ImportBatch: there is no
 * "latest", "newest compatible" or default extractor.
 */

/** What the Batch says about the extraction to run. */
export interface ExtractionBatchIdentity {
  importBatchId: string;
  sourceSnapshotId: string;
  sourceStructureHash: string;
  scopeType: ImportBatchScopeType;
  scopeSectionId: string | null;
  extractorKey: string;
  extractorVersion: string;
  extractorConfigHash: string | null;
}

/** The pure input an extractor receives: only in-scope structure, sorted by source order (ordinal, then id). */
export interface ExtractionContext {
  batch: ExtractionBatchIdentity;
  sections: readonly SourceSection[];
  nodes: readonly ResolvedSourceContentNode[];
}

export interface ExtractorPayloadSchema {
  key: string;
  version: number;
}

export interface ExtractorDefinition {
  key: string;
  version: string;
  description: string;
  /** The only payload schemas this extractor may emit. Anything else is invalid output. */
  payloadSchemas: readonly ExtractorPayloadSchema[];
  /** Whether a Batch may carry an extractorConfigHash for this extractor. */
  acceptsConfiguration: boolean;
  extract(context: ExtractionContext): CreateExtractionCandidateInput[];
}

export type ExtractionErrorKind = "EXTRACTOR_NOT_FOUND" | "INVALID_EXTRACTOR_OUTPUT";

/** Raised by the runner; @prowess/db maps it onto IMPORT_BATCH.* controlled errors. */
export class ExtractionError extends Error {
  constructor(readonly kind: ExtractionErrorKind, message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

const registryKey = (key: string, version: string) => `${key}@${version}`;

export class ExtractorRegistry {
  private readonly byKey = new Map<string, ExtractorDefinition>();

  constructor(definitions: readonly ExtractorDefinition[]) {
    for (const d of definitions) {
      const k = registryKey(d.key, d.version);
      if (this.byKey.has(k)) throw new Error(`duplicate extractor registration ${k}`);
      this.byKey.set(k, d);
    }
  }

  /** Exact lookup. Never falls forward to another version. */
  find(key: string, version: string): ExtractorDefinition | null {
    return this.byKey.get(registryKey(key, version)) ?? null;
  }

  keys(): string[] {
    return [...this.byKey.keys()].sort();
  }
}

const bySourceOrder = <T extends { ordinal: number; id: string }>(a: T, b: T) => a.ordinal - b.ordinal || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Restricts a Snapshot's structure to the Batch scope and puts it in source order (ordinal, then id as a stable
 * tie-breaker — never database read order). SECTION_SUBTREE: the root section, its descendants, and nodes inside them.
 */
export function scopeStructure(
  batch: Pick<ExtractionBatchIdentity, "scopeType" | "scopeSectionId" | "sourceSnapshotId">,
  sections: readonly SourceSection[],
  nodes: readonly ResolvedSourceContentNode[],
): { sections: SourceSection[]; nodes: ResolvedSourceContentNode[] } {
  const ownSections = sections.filter((s) => s.sourceSnapshotId === batch.sourceSnapshotId);
  const ownNodes = nodes.filter((n) => n.sourceSnapshotId === batch.sourceSnapshotId);
  if (batch.scopeType === "SNAPSHOT") return { sections: [...ownSections].sort(bySourceOrder), nodes: [...ownNodes].sort(bySourceOrder) };
  const subtree = sectionSubtree(batch.scopeSectionId as string, ownSections.map((s) => ({ id: s.id, parentSectionId: s.parentSectionId })));
  return {
    sections: ownSections.filter((s) => subtree.has(s.id)).sort(bySourceOrder),
    nodes: ownNodes.filter((n) => n.sourceSectionId !== null && subtree.has(n.sourceSectionId)).sort(bySourceOrder),
  };
}

export interface ExtractionRun {
  definition: ExtractorDefinition;
  candidates: CreateExtractionCandidateInput[];
  /** Candidate fingerprints, index-aligned with `candidates`. */
  fingerprints: string[];
  outputHash: string;
}

/**
 * Looks up the exact extractor, scopes and orders the structure, runs the extractor, and validates the COMPLETE output
 * before anything could be persisted: shape, unique positive ordinals in ascending order, declared payload schemas,
 * anchors inside the scoped structure, canonical payloads, no duplicate fingerprints. Returns the output hash.
 */
export function runExtraction(
  registry: ExtractorRegistry,
  batch: ExtractionBatchIdentity,
  sections: readonly SourceSection[],
  nodes: readonly ResolvedSourceContentNode[],
): ExtractionRun {
  const definition = registry.find(batch.extractorKey, batch.extractorVersion);
  if (!definition) throw new ExtractionError("EXTRACTOR_NOT_FOUND", `no extractor is registered as exactly ${batch.extractorKey}@${batch.extractorVersion} (registered: ${registry.keys().join(", ") || "none"})`);
  if (batch.extractorConfigHash !== null && !definition.acceptsConfiguration) {
    throw new ExtractionError("EXTRACTOR_NOT_FOUND", `${definition.key}@${definition.version} accepts no configuration, but the Batch pins configHash ${batch.extractorConfigHash}`);
  }
  const scoped = scopeStructure(batch, sections, nodes);
  let candidates: CreateExtractionCandidateInput[];
  try {
    candidates = definition.extract({ batch, sections: scoped.sections, nodes: scoped.nodes });
  } catch (error) {
    throw new ExtractionError("INVALID_EXTRACTOR_OUTPUT", `${definition.key}@${definition.version} failed: ${(error as Error).message}`);
  }
  const fingerprints = validateExtractorOutput(definition, candidates, scoped);
  return { definition, candidates, fingerprints, outputHash: extractionSetHash(candidates.map((c, i) => ({ ordinal: c.ordinal, candidateFingerprint: fingerprints[i] as string }))) };
}

function validateExtractorOutput(
  definition: ExtractorDefinition,
  candidates: unknown,
  scoped: { sections: readonly SourceSection[]; nodes: readonly ResolvedSourceContentNode[] },
): string[] {
  const invalid = (m: string) => new ExtractionError("INVALID_EXTRACTOR_OUTPUT", `${definition.key}@${definition.version}: ${m}`);
  if (!Array.isArray(candidates)) throw invalid("output must be an array of candidates");
  const sectionIds = new Set<string>(scoped.sections.map((s) => s.id));
  const nodeIds = new Set<string>(scoped.nodes.map((n) => n.id));
  const schemas = new Set(definition.payloadSchemas.map((s) => `${s.key}@${s.version}`));
  const fingerprints: string[] = [];
  const seen = new Set<string>();
  let previousOrdinal = 0;
  candidates.forEach((c: CreateExtractionCandidateInput, i) => {
    try {
      validateCreateExtractionCandidateInput(c, `candidate ${i}`);
    } catch (error) {
      if (error instanceof DomainError) throw invalid(error.message);
      throw error;
    }
    if (c.ordinal <= previousOrdinal) throw invalid(`candidate ${i}: ordinals must be unique and ascending in output order (${c.ordinal} after ${previousOrdinal})`);
    previousOrdinal = c.ordinal;
    if (!schemas.has(`${c.payloadSchemaKey}@${c.payloadSchemaVersion}`)) throw invalid(`candidate ${i}: payload schema ${c.payloadSchemaKey}@${c.payloadSchemaVersion} is not declared by this extractor`);
    const anchors = [c.primarySourceAnchor, ...(c.supportingSourceAnchors ?? [])];
    for (const a of anchors) {
      if (typeof a.sectionId === "string" && !sectionIds.has(a.sectionId)) throw invalid(`candidate ${i}: section ${a.sectionId} is not in-scope structure of this Snapshot`);
      if (typeof a.contentNodeId === "string" && !nodeIds.has(a.contentNodeId)) throw invalid(`candidate ${i}: content node ${a.contentNodeId} is not in-scope structure of this Snapshot`);
    }
    let fingerprint: string;
    try {
      fingerprint = extractionCandidateFingerprint({
        candidateKind: c.candidateKind,
        proposedEntityType: c.proposedEntityType ?? null,
        proposedCanonicalKey: c.proposedCanonicalKey ?? null,
        displayLabel: c.displayLabel,
        confidence: c.confidence,
        payloadSchemaKey: c.payloadSchemaKey,
        payloadSchemaVersion: c.payloadSchemaVersion,
        payload: c.payloadJson,
        primaryAnchor: { sectionId: c.primarySourceAnchor.sectionId ?? null, contentNodeId: c.primarySourceAnchor.contentNodeId ?? null },
        supportingAnchors: (c.supportingSourceAnchors ?? []).map((a) => ({ sectionId: a.sectionId ?? null, contentNodeId: a.contentNodeId ?? null, excerpt: a.excerpt ?? null })),
      });
    } catch (error) {
      if (error instanceof CanonicalJsonError) throw invalid(`candidate ${i}: ${error.message}`);
      throw error;
    }
    if (seen.has(fingerprint)) throw invalid(`candidate ${i}: duplicate candidate content (fingerprint ${fingerprint})`);
    seen.add(fingerprint);
    fingerprints.push(fingerprint);
  });
  return fingerprints;
}
