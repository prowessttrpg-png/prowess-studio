import {
  KeywordCategoryId,
  KeywordDefinitionId,
  type CanonicalKey,
  type KeywordDefinition,
} from "@prowess/model";
import { prisma } from "../client.js";
import type { KeywordDefinition as PrismaKeywordDefinitionRow } from "../../generated/prisma/client.js";

/**
 * KeywordDefinition repository — the only place in this package that
 * speaks Prisma's `keywordDefinition` query API directly. Internal
 * implementation detail of the keyword-definition service (not
 * re-exported from `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 */

/**
 * Exported (unlike most of this module's internals) so other repositories
 * within this package — `../entity-keyword/repository.ts` and
 * `../entity-version-keyword/repository.ts`'s list/lookup queries — can
 * reuse the exact same row mapping rather than duplicating it. Still not
 * re-exported from `@prowess/db`'s own `index.ts`; same same-package-only
 * convenience as `entity/repository.ts`'s `toDomainEntity`.
 */
export function toDomainKeywordDefinition(row: PrismaKeywordDefinitionRow): KeywordDefinition {
  return {
    id: KeywordDefinitionId.of(row.id),
    canonicalKey: row.canonicalKey as CanonicalKey,
    name: row.name,
    categoryId: row.categoryId ? KeywordCategoryId.of(row.categoryId) : null,
    description: row.description,
    deprecated: row.deprecated,
    createdAt: row.createdAt,
  };
}

export interface InsertKeywordDefinitionInput {
  canonicalKey: CanonicalKey;
  name: string;
  categoryId: string | null;
  description: string | null;
}

/**
 * Inserts a new KeywordDefinition row. Does not catch or translate
 * errors — a canonical-key uniqueness violation surfaces here as Prisma's
 * own `PrismaClientKnownRequestError` (code `P2002`); mapping that to the
 * domain's `KEYWORD.CANONICAL_KEY_CONFLICT` is the service layer's job.
 */
export async function insertKeywordDefinition(
  input: InsertKeywordDefinitionInput,
): Promise<KeywordDefinition> {
  const row = await prisma.keywordDefinition.create({
    data: {
      canonicalKey: input.canonicalKey,
      name: input.name,
      categoryId: input.categoryId,
      description: input.description,
    },
  });
  return toDomainKeywordDefinition(row);
}

export async function selectKeywordDefinitionById(
  id: string,
): Promise<KeywordDefinition | null> {
  try {
    const row = await prisma.keywordDefinition.findUnique({ where: { id } });
    return row ? toDomainKeywordDefinition(row) : null;
  } catch {
    return null;
  }
}

export async function selectKeywordDefinitionByCanonicalKey(
  canonicalKey: string,
): Promise<KeywordDefinition | null> {
  const row = await prisma.keywordDefinition.findUnique({ where: { canonicalKey } });
  return row ? toDomainKeywordDefinition(row) : null;
}

/**
 * Lists KeywordDefinitions, optionally narrowed to one Category. Ordered
 * `canonicalKey ASC` — deterministic, and meaningful even across
 * categories or when uncategorized (PAS-10 M1-WO5 §15).
 */
export async function selectKeywordDefinitions(
  categoryId?: string,
): Promise<KeywordDefinition[]> {
  const rows = await prisma.keywordDefinition.findMany({
    where: categoryId !== undefined ? { categoryId } : undefined,
    orderBy: { canonicalKey: "asc" },
  });
  return rows.map(toDomainKeywordDefinition);
}

/**
 * RULES-WO1: updates ONLY the presentation fields of one Keyword (name, description, deprecated), and only when the row
 * still holds the values the editor loaded (compare-and-set in one statement). The canonical key — the identity every
 * Definition payload, assignment and content pack refers to — and the category (part of a content pack's protected
 * identity) are never touched here. Returns null when nothing matched (missing or changed since it was loaded).
 */
export async function updateKeywordPresentation(
  id: string,
  expected: { name: string; description: string | null; deprecated: boolean },
  next: { name: string; description: string | null; deprecated: boolean },
): Promise<KeywordDefinition | null> {
  const out = await prisma.keywordDefinition.updateMany({
    where: { id, name: expected.name, description: expected.description, deprecated: expected.deprecated },
    data: { name: next.name, description: next.description, deprecated: next.deprecated },
  });
  if (out.count !== 1) return null;
  const row = await prisma.keywordDefinition.findUnique({ where: { id } });
  return row === null ? null : toDomainKeywordDefinition(row);
}

/** RULES-WO1: where a Keyword is used — assignments, Definition revisions naming its key, and Releases pinning those. */
/** Whether a content pack owns this Keyword (DIST-WO2): imported records are read-only on every write path. */
export async function isKeywordImported(id: string): Promise<boolean> {
  return (await prisma.contentPackOwnership.count({ where: { kind: "keyword-definitions", identity: id } })) > 0;
}

export async function selectKeywordUsage(id: string, canonicalKey: string): Promise<{ entityAssignments: number; versionAssignments: number; definitionRevisions: number; releases: number }> {
  const [entityAssignments, versionAssignments] = await Promise.all([prisma.entityKeyword.count({ where: { keywordId: id } }), prisma.entityVersionKeyword.count({ where: { keywordId: id } })]);
  const rows = await prisma.$queryRaw<Array<{ revisions: bigint; releases: bigint }>>`
    SELECT
      (SELECT count(*) FROM entity_versions v WHERE (v.structured_data -> 'prowessDefinition' -> 'payload' -> 'keywords') ? ${canonicalKey}) AS revisions,
      (SELECT count(DISTINCT r.id) FROM ruleset_releases r
         JOIN ruleset_manifest_entries e ON e.manifest_id = r.manifest_id
         JOIN entity_versions v ON v.id = e.entity_version_id
        WHERE (v.structured_data -> 'prowessDefinition' -> 'payload' -> 'keywords') ? ${canonicalKey}) AS releases`;
  return { entityAssignments, versionAssignments, definitionRevisions: Number(rows[0]?.revisions ?? 0), releases: Number(rows[0]?.releases ?? 0) };
}
