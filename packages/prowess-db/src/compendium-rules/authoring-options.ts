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

const words = (token: string) => token.charAt(0) + token.slice(1).toLowerCase().replace(/_/g, " ");

export async function listAuthoringOptions(list: unknown): Promise<readonly AuthoringOption[]> {
  const seen = new Map<string, string>();
  if (list === "skillRanks") {
    for (const { payload } of await payloadsOf("RANK_LADDER")) {
      if (payload.ladderKey !== SKILL_RANK_LADDER_KEY || !Array.isArray(payload.ranks)) continue;
      for (const r of payload.ranks as Array<{ rankKey?: unknown }>) if (typeof r.rankKey === "string" && !seen.has(r.rankKey)) seen.set(r.rankKey, r.rankKey.charAt(0) + r.rankKey.slice(1).toLowerCase().replace(/_/g, " "));
    }
  } else if (list === "calculatedValues") {
    for (const { displayName, payload } of await payloadsOf("CALCULATED_VALUE")) if (typeof payload.valueKey === "string" && !seen.has(payload.valueKey)) seen.set(payload.valueKey, displayName);
  } else if (list === "rankLadders") {
    // Phase D: a rank ladder by name (the ladder's own key stays the stored identity).
    for (const { displayName, payload } of await payloadsOf("RANK_LADDER")) if (typeof payload.ladderKey === "string" && !seen.has(payload.ladderKey)) seen.set(payload.ladderKey, displayName);
  } else if (list === "allRanks") {
    // Phase D: any rank of any ladder (a Martial rank, a starting Skill rank), labelled with its ladder.
    for (const { displayName, payload } of await payloadsOf("RANK_LADDER")) {
      if (!Array.isArray(payload.ranks)) continue;
      for (const r of payload.ranks as Array<{ rankKey?: unknown }>) if (typeof r.rankKey === "string" && !seen.has(r.rankKey)) seen.set(r.rankKey, `${words(r.rankKey)} (${displayName})`);
    }
  } else if (list === "weaponFamilies") {
    // Phase D: the Weapon families the Compendium defines (a Weapon's family, also named by its Attacks).
    for (const { displayName, payload } of await payloadsOf("WEAPON")) if (typeof payload.familyKey === "string" && !seen.has(payload.familyKey)) seen.set(payload.familyKey, `${words(payload.familyKey)} (for example ${displayName})`);
  } else if (list === "skills") {
    // Phase D: a Skill by name, for fields that store the Skill's canonical key (a Skill-rank prerequisite).
    const rows = await prisma.entityVersion.findMany({
      where: { status: { in: ["DRAFT", "IN_REVIEW", "APPROVED"] }, structuredData: { path: ["prowessDefinition", "definitionKind"], equals: "SKILL" } },
      select: { displayName: true, entity: { select: { canonicalKey: true } } },
      orderBy: [{ revisionNumber: "desc" }],
      take: 500,
    });
    for (const r of rows) if (!seen.has(r.entity.canonicalKey)) seen.set(r.entity.canonicalKey, r.displayName);
  } else if (list === "maneuverComponents") {
    // RULES-WO1 Phase H: a Maneuver component by name, for policy fields that store its canonical key.
    const rows = await prisma.entityVersion.findMany({
      where: { status: { in: ["DRAFT", "IN_REVIEW", "APPROVED"] }, structuredData: { path: ["prowessDefinition", "definitionKind"], string_starts_with: "MANEUVER_" } },
      select: { displayName: true, structuredData: true, entity: { select: { canonicalKey: true } } },
      orderBy: [{ revisionNumber: "desc" }],
      take: 500,
    });
    for (const r of rows) {
      const kind = (r.structuredData as { prowessDefinition?: { definitionKind?: string } } | null)?.prowessDefinition?.definitionKind;
      if (kind === "MANEUVER_DEFINITION" || seen.has(r.entity.canonicalKey)) continue;
      seen.set(r.entity.canonicalKey, r.displayName);
    }
  } else throw invalid('list is "skillRanks", "calculatedValues", "rankLadders", "allRanks", "weaponFamilies", "skills" or "maneuverComponents"');
  return [...seen.entries()].map(([token, label]) => ({ token, label })).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}
