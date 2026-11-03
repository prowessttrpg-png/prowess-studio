import { describe, expect, it } from "vitest";
import { compileAbilityDefinition, evaluateAbilityDefinition } from "./ability/compile.js";
import { compileAbilityExecution } from "./ability/effect-execution.js";
import { compileManeuverCost, evaluateManeuverCost } from "./ability/maneuver-cost.js";
import { compileSpellCost, evaluateSpellCost } from "./ability/spell-cost.js";
import { executionFixture } from "./testing/effect-execution-fixtures.js";
import { maneuverCostFixture } from "./testing/maneuver-cost-fixtures.js";
import { spellCostFixture } from "./testing/spell-cost-fixtures.js";
import baseline from "./testing/m6-wo7-m5-characterization.json";

/**
 * PAS-10 M6-WO7 §104, §107–§108, §161, M6-I096 — permanent M5 characterization of the additive core refactor of
 * ability/compile.ts, ability/spell-cost.ts and ability/effect-execution.ts (compileAuthoredAbilityCore,
 * compileSpellCostCore, compileExecutionCore). The stored digests were produced by THIS file run against the M6-WO6
 * merge base (28bcfae) — before any WO7 change — over every authored Spell and Maneuver of the M5-WO10 / WO11 / WO12
 * golden worlds: compiled plan, evaluated result, compiled and evaluated cost, and the compiled execution plan. Any
 * change to an M5 output (a plan step, a source-map entry, a cost, a provenance) changes a digest and fails here.
 */

/** A stable 64-bit FNV-1a digest of the exact JSON (no environment, no randomness). */
function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) h = BigInt.asUintN(64, (h ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0");
}

function rows(): Record<string, string> {
  const out: Record<string, string> = {};
  const spells = spellCostFixture();
  for (const d of spells.bundle.definitions.filter((x) => x.definitionKind === "SPELL_DEFINITION")) {
    const r = spells.request(d.canonicalKey);
    out[`spell-cost/${d.canonicalKey}/compile`] = digest(compileAbilityDefinition(r));
    out[`spell-cost/${d.canonicalKey}/evaluate`] = digest(evaluateAbilityDefinition(r));
    out[`spell-cost/${d.canonicalKey}/cost-plan`] = digest(compileSpellCost(r));
    out[`spell-cost/${d.canonicalKey}/cost`] = digest(evaluateSpellCost(r));
  }
  const maneuvers = maneuverCostFixture();
  for (const d of maneuvers.bundle.definitions.filter((x) => x.definitionKind === "MANEUVER_DEFINITION")) {
    for (const signature of [false, true]) {
      const r = maneuvers.request(d.canonicalKey, signature);
      const k = `maneuver-cost/${d.canonicalKey}/${signature ? "signature" : "ordinary"}`;
      out[`${k}/compile`] = digest(compileAbilityDefinition(r));
      out[`${k}/evaluate`] = digest(evaluateAbilityDefinition(r));
      out[`${k}/cost-plan`] = digest(compileManeuverCost(r));
      out[`${k}/cost`] = digest(evaluateManeuverCost(r));
    }
  }
  const execution = executionFixture();
  for (const d of execution.bundle.definitions.filter((x) => (x.definitionKind === "SPELL_DEFINITION" || x.definitionKind === "MANEUVER_DEFINITION") && x.canonicalKey.startsWith("fixture.wo12."))) {
    out[`execution/${d.canonicalKey}/plan`] = digest(compileAbilityExecution(execution.ability(d.canonicalKey)));
  }
  return out;
}

describe("M6-WO7 permanent M5 characterization (M6-I096: reuse, never redefine)", { timeout: 300_000 }, () => {
  const now = rows();
  // Regeneration (only ever against the merge base): PROWESS_WO7_CHARACTERIZE=print prints the digests.
  const g = globalThis as { process?: { env?: Record<string, string | undefined> }; console?: { log: (s: string) => void } };
  if (g.process?.env?.PROWESS_WO7_CHARACTERIZE === "print") g.console?.log(`WO7-CHARACTERIZATION ${JSON.stringify(now)}`);

  it("covers every golden Spell, Maneuver and execution plan", () => {
    expect(Object.keys(baseline.digests).length).toBeGreaterThanOrEqual(150);
    expect(Object.keys(now).sort()).toEqual(Object.keys(baseline.digests).sort());
  });
  it.each(Object.keys(baseline.digests))("%s is byte-identical to the M6-WO6 base", (key) => {
    expect(now[key]).toBe((baseline.digests as Record<string, string>)[key]);
  });
});
