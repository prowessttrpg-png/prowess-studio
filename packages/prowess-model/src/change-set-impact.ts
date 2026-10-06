import type { ChangeSetId, ChangeSetOperationId, RulesetId } from "./ids.js";

/**
 * ChangeSet impact analysis — DERIVED, read-only, never persisted (PAS-10 M2-WO7 §22–§35).
 *
 * Impact means "review may be required", never "this is broken" or "this changed". It is structural
 * and governance context only: no MP/AP/damage recalculation, no spell validation, no character rebuild.
 *
 *   DIRECT_ENTITY                  an operation's target Entity
 *   DIRECT_ENTITY_VERSION          an operation's from / to Version
 *   MANIFEST                       an operation's target manifest, and the Ruleset owning it
 *   INHERITING_MANIFEST            manifests that inherit from a target manifest, directly or transitively —
 *                                  POTENTIAL downstream impact; existing immutable manifests never change
 *   RELATIONSHIP_DEPENDENT_ENTITY  Entities ONE relationship hop from a target Entity (either direction)
 *   KEYWORD_RELATED                keyword assignments on a target Entity or its from/to Versions
 *   SOURCE_PROVENANCE              SourceReferences of the from/to Versions
 *   CANON_GOVERNANCE               the linked CanonDecision; the Ruleset's conflicts about a target Entity,
 *                                  their decisions, and the policies those decisions pinned
 *
 * The ChangeSet is a historical snapshot; the impact report is computed against the CURRENT database
 * state each time (`derivation: "LIVE"`), so it can differ after the surrounding graph changes.
 */
export const CHANGE_SET_IMPACT_CATEGORIES = [
  "DIRECT_ENTITY",
  "DIRECT_ENTITY_VERSION",
  "MANIFEST",
  "INHERITING_MANIFEST",
  "RELATIONSHIP_DEPENDENT_ENTITY",
  "KEYWORD_RELATED",
  "SOURCE_PROVENANCE",
  "CANON_GOVERNANCE",
] as const;
export type ChangeSetImpactCategory = (typeof CHANGE_SET_IMPACT_CATEGORIES)[number];

export const CHANGE_SET_IMPACT_RESOURCE_TYPES = [
  "ENTITY",
  "ENTITY_VERSION",
  "RULESET",
  "RULESET_MANIFEST",
  "KEYWORD_ASSIGNMENT",
  "SOURCE_REFERENCE",
  "RULE_CONFLICT",
  "CANON_DECISION",
  "CANON_POLICY",
] as const;
export type ChangeSetImpactResourceType = (typeof CHANGE_SET_IMPACT_RESOURCE_TYPES)[number];

/** Why a resource is in the report. `sourceOperationId` is null only for the ChangeSet's own decision link. */
export interface ChangeSetImpactReason {
  sourceOperationId: ChangeSetOperationId | null;
  /** The source operation's sequence (null for the decision link) — used for stable ordering. */
  sequence: number | null;
  reason: string;
  /** RELATIONSHIP_DEPENDENT_ENTITY only: the relationship type of the hop. */
  relationshipType: string | null;
}

/**
 * One impacted resource in one category. DEDUPLICATION: a resource appears at most ONCE per category,
 * carrying every reason it was reached by (distinct operations, directions, relationship types); the
 * same resource MAY appear under different categories (e.g. an Entity that is both a target and a
 * neighbour of another target), because each category asks a different review question.
 * `resourceId` is the row id; for KEYWORD_ASSIGNMENT it is `<owner id>:<keyword id>`.
 */
export interface ChangeSetImpactItem {
  category: ChangeSetImpactCategory;
  resourceType: ChangeSetImpactResourceType;
  resourceId: string;
  reasons: ChangeSetImpactReason[];
}

export interface ChangeSetImpactReport {
  changeSetId: ChangeSetId;
  rulesetId: RulesetId;
  /** Always "LIVE": derived from the current database state, never stored. */
  derivation: "LIVE";
  /** Ordered by category (declaration order), resource type (declaration order), resource id. */
  items: ChangeSetImpactItem[];
}

const reasonKey = (r: ChangeSetImpactReason) => `${r.sourceOperationId ?? ""}|${r.reason}|${r.relationshipType ?? ""}`;
const compareReasons = (a: ChangeSetImpactReason, b: ChangeSetImpactReason) =>
  (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER) ||
  a.reason.localeCompare(b.reason, "en") ||
  (a.relationshipType ?? "").localeCompare(b.relationshipType ?? "", "en");

/**
 * Accumulates impact items with the documented dedup and ordering, so the result is deterministic no
 * matter in which order the analysis paths discovered things. Pure (no I/O).
 */
export class ChangeSetImpactCollector {
  private readonly items = new Map<string, { item: ChangeSetImpactItem; reasons: Map<string, ChangeSetImpactReason> }>();

  add(category: ChangeSetImpactCategory, resourceType: ChangeSetImpactResourceType, resourceId: string, reason: ChangeSetImpactReason): void {
    const key = `${category}|${resourceType}|${resourceId}`;
    let entry = this.items.get(key);
    if (entry === undefined) {
      entry = { item: { category, resourceType, resourceId, reasons: [] }, reasons: new Map() };
      this.items.set(key, entry);
    }
    entry.reasons.set(reasonKey(reason), reason);
  }

  toItems(): ChangeSetImpactItem[] {
    const cat = (c: ChangeSetImpactCategory) => CHANGE_SET_IMPACT_CATEGORIES.indexOf(c);
    const typ = (t: ChangeSetImpactResourceType) => CHANGE_SET_IMPACT_RESOURCE_TYPES.indexOf(t);
    return [...this.items.values()]
      .map(({ item, reasons }) => ({ ...item, reasons: [...reasons.values()].sort(compareReasons) }))
      .sort((a, b) => cat(a.category) - cat(b.category) || typ(a.resourceType) - typ(b.resourceType) || a.resourceId.localeCompare(b.resourceId, "en"));
  }
}
