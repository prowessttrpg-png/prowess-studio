import { KeywordCategoryId, type CanonicalKey, type KeywordCategory } from "@prowess/model";
import { prisma } from "../client.js";
import type { KeywordCategory as PrismaKeywordCategoryRow } from "../../generated/prisma/client.js";

/**
 * KeywordCategory repository — the only place in this package that speaks
 * Prisma's `keywordCategory` query API directly. Internal implementation
 * detail of the keyword-category service (not re-exported from
 * `@prowess/db`'s own `index.ts`) — see `./service.ts`.
 */

function toDomainKeywordCategory(row: PrismaKeywordCategoryRow): KeywordCategory {
  return {
    id: KeywordCategoryId.of(row.id),
    canonicalKey: row.canonicalKey as CanonicalKey,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
  };
}

export interface InsertKeywordCategoryInput {
  canonicalKey: CanonicalKey;
  name: string;
  description: string | null;
}

/**
 * Inserts a new KeywordCategory row. Does not catch or translate errors —
 * a canonical-key uniqueness violation surfaces here as Prisma's own
 * `PrismaClientKnownRequestError` (code `P2002`); mapping that to the
 * domain's `KEYWORD_CATEGORY.CANONICAL_KEY_CONFLICT` is the service
 * layer's job.
 */
export async function insertKeywordCategory(
  input: InsertKeywordCategoryInput,
): Promise<KeywordCategory> {
  const row = await prisma.keywordCategory.create({
    data: {
      canonicalKey: input.canonicalKey,
      name: input.name,
      description: input.description,
    },
  });
  return toDomainKeywordCategory(row);
}

export async function selectKeywordCategoryById(id: string): Promise<KeywordCategory | null> {
  try {
    const row = await prisma.keywordCategory.findUnique({ where: { id } });
    return row ? toDomainKeywordCategory(row) : null;
  } catch {
    return null;
  }
}

export async function selectKeywordCategoryByCanonicalKey(
  canonicalKey: string,
): Promise<KeywordCategory | null> {
  const row = await prisma.keywordCategory.findUnique({ where: { canonicalKey } });
  return row ? toDomainKeywordCategory(row) : null;
}

/**
 * Ordered `canonicalKey ASC` — deterministic, same convention as every
 * other list operation in this package. Added in M1-WO8 specifically to
 * back `GET /api/keyword-categories` — M1-WO5 had no list operation since
 * nothing needed one yet.
 */
export async function selectKeywordCategories(): Promise<KeywordCategory[]> {
  const rows = await prisma.keywordCategory.findMany({ orderBy: { canonicalKey: "asc" } });
  return rows.map(toDomainKeywordCategory);
}
