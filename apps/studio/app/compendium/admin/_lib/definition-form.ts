import type { AuthoringKindDto, ValidationIssueDto } from "./authoring-client";
import { descriptorFor, initialPayload } from "./descriptors";

/**
 * Pure helpers for the Definition editor (PAS-10 M6-WO1 §10–19). Presentation and form state only: nothing here
 * validates mechanics or decides legality — the server's M5 validation boundary does.
 */

export interface DefinitionCandidate {
  schemaVersion: number;
  systemFamily: string;
  definitionKind: string;
  payload: Record<string, unknown>;
  legacyTerms?: Array<{ legacyTerm: string; canonicalTerm: string }>;
}

/** A new, empty candidate for an authorable kind, at the payload version new content is authored at. */
export function newCandidate(kind: AuthoringKindDto): DefinitionCandidate {
  const schemaVersion = kind.authoringSchemaVersion ?? 1;
  return { schemaVersion, systemFamily: kind.systemFamily, definitionKind: kind.definitionKind, payload: initialPayload(descriptorFor(kind, schemaVersion)) };
}

/** Reads a stored candidate back from an EntityVersion's structuredData (null for generic content — never inferred). */
export function storedCandidate(structuredData: unknown): DefinitionCandidate | null {
  if (structuredData === null || typeof structuredData !== "object" || Array.isArray(structuredData)) return null;
  const stored = (structuredData as Record<string, unknown>).prowessDefinition;
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;
  const s = stored as Record<string, unknown>;
  if (typeof s.definitionKind !== "string") return null;
  return JSON.parse(JSON.stringify(s)) as DefinitionCandidate;
}

/** Deterministic JSON (sorted object keys) — the basis of dirty-state comparison. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const isDirty = (saved: unknown, current: unknown) => stableStringify(saved) !== stableStringify(current);

/** The DOM id of a payload field's control (and the anchor validation-summary links point at). */
export const fieldDomId = (key: string) => `definition-field-${key === "" ? "payload" : key}`;
export const fieldErrorId = (key: string) => `${fieldDomId(key)}-errors`;

/** The issues belonging to one payload field (by path prefix); the generic field ("") owns every payload issue. */
export function issuesForField(issues: readonly ValidationIssueDto[], key: string): ValidationIssueDto[] {
  if (key === "") return issues.filter((i) => i.path === "payload" || i.path.startsWith("payload.") || i.path.startsWith("payload["));
  return issues.filter((i) => i.path === `payload.${key}` || i.path.startsWith(`payload.${key}.`) || i.path.startsWith(`payload.${key}[`));
}

/** Issues that no rendered field owns (the Definition as a whole, legacy terms, unknown payload keys …). */
export function unplacedIssues(issues: readonly ValidationIssueDto[], fieldKeys: readonly string[]): ValidationIssueDto[] {
  return issues.filter((i) => !fieldKeys.some((k) => issuesForField([i], k).length > 0));
}

const REF_KEYS = ["canonicalKey", "definitionKind", "entityId", "entityVersionId", "systemFamily"];

/** Whether a value is an exact Definition reference (all five identity fields, nothing else). */
export function isExactReference(value: unknown): value is { entityId: string; entityVersionId: string; canonicalKey: string; definitionKind: string; systemFamily: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === REF_KEYS.length && keys.every((k, i) => k === REF_KEYS[i] && typeof (value as Record<string, unknown>)[k] === "string");
}

/**
 * An OPTIONAL canonical-key suggestion, offered only when the author explicitly asks during creation (§11): the kind's
 * namespace plus the display name in snake case. It is never applied automatically and never re-derived later.
 */
export function suggestCanonicalKey(definitionKind: string, displayName: string): string {
  const namespace = definitionKind.toLowerCase().replace("_", ".");
  const slug = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? "" : `${namespace}.${slug}`;
}

/** Status labels shown as text (never colour alone, §47). */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  PLAYTEST: "Playtest",
  CANON: "Canon status",
  DEPRECATED: "Deprecated",
  SUPERSEDED: "Superseded",
  ARCHIVED: "Archived",
};
