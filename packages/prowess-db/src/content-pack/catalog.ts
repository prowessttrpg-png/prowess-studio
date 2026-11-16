import { z } from "zod";
import {
  CanonConflictDisposition, CanonDecisionType, ChangeSetOperationType, ChangeSetStatus, ChangeType,
  EntityType, EntityVersionStatus, KeywordAssignmentSource, RelationshipType, RuleConflictSeverity,
  RuleConflictStatus, RuleConflictType, RulesetChannel, RulesetStatus, SourceAuthorityStatus,
  SourceDocumentType,
} from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ContentPackManifestError, type ContentPackRecordKind } from "./manifest.js";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const text = z.string().max(1_000_000).refine((value) => !value.includes("\0"));
const positive = z.int().positive().max(2147483647);
const instant = z.iso.datetime({ precision: 3 });
const jsonObject = z.record(z.string(), z.unknown());

export type Row = Record<string, unknown>;
export type StoredRecordKind = Exclude<ContentPackRecordKind, "source-locations">;

function catalogRecord(model: keyof Prisma.TransactionClient, primary: string[], unique: string[][], shape: z.ZodRawShape) {
  return {
    model, primary, unique, schema: z.strictObject(shape),
    select: Object.fromEntries(Object.keys(shape).map((field) => [field, true])),
  };
}

/** Explicit portable projection. Source paths, notes, excerpts and raw authoring sources stay out. */
export const catalog = {
  "rulesets": catalogRecord("ruleset", ["id"], [["canonicalKey"]], {
    id: uuid, canonicalKey: text, name: text,
    description: text.nullable(), status: z.enum(RulesetStatus), channel: z.enum(RulesetChannel),
    versionLabel: text.nullable(), parentRulesetId: uuid.nullable(), createdAt: instant,
    updatedAt: instant,
  }),
  "entities": catalogRecord("entity", ["id"], [["canonicalKey"]], {
    id: uuid, entityType: z.enum(EntityType), canonicalKey: text,
    createdAt: instant, updatedAt: instant,
  }),
  "keyword-categories": catalogRecord("keywordCategory", ["id"], [["canonicalKey"]], {
    id: uuid, canonicalKey: text, name: text,
    description: text.nullable(), createdAt: instant,
  }),
  "keyword-definitions": catalogRecord("keywordDefinition", ["id"], [["canonicalKey"]], {
    id: uuid, canonicalKey: text, name: text,
    categoryId: uuid.nullable(), description: text.nullable(), deprecated: z.boolean(),
    createdAt: instant,
  }),
  "entity-versions": catalogRecord("entityVersion", ["id"], [["entityId", "revisionNumber"]], {
    id: uuid, entityId: uuid, revisionNumber: positive,
    status: z.enum(EntityVersionStatus), displayName: text, shortDescription: text.nullable(),
    rulesText: text.nullable(), structuredData: jsonObject, parentVersionId: uuid.nullable(),
    changeType: z.enum(ChangeType).nullable(), changeSummary: text.nullable(), createdAt: instant,
    updatedAt: instant,
  }),
  "aliases": catalogRecord("entityAlias", ["id"], [["entityId", "normalizedAlias", "normalizedContext"]], {
    id: uuid, entityId: uuid, alias: text,
    normalizedAlias: text, context: text.nullable(), normalizedContext: text,
    createdAt: instant,
  }),
  "entity-keywords": catalogRecord("entityKeyword", ["entityId", "keywordId"], [], {
    entityId: uuid, keywordId: uuid, sourceType: z.enum(KeywordAssignmentSource),
    createdAt: instant,
  }),
  "entity-version-keywords": catalogRecord("entityVersionKeyword", ["entityVersionId", "keywordId"], [], {
    entityVersionId: uuid, keywordId: uuid, sourceType: z.enum(KeywordAssignmentSource),
    createdAt: instant,
  }),
  "relationships": catalogRecord("entityRelationship", ["id"], [["sourceEntityId", "targetEntityId", "relationshipType"]], {
    id: uuid, sourceEntityId: uuid, targetEntityId: uuid,
    relationshipType: z.enum(RelationshipType), metadata: jsonObject, createdAt: instant,
  }),
  "source-documents": catalogRecord("sourceDocument", ["id"], [], {
    id: uuid, title: text, sourceType: z.enum(SourceDocumentType),
    versionLabel: text.nullable(), authorityStatus: z.enum(SourceAuthorityStatus).nullable(), createdAt: instant,
  }),
  "source-references": catalogRecord("sourceReference", ["id"], [], {
    id: uuid, sourceDocumentId: uuid, entityVersionId: uuid,
    sectionLabel: text.nullable(), pageReference: text.nullable(), createdAt: instant,
  }),
  "manifests": catalogRecord("rulesetManifest", ["id"], [["rulesetId", "manifestVersion"]], {
    id: uuid, rulesetId: uuid, parentManifestId: uuid.nullable(),
    manifestVersion: positive, createdAt: instant,
  }),
  "manifest-entries": catalogRecord("rulesetManifestEntry", ["id"], [["manifestId", "entityId"]], {
    id: uuid, manifestId: uuid, entityId: uuid,
    entityVersionId: uuid, createdAt: instant,
  }),
  "canon-policies": catalogRecord("canonPolicy", ["id"], [["rulesetId", "policyVersion"]], {
    id: uuid, rulesetId: uuid, policyVersion: positive,
    name: text, description: text.nullable(), createdAt: instant,
  }),
  "source-authorities": catalogRecord("sourceAuthorityRecord", ["id"], [["canonPolicyId", "sourceDocumentId", "scopeKey"]], {
    id: uuid, canonPolicyId: uuid, sourceDocumentId: uuid,
    scopeKey: text, authorityStatus: z.enum(SourceAuthorityStatus), rationale: text.nullable(),
    createdAt: instant,
  }),
  "rule-conflicts": catalogRecord("ruleConflict", ["id"], [], {
    id: uuid, rulesetId: uuid, entityId: uuid,
    conflictType: z.enum(RuleConflictType), severity: z.enum(RuleConflictSeverity), status: z.enum(RuleConflictStatus),
    title: text, description: text.nullable(), createdAt: instant,
  }),
  "rule-conflict-candidates": catalogRecord("ruleConflictCandidate", ["id"], [["ruleConflictId", "entityVersionId"]], {
    id: uuid, ruleConflictId: uuid, entityId: uuid,
    entityVersionId: uuid, sourceReferenceId: uuid.nullable(), label: text.nullable(),
    positionSummary: text.nullable(), createdAt: instant,
  }),
  "canon-decisions": catalogRecord("canonDecision", ["id"], [], {
    id: uuid, rulesetId: uuid, entityId: uuid,
    ruleConflictId: uuid, canonPolicyId: uuid, decisionType: z.enum(CanonDecisionType),
    conflictDisposition: z.enum(CanonConflictDisposition), resultEntityVersionId: uuid.nullable(), rationale: text,
    createdAt: instant,
  }),
  "canon-decision-selections": catalogRecord("canonDecisionSelection", ["id"], [["canonDecisionId", "ruleConflictCandidateId"]], {
    id: uuid, canonDecisionId: uuid, ruleConflictId: uuid,
    ruleConflictCandidateId: uuid, createdAt: instant,
  }),
  "change-sets": catalogRecord("changeSet", ["id"], [], {
    id: uuid, rulesetId: uuid, canonDecisionId: uuid.nullable(),
    name: text, description: text.nullable(), status: z.enum(ChangeSetStatus),
    createdAt: instant,
  }),
  "change-set-operations": catalogRecord("changeSetOperation", ["id"], [["changeSetId", "sequence"]], {
    id: uuid, changeSetId: uuid, rulesetId: uuid,
    sequence: positive, operationType: z.enum(ChangeSetOperationType), targetEntityId: uuid.nullable(),
    fromEntityVersionId: uuid.nullable(), toEntityVersionId: uuid.nullable(), targetManifestId: uuid.nullable(),
    description: text.nullable(), createdAt: instant,
  }),
  "releases": catalogRecord("rulesetRelease", ["id"], [["rulesetId", "releaseNumber"], ["rulesetId", "versionLabel"], ["changeSetId"]], {
    id: uuid, rulesetId: uuid, releaseNumber: positive,
    versionLabel: text, channel: z.enum(RulesetChannel), manifestId: uuid,
    canonPolicyId: uuid, changeSetId: uuid.nullable(), manifestHash: text,
    releaseNotes: text.nullable(), publishedAt: instant,
  }),
} satisfies Record<StoredRecordKind, ReturnType<typeof catalogRecord>>;

export const sourceLocation = z.strictObject({
  id: uuid, sourceDocumentId: uuid, snapshotId: uuid, contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  sectionId: uuid.nullable(), blockId: uuid.nullable(), tableId: uuid.nullable(),
});

export const kinds = Object.keys(catalog) as StoredRecordKind[];
export type Records = Map<ContentPackRecordKind, Row[]>;

export function rowKey(kind: ContentPackRecordKind, row: Row): string {
  const fields = kind === "source-locations" ? ["id"] : catalog[kind].primary;
  return JSON.stringify(fields.map((field) => row[field]));
}

export function parseRecord(kind: ContentPackRecordKind, row: unknown): Row {
  const schema = kind === "source-locations" ? sourceLocation : catalog[kind].schema;
  const result = schema.safeParse(row);
  if (!result.success) {
    const field = result.error.issues[0]?.path.join(".") || "record";
    throw new ContentPackManifestError(`Invalid ${kind} field: ${field}`);
  }
  return result.data;
}
