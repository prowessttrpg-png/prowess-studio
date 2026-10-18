// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditWo3Content } from "./m5-wo3-audit-helpers";
import { auditWo4Content } from "./m5-wo4-audit-helpers";

/**
 * Post-WO4 canon rulings audit — Size Base Movement (M5-SC-033) and the Level 9 new-Affinity Rank (M5-SC-035).
 *
 * Permanent static gate for the designer rulings applied after M5-WO4 merged. It pins the exact authored values, the
 * register history (each ruling appended, earlier text kept), the new open conflict M5-SC-036 (Massive Base Movement),
 * the invariant supersession M5-I119 → M5-I151, the new M5-I152, the documentation and the CI step. The executable
 * behaviour is guarded by the @prowess/game golden / contract tests and scripts/m5-wo4-negative-controls.mjs.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I151 a new Level 9 Affinity starts at Trained and
 * every Affinity ranks independently · M5-I152 Base Movement is authored per Creature Size, never derived from occupied
 * space; Massive pending. Historical: M5-I119 is SUPERSEDED by M5-I151 (traceable, not deleted).
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const CONTENT = "packages/prowess-game/src/content/core-playtest-v0.1";
type Doc = {
  definitions: Array<{ canonicalKey: string; definitionKind: string; payload: Record<string, unknown> }>;
  deferred?: Array<{ conflictKey: string; status?: string }>;
  designerRulings?: string[];
  revisions?: unknown[];
};
const doc = (name: string) => JSON.parse(read(`${CONTENT}/${name}.json`)) as Doc;
const section = (text: string, key: string) => text.split(/^### /m).find((s) => s.startsWith(key)) ?? "";

describe("Post-WO4 canon rulings audit — Size Base Movement & Level 9 Affinity rank", () => {
  it("M5-I152 every Creature Size authors its exact Base Movement (Small 5 · Medium 5 · Large 10 · Huge 15 ft); Massive is null pending M5-SC-036", () => {
    const sizes = doc("runtime-resources").definitions.filter((d) => d.definitionKind === "CREATURE_SIZE");
    expect(sizes.map((d) => [d.payload.sizeKey, d.payload.baseMovement])).toEqual([
      ["SMALL", { feet: 5 }],
      ["MEDIUM", { feet: 5 }],
      ["LARGE", { feet: 10 }],
      ["HUGE", { feet: 15 }],
      ["MASSIVE", null],
    ]);
    for (const d of sizes) expect((d.payload.source as { conflicts: string[] }).conflicts, String(d.payload.sizeKey)).toContain("M5-SC-033");
    expect((sizes.find((d) => d.payload.sizeKey === "MASSIVE")!.payload.source as { conflicts: string[] }).conflicts).toContain("M5-SC-036");
    const runtime = doc("runtime-resources");
    expect(runtime.designerRulings).toContain("M5-SC-033");
    expect(runtime.deferred).toEqual([{ conflictKey: "M5-SC-036", concept: "Base Movement of Massive creatures", status: "DEFERRED_PENDING_CANON" }]);
  });

  it("M5-I152 BASE_MOVEMENT reads only the character's Size Definition; MOVEMENT stays Base Movement × AGI + bonuses", () => {
    const stat = (s: string) => doc("core-resolution").definitions.find((d) => d.definitionKind === "DERIVED_STAT" && d.payload.statistic === s)!.payload;
    expect(stat("BASE_MOVEMENT").formula).toEqual({ expression: "size_base_movement", rounding: "NONE", unit: "ft", variables: [{ variable: "size_base_movement", source: { kind: "CREATURE_SIZE_BASE_MOVEMENT" } }] });
    expect((stat("BASE_MOVEMENT").source as { conflicts: string[] }).conflicts).toEqual(expect.arrayContaining(["M5-SC-033", "M5-SC-036"]));
    expect((stat("MOVEMENT").formula as { expression: string }).expression).toBe("base_movement * agi + bonuses");
    expect(read("packages/prowess-game/src/vocabulary/runtime.ts")).toContain('export const STANDARD_CREATURE_SIZE: CreatureSize = "MEDIUM";');
    expect(read("packages/prowess-game/src/definition/codes.ts")).toContain('SIZE_BASE_MOVEMENT_PENDING_CANON: "PROWESS_CORE.SIZE_BASE_MOVEMENT_PENDING_CANON"');
  });

  it("M5-I151 a new Level 9 Affinity starts at TRAINED; nothing about Affinity progression is deferred any more", () => {
    const affinity = doc("affinity");
    const prog = affinity.definitions.find((d) => d.definitionKind === "AFFINITY_PROGRESSION")!.payload as { levels: { level: number; options: Record<string, unknown>[] }[] };
    expect(prog.levels.find((l) => l.level === 9)!.options.find((o) => o.optionKey === "GAIN_NEW_AFFINITY")).toEqual({ optionKey: "GAIN_NEW_AFFINITY", action: "GAIN_AFFINITY", role: "SECONDARY", startingRank: "TRAINED", conflictKey: null });
    expect(affinity.designerRulings).toEqual(["M5-SC-001", "M5-SC-035"]);
    expect(affinity.deferred).toEqual([]);
  });

  it("the canonical content passes the amended WO3 and WO4 content rules", () => {
    expect(auditWo3Content(doc("core-resolution"), doc("runtime-resources"))).toEqual([]);
    expect(auditWo4Content(doc("affinity"), doc("core-resolution"), doc("runtime-resources"))).toEqual([]);
  });

  it("source-conflict register: M5-SC-033 and M5-SC-035 RESOLVED_BY_DESIGNER with the rulings appended (history kept); M5-SC-036 new and UNRESOLVED", () => {
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    expect(register).toMatch(/\*\*Post-WO4 canon rulings update\.\*\*/);
    const sc033 = section(register, "M5-SC-033");
    expect(sc033).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
    expect(sc033).toMatch(/M5-WO4 amendment[\s\S]*Post-WO4 designer ruling \(resolves M5-SC-033\)/);
    expect(sc033).toMatch(/SMALL\s+`\{ feet: 5 \}`[\s\S]*MEDIUM\s+`\{ feet: 5 \}`[\s\S]*LARGE `\{ feet: 10 \}`[\s\S]*HUGE `\{ feet: 15 \}`[\s\S]*MASSIVE\s+`null`/);
    const sc035 = section(register, "M5-SC-035");
    expect(sc035).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
    expect(sc035).toMatch(/recorded by M5-WO4 §48[\s\S]*Post-WO4 designer ruling \(resolves M5-SC-035\)/);
    expect(register).toMatch(/^### M5-SC-036 — Base Movement Of Massive Creatures$/m);
    expect(section(register, "M5-SC-036")).toMatch(/\*\*status\*\*: `UNRESOLVED`\n- \*\*resolution authority\*\*: none/);
  });

  it("the invariant catalog: M5-I119 SUPERSEDED by M5-I151 (kept); M5-I151 and M5-I152 are ACTIVE and guarded here", () => {
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; title: string; guards: string[]; status?: string; supersededBy?: string }>;
    expect(catalog).toHaveLength(152);
    const by = (id: string) => catalog.find((x) => x.id === id)!;
    expect([by("M5-I119").status, by("M5-I119").supersededBy]).toEqual(["SUPERSEDED", "M5-I151"]);
    for (const id of ["M5-I151", "M5-I152"]) {
      expect(by(id).status ?? "ACTIVE", id).toBe("ACTIVE");
      expect(by(id).guards, id).toContain("apps/studio/tests/unit/m5-canon-rulings-static.test.ts");
    }
    const md = read("docs/architecture/m5-invariants.md");
    expect(section(md, "M5-I119")).toMatch(/\*\*Status:\*\* SUPERSEDED by M5-I151/);
    expect(section(md, "M5-I151")).toContain("A New Level 9 Affinity Starts At Trained");
    expect(section(md, "M5-I152")).toContain("Base Movement Is Authored Per Creature Size");
  });

  it("documents the rulings: the Affinity rules doc, the WO3 runtime doc and the amendment completion note", () => {
    const affinityDoc = read("docs/architecture/m5-affinity-structured-rules.md");
    expect(affinityDoc).toContain("Post-WO4 canon rulings");
    expect(affinityDoc).toMatch(/M5-SC-036/);
    expect(read("docs/architecture/m5-runtime-resources-action-economy.md")).toContain("Post-WO4 canon rulings");
    const note = read("docs/architecture/m5-wo4-canon-rulings-completion-report.md");
    for (const heading of ["Rulings Applied", "Size Base Movement", "Level 9 New Affinity", "Remaining Conflicts", "Verification"]) expect(note, heading).toMatch(new RegExp(`^## \\d+\\. ${heading}$`, "m"));
  });

  it("the canon-rulings gate is a permanent named CI step; the M5-WO4 gate remains", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("M5 canon rulings audit — Size Base Movement & Level 9 Affinity rank");
    expect(ci).toContain("m5-canon-rulings-static.test.ts");
    expect(ci).toContain("M5-WO4 audit — Affinity identity, rank, authority & keyword alignment");
  });
});
