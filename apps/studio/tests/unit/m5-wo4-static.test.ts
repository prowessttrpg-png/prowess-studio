// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditWo4Content, auditWo4Source, type Wo4Layer } from "./m5-wo4-audit-helpers";

/**
 * M5-WO4 audit — Affinity identity, rank, authority & keyword alignment (PAS-10 M5-WO4 §266, §297).
 *
 * Permanent static gate over @prowess/game (pure Prowess domain), the frozen @prowess/rules engine, the canonical
 * Affinity content and the amended Movement content, plus the conflict register, terminology, invariant catalog,
 * documentation and CI contracts. In-memory controls append forbidden code to REAL source snapshots (or mutate a copy
 * of the content) and require the matching rule to fire. Behavioural controls that mutate files on disk live in
 * scripts/m5-wo4-negative-controls.mjs.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I111 Movement = Base Movement × AGI · M5-I112 Sprint
 * = Movement × 4, no Total Movement · M5-I113 Size Base Movement explicit only · M5-I114 six Affinities · M5-I115
 * Evocation / Emission · M5-I116 ownership ≠ rank · M5-I117 Level 1 NONE → Level 3 TRAINED · M5-I118 Level 6 branch ·
 * M5-I119 Level 9 start rank unresolved · M5-I120 rank order · M5-I121 0 / 10 / 20 / 30 · M5-I122 one Strength discount ·
 * M5-I123 exact Keywords · M5-I124 exact Weakness percent · M5-I125 highest Weakness · M5-I126 all Weaknesses visible ·
 * M5-I127 both apply · M5-I128 Strength first · M5-I129 no rounding · M5-I130 Weakness never prohibits · M5-I131
 * component contributions · M5-I132 no geometry / name inference · M5-I133 explicit governing Affinity · M5-I134 no
 * multi-Affinity stacking · M5-I135 owned exact governing Affinity · M5-I136 Authority needs Trained · M5-I137 Effect
 * capacity · M5-I138 Trait capacity · M5-I139 no capacity addition · M5-I140 Authority ≠ cost · M5-I141 access is not
 * free · M5-I142 listed MP · M5-I143 no direct AP · M5-I144 no Spell economics on Maneuvers · M5-I145 shared alignment ·
 * M5-I146 provenance · M5-I147 no latest / current · M5-I148 M4 primitives · M5-I149 no hidden percent math · M5-I150
 * deterministic, immutable, JSON-safe, stateless. Post-WO4 rulings: M5-I151 Level 9 Trained · M5-I152 Size Base Movement ·
 * M5-I153 Arcane Rank is the Arcana Skill's rank · M5-I154 Size values (Huge 20, Massive 40) · M5-I155 one net cost
 * percentage. Historical: M5-I073 → M5-I075 → M5-I111 (traceable, not deleted).
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
const production = (dir: string) => walk(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/testing/"));
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

const GAME = production("packages/prowess-game/src");
const RULES = production("packages/prowess-rules/src");
const CONTENT = "packages/prowess-game/src/content/core-playtest-v0.1";
type Doc = { definitions: Array<{ canonicalKey: string; definitionKind: string; schemaVersion?: number; payload: Record<string, unknown> }>; deferred?: Array<{ conflictKey: string }>; keywords?: Array<{ canonicalKey: string }> };
const affinity = () => JSON.parse(read(`${CONTENT}/affinity.json`)) as Doc;
const core = () => JSON.parse(read(`${CONTENT}/core-resolution.json`)) as Doc;
const runtime = () => JSON.parse(read(`${CONTENT}/runtime-resources.json`)) as Doc;
const inventory: Array<[string, Wo4Layer]> = [...GAME.map((f) => [f, "game"] as [string, Wo4Layer]), ...RULES.map((f) => [f, "rules"] as [string, Wo4Layer])];
const section = (doc: string, key: string) => doc.split(/^### /m).find((s) => s.startsWith(key)) ?? "";

describe("M5-WO4 audit — Affinity identity, rank, authority & keyword alignment", () => {
  it("covers @prowess/game (with the WO4 Affinity modules), @prowess/rules and the Affinity content document", () => {
    for (const f of ["affinity/compile.ts", "affinity/definitions.ts", "affinity/profile.ts", "affinity/results.ts", "definition/affinity-payload.ts", "vocabulary/affinity.ts"]) expect(GAME).toContain(`packages/prowess-game/src/${f}`);
    expect(RULES.length).toBeGreaterThan(20);
    expect([affinity().definitions.length, core().definitions.length, runtime().definitions.length]).toEqual([9, 33, 26]);
  });

  it.each(inventory)("%s passes the WO4 %s rules (no Affinity switch, fuzzy Keyword, stacking, netting, rounding, auto-selection, AP / ME leakage, latest lookup, global state)", (file, layer) => {
    expect(auditWo4Source(read(file), file, layer)).toEqual([]);
  });

  it("canonical Affinity + amended Movement content passes every WO4 rule (M5-I111–I115 · M5-I119–I121 · M5-I124)", () => {
    expect(auditWo4Content(affinity(), core(), runtime())).toEqual([]);
  });

  it("M5-I148 the generic M4 engine is byte-identical to the WO2 baseline; Affinity compiles into KEYWORD / REQUIREMENT / MODIFIER only", () => {
    const wo2 = JSON.parse(read("docs/architecture/m5-wo2-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number };
    const wo4 = JSON.parse(read("docs/architecture/m5-wo4-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number; baseCommit: string; apiRoutes: string[] };
    const files = walk("packages/prowess-rules/src").sort();
    const tree = createHash("sha256");
    for (const f of files) tree.update(`${f}\n${hash(readFileSync(path.join(ROOT, f)))}\n`);
    expect([files.length, tree.digest("hex")]).toEqual([wo2.rulesSrcFileCount, wo2.rulesSrcTreeHash]);
    expect([wo4.rulesSrcFileCount, wo4.rulesSrcTreeHash]).toEqual([wo2.rulesSrcFileCount, wo2.rulesSrcTreeHash]);
    expect(wo4.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    const compile = read("packages/prowess-game/src/affinity/compile.ts");
    const operations = [...compile.matchAll(/operation: "([A-Z_]+)"/g)].map((m) => m[1]);
    // M5-I155 (rulings batch, M5-SC-028): the net percentage is M4 SUBTRACT / ADD from 100; the cost is M4 MULTIPLY / DIVIDE.
    expect([...new Set(operations)].sort()).toEqual(["ADD", "KEYWORD", "MAX", "MODIFIER", "REQUIREMENT", "SUBTRACT"]);
    expect(compile).toContain('modifiers: [scale(NET_MULTIPLIER, "MULTIPLY", FULL_PRICE_PERCENT, 1), scale(PERCENT_SCALE, "DIVIDE", FULL_PRICE_PERCENT, 2)]');
  });

  it("M5-I149 / M5-I155 the Weakness penalty operand is bound to M4's selected maximum and the cost multiplier to M4's net percentage; the compiler computes no percentage", () => {
    const compile = read("packages/prowess-game/src/affinity/compile.ts");
    expect(compile).toMatch(/fromFragment\(`\/request\/modifiers\/\$\{String\(netModifiers\.indexOf\(weakness\)\)\}\/operand`, selection, "\/data\/finalTargets\/0\/value"\)/);
    expect(compile).toContain('bindings: [fromFragment("/request/modifiers/0/operand", netStep, "/data/finalTargets/0/value")]');
    expect(compile).toMatch(/operation: "MAX"/);
    expect(compile).toMatch(/phaseKey: "affinity\.net_percent", phaseOrder: 1/);
    expect(compile).not.toMatch(/phaseKey: "affinity\.weakness", phaseOrder: 2/); // the superseded sequential model (M5-I128)
  });

  it("no schema change, no migration, no new endpoint, no persistence path; @prowess/game stays pure", () => {
    const wo1 = JSON.parse(read("docs/architecture/m5-wo1-baseline.json")) as { schemaHash: string; migrations: Record<string, string> };
    expect(hash(read("packages/prowess-db/prisma/schema.prisma"))).toBe(wo1.schemaHash);
    expect(Object.fromEntries(walk("packages/prowess-db/prisma/migrations").filter((f) => f.endsWith("migration.sql")).map((f) => [f, hash(read(f))]))).toEqual(wo1.migrations);
    const wo3 = JSON.parse(read("docs/architecture/m5-wo3-baseline.json")) as { apiRoutes: string[] };
    const wo4 = JSON.parse(read("docs/architecture/m5-wo4-baseline.json")) as { apiRoutes: string[] };
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(wo3.apiRoutes);
    expect(wo4.apiRoutes).toEqual(wo3.apiRoutes);
    expect(walk("apps/studio/app/api").join("\n")).not.toMatch(/affinit/i);
    expect(Object.keys((JSON.parse(read("packages/prowess-game/package.json")) as { dependencies: Record<string, string> }).dependencies).sort()).toEqual(["@prowess/model", "@prowess/rules"]);
  });

  it("M5-I114 / M5-I115 Affinity kinds are versioned structured content: AFFINITY v1 identity kept, v2 executable", () => {
    const families = read("packages/prowess-game/src/vocabulary/families.ts");
    expect(families).toMatch(/AFFINITY: \{ family: "AFFINITY", branch: null, contract: null, entityTypes: \["GENERIC_RULE"\], schemaVersions: \[1, 2\] \}/);
    for (const kind of ["AFFINITY_RANK_RULE", "AFFINITY_WEAKNESS_SEVERITY", "AFFINITY_PROGRESSION"]) expect(families).toContain(`${kind}: active("AFFINITY")`);
    expect(read("packages/prowess-game/src/vocabulary/construction.ts")).toMatch(/CANONICAL_AFFINITIES = deepFreeze\(\["EVOCATION", "CONJURATION", "TRANSMUTATION", "DIVINATION", "ENHANCEMENT", "MANIPULATION"\] as const\)/);
    expect(read("packages/prowess-game/src/vocabulary/affinity.ts")).toMatch(/AFFINITY_RANKS = deepFreeze\(\["NONE", "TRAINED", "EXPERT", "MASTER"\] as const\)/);
  });

  it("terminology: Evocation canonical / Emission legacy; Affinity terms; Movement, Base Movement and Sprint Allowance; no Total Movement", () => {
    const t = read("packages/prowess-game/src/vocabulary/terminology.ts");
    expect(t).toContain('entry("Evocation", "AFFINITY", C, "AFFINITY", "EVOCATION"');
    expect(t).toContain('entry("Emission", "AFFINITY", L, "AFFINITY", null, { canonicalTerm: "Evocation"');
    for (const term of ["Primary Affinity", "Secondary Affinity", "Affinity Rank", "Affinity Strength", "Affinity Weakness", "Affinity Authority", "Arcane Authority", "Governing Affinity", "Affinity Alignment", "Movement", "Base Movement", "Sprint Allowance"]) {
      expect(t, term).toMatch(new RegExp(`entry\\("${term}", "[A-Z_]+", C,`));
    }
    for (const term of ["Total Movement", "Final Movement"]) expect(t, term).toMatch(new RegExp(`entry\\("${term}", "DERIVED_STAT", L, "CHARACTER", null, \\{ \\.\\.\\.designer, canonicalTerm: "Movement"`));
  });

  it("source-conflict register: M5-SC-034 RESOLVED_BY_DESIGNER; M5-SC-033 reframed (later resolved, M5-I152); M5-SC-035 recorded (later resolved, M5-I151)", () => {
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    expect(register).toMatch(/^### M5-SC-033 — Base Movement Values By Creature Size$/m);
    expect(section(register, "M5-SC-033")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
    expect(section(register, "M5-SC-033")).toMatch(/Large Base Movement ≠ 10 ft[\s\S]*Post-WO4 designer ruling/); // WO4 history kept
    expect(section(register, "M5-SC-034")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
    expect(section(register, "M5-SC-034")).toMatch(/Movement × 4[\s\S]*never produce Movement × 4 × 4/);
    expect(register).toMatch(/^### M5-SC-035 — Starting Rank Of New Level 9 Affinity$/m);
    expect(section(register, "M5-SC-035")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`[\s\S]*WO4 status was `UNRESOLVED`/);
    expect(affinity().deferred).toEqual([]);
  });

  it("the invariant catalog has M5-I001–I158 (M5-WO5 appended I156–I158); M5-I111–I155 are guarded here; M5-I073 → M5-I075 → M5-I111 and M5-I119 → M5-I151 supersession is traceable", () => {
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; title: string; guards: string[]; status?: string; supersededBy?: string }>;
    expect(catalog.map((x) => x.id)).toEqual(Array.from({ length: 158 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`));
    const self = read("apps/studio/tests/unit/m5-wo4-static.test.ts");
    for (const entry of catalog.slice(110, 155)) {
      expect(entry.guards, entry.id).toContain("apps/studio/tests/unit/m5-wo4-static.test.ts");
      expect(self, entry.id).toContain(entry.id);
      expect(entry.status ?? "ACTIVE", entry.id).toBe(["M5-I119", "M5-I128", "M5-I152"].includes(entry.id) ? "SUPERSEDED" : "ACTIVE");
      for (const guard of entry.guards) expect(existsSync(path.join(ROOT, guard)), `${entry.id} → ${guard}`).toBe(true);
    }
    expect(catalog.filter((x) => x.status === "SUPERSEDED").map((x) => [x.id, x.supersededBy])).toEqual([["M5-I073", "M5-I075"], ["M5-I075", "M5-I111"], ["M5-I119", "M5-I151"], ["M5-I128", "M5-I155"], ["M5-I152", "M5-I154"]]);
    expect(catalog.find((x) => x.id === "M5-I075")?.title).toBe("Base Movement Equals 5 Feet Times AGI Before Size Or Other Explicit Movement Modifiers");
    const md = read("docs/architecture/m5-invariants.md");
    expect(section(md, "M5-I075")).toMatch(/\*\*Status:\*\* SUPERSEDED by M5-I111/);
    expect(section(md, "M5-I111")).toContain("Movement Equals Base Movement Multiplied By AGI");
    expect(section(md, "M5-I119")).toMatch(/\*\*Status:\*\* SUPERSEDED by M5-I151/);
    expect(section(md, "M5-I128")).toMatch(/\*\*Status:\*\* SUPERSEDED by M5-I155/);
    expect(section(md, "M5-I152")).toMatch(/\*\*Status:\*\* SUPERSEDED by M5-I154/);
  });

  it("documents WO4 with all 37 required sections and the §286–§291 diagrams; WO3 history is amended, not rewritten", () => {
    const doc = read("docs/architecture/m5-affinity-structured-rules.md");
    const sections = [
      "Scope", "Source Authority", "Designer Clarifications", "Movement/Sprint Carry-Forward Amendment", "Six Canonical Affinities", "Evocation / Emission", "Affinity Definition Contract", "Affinity Ownership", "Primary Affinity", "Secondary Affinity",
      "Affinity Rank", "Affinity Advancement", "M5-SC-035", "Strength Keywords", "Weakness Keywords", "Standard Weakness Severity", "Exact Weakness Percentages", "Divination +15%", "Governing Affinity", "Alignment Classification",
      "Strength Discount", "Highest Weakness Rule", "Strength + Weakness Ordering", "No Rounding", "Affinity Authority", "Effect Capacity", "Trait Capacity", "Arcane Authority Boundary", "Spell Cost Mapping", "Maneuver Boundary",
      "Summon Reuse Boundary", "M4 Keyword Mapping", "M4 Requirement Mapping", "M4 Modifier Mapping", "Provenance", "Historical Reproducibility", "Remaining Conflicts",
    ];
    sections.forEach((title, i) => expect(doc, title).toMatch(new RegExp(`^## ${i + 1}\\. ${title.replace(/[/.+]/g, "\\$&")}$`, "m")));
    for (const diagram of ["Alignment Evaluation", "Affinity-Adjusted Cost", "Highest Applicable %", "ONE selected authority", "ME pays listed cost.", "No separate Total Movement statistic."]) expect(doc, diagram).toContain(diagram);
    const wo3 = read("docs/architecture/m5-wo3-completion-report.md");
    expect(wo3).toContain("final_movement * 4");
  });

  it("the M5-WO4 gate is a permanent named CI step; every M5-WO1–WO3 and M0–M4 gate remains", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("M5-WO4 audit — Affinity identity, rank, authority & keyword alignment");
    for (const file of ["m5-wo4-static.test.ts", "affinity-golden.test.ts", "affinity-contracts.test.ts", "prowess-affinity-history.test.ts", "m5-wo4-affinity-api.test.ts", "m5-wo4-negative-controls.mjs"]) expect(ci).toContain(file);
    for (const gate of ["M5-WO1 audit — Prowess domain & shared ability construction boundary", "M5-WO2 audit — Core resolution, stats, dice & ranks", "M5-WO3 audit — Runtime resources, action economy & movement"]) expect(ci).toContain(gate);
    for (let i = 1; i <= 11; i += 1) expect(ci).toContain(`M4-WO${i} audit gate`);
    for (const gate of ["M1 audit gate", "M4-WO12 final audit", "Schema drift check", "pnpm run test:e2e"]) expect(ci).toContain(gate);
  });
});

// ---- In-memory controls (§243–§265): forbidden code / content must be caught by the matching rule ---------------------
const G = (f: string) => `packages/prowess-game/src/${f}`;
const sourceControls: Array<[string, string, string, Wo4Layer, string]> = [
  ["§243 canonical affinity.emission key", G("affinity/definitions.ts"), 'export const EMISSION_KEY = "affinity.emission";', "game", "emission-canonical"],
  ["§244 Affinity name switch in the compiler", G("affinity/compile.ts"), 'export const bonus = (affinity: string) => (affinity === "EVOCATION" ? 10 : 0);', "game", "affinity-switch"],
  ["§244 Affinity case clause", G("affinity/compile.ts"), 'export const pick = (a: string) => { switch (a) { case "CONJURATION": return 1; default: return 0; } };', "game", "affinity-switch"],
  ["§245 fuzzy display-text Keyword match", G("affinity/compile.ts"), 'export const isDirect = (displayName: string) => displayName.toLowerCase() === "direct damage";', "game", "fuzzy-keyword"],
  ["§245 case-insensitive Keyword regex", G("affinity/definitions.ts"), "export const loose = /direct.damage/i;", "game", "fuzzy-keyword"],
  ["§246 Strength discount per matched rule", G("affinity/compile.ts"), 'export const each = (rules: string[]) => rules.map((r) => ({ modifierKey: r, operation: "REDUCE_PERCENT", operand: 20 }));', "game", "strength-stacking"],
  ["§247 every Weakness applied sequentially", G("affinity/compile.ts"), 'export const all = (ws: number[]) => ws.map((w) => ({ operation: "INCREASE_PERCENT", operand: w }));', "game", "weakness-stacking"],
  ["§248 percentage netting", G("affinity/compile.ts"), "export const net = (strengthPercent: number, weaknessPenalty: number) => weaknessPenalty - strengthPercent;", "game", "percent-netting"],
  ["§249 Weakness phase before Strength", G("affinity/compile.ts"), 'export const wrong = { phaseKey: "affinity.weakness", phaseOrder: 0 };', "game", "modifier-order"],
  ["§250 Affinity-layer rounding", G("affinity/results.ts"), "export const shown = (cost: number) => Math.round(cost);", "game", "affinity-rounding"],
  ["§250 toFixed in the Affinity layer", G("affinity/results.ts"), "export const shown = (cost: number) => cost.toFixed(0);", "game", "affinity-rounding"],
  ["hidden percentage arithmetic", G("affinity/compile.ts"), "export const discounted = (cost: number, percent: number) => cost * (1 - percent / 100);", "game", "hidden-percent-math"],
  ["hidden highest-Weakness selection", G("affinity/compile.ts"), "export const highest = (ps: number[]) => Math.max(...ps);", "game", "hidden-percent-math"],
  ["§253 auto-select highest-rank Affinity", G("affinity/compile.ts"), "export const governing = (p: { affinities: unknown[] }) => p.affinities[0];", "game", "auto-governing"],
  ["§253 Primary as implicit governing Affinity", G("affinity/compile.ts"), "export const governing = (p: { primaryAffinity: unknown }) => p.primaryAffinity;", "game", "auto-governing"],
  ["§254 multi-Affinity discount stack", G("affinity/compile.ts"), 'export const stack = (profile: { affinities: { strengths: string[] }[] }) => profile.affinities.flatMap((a) => a.strengths.map(() => "REDUCE_PERCENT"));', "game", "multi-affinity-stack"],
  ["§255 Arcane + Affinity capacity", G("affinity/compile.ts"), "export const capacity = (arcanaCapacity: number, affinityCapacity: number) => arcanaCapacity + affinityCapacity;", "game", "capacity-addition"],
  ["§256 free Trait through Affinity", G("affinity/compile.ts"), "export const trait = { traitCost: 0 };", "game", "free-trait"],
  ["§257 direct Spell AP from Affinity", G("affinity/compile.ts"), "export const spellApDiscount = 1;", "game", "direct-ap"],
  ["§258 ME folded into the Affinity modifier", G("affinity/compile.ts"), "export const merged = (meEligible: boolean) => meEligible;", "game", "me-in-affinity"],
  ["§262 Radius counts as Evocation Area", G("affinity/compile.ts"), 'export const area = (shape: string) => shape === "RADIUS";', "game", "geometry-inference"],
  ["§262 Targeting geometry read for alignment", G("affinity/compile.ts"), "export const shape = (t: { semanticShape: string }) => t.semanticShape;", "game", "geometry-inference"],
  ["§263 latest Affinity version", G("affinity/definitions.ts"), "export const pick = (defs: unknown[]) => findNewestAffinityDefinition(defs);", "game", "latest-or-current"],
  ["§263 current Affinity lookup", G("affinity/definitions.ts"), "export const pick = (defs: unknown[]) => getCurrentAffinity(defs);", "game", "latest-or-current"],
  ["§265 Total Movement statistic", G("vocabulary/core.ts"), 'export const SPRINT_BASIS = "TOTAL_MOVEMENT";', "game", "total-movement-stat"],
  ["§264 old Base Movement = 5 × AGI term", G("runtime/compile.ts"), 'export const baseMovementProgram = { expression: "5 * agi" };', "game", "old-movement-term"],
  ["global Affinity state", G("affinity/compile.ts"), "let lastAffinityResult: unknown = null;\nexport const remember = (r: unknown) => (lastAffinityResult = r);", "game", "global-affinity-state"],
  ["database access in the Affinity layer", G("affinity/profile.ts"), 'import { prisma } from "@prowess/db";', "game", "database-access"],
  ["Affinity vocabulary inside M4", "packages/prowess-rules/src/modifier/evaluate.ts", 'export const EVOCATION_DISCOUNT = "evocation";', "rules", "affinity-in-m4"],
  ["Affinity identifier inside M4", "packages/prowess-rules/src/requirement/evaluate.ts", "export const affinityRank = 2;", "rules", "affinity-in-m4"],
];

type Docs = { affinity: Doc; core: Doc; runtime: Doc };
const mutate = (fn: (d: Docs) => void): Docs => {
  const d = { affinity: affinity(), core: core(), runtime: runtime() };
  fn(d);
  return d;
};
const aff = (d: Docs, token: string) => d.affinity.definitions.find((x) => x.payload.affinity === token)!.payload;
const rankRule = (d: Docs) => d.affinity.definitions.find((x) => x.definitionKind === "AFFINITY_RANK_RULE")!.payload as { ranks: { rank: string; strengthDiscountPercent: number }[] };
const contentControls: Array<[string, () => Docs, string]> = [
  ["§243 canonical Emission Affinity", () => mutate((d) => d.affinity.definitions.push({ canonicalKey: "affinity.emission", definitionKind: "AFFINITY", schemaVersion: 2, payload: { ...aff(d, "EVOCATION"), affinity: "EMISSION" } })), "emission-canonical"],
  ["§251 NONE grants a 10% Strength discount", () => mutate((d) => void (rankRule(d).ranks[0]!.strengthDiscountPercent = 10)), "rank-rule"],
  ["Expert discount drifts to 25%", () => mutate((d) => void (rankRule(d).ranks[2]!.strengthDiscountPercent = 25)), "rank-rule"],
  ["§260 / M5-I151 Level 9 new Affinity starts at EXPERT, contrary to the M5-SC-035 ruling", () => mutate((d) => {
    const prog = d.affinity.definitions.find((x) => x.definitionKind === "AFFINITY_PROGRESSION")!.payload as { levels: { level: number; options: Record<string, unknown>[] }[] };
    prog.levels.find((l) => l.level === 9)!.options.find((o) => o.optionKey === "GAIN_NEW_AFFINITY")!.startingRank = "EXPERT";
  }), "level9-rank-guess"],
  ["M5-I151 Level 9 new Affinity reverted to unresolved (null)", () => mutate((d) => {
    const prog = d.affinity.definitions.find((x) => x.definitionKind === "AFFINITY_PROGRESSION")!.payload as { levels: { level: number; options: Record<string, unknown>[] }[] };
    const gain = prog.levels.find((l) => l.level === 9)!.options.find((o) => o.optionKey === "GAIN_NEW_AFFINITY")!;
    gain.startingRank = null;
    gain.conflictKey = "M5-SC-035";
  }), "level9-rank-guess"],
  ["§261 Divination +15% coerced to Moderate +20%", () => mutate((d) => {
    const w = (aff(d, "DIVINATION").weaknesses as { weaknessKey: string; activationPenaltyPercent: number; severity: string | null }[]).find((x) => x.weaknessKey === "PERSISTENT_EFFECT")!;
    w.activationPenaltyPercent = 20;
    w.severity = "MODERATE";
  }), "divination-coerced"],
  ["Evocation Healing penalty drifts to +20%", () => mutate((d) => void ((aff(d, "EVOCATION").weaknesses as { activationPenaltyPercent: number }[])[0]!.activationPenaltyPercent = 20)), "weakness-table"],
  ["a Strength matched by display text", () => mutate((d) => void ((aff(d, "EVOCATION").strengths as { matchAny: string[] }[])[0]!.matchAny = ["Direct Damage"])), "fuzzy-keyword"],
  ["§264 Base Movement = 5 × AGI again", () => mutate((d) => {
    const f = d.core.definitions.find((x) => x.payload.statistic === "BASE_MOVEMENT")!.payload.formula as { expression: string; variables: unknown[] };
    f.expression = "5 * agi";
    f.variables = [{ variable: "agi", source: { kind: "STAT", stat: "AGI" } }];
  }), "old-movement-term"],
  ["§265 Sprint reads a Total Movement statistic", () => mutate((d) => {
    const g = d.runtime.definitions.find((x) => x.payload.actionKey === "SPRINT")!.payload.movementGrant as { formula: { expression: string; variables: { source: { statistic: string } }[] } };
    g.formula.expression = "total_movement * 4";
    g.formula.variables[0]!.source.statistic = "TOTAL_MOVEMENT";
  }), "total-movement-stat"],
  ["Sprint compounds × 4 × 4", () => mutate((d) => void ((d.runtime.definitions.find((x) => x.payload.actionKey === "SPRINT")!.payload.movementGrant as { formula: { expression: string } }).formula.expression = "movement * 4 * 4")), "sprint-allowance"],
  ["Large occupied space read as Base Movement", () => mutate((d) => void (d.runtime.definitions.find((x) => x.payload.sizeKey === "LARGE")!.payload.baseMovement = 10)), "size-base-movement"],
  ["M5-I154 Huge Base Movement reverts to the superseded 15 ft", () => mutate((d) => void (d.runtime.definitions.find((x) => x.payload.sizeKey === "HUGE")!.payload.baseMovement = { feet: 15 })), "size-base-movement"],
  ["M5-I154 Small Base Movement drifts to 0 ft (null)", () => mutate((d) => void (d.runtime.definitions.find((x) => x.payload.sizeKey === "SMALL")!.payload.baseMovement = null)), "size-base-movement"],
  ["M5-I154 Massive Base Movement drifts to 20 ft (ruling: 40)", () => mutate((d) => void (d.runtime.definitions.find((x) => x.payload.sizeKey === "MASSIVE")!.payload.baseMovement = { feet: 20 })), "size-base-movement"],
  ["M5-I154 Base Movement hard-coded 5 ft again (Size ignored)", () => mutate((d) => {
    const f = d.core.definitions.find((x) => x.payload.statistic === "BASE_MOVEMENT")!.payload.formula as { expression: string; variables: unknown[] };
    f.expression = "5";
    f.variables = [];
  }), "old-movement-term"],
  ["a resolved Size value re-deferred (M5-SC-036)", () => mutate((d) => void (d.runtime.deferred = [{ conflictKey: "M5-SC-036" }])), "movement-conflicts"],
];

describe("M5-WO4 permanent negative controls — mutated real source and content snapshots", () => {
  it.each(sourceControls)("%s is caught", (_label, file, snippet, layer, finding) => {
    expect(auditWo4Source(read(file), file, layer)).toEqual([]);
    expect(auditWo4Source(`${read(file)}\n${snippet}\n`, file, layer)).toContain(finding);
  });

  it.each(contentControls)("%s is caught in content", (_label, build, finding) => {
    expect(auditWo4Content(affinity(), core(), runtime())).toEqual([]);
    const d = build();
    expect(auditWo4Content(d.affinity, d.core, d.runtime)).toContain(finding);
  });

  it("documentation comments mentioning forbidden ideas are not findings (AST, not grep)", () => {
    const file = G("affinity/compile.ts");
    expect(auditWo4Source(`${read(file)}\n// affinity === "EVOCATION"; Math.round(cost); getCurrentAffinity(); "TOTAL_MOVEMENT"; RADIUS\n`, file, "game")).toEqual([]);
  });
});
