import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PROWESS_DEFINITION_KIND_NAMES, PROWESS_DEFINITION_KINDS } from "@prowess/game";
import { describe, expect, it } from "vitest";
import { KIND_CAPABILITIES } from "../../src/compendium-rules/capabilities";
import { getAuthoringCatalog } from "../../src/compendium-authoring/catalog";

/**
 * RULES-WO1 — the capability registry behind the entry pages' status indicators is complete and truthful:
 *   - every Definition kind has exactly one entry, and the catalog serves it;
 *   - a kind marked REFERENCE_ONLY is not read by any runtime module (play, ability, character, construction,
 *     equipment, card), except the one sanctioned reader that PROJECTS it as unavailable (the Mage Art card);
 *   - a reserved kind (no payload contract) is never claimed to be live.
 */
const GAME = path.resolve(import.meta.dirname, "../../../prowess-game/src");
const walk = (d: string): string[] => readdirSync(d).flatMap((e) => (statSync(path.join(d, e)).isDirectory() ? walk(path.join(d, e)) : [path.join(d, e)]));
const RUNTIME = ["play", "ability", "character", "construction", "equipment", "card"].flatMap((d) => walk(path.join(GAME, d))).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const SANCTIONED: Record<string, string[]> = { MAGE_ART: ["card/mage-art.ts", "card/contract.ts"] };

describe("RULES-WO1 capability registry", () => {
  it("has exactly one entry per Definition kind, served by the catalog", () => {
    expect(Object.keys(KIND_CAPABILITIES).sort()).toEqual([...PROWESS_DEFINITION_KIND_NAMES].sort());
    expect(getAuthoringCatalog().capabilities).toEqual(Object.fromEntries(PROWESS_DEFINITION_KIND_NAMES.map((k) => [k, KIND_CAPABILITIES[k]])));
  });

  it("a REFERENCE_ONLY kind is read by no runtime module and says what is not live yet", () => {
    for (const [kind, cap] of Object.entries(KIND_CAPABILITIES)) {
      if (cap.execution !== "REFERENCE_ONLY") continue;
      expect(cap.notYet, kind).not.toBe("");
      // A line that names the kind as a Definition kind (not the same word used as, e.g., a modifier target).
      const readers = RUNTIME.filter((f) => readFileSync(f, "utf8").split("\n").some((l) => l.includes(`"${kind}"`) && /kind/i.test(l))).map((f) => path.relative(GAME, f).split(path.sep).join("/"));
      expect(readers.filter((r) => !(SANCTIONED[kind] ?? []).includes(r)), kind).toEqual([]);
    }
  });

  it("the RULES-WO1 reference families are reference only (nothing executes them yet)", () => {
    for (const kind of ["ARMOR", "STATUS_CONDITION", "SUMMON_TYPE", "SUMMON_TRAIT", "MISSION_RULE", "METAMAGIC", "JOB_TEMPLATE", "REFERENCE_RULE", "MAGE_ART", "CONCENTRATION_RULE"]) expect(KIND_CAPABILITIES[kind]!.execution, kind).toBe("REFERENCE_ONLY");
  });

  it("a LIVE or PARTIAL kind names at least one consumer; reserved kinds are never live", () => {
    for (const [kind, cap] of Object.entries(KIND_CAPABILITIES)) {
      if (cap.execution !== "REFERENCE_ONLY") expect(cap.consumers.length, kind).toBeGreaterThan(0);
      if (PROWESS_DEFINITION_KINDS[kind as keyof typeof PROWESS_DEFINITION_KINDS].schemaVersions.length === 0) expect(cap.execution, kind).toBe("REFERENCE_ONLY");
    }
    expect(KIND_CAPABILITIES.CONCENTRATION_RULE!.notYet).toMatch(/do not use this rule yet/);
    expect(KIND_CAPABILITIES.CALCULATED_VALUE!.execution).toBe("PARTIAL");
  });
});
