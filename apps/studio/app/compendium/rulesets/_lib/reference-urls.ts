/**
 * Rules Reference URLs and display helpers (PAS-10 M6-WO2). Every Rules Reference URL names the EXACT Ruleset and
 * Release: links between entries keep the Release they were found in, so a bookmarked page always shows the same pins.
 * Nothing here selects a Release — a Release id is always supplied by the caller (from the server).
 */
import { formatEnumLabel } from "@prowess/ui";

const enc = encodeURIComponent;

export const rulesReferenceHref = () => "/compendium/rulesets";
export const rulesetReferenceHref = (rulesetId: string) => `/compendium/rulesets/${enc(rulesetId)}`;
export const releaseHref = (rulesetId: string, releaseId: string) => `/compendium/rulesets/${enc(rulesetId)}/releases/${enc(releaseId)}`;
export const entryHref = (rulesetId: string, releaseId: string, entityId: string) => `${releaseHref(rulesetId, releaseId)}/entities/${enc(entityId)}`;
/** M6-WO6: the exact Release's Weapon Library, one Weapon, one Attack (always Release-scoped — never latest). */
export const weaponLibraryHref = (rulesetId: string, releaseId: string) => `${releaseHref(rulesetId, releaseId)}/weapons`;
export const weaponHref = (rulesetId: string, releaseId: string, entityId: string) => `${weaponLibraryHref(rulesetId, releaseId)}/${enc(entityId)}`;
export const attackHref = (rulesetId: string, releaseId: string, entityId: string) => `${releaseHref(rulesetId, releaseId)}/attacks/${enc(entityId)}`;
/** PRE-M7-WO1: topic sections and Stat pages of ONE exact Release. */
export const sectionsHref = (rulesetId: string, releaseId: string) => `${releaseHref(rulesetId, releaseId)}/sections`;
export const sectionHref = (rulesetId: string, releaseId: string, section: string) => `${sectionsHref(rulesetId, releaseId)}/${enc(section)}`;
export const statHref = (rulesetId: string, releaseId: string, stat: string) => `${releaseHref(rulesetId, releaseId)}/stats/${enc(stat)}`;
/** The governed authoring workspace of one Draft revision, opened from a Release context (kept for preview / back). */
export const revisionWorkspaceHref = (entityId: string, versionId: string, releaseId: string, returnTo?: string) =>
  `/compendium/admin/entities/${enc(entityId)}/revisions/${enc(versionId)}?release=${enc(releaseId)}${returnTo ? `&returnTo=${enc(returnTo)}` : ""}`;
/** Only same-app Compendium paths are honoured as a return target (never an absolute or protocol-relative URL). */
export const safeReturnTo = (v: string | null): string | null => (v !== null && /^\/compendium\/[A-Za-z0-9/_\-?=&%.]*$/.test(v) && !v.startsWith("//") ? v : null);
export const comparisonHref = (rulesetId: string, releaseId: string, otherReleaseId: string) => `${releaseHref(rulesetId, releaseId)}/compare/${enc(otherReleaseId)}`;

/** The Entity Library (all revisions, not Release-scoped) — revision history and revision comparison live there. */
export const libraryRevisionHref = (entityId: string, revisionNumber: number) => `/compendium/entities/${enc(entityId)}?revision=${revisionNumber}`;
export const libraryComparisonHref = (entityId: string, fromRevision: number, toRevision: number) => `/compendium/entities/${enc(entityId)}?compareA=${fromRevision}&compareB=${toRevision}`;
/** Compendium Admin — where authoring happens. The Rules Reference itself has no edit controls. */
export const adminEntityHref = (entityId: string) => `/compendium/admin/entities/${enc(entityId)}`;

/** "Release 3 — 0.3.0" (number first; the version label is a human name, never interpreted). */
export const releaseName = (r: { releaseNumber: number; versionLabel: string }) => `Release ${r.releaseNumber} — ${r.versionLabel}`;

export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
};

/** A SCREAMING_SNAKE_CASE token as words ("SAVING_THROW" → "Saving Throw"). Display only; the token is shown too. */
export const isToken = (v: unknown): v is string => typeof v === "string" && /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[A-Z]{2,}[0-9]*$/.test(v);
export const readableToken = (token: string) => formatEnumLabel(token);

/** A camelCase payload key as a label ("costContributions" → "Cost contributions"). */
export function readableKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
