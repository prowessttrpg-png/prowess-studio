import {
  COMPENDIUM_REFERENCE_ERROR_CODES,
  DomainError,
  RULESET_RELEASE_DIFF_TYPES,
  RULESET_RELEASE_ERROR_CODES,
  isEntityType,
  type EntityRelationship,
  type EntityVersion,
  type KeywordDefinition,
  type RulesetRelease,
  type RulesetReleaseDiffType,
  type SourceReference,
} from "@prowess/model";
import { getAuthoringCatalog, authoringKind, type AuthoringDefinitionKind } from "../compendium-authoring/catalog.js";
import { selectKeywordsByCanonicalKeys, selectKeywordsByIds, selectVersionIdentitiesByIds, type KeywordRow } from "../compendium-authoring/repository.js";
import { selectEntityById } from "../entity/repository.js";
import { selectEntitiesByIds } from "../entity-query/repository.js";
import { selectIncomingRelationships, selectOutgoingRelationships } from "../entity-relationship/repository.js";
import { selectEntityVersionById } from "../entity-version/repository.js";
import { selectEntityVersionKeywords } from "../entity-version-keyword/repository.js";
import { selectManifestEntry } from "../ruleset-manifest/repository.js";
import { isUuid, selectReleaseById } from "../ruleset-release/repository.js";
import { compareRulesetReleases, getLatestRulesetRelease, listRulesetReleases, verifyRulesetReleaseManifestHash } from "../ruleset-release/service.js";
import { selectRulesetById } from "../ruleset/repository.js";
import { selectSourceReferencesForVersion } from "../source-reference/repository.js";
import {
  countPinnedEntries,
  selectLatestRevisionNumber,
  selectPinnedEntriesForEntities,
  selectPinnedEntriesPage,
  selectPinnedEntriesReferencing,
  selectPinnedEntriesSharingKeywords,
  selectSourceDocumentsByIds,
  type PinnedEntryFilters,
  type PinnedEntryRow,
  type SourceDocumentRow,
} from "./repository.js";

/**
 * Compendium Rules Reference read service (PAS-10 M6-WO2). The Rules Reference answers "what are the rules in THIS
 * Release?": Ruleset → exact RulesetRelease → its flattened Release Manifest → the exact EntityVersion each entry pins.
 *
 * - Membership is the manifest's entries and nothing else: a Latest Revision never substitutes for a pin, content is
 *   never re-validated to decide membership, and no inheritance is reconstructed (Release manifests are flattened).
 * - Definitions are read VERBATIM from the pinned revision's stored structured data; the Definition kind comes only
 *   from that data (generic content has none), projected through the single M5-derived authoring catalog. Historical
 *   schema versions are returned as stored — never migrated on view.
 * - Exact Definition references are reported exactly as authored, next to what this Release pins for the same Entity;
 *   a mismatch is shown, never rewritten.
 * - Everything is read-only and bounded (paged lists, capped related-content queries); no stored pointer to a
 *   "latest" Release exists — the Latest Release convenience resolves to an exact Release id by query.
 */

const MAX_PAGE_SIZE = 100;
const RELATED_LIMIT = 12;
const REFERENCED_BY_LIMIT = 25;
const MAX_REFERENCES = 200;
const REF_KEYS = ["canonicalKey", "definitionKind", "entityId", "entityVersionId", "systemFamily"];
/** The `kind` facet value that selects generic (non-Definition) content. Never a Definition kind. */
export const GENERIC_KIND_FACET = "GENERIC";

// ---- shapes -----------------------------------------------------------------------------------------------------------

export interface ReferenceRulesetSummary {
  readonly id: string;
  readonly canonicalKey: string;
  readonly name: string;
}

export interface ReferenceReleaseSummary {
  readonly id: string;
  readonly rulesetId: string;
  readonly releaseNumber: number;
  readonly versionLabel: string;
  readonly channel: string;
  readonly publishedAt: Date;
}

export interface ReferenceReleaseDetail extends ReferenceReleaseSummary {
  readonly ruleset: ReferenceRulesetSummary;
  readonly releaseNotes: string | null;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly compositionSize: number;
  /** The M2 integrity check, recomputed on the server from the manifest's exact entries. */
  readonly verification: { readonly valid: boolean; readonly storedHash: string; readonly computedHash: string };
}

/** What a pinned revision DECLARES as its Prowess Definition, read verbatim (null for generic content). */
export interface DeclaredDefinition {
  readonly schemaVersion: number | null;
  readonly systemFamily: string | null;
  readonly definitionKind: string | null;
  readonly payload: Record<string, unknown> | null;
  readonly legacyTerms: unknown;
}

/** The catalog projection of the declared kind — null when the declared kind is not a catalog kind. */
export interface ReferenceKindInfo {
  readonly definitionKind: string;
  readonly systemFamily: string;
  readonly branch: string | null;
  readonly sharedContract: string | null;
  readonly supportedSchemaVersions: readonly number[];
}

/** A compact card, computed at read time from the pinned revision (no stored card data). */
export interface ReferenceEntryCard {
  readonly entityId: string;
  readonly entityVersionId: string;
  readonly canonicalKey: string;
  readonly entityType: string;
  readonly displayName: string;
  readonly shortDescription: string | null;
  readonly revisionNumber: number;
  readonly status: string;
  /** The declared Definition kind, or null for generic content (never inferred). */
  readonly definitionKind: string | null;
  readonly kind: ReferenceKindInfo | null;
  readonly schemaVersion: number | null;
  /** The payload's structured Keyword canonical keys, as authored. */
  readonly keywords: readonly string[];
}

export interface ReferenceEntryQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly kind?: string;
  readonly family?: string;
  readonly branch?: string;
  readonly entityType?: string;
  readonly keywordId?: string;
}

export interface ReferenceEntryPage {
  readonly items: ReferenceEntryCard[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ReferenceDefinitionReference {
  /** Where in the payload the reference sits, e.g. `payload.rules.pairsWith`. */
  readonly path: string;
  /** The reference exactly as authored — never rewritten. */
  readonly authored: { readonly entityId: string; readonly entityVersionId: string; readonly canonicalKey: string; readonly definitionKind: string; readonly systemFamily: string };
  readonly authoredRevisionNumber: number | null;
  readonly authoredDisplayName: string | null;
  /** True when this Release pins the referenced Entity at all. */
  readonly inRelease: boolean;
  /** What this Release pins for the referenced Entity (null when it is not part of this Release). */
  readonly pinned: { readonly entityVersionId: string; readonly revisionNumber: number; readonly displayName: string } | null;
  /** True when the authored revision IS the revision this Release pins. */
  readonly matchesPin: boolean;
}

export interface ReferenceRelationship {
  readonly relationship: EntityRelationship;
  readonly direction: "OUTGOING" | "INCOMING";
  readonly counterpart: { readonly id: string; readonly canonicalKey: string; readonly entityType: string };
  /** The counterpart's pin in this Release, when it is part of it. Relationships are Entity-level, not revision-pinned. */
  readonly counterpartPin: { readonly entityVersionId: string; readonly revisionNumber: number; readonly displayName: string } | null;
}

export interface ReferenceSource {
  readonly reference: SourceReference;
  readonly document: SourceDocumentRow | null;
}

export interface ReferenceEntryDetail {
  readonly release: ReferenceReleaseSummary;
  readonly ruleset: ReferenceRulesetSummary;
  readonly entity: { readonly id: string; readonly canonicalKey: string; readonly entityType: string };
  /** The EXACT revision this Release pins. */
  readonly pinnedRevision: EntityVersion;
  /** The Entity's highest revision number — an indicator only, never substituted for the pin. */
  readonly latestRevisionNumber: number | null;
  readonly definition: DeclaredDefinition | null;
  readonly kind: ReferenceKindInfo | null;
  /** True when the declared schema version is one the M5 catalog supports for this kind (dedicated presentation). */
  readonly schemaVersionSupported: boolean;
  readonly keywords: {
    /** Payload `keywords` (structured rules metadata), resolved against the Keyword vocabulary by canonical key. */
    readonly structured: ReadonlyArray<{ readonly canonicalKey: string; readonly keyword: KeywordRow | null }>;
    /** Version-level Keyword assignments of the pinned revision. */
    readonly assigned: ReadonlyArray<{ readonly keyword: KeywordDefinition; readonly sourceType: string }>;
  };
  readonly references: ReferenceDefinitionReference[];
  readonly referencesTruncated: boolean;
  readonly referencedBy: ReferenceEntryCard[];
  readonly referencedByTruncated: boolean;
  readonly relationships: ReferenceRelationship[];
  readonly relatedByKeyword: ReferenceEntryCard[];
  readonly sources: ReferenceSource[];
}

export interface ReferenceComparisonEntry {
  readonly type: RulesetReleaseDiffType;
  readonly entityId: string;
  readonly canonicalKey: string | null;
  readonly from: { readonly entityVersionId: string; readonly revisionNumber: number | null; readonly displayName: string | null } | null;
  readonly to: { readonly entityVersionId: string; readonly revisionNumber: number | null; readonly displayName: string | null } | null;
}

export interface ReferenceComparison {
  readonly releaseA: ReferenceReleaseSummary;
  readonly releaseB: ReferenceReleaseSummary;
  readonly counts: { readonly added: number; readonly removed: number; readonly changed: number; readonly unchanged: number };
  readonly entries: ReferenceComparisonEntry[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

// ---- helpers ----------------------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const invalid = (message: string) => new DomainError(COMPENDIUM_REFERENCE_ERROR_CODES.INVALID_INPUT, message);

const normalizeId = (value: string) => value.trim().toLowerCase();

function summary(release: RulesetRelease): ReferenceReleaseSummary {
  return { id: release.id, rulesetId: release.rulesetId, releaseNumber: release.releaseNumber, versionLabel: release.versionLabel, channel: release.channel, publishedAt: release.publishedAt };
}

async function requireRuleset(rulesetId: string): Promise<ReferenceRulesetSummary> {
  const id = normalizeId(rulesetId);
  const ruleset = isUuid(id) ? await selectRulesetById(id) : null;
  if (ruleset === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.RULESET_NOT_FOUND, `Ruleset not found: ${rulesetId}`);
  return { id: ruleset.id, canonicalKey: ruleset.canonicalKey, name: ruleset.name };
}

/** The exact Release, which must belong to the Ruleset the URL names — never another Release as a fallback. */
async function requireRelease(ruleset: ReferenceRulesetSummary, releaseId: string): Promise<RulesetRelease> {
  const release = await selectReleaseById(normalizeId(releaseId));
  if (release === null) throw new DomainError(RULESET_RELEASE_ERROR_CODES.NOT_FOUND, `RulesetRelease not found: ${releaseId}`);
  if (release.rulesetId !== ruleset.id) {
    throw new DomainError(COMPENDIUM_REFERENCE_ERROR_CODES.RELEASE_NOT_IN_RULESET, `Release ${release.releaseNumber} (${release.id}) belongs to a different Ruleset than ${ruleset.name}`);
  }
  return release;
}

/** What a stored `prowessDefinition` declares, read verbatim — a shape read, not a validation. */
export function readDeclaredDefinition(definition: unknown): DeclaredDefinition | null {
  if (!isRecord(definition)) return null;
  const str = (k: string) => (typeof definition[k] === "string" ? (definition[k] as string) : null);
  return {
    schemaVersion: typeof definition.schemaVersion === "number" ? definition.schemaVersion : null,
    systemFamily: str("systemFamily"),
    definitionKind: str("definitionKind"),
    payload: isRecord(definition.payload) ? definition.payload : null,
    legacyTerms: definition.legacyTerms ?? null,
  };
}

function kindInfo(declaredKind: string | null): ReferenceKindInfo | null {
  const kind: AuthoringDefinitionKind | null = declaredKind === null ? null : authoringKind(declaredKind);
  if (kind === null) return null;
  return { definitionKind: kind.definitionKind, systemFamily: kind.systemFamily, branch: kind.branch, sharedContract: kind.sharedContract, supportedSchemaVersions: kind.supportedSchemaVersions };
}

function payloadKeywords(declared: DeclaredDefinition | null): string[] {
  const k = declared?.payload?.keywords;
  return Array.isArray(k) ? k.filter((x): x is string => typeof x === "string") : [];
}

function card(row: PinnedEntryRow): ReferenceEntryCard {
  const declared = readDeclaredDefinition(row.definition);
  return {
    entityId: row.entityId,
    entityVersionId: row.entityVersionId,
    canonicalKey: row.canonicalKey,
    entityType: row.entityType,
    displayName: row.displayName,
    shortDescription: row.shortDescription,
    revisionNumber: row.revisionNumber,
    status: row.status,
    definitionKind: declared?.definitionKind ?? null,
    kind: kindInfo(declared?.definitionKind ?? null),
    schemaVersion: declared?.schemaVersion ?? null,
    keywords: payloadKeywords(declared),
  };
}

function isExactReference(v: unknown): v is ReferenceDefinitionReference["authored"] {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v).sort();
  return keys.length === REF_KEYS.length && keys.every((k, i) => k === REF_KEYS[i] && typeof v[k] === "string");
}

/** Every exact Definition reference in a payload, in document order, with its `payload.a[0].b` path (bounded). */
export function collectExactReferences(payload: unknown): { refs: Array<{ path: string; ref: ReferenceDefinitionReference["authored"] }>; truncated: boolean } {
  const refs: Array<{ path: string; ref: ReferenceDefinitionReference["authored"] }> = [];
  let truncated = false;
  const visit = (value: unknown, path: string) => {
    if (refs.length >= MAX_REFERENCES) {
      truncated = true;
      return;
    }
    if (isExactReference(value)) {
      refs.push({ path, ref: value });
      return;
    }
    if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}[${i}]`));
    else if (isRecord(value)) for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
  };
  visit(payload, "payload");
  return { refs, truncated };
}

/** Expands the kind / family / branch facets into the declared kinds to match, from the ONE M5-derived catalog. */
function facetFilters(query: ReferenceEntryQuery): Pick<PinnedEntryFilters, "definitionKinds" | "genericOnly"> {
  const catalog = getAuthoringCatalog();
  const has = (v: string | undefined): v is string => v !== undefined && v !== "";
  if (has(query.kind) && query.kind === GENERIC_KIND_FACET) {
    if (has(query.family) || has(query.branch)) return { definitionKinds: [] };
    return { genericOnly: true };
  }
  let kinds: AuthoringDefinitionKind[] | null = null;
  if (has(query.kind)) {
    const k = catalog.kinds.find((x) => x.definitionKind === query.kind);
    if (k === undefined) throw invalid(`Not a Definition kind in the catalog: ${JSON.stringify(query.kind)}`);
    kinds = [k];
  }
  if (has(query.family)) {
    if (!catalog.systemFamilies.includes(query.family)) throw invalid(`Not a system family in the catalog: ${JSON.stringify(query.family)}`);
    kinds = (kinds ?? [...catalog.kinds]).filter((k) => k.systemFamily === query.family);
  }
  if (has(query.branch)) {
    if (!catalog.kinds.some((k) => k.branch === query.branch)) throw invalid(`Not a branch in the catalog: ${JSON.stringify(query.branch)}`);
    kinds = (kinds ?? [...catalog.kinds]).filter((k) => k.branch === query.branch);
  }
  return kinds === null ? {} : { definitionKinds: kinds.map((k) => k.definitionKind) };
}

// ---- Rulesets and Releases ----------------------------------------------------------------------------------------------

/** A Ruleset's Release History for the Rules Reference (release_number ASC, via the M2 service). */
export async function listReferenceReleases(rulesetId: string): Promise<{ ruleset: ReferenceRulesetSummary; releases: ReferenceReleaseSummary[] }> {
  const ruleset = await requireRuleset(rulesetId);
  return { ruleset, releases: (await listRulesetReleases(ruleset.id)).map(summary) };
}

/**
 * The "View Latest Release" convenience: resolves the Ruleset's highest-numbered Release (M2's query semantics) to an
 * EXACT Release so the caller can navigate to a durable, Release-pinned URL. Null when the Ruleset has no Release —
 * there is no fallback to unreleased content. Nothing is stored; no pointer exists.
 */
export async function resolveLatestReferenceRelease(rulesetId: string): Promise<{ ruleset: ReferenceRulesetSummary; release: ReferenceReleaseSummary | null }> {
  const ruleset = await requireRuleset(rulesetId);
  const latest = await getLatestRulesetRelease(ruleset.id);
  return { ruleset, release: latest === null ? null : summary(latest) };
}

/** One Release's metadata and its server-side manifest integrity check. */
export async function getReferenceRelease(rulesetId: string, releaseId: string): Promise<ReferenceReleaseDetail> {
  const ruleset = await requireRuleset(rulesetId);
  const release = await requireRelease(ruleset, releaseId);
  const [verification, compositionSize] = await Promise.all([verifyRulesetReleaseManifestHash(release.id), countPinnedEntries(release.manifestId, {})]);
  return {
    ...summary(release),
    ruleset,
    releaseNotes: release.releaseNotes,
    manifestId: release.manifestId,
    manifestHash: release.manifestHash,
    compositionSize,
    verification: { valid: verification.valid, storedHash: verification.storedHash, computedHash: verification.computedHash },
  };
}

/** The Release's pinned entries: server-side facets and paging, deterministic order. */
export async function listReferenceEntries(rulesetId: string, releaseId: string, query: ReferenceEntryQuery): Promise<ReferenceEntryPage> {
  const ruleset = await requireRuleset(rulesetId);
  const release = await requireRelease(ruleset, releaseId);
  const pageSize = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const page = Math.max(1, query.page);
  if (query.entityType !== undefined && query.entityType !== "" && !isEntityType(query.entityType)) throw invalid(`Not a recognized EntityType: ${JSON.stringify(query.entityType)}`);
  let keyword: PinnedEntryFilters["keyword"];
  if (query.keywordId !== undefined && query.keywordId !== "") {
    const id = normalizeId(query.keywordId);
    const row = isUuid(id) ? (await selectKeywordsByIds([id]))[0] : undefined;
    if (row === undefined) throw invalid(`Not a Keyword Definition id: ${JSON.stringify(query.keywordId)}`);
    keyword = { id: row.id, canonicalKey: row.canonicalKey };
  }
  const filters: PinnedEntryFilters = {
    ...facetFilters(query),
    ...(query.search !== undefined && query.search.trim() !== "" ? { search: query.search } : {}),
    ...(query.entityType !== undefined && query.entityType !== "" ? { entityType: query.entityType } : {}),
    ...(keyword !== undefined ? { keyword } : {}),
  };
  const [total, rows] = await Promise.all([countPinnedEntries(release.manifestId, filters), selectPinnedEntriesPage(release.manifestId, filters, (page - 1) * pageSize, pageSize)]);
  return { items: rows.map(card), total, page, pageSize };
}

/** One Entity AS THIS RELEASE PINS IT — its exact revision, structured Definition, references and related content. */
export async function getReferenceEntry(rulesetId: string, releaseId: string, entityId: string): Promise<ReferenceEntryDetail> {
  const ruleset = await requireRuleset(rulesetId);
  const release = await requireRelease(ruleset, releaseId);
  const id = normalizeId(entityId);
  const pin = isUuid(id) ? await selectManifestEntry(release.manifestId, id) : null;
  if (pin === null) throw new DomainError(COMPENDIUM_REFERENCE_ERROR_CODES.ENTITY_NOT_IN_RELEASE, `Entity ${entityId} is not part of Release ${release.releaseNumber} (${release.versionLabel})`);
  const [entity, pinnedRevision] = await Promise.all([selectEntityById(pin.entityId), selectEntityVersionById(pin.entityVersionId)]);
  if (entity === null || pinnedRevision === null) throw new DomainError(COMPENDIUM_REFERENCE_ERROR_CODES.ENTITY_NOT_IN_RELEASE, `Entity ${entityId} is not part of Release ${release.releaseNumber}`);

  const definition = isRecord(pinnedRevision.structuredData) ? readDeclaredDefinition(pinnedRevision.structuredData.prowessDefinition) : null;
  const kind = kindInfo(definition?.definitionKind ?? null);
  const structuredKeys = payloadKeywords(definition);

  // Exact references, reported as authored next to this Release's pin of the same Entity.
  const collected = definition?.payload ? collectExactReferences(definition.payload) : { refs: [], truncated: false };
  const targetEntityIds = collected.refs.map((r) => r.ref.entityId).filter((x) => isUuid(x));
  const authoredVersionIds = collected.refs.map((r) => r.ref.entityVersionId).filter((x) => isUuid(x));

  const [latestRevisionNumber, keywordRows, assigned, targetPins, authoredVersions, referencing, outgoing, incoming, sameKeyword, sourceRefs] = await Promise.all([
    selectLatestRevisionNumber(entity.id),
    selectKeywordsByCanonicalKeys(structuredKeys),
    selectEntityVersionKeywords(pinnedRevision.id),
    selectPinnedEntriesForEntities(release.manifestId, targetEntityIds),
    selectVersionIdentitiesByIds(authoredVersionIds),
    selectPinnedEntriesReferencing(release.manifestId, entity.id, REFERENCED_BY_LIMIT + 1),
    selectOutgoingRelationships(entity.id),
    selectIncomingRelationships(entity.id),
    selectPinnedEntriesSharingKeywords(release.manifestId, entity.id, structuredKeys, RELATED_LIMIT),
    selectSourceReferencesForVersion(pinnedRevision.id),
  ]);

  const pinByEntity = new Map(targetPins.map((p) => [p.entityId, p] as const));
  const authoredById = new Map(authoredVersions.map((v) => [v.id, v] as const));
  const references: ReferenceDefinitionReference[] = collected.refs.map(({ path, ref }) => {
    const pinned = pinByEntity.get(normalizeId(ref.entityId)) ?? null;
    const authored = authoredById.get(normalizeId(ref.entityVersionId)) ?? null;
    return {
      path,
      authored: ref,
      authoredRevisionNumber: authored !== null && authored.entityId === normalizeId(ref.entityId) ? authored.revisionNumber : null,
      authoredDisplayName: authored !== null && authored.entityId === normalizeId(ref.entityId) ? authored.displayName : null,
      inRelease: pinned !== null,
      pinned: pinned === null ? null : { entityVersionId: pinned.entityVersionId, revisionNumber: pinned.revisionNumber, displayName: pinned.displayName },
      matchesPin: pinned !== null && pinned.entityVersionId === normalizeId(ref.entityVersionId),
    };
  });

  const relationshipRows = [...outgoing.map((r) => ({ ...r, direction: "OUTGOING" as const })), ...incoming.map((r) => ({ ...r, direction: "INCOMING" as const }))];
  const counterpartPins = new Map((await selectPinnedEntriesForEntities(release.manifestId, relationshipRows.map((r) => r.counterpart.id))).map((p) => [p.entityId, p] as const));
  const relationships: ReferenceRelationship[] = relationshipRows.map((r) => {
    const p = counterpartPins.get(r.counterpart.id) ?? null;
    return {
      relationship: r.relationship,
      direction: r.direction,
      counterpart: { id: r.counterpart.id, canonicalKey: r.counterpart.canonicalKey, entityType: r.counterpart.entityType },
      counterpartPin: p === null ? null : { entityVersionId: p.entityVersionId, revisionNumber: p.revisionNumber, displayName: p.displayName },
    };
  });

  const documents = new Map((await selectSourceDocumentsByIds(sourceRefs.map((s) => s.sourceDocumentId))).map((d) => [d.id, d] as const));
  const keywordByKey = new Map(keywordRows.map((k) => [k.canonicalKey, k] as const));

  return {
    release: summary(release),
    ruleset,
    entity: { id: entity.id, canonicalKey: entity.canonicalKey, entityType: entity.entityType },
    pinnedRevision,
    latestRevisionNumber,
    definition,
    kind,
    schemaVersionSupported: kind !== null && definition !== null && definition.schemaVersion !== null && kind.supportedSchemaVersions.includes(definition.schemaVersion),
    keywords: {
      structured: structuredKeys.map((canonicalKey) => ({ canonicalKey, keyword: keywordByKey.get(canonicalKey) ?? null })),
      assigned: assigned.map((a) => ({ keyword: a.keyword, sourceType: a.sourceType })),
    },
    references,
    referencesTruncated: collected.truncated,
    referencedBy: referencing.slice(0, REFERENCED_BY_LIMIT).map(card),
    referencedByTruncated: referencing.length > REFERENCED_BY_LIMIT,
    relationships,
    relatedByKeyword: sameKeyword.map(card),
    sources: sourceRefs.map((reference) => ({ reference, document: documents.get(reference.sourceDocumentId) ?? null })),
  };
}

/**
 * Release Comparison (composition level, via M2 `compareRulesetReleases`): ADDED / REMOVED / CHANGED_VERSION entries
 * plus the unchanged count, enriched with display identity for one page of entries. No semantic diff of content.
 */
export async function compareReferenceReleases(
  rulesetId: string,
  releaseId: string,
  otherReleaseId: string,
  query: { page: number; pageSize: number; type?: string },
): Promise<ReferenceComparison> {
  const ruleset = await requireRuleset(rulesetId);
  const [a, b] = await Promise.all([requireRelease(ruleset, releaseId), requireRelease(ruleset, otherReleaseId)]);
  const diff = await compareRulesetReleases(a.id, b.id);
  if (query.type !== undefined && query.type !== "" && !(RULESET_RELEASE_DIFF_TYPES as readonly string[]).includes(query.type)) throw invalid(`Not a comparison entry type: ${JSON.stringify(query.type)}`);
  const filtered = query.type ? diff.entries.filter((e) => e.type === query.type) : diff.entries;
  const pageSize = Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE);
  const page = Math.max(1, query.page);
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const versionIds = slice.flatMap((e) => [e.fromEntityVersionId, e.toEntityVersionId]).filter((x): x is NonNullable<typeof x> => x !== null);
  const [entities, versions] = await Promise.all([selectEntitiesByIds(slice.map((e) => e.entityId)), selectVersionIdentitiesByIds(versionIds)]);
  const keyById = new Map<string, string>(entities.map((e) => [e.id, e.canonicalKey]));
  const versionById = new Map(versions.map((v) => [v.id, v] as const));
  const side = (id: string | null) => (id === null ? null : { entityVersionId: id, revisionNumber: versionById.get(id)?.revisionNumber ?? null, displayName: versionById.get(id)?.displayName ?? null });
  const count = (t: RulesetReleaseDiffType) => diff.entries.filter((e) => e.type === t).length;
  return {
    releaseA: summary(a),
    releaseB: summary(b),
    counts: { added: count("ADDED_ENTITY"), removed: count("REMOVED_ENTITY"), changed: count("CHANGED_VERSION"), unchanged: diff.unchangedCount },
    entries: slice.map((e) => ({ type: e.type, entityId: e.entityId, canonicalKey: keyById.get(e.entityId) ?? null, from: side(e.fromEntityVersionId), to: side(e.toEntityVersionId) })),
    total: filtered.length,
    page,
    pageSize,
  };
}
