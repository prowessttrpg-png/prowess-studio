import { RulesetId, type CanonicalKey, type Ruleset, type RulesetChannel, type RulesetStatus } from "@prowess/model";
import { prisma } from "../client.js";
import { isUniqueViolation } from "../prisma-errors.js";
import type { Ruleset as PrismaRulesetRow } from "../../generated/prisma/client.js";

/**
 * Ruleset repository — the only place that speaks Prisma's `ruleset` API.
 * Internal to @prowess/db (not exported from `index.ts`); see `./service.ts`.
 */

export function toDomainRuleset(row: PrismaRulesetRow): Ruleset {
  return {
    id: RulesetId.of(row.id),
    canonicalKey: row.canonicalKey as CanonicalKey,
    name: row.name,
    description: row.description,
    status: row.status as RulesetStatus,
    channel: row.channel as RulesetChannel,
    versionLabel: row.versionLabel,
    parentRulesetId: row.parentRulesetId === null ? null : RulesetId.of(row.parentRulesetId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface InsertRulesetInput {
  canonicalKey: string;
  name: string;
  description: string | null;
  channel: RulesetChannel;
  versionLabel: string | null;
  parentRulesetId: string | null;
}

/**
 * Inserts a Ruleset. `status` is always DRAFT here — there is no parameter for
 * it, so no caller path can create a Ruleset in any other state. The database
 * generates the id (`gen_random_uuid()`).
 */
export async function insertRuleset(input: InsertRulesetInput): Promise<Ruleset> {
  const row = await prisma.ruleset.create({
    data: {
      canonicalKey: input.canonicalKey,
      name: input.name,
      description: input.description,
      status: "DRAFT",
      channel: input.channel,
      versionLabel: input.versionLabel,
      parentRulesetId: input.parentRulesetId,
    },
  });
  return toDomainRuleset(row);
}

/** UUID-safe: a malformed id simply finds nothing (never a raw database error). */
export async function selectRulesetById(id: string): Promise<Ruleset | null> {
  try {
    const row = await prisma.ruleset.findUnique({ where: { id } });
    return row ? toDomainRuleset(row) : null;
  } catch {
    return null;
  }
}

export async function selectRulesetByCanonicalKey(canonicalKey: string): Promise<Ruleset | null> {
  const row = await prisma.ruleset.findUnique({ where: { canonicalKey } });
  return row ? toDomainRuleset(row) : null;
}

export interface RulesetFilters {
  status?: RulesetStatus;
  channel?: RulesetChannel;
}

/** Ordered `canonical_key ASC, id ASC` — deterministic. */
export async function selectRulesets(filters: RulesetFilters = {}): Promise<Ruleset[]> {
  const rows = await prisma.ruleset.findMany({
    where: {
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.channel !== undefined ? { channel: filters.channel } : {}),
    },
    orderBy: [{ canonicalKey: "asc" }, { id: "asc" }],
  });
  return rows.map(toDomainRuleset);
}

/**
 * The ancestors of a Ruleset, nearest first (parent, grandparent, …), found by
 * a simple upward walk — at this scale no graph infrastructure is warranted.
 * A visited set means a loop already present in the data cannot spin forever.
 * Lineage is metadata only; nothing resolves content through it.
 */
export async function selectRulesetAncestors(id: string): Promise<Ruleset[]> {
  const ancestors: Ruleset[] = [];
  const seen = new Set<string>([id]);
  const start = await selectRulesetById(id);
  let nextId: string | null = start?.parentRulesetId ?? null;
  while (nextId !== null && !seen.has(nextId)) {
    seen.add(nextId);
    const row = await selectRulesetById(nextId);
    if (row === null) break;
    ancestors.push(row);
    nextId = row.parentRulesetId;
  }
  return ancestors;
}

/**
 * Matched by constraint NAME (`rulesets_canonical_key_key`, created by the
 * migration) — see `../prisma-errors.ts` for why `meta.target` cannot be used
 * with the Prisma 7 driver adapter.
 */
export function isRulesetCanonicalKeyViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    constraint: "rulesets_canonical_key_key",
    fields: ["canonical_key"],
  });
}
