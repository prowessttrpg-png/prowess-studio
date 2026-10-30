// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frozenFileContent, frozenSchemaText, notLaterMigration } from "./later-milestone-schema";
import { auditM5Source, type M5Layer } from "./m5-wo1-audit-helpers";

/**
 * M5-WO1 audit — Prowess domain & shared ability construction boundary (PAS-10 M5-WO1 §213–230, §236).
 *
 * Permanent static gate over @prowess/game, the generic @prowess/rules engine, the server materializer and the M3
 * source pipeline, plus the machine-readable M5 invariant catalog and the documentation contract. Negative controls
 * here append a forbidden snippet to a REAL source snapshot in memory and require the audit to catch it; the
 * behavioural controls that mutate files on disk live in scripts/m5-wo1-negative-controls.mjs. Nothing broken is ever
 * committed.
 *
 * Invariants guarded here (docs/architecture/m5-invariants.md): M5-I001 / M5-I002 source authority and preserved
 * ambiguity (documentation contract) · M5-I003 / M5-I004 package boundaries · M5-I012 no hidden calculation (hidden-math
 * rule) · M5-I017 presentation · M5-I018 / M5-I019 source prose and import review · M5-I020 Canon governance · M5-I027
 * no latest / current selection (latest-or-current rule) · M5-I030 frozen M4 baseline.
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

const GAME = production("packages/prowess-game/src");
const WO1_LATER_MILESTONE_FILES = new Set([
  // WO13 active-magic lifecycle content (M4 Formula programs) and transition module are covered by the dedicated WO13 gate.
  "packages/prowess-game/src/content/core-playtest-v0.1/active-magic.ts",
  "packages/prowess-game/src/ability/active-magic.ts",
  // WO12 Effect-chain execution routes M4 core resolutions per target (counters and ordinals, no cost math); covered by the dedicated WO12 gate.
  "packages/prowess-game/src/ability/effect-execution.ts",
  // WO11 final Maneuver-cost Formula content and compiler are covered by the dedicated WO11 gate; all earlier files stay covered.
  "packages/prowess-game/src/content/core-playtest-v0.1/maneuver-cost.ts",
  "packages/prowess-game/src/ability/maneuver-cost.ts",
  // WO10 final Spell-cost Formula content and compiler are covered by the dedicated WO10 gate; all earlier files stay covered.
  "packages/prowess-game/src/content/core-playtest-v0.1/spell-cost.ts",
  "packages/prowess-game/src/ability/spell-cost.ts",
  // WO9 authored Formula content is covered by the dedicated WO9 gate; all earlier files stay covered.
  "packages/prowess-game/src/content/core-playtest-v0.1/duration-conditions.ts",
  "packages/prowess-game/src/ability/duration-conditions.ts",
  "packages/prowess-game/src/content/core-playtest-v0.1/effects.ts",
  "packages/prowess-game/src/content/core-playtest-v0.1/traits.ts",
  "packages/prowess-game/src/content/core-playtest-v0.1/targeting-wo7-amendments.ts",
  "packages/prowess-game/src/effect/compile.ts",
  "packages/prowess-game/src/ability/compile.ts",
  "packages/prowess-game/src/definition/trait-payload.ts",
  "packages/prowess-game/src/definition/authored-ability-payload.ts",
]);
const WO1_GAME = GAME.filter((f) => !WO1_LATER_MILESTONE_FILES.has(f));
const RULES = production("packages/prowess-rules/src");
const MATERIALIZER = production("packages/prowess-db/src/prowess-definition");
const SOURCE = [...production("packages/prowess-import/src"), ...production("packages/prowess-db/src/source-ingestion"), ...production("packages/prowess-db/src/extraction"), ...production("packages/prowess-db/src/source-structure")];
const inventory: Array<[string, M5Layer]> = [
  ...WO1_GAME.map((f) => [f, "game"] as [string, M5Layer]),
  ...RULES.map((f) => [f, "rules"] as [string, M5Layer]),
  ...MATERIALIZER.map((f) => [f, "materializer"] as [string, M5Layer]),
  ...SOURCE.map((f) => [f, "source"] as [string, M5Layer]),
];

describe("M5-WO1 audit — Prowess domain & shared ability construction boundary", () => {
  it("covers every layer", () => {
    expect(GAME.length).toBeGreaterThan(10);
    expect(RULES.length).toBeGreaterThan(20);
    expect(MATERIALIZER).toEqual(["packages/prowess-db/src/prowess-definition/index.ts", "packages/prowess-db/src/prowess-definition/repository.ts", "packages/prowess-db/src/prowess-definition/service.ts"]);
    expect(SOURCE.length).toBeGreaterThan(5);
  });

  it.each(inventory)("%s passes the %s rules", (file, layer) => {
    expect(auditM5Source(read(file), file, layer)).toEqual([]);
  });

  it("M5-I004 @prowess/game depends on @prowess/model and @prowess/rules only — never DB, Import, Prisma, React, Next", () => {
    const pkg = JSON.parse(read("packages/prowess-game/package.json")) as { name: string; dependencies: Record<string, string> };
    expect(pkg.name).toBe("@prowess/game");
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@prowess/model", "@prowess/rules"]);
    const arch = read("scripts/check-architecture.mjs");
    expect(arch).toContain('name: "@prowess/game"');
    expect(arch).toContain('"packages/prowess-game",');
  });

  it("M5-I003 / M5-I030 the generic M4 package is untouched: still model-only, no dependency on @prowess/game", () => {
    const rules = JSON.parse(read("packages/prowess-rules/package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
    for (const dir of ["packages/prowess-model", "packages/prowess-rules", "packages/prowess-import", "packages/prowess-ui"]) {
      expect(read(`${dir}/package.json`), dir).not.toContain("@prowess/game");
    }
  });

  it("M5-I030 M4 invariants, M4 contract version, schema and migrations equal the frozen baseline", () => {
    const baseline = JSON.parse(read("docs/architecture/m5-wo1-baseline.json")) as Record<string, string | Record<string, string>>;
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    const m4Definitions = [...read("docs/architecture/m4-rules-engine-core.md").matchAll(/^- \*\*(M4-I\d+A?)\*\*.*$/gm)].map((m) => m[0]).join("\n");
    expect(hash(read("docs/architecture/m4-final-invariants.json"))).toBe(baseline.m4InvariantCatalogHash);
    expect(hash(m4Definitions)).toBe(baseline.m4InvariantDefinitionsHash);
    expect(hash(read("packages/prowess-rules/src/contract-version.ts"))).toBe(baseline.m4ContractVersionHash);
    expect(hash(frozenSchemaText())).toBe(baseline.schemaHash);
    const migrations = Object.fromEntries(walk("packages/prowess-db/prisma/migrations").filter((f) => f.endsWith("migration.sql")).filter(notLaterMigration).map((f) => [f, hash(read(f))]));
    expect(migrations).toEqual(baseline.migrations);
  });

  it("exact identity, schemaVersion, compiler contract version and source map are required contracts", () => {
    const envelope = read("packages/prowess-game/src/definition/envelope.ts");
    expect(envelope).toMatch(/readonly schemaVersion: number;/);
    expect(envelope).toMatch(/readonly entityVersionId: EntityVersionId;/);
    expect(envelope).not.toMatch(/displayName|latest\w*Version\w*\(/);
    expect(read("packages/prowess-game/src/contract-version.ts")).toContain("export const PROWESS_COMPILATION_CONTRACT_VERSION = 1 as const;");
    const model = read("packages/prowess-game/src/compilation/model.ts");
    for (const t of ["interface ProwessCompilationRequest", "interface ProwessCompiledPlan", "interface ProwessCompilationSourceMap", "readonly evaluationPlan: EvaluationPlan;"]) expect(model).toContain(t);
    // WO1 compiles no mechanics: every component compiler slot is explicitly null.
    expect(read("packages/prowess-game/src/compilation/compile.ts")).not.toMatch(/:\s*\(use|=>\s*\[\s*\{/);
  });

  it("no Prowess mechanics are implemented in WO1 (§211): no Spell / Maneuver / HP / MP / DC formulas anywhere in @prowess/game", () => {
    const code = WO1_GAME.map(read).join("\n");
    expect(code).not.toMatch(/expression:\s*["']/); // no authored Formula source in code — formulas are Definition data
    expect(code).not.toMatch(/\b(floor|ceil)\s*\(/i);
  });

  it("M5-I017 Presentation does not own Prowess mechanics: no Studio code imports @prowess/game or recomputes its contracts", () => {
    const studio = JSON.parse(read("apps/studio/package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(studio.dependencies)).not.toContain("@prowess/game");
    for (const file of [...walk("apps/studio/app"), ...walk("apps/studio/src")].filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(read(file), file).not.toMatch(/@prowess\/game|ABILITY_SLOT_KINDS|compileProwessAbility|PROWESS_DEFINITION_STORAGE_KEY/);
    }
  });

  it("M5-I018 / M5-I019 source prose and import review never become executable Prowess rules automatically", () => {
    // The import pipeline and review code know nothing of Prowess Definitions; only exact, structured EntityVersions
    // pinned by a Manifest / Release are materialized (M5-I018). No importer writes the Definition storage key.
    const importSide = [...production("packages/prowess-import/src"), ...walk("packages/prowess-db/src").filter((f) => /\/(import-|extraction|source-)/.test(f) && f.endsWith(".ts"))];
    expect(importSide.length).toBeGreaterThan(5);
    for (const file of importSide) expect(read(file), file).not.toMatch(/prowessDefinition|@prowess\/game|PROWESS_DEFINITION_STORAGE_KEY/);
    for (const file of GAME) expect(auditM5Source(read(file), file, "game"), file).not.toContain("source-parsing");
  });

  it("M5-I020 Canon governance is explicit and never inferred by the compiler or materializer", () => {
    for (const file of [...GAME, ...MATERIALIZER]) expect(auditM5Source(read(file), file, file.includes("prowess-db") ? "materializer" : "game"), file).not.toContain("canon-governance");
  });

  it("the M5 invariant catalog defines M5-I001–I178 exactly once (M5-WO2 appended I041–I074, M5-WO3 I075–I110, M5-WO4 I111–I150, the post-WO4 rulings I151–I155, M5-WO5 I156–I158, M5-WO6 I159–I178), each with executing automated guards", () => {
    const catalog = JSON.parse(read("docs/architecture/m5-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
    const expected = Array.from({ length: 178 }, (_, i) => `M5-I${String(i + 1).padStart(3, "0")}`);
    expect(catalog.slice(0, 178).map((x) => x.id)).toEqual(expected);
    const md = read("docs/architecture/m5-invariants.md");
    const defined = [...md.matchAll(/^### (M5-I\d{3})\b/gm)].map((m) => m[1]);
    expect(defined.slice(0, 178)).toEqual(expected);
    for (const entry of catalog.slice(0, 178)) {
      expect(entry.guards.length, entry.id).toBeGreaterThan(0);
      expect(md).toContain(entry.title);
      for (const guard of entry.guards) {
        expect(guard).toMatch(/^(packages\/[^/]+\/src\/.*\.test\.ts|packages\/prowess-db\/tests\/(unit|integration)\/.*\.test\.ts|apps\/studio\/tests\/unit\/.*\.test\.ts|scripts\/m5-wo[123456]-negative-controls\.mjs)$/);
        expect(read(guard), `${entry.id} → ${guard}`).toMatch(/\b(it|describe)\s*[.(]|Negative control caught/);
        if (guard.endsWith(".test.ts")) expect(read(guard), `${entry.id} → ${guard}`).toContain(entry.id);
      }
    }
    // M4's frozen catalog is untouched (§234).
    const m4 = JSON.parse(read("docs/architecture/m4-final-invariants.json")) as unknown[];
    expect(m4).toHaveLength(189);
  });

  it("M5-I001 / M5-I002 documents the domain architecture, system map, conflicts and invariants with every required diagram", () => {
    const arch = read("docs/architecture/m5-prowess-domain-compilation.md");
    for (const heading of [
      "Purpose",
      "Source authority",
      "Designer clarifications",
      "M4 / M5 boundary",
      "@prowess/game",
      "Ability Construction",
      "Spell / Maneuver relationship",
      "Shared component contracts",
      "Separate content catalogs",
      "Definition layer",
      "Composition layer",
      "Runtime layer",
      "Presentation layer",
      "Definition envelope",
      "Definition reference",
      "Schema version",
      "Definition bundle",
      "Materialization",
      "Compiler contract",
      "Source map",
      "Historical exactness",
      "Source conflicts",
      "Limitations",
      "Future M5 dependencies",
    ]) {
      expect(arch, heading).toMatch(new RegExp(`^## \\d+\\. ${heading.replace(/[/.]/g, "\\$&")}$`, "m"));
    }
    for (const diagram of ["PROWESS ABILITY", "Targeting alone does not create an effect.", "Spell Targeting      Maneuver Targeting", "Radius Geometry", "Maneuver Card / Inspector", "@prowess/game Compiler", "calculates game result itself", "R2 never changes R1.", "preserved verbatim in SourceDocument"]) {
      expect(arch, diagram).toContain(diagram);
    }
    expect(arch).toMatch(/FUTURE MAPPING/);

    const map = read("docs/architecture/m5-core-playtest-system-map.md");
    for (const family of ["CORE RESOLUTION", "CHARACTER CORE", "SKILLS", "RACES / CHARACTER OPTIONS", "SHARED ACTION ECONOMY", "SHARED RESOURCES", "AFFINITIES", "ABILITY CONSTRUCTION", "SPELLCASTING", "MANEUVERS", "MAGE ARTS", "EQUIPMENT", "SUMMONING", "CONDITIONS / STATUS"]) {
      expect(map, family).toMatch(new RegExp(`^## .*${family.replace(/[/]/g, "\\/")}`, "m"));
    }

    const conflicts = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    const entries = [...conflicts.matchAll(/^### (M5-SC-\d{3})/gm)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThan(1);
    for (const field of ["conflictKey", "systemFamily", "concept", "source A", "source B", "mechanical consequence", "status", "resolution authority", "notes"]) expect(conflicts).toContain(`**${field}**`);
    const statuses = [...conflicts.matchAll(/\*\*status\*\*:\s*`([A-Z_]+)`/g)].map((m) => m[1]);
    expect(statuses.length).toBe(entries.length);
    for (const s of statuses) expect(["UNRESOLVED", "RESOLVED_BY_DESIGNER", "RESOLVED_BY_CANON_DECISION", "SUPERSEDED"]).toContain(s);
    // §12: Evocation / Emission is RESOLVED_BY_DESIGNER, never presented as unresolved.
    const evocation = conflicts.split(/^### /m).find((s) => s.startsWith("M5-SC-001"))!;
    expect(evocation).toMatch(/Emission/);
    expect(evocation).toMatch(/\*\*status\*\*:\s*`RESOLVED_BY_DESIGNER`/);
    expect(evocation).toMatch(/canonical:\s*Evocation/);
    expect(evocation).toMatch(/legacy:\s*Emission/);
  });

  it("M5-I002 every conflict key cited by the terminology inventory exists in the conflicts register", () => {
    const conflicts = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    const cited = [...new Set([...read("packages/prowess-game/src/vocabulary/terminology.ts").matchAll(/conflictKey: "(M5-SC-\d{3})"/g)].map((m) => m[1]))];
    expect(cited.length).toBeGreaterThan(10);
    for (const key of cited) expect(conflicts, key).toMatch(new RegExp(`^### ${key} `, "m"));
  });

  it("the M5-WO1 gate is a permanent named CI step and every M0–M4 gate remains", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("M5-WO1 audit — Prowess domain & shared ability construction boundary");
    for (const file of ["m5-wo1-static.test.ts", "prowess-definition-materialization.test.ts", "m5-source-terminology.test.ts", "m5-wo1-negative-controls.mjs"]) expect(ci).toContain(file);
    for (let i = 1; i <= 11; i += 1) expect(ci).toContain(`M4-WO${i} audit gate`);
    for (const gate of ["M1 audit gate", "M4-WO12 final audit", "Schema drift check", "pnpm run test:e2e", '--filter "@prowess/game"']) expect(ci).toContain(gate);
  });
});

/** In-memory controls (§214–230): a forbidden snippet appended to a real file must be caught by the matching rule. */
const G = (f: string) => `packages/prowess-game/src/${f}`;
const controls: Array<[string, string, string, M5Layer, string]> = [
  ["§214 Prowess logic in M4", "packages/prowess-rules/src/orchestration/orchestrate.ts", 'export const bonus = (affinity: string) => (affinity === "Evocation" ? 1 : 0);', "rules", "prowess-logic-in-m4"],
  ["§215 DB in the game package", G("index.ts"), 'import { prisma } from "@prowess/db";', "game", "package-boundary"],
  ["§216 latest Definition version", G("bundle/bundle.ts"), "export const pick = (defs: { entityVersionId: string }[]) => getLatestEntityVersion(defs);", "game", "latest-or-current"],
  ["§216 latest in the materializer", "packages/prowess-db/src/prowess-definition/repository.ts", 'export const newest = (entityId: string) => prisma.entityVersion.findFirst({ where: { entityId }, orderBy: { revisionNumber: "desc" } });', "materializer", "latest-or-current"],
  ["§217 random step identity", G("compilation/assemble.ts"), 'export const key = () => ["prowess", randomUUID()].join(":");', "game", "environment"],
  ["§217 clock step identity", G("compilation/assemble.ts"), 'export const key = () => ["prowess", Date.now()].join(":");', "game", "environment"],
  ["§218 Emission as canonical Affinity", G("construction/composition.ts"), 'export const canonicalAffinity = { affinity: "EMISSION" };', "game", "legacy-canonical"],
  ["§219 rewriting historical source text", "packages/prowess-db/src/source-ingestion/service.ts", 'export const normalize = (text: string) => text.replace(/Emission/g, "Evocation");', "source", "source-rewrite"],
  ["§220 Spell Effect accepted by contract in a Maneuver", G("construction/composition.ts"), "export const legal = (a: ProwessDefinitionKind, b: ProwessDefinitionKind) => implementSameContract(a, b);", "game", "cross-branch-coercion"],
  ["§221 Spell Trait accepted by contract in a Maneuver", G("construction/composition.ts"), "export const legalTrait = (kind: ProwessDefinitionKind) => PROWESS_DEFINITION_KINDS[kind].contract === \"TRAIT\";", "game", "cross-branch-coercion"],
  ["§222 Radius identity by semantic shape", G("definition/envelope.ts"), "export const same = (a: { payload: { semanticShape: string } }, b: { payload: { semanticShape: string } }) => a.payload.semanticShape === b.payload.semanticShape;", "game", "cross-branch-coercion"],
  ["§223 Radius implies an Agility Save", G("construction/composition.ts"), 'export function resolve(targeting: string) { let save = ""; if (targeting === "RADIUS") save = "AGILITY"; return save; }', "game", "shape-implies-mechanics"],
  ["§223 Radius implies an Agility Save (assignment)", G("construction/composition.ts"), 'export const profile = { save: "AGILITY" };', "game", "implied-resolution"],
  ["§224 Targeting implies Damage", G("compilation/compile.ts"), 'export const implied = (shape: string) => (shape === "RADIUS" ? [{ effectFamily: "DAMAGE" }] : []);', "game", "shape-implies-mechanics"],
  ["§224 Targeting creates catalog content", G("compilation/compile.ts"), 'export const implied = [{ effectFamily: "DAMAGE" }];', "game", "catalog-content-in-code"],
  ["§225 hidden Spell AP math", G("compilation/compile.ts"), "export const ap = (listedMp: number, prowess: number) => Math.max(1, Math.floor(listedMp / prowess));", "game", "hidden-math"],
  ["§226 hidden Maneuver cost", G("compilation/assemble.ts"), "export const finalAp = (base: number, extra: number) => base + extra;", "game", "hidden-math"],
  ["§227 bundle mixing via latest lookup", G("bundle/bundle.ts"), "export const mix = (r2: { definitions: unknown[] }) => getCurrentTrait(r2.definitions);", "game", "latest-or-current"],
  ["§228 display-name identity", G("bundle/bundle.ts"), "export const byLabel = (defs: { displayName: string }[], n: string) => defs.find((d) => d.displayName === n);", "game", "display-name-identity"],
  ["§229 AbilityKind inferred from a weapon", G("construction/composition.ts"), 'export const infer = (c: object) => ("weapon" in c ? "MANEUVER" : "SPELL");', "game", "kind-inference"],
  ["§230 construction Condition applies a status", G("construction/composition.ts"), 'export const collapse = (use: object) => ({ ...use, appliesStatus: "BLOODIED" });', "game", "condition-status-collapse"],
  ["dynamic code", G("compilation/compile.ts"), 'export const run = () => new Function("return 1")();', "game", "dynamic-code"],
  ["dynamic callback registry", G("compilation/compile.ts"), "export function registerComponentCompiler() {}", "game", "dynamic-dispatch"],
  ["keyword mechanics", G("compilation/compile.ts"), 'export const burns = (k: string) => k === "keyword.fire";', "game", "keyword-mechanics"],
  ["SourceDocument parsing in the compiler", G("compilation/compile.ts"), "export const fromProse = (rawText: string) => rawText;", "game", "source-parsing"],
  ["materializer compiles", "packages/prowess-db/src/prowess-definition/service.ts", "export const both = (r: unknown) => compileProwessAbility(r);", "materializer", "materializer-compiles"],
  ["materializer writes", "packages/prowess-db/src/prowess-definition/repository.ts", "export const save = () => prisma.entityVersion.update({ where: { id: \"x\" }, data: {} });", "materializer", "database-write"],
  ["module state", G("compilation/compile.ts"), "export let cache = 0;", "game", "mutable-module-state"],
  ["M5-I020 compiler infers Canon governance", G("compilation/compile.ts"), "export const canonize = (candidateId: string) => approveImportCandidate(candidateId);", "game", "canon-governance"],
  ["M5-I020 materializer publishes", "packages/prowess-db/src/prowess-definition/service.ts", "export const ship = (id: string) => publishRulesetRelease(id);", "materializer", "canon-governance"],
];

describe("M5-WO1 permanent negative controls — mutated real source snapshots", () => {
  it.each(controls)("%s is caught", (_label, file, snippet, layer, finding) => {
    expect(auditM5Source(read(file), file, layer)).toEqual([]);
    expect(auditM5Source(`${read(file)}\n${snippet}\n`, file, layer)).toContain(finding);
  });

  it("documentation comments mentioning forbidden ideas are not findings (AST, not grep)", () => {
    const file = G("compilation/compile.ts");
    expect(auditM5Source(`${read(file)}\n// never: if (shape === "RADIUS") save = "AGILITY"; Math.floor(listedMp / prowess); Emission\n`, file, "game")).toEqual([]);
  });
});
