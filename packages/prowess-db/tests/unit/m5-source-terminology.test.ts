import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalSourceStructureJson } from "@prowess/model";
import { parseDocxStructure } from "../../src/source-ingestion/docx/parse";
import { buildDocx } from "../fixtures/docx-builder";

/**
 * M5-WO1 §8, §161, §219 — historical source wording is preserved verbatim. The Core Playtest says "Emission" where the
 * designer has ruled the canonical Affinity is Evocation; the M3 source pipeline must keep "Emission" exactly as written
 * (provenance), while canonical structured M5 content uses EVOCATION. Guards M5-I037 and M5-I018 / M5-I019 at the
 * source boundary: no normalization, rewrite or alias substitution happens during ingestion.
 */
const LEGACY_PROSE = "Emission Affinity: Emission spells project raw force outward.";
const fixture = () =>
  buildDocx({
    blocks: [
      { kind: "heading", level: 1, text: "AFFINITIES" },
      { kind: "heading", level: 2, text: "EMISSION" },
      { kind: "p", text: LEGACY_PROSE },
      { kind: "table", headerRows: 1, rows: [["Affinity", "Strength"], ["Emission", "Damage"]] },
    ],
  });

const texts = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(texts);
  return [];
};

describe("M5-WO1 legacy source terminology is preserved verbatim", () => {
  it("the parsed SourceDocument structure keeps 'Emission' and never introduces 'Evocation'", () => {
    const parsed = parseDocxStructure(fixture()).structure;
    const all = texts(parsed).join("\n");
    expect(all).toContain(LEGACY_PROSE);
    expect(all).toContain("EMISSION");
    expect(all.match(/Emission/g)?.length).toBeGreaterThanOrEqual(3);
    expect(all).not.toMatch(/evocation/i);
  });

  it("re-parsing the same bytes reproduces the identical structure hash (no normalization pass exists)", () => {
    const bytes = fixture();
    const hash = (b: Buffer) => createHash("sha256").update(canonicalSourceStructureJson(parseDocxStructure(b).structure)).digest("hex");
    expect(hash(bytes)).toBe(hash(Buffer.from(bytes)));
  });
});
