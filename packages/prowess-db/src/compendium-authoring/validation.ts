import type { EntityType } from "@prowess/model";
import { DEFINITION_ERROR_CODES, validateStoredProwessDefinition, type ProwessProblem, type StoredDefinitionContent } from "@prowess/game";
import { selectKeywordsByCanonicalKeys, selectVersionIdentitiesByIds } from "./repository.js";

/**
 * Compendium authoring validation (PAS-10 M6-WO1 §14–16, §41, §62–63, §69).
 *
 * The AUTHORITATIVE check is M5's own `validateStoredProwessDefinition` — the same readers the server materializer runs —
 * applied to `{ prowessDefinition: candidate }` with the Entity's storage EntityType. This module adds nothing to the
 * M5 contract. Around it, it only:
 *   - translates M5 problems into authoring issues (code, path, message, Definition kind, component);
 *   - classifies which M5 problems make a candidate UNSTORABLE even as a Draft (the HARD codes below — unsafe data,
 *     unknown kind / family, unsupported schema version, wrong EntityType, a stored blob claiming identity). Payload
 *     incompleteness is a reported issue: a Draft may be incomplete (§16);
 *   - checks REFERENCES against the database, read-only: every payload Keyword must be an existing Keyword Definition
 *     (§22 — unknown Keywords fail instead of becoming implicit rules) and every exact Definition reference must name
 *     an existing EntityVersion of that Entity, canonical key and Definition kind (§30).
 * It never writes, never assigns identity and never stores a validity flag (§62).
 */
export const AUTHORING_ISSUE_CODES = {
  UNKNOWN_KEYWORD: "COMPENDIUM_AUTHORING.UNKNOWN_KEYWORD",
  DEPRECATED_KEYWORD: "COMPENDIUM_AUTHORING.DEPRECATED_KEYWORD",
  INVALID_DEFINITION_REFERENCE: "COMPENDIUM_AUTHORING.INVALID_DEFINITION_REFERENCE",
  MISSING_DEFINITION: "COMPENDIUM_AUTHORING.MISSING_DEFINITION",
} as const;

/** M5 problem codes that make a candidate unstorable even as a Draft. */
export const HARD_DEFINITION_CODES: readonly string[] = [
  DEFINITION_ERROR_CODES.NOT_PLAIN_DATA,
  DEFINITION_ERROR_CODES.UNKNOWN_SYSTEM_FAMILY,
  DEFINITION_ERROR_CODES.UNKNOWN_DEFINITION_KIND,
  DEFINITION_ERROR_CODES.FAMILY_KIND_MISMATCH,
  DEFINITION_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
  DEFINITION_ERROR_CODES.ENTITY_TYPE_MISMATCH,
  DEFINITION_ERROR_CODES.INVALID_STORED_DEFINITION,
];

export type IssueSeverity = "ERROR" | "WARNING";

export interface AuthoringValidationIssue {
  readonly code: string;
  readonly severity: IssueSeverity;
  /** Dotted path inside the Definition, e.g. `payload.resolution.mode`; empty for the Definition as a whole. */
  readonly path: string;
  readonly message: string;
  readonly definitionKind: string | null;
  /** The top-level payload component the issue belongs to (`resolution`, `costContributions` …), when there is one. */
  readonly component: string | null;
  /** Where the issue came from: the M5 contract, or an authoring reference check. */
  readonly source: "M5_CONTRACT" | "REFERENCE";
}

export interface AuthoringValidationResult {
  readonly status: "PASS" | "FAIL";
  readonly definitionKind: string | null;
  readonly issues: readonly AuthoringValidationIssue[];
  /** M5's normalized Definition content when the M5 contract accepted it (presentation preview only, §27). */
  readonly normalized: StoredDefinitionContent | null;
  /** True when at least one issue makes the candidate unstorable even as a Draft. */
  readonly refused: boolean;
}

const REF_KEYS = ["canonicalKey", "definitionKind", "entityId", "entityVersionId", "systemFamily"];
const MAX_REFERENCES = 200;

/** `/prowessDefinition/payload/outcomes/0/data` → `payload.outcomes[0].data` (RFC 6901 unescaped). */
export function issuePath(pointer: string): string {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (segments[0] === "prowessDefinition") segments.shift();
  return segments.reduce((out, s) => (/^\d+$/.test(s) ? `${out}[${s}]` : out === "" ? s : `${out}.${s}`), "");
}

function componentOf(path: string): string | null {
  const m = /^payload\.([A-Za-z0-9_]+)/.exec(path);
  return m === null ? null : (m[1] as string);
}

function declaredKind(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const d = Object.getOwnPropertyDescriptor(candidate, "definitionKind");
  return d !== undefined && "value" in d && typeof d.value === "string" ? d.value : null;
}

function m5Issue(problem: ProwessProblem, kind: string | null): AuthoringValidationIssue {
  const path = issuePath(problem.path);
  return { code: problem.code, severity: "ERROR", path, message: problem.message, definitionKind: kind, component: componentOf(path), source: "M5_CONTRACT" };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Every exact Definition reference (an object with exactly the five ProwessDefinitionRef fields) in the payload. */
function exactReferences(value: unknown, path: string, out: Array<{ path: string; ref: Record<string, string> }>): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => exactReferences(v, `${path}[${i}]`, out));
    return;
  }
  if (!isPlainRecord(value)) return;
  const keys = Object.keys(value).sort();
  if (keys.length === REF_KEYS.length && keys.every((k, i) => k === REF_KEYS[i]) && keys.every((k) => typeof value[k] === "string")) {
    out.push({ path, ref: value as Record<string, string> });
    return;
  }
  for (const k of keys) exactReferences(value[k], path === "" ? k : `${path}.${k}`, out);
}

async function referenceIssues(content: StoredDefinitionContent | null, candidate: unknown, kind: string | null): Promise<AuthoringValidationIssue[]> {
  const payload = content !== null ? content.payload : isPlainRecord(candidate) ? candidate.payload : undefined;
  if (!isPlainRecord(payload)) return [];
  const issues: AuthoringValidationIssue[] = [];
  const issue = (code: string, severity: IssueSeverity, path: string, message: string) =>
    issues.push({ code, severity, path, message, definitionKind: kind, component: componentOf(path), source: "REFERENCE" });

  // §22: payload Keywords are exact Keyword Definition canonical keys from the approved vocabulary.
  const keywords = Array.isArray(payload.keywords) ? payload.keywords : [];
  const keys = keywords.filter((k): k is string => typeof k === "string");
  if (keys.length > 0) {
    const known = new Map((await selectKeywordsByCanonicalKeys(keys)).map((k) => [k.canonicalKey, k]));
    keywords.forEach((k, i) => {
      if (typeof k !== "string") return;
      const row = known.get(k);
      if (row === undefined) issue(AUTHORING_ISSUE_CODES.UNKNOWN_KEYWORD, "ERROR", `payload.keywords[${i}]`, `Keyword "${k}" is not a Keyword Definition. Create it in the Keyword vocabulary first — an unknown Keyword is never an implicit rule.`);
      else if (row.deprecated) issue(AUTHORING_ISSUE_CODES.DEPRECATED_KEYWORD, "WARNING", `payload.keywords[${i}]`, `Keyword "${k}" is deprecated.`);
    });
  }

  // §30: exact Definition references must resolve to exactly the named EntityVersion — never by name or "latest".
  const refs: Array<{ path: string; ref: Record<string, string> }> = [];
  exactReferences(payload, "payload", refs);
  if (refs.length > MAX_REFERENCES) {
    issue(AUTHORING_ISSUE_CODES.INVALID_DEFINITION_REFERENCE, "ERROR", "payload", `A Definition may hold at most ${MAX_REFERENCES} exact references.`);
    return issues;
  }
  if (refs.length > 0) {
    const rows = new Map((await selectVersionIdentitiesByIds(refs.map((r) => r.ref.entityVersionId as string).filter((id) => /^[0-9a-f-]{36}$/.test(id)))).map((r) => [r.id, r]));
    for (const { path, ref } of refs) {
      const row = rows.get(ref.entityVersionId as string);
      const storedKind = row === undefined ? null : declaredKind(isPlainRecord(row.structuredData) ? row.structuredData.prowessDefinition : null);
      const problem =
        row === undefined
          ? "names an EntityVersion that does not exist"
          : row.entityId !== ref.entityId
            ? "names an EntityVersion of a different Entity"
            : row.entity.canonicalKey !== ref.canonicalKey
              ? `names canonical key ${ref.canonicalKey}, but that Entity's key is ${row.entity.canonicalKey}`
              : storedKind !== ref.definitionKind
                ? `names Definition kind ${ref.definitionKind}, but that revision stores ${storedKind ?? "no Prowess Definition"}`
                : null;
      if (problem !== null) issue(AUTHORING_ISSUE_CODES.INVALID_DEFINITION_REFERENCE, "ERROR", path, `Exact Definition reference ${problem}.`);
    }
  }
  return issues;
}

/**
 * Validates one candidate Prowess Definition for an Entity stored as `entityType`. Side-effect free: reads only.
 * `candidate` is the content that would be stored at `structuredData.prowessDefinition`.
 */
export async function validateDefinitionCandidate(entityType: EntityType, candidate: unknown): Promise<AuthoringValidationResult> {
  const kind = declaredKind(candidate);
  if (candidate === undefined || candidate === null) {
    return {
      status: "FAIL",
      definitionKind: null,
      issues: [{ code: AUTHORING_ISSUE_CODES.MISSING_DEFINITION, severity: "ERROR", path: "", message: "No Prowess Definition was supplied.", definitionKind: null, component: null, source: "M5_CONTRACT" }],
      normalized: null,
      refused: true,
    };
  }
  const outcome = validateStoredProwessDefinition({ entityType, structuredData: { prowessDefinition: candidate } });
  const m5 = outcome.ok ? [] : outcome.problems.map((p) => m5Issue(p, kind));
  const normalized = outcome.ok && outcome.value.kind === "DEFINITION" ? outcome.value.definition : null;
  const refused = m5.some((i) => HARD_DEFINITION_CODES.includes(i.code));
  const refs = refused ? [] : await referenceIssues(normalized, candidate, kind);
  const issues = [...m5, ...refs];
  return {
    status: issues.some((i) => i.severity === "ERROR") ? "FAIL" : "PASS",
    definitionKind: normalized?.definitionKind ?? kind,
    issues,
    normalized,
    refused,
  };
}
