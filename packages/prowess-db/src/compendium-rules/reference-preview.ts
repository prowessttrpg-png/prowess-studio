import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { PROWESS_STATS, previewArmor, previewMissionTable, previewSummonCosts, previewThreatClock } from "@prowess/game";
import { validateStoredRevision } from "../compendium-authoring/service.js";

/**
 * RULES-WO1 Phase C — preview of a SAVED reference Definition (Armor, a Summon engine, a Mission table or Threat Clock)
 * for sample inputs, with the same M5 / M4 code the contracts use. Reads one exact EntityVersion; writes nothing. Every
 * result says `appliesInPlay: false` — none of these families is executed yet.
 */
const invalid = (message: string) => new DomainError(CHARACTER_ERROR_CODES.INVALID_INPUT, message);

export interface ReferencePreview {
  readonly definitionKind: string;
  readonly result: Record<string, unknown>;
}

export async function previewReferenceDefinition(input: { readonly entityVersionId: unknown; readonly sample: unknown }): Promise<ReferencePreview> {
  if (typeof input.entityVersionId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.entityVersionId)) throw invalid("entityVersionId must be a UUID");
  const sample = input.sample !== null && typeof input.sample === "object" && !Array.isArray(input.sample) ? (input.sample as Record<string, unknown>) : null;
  if (sample === null) throw invalid("sample is an object");
  const int = (v: unknown, what: string, min = 0, max = 10000): number | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) throw invalid(`${what} is a whole number from ${min} to ${max}`);
    return v;
  };
  const stats: Record<string, number> = {};
  const rawStats = sample.stats;
  if (rawStats !== undefined) {
    if (rawStats === null || typeof rawStats !== "object" || Array.isArray(rawStats)) throw invalid("sample.stats is an object of Stats");
    for (const [k, v] of Object.entries(rawStats)) {
      if (!(PROWESS_STATS as readonly string[]).includes(k)) throw invalid(`unknown Stat ${JSON.stringify(k)}`);
      stats[k] = int(v, `sample.stats.${k}`, 0, 1000) as number;
    }
  }
  // The authoring service's own validation of the stored revision (M5 reader); the preview uses M5's normalized content.
  const validation = await validateStoredRevision(input.entityVersionId);
  if (validation.status !== "PASS" || validation.normalized === null) throw invalid("this revision does not hold a valid Prowess Definition; save a valid Draft first");
  const def = validation.normalized as unknown as { definitionKind: string; payload: Record<string, unknown> };
  const p = def.payload as never as Record<string, never>;
  switch (def.definitionKind) {
    case "ARMOR":
      return { definitionKind: "ARMOR", result: previewArmor({ armor: p as never, stats }) as unknown as Record<string, unknown> };
    case "SUMMON_TYPE":
      return {
        definitionKind: "SUMMON_TYPE",
        result: previewSummonCosts({ summon: p as never, tierKey: typeof sample.tierKey === "string" ? sample.tierKey : null, totalMp: int(sample.totalMp, "sample.totalMp"), stats }) as unknown as Record<string, unknown>,
      };
    case "REFERENCE_RULE":
    case "MISSION_RULE": {
      const payload = def.payload as { shape: string; rollTable: unknown; clock: unknown };
      if (payload.shape === "ROLL_TABLE") return { definitionKind: def.definitionKind, result: previewMissionTable({ table: payload.rollTable as never, roll: int(sample.roll, "sample.roll", 1, 1000) ?? 1 }) as unknown as Record<string, unknown> };
      if (payload.shape === "CLOCK") return { definitionKind: def.definitionKind, result: previewThreatClock({ clock: payload.clock as never, filled: int(sample.filled, "sample.filled", 0, 1000) ?? 0 }) as unknown as Record<string, unknown> };
      return { definitionKind: def.definitionKind, result: { appliesInPlay: false } };
    }
    default:
      throw invalid(`${def.definitionKind} has no reference preview`);
  }
}
