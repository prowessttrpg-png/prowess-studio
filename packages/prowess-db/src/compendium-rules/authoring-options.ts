import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { SKILL_RANK_LADDER_KEY } from "@prowess/game";
import { prisma } from "../client.js";

/**
 * RULES-WO1 — readable choices for fields that name OTHER content by its token: a Skill rank (from the rank ladders that
 * exist) and a calculated value (from the values that exist). Read-only; the M5 reader and the evaluator remain the
 * authority on whether the chosen token resolves in a given Release.
 */
const invalid = (message: string) => new DomainError(CHARACTER_ERROR_CODES.INVALID_INPUT, message);
export interface AuthoringOption {
  readonly token: string;
  readonly label: string;
}

async function payloadsOf(definitionKind: string): Promise<Array<{ displayName: string; payload: Record<string, unknown> }>> {
  const rows = await prisma.entityVersion.findMany({
    where: { status: { in: ["DRAFT", "IN_REVIEW", "APPROVED"] }, structuredData: { path: ["prowessDefinition", "definitionKind"], equals: definitionKind } },
    select: { displayName: true, structuredData: true },
    orderBy: [{ revisionNumber: "desc" }],
    take: 500,
  });
  return rows.map((r) => ({ displayName: r.displayName, payload: ((r.structuredData as { prowessDefinition?: { payload?: Record<string, unknown> } }).prowessDefinition?.payload ?? {}) as Record<string, unknown> }));
}

export async function listAuthoringOptions(list: unknown): Promise<readonly AuthoringOption[]> {
  const seen = new Map<string, string>();
  if (list === "skillRanks") {
    for (const { payload } of await payloadsOf("RANK_LADDER")) {
      if (payload.ladderKey !== SKILL_RANK_LADDER_KEY || !Array.isArray(payload.ranks)) continue;
      for (const r of payload.ranks as Array<{ rankKey?: unknown }>) if (typeof r.rankKey === "string" && !seen.has(r.rankKey)) seen.set(r.rankKey, r.rankKey.charAt(0) + r.rankKey.slice(1).toLowerCase().replace(/_/g, " "));
    }
  } else if (list === "calculatedValues") {
    for (const { displayName, payload } of await payloadsOf("CALCULATED_VALUE")) if (typeof payload.valueKey === "string" && !seen.has(payload.valueKey)) seen.set(payload.valueKey, displayName);
  } else throw invalid('list is "skillRanks" or "calculatedValues"');
  return [...seen.entries()].map(([token, label]) => ({ token, label })).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}
