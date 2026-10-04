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
