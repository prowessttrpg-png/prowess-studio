import type { CanonicalKey, EntityId, EntityVersionId, RulesetId, RulesetManifestId } from "@prowess/model";
import type { RulesetContext, RulesetReleaseIdentity, ResolvedRuleReference } from "../context/ruleset-context.js";
import { InputProblems, readCanonicalKey, readOptionalUuid, readRecord } from "../internal/input-reader.js";
import type { PathSegment } from "../internal/plain-data.js";

/**
 * Where a trace step or validation message comes from (PAS-10 M4-WO1 §27). Every field is optional (null) because
 * provenance is attached only where it is known — a SourceReference is NOT required on every step, and the engine never
 * queries M3 source data to fill one in. When present, identity is the immutable ids; `canonicalKey` is explanatory.
 */
export interface RuleProvenance {
  readonly entityId: EntityId | null;
  readonly entityVersionId: EntityVersionId | null;
  readonly canonicalKey: CanonicalKey | null;
  readonly rulesetId: RulesetId | null;
  readonly manifestId: RulesetManifestId | null;
}

/**
 * The Ruleset identity a response was evaluated against (PAS-10 M4-WO1 §16, §58): copied VERBATIM from the request's
 * RulesetContext — never re-resolved, never recomputed. Rule-level provenance travels on individual trace steps and
 * messages instead of repeating the whole resolved rule set here.
 */
export interface RulesetProvenance {
  readonly rulesetId: RulesetId;
  readonly manifestId: RulesetManifestId;
  readonly manifestHash: string | null;
  readonly rulesetVersionLabel: string | null;
  readonly release: RulesetReleaseIdentity | null;
}

export function rulesetProvenanceOf(context: RulesetContext): RulesetProvenance {
  return {
    rulesetId: context.rulesetId,
    manifestId: context.manifestId,
    manifestHash: context.manifestHash,
    rulesetVersionLabel: context.rulesetVersionLabel,
    release: context.release === null ? null : { ...context.release },
  };
}

/**
 * Provenance for one exact resolved rule. The Ruleset / Manifest are those that SUPPLIED the pin when known
 * (`sourceRulesetId` / `sourceManifestId`), otherwise those of the evaluating context, when one is given.
 */
export function provenanceOf(rule: ResolvedRuleReference, context: RulesetContext | null = null): RuleProvenance {
  return {
    entityId: rule.entityId,
    entityVersionId: rule.entityVersionId,
    canonicalKey: rule.canonicalKey,
    rulesetId: rule.sourceRulesetId ?? context?.rulesetId ?? null,
    manifestId: rule.sourceManifestId ?? context?.manifestId ?? null,
  };
}

/** Internal: structural read of a provenance value supplied by an evaluator. */
export function readProvenance(value: unknown, at: readonly PathSegment[], p: InputProblems): RuleProvenance | null {
  if (value === undefined || value === null) return null;
  const r = readRecord(value, at, p, ["entityId", "entityVersionId", "canonicalKey", "rulesetId", "manifestId"]);
  if (r === null) return null;
  return {
    entityId: readOptionalUuid(r.entityId, [...at, "entityId"], p) as EntityId | null,
    entityVersionId: readOptionalUuid(r.entityVersionId, [...at, "entityVersionId"], p) as EntityVersionId | null,
    canonicalKey: r.canonicalKey === undefined || r.canonicalKey === null ? null : readCanonicalKey(r.canonicalKey, [...at, "canonicalKey"], p),
    rulesetId: readOptionalUuid(r.rulesetId, [...at, "rulesetId"], p) as RulesetId | null,
    manifestId: readOptionalUuid(r.manifestId, [...at, "manifestId"], p) as RulesetManifestId | null,
  };
}
