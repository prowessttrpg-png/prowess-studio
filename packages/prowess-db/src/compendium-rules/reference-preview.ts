import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { PROWESS_STATS, previewArmor, previewMageArtScaling, previewMissionTable, previewReload, previewSummonCosts, previewSummonEconomy, previewTargetingMeasures, previewThreatClock } from "@prowess/game";
import { validateStoredRevision } from "../compendium-authoring/service.js";

/**
 * RULES-WO1 Phase C — preview of a SAVED reference Definition (Armor, a Summon engine, a Mission table or Threat Clock;
 * Phase H: a Targeting's distances)
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
        // Phase D: costs plus who acts and who pays (the action model and AP / HP / MP ownership).
        result: { ...(previewSummonCosts({ summon: p as never, tierKey: typeof sample.tierKey === "string" ? sample.tierKey : null, totalMp: int(sample.totalMp, "sample.totalMp"), stats }) as unknown as Record<string, unknown>), economy: previewSummonEconomy({ summon: p as never }) },
      };
    case "MAGE_ART": {
      // Phase D: version-2 scaling of one mode at a Level (version 1 has no structured scaling to preview).
      const modes = (def.payload as { modes?: Array<{ modeKey: string; scaling?: unknown[] }> }).modes ?? [];
      const mode = modes.find((m) => m.modeKey === sample.modeKey) ?? modes[0];
      if (mode === undefined || mode.scaling === undefined) throw invalid("this Mage Art has no structured scaling to preview (version 2 records it)");
      return { definitionKind: "MAGE_ART", result: { modeKey: mode.modeKey, ...(previewMageArtScaling({ scaling: mode.scaling as never, level: int(sample.level, "sample.level", 1, 100) ?? 1, stats }) as unknown as Record<string, unknown>) } };
    }
    case "AMMUNITION":
    case "WEAPON_MODIFICATION": {
      // Phase D: a sample weapon's Loading (X) and Reload AP with this ammunition or modification.
      const loading = int(sample.loading, "sample.loading", 0, 1000) ?? 12;
      const reloadAp = int(sample.reloadAp, "sample.reloadAp", 0, 100) ?? 3;
      const apPerTurn = int(sample.apPerTurn, "sample.apPerTurn", 1, 100) ?? 3;
      const payload = def.payload as { perAttack?: number; burstPerAttack?: number | null; changes?: Array<{ kind: string; amount: number | null }> };
      return {
        definitionKind: def.definitionKind,
        result: previewReload({ loading, reloadAp, apPerTurn, ammunition: def.definitionKind === "AMMUNITION" ? { perAttack: payload.perAttack ?? 1, burstPerAttack: payload.burstPerAttack ?? null } : null, modifications: def.definitionKind === "WEAPON_MODIFICATION" ? [{ changes: payload.changes ?? [] }] : [] }) as unknown as Record<string, unknown>,
      };
    }
    case "REFERENCE_RULE":
    case "MISSION_RULE": {
      const payload = def.payload as { shape: string; rollTable: unknown; clock: unknown };
      if (payload.shape === "ROLL_TABLE") return { definitionKind: def.definitionKind, result: previewMissionTable({ table: payload.rollTable as never, roll: int(sample.roll, "sample.roll", 1, 1000) ?? 1 }) as unknown as Record<string, unknown> };
      if (payload.shape === "CLOCK") return { definitionKind: def.definitionKind, result: previewThreatClock({ clock: payload.clock as never, filled: int(sample.filled, "sample.filled", 0, 1000) ?? 0 }) as unknown as Record<string, unknown> };
      return { definitionKind: def.definitionKind, result: { appliesInPlay: false } };
    }
    case "SPELL_TARGETING":
    case "MANEUVER_TARGETING": {
      // RULES-WO1 Phase H: the distances a Targeting states for a sample (the same Formula, rank-table row and default
      // choices the builders bind; the result says so and is not marked "reference only").
      const record = (v: unknown, what: string): Record<string, unknown> => {
        if (v === undefined) return {};
        if (v === null || typeof v !== "object" || Array.isArray(v)) throw invalid(`${what} is an object`);
        return v as Record<string, unknown>;
      };
      const ranks: Record<string, string> = {};
      for (const [k, v] of Object.entries(record(sample.ranks, "sample.ranks"))) {
        if (typeof v !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(v)) throw invalid(`sample.ranks.${k} is a rank`);
        ranks[k] = v;
      }
      const parameters: Record<string, number> = {};
      for (const [k, v] of Object.entries(record(sample.parameters, "sample.parameters"))) parameters[k] = int(v, `sample.parameters.${k}`, 0, 1000) as number;
      const derived: Record<string, number> = {};
      for (const [k, v] of Object.entries(record(sample.derived, "sample.derived"))) derived[k] = int(v, `sample.derived.${k}`, 0, 100000) as number;
      const payload = def.payload as { semanticShape?: string; rules?: { targeting?: unknown } };
      if (payload.rules?.targeting === undefined) throw invalid("this Targeting has no structured distances to preview");
      const result = previewTargetingMeasures({ targeting: payload.rules.targeting, shape: payload.semanticShape ?? "", branch: def.definitionKind === "SPELL_TARGETING" ? "SPELL" : "MANEUVER", stats, ranks, parameters, derived });
      if (!result.ok) throw invalid(`this Targeting cannot be previewed: ${result.problems.join("; ")}`);
      return { definitionKind: def.definitionKind, result: result as unknown as Record<string, unknown> };
    }
    default:
      throw invalid(`${def.definitionKind} has no reference preview`);
  }
}
