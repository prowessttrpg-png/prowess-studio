// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withLaterMilestoneRoutes } from "./later-milestone-routes";
import { auditStudioGeometry, auditWo6Content, auditWo6Source, type TargetingDoc } from "./m5-wo6-audit-helpers";

/**
 * M5-WO6 audit — Targeting framework, geometry & branch catalogs (PAS-10 M5-WO6 §173, §210).
 *
 * Permanent static gate over the Targeting modules of @prowess/game, the canonical Targeting content, Studio UI code, the
 * frozen @prowess/rules engine, the conflict register, terminology, invariant catalog, documentation and CI. In-memory
 * controls append forbidden code to REAL source snapshots (or mutate a copy of the content) and require the matching
 * rule to fire. Behavioural controls that mutate files on disk live in scripts/m5-wo6-negative-controls.mjs.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I159 Targeting never decides outcome · M5-I160 no
 * Attack / Save selection · M5-I161 one Targeting slot shared by every Effect · M5-I162 distinct Spell / Maneuver families
 * · M5-I163 Projectile canonical, base MP deferred (M5-SC-039) · M5-I164 Trigger / Glyph-Anchor are add-ons · M5-I165
 * default Spell Range 15 × PER · M5-I166 range ≠ area · M5-I167 Line length 15 × PRO, width deferred (M5-SC-040) ·
 * M5-I168 Cone 10 × PRO · M5-I169 Radius / Zone / Aura 5 × PRO · M5-I170 no +3 MP radius expansion; Widen Area is a Trait
 * · M5-I171 exact compatibility · M5-I172 Conversion owns cost / Save · M5-I173 Maneuver Radius RankBase × STR · M5-I174
 * no STR-band table · M5-I175 geometry through M4 Formula only · M5-I176 provenance · M5-I177 no final cost / payment ·
 * M5-I178 deterministic, immutable, JSON-safe, stateless.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const walk = (dir: string): string[] =>
  existsSync(path.join(ROOT, dir))
    ? readdirSync(path.join(ROOT, dir))
        .filter((n) => !["node_modules", "dist", ".next", "generated"].includes(n))
        .flatMap((n) => {
          const f = `${dir}/${n}`;
          return statSync(path.join(ROOT, f)).isDirectory() ? walk(f) : [f];
        })
    : [];
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const G = (f: string) => `packages/prowess-game/src/${f}`;
const MODULES = [G("targeting/compile.ts"), G("definition/targeting-payload.ts"), G("vocabulary/targeting.ts")];
const CONTENT = G("content/core-playtest-v0.1/targeting.json");
const content = () => JSON.parse(read(CONTENT)) as TargetingDoc;
const section = (doc: string, key: string) => doc.split(/^### /m).find((s) => s.startsWith(key)) ?? "";
const STUDIO = [...walk("apps/studio/app"), ...walk("apps/studio/src")].filter((f) => /\.(ts|tsx)$/.test(f));

export const WO6_DOC = "docs/architecture/m5-targeting-framework.md";
export const WO6_DOC_SECTIONS = [
  "Scope",
  "Source Authority",
  "Targeting vs Effect",
  "One Targeting Rule",
  "Branch Separation",
  "Shared Geometry",
  "Spell Targeting Catalog",
  "Projectile Canon",
  "M5-SC-039",
  "Trigger / Glyph Add-On Correction",
  "Spell Range",
  "Range vs Area",
  "Self",
  "Touch",
  "Single Target",
  "Multi-Target",
  "Projectile",
  "Line",
  "M5-SC-040",
  "Cone",
  "Radius",
  "Zone",
  "Aura",
  "Targeting Scaling",
  "Widen Area Boundary",
  "Line of Sight",
  "Line of Effect",
  "Cover",
  "Compatibility",
  "Maneuver Targeting",
  "Targeting Conversion Boundary",
  "Maneuver Radius",
  "M4 Mapping",
  "Provenance",
  "Historical Releases",
  "Deferred Systems",
];

describe("M5-WO6 audit — Targeting framework, geometry & branch catalogs", () => {
  it("covers the WO6 Targeting modules, content, fixtures and tests", () => {
    for (const f of [...MODULES, CONTENT, G("targeting-golden.test.ts"), G("targeting-contracts.test.ts"), G("testing/targeting-fixtures.ts")]) expect(existsSync(path.join(ROOT, f)), f).toBe(true);
  });

  it.each(MODULES)("%s passes the WO6 rules (no resolution, rank token, name inference, fuzzy compatibility, geometry math, add-on base, final cost, latest lookup, global state)", (file) => {
    expect(auditWo6Source(read(file), file)).toEqual([]);
  });

  it("canonical Targeting content passes every WO6 rule (M5-I159–I174)", () => {
    expect(auditWo6Content(content())).toEqual([]);
  });

  it("§189 / M5-I175 Studio UI code computes no Targeting geometry and never imports @prowess/game", () => {
    expect(STUDIO.length).toBeGreaterThan(10);
    for (const f of STUDIO) {
      expect(auditStudioGeometry(read(f)), f).toEqual([]);
      expect(read(f), f).not.toMatch(/@prowess\/game/);
    }
  });

  it("M4 is byte-identical to the WO2 baseline; no schema change, migration or endpoint; @prowess/game stays pure", () => {
    const wo2 = JSON.parse(read("docs/architecture/m5-wo2-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number };
    const wo6 = JSON.parse(read("docs/architecture/m5-wo6-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number; baseCommit: string; apiRoutes: string[] };
    const files = walk("packages/prowess-rules/src").sort();
    const tree = createHash("sha256");
    for (const f of files) tree.update(`${f}\n${hash(readFileSync(path.join(ROOT, f)))}\n`);
    expect([files.length, tree.digest("hex")]).toEqual([wo2.rulesSrcFileCount, wo2.rulesSrcTreeHash]);
    expect([wo6.rulesSrcFileCount, wo6.rulesSrcTreeHash]).toEqual([wo2.rulesSrcFileCount, wo2.rulesSrcTreeHash]);
    expect(wo6.baseCommit).toBe("7784751c876cf42dec91108af8717a01f2e8e634");
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(withLaterMilestoneRoutes(wo6.apiRoutes));
    const wo1 = JSON.parse(read("docs/architecture/m5-wo1-baseline.json")) as { schemaHash: string; migrations: Record<string, string> };
    expect(hash(read("packages/prowess-db/prisma/schema.prisma"))).toBe(wo1.schemaHash);
    expect(Object.fromEntries(walk("packages/prowess-db/prisma/migrations").filter((f) => f.endsWith("migration.sql")).map((f) => [f, hash(read(f))]))).toEqual(wo1.migrations);
    expect(Object.keys((JSON.parse(read("packages/prowess-game/package.json")) as { dependencies: Record<string, string> }).dependencies).sort()).toEqual(["@prowess/model", "@prowess/rules"]);
  });

  it("Targeting compiles into M4 FORMULA / REQUIREMENT / KEYWORD only and reuses the WO2 BASE_RANGE statistic", () => {
    const compile = read(G("targeting/compile.ts"));
    expect(new Set([...compile.matchAll(/operation: "([A-Z_]+)"/g)].map((m) => m[1]))).toEqual(new Set(["FORMULA", "REQUIREMENT", "KEYWORD"]));
    expect(compile).toContain("assembleFragments(");
    expect(compile).toContain("core.derived[statistic]");
    expect(compile).not.toMatch(/\bMODIFIER\b|\bRESOURCE\b|\bVALIDATION\b/);
    const content = read(CONTENT);
    expect(content).toContain('"statistic": "BASE_RANGE"');
  });

  it("M5-I164 the add-on vocabulary exists; TRIGGERED / ANCHOR stay readable but are refused as executable base Targeting", () => {
    const vocabulary = read(G("vocabulary/targeting.ts"));
    expect(vocabulary).toMatch(/TARGETING_ADD_ONS = deepFreeze\(\["TRIGGER", "ANCHOR"\] as const\)/);
    expect(read(G("vocabulary/construction.ts"))).toMatch(/"PROJECTILE",[\s\S]*"TRIGGERED",\s*\n\s*"ANCHOR",/);
    expect(read(G("definition/targeting-payload.ts"))).toContain("T.TARGETING_ADD_ON_AS_BASE");
    expect(read(G("targeting/compile.ts"))).toContain("T.TARGETING_ADD_ON_AS_BASE");
  });

  it("source-conflict register preserves the WO6 evidence for M5-SC-039 / M5-SC-040 and records their later designer resolutions", () => {
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    expect(register).toMatch(/^### M5-SC-039 — Projectile Base MP Cost$/m);
    expect(register).toMatch(/^### M5-SC-040 — Spell Line Width Rounding \/ Minimum$/m);
    for (const key of ["M5-SC-039", "M5-SC-040"])
      expect(section(register, key), key).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`\n- \*\*resolution authority\*\*: M5-WO7 post-WO6 designer ruling/);
    expect(section(register, "M5-SC-039")).toMatch(/Chapter Book lists Projectile at 2 MP\. That value is not Core Playtest canon/);
    expect(section(register, "M5-SC-039")).toContain("Projectile Targeting costs exactly **3 MP**");
    expect(section(register, "M5-SC-040")).toContain("5 ft wide per 2 Prowess");
    expect(section(register, "M5-SC-040")).toContain("10 ft × PRO");
    expect(section(register, "M5-SC-040")).toContain("5 ft × ceil(PRO / 2)");
    expect(section(register, "M5-SC-029")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`[\s\S]*ADD-ONS to a Targeting Type/);
    expect(section(register, "M5-SC-024")).toMatch(/Widen Area at \+6 MP/);
    expect(section(register, "M5-SC-018")).toMatch(/Radius = Martial Rank Base × STR/);
    expect(register).toMatch(/\*\*M5-WO6 update\.\*\*/);
  });

  it("terminology: Projectile is CANONICAL Spell Targeting; Trigger-Based and Glyph / Anchor are Targeting ADD-ONS with M5-SC-029 provenance", () => {
    const t = read(G("vocabulary/terminology.ts"));
    expect(t).toMatch(/entry\("Projectile", "TARGETING_SHAPE", C, "SPELL", "PROJECTILE", \{ \.\.\.designer, conflictKey: "M5-SC-016" \}\)/);
    expect(t).toMatch(/entry\("Trigger-Based", "TARGETING_ADD_ON", C, "SPELL", "TRIGGER", \{ \.\.\.designer, conflictKey: "M5-SC-029" \}\)/);
    expect(t).toMatch(/entry\("Glyph \/ Anchor", "TARGETING_ADD_ON", C, "SPELL", "ANCHOR", \{ \.\.\.designer, conflictKey: "M5-SC-029" \}\)/);
    expect(t).toMatch(/Historical provenance: WO1–WO5 classified them as TARGETING_SHAPE/);
  });

  it("the invariant catalog preserves M5-I001–I178 exactly once; M5-I159–I178 retain WO6 guards and explicit supersession state", () => {
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; title: string; guards: string[]; status?: string }>;
    expect(catalog.length).toBeGreaterThanOrEqual(178);
    expect(catalog.slice(0, 178).map((x) => x.id)).toEqual(Array.from({ length: 178 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m5-invariants.md");
    const self = read("apps/studio/tests/unit/m5-wo6-static.test.ts");
    for (const entry of catalog.slice(158, 178)) {
      expect(entry.status ?? "ACTIVE", entry.id).toBe(["M5-I160", "M5-I163", "M5-I167"].includes(entry.id) ? "SUPERSEDED" : "ACTIVE");
      expect(entry.guards, entry.id).toEqual(expect.arrayContaining(["apps/studio/tests/unit/m5-wo6-static.test.ts", "scripts/m5-wo6-negative-controls.mjs"]));
      for (const guard of entry.guards) {
        expect(existsSync(path.join(ROOT, guard)), guard).toBe(true);
        if (guard.endsWith(".test.ts")) expect(read(guard), `${entry.id} → ${guard}`).toContain(entry.id);
      }
      expect(section(md, entry.id)).toContain(entry.title);
      expect(self).toContain(entry.id);
    }
    expect(catalog[158]?.title).toMatch(/^Targeting Determines Range, Area, Target Count/);
    expect(catalog[177]?.title).toMatch(/^Targeting Evaluation Is Deterministic/);
  });

  it("documentation: m5-targeting-framework.md has the 36 required sections and the five required diagrams", () => {
    const doc = read(WO6_DOC);
    expect([...doc.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]])).toEqual(WO6_DOC_SECTIONS.map((s, i) => [i + 1, s]));
    for (const line of ["Exact Branch Targeting Definition", "Range = 15 × PER", "Spell Radius   Maneuver Radius", "references destination Targeting", "Neither Add-On replaces the base Targeting Type."]) expect(doc, line).toContain(line);
    for (const id of ["M5-I159", "M5-I163", "M5-I164", "M5-I166", "M5-I172", "M5-I175"]) expect(doc).toContain(id);
    expect(read("docs/architecture/m5-wo6-completion-report.md")).toContain("WORK ORDER READY FOR CI VERIFICATION — M5-WO6");
  });

  it("CI: one permanent named WO6 gate after the WO5 gate, running every WO6 guard; no gate removed", () => {
    const ci = read(".github/workflows/ci.yml");
    const names = [...ci.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1] ?? "");
    const wo6 = names.indexOf("M5-WO6 audit — Targeting framework, geometry & branch catalogs");
    expect(wo6).toBeGreaterThan(names.indexOf("M5-WO5 audit — Shared modular ability construction"));
    expect(names.indexOf("M5-WO5 audit — Shared modular ability construction")).toBeGreaterThan(names.indexOf("M5 canon rulings audit — Size Base Movement & Level 9 Affinity rank"));
    const step = ci.slice(ci.indexOf("- name: M5-WO6 audit"), ci.indexOf("- name:", ci.indexOf("- name: M5-WO6 audit") + 10));
    for (const cmd of ["src/targeting-golden.test.ts", "src/targeting-contracts.test.ts", "tests/unit/m5-wo6-static.test.ts", "tests/unit/m5-wo6-inspector-fixture.test.ts", "tests/integration/prowess-targeting-history.test.ts", "tests/integration/m5-wo6-targeting-api.test.ts", "node scripts/m5-wo6-negative-controls.mjs"]) expect(step, cmd).toContain(cmd);
    for (const gate of ["M5-WO1 audit", "M5-WO2 audit", "M5-WO3 audit", "M5-WO4 audit", "M5-WO5 audit", "M4-WO12 final audit"]) expect(names.some((n) => n.startsWith(gate)), gate).toBe(true);
    expect(read("docs/architecture/ci.md")).toContain("M5-WO6 audit — Targeting framework, geometry & branch catalogs");
  });
});

describe("M5-WO6 in-memory controls — each forbidden pattern fires its rule", () => {
  const compile = read(G("targeting/compile.ts"));
  const C = G("targeting/compile.ts");
  it.each([
    ["Targeting selecting a Save Stat", 'export const radiusSave = () => ({ stat: "AGI" });', "targeting-resolution"],
    ["Single Target emitting an Attack Roll", 'export const mode = "ATTACK_ROLL";', "targeting-resolution"],
    ["a saveProfile on Targeting", "export const saveProfile = [];", "targeting-resolution"],
    ["compatibility by name substring", 'export const fits = (name: string) => name.includes("Radius");', "fuzzy-compatibility"],
    ["case-folded compatibility", 'export const fits = (name: string, t: string) => name.toLowerCase().includes(t);', "fuzzy-compatibility"],
    ["a canonical Trigger base Targeting key", 'export const trigger = "spell.targeting.trigger_based";', "add-on-as-base"],
    ["geometry arithmetic in code (range as radius)", "export const radius = (range: number) => range / 3;", "hidden-math"],
    ["a geometry Formula authored in code", 'export const f = { expression: "5 * pro" };', "formula-in-code"],
    ["a Martial rank-base switch", 'export const base = (rank: string) => (rank === "EXPERT" ? 10 : 5);', "rank-token-in-code"],
    ["the newest Targeting Definition", "export const getLatestTargeting = () => null;", "latest-or-current"],
    ["a final Spell MP total", "export const totalMp = 0;", "final-cost"],
    ["module-level mutable Targeting state", "export let lastTargeting: unknown = null;", "global-state"],
  ])("%s", (_label, snippet, rule) => {
    expect(auditWo6Source(`${compile}\n${snippet}\n`, C)).toContain(rule);
  });

  it("§189 Radius computed in Studio UI code", () => {
    expect(auditStudioGeometry("export const radius = pro * 5;")).toContain("ui-geometry-math");
    expect(auditStudioGeometry("const spellRange = 15 * perception;")).toContain("ui-geometry-math");
  });

  const mutate = (edit: (d: TargetingDoc) => void) => {
    const d = content();
    edit(d);
    return auditWo6Content(d);
  };
  const def = (d: TargetingDoc, key: string) => d.definitions.find((x) => x.canonicalKey === key)!;
  it.each([
    ["Save Stat on Spell Radius (§174)", (d: TargetingDoc) => void (def(d, "spell.targeting.radius").payload.rules.targeting.saveStat = "AGI"), "targeting-resolution"],
    ["Projectile collapsed into Single Target (§176)", (d: TargetingDoc) => void (def(d, "spell.targeting.projectile").payload.semanticShape = "SINGLE_TARGET"), "spell-catalog"],
    ["Projectile 2 MP from the Chapter Book (§177)", (d: TargetingDoc) => void (def(d, "spell.targeting.projectile").payload.costContributions[0] = { contributionKey: "targeting.base", currency: "MP", data: { kind: "BASE", amount: 2 } }), "projectile-cost-guess"],
    ["a canonical Trigger-Based base Targeting (§178)", (d: TargetingDoc) => void d.definitions.push({ ...def(d, "spell.targeting.single_target"), canonicalKey: "spell.targeting.trigger_based" }), "add-on-as-base"],
    ["a canonical Glyph / Anchor base Targeting (§179)", (d: TargetingDoc) => void d.definitions.push({ ...def(d, "spell.targeting.zone"), canonicalKey: "spell.targeting.glyph" }), "add-on-as-base"],
    ["the old +10 ft Radius → +3 MP expansion (§180)", (d: TargetingDoc) => void def(d, "spell.targeting.radius").payload.costContributions.push({ contributionKey: "targeting.radius_extension", currency: "MP", data: { kind: "PER_STEP", parameter: "rangeExtension", amount: 3, step: { size: 10, unit: "ft" } } }), "superseded-radius-expansion"],
    ["a guessed Line width rule (§181)", (d: TargetingDoc) => void (def(d, "spell.targeting.line").payload.rules.targeting.measures[1] = { measure: "WIDTH", valueStatus: "FORMULA", formula: { expression: "max(5, floor(pro / 2) * 5)", rounding: "NONE", unit: "ft", variables: [] } }), "line-width-guess"],
    ["Spell Range used as the Radius size (§182)", (d: TargetingDoc) => void (def(d, "spell.targeting.radius").payload.rules.targeting.measures[0].formula.expression = "15 * per"), "spell-radius"],
    ["the old Maneuver STR-band table (§183)", (d: TargetingDoc) => void (def(d, "maneuver.targeting.radius").payload.rules.targeting.rankTables[0].entries = [{ rankKey: "TRAINED", value: 5 }, { rankKey: "EXPERT", value: 10 }, { rankKey: "MASTER", value: 10 }]), "maneuver-radius"],
    ["a Save Profile on Maneuver Radius (§185)", (d: TargetingDoc) => void (def(d, "maneuver.targeting.radius").payload.rules.targeting.saveProfile = ["AGI", "PRO"]), "targeting-resolution"],
    ["+3 AP duplicated on Maneuver Radius (§186)", (d: TargetingDoc) => void def(d, "maneuver.targeting.radius").payload.costContributions.push({ contributionKey: "targeting.conversion", currency: "AP", data: { kind: "BASE", amount: 3 } }), "maneuver-targeting-cost"],
    ["default Spell Range redefined as a second formula", (d: TargetingDoc) => void (def(d, "spell.targeting.single_target").payload.rules.targeting.range.formula.variables[0] = { variable: "base_range", source: { kind: "STAT", stat: "PER" } }), "default-spell-range"],
    ["Cone length 15 × PRO", (d: TargetingDoc) => void (def(d, "spell.targeting.cone").payload.rules.targeting.measures[0].formula.expression = "15 * pro + length_extension * 10"), "spell-cone-length"],
    ["a radiusCapable Line", (d: TargetingDoc) => void (def(d, "spell.targeting.line").payload.rules.targeting.radiusCapable = true), "radius-capable"],
  ])("%s", (_label, edit, rule) => {
    expect(mutate(edit)).toContain(rule);
  });
});