// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditWo5Content, auditWo5Source, type ConstructionDoc } from "./m5-wo5-audit-helpers";

/**
 * M5-WO5 audit — Shared modular ability construction (PAS-10 M5-WO5 §141, §A10).
 *
 * Permanent static gate over the shared construction modules of @prowess/game, the canonical ABILITY_CONSTRUCTION_RULE
 * content, the frozen @prowess/rules engine, the invariant catalog, terminology, documentation and CI contracts. In-memory
 * controls append forbidden code to REAL source snapshots (or mutate a copy of the content) and require the matching rule
 * to fire. Behavioural controls that mutate files on disk live in scripts/m5-wo5-negative-controls.mjs.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I156 explicit Spell Authority (Arcane = Arcana Skill
 * rank TRAINED+, Affinity = governing Affinity owned TRAINED+, never auto-switched) · M5-I157 Casting Condition capacity
 * from Arcane Rank only · M5-I158 Martial TRAINED is the Maneuver minimum; Affinity never substitutes or adds capacity.
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
const MODULES = [G("construction/legality.ts"), G("definition/ability-construction-payload.ts"), G("vocabulary/ability-construction.ts")];
const CONTENT = G("content/core-playtest-v0.1/ability-construction.json");
const content = () => JSON.parse(read(CONTENT)) as ConstructionDoc;
const section = (doc: string, key: string) => doc.split(/^### /m).find((s) => s.startsWith(key)) ?? "";

export const WO5_DOC = "docs/architecture/m5-shared-ability-construction.md";
export const WO5_DOC_SECTIONS = [
  "Scope",
  "Source Authority",
  "Designer Rulings",
  "Boundaries",
  "Shared Grammar",
  "Rank Tracks",
  "Arcane Authority",
  "Affinity Authority Reuse",
  "Martial Rank",
  "Construction Rule Contract",
  "Effect Capacity",
  "Trait Capacity",
  "Spell Trait Exchange",
  "Casting Condition Capacity",
  "Maneuver Condition Capacity",
  "Minimum Effects And Targeting",
  "Maneuver Foundation",
  "Component Prerequisites",
  "Effect Stacking",
  "Affinity Access",
  "Signature Ability Slots",
  "Signature Exemptions",
  "Construction Request",
  "M4 Mapping",
  "Results",
  "Provenance",
  "Historical Reproducibility",
  "Determinism And Plain Data",
  "Error Codes",
  "Invariants",
  "Remaining Conflicts And Deferred Work",
];

describe("M5-WO5 audit — Shared modular ability construction", () => {
  it("covers the WO5 construction modules, content and tests", () => {
    for (const f of [...MODULES, CONTENT, G("construction-legality-golden.test.ts"), G("construction-legality-contracts.test.ts"), G("testing/construction-fixtures.ts"), G("testing/construction-run.ts")]) expect(existsSync(path.join(ROOT, f)), f).toBe(true);
  });

  it.each(MODULES)("%s passes the WO5 rules (no rank token, capacity number, legality math, Authority switch / addition, name inference, free slot, default stack limit, latest lookup, global state)", (file) => {
    expect(auditWo5Source(read(file), file)).toEqual([]);
  });

  it("canonical construction content passes every WO5 rule (M5-I156 · M5-I157 · M5-I158)", () => {
    expect(auditWo5Content(content())).toEqual([]);
  });

  it("M4 is byte-identical to the WO2 baseline; no schema change, migration or endpoint; @prowess/game stays pure", () => {
    const wo2 = JSON.parse(read("docs/architecture/m5-wo2-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number };
    const wo5 = JSON.parse(read("docs/architecture/m5-wo5-baseline.json")) as { rulesSrcTreeHash: string; rulesSrcFileCount: number; baseCommit: string; apiRoutes: string[] };
    const files = walk("packages/prowess-rules/src").sort();
    const tree = createHash("sha256");
    for (const f of files) tree.update(`${f}\n${hash(readFileSync(path.join(ROOT, f)))}\n`);
    expect([files.length, tree.digest("hex")]).toEqual([wo2.rulesSrcFileCount, wo2.rulesSrcTreeHash]);
    expect([wo5.rulesSrcFileCount, wo5.rulesSrcTreeHash]).toEqual([wo2.rulesSrcFileCount, wo2.rulesSrcTreeHash]);
    expect(wo5.baseCommit).toMatch(/^58a9ba8[0-9a-f]{33}$/);
    expect(walk("apps/studio/app/api").filter((f) => f.endsWith("route.ts")).sort()).toEqual(wo5.apiRoutes);
    const wo1 = JSON.parse(read("docs/architecture/m5-wo1-baseline.json")) as { schemaHash: string; migrations: Record<string, string> };
    expect(hash(read("packages/prowess-db/prisma/schema.prisma"))).toBe(wo1.schemaHash);
    expect(Object.fromEntries(walk("packages/prowess-db/prisma/migrations").filter((f) => f.endsWith("migration.sql")).map((f) => [f, hash(read(f))]))).toEqual(wo1.migrations);
    expect(Object.keys((JSON.parse(read("packages/prowess-game/package.json")) as { dependencies: Record<string, string> }).dependencies).sort()).toEqual(["@prowess/model", "@prowess/rules"]);
  });

  it("construction compiles into M4 KEYWORD / FORMULA / REQUIREMENT only, through the shared assembler", () => {
    const legality = read(G("construction/legality.ts"));
    const operations = [...legality.matchAll(/operation: "([A-Z_]+)"/g)].map((m) => m[1]);
    expect(new Set(operations)).toEqual(new Set(["FORMULA", "REQUIREMENT"]));
    expect(legality).toContain("new AffinityEmitter("); // KEYWORD steps come from the WO4 emitter, reused unchanged
    expect(legality).toContain("assembleFragments(");
    expect(legality).toContain("orchestrateRulesEvaluation(");
    expect(legality).not.toMatch(/\bMODIFIER\b|\bVALIDATION\b|\bRESOURCE\b/);
  });

  it("M5-I156 / M5-I158 the Authority is read from the composition and the tracks from the Skill ranks — never chosen by the compiler", () => {
    const legality = read(G("construction/legality.ts"));
    expect(legality).toContain('readEnum(own(a, "authority"), SPELL_CONSTRUCTION_AUTHORITIES'); // the composition's explicit Authority
    expect(legality).toMatch(/AUTHORITY_REQUIRED/);
    expect(legality).toMatch(/AUTHORITY_NOT_APPLICABLE/);
    expect(legality).not.toMatch(/"(arcaneRank|martialRank)"/); // no separate rank inputs — Skill ranks only
  });

  it("the payload kind is registered, versioned and in the ABILITY family; MANEUVER_FOUNDATION carries the structural v1 contract", () => {
    const families = read(G("vocabulary/families.ts"));
    expect(families).toMatch(/ABILITY_CONSTRUCTION_RULE: active\("ABILITY"\)/);
    expect(families).toMatch(/MANEUVER_FOUNDATION:[^\n]*\[1\]/);
  });

  it("terminology: Martial Rank is the canonical Martial Skill rank; the WO5 construction terms are canonical", () => {
    const terminology = read(G("vocabulary/terminology.ts"));
    expect(terminology).toMatch(/entry\("Martial Rank", "SKILL_RANK", C, "SKILL", "MARTIAL_RANK", \{ \.\.\.designer \}\)/);
    for (const term of ["Effect Capacity", "Trait Capacity", "Casting Condition Capacity", "Maneuver Condition Capacity", "Signature Ability Slot", "Effect Stack"]) expect(terminology, term).toMatch(new RegExp(`entry\\("${term}", "RESOURCE", C,`));
  });

  it("the invariant catalog appends M5-I156–I158 after M5-I155 (never renumbered), each guarded by the WO5 tests and controls", () => {
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; title: string; guards: string[]; status?: string }>;
    expect(catalog.map((x) => x.id)).toEqual(Array.from({ length: 178 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m5-invariants.md");
    for (const entry of catalog.slice(155, 158)) {
      expect(entry.status ?? "ACTIVE").toBe("ACTIVE");
      expect(entry.guards).toEqual([G("construction-legality-golden.test.ts"), G("construction-legality-contracts.test.ts"), "apps/studio/tests/unit/m5-wo5-static.test.ts", "scripts/m5-wo5-negative-controls.mjs"]);
      for (const guard of entry.guards) expect(existsSync(path.join(ROOT, guard)), guard).toBe(true);
      expect(section(md, entry.id)).toContain(entry.title);
      expect(read("apps/studio/tests/unit/m5-wo5-static.test.ts")).toContain(entry.id);
    }
    expect(catalog[155]?.title).toMatch(/Spell Authority Is Explicit/);
    expect(catalog[156]?.title).toMatch(/Casting Condition Capacity Comes From Arcane Rank Only/);
    expect(catalog[157]?.title).toMatch(/Martial Trained Is The Maneuver Minimum/);
  });

  it("documentation: the shared-construction architecture document has every required section and diagram", () => {
    const doc = read(WO5_DOC);
    const headings = [...doc.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]]);
    expect(headings).toEqual(WO5_DOC_SECTIONS.map((s, i) => [i + 1, s]));
    expect((doc.match(/```mermaid/g) ?? []).length).toBeGreaterThanOrEqual(6);
    for (const id of ["M5-I156", "M5-I157", "M5-I158"]) expect(doc).toContain(id);
    expect(read("docs/architecture/m5-wo5-completion-report.md")).toContain("WORK ORDER READY FOR CI VERIFICATION — M5-WO5");
  });

  it("CI: one permanent named WO5 gate, placed after the canon-rulings gate, running every WO5 guard; no gate removed", () => {
    const ci = read(".github/workflows/ci.yml");
    const names = [...ci.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    const wo5 = names.indexOf("M5-WO5 audit — Shared modular ability construction");
    expect(wo5).toBeGreaterThan(names.indexOf("M5 canon rulings audit — Size Base Movement & Level 9 Affinity rank"));
    expect(names.indexOf("M5 canon rulings audit — Size Base Movement & Level 9 Affinity rank")).toBeGreaterThan(names.indexOf("M5-WO4 audit — Affinity identity, rank, authority & keyword alignment"));
    const step = ci.slice(ci.indexOf("- name: M5-WO5 audit"), ci.indexOf("- name:", ci.indexOf("- name: M5-WO5 audit") + 10));
    for (const cmd of ["src/construction-legality-golden.test.ts", "src/construction-legality-contracts.test.ts", "tests/unit/m5-wo5-static.test.ts", "tests/unit/m5-wo5-inspector-fixture.test.ts", "tests/integration/prowess-construction-history.test.ts", "tests/integration/m5-wo5-construction-api.test.ts", "node scripts/m5-wo5-negative-controls.mjs"]) expect(step, cmd).toContain(cmd);
    for (const gate of ["M5-WO1 audit", "M5-WO2 audit", "M5-WO3 audit", "M5-WO4 audit", "M4-WO12 final audit"]) expect(names.some((n) => n?.startsWith(gate)), gate).toBe(true);
    expect(read("docs/architecture/ci.md")).toContain("M5-WO5 audit — Shared modular ability construction");
  });
});

describe("M5-WO5 in-memory controls — each forbidden pattern fires its rule", () => {
  const legality = read(G("construction/legality.ts"));
  const L = G("construction/legality.ts");
  it.each([
    ["capacity hard-coded by rank token", 'export const cap = (rank: string) => (rank === "EXPERT" ? 2 : 1);', "rank-token-in-code"],
    ["Arcane + Affinity capacities added", "export const totalCapacity = (a: number, b: number) => [a, b];", "capacity-addition"],
    ["the higher Authority picked automatically", "export const highestAuthority = (x: string[]) => x[0];", "authority-auto-switch"],
    ["slot arithmetic in code", "export const remaining = (base: number, trades: number) => base - trades;", "hidden-math"],
    ["capacity compared in code", "export const fits = (effectSlots: number, capacity: number) => effectSlots <= capacity;", "legality-in-code"],
    ["a construction Formula authored in code", 'export const f = { expression: "base_effects - trades" };', "formula-in-code"],
    ["an Effect identified by canonical-key text", 'export const isStrike = (k: string) => k.startsWith("maneuver.effect.strike");', "name-inference"],
    ["an Evocation-specific rule", 'export const evocation = (a: string) => a === "EVOCATION";', "affinity-switch"],
    ["a free Signature slot", "export const isFree = true;", "free-signature-slot"],
    ["a universal stack limit", "export const defaultStackLimit = 3;", "default-stack-limit"],
    ["rank order by string comparison", "export const higher = (rankKey: string, other: string) => rankKey > other;", "rank-string-order"],
    ["the newest Definition looked up", "export const getLatestRule = () => null;", "latest-or-current"],
    ["module-level mutable state", "export let lastConstruction: unknown = null;", "global-state"],
    ["Math rounding", "export const r = (x: number) => Math.floor(x);", "hidden-math"],
  ])("%s", (_label, snippet, rule) => {
    expect(auditWo5Source(`${legality}\n${snippet}\n`, L)).toContain(rule);
  });

  const mutate = (edit: (p: Record<string, any>, d: ConstructionDoc) => void) => {  
    const d = content();
    edit(d.definitions[0]!.payload, d);
    return auditWo5Content(d);
  };
  it.each([
    ["Arcane Authority below TRAINED", (p: Record<string, any>) => void (p.spell.arcaneAuthority.minimumRank = "UNTRAINED"), "arcane-access"],  
    ["Arcane Expert 3 Effects", (p: Record<string, any>) => void (p.spell.arcaneAuthority.ranks[2].effectCapacity = 3), "arcane-capacity"],  
    ["a duplicated Affinity capacity table", (p: Record<string, any>) => void (p.spell.affinityAuthority.ranks = []), "affinity-capacity-duplicated"],  
    ["Casting Conditions from Affinity rank", (p: Record<string, any>) => void (p.spell.castingConditions.capacitySource = "AFFINITY_RANK"), "casting-condition-capacity"],  
    ["an exchange that can remove the last Effect", (p: Record<string, any>) => void (p.spell.traitExchange.minimumEffectsRemaining = 0), "spell-exchange"],  
    ["a Maneuver exchange", (p: Record<string, any>) => void (p.maneuver.traitExchange = { effectSlotsPerExchange: 1, traitSlotsPerExchange: 1, minimumEffectsRemaining: 1 }), "maneuver-exchange"],  
    ["Maneuvers without Martial training", (p: Record<string, any>) => void (p.maneuver.martial.minimumRank = "UNTRAINED"), "martial-access"],  
    ["Martial Master Rank Value 4", (p: Record<string, any>) => void (p.maneuver.martial.ranks[3].martialRankValue = 4), "martial-capacity"],  
    ["no Foundation required", (p: Record<string, any>) => void (p.maneuver.foundationRequired = false), "foundation"],  
    ["a Spell with no Effect allowed", (p: Record<string, any>) => void (p.spell.minimumEffects = 0), "minimum-effects"],  
    ["a Signature Ability costing 2 slots", (p: Record<string, any>) => void (p.signature.defaultSlotCost = 2), "signature-policy"],  
    ["Signature capacity from a constant statistic", (p: Record<string, any>) => void (p.signature.capacityStatistic = "COUNTER_ACTIONS"), "signature-policy"],  
    ["an anonymous exemption", (p: Record<string, any>) => void p.signature.exemptions.push({ exemptionKey: "FREE", description: "" }), "signature-exemption"],  
    ["unbounded trades", (p: Record<string, any>) => void delete p.formulas.maximumTrades.minimum, "trade-floor"],  
    ["an uncited ruling", (p: Record<string, any>) => void (p.source.conflicts = p.source.conflicts.filter((c: string) => c !== "M5-SC-022")), "conflict-citation"],  
    ["a second construction rule", (_p: Record<string, any>, d: ConstructionDoc) => void d.definitions.push({ ...d.definitions[0]!, canonicalKey: "construction.ability_rules_2" }), "rule-count"],  
  ])("%s", (_label, edit, rule) => {
    expect(mutate(edit)).toContain(rule);
  });
});
