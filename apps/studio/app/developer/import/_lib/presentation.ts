import {
  EXTRACTION_CANDIDATE_STATUSES,
  IMPORT_BATCH_STATUSES,
  IMPORT_DECISION_RULES,
  IMPORT_DECISION_TYPES,
  TERMINAL_CANDIDATE_STATUSES,
  type ExtractionCandidateKind,
  type ExtractionCandidateStatus,
  type ImportDecisionType,
} from "@prowess/model";
import type { SourceSectionDto } from "../../../../src/api-client";

/**
 * Import Studio presentation (PAS-10 M3-WO8). Copy, labels and DERIVED display helpers only. Which review actions
 * to offer comes from the SHARED `IMPORT_DECISION_RULES` in @prowess/model — the browser never keeps its own
 * workflow graph, and the server stays authoritative (an action shown here can still be refused).
 */

/** The two official extractors (WO3 / WO5), with human labels. Technical identity stays visible. */
export const EXTRACTORS = [
  {
    key: "prowess.structural",
    version: "1",
    title: "Structural Extraction",
    description: "Identifies Sections, Tables and Root Content. Does not interpret Prowess rules.",
  },
  {
    key: "prowess.semantic-foundation",
    version: "1",
    title: "Semantic Foundation",
    description: "Identifies explicit Formula, Requirement and Keyword declarations. Extracted terms remain unresolved until review.",
  },
] as const;

export function extractorTitle(key: string, version: string): string {
  const known = EXTRACTORS.find((e) => e.key === key && e.version === version);
  return known ? known.title : "Unregistered extractor";
}

/** User-facing review-status labels: APPROVED is "Approved for Import", never "Canon". */
export const CANDIDATE_STATUS_LABEL: Record<ExtractionCandidateStatus, string> = {
  UNREVIEWED: "Unreviewed",
  MATCHED: "Matched",
  NEW_ENTITY: "New Entity",
  CONFLICT: "Import Conflict",
  NEEDS_MAPPING: "Needs Mapping",
  REJECTED: "Rejected",
  APPROVED: "Approved for Import",
};

export const CANDIDATE_STATUS_HELP: Partial<Record<ExtractionCandidateStatus, string>> = {
  APPROVED: "Approved for Import: passed import review. This is not Canon, not published, and creates no Entity or Version.",
  CONFLICT: "Import review conflict. This is not yet a Ruleset RuleConflict.",
  REJECTED: "Rejected in import review. The Candidate stays stored as source evidence.",
  NEEDS_MAPPING: "Meaningful, but cannot yet be safely mapped or classified.",
};

/** Batch lifecycle as rendered. COMPLETED reads "Review Complete" — not imported, applied or published. */
export const BATCH_STATUS_LABEL: Record<string, string> = {
  CREATED: "Created",
  EXTRACTING: "Extracting",
  READY_FOR_REVIEW: "Ready for Review",
  REVIEWING: "Reviewing",
  COMPLETED: "Review Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};
/** The five lifecycle steps the Studio renders (FAILED / CANCELLED are reserved and never reached in M3). */
export const BATCH_LIFECYCLE = IMPORT_BATCH_STATUSES.filter((s) => s !== "FAILED" && s !== "CANCELLED");

export const MATCH_OUTCOME_LABEL: Record<string, string> = {
  EXACT_MATCH: "Exact Entity Match",
  POTENTIAL_MATCH: "Potential Match (not accepted)",
  NO_MATCH: "No Match",
  INSUFFICIENT_IDENTITY: "Insufficient Identity",
  NOT_APPLICABLE: "Not Applicable",
};
export const MATCH_BASIS_LABEL: Record<string, string> = {
  CANONICAL_KEY_EXACT: "via canonical key",
  ALIAS_EXACT: "via alias",
  DISPLAY_LABEL_EXACT: "display label",
  NORMALIZED_LABEL: "normalized label",
  FUZZY_LABEL: "fuzzy label",
  NONE: "—",
};
export const CONFLICT_SIGNAL_LABEL: Record<string, string> = {
  DUPLICATE_EQUIVALENT: "Equivalent duplicate",
  POTENTIAL_CONTENT_CONFLICT: "Potential content conflict",
  UNCOMPARABLE_DUPLICATE: "Uncomparable duplicate",
};
export const CONFLICT_SIGNAL_HELP: Record<string, string> = {
  DUPLICATE_EQUIVALENT: "Same identity and canonically equal payloads from different source locations. Both remain separate evidence.",
  POTENTIAL_CONTENT_CONFLICT: "Same identity, different payloads. No winner is chosen — review decides.",
  UNCOMPARABLE_DUPLICATE: "Same identity, but the payload schemas differ, so the payloads cannot be safely compared.",
};

export const DECISION_LABEL: Record<ImportDecisionType, string> = {
  CLASSIFY_MATCHED: "Classify as Matched",
  CLASSIFY_NEW_ENTITY: "Classify as New Entity",
  MARK_CONFLICT: "Mark Import Conflict",
  MARK_NEEDS_MAPPING: "Needs Mapping",
  REJECT: "Reject",
  APPROVE_MATCHED: "Approve Matched for Import",
  APPROVE_NEW_ENTITY: "Approve New Entity for Import",
  APPROVE_SEMANTIC: "Approve Semantic for Import",
};

/** Decision types the shared rules allow for this status and kind (display aid only — the server decides). */
export function availableDecisions(status: string, kind: string): ImportDecisionType[] {
  return IMPORT_DECISION_TYPES.filter((t) => {
    const rule = IMPORT_DECISION_RULES[t];
    return (rule.fromStatuses as readonly string[]).includes(status) && (rule.kinds as readonly string[]).includes(kind as ExtractionCandidateKind);
  });
}

export const isTerminalStatus = (status: string) => (TERMINAL_CANDIDATE_STATUSES as readonly string[]).includes(status);
export const REVIEWABLE_BATCH = (status: string) => status === "READY_FOR_REVIEW" || status === "REVIEWING";

/** Review progress from the DERIVED server summary — never recounted from loaded pages. */
export function reviewProgress(byStatus: Record<string, number>, total: number) {
  const approved = byStatus.APPROVED ?? 0;
  const rejected = byStatus.REJECTED ?? 0;
  return { total, approved, rejected, reviewed: approved + rejected, unresolved: total - approved - rejected };
}
export const STATUS_ORDER = EXTRACTION_CANDIDATE_STATUSES;

/** "Spellcasting > Spell Costs" for a section, following parent links within the loaded outline. */
export function sectionPath(sectionId: string | null, sections: readonly SourceSectionDto[]): string | null {
  if (sectionId === null) return null;
  const byId = new Map(sections.map((s) => [s.id, s]));
  const titles: string[] = [];
  let cur = byId.get(sectionId);
  let guard = 0;
  while (cur && guard < 64) {
    titles.unshift(cur.title);
    cur = cur.parentSectionId === null ? undefined : byId.get(cur.parentSectionId);
    guard += 1;
  }
  return titles.length === 0 ? null : titles.join(" > ");
}

/** The section a semantic payload's `sectionPath` names, resolved against the outline (display only). */
export function sectionForPath(path: unknown, sections: readonly SourceSectionDto[]): SourceSectionDto | null {
  if (typeof path !== "string") return null;
  return sections.find((s) => sectionPath(s.id, sections) === path) ?? null;
}

/** The section a Candidate's evidence lives in, from its anchors and structural / semantic payload. */
export function candidateSectionId(candidate: { primarySourceSectionId: string | null; payload: Record<string, unknown> }, sections: readonly SourceSectionDto[]): string | null {
  if (candidate.primarySourceSectionId) return candidate.primarySourceSectionId;
  const p = candidate.payload;
  if (typeof p.sourceSectionId === "string") return p.sourceSectionId;
  return sectionForPath(p.sectionPath, sections)?.id ?? null;
}

export const shortHash = (hash: string | null | undefined) => (hash ? hash.slice(0, 12) : "—");
export const formatDate = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Readable copy for import error codes (the code itself is always shown too). */
export function describeImportError(code: string, message: string): string {
  const known: Record<string, string> = {
    "IMPORT_DECISION.INVALID_TRANSITION": "That review action is not allowed from the Candidate's current state.",
    "IMPORT_DECISION.DECISION_CONFLICT": "Review state changed — another review was recorded first. The Candidate has been refreshed.",
    "IMPORT_DECISION.MANUAL_RATIONALE_REQUIRED": "A manual override needs a rationale.",
    "IMPORT_DECISION.MATCH_RUN_MISMATCH": "That MatchRun analyses a different Import Batch.",
    "IMPORT_DECISION.DUPLICATE_GROUP_MISMATCH": "This Candidate is not a member of that duplicate group.",
    "IMPORT_DECISION.INVALID_EVIDENCE": "The cited evidence does not support that decision (or the Candidate changed).",
    "IMPORT_REVIEW.INCOMPLETE": "Review cannot complete while Candidates are unresolved.",
    "IMPORT_REVIEW.NOT_READY": "This Batch is not open for review.",
    "IMPORT_BATCH.EXTRACTOR_NOT_FOUND": "Extractor unavailable: no extractor is registered for this Batch's exact key and version.",
    "IMPORT_BATCH.EXTRACTION_CONFLICT": "Extraction conflict: this Batch cannot be extracted in its current state.",
    "IMPORT_BATCH.NONDETERMINISTIC_OUTPUT": "Nondeterministic output: the extractor no longer reproduces the committed Candidate set.",
    "IMPORT_BATCH.ALREADY_REVIEWING": "Batch already in review — extraction is closed.",
  };
  return known[code] ?? message;
}
