import { validateStoredProwessDefinition, type StoredDefinitionContent } from "@prowess/game";
import { canonicalJson } from "@prowess/import";
import { isValidCanonicalKey, isValidEntityAlias, normalizeEntityAlias, validateChangeSetOperation, type CreateChangeSetOperationInput, type EntityType } from "@prowess/model";
import { catalog, kinds, rowKey, type Records, type Row } from "./catalog.js";
import { ContentPackManifestError, type ContentPackRecordKind, type ManifestBody } from "./manifest.js";

type Fields = Record<string, string | number | null>;
export type Link = { kind: ContentPackRecordKind; where: Fields; required: boolean };
type Edge = [ContentPackRecordKind, string, string?, ...string[]];
const parents: Partial<Record<ContentPackRecordKind, Edge[]>> = {
  rulesets: [["rulesets", "parentRulesetId"]],
  "keyword-definitions": [["keyword-categories", "categoryId"]],
  "entity-versions": [["entities", "entityId"], ["entity-versions", "parentVersionId", "id", "entityId"]],
  aliases: [["entities", "entityId"]],
  "entity-keywords": [["entities", "entityId"], ["keyword-definitions", "keywordId"]],
  "entity-version-keywords": [["entity-versions", "entityVersionId"], ["keyword-definitions", "keywordId"]],
  relationships: [["entities", "sourceEntityId"], ["entities", "targetEntityId"]],
  "source-references": [["source-documents", "sourceDocumentId"], ["entity-versions", "entityVersionId"]],
  "source-locations": [["source-references", "id", "id", "sourceDocumentId"]],
  manifests: [["rulesets", "rulesetId"], ["manifests", "parentManifestId"]],
  "manifest-entries": [["manifests", "manifestId"], ["entities", "entityId"], ["entity-versions", "entityVersionId", "id", "entityId"]],
  "canon-policies": [["rulesets", "rulesetId"]],
  "source-authorities": [["canon-policies", "canonPolicyId"], ["source-documents", "sourceDocumentId"]],
  "rule-conflicts": [["rulesets", "rulesetId"], ["entities", "entityId"]],
  "rule-conflict-candidates": [["rule-conflicts", "ruleConflictId", "id", "entityId"], ["entity-versions", "entityVersionId", "id", "entityId"], ["source-references", "sourceReferenceId", "id", "entityVersionId"]],
  "canon-decisions": [["rule-conflicts", "ruleConflictId", "id", "rulesetId", "entityId"], ["canon-policies", "canonPolicyId", "id", "rulesetId"], ["entity-versions", "resultEntityVersionId", "id", "entityId"]],
  "canon-decision-selections": [["canon-decisions", "canonDecisionId", "id", "ruleConflictId"], ["rule-conflict-candidates", "ruleConflictCandidateId", "id", "ruleConflictId"]],
  "change-sets": [["rulesets", "rulesetId"], ["canon-decisions", "canonDecisionId", "id", "rulesetId"]],
  "change-set-operations": [["change-sets", "changeSetId", "id", "rulesetId"], ["entities", "targetEntityId"], ["entity-versions", "fromEntityVersionId"], ["entity-versions", "toEntityVersionId"], ["manifests", "targetManifestId", "id", "rulesetId"]],
  releases: [["rulesets", "rulesetId"], ["manifests", "manifestId", "id", "rulesetId"], ["canon-policies", "canonPolicyId", "id", "rulesetId"], ["change-sets", "changeSetId", "id", "rulesetId"]],
};
const children: Partial<Record<ContentPackRecordKind, Edge[]>> = {
  entities: [["aliases", "id", "entityId"], ["entity-keywords", "id", "entityId"]],
  "entity-versions": [["entity-version-keywords", "id", "entityVersionId"], ["source-references", "id", "entityVersionId"]],
  "source-references": [["source-locations", "id"]],
  manifests: [["manifest-entries", "id", "manifestId"]],
  "canon-policies": [["source-authorities", "id", "canonPolicyId"]],
  "rule-conflicts": [["rule-conflict-candidates", "id", "ruleConflictId"]],
  "canon-decisions": [["canon-decision-selections", "id", "canonDecisionId"]],
  "change-sets": [["change-set-operations", "id", "changeSetId"]],
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const sortedRows = (kind: ContentPackRecordKind, rows: readonly Row[]) => [...rows].sort((a, b) => compare(rowKey(kind, a), rowKey(kind, b)));

export function inspectPackJson(value: unknown, visit: (row: Row) => void = () => {}) {
  const pending: Array<[unknown, number]> = [[value, 0]];
  let nodes = 0;
  while (pending.length !== 0) {
    const [item, depth] = pending.pop()!;
    if (++nodes > 100_000 || depth > 64) throw new ContentPackManifestError("Record data exceeds JSON structure limits");
    if (typeof item === "number" && !Number.isFinite(item)) throw new ContentPackManifestError("Record contains an invalid number");
    if (item === null || typeof item !== "object") continue;
    if (Array.isArray(item)) {
      for (const value of item) pending.push([value, depth + 1]);
      continue;
    }
    const row = item as Row;
    for (const [key, value] of Object.entries(row)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new ContentPackManifestError("Unsafe key in pack record");
      pending.push([value, depth + 1]);
    }
    visit(row);
  }
}

export function links(kind: ContentPackRecordKind, row: Row): Link[] {
  const result: Link[] = [];
  for (const [edges, required] of [[parents[kind] ?? [], true], [children[kind] ?? [], false]] as const) {
    for (const [target, source, field = "id", ...matches] of edges) {
      if (typeof row[source] !== "string") continue;
      const where: Fields = { [field]: row[source] };
      for (const key of matches) where[key] = row[key] as string;
      result.push({ kind: target, where, required });
    }
  }
  if (kind === "change-set-operations") {
    for (const link of result) {
      if (link.kind === "entity-versions") link.where.entityId = row.targetEntityId as string;
    }
  }
  if (kind === "entity-versions") {
    const data = (row.structuredData as Row).prowessDefinition as Row | undefined;
    inspectPackJson(row.structuredData);
    inspectPackJson(data?.payload, (node) => {
      if (typeof node.entityVersionId === "string" && typeof node.entityId === "string" && typeof node.definitionKind === "string") {
        result.push({ kind: "entity-versions", where: { id: node.entityVersionId, entityId: node.entityId }, required: true });
      }
    });
    const keywords = (data?.payload as Row | undefined)?.keywords;
    if (Array.isArray(keywords)) {
      for (const key of keywords) {
        if (typeof key === "string") result.push({ kind: "keyword-definitions", where: { canonicalKey: key }, required: true });
      }
    }
  }
  return result;
}

export function indexRecords(records: Records) {
  const indexes = new Map<string, Map<unknown, Row[]>>();
  return ({ kind, where }: Pick<Link, "kind" | "where">): Row[] => {
    const [field, value] = Object.entries(where)[0]!;
    const name = `${kind}:${field}`;
    let keyed = indexes.get(name);
    if (keyed === undefined) {
      keyed = new Map();
      for (const row of records.get(kind) ?? []) {
        const selected = keyed.get(row[field]) ?? [];
        selected.push(row);
        keyed.set(row[field], selected);
      }
      indexes.set(name, keyed);
    }
    return (keyed.get(value) ?? []).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
  };
}

export const releaseHeader = (row: Row): ManifestBody["release"] => {
  const { id, ...fields } = row;
  return { ...fields, releaseId: id } as ManifestBody["release"];
};

export function uniqueKeys(kind: ContentPackRecordKind, row: Row): Array<[string, Fields]> {
  const definition = kind === "source-locations" ? { primary: ["id"], unique: [] } : catalog[kind];
  return [definition.primary, ...definition.unique].filter((keys) => keys.every((key) => row[key] !== null)).map((keys) => [
    JSON.stringify([keys, keys.map((key) => row[key])]),
    Object.fromEntries(keys.map((key) => [key, row[key]])) as Fields,
  ]);
}

export function ancestryOrder(kind: ContentPackRecordKind, rows: Row[]): Row[] {
  const field = kind === "rulesets" ? "parentRulesetId" : kind === "manifests" ? "parentManifestId" : kind === "entity-versions" ? "parentVersionId" : null;
  if (!field) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<Row>();
  const output: Row[] = [];
  for (const start of rows) {
    const path: Row[] = [];
    const visiting = new Set<Row>();
    let row: Row | undefined = start;
    while (row && !seen.has(row)) {
      if (visiting.has(row) || path.length >= 64) throw new ContentPackManifestError(`Invalid ${kind} ancestry`);
      visiting.add(row);
      path.push(row);
      row = byId.get(row[field]);
    }
    for (const item of path.reverse()) {
      seen.add(item);
      output.push(item);
    }
  }
  return output;
}

function definition(row: Row, owner: Row): StoredDefinitionContent | null {
  const result = validateStoredProwessDefinition({ entityType: owner.entityType as EntityType, structuredData: row.structuredData });
  if (!result.ok) throw new ContentPackManifestError(`Invalid Definition on revision ${row.id}: ${result.problems[0]?.message}`);
  return result.value.kind === "DEFINITION" ? result.value.definition : null;
}

/** Validate the closed graph before either the preview or transaction can use it. */
export function validateGraph(records: Records, release: ManifestBody["release"]): ManifestBody["compatibility"] {
  const lookup = indexRecords(records);
  const selected = records.get("releases");
  if (selected?.length !== 1 || canonicalJson(releaseHeader(selected[0]!)) !== canonicalJson(release)) {
    throw new ContentPackManifestError("Release record does not match the manifest identity");
  }
  const root = lookup({ kind: "manifests", where: { id: release.manifestId } })[0];
  if (root?.parentManifestId !== null) throw new ContentPackManifestError("Published Release manifest must be flattened");

  const declared = new Map<string, ManifestBody["compatibility"]["definitionSchemas"][number]>();
  const definitions = new Map<unknown, StoredDefinitionContent>();
  const seen = new Set<Row>();
  const queue: Array<[ContentPackRecordKind, Row, number]> = [["releases", selected[0]!, 0]];
  for (let i = 0; i < queue.length; i++) {
    const [kind, row, depth] = queue[i]!;
    if (seen.has(row)) continue;
    if (depth > 64) throw new ContentPackManifestError("Release dependency depth exceeds limits");
    seen.add(row);
    for (const link of links(kind, row)) {
      const found = lookup(link);
      if (link.required && found.length !== 1) throw new ContentPackManifestError(`Missing or incompatible dependency: ${link.kind} ${JSON.stringify(link.where)}`);
      for (const target of found) if (!seen.has(target)) queue.push([link.kind, target, depth + 1]);
    }
    if ("canonicalKey" in row && !isValidCanonicalKey(row.canonicalKey as string)) throw new ContentPackManifestError(`Invalid canonical key on ${kind}`);
    if (kind === "aliases" && (!isValidEntityAlias(row.alias) || normalizeEntityAlias(row.alias) !== row.normalizedAlias || normalizeEntityAlias(String(row.context ?? "")) !== row.normalizedContext)) {
      throw new ContentPackManifestError("Invalid normalized Entity alias");
    }
    if (kind === "change-sets" && row.status !== "APPROVED") throw new ContentPackManifestError("Published ChangeSet must be approved");
    if (kind === "change-set-operations" && validateChangeSetOperation(row as unknown as CreateChangeSetOperationInput, Number(row.sequence) - 1)) {
      throw new ContentPackManifestError("Invalid published ChangeSet operation");
    }
    if (kind === "entity-versions") {
      if (row.status === "DRAFT" || row.status === "IN_REVIEW") throw new ContentPackManifestError(`Unpublished revision cannot be exported: ${row.id}`);
      const owner = lookup({ kind: "entities", where: { id: row.entityId as string } })[0]!;
      const found = definition(row, owner);
      if (found !== null) {
        const spec = { kind: found.definitionKind, family: found.systemFamily, schemaVersion: found.schemaVersion };
        declared.set(`${spec.kind}:${spec.schemaVersion}`, spec);
        definitions.set(row.id, found);
      }
    }
  }

  for (const [kind, rows] of records) {
    const keys = new Set<string>();
    ancestryOrder(kind, rows);
    for (const row of rows) {
      if (kind === "relationships") {
        if (row.sourceEntityId === row.targetEntityId || links(kind, row).some((link) => !lookup(link).some((target) => seen.has(target)))) {
          throw new ContentPackManifestError("Relationship endpoints are outside the portable Release graph");
        }
        inspectPackJson(row.metadata);
      } else if (!seen.has(row)) throw new ContentPackManifestError(`Unreachable ${kind} record in pack`);
      for (const [key] of uniqueKeys(kind, row)) {
        if (keys.has(key)) throw new ContentPackManifestError(`Duplicate identity in ${kind}`);
        keys.add(key);
      }
    }
  }

  for (const value of definitions.values()) {
    inspectPackJson(value.payload, (node) => {
      if (typeof node.entityVersionId !== "string" || typeof node.definitionKind !== "string" || typeof node.entityId !== "string") return;
      const target = definitions.get(node.entityVersionId);
      const owner = lookup({ kind: "entities", where: { id: node.entityId } })[0];
      if (target?.definitionKind !== node.definitionKind || target.systemFamily !== node.systemFamily || owner?.canonicalKey !== node.canonicalKey) {
        throw new ContentPackManifestError(`Definition reference does not match exact revision ${node.entityVersionId}`);
      }
    });
  }
  return {
    capabilities: declared.size === 0 ? ["prowess.exact-release.v1"] : ["prowess.exact-release.v1", "prowess.structured-definitions.v1"],
    definitionSchemas: [...declared].sort(([a], [b]) => compare(a, b)).map(([, entry]) => entry),
  };
}

export function countRecords(records: Records): number {
  return kinds.reduce((total, kind) => total + (records.get(kind)?.length ?? 0), records.get("source-locations")?.length ?? 0);
}
