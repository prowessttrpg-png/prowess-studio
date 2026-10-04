import type { EntityVersionDto, KeywordAssignmentDto } from "./api-client";

/**
 * Pure revision-selection logic for the Entity detail page (PAS-10
 * M1-WO10). Nothing here fetches or renders — it only decides, from the
 * Entity's full Version list and a raw URL param, which revision is being
 * looked at and how it relates to the others. "Latest" here means exactly
 * one thing: the highest `revisionNumber`. It is never a claim about
 * Ruleset currentness or Canon authority.
 */

export type RevisionSelection =
  | { kind: "empty" }
  | { kind: "ok"; version: EntityVersionDto; latest: EntityVersionDto; isLatest: boolean }
  | { kind: "not-found"; requested: string; latest: EntityVersionDto | null };

/** The EntityVersion with the highest `revisionNumber`, or `null` if there are none. */
export function findLatestVersion(versions: EntityVersionDto[]): EntityVersionDto | null {
  let latest: EntityVersionDto | null = null;
  for (const version of versions) {
    if (latest === null || version.revisionNumber > latest.revisionNumber) {
      latest = version;
    }
  }
  return latest;
}

/**
 * Looks a revision up by its raw URL value. Returns `null` for anything
 * that isn't a plain positive integer belonging to this Entity — so a
 * Version from some other Entity can never be addressed through this
 * Entity's URL, because only this Entity's own Versions are searched.
 */
export function findVersionByRevision(
  versions: EntityVersionDto[],
  raw: string,
): EntityVersionDto | null {
  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  const revisionNumber = Number(raw);
  return versions.find((version) => version.revisionNumber === revisionNumber) ?? null;
}

/**
 * Resolves the `?revision=` URL value. An absent param selects the Latest
 * Revision; a present-but-unknown one is reported as `not-found` and is
 * deliberately NOT silently replaced by Latest — that would make the URL
 * misleading.
 */
export function resolveRevisionSelection(
  versions: EntityVersionDto[],
  revisionParam: string | null,
): RevisionSelection {
  const latest = findLatestVersion(versions);

  if (revisionParam === null) {
    return latest === null ? { kind: "empty" } : { kind: "ok", version: latest, latest, isLatest: true };
  }

  const match = findVersionByRevision(versions, revisionParam);
  if (match === null || latest === null) {
    return { kind: "not-found", requested: revisionParam, latest };
  }
  return { kind: "ok", version: match, latest, isLatest: match.id === latest.id };
}

export type ParentLineage =
  | { kind: "none" }
  | { kind: "found"; parent: EntityVersionDto }
  | { kind: "missing"; parentVersionId: string };

/**
 * Resolves the REAL `parentVersionId` — never inferred from
 * `revisionNumber - 1`. Lineage is not guaranteed sequential (Revision 3's
 * parent may be Revision 1), so this reports exactly what the data says.
 */
export function resolveParentLineage(
  version: EntityVersionDto,
  versions: EntityVersionDto[],
): ParentLineage {
  if (version.parentVersionId === null) {
    return { kind: "none" };
  }
  const parent = versions.find((candidate) => candidate.id === version.parentVersionId);
  return parent
    ? { kind: "found", parent }
    : { kind: "missing", parentVersionId: version.parentVersionId };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    );
  }
  return value;
}

/** JSON with object keys sorted, so key ORDER alone never reads as a difference. */
export function stableStringify(value: unknown): string | undefined {
  return JSON.stringify(sortKeys(value));
}

export function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export interface KeywordComparison {
  onlyA: KeywordAssignmentDto[];
  shared: KeywordAssignmentDto[];
  onlyB: KeywordAssignmentDto[];
}

/** Categorizes by KeywordDefinition id — identity, not rendered text. */
export function categorizeKeywords(
  a: KeywordAssignmentDto[],
  b: KeywordAssignmentDto[],
): KeywordComparison {
  const idsA = new Set(a.map((assignment) => assignment.keyword.id));
  const idsB = new Set(b.map((assignment) => assignment.keyword.id));
  return {
    onlyA: a.filter((assignment) => !idsB.has(assignment.keyword.id)),
    shared: a.filter((assignment) => idsB.has(assignment.keyword.id)),
    onlyB: b.filter((assignment) => !idsA.has(assignment.keyword.id)),
  };
}
