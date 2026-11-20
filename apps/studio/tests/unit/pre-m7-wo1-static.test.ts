// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { COMPENDIUM_SECTIONS, COMPENDIUM_SECTION_KEYS, homeSectionOfKind } from "@prowess/model";
import { describe, expect, it } from "vitest";
import catalog from "./fixtures/m6-wo1-catalog.json";
import { expectedFrozenHash } from "./later-milestone-schema";

/**
 * PRE-M7-WO1 gate — Compendium authoring and rule control. Pins the boundaries this Work Order relies on:
 *   - one home section per Definition kind (presentation only; no kind invented, renamed or dropped);
 *   - the Studio never parses, prints or evaluates a Formula (the server does, through the M4 engine's public validator);
 *   - the Rules Reference stays read-only (GET only; editing happens in Compendium Admin by explicit action);
 *   - the rule preview and Formula operations are POST-with-body tools that write nothing;
 *   - the four registered routes, the CI gate and the journey evidence.
 */
const ROOT = path.resolve(process.cwd(), "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const walk = (d: string): string[] =>
  readdirSync(path.join(ROOT, d)).flatMap((e) => {
    const f = path.join(d, e);
    return statSync(path.join(ROOT, f)).isDirectory() ? walk(f) : [f];
  });
const KINDS = (catalog.kinds as Array<{ definitionKind: string; supportedSchemaVersions: number[] }>).map((k) => k.definitionKind);

describe("PRE-M7-WO1 gate — sections are presentation over the existing kinds", () => {
  it("every catalog kind has exactly one home section; sections name only catalog kinds", () => {
    expect([...COMPENDIUM_SECTION_KEYS]).toEqual(COMPENDIUM_SECTIONS.map((s) => s.key));
    for (const k of KINDS) {
      const homes = COMPENDIUM_SECTIONS.filter((s) => s.kinds.includes(k) || s.reservedKinds.includes(k));
      expect(homes.map((s) => s.key), k).toHaveLength(1);
      expect(homeSectionOfKind(k)?.key, k).toBe(homes[0]!.key);
    }
    for (const s of COMPENDIUM_SECTIONS) for (const k of [...s.kinds, ...s.alsoShows, ...s.reservedKinds]) expect(KINDS, `${s.key} → ${k}`).toContain(k);
  });

  it("reserved kinds are exactly the catalog kinds with no supported schema version (never offered as editable)", () => {
    const reserved = COMPENDIUM_SECTIONS.flatMap((s) => s.reservedKinds).sort();
    const unsupported = (catalog.kinds as Array<{ definitionKind: string; supportedSchemaVersions: number[] }>).filter((k) => k.supportedSchemaVersions.length === 0).map((k) => k.definitionKind).sort();
    expect(reserved).toEqual(unsupported);
  });
});

describe("PRE-M7-WO1 gate — Formula authority and read-only reference", () => {
  const studio = [...walk("apps/studio/app"), ...walk("apps/studio/src")].filter((f) => /\.(ts|tsx)$/.test(f));

  it("no Studio UI file imports the rules engine or parses a Formula (the server does)", () => {
    for (const f of studio.filter((x) => x.startsWith("apps/studio/app/compendium/"))) {
      const src = read(f);
      expect(src, f).not.toContain("@prowess/rules");
      expect(src, f).not.toMatch(/parseFormulaExpression|validateFormulaProgram|evaluateFormula|new Function|eval\(/);
    }
  });

  it("the server-side guided Formula never parses or evaluates: it reads the engine-validated tree only", () => {
    const pres = strip(read("packages/prowess-db/src/compendium-rules/formula-presentation.ts"));
    expect(pres).toMatch(/import \{ validateFormulaProgram, type FormulaNode \} from "@prowess\/rules";/);
    expect(pres).not.toMatch(/parseFormulaExpression|evaluateFormula|orchestrateRulesEvaluation|prisma/);
    const guide = strip(read("packages/prowess-db/src/compendium-rules/formula-guide.ts"));
    expect(guide).not.toMatch(/@prowess\/rules|prisma|evaluate/);
  });

  it("the Rules Reference stays GET-only; the Stat page links to Compendium Admin instead of writing", () => {
    for (const f of walk("apps/studio/app/compendium/rulesets").filter((x) => /\.(ts|tsx)$/.test(x))) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"|authoring-client|rules-client/);
    }
    const stat = strip(read("apps/studio/app/compendium/rulesets/_components/StatAffectsPage.tsx"));
    expect(stat).toMatch(/adminEntityHref\(def\.entityId\)/);
    expect(stat).not.toMatch(/createRevision|previewRuleCandidate/);
  });

  it("the preview and Formula routes are POST-with-body tools over pure services; nothing is written", () => {
    for (const f of ["apps/studio/app/api/compendium-rules/preview/route.ts", "apps/studio/app/api/compendium-rules/formula/route.ts"]) {
      const src = strip(read(f));
      expect(src, f).toMatch(/export async function POST/);
      expect(src, f).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
      expect(src, f).toMatch(/Unknown field\(s\)/);
    }
    const service = strip(read("packages/prowess-db/src/compendium-rules/service.ts"));
    expect(service).not.toMatch(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$transaction|\$executeRaw/);
    expect(service).toMatch(/const candidateContext: RulesetContext = \{ \.\.\.base, manifestHash: null, release: null, rules \};/);
  });

  it("registers exactly its four routes and runs as a named CI gate with the transfer proof", () => {
    const routes = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, string[]>;
    expect([...(routes["PRE-M7-WO1"] ?? [])].sort()).toEqual([
      "apps/studio/app/api/compendium-rules/formula/route.ts",
      "apps/studio/app/api/compendium-rules/preview/route.ts",
      "apps/studio/app/api/compendium-rules/releases/[releaseId]/entities/[entityId]/usage/route.ts",
      "apps/studio/app/api/compendium-rules/releases/[releaseId]/stats/[stat]/route.ts",
    ]);
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("node scripts/ci/verify-gate.mjs PRE-M7-WO1 apps/studio/tests/unit/pre-m7-wo1-static.test.ts");
    expect(ci).toContain("node scripts/distribution/verify-pre-m7-wo1-transfer.mjs");
    expect(read("apps/studio/tests/e2e/pre-m7-wo1-strength-armor.spec.ts")).toMatch(/S01[\s\S]*S06/);
  });
});

describe("PRE-M7-WO1 gate — invariants", () => {
  it("M6-I190–I197 are declared after the last M6 invariant, documented, and name existing guards", () => {
    const invariants = JSON.parse(read("docs/architecture/m6-invariants.json")) as { id: string; title: string; guards: string[] }[];
    expect(invariants.map((x) => x.id)).toEqual(Array.from({ length: invariants.length }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const expected = Array.from({ length: 8 }, (_, i) => `M6-I${String(i + 190).padStart(3, "0")}`);
    const rows = invariants.filter((x) => expected.includes(x.id));
    expect(rows.map((x) => x.id)).toEqual(expected);
    const md = read("docs/architecture/m6-invariants.md");
    expect(md).toContain("## PRE-M7-WO1 — Compendium Authoring And Rule Control (M6-I190 – M6-I197)");
    for (const row of rows) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      for (const f of row.guards) expect(existsSync(path.join(ROOT, f)), `${row.id}: ${f}`).toBe(true);
    }
  });
});

describe("PRE-M7-WO1 gate — the one approved M5 change (MAGE_ART v1, authoring and reference only)", () => {
  const G = "packages/prowess-game/src/";
  const sha = (f: string) => createHash("sha256").update(readFileSync(path.join(ROOT, f))).digest("hex");
  const entry = (JSON.parse(read("docs/architecture/m6-approved-m5-changes.json")) as Record<string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> }>)["PRE-M7-WO1"]!;

  it("registers exactly the activated kind, its reader, its export and the registry tests that characterize it — at their exact hashes", () => {
    expect(Object.keys(entry.changedFiles).sort()).toEqual(
      ["card-phase-b.test.ts", "definition/payload.ts", "index.ts", "m6-wo3-registry.test.ts", "m6-wo4-registry.test.ts", "m6-wo6-registry.test.ts", "m6-wo9-registry.test.ts", "vocabulary/families.ts"].map((f) => G + f),
    );
    expect(Object.keys(entry.addedFiles).sort()).toEqual([G + "definition/mage-art-payload.ts", G + "pre-m7-wo1-mage-art.test.ts"]);
    // A file this entry approved may change again ONLY through a LATER registered entry (RULES-WO1), at that exact hash.
    for (const [f, h] of [...Object.entries(entry.changedFiles), ...Object.entries(entry.addedFiles)]) expect(sha(f), f).toBe(expectedFrozenHash(f, h));
  });

  it("MAGE_ART is activated for reading only: no compiler, card, pricing or play module reads the payload", () => {
    // RULES-WO1 later adds version 2 beside version 1 (still reference only — the rest of this test is unchanged).
    expect(read(G + "vocabulary/families.ts")).toContain('MAGE_ART: { family: "MAGE_ART", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1, 2] },');
    expect(read(G + "definition/payload.ts")).toContain('else if (kind === "MAGE_ART") payload = readMageArtPayload(value, at, p);');
    expect(read(G + "compilation/compile.ts")).toContain("MAGE_ART: null,");
    const readers = walk(G.slice(0, -1)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && strip(read(f)).includes("mage-art-payload"));
    expect(readers.map((f) => f.split(path.sep).join("/")).sort()).toEqual([G + "definition/payload.ts", G + "index.ts"]);
    expect(homeSectionOfKind("MAGE_ART")?.key).toBe("magic-abilities");
    expect(COMPENDIUM_SECTIONS.flatMap((s) => s.reservedKinds)).not.toContain("MAGE_ART");
  });
});
