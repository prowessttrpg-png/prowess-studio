import { CANON_DECISION_RULES, CHANGE_SET_OPERATION_RULES } from "@prowess/model";

/**
 * Presentation helpers for the governance workspace (PAS-10 M2-WO10). PURE and UI-only: they decide which
 * named command BUTTONS to render and how to label things. They never decide outcomes — the API remains the
 * authority, and a concurrent change still surfaces as its domain error. Field/affordance rules are DERIVED
 * from @prowess/model's own tables so they cannot drift from the server.
 */
export interface CommandDescriptor {
  command: "submit-review" | "approve" | "reject";
  label: string;
  tone: "primary" | "consequential";
  confirm: string;
}

/** Ruleset review commands to show for a status (§10). APPROVED -> PUBLISHED happens only through publication. */
export function rulesetCommands(status: string): CommandDescriptor[] {
  if (status === "DRAFT") return [{ command: "submit-review", label: "Submit for Review", tone: "primary", confirm: "Submit this Ruleset for review?" }];
  if (status === "IN_REVIEW") return [{ command: "approve", label: "Approve", tone: "consequential", confirm: "Approve this Ruleset? Approval does not publish anything." }];
  return [];
}

/** Whether the "Publish Release" action is offered (§40). The server re-checks on submit. */
export function canPublish(rulesetStatus: string): boolean {
  return rulesetStatus === "APPROVED" || rulesetStatus === "PUBLISHED";
}

/** ChangeSet review commands to show for a status (§36). */
export function changeSetCommands(status: string): CommandDescriptor[] {
  if (status === "DRAFT") return [{ command: "submit-review", label: "Submit for Review", tone: "primary", confirm: "Submit this ChangeSet for review? Its contents cannot be edited." }];
  if (status === "READY_FOR_REVIEW") {
    return [
      { command: "approve", label: "Approve", tone: "consequential", confirm: "Approve this ChangeSet? Approval does not publish anything." },
      { command: "reject", label: "Reject", tone: "consequential", confirm: "Reject this ChangeSet? A rejected ChangeSet stays read-only history." },
    ];
  }
  return [];
}

/** Whether a conflict can still receive a decision (shown as an affordance; the server decides). */
export function conflictAcceptsDecision(status: string): boolean {
  return status === "OPEN" || status === "UNDER_REVIEW";
}

export const OPERATION_HELP: Record<string, string> = {
  PIN_ENTITY_VERSION: "Proposes pinning the Entity to one exact Version in a future Manifest.",
  REPLACE_ENTITY_VERSION: "Proposes replacing one exact Version with another in a future Manifest.",
  ADD_ENTITY_TO_MANIFEST: "Proposes adding an Entity that the base composition does not yet pin.",
  REMOVE_ENTITY_FROM_MANIFEST: "Proposes removing the Entity from a future Manifest's composition.",
  CREATE_ENTITY_VERSION: "Proposal only. The Version must be authored separately before publication.",
  DEPRECATE_ENTITY_VERSION: "Proposal only until explicitly published.",
  NO_CHANGE: "No repository or Ruleset composition change is proposed.",
};

/** Which operation fields to show, derived from the model's own validation matrix (never re-stated here). */
export function operationFields(operationType: string): { entity: boolean; from: boolean; to: boolean } {
  const rules = (CHANGE_SET_OPERATION_RULES as Record<string, { targetEntity: string; fromVersion: string; toVersion: string }>)[operationType];
  if (rules === undefined) return { entity: false, from: false, to: false };
  return { entity: rules.targetEntity !== "forbidden", from: rules.fromVersion !== "forbidden", to: rules.toVersion !== "forbidden" };
}

/** Decision-form affordances, derived from the model's decision rules: single vs multiple selection, result field, hints. */
export function decisionAffordances(decisionType: string): { singleSelection: boolean; showResult: boolean; hint: string; suggestedDispositions: string[] } {
  const rules = (CANON_DECISION_RULES as Record<string, { dispositions: readonly string[]; minSelections: number; maxSelections: number | null; resultVersion: string }>)[decisionType];
  if (rules === undefined) return { singleSelection: false, showResult: false, hint: "", suggestedDispositions: [] };
  const count = rules.maxSelections === rules.minSelections ? `exactly ${rules.minSelections}` : `at least ${rules.minSelections}`;
  return {
    singleSelection: rules.maxSelections === 1,
    showResult: rules.resultVersion === "required",
    hint: `Select ${count} candidate${rules.minSelections === 1 && rules.maxSelections === 1 ? "" : "s"}. The server validates the final combination.`,
    suggestedDispositions: [...rules.dispositions],
  };
}

export const IMPACT_CATEGORY_INFO: ReadonlyArray<{ category: string; title: string; description: string }> = [
  { category: "DIRECT_ENTITY", title: "Direct Entities", description: "Entities an operation names directly." },
  { category: "DIRECT_ENTITY_VERSION", title: "Direct Versions", description: "Exact Versions an operation names." },
  { category: "MANIFEST", title: "Manifests", description: "Manifests analyzed by an operation, and their Ruleset. They are not edited." },
  { category: "INHERITING_MANIFEST", title: "Inheriting Manifests", description: "Manifests that inherit from an analyzed Manifest — potential downstream impact only." },
  { category: "RELATIONSHIP_DEPENDENT_ENTITY", title: "Related Entities", description: "Entities one relationship away — review may be required." },
  { category: "KEYWORD_RELATED", title: "Keywords", description: "Keyword assignments on the Entity or its Versions — review context only." },
  { category: "SOURCE_PROVENANCE", title: "Source Provenance", description: "Source references of the affected Versions — review context only." },
  { category: "CANON_GOVERNANCE", title: "Canon Governance", description: "Related conflicts, decisions and policies — review context only." },
];

/** Groups impact items by category in the documented order; empty categories are kept so the UI can say "none". */
export function groupImpactItems<T extends { category: string }>(items: readonly T[]) {
  return IMPACT_CATEGORY_INFO.map((info) => ({ ...info, items: items.filter((i) => i.category === info.category) }));
}

const ERROR_COPY: Record<string, string> = {
  "RULESET_RELEASE.STALE_CHANGE_SET": "The ChangeSet no longer matches the base Manifest. Nothing was published — create a new ChangeSet against the current base.",
  "RULESET_RELEASE.CHANGE_SET_NOT_APPROVED": "Only an APPROVED ChangeSet can be published.",
  "RULESET_RELEASE.CHANGE_SET_ALREADY_PUBLISHED": "This ChangeSet has already been published in another Release.",
  "RULESET_RELEASE.VERSION_LABEL_CONFLICT": "Another Release of this Ruleset already uses that version label.",
  "RULESET_RELEASE.UNRESOLVED_CREATE_OPERATION": "The ChangeSet still proposes creating a Version. Author the Version, then publish a ChangeSet that references it.",
  "RULESET_RELEASE.INVALID_MANIFEST_CONTEXT": "That base Manifest cannot be used: it belongs to another Ruleset, or a later Release must build on the previous Release's Manifest.",
  "RULESET_RELEASE.RULESET_NOT_PUBLISHABLE": "The Ruleset must be APPROVED or PUBLISHED before it can publish.",
  "RULESET_RELEASE.RELEASE_CONFLICT": "Another Release was published first. Nothing was written — refresh and try again.",
  "CANON_DECISION.CONFLICT_ALREADY_DECIDED": "This conflict has already been decided.",
  "CHANGE_SET.INVALID_STATUS_TRANSITION": "That review step is no longer available — the ChangeSet's status changed.",
  "RULESET.INVALID_STATUS_TRANSITION": "That review step is no longer available — the Ruleset's status changed.",
  NETWORK_ERROR: "Could not reach the server.",
};

/** Readable copy for a domain error code; the code itself is always shown alongside it. */
export function describeError(code: string, serverMessage: string): string {
  return ERROR_COPY[code] ?? serverMessage;
}

export const shortHash = (hash: string) => hash.slice(0, 12);
export const formatDate = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
