import {
  COMPENDIUM_AUTHORING_ERROR_CODES,
  DomainError,
  ENTITY_ERROR_CODES,
  ENTITY_VERSION_ERROR_CODES,
  canMutateEntityVersionContent,
  isChangeType,
  isEntityType,
  isValidCanonicalKey,
  isValidDisplayName,
  type ChangeSetWithOperations,
  type ChangeType,
  type Entity,
  type EntityType,
  type EntityVersion,
  type EntityVersionStatus,
} from "@prowess/model";
import { validateStoredProwessDefinition } from "@prowess/game";
import { createEntity, findEntityByCanonicalKey, getEntityById } from "../entity/index.js";
import { createEntityVersion, getEntityVersion, listEntityVersions, transitionEntityVersionStatus, updateDraftEntityVersion } from "../entity-version/index.js";
import { assignKeywordToEntity } from "../entity-keyword/index.js";
import { assignKeywordToEntityVersion, listEntityVersionKeywords } from "../entity-version-keyword/index.js";
import { createSourceReference } from "../source-reference/index.js";
import { listEntities } from "../entity-query/index.js";
import { createChangeSet } from "../change-set/index.js";
import { authoringKind, type AuthoringDefinitionKind } from "./catalog.js";
import { searchKeywordRows, selectKeywordsByIds, selectSourceDocumentIds, selectVersionIdentitiesByEntityIds, type KeywordRow } from "./repository.js";
import { validateDefinitionCandidate, type AuthoringValidationResult } from "./validation.js";

/**
 * Compendium authoring service (PAS-10 M6-WO1) — the designer-facing operations the Compendium Admin workspace needs,
 * composed ONLY from existing M1 / M2 services plus the M5 validation boundary.
 *
 *   Entity            stable identity (createEntity — canonical key and EntityType never change)
 *   EntityVersion     revisioned content (createEntityVersion allocates revision numbers; updateDraftEntityVersion
 *                     edits DRAFT content atomically; transitionEntityVersionStatus is the only status change)
 *   structuredData.prowessDefinition   the M5 storage contract, validated by @prowess/game
 *   ChangeSet         the M2 proposal record (createChangeSet) — publication stays M2's explicit Release transaction
 *
 * Nothing here publishes, pins a Manifest, deletes an Entity, assigns a status that makes content "active", stores a
 * validity flag, infers a Definition kind or parses Rules Text. No schema change.
 */

const STORAGE_FIELD = "prowessDefinition";
const SEARCH_LIMIT = 20;

export interface AuthoringSourceInput {
  readonly sourceDocumentId: string;
  readonly sectionLabel?: string | null;
  readonly pageReference?: string | null;
  readonly sourceExcerptNote?: string | null;
}

export interface CreateAuthoredDefinitionInput {
  readonly definitionKind: string;
  /** Optional: derived from the M5 catalog when the kind allows exactly one storage EntityType. */
  readonly entityType?: string | null;
  readonly canonicalKey: string;
  readonly displayName: string;
  readonly shortDescription?: string | null;
  readonly rulesText?: string | null;
  readonly changeType?: string | null;
  readonly changeSummary?: string | null;
  readonly prowessDefinition: unknown;
  readonly entityKeywordIds?: readonly string[];
  readonly versionKeywordIds?: readonly string[];
  readonly sources?: readonly AuthoringSourceInput[];
}

export interface AuthoredDefinitionResult {
  readonly entity: Entity;
  readonly version: EntityVersion;
  readonly validation: AuthoringValidationResult;
}

export interface UpdateAuthoredDraftDefinitionInput {
  /** The Draft's `updatedAt` as the editor loaded it (ISO 8601). A different stored value means someone saved since. */
  readonly expectedUpdatedAt: string;
  readonly displayName?: string;
  readonly shortDescription?: string | null;
  readonly rulesText?: string | null;
  readonly changeType?: string | null;
  readonly changeSummary?: string | null;
  /** Omitted = leave the stored Definition unchanged. */
  readonly prowessDefinition?: unknown;
}

export interface CreateAuthoredRevisionInput {
  readonly baseVersionId: string;
  readonly changeType?: string | null;
  readonly changeSummary?: string | null;
}

export interface ProposeDefinitionChangeSetInput {
  readonly rulesetId: string;
  readonly targetManifestId?: string | null;
  readonly name: string;
  readonly description?: string | null;
}

// ---- helpers ----------------------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** The Definition kind a stored revision DECLARES (read verbatim — validity is a separate question). */
export function storedDefinitionKind(structuredData: unknown): string | null {
  if (!isRecord(structuredData) || !isRecord(structuredData[STORAGE_FIELD])) return null;
  const kind = (structuredData[STORAGE_FIELD] as Record<string, unknown>).definitionKind;
  return typeof kind === "string" ? kind : null;
}

function requireChangeType(value: string | null | undefined): ChangeType | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isChangeType(value)) throw new DomainError(ENTITY_VERSION_ERROR_CODES.INVALID_INPUT, `Not a recognized ChangeType: ${JSON.stringify(value)}`);
  return value;
}

function refusal(validation: AuthoringValidationResult): DomainError {
  const first = validation.issues.slice(0, 3).map((i) => `${i.path || "Definition"}: ${i.message}`).join("; ");
  return new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.DEFINITION_REFUSED, `The Prowess Definition cannot be stored, even as a Draft — ${first}`);
}

/** JSON-safe detached copy of an already plain-data-checked candidate. */
const detached = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

function resolveKindAndType(definitionKind: string, entityType: string | null | undefined): { kind: AuthoringDefinitionKind; entityType: EntityType } {
  const kind = authoringKind(definitionKind);
  if (kind === null) throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.UNSUPPORTED_DEFINITION_KIND, `${JSON.stringify(definitionKind)} is not a Prowess Definition kind in the M5 catalog`);
  if (!kind.authorable) {
    throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.UNSUPPORTED_DEFINITION_KIND, `${kind.definitionKind} is a known but reserved Definition kind: its payload contract belongs to a later Work Order, so it cannot be authored yet`);
  }
  if (entityType === undefined || entityType === null || entityType === "") {
    if (kind.allowedEntityTypes.length !== 1) throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.INVALID_INPUT, `${kind.definitionKind} may be stored under several EntityTypes; choose one explicitly`);
    return { kind, entityType: kind.allowedEntityTypes[0] as EntityType };
  }
  if (!isEntityType(entityType) || !kind.allowedEntityTypes.includes(entityType)) {
    throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.INCOMPATIBLE_ENTITY_TYPE, `${kind.definitionKind} is stored under EntityType ${kind.allowedEntityTypes.join(" / ")}, not ${JSON.stringify(entityType)}`);
  }
  return { kind, entityType };
}

/** The Definition kind an Entity's revisions declare — part of its semantic identity (§7). Null for generic content. */
async function entityDefinitionKind(entityId: string): Promise<string | null> {
  const kinds = new Set((await listEntityVersions(entityId)).map((v) => storedDefinitionKind(v.structuredData)).filter((k): k is string => k !== null));
  return kinds.size === 0 ? null : ([...kinds].sort()[0] as string);
}

// ---- validation -------------------------------------------------------------------------------------------------------

/** Side-effect-free validation of an UNSAVED candidate (§41). The EntityType derives from the kind unless given. */
export async function validateAuthoringCandidate(input: { definitionKind?: string | null; entityType?: string | null; prowessDefinition: unknown }): Promise<AuthoringValidationResult> {
  let entityType: string | null | undefined = input.entityType;
  if ((entityType === undefined || entityType === null) && typeof input.definitionKind === "string") {
    const kind = authoringKind(input.definitionKind);
    if (kind !== null && kind.allowedEntityTypes.length === 1) entityType = kind.allowedEntityTypes[0];
  }
  if (typeof entityType !== "string" || !isEntityType(entityType)) {
    throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.INVALID_INPUT, "Validation needs the storage EntityType, or a Definition kind that determines exactly one");
  }
  return validateDefinitionCandidate(entityType, input.prowessDefinition);
}

/** Validates the Definition STORED in one exact revision (read-only). */
export async function validateStoredRevision(versionId: string): Promise<AuthoringValidationResult> {
  const version = await getEntityVersion(versionId);
  const entity = await getEntityById(version.entityId);
  if (!isRecord(version.structuredData) || !Object.prototype.hasOwnProperty.call(version.structuredData, STORAGE_FIELD)) {
    throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.NOT_A_DEFINITION, `EntityVersion ${versionId} holds no Prowess Definition (generic content — no Definition is inferred)`);
  }
  return validateDefinitionCandidate(entity.entityType, (version.structuredData as Record<string, unknown>)[STORAGE_FIELD]);
}

// ---- create -----------------------------------------------------------------------------------------------------------

/**
 * Create Definition (§10): validate EVERYTHING first, then Entity → Revision 1 (DRAFT) → Keyword assignments →
 * provenance. The existing M1 services are separate writes, so creation is staged; every input is checked before the
 * first write, which leaves only an infrastructure failure able to interrupt it — and that is surfaced as PARTIAL_CREATE
 * naming the Entity, never silently.
 */
export async function createAuthoredDefinition(input: CreateAuthoredDefinitionInput): Promise<AuthoredDefinitionResult> {
  const { kind, entityType } = resolveKindAndType(input.definitionKind, input.entityType);
  if (!isRecord(input.prowessDefinition) || input.prowessDefinition.definitionKind !== kind.definitionKind) {
    throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.INVALID_INPUT, `prowessDefinition must be an object whose definitionKind is ${kind.definitionKind}`);
  }
  const validation = await validateDefinitionCandidate(entityType, input.prowessDefinition);
  if (validation.refused) throw refusal(validation);
  if (!isValidCanonicalKey(input.canonicalKey)) throw new DomainError(ENTITY_ERROR_CODES.INVALID_CANONICAL_KEY, `Not a valid canonical key: ${JSON.stringify(input.canonicalKey)}`);
  if (!isValidDisplayName(input.displayName)) throw new DomainError(ENTITY_VERSION_ERROR_CODES.INVALID_INPUT, "displayName is required and must not be empty");
  const changeType = requireChangeType(input.changeType);
  if ((await findEntityByCanonicalKey(input.canonicalKey)) !== null) throw new DomainError(ENTITY_ERROR_CODES.CANONICAL_KEY_CONFLICT, `canonicalKey is already in use: ${input.canonicalKey}`);

  const keywordIds = [...(input.entityKeywordIds ?? []), ...(input.versionKeywordIds ?? [])];
  const knownKeywords = new Set((await selectKeywordsByIds(keywordIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))).map((k) => k.id));
  const missingKeyword = keywordIds.find((id) => !knownKeywords.has(id));
  if (missingKeyword !== undefined) throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.REFERENCE_NOT_FOUND, `Keyword not found: ${missingKeyword}`);
  const sourceIds = (input.sources ?? []).map((s) => s.sourceDocumentId);
  const knownSources = new Set(await selectSourceDocumentIds(sourceIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))));
  const missingSource = sourceIds.find((id) => !knownSources.has(id));
  if (missingSource !== undefined) throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.REFERENCE_NOT_FOUND, `SourceDocument not found: ${missingSource}`);

  const entity = await createEntity({ entityType, canonicalKey: input.canonicalKey });
  try {
    const version = await createEntityVersion(entity.id, {
      displayName: input.displayName,
      shortDescription: input.shortDescription ?? null,
      rulesText: input.rulesText ?? null,
      structuredData: { [STORAGE_FIELD]: detached(input.prowessDefinition) },
      status: "DRAFT",
      changeType: changeType ?? null,
      changeSummary: input.changeSummary ?? null,
    });
    for (const id of input.entityKeywordIds ?? []) await assignKeywordToEntity(entity.id, id);
    for (const id of input.versionKeywordIds ?? []) await assignKeywordToEntityVersion(version.id, id);
    for (const s of input.sources ?? []) {
      await createSourceReference(version.id, { sourceDocumentId: s.sourceDocumentId, sectionLabel: s.sectionLabel ?? null, pageReference: s.pageReference ?? null, sourceExcerptNote: s.sourceExcerptNote ?? null });
    }
    return { entity, version: await getEntityVersion(version.id), validation };
  } catch (error) {
    const reason = error instanceof DomainError ? error.code : "an unexpected server error";
    throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.PARTIAL_CREATE, `Entity ${entity.id} (${entity.canonicalKey}) was created, but completing its first revision failed with ${reason}. Open the Entity in Compendium Admin to finish it.`);
  }
}

// ---- edit -------------------------------------------------------------------------------------------------------------

/**
 * Save Draft (§17, §19, §42–43, §46): updates THIS DRAFT in place — never a new revision. Immutable revisions are
 * refused (ENTITY_VERSION.IMMUTABLE, enforced atomically by M1). A Draft saved since the editor loaded it is refused
 * (STALE_REVISION) instead of overwritten; see docs for the remaining check-then-write window.
 */
export async function updateAuthoredDraftDefinition(versionId: string, input: UpdateAuthoredDraftDefinitionInput): Promise<{ version: EntityVersion; validation: AuthoringValidationResult | null }> {
  const version = await getEntityVersion(versionId);
  if (!canMutateEntityVersionContent(version.status)) {
    throw new DomainError(ENTITY_VERSION_ERROR_CODES.IMMUTABLE, `EntityVersion ${versionId} is ${version.status}; only DRAFT content is editable — create a new revision instead`);
  }
  if (typeof input.expectedUpdatedAt !== "string" || version.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
    throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.STALE_REVISION, `Revision ${version.revisionNumber} changed after it was loaded (saved ${version.updatedAt.toISOString()}). Reload it before saving — nothing was overwritten.`);
  }
  const changeType = requireChangeType(input.changeType);
  const entity = await getEntityById(version.entityId);

  let structuredData: unknown = undefined;
  let validation: AuthoringValidationResult | null = null;
  if (input.prowessDefinition !== undefined) {
    const declared = await entityDefinitionKind(entity.id);
    if (declared === null) throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.NOT_A_DEFINITION, `Entity ${entity.canonicalKey} is generic (non-Prowess) content; authoring never infers or adds a Definition kind to it`);
    if (!isRecord(input.prowessDefinition) || input.prowessDefinition.definitionKind !== declared) {
      throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.DEFINITION_KIND_CHANGE, `Entity ${entity.canonicalKey} is a ${declared} Definition; a revision cannot change its Definition kind`);
    }
    validation = await validateDefinitionCandidate(entity.entityType, input.prowessDefinition);
    if (validation.refused) throw refusal(validation);
    const others = isRecord(version.structuredData) ? Object.fromEntries(Object.entries(version.structuredData).filter(([k]) => k !== STORAGE_FIELD)) : {};
    structuredData = { ...others, [STORAGE_FIELD]: detached(input.prowessDefinition) };
  }

  const updated = await updateDraftEntityVersion(versionId, {
    displayName: input.displayName,
    shortDescription: input.shortDescription,
    rulesText: input.rulesText,
    ...(structuredData === undefined ? {} : { structuredData }),
    changeType,
    changeSummary: input.changeSummary,
  });
  return { version: updated, validation };
}

/**
 * Create New Revision (§18): same Entity, server-allocated revision number, DRAFT, parent = the base revision, content
 * copied from the base. Version-level Keywords are copied too (they are revision content). The base is never touched.
 */
export async function createAuthoredRevision(entityId: string, input: CreateAuthoredRevisionInput): Promise<EntityVersion> {
  await getEntityById(entityId);
  const base = await getEntityVersion(input.baseVersionId);
  if (base.entityId !== entityId) throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.INVALID_BASE_REVISION, `Revision ${input.baseVersionId} belongs to a different Entity`);
  const changeType = requireChangeType(input.changeType);
  const version = await createEntityVersion(entityId, {
    displayName: base.displayName,
    shortDescription: base.shortDescription,
    rulesText: base.rulesText,
    structuredData: base.structuredData,
    status: "DRAFT",
    parentVersionId: base.id,
    changeType: changeType ?? null,
    changeSummary: input.changeSummary ?? null,
  });
  for (const assignment of await listEntityVersionKeywords(base.id)) await assignKeywordToEntityVersion(version.id, assignment.keyword.id, assignment.sourceType);
  return version;
}

// ---- workflow hand-offs -----------------------------------------------------------------------------------------------

async function requirePassingDefinition(versionId: string): Promise<{ version: EntityVersion; entity: Entity }> {
  const version = await getEntityVersion(versionId);
  const entity = await getEntityById(version.entityId);
  const validation = await validateStoredRevision(versionId);
  if (validation.status !== "PASS") {
    throw new DomainError(COMPENDIUM_AUTHORING_ERROR_CODES.DEFINITION_NOT_VALID, `Revision ${version.revisionNumber} of ${entity.canonicalKey} does not pass validation (${validation.issues.length} issue(s)); fix and save it first`);
  }
  return { version, entity };
}

/** Submit for Review: DRAFT → IN_REVIEW through the M1 lifecycle, only for a Definition that passes validation (§16). */
export async function submitAuthoredRevisionForReview(versionId: string): Promise<EntityVersion> {
  await requirePassingDefinition(versionId);
  return transitionEntityVersionStatus(versionId, "IN_REVIEW" satisfies EntityVersionStatus);
}

/**
 * Hand a revision to the M2 Canon Manager (§32–33, §73): creates an ordinary DRAFT ChangeSet in the chosen Ruleset with
 * ONE exact PIN_ENTITY_VERSION proposal, through M2's own createChangeSet. Nothing is applied, pinned or published —
 * review, approval, Manifests and Releases stay in the Canon Manager.
 */
export async function proposeDefinitionChangeSet(versionId: string, input: ProposeDefinitionChangeSetInput): Promise<ChangeSetWithOperations> {
  const { version, entity } = await requirePassingDefinition(versionId);
  return createChangeSet(input.rulesetId, {
    canonDecisionId: null,
    name: input.name,
    description: input.description ?? null,
    operations: [
      {
        operationType: "PIN_ENTITY_VERSION",
        targetEntityId: entity.id,
        toEntityVersionId: version.id,
        targetManifestId: input.targetManifestId ?? null,
        description: `Compendium authoring proposal: pin ${entity.canonicalKey} to revision ${version.revisionNumber} (exact EntityVersion ${version.id}).`,
      },
    ],
  });
}

// ---- discovery --------------------------------------------------------------------------------------------------------

export interface AuthoringDefinitionListItem {
  readonly entity: Entity;
  /** Highest revision number — a list convenience, never Current / Active / Canon. */
  readonly latestRevision: { readonly id: string; readonly revisionNumber: number; readonly status: string; readonly displayName: string; readonly updatedAt: Date } | null;
  /** The kind the latest revision declares; null = generic / non-Prowess Entity (§67 — never inferred). */
  readonly definitionKind: string | null;
  /** Structural M5 check of the latest revision (no reference checks): PASS / FAIL / NOT_A_DEFINITION. */
  readonly structuralValidation: "PASS" | "FAIL" | "NOT_A_DEFINITION" | null;
}

export async function listAuthoringDefinitions(query: { page: number; pageSize: number; search?: string; status?: string; entityType?: string; canonicalKey?: string }): Promise<{ items: AuthoringDefinitionListItem[]; total: number; page: number; pageSize: number }> {
  const result = await listEntities(query);
  return {
    ...result,
    items: result.items.map(({ entity, latestRevision }) => {
      if (latestRevision === null) return { entity, latestRevision: null, definitionKind: null, structuralValidation: null };
      const outcome = validateStoredProwessDefinition({ entityType: entity.entityType, structuredData: latestRevision.structuredData });
      return {
        entity,
        latestRevision: { id: latestRevision.id, revisionNumber: latestRevision.revisionNumber, status: latestRevision.status, displayName: latestRevision.displayName, updatedAt: latestRevision.updatedAt },
        definitionKind: storedDefinitionKind(latestRevision.structuredData),
        structuralValidation: !outcome.ok ? "FAIL" : outcome.value.kind === "DEFINITION" ? "PASS" : "NOT_A_DEFINITION",
      };
    }),
  };
}

export interface DefinitionReferenceCandidate {
  readonly ref: { readonly entityId: string; readonly entityVersionId: string; readonly canonicalKey: string; readonly definitionKind: string; readonly systemFamily: string };
  readonly displayName: string;
  readonly revisionNumber: number;
  readonly status: string;
}

/**
 * Reference picker search (§30, §49–50): human search by display name / alias / exact canonical key, bounded; every
 * candidate is an EXACT revision with its full exact reference. The caller saves the reference, never the name.
 */
export async function searchDefinitionReferences(input: { search: string; definitionKind?: string | null }): Promise<DefinitionReferenceCandidate[]> {
  const term = input.search.trim();
  if (term === "") return [];
  const [byName, byKey] = await Promise.all([
    listEntities({ page: 1, pageSize: SEARCH_LIMIT, search: term }),
    isValidCanonicalKey(term) ? listEntities({ page: 1, pageSize: SEARCH_LIMIT, canonicalKey: term }) : Promise.resolve({ items: [] as Array<{ entity: Entity }> }),
  ]);
  const entityIds = [...new Set([...byKey.items, ...byName.items].map((i) => i.entity.id))].slice(0, SEARCH_LIMIT);
  const rows = await selectVersionIdentitiesByEntityIds(entityIds);
  return rows.flatMap((row) => {
    const declared = storedDefinitionKind(row.structuredData);
    const kind = declared === null ? null : authoringKind(declared);
    if (kind === null || (input.definitionKind ? kind.definitionKind !== input.definitionKind : false)) return [];
    return [{ ref: { entityId: row.entityId, entityVersionId: row.id, canonicalKey: row.entity.canonicalKey, definitionKind: kind.definitionKind, systemFamily: kind.systemFamily }, displayName: row.displayName, revisionNumber: row.revisionNumber, status: row.status }];
  });
}

/** Keyword picker search (§22, §49): bounded lookup in the approved Keyword vocabulary. */
export async function searchAuthoringKeywords(search: string): Promise<KeywordRow[]> {
  return searchKeywordRows(search, SEARCH_LIMIT);
}
