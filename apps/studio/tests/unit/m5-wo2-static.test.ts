// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditCoreContent, auditWo2Source, type Wo2Layer } from "./m5-wo2-audit-helpers";

/**
 * M5-WO2 audit — Core resolution, stats, dice & ranks (PAS-10 M5-WO2 §182–200, §224).
 *
 * Permanent static gate over @prowess/game (pure Prowess domain), the frozen @prowess/rules engine and the canonical core
 * content document, plus the conflict register, terminology, invariant catalog, documentation and CI contracts.
 * In-memory controls append forbidden code to REAL source snapshots (or mutate a copy of the content) and require the
 * matching rule to fire. Behavioural controls that mutate files on disk live in scripts/m5-wo2-negative-controls.mjs.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I041 Character Die canonical / Player Die legacy ·
 * M5-I042 progression is data · M5-I043 no randomness · M5-I044 static half die · M5-I045 six Stats · M5-I046 Stat
 * bounds · M5-I047 rank order vs meaning · M5-I048 Skill bonuses · M5-I049 approach Stat · M5-I050 arithmetic in M4 ·
 * M5-I051 Advantage · M5-I052 Disadvantage · M5-I053 natural preserved · M5-I054 Attack Roll · M5-I055 Accuracy ·
 * M5-I056 Dodge / Evasion · M5-I057 Dodge formula · M5-I058 threat never auto-hits · M5-I059 critical hit · M5-I060 Saving
 * Throws · M5-I061 Targeting never selects a Save · M5-I062 Character DC · M5-I063 HP · M5-I064 MP · M5-I065 racial base
 * values · M5-I066 Strength Armor · M5-I067 AP · M5-I068 Base Range · M5-I069 Mana Efficiency · M5-I070 Signature
 * capacity · M5-I071 automatic success · M5-I072 Stat Mastery · M5-I073 Movement deferred (SUPERSEDED by M5-I075 in
 * M5-WO3 — this gate now checks that the supersession is recorded) · M5-I074 statistics via M4.
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
const WO2_LATER_MILESTONE_CONTENT = new Set([
  // WO11 content owns the final Maneuver AP / MP Formulas, covered by its permanent goldens and architecture audit.
  "packages/prowess-game/src/content/core-playtest-v0.1/maneuver-cost.ts",
  // WO10 content owns the final Spell MP / AP Formulas, covered by its permanent goldens and architecture audit.
  "packages/prowess-game/src/content/core-playtest-v0.1/spell-cost.ts",
  // WO9 content owns listed contribution/cap Formulas, covered by its permanent content and architecture audit.
  "packages/prowess-game/src/content/core-playtest-v0.1/duration-conditions.ts",
  "packages/prowess-game/src/content/core-playtest-v0.1/effects.ts",
  "packages/prowess-game/src/content/core-playtest-v0.1/targeting-wo7-amendments.ts",
]);
const WO2_GAME = GAME.filter((f) => !WO2_LATER_MILESTONE_CONTENT.has(f));
const RULES = production("packages/prowess-rules/src");
const CONTENT_FILE = "packages/prowess-game/src/content/core-playtest-v0.1/core-resolution.json";
const content = () => JSON.parse(read(CONTENT_FILE)) as { definitions: Array<{ canonicalKey: string; definitionKind: string; payload: Record<string, unknown> }> };
const inventory: Array<[string, Wo2Layer]> = [...WO2_GAME.map((f) => [f, "game"] as [string, Wo2Layer]), ...RULES.map((f) => [f, "rules"] as [string, Wo2Layer])];
const section = (doc: string, key: string) => doc.split(/^### /m).find((s) => s.startsWith(key)) ?? "";

describe("M5-WO2 audit — Core resolution, stats, dice & ranks", () => {
  it("covers @prowess/game (with the WO2 core modules), @prowess/rules and the canonical content", () => {
    for (const f of ["core/compile.ts", "core/character.ts", "core/dice.ts", "core/definitions.ts", "core/ranks.ts", "definition/core-payload.ts", "vocabulary/core.ts"]) expect(GAME).toContain(`packages/prowess-game/src/${f}`);
    expect(RULES.length).toBeGreaterThan(20);
    // WO2 shipped 30; M5-WO3 appended BASE_MOVEMENT, FINAL_MOVEMENT and INITIATIVE.
    expect(content().definitions).toHaveLength(33);
  });

  it.each(inventory)("%s passes the WO2 %s rules (no randomness, hidden math, Stat / level / die branches, legacy values, M4 Prowess terms)", (file, layer) => {
    expect(auditWo2Source(read(file), file, layer)).toEqual([]);
  });

  it("canonical core content passes every designer-ruling rule (M5-I041 · M5-I047–I049 · M5-I051 · M5-I054–I057 · M5-I062–I065 · M5-I069 · M5-I072)", () => {
    expect(auditCoreContent(content())).toEqual([]);
  });

  it("M5-I043 no randomness anywhere in the deterministic layers (Math.random, crypto, dice RNG, clock entropy)", () => {
    for (const file of [...GAME, ...RULES]) expect(read(file), file).not.toMatch(/Math\.random\s*\(|crypto\.randomInt|getRandomValues\s*\(/);
  });

  it("M5-I050 / M5-I074 the generic M4 engine is untouched (source tree hash) and the arithmetic lives in content, not code", () => {
    const baseline = JSON.parse(read("docs/architecture/m5-wo2-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number; apiRoutes: string[] };
    const files = walk("packages/prowess-rules/src").sort();
    const tree = createHash("sha256");
    for (const f of files) tree.update(`${f}\n${hash(readFileSync(path.join(ROOT, f)))}\n`);
    expect(files.length).toBe(baseline.rulesSrcFileCount);
    expect(tree.digest("hex")).toBe(baseline.rulesSrcTreeHash);
    for (const file of WO2_GAME) expect(read(file), file).not.toMatch(/expression:\s*["'`]/);
    expect(GAME.filter((f) => /core\//.test(f)).map(read).join("\n")).not.toMatch(/\b(floor|ceil)\s*\(/);
  });

  it("no schema change, no migration, no new HTTP endpoint, no UI dependency, no database dependency in @prowess/game", () => {
    const wo1 = JSON.parse(read("docs/architecture/m5-wo1-baseline.json")) as { schemaHash: string; migrations: Record<string, string> };
    expect(hash(read("packages/prowess-db/prisma/schema.prisma"))).toBe(wo1.schemaHash);
    expect(Object.fromEntries(walk("packages/prowess-db/prisma/migrations").filter((f) => f.endsWith("migration.sql")).map((f) => [f, hash(read(f))]))).toEqual(wo1.migrations);
    const baseline = JSON.parse(read("docs/architecture/m5-wo2-baseline.json")) as { apiRoutes: string[] };
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(baseline.apiRoutes);
    expect(Object.keys((JSON.parse(read("apps/studio/package.json")) as { dependencies: Record<string, string> }).dependencies)).not.toContain("@prowess/game");
    expect(Object.keys((JSON.parse(read("packages/prowess-game/package.json")) as { dependencies: Record<string, string> }).dependencies).sort()).toEqual(["@prowess/model", "@prowess/rules"]);
  });

  it("M5-I042 / M5-I044 / M5-I045 / M5-I046 progression, half die and Stats are content, exactly as ruled", () => {
    const defs = content().definitions;
    const prog = defs.filter((d) => d.definitionKind === "CHARACTER_DIE_PROGRESSION");
    expect(prog).toHaveLength(1);
    expect(prog[0]?.payload.levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(prog[0]?.payload.progression).toEqual([
      { levelMinimum: 1, levelMaximum: 2, dieKey: "D4" },
      { levelMinimum: 3, levelMaximum: 4, dieKey: "D6" },
      { levelMinimum: 5, levelMaximum: 6, dieKey: "D8" },
      { levelMinimum: 7, levelMaximum: 8, dieKey: "D10" },
      { levelMinimum: 9, levelMaximum: 10, dieKey: "D12" },
    ]);
    expect((defs.find((d) => d.payload.statistic === "HALF_CHARACTER_DIE")?.payload.formula as { expression: string }).expression).toBe("die_faces / 2");
    expect(defs.filter((d) => d.definitionKind === "STAT").map((d) => [d.payload.stat, d.payload.minimum, d.payload.maximum])).toEqual(["STR", "AGI", "CON", "PER", "RES", "PRO"].map((s) => [s, 1, 10]));
  });

  it("M5-I052 / M5-I053 / M5-I058 / M5-I059 / M5-I060 / M5-I061 / M5-I066–I068 / M5-I070 / M5-I071 procedures and statistics are present as ruled", () => {
    const defs = content().definitions;
    const expr = (statistic: string) => (defs.find((d) => d.payload.statistic === statistic)?.payload.formula as { expression: string }).expression;
    expect([expr("STRENGTH_ARMOR"), expr("AP_AGILITY_BONUS"), expr("BASE_AP_CAPACITY"), expr("COUNTER_ACTION_CAPACITY"), expr("BASE_RANGE"), expr("SIGNATURE_ABILITY_SLOTS")]).toEqual(["floor(str / 3)", "floor(agi / 3)", "3 + agility_bonus", "1", "15 * per", "pro"]);
    const auto = defs.find((d) => d.payload.procedure === "SKILL_AUTOMATIC_SUCCESS")?.payload;
    expect([auto?.naturalSelection, (auto?.total as { expression: string }).expression]).toEqual([null, "stat_score + rank_bonus"]);
    expect((defs.find((d) => d.payload.procedure === "SAVING_THROW")?.payload.total as { expression: string }).expression).toBe("natural + stat_score + bonuses");
    // M5-I061: the Targeting forbidden-key list still refuses Save selection.
    expect(read("packages/prowess-game/src/definition/payload.ts")).toMatch(/"save",\n {2}"saves",\n {2}"saveStat",/);
  });

  it("M5-I041 / M5-I056 terminology: Character Die / Dodge / Accuracy canonical; Player Die / Player Dice / Evasion legacy", () => {
    const t = read("packages/prowess-game/src/vocabulary/terminology.ts");
    expect(t).toContain('entry("Player Dice", "CORE_RESOLUTION", L, "CORE", null, { ...designer, canonicalTerm: "Character Dice", conflictKey: "M5-SC-002" })');
    expect(t).toContain('entry("Player Die", "CORE_RESOLUTION", L, "CORE", null, { ...designer, canonicalTerm: "Character Die", conflictKey: "M5-SC-002" })');
    expect(t).toContain('entry("Evasion", "DERIVED_STAT", L, "CHARACTER", null, { ...designer, canonicalTerm: "Dodge", conflictKey: "M5-SC-005" })');
    expect(t).toMatch(/entry\("Dodge", "DERIVED_STAT", C,/);
    expect(t).toMatch(/entry\("Accuracy", "DERIVED_STAT", C,/);
    expect(t).toMatch(/entry\("Character Die", "CORE_RESOLUTION", C,/);
    expect(t).toMatch(/entry\("Character Dice", "CORE_RESOLUTION", C,/);
  });

  it("source-conflict register: the six WO2 designer rulings are RESOLVED_BY_DESIGNER; 007 and 011 were UNRESOLVED through WO4 (resolved post-WO4); 006 / 032 record their WO2 state and the M5-WO3 ruling", () => {
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    for (const key of ["M5-SC-002", "M5-SC-003", "M5-SC-005", "M5-SC-008", "M5-SC-009", "M5-SC-010"]) {
      const s = section(register, key);
      expect(s, key).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
      expect(s, key).toMatch(/\*\*resolution authority\*\*: M5-WO2 §/);
      expect(s, key).toMatch(/\*\*source A\*\*:[\s\S]*\*\*source B\*\*:/); // provenance preserved
    }
    // M5-SC-007 was UNRESOLVED through M5-WO4; the post-WO4 rulings batch resolved it (two pools; follow-up M5-SC-038).
    expect(section(register, "M5-SC-007")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`[\s\S]*Rulings batch \(post-WO4, resolves M5-SC-007\)/);
    // M5-SC-011 was UNRESOLVED through M5-WO4; the post-WO4 designer ruling resolved it (M5-I153), WO1 history kept.
    expect(section(register, "M5-SC-011")).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`[\s\S]*WO1–WO4 status was `UNRESOLVED`[\s\S]*It is not normalized \(§10\)\.[\s\S]*Post-WO4 designer ruling \(resolves M5-SC-011\)/);
    // M5-WO3 designer rulings: the WO2 history (deferral, fail-closed) is kept, not rewritten.
    for (const key of ["M5-SC-006", "M5-SC-032"]) {
      expect(section(register, key), key).toMatch(/\*\*status\*\*: `RESOLVED_BY_DESIGNER`/);
      expect(section(register, key), key).toMatch(/\*\*resolution authority\*\*: M5-WO3 §/);
    }
    expect(section(register, "M5-SC-006")).toMatch(/DEFERRED_PENDING_CANON/);
    expect(section(register, "M5-SC-006")).toMatch(/5 × AGI[\s\S]*10 × AGI/);
    expect(section(register, "M5-SC-032")).toMatch(/ROLL_MODE_CONFLICT/);
  });

  it("the M5 invariant catalog defines M5-I041–I074 with guards, appended after the untouched M5-I001–I040 (M5-WO3 appends I075–I110)", () => {
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; guards: string[] }>;
    expect(catalog.map((x) => x.id).slice(0, 74)).toEqual(Array.from({ length: 74 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`));
    for (const entry of catalog.slice(40, 74)) {
      expect(entry.guards, entry.id).toContain("apps/studio/tests/unit/m5-wo2-static.test.ts");
      expect(read("apps/studio/tests/unit/m5-wo2-static.test.ts"), entry.id).toContain(entry.id);
    }
  });

  it("documents WO2 with all 30 required sections and the §213–220 diagrams", () => {
    const doc = read("docs/architecture/m5-core-resolution-stats-dice-ranks.md");
    const sections = [
      "Scope", "Source Authority", "Designer Rulings", "Character Die", "Player Dice Legacy Mapping", "Ability Scores", "Rank Model", "Skill Rank Bonuses", "Core Roll", "Roll Inputs",
      "Advantage / Disadvantage", "Attack Roll", "Accuracy", "Dodge", "Criticals", "Saving Throws", "Character DC", "HP", "MP", "Strength Armor",
      "AP Capacity", "Base Range", "Mana Efficiency", "Signature Capacity", "Stat Mastery", "M4 Compilation", "Provenance", "Determinism", "Remaining Source Conflicts", "WO3 Boundary",
    ];
    sections.forEach((title, i) => expect(doc, title).toMatch(new RegExp(`^## ${i + 1}\\. ${title.replace(/[/.]/g, "\\$&")}$`, "m")));
    for (const diagram of ["DC / Defense Comparison", "├─ max ─► Selected Natural", "Accuracy = floor(PRO / 3)", "Other Dodge Bonuses", "Other DC Bonuses", "Runtime spending is WO3.", "NO RNG INSIDE ENGINE", "Martial Rank Value:"]) {
      expect(doc, diagram).toContain(diagram);
    }
  });

  it("the M5-WO2 gate is a permanent named CI step; the M5-WO1 gate and every M0–M4 gate remain", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("M5-WO2 audit — Core resolution, stats, dice & ranks");
    for (const file of ["m5-wo2-static.test.ts", "prowess-core-resolution-history.test.ts", "m5-wo2-negative-controls.mjs"]) expect(ci).toContain(file);
    expect(ci).toContain("M5-WO1 audit — Prowess domain & shared ability construction boundary");
    for (let i = 1; i <= 11; i += 1) expect(ci).toContain(`M4-WO${i} audit gate`);
    for (const gate of ["M1 audit gate", "M4-WO12 final audit", "Schema drift check", "pnpm run test:e2e"]) expect(ci).toContain(gate);
  });
});

// ---- In-memory controls (§183–200): forbidden code / content must be caught by the matching rule ----------------------
const G = (f: string) => `packages/prowess-game/src/${f}`;
const sourceControls: Array<[string, string, string, Wo2Layer, string]> = [
  ["§183 canonical PLAYER_DIE beside CHARACTER_DIE", G("core/character.ts"), 'export const PLAYER_DIE = { dieKey: "PLAYER_DIE", source: "Player Die" };', "game", "legacy-canonical"],
  ["§184 Math.random in core roll evaluation", G("core/dice.ts"), "export const rollD = (faces: number) => Math.floor(Math.random() * faces);", "game", "randomness"],
  ["§184 crypto.randomInt die", G("core/dice.ts"), "export const d = (faces: number) => crypto.randomInt(faces);", "game", "randomness"],
  ["§184 custom dice RNG", G("core/dice.ts"), "export function diceRng(seed: number) { return seed; }", "game", "randomness"],
  ["§185 natural + PER + accuracy in compiler TypeScript", G("core/compile.ts"), "export const attackTotal = (natural: number, per: number, accuracy: number) => natural + per + accuracy;", "game", "hidden-math"],
  ["§185 max selection in TypeScript", G("core/compile.ts"), "export const pick = (a: number, b: number) => Math.max(a, b);", "game", "hidden-math"],
  ["§187 PER + floor(PRO/3) pre-added as an opaque program", G("core/compile.ts"), 'export const opaque = { expression: "per + floor(pro / 3)" };', "game", "formula-in-code"],
  ["§188 canonical Evasion value", G("core/compile.ts"), 'export const evasionValue = { statistic: "EVASION" };', "game", "legacy-canonical"],
  ["§196 Athletics → STR only", G("core/compile.ts"), 'export const SKILL_STATS = { athletics: "STR" };', "game", "skill-fixed-stat"],
  ["§196 skill-key branch", G("core/compile.ts"), 'export const statFor = (skillKey: string) => (skillKey === "skill.athletics" ? 1 : 0);', "game", "skill-fixed-stat"],
  ["§197 TRAINED=1 / EXPERT=2 / MASTER=3", G("core/compile.ts"), "export const SKILL_BONUS = { TRAINED: 1, EXPERT: 2, MASTER: 3 };", "game", "rank-numeric-collapse"],
  ["§197 global rankValue", G("core/ranks.ts"), "export const rankValue = (rankKey: string) => rankKey.length;", "game", "rank-numeric-collapse"],
  ["rank alphabetical order", G("core/ranks.ts"), "export const before = (a: { rankKey: string }, b: { rankKey: string }) => a.rankKey < b.rankKey;", "game", "rank-alphabetical"],
  ["§199 listedMpAfterMe = listedMp - ME", G("core/compile.ts"), "export const listedMpAfterMe = (listedMp: number, me: number) => listedMp - me;", "game", "me-discount"],
  ["level branch", G("core/character.ts"), 'export const dieFor = (level: number) => (level <= 2 ? "D4" : "D6");', "game", "level-branch"],
  ["Stat branch", G("core/compile.ts"), 'export const isPer = (stat: string) => stat === "PER";', "game", "stat-branch"],
  ["die-faces branch", G("core/compile.ts"), "export const crit = (natural: number) => natural === 8;", "game", "die-branch"],
  ["Stat Mastery as a numeric threshold in code", G("core/compile.ts"), "export const mastered = (score: number) => score >= 10;", "game", "stat-branch"],
  ["hidden final total", G("core/compile.ts"), "export const precomputed = { total: 12 };", "game", "hidden-result"],
  ["latest / current Definition", G("core/definitions.ts"), "export const pick = (defs: unknown[]) => getCurrentDefinition(defs);", "game", "latest-or-current"],
  ["database dependency", G("core/definitions.ts"), 'import { prisma } from "@prowess/db";', "game", "database-dependency"],
  ["content imported into production code", G("core/definitions.ts"), 'import content from "../content/core-playtest-v0.1/core-resolution.json";', "game", "content-in-code"],
  ["Prowess Dodge inside M4", "packages/prowess-rules/src/formula/evaluate.ts", 'export const DODGE_KEY = "dodge";', "rules", "prowess-in-m4"],
  ["Prowess Stat branch inside M4", "packages/prowess-rules/src/requirement/evaluate.ts", 'export const isPro = (k: string) => k === "PRO";', "rules", "prowess-in-m4"],
];

type Content = ReturnType<typeof content>;
const mutate = (fn: (defs: Content["definitions"]) => void): Content => {
  const c = content();
  fn(c.definitions);
  return c;
};
const formulaOf = (defs: Content["definitions"], statistic: string) => defs.find((d) => d.payload.statistic === statistic)?.payload.formula as { expression: string; variables: Array<{ variable: string; source: Record<string, string> }> };
const totalOf = (defs: Content["definitions"], procedure: string) => defs.find((d) => d.payload.procedure === procedure)?.payload.total as { expression: string; variables: Array<{ variable: string; source: Record<string, string> }> };
const contentControls: Array<[string, () => Content, string]> = [
  ["§183 second (Player Die) progression", () => mutate((d) => d.push({ ...d.find((x) => x.definitionKind === "CHARACTER_DIE_PROGRESSION")!, canonicalKey: "core.player_die.progression" })), "player-die-duplicate"],
  ["§186 Attack without Accuracy", () => mutate((d) => {
    const t = totalOf(d, "ATTACK_ROLL");
    t.expression = "natural + per + bonuses";
    t.variables = t.variables.filter((v) => v.variable !== "accuracy");
  }), "accuracy-omitted"],
  ["§187 Accuracy merged into PER", () => mutate((d) => {
    const t = totalOf(d, "ATTACK_ROLL");
    t.expression = "natural + per + floor(pro / 3) + bonuses";
    t.variables = [...t.variables.filter((v) => v.variable !== "accuracy"), { variable: "pro", source: { kind: "STAT", stat: "PRO" } }];
  }), "accuracy-hidden-in-per"],
  ["§188 separate Evasion statistic", () => mutate((d) => d.push({ ...d.find((x) => x.payload.statistic === "DODGE")!, canonicalKey: "core.derived.evasion", payload: { ...d.find((x) => x.payload.statistic === "DODGE")!.payload, statistic: "EVASION" } })), "evasion-duplicate"],
  ["§189 PER Dodge bonus omitted", () => mutate((d) => {
    const f = formulaOf(d, "DODGE");
    f.expression = "half_character_die + agi + bonuses";
    f.variables = f.variables.filter((v) => v.variable !== "perception_bonus");
  }), "per-dodge-omitted"],
  ["§190 Resolve DC bonus omitted", () => mutate((d) => {
    const f = formulaOf(d, "CHARACTER_DC");
    f.expression = "half_character_die + pro + bonuses";
    f.variables = f.variables.filter((v) => v.variable !== "resolve_bonus");
  }), "resolve-dc-omitted"],
  ["Resolve hidden inside PRO", () => mutate((d) => {
    const f = formulaOf(d, "CHARACTER_DC");
    f.expression = "half_character_die + pro + floor(res / 3) + bonuses";
    f.variables = [...f.variables.filter((v) => v.variable !== "resolve_bonus"), { variable: "res", source: { kind: "STAT", stat: "RES" } }];
  }), "resolve-hidden-in-pro"],
  ["§191 HP = BaseHP × CON", () => mutate((d) => void (formulaOf(d, "MAXIMUM_HP").expression = "base_hp * con")), "multiplicative-resources"],
  ["§192 MP = BaseMP × RES", () => mutate((d) => void (formulaOf(d, "MAXIMUM_MP").expression = "base_mp * res")), "multiplicative-resources"],
  ["§193 max(roll1 + bonuses, roll2 + bonuses)", () => mutate((d) => {
    const sel = d.find((x) => x.payload.procedure === "ATTACK_ROLL")!.payload.naturalSelection as Record<string, { expression: string }>;
    sel.ADVANTAGE = { expression: "max(r1 + bonuses, r2 + bonuses)" };
  }), "advantage-modifiers-twice"],
  ["DOUBLE_ADVANTAGE state", () => mutate((d) => {
    const sel = d.find((x) => x.payload.procedure === "ATTACK_ROLL")!.payload.naturalSelection as Record<string, { expression: string }>;
    sel.DOUBLE_ADVANTAGE = { expression: "max(r1, r2)" };
  }), "advantage-stacking"],
  ["§194 / §195 critical reads a discarded die or auto-hits", () => mutate((d) => void (d.find((x) => x.payload.procedure === "ATTACK_ROLL")!.payload.critical = { threat: "ANY_NATURAL_EQUALS_DIE_FACES", hit: "THREAT_ONLY", damage: "DEFERRED" })), "critical-rule"],
  ["§196 Skill Check reads a fixed Stat", () => mutate((d) => {
    const t = totalOf(d, "SKILL_CHECK");
    t.variables = t.variables.map((v) => (v.variable === "stat_score" ? { variable: "stat_score", source: { kind: "STAT", stat: "STR" } } : v));
  }), "skill-fixed-stat"],
  ["§197 Skill bonuses 1 / 2 / 3", () => mutate((d) => {
    const e = d.find((x) => x.definitionKind === "SKILL_RANK")!.payload.entries as Array<{ rankKey: string; bonus: number }>;
    e.forEach((x, i) => (x.bonus = i));
  }), "rank-numeric-collapse"],
  ["rank ladder in alphabetical order", () => mutate((d) => {
    const l = d.find((x) => x.definitionKind === "RANK_LADDER")!.payload as { ranks: Array<{ rankKey: string; order: number }> };
    l.ranks = ["EXPERT", "MASTER", "TRAINED", "UNTRAINED"].map((rankKey, order) => ({ rankKey, order }));
  }), "rank-alphabetical"],
  ["UNTRAINED freely attempts", () => mutate((d) => void ((d.find((x) => x.definitionKind === "SKILL_RANK")!.payload.entries as Array<{ attemptAllowed: boolean }>)[0]!.attemptAllowed = true)), "untrained-access"],
  ["§199 ME as a listed-cost discount", () => mutate((d) => void (formulaOf(d, "BASE_MANA_EFFICIENCY").expression = "listed_mp - pro")), "me-discount"],
  ["Stat Mastery as a numeric bonus", () => mutate((d) => void ((d.find((x) => x.payload.procedure === "STAT_MASTERY")!.payload.mastery as Record<string, unknown>).bonus = 2)), "stat-mastery-bonus"],
];

describe("M5-WO2 permanent negative controls — mutated real source and content snapshots", () => {
  it.each(sourceControls)("%s is caught", (_label, file, snippet, layer, finding) => {
    expect(auditWo2Source(read(file), file, layer)).toEqual([]);
    expect(auditWo2Source(`${read(file)}\n${snippet}\n`, file, layer)).toContain(finding);
  });

  it.each(contentControls)("%s is caught in content", (_label, build, finding) => {
    expect(auditCoreContent(content())).toEqual([]);
    expect(auditCoreContent(build())).toContain(finding);
  });

  it("documentation comments mentioning forbidden ideas are not findings (AST, not grep)", () => {
    const file = G("core/compile.ts");
    expect(auditWo2Source(`${read(file)}\n// Math.random() + Movement = 10 × AGI; Player Die; Evasion; rankValue\n`, file, "game")).toEqual([]);
  });
});
