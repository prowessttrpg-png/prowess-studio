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
 * every Affinity ranks independently · M5-I153 Arcane Rank is the Arcana Skill's rank; Arcana Rank is its legacy name
 * (M5-SC-011) · M5-I154 Size Base Movement Small 5 · Medium 5 · Large 10 · Huge 20 · Massive 40 ft · M5-I155 percentage
 * cost modifiers net into one percentage applied once; final rounding normal, once, at the end.
 * Historical: M5-I119 → M5-I151, M5-I128 → M5-I155, M5-I152 → M5-I154 (traceable, not deleted). The rulings batch also
 * resolves M5-SC-007 and M5-SC-013 – M5-SC-031 and records the follow-ups M5-SC-037 / M5-SC-038.
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
  it("M5-I154 every Creature Size authors its exact Base Movement (Small 5 · Medium 5 · Large 10 · Huge 20 · Massive 40 ft); nothing is deferred", () => {
    const sizes = doc("runtime-resources").definitions.filter((d) => d.definitionKind === "CREATURE_SIZE");
    expect(sizes.map((d) => [d.payload.sizeKey, d.payload.baseMovement])).toEqual([
      ["SMALL", { feet: 5 }],
      ["MEDIUM", { feet: 5 }],
      ["LARGE", { feet: 10 }],
      ["HUGE", { feet: 20 }],
      ["MASSIVE", { feet: 40 }],
    ]);
    for (const d of sizes) expect((d.payload.source as { conflicts: string[] }).conflicts, String(d.payload.sizeKey)).toContain("M5-SC-033");
    expect((sizes.find((d) => d.payload.sizeKey === "MASSIVE")!.payload.source as { conflicts: string[] }).conflicts).toContain("M5-SC-036");
    const runtime = doc("runtime-resources");
    expect(runtime.designerRulings).toEqual(expect.arrayContaining(["M5-SC-033", "M5-SC-036"]));
    expect(runtime.deferred).toEqual([]);
  });

  it("M5-I154 BASE_MOVEMENT reads only the character's Size Definition; MOVEMENT stays Base Movement × AGI + bonuses", () => {
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

  it("source-conflict register: M5-SC-033 and M5-SC-035 RESOLVED_BY_DESIGNER with the rulings appended (history kept); M5-SC-036 recorded, then resolved by the rulings batch", () => {
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
    expect(section(register, "M5-SC-036")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`[\s\S]*Rulings batch \(post-WO4, resolves M5-SC-036\)[\s\S]*Huge Base Movement is 20 ft[\s\S]*40 ft/);
    expect(sc033).toMatch(/Amended by the rulings batch \(M5-SC-036\)/);
  });

  it("M5-I153 / M5-SC-011 ruling: Arcane Rank is the Arcana Skill's rank — CANONICAL; Arcana Rank is its LEGACY name; the register keeps the history", () => {
    const terms = read("packages/prowess-game/src/vocabulary/terminology.ts");
    expect(terms).toContain('entry("Arcane Rank", "SKILL_RANK", C, "SKILL", "ARCANE_RANK", { ...designer, conflictKey: "M5-SC-011" })');
    expect(terms).toContain('entry("Arcana Rank", "SKILL_RANK", L, "SKILL", null, { ...designer, canonicalTerm: "Arcane Rank", conflictKey: "M5-SC-011" })');
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    expect(register).toMatch(/\*\*Post-WO4 Arcane ruling update\.\*\*/);
    expect(section(register, "M5-SC-011")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`[\s\S]*Post-WO4 designer ruling \(resolves M5-SC-011\)/);
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; guards: string[]; status?: string }>;
    const i153 = catalog.find((x) => x.id === "M5-I153")!;
    expect(i153.status ?? "ACTIVE").toBe("ACTIVE");
    expect(i153.guards).toContain("apps/studio/tests/unit/m5-canon-rulings-static.test.ts");
    expect(section(read("docs/architecture/m5-invariants.md"), "M5-I153")).toContain("Arcane Rank Is The Arcana Skill's Rank");
    expect(read("docs/architecture/m5-wo4-canon-rulings-completion-report.md")).toMatch(/^## \d+\. Arcane Rank$/m);
  });

  it("rulings batch: every conflict open after M5-WO4 is RESOLVED_BY_DESIGNER with its ruling appended; the follow-ups M5-SC-037 / M5-SC-038 are resolved too — nothing is open", () => {
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    expect(register).toMatch(/\*\*Post-WO4 rulings batch\.\*\*/);
    const batch = ["007", ...Array.from({ length: 19 }, (_, i) => String(13 + i).padStart(3, "0")), "036"].map((n) => `M5-SC-${n}`);
    for (const key of batch) {
      const sec = section(register, key);
      expect(sec, key).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
      expect(sec, key).toMatch(/\*\*source A\*\*:[\s\S]*\*\*source B\*\*:/); // provenance kept
      expect(sec, key).toContain(`Rulings batch (post-WO4, resolves ${key})`);
    }
    // M5-WO6 opened exactly two new conflicts (Projectile base MP, Spell Line width); every earlier one stays resolved.
    expect(register.split(/^### /m).filter((x) => /\*\*status\*\*: `UNRESOLVED`/.test(x)).map((x) => x.slice(0, 9))).toEqual(["M5-SC-039", "M5-SC-040"]);
    expect(section(register, "M5-SC-037")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`[\s\S]*Follow-up ruling \(resolves M5-SC-037\)[\s\S]*Counter\s+Spelling/);
    expect(section(register, "M5-SC-038")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`[\s\S]*Follow-up ruling \(resolves M5-SC-038\)[\s\S]*1 Active Effect per 2 CON[\s\S]*base of 1/);
    expect(register).toMatch(/^### M5-SC-037 — Place Of Spell Interference Among The Spell Branches$/m);
    expect(register).toMatch(/^### M5-SC-038 — Active Effects Capacity And The Concentration Base$/m);
  });

  it("M5-I155 / M5-SC-028 ruling: Affinity percentages net into one percentage applied once; final rounding is normal, once, at the end", () => {
    const sc028 = section(read("docs/architecture/m5-core-playtest-source-conflicts.md"), "M5-SC-028");
    expect(sc028).toMatch(/rounds normally[\s\S]*one net percentage[\s\S]*18 MP/);
    const compile = read("packages/prowess-game/src/affinity/compile.ts");
    expect(compile).toContain('fragmentKey: "net-percent"');
    expect(compile).toContain("const FULL_PRICE_PERCENT = 100;");
    expect(compile).not.toMatch(/REDUCE_PERCENT|INCREASE_PERCENT/); // the superseded sequential model (M5-I128)
    expect(compile).not.toMatch(/Math\.(round|floor|ceil)|toFixed/); // the Affinity stage never rounds (M5-I129)
  });

  it("the invariant catalog: M5-I119 → M5-I151, M5-I128 → M5-I155, M5-I152 → M5-I154 SUPERSEDED (kept); M5-I151 and M5-I153–I155 are ACTIVE and guarded here", () => {
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; title: string; guards: string[]; status?: string; supersededBy?: string }>;
    expect(catalog).toHaveLength(178); // M5-WO5 appended M5-I156–I158, M5-WO6 M5-I159–I178
    const by = (id: string) => catalog.find((x) => x.id === id)!;
    expect([by("M5-I119").status, by("M5-I119").supersededBy]).toEqual(["SUPERSEDED", "M5-I151"]);
    expect([by("M5-I128").status, by("M5-I128").supersededBy]).toEqual(["SUPERSEDED", "M5-I155"]);
    expect([by("M5-I152").status, by("M5-I152").supersededBy]).toEqual(["SUPERSEDED", "M5-I154"]);
    for (const id of ["M5-I151", "M5-I153", "M5-I154", "M5-I155"]) {
      expect(by(id).status ?? "ACTIVE", id).toBe("ACTIVE");
      expect(by(id).guards, id).toContain("apps/studio/tests/unit/m5-canon-rulings-static.test.ts");
    }
    const md = read("docs/architecture/m5-invariants.md");
    expect(section(md, "M5-I119")).toMatch(/\*\*Status:\*\* SUPERSEDED by M5-I151/);
    expect(section(md, "M5-I151")).toContain("A New Level 9 Affinity Starts At Trained");
    expect(section(md, "M5-I152")).toMatch(/\*\*Status:\*\* SUPERSEDED by M5-I154/);
    expect(section(md, "M5-I154")).toContain("Huge 20, Massive 40 Feet");
    expect(section(md, "M5-I155")).toContain("One Net Percentage Applied Once");
  });

  it("documents the rulings: the Affinity rules doc, the WO3 runtime doc and the amendment completion note", () => {
    const affinityDoc = read("docs/architecture/m5-affinity-structured-rules.md");
    expect(affinityDoc).toContain("Post-WO4 canon rulings");
    expect(affinityDoc).toMatch(/M5-SC-036/);
    expect(affinityDoc).toContain("Post-WO4 rulings batch");
    expect(read("docs/architecture/m5-runtime-resources-action-economy.md")).toContain("Post-WO4 canon rulings");
    const note = read("docs/architecture/m5-wo4-canon-rulings-completion-report.md");
    for (const heading of ["Rulings Applied", "Size Base Movement", "Level 9 New Affinity", "Remaining Conflicts", "Arcane Rank", "Rulings Batch", "Verification"]) expect(note, heading).toMatch(new RegExp(`^## \\d+\\. ${heading}$`, "m"));
  });

  it("the canon-rulings gate is a permanent named CI step; the M5-WO4 gate remains", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("M5 canon rulings audit — Size Base Movement & Level 9 Affinity rank");
    expect(ci).toContain("m5-canon-rulings-static.test.ts");
    expect(ci).toContain("M5-WO4 audit — Affinity identity, rank, authority & keyword alignment");
  });
});
