// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RULES-WO1 gate — Complete Game Authoring (Phase B scope). Pins the boundaries this Work Order relies on:
 *   - exactly its approved @prowess/game change (three additive kinds, their reader, evaluator and preview) at exact
 *     hashes, one registered route and NO schema change;
 *   - authored rules are evaluated only by M4 and read only by their own consumers: nothing in play or combat reads the
 *     Concentration rule, and the preview says so;
 *   - no unstated base or canonical Carry formula is invented; the shipped content is unchanged;
 *   - build identity reaches Studio's About page; the invariants, CI gate and negative controls.
 */
const ROOT = path.resolve(process.cwd(), "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const sha = (f: string) => createHash("sha256").update(readFileSync(path.join(ROOT, f))).digest("hex");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const walk = (d: string): string[] =>
  readdirSync(path.join(ROOT, d)).flatMap((e) => {
    const f = path.join(d, e);
    return statSync(path.join(ROOT, f)).isDirectory() ? walk(f) : [f];
  });
const G = "packages/prowess-game/src/";
const GAME_CODE = walk(G.slice(0, -1)).map((f) => f.split(path.sep).join("/")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/testing/"));

describe("RULES-WO1 gate — the approved M5 change is additive and exact", () => {
  const entry = (JSON.parse(read("docs/architecture/m6-approved-m5-changes.json")) as Record<string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> }>)["RULES-WO1"]!;

  it("registers exactly the kinds, readers, evaluator, preview, sheet extension and characterizing tests — at their exact hashes", () => {
    expect(Object.keys(entry.changedFiles).sort()).toEqual(
      ["character/sheet.ts", "compilation/compile.ts", "definition/payload.ts", "index.ts", "m6-wo3-registry.test.ts", "m6-wo4-registry.test.ts", "m6-wo6-registry.test.ts", "m6-wo9-registry.test.ts", "vocabulary/families.ts"].map((f) => G + f),
    );
    expect(Object.keys(entry.addedFiles).sort()).toEqual(["ability/concentration-preview.ts", "character/calculated-values.ts", "definition/rules-authoring-payload.ts", "rules-wo1-authoring.test.ts"].map((f) => G + f));
    for (const [f, h] of [...Object.entries(entry.changedFiles), ...Object.entries(entry.addedFiles)]) expect(sha(f), f).toBe(h);
  });

  it("adds three version-1 kinds and leaves every other line of the kind table alone", () => {
    const families = read(G + "vocabulary/families.ts");
    for (const line of ['CALCULATED_VALUE: active("CHARACTER"),', 'SKILL_BENEFIT: active("SKILL"),', 'CONCENTRATION_RULE: active("ABILITY"),']) expect(families).toContain(line);
    for (const k of ["CALCULATED_VALUE", "SKILL_BENEFIT", "CONCENTRATION_RULE"]) expect(read(G + "compilation/compile.ts")).toContain(`  ${k}: null,`);
    expect(read(G + "definition/payload.ts")).toContain("else if (isRulesAuthoringPayloadKind(kind)) payload = readRulesAuthoringPayload(kind, value, at, p);");
  });

  it("registers one route and no schema or migration change", () => {
    expect((JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>)["RULES-WO1"]).toEqual(["apps/studio/app/api/compendium-rules/authored-preview/route.ts"]);
    expect((JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>)["RULES-WO1"]).toBeUndefined();
    expect(read("packages/prowess-db/prisma/schema.prisma")).not.toContain("RULES-WO1");
  });
});

describe("RULES-WO1 gate — authored rules are M4-evaluated and read only by their own consumers", () => {
  it("the evaluator and the preview run every number through M4 evaluateFormula", () => {
    for (const f of ["character/calculated-values.ts", "ability/concentration-preview.ts"]) {
      const src = strip(read(G + f));
      expect(src, f).toMatch(/import \{ evaluateFormula \} from "@prowess\/rules";/);
      expect(src, f).not.toMatch(/Math\.|\.reduce\(/);
    }
  });

  it("only the payload reader, the index, the evaluator, the preview and the sheet read the new contracts", () => {
    const readers = (needle: string) => GAME_CODE.filter((f) => strip(read(f)).includes(needle)).sort();
    expect(readers("rules-authoring-payload")).toEqual([G + "ability/concentration-preview.ts", G + "character/calculated-values.ts", G + "definition/payload.ts", G + "index.ts"]);
    expect(readers("concentration-preview")).toEqual([G + "index.ts"]);
    expect(readers("calculated-values")).toEqual([G + "character/sheet.ts", G + "index.ts"]);
  });

  it("no play, combat or Active Magic module reads the Concentration rule; the preview states it does not apply in play", () => {
    for (const f of GAME_CODE.filter((x) => /\/(play|ability)\//.test(x) && !x.endsWith("concentration-preview.ts"))) expect(strip(read(f)), f).not.toMatch(/CONCENTRATION_RULE|previewConcentration/);
    expect(read(G + "ability/concentration-preview.ts")).toContain("appliesInPlay: false as const,");
    expect(read("apps/studio/app/compendium/admin/_components/AuthoredRulePreviewPanel.tsx")).toContain("Preview only — combat does not use this rule yet.");
  });

  it("the Studio preview and sheet show server numbers only (no Formula evaluation in the browser)", () => {
    for (const f of ["apps/studio/app/compendium/admin/_components/AuthoredRulePreviewPanel.tsx", "apps/studio/app/characters/_components/sheet/SheetPanels.tsx"]) {
      expect(strip(read(f)), f).not.toMatch(/evaluateFormula|@prowess\/(game|rules|db)/);
    }
    expect(read("apps/studio/app/api/compendium-rules/authored-preview/route.ts")).toContain('Object.keys(body).filter((k) => !["releaseId", "drafts", "sample"].includes(k))');
  });
});

describe("RULES-WO1 gate — nothing unstated is invented", () => {
  it("the shipped content defines no calculated value, Skill benefit or Concentration rule (no canonical Carry formula)", () => {
    const content = walk(G + "content").filter((f) => /\.(json|ts)$/.test(f));
    for (const f of content) expect(read(f), f).not.toMatch(/CALCULATED_VALUE|SKILL_BENEFIT|CONCENTRATION_RULE|CARRY_CAPACITY/);
  });

  it("a non-canonical rule must say why, a canonical rule must cite its source, and an unstated base stays null", () => {
    const reader = strip(read(G + "definition/rules-authoring-payload.ts"));
    expect(reader).toContain('if (canonStatus === "CANONICAL" && rawSource === null)');
    expect(reader).toContain('if (canonStatus !== null && canonStatus !== "CANONICAL" && note === null)');
    expect(reader).toContain("const base = rawBase === null ? null :");
    expect(strip(read(G + "character/calculated-values.ts"))).toContain("const parts = [...(base === null ? [] : [base]),");
  });
});

describe("RULES-WO1 gate — build identity reaches Studio", () => {
  it("the desktop controller passes version, commit, tree and package fingerprint; Studio's About page reads them", () => {
    const controller = read("scripts/distribution/desktop/controller.mjs");
    expect(controller).toContain("PROWESS_APP_VERSION: manifest.appVersion, PROWESS_BUILD_COMMIT: manifest.build.commit, PROWESS_BUILD_TREE: manifest.build.tree,");
    expect(controller).toContain("PROWESS_PACKAGE_SHA256: manifest.packageSha256,");
    expect(read("apps/studio/app/about/page.tsx")).toContain("buildIdentity(process.env, studioPackage.version)");
    expect((JSON.parse(read("apps/studio/package.json")) as { version: string }).version).toBe("0.1.3");
  });
});

describe("RULES-WO1 gate — invariants, CI and controls", () => {
  it("RW1-I001–I009 are documented and name existing guards", () => {
    const invariants = JSON.parse(read("docs/architecture/rules-wo1-invariants.json")) as { id: string; title: string; guards: string[] }[];
    expect(invariants.map((x) => x.id)).toEqual(Array.from({ length: 9 }, (_, i) => `RW1-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/rules-wo1-invariants.md");
    for (const row of invariants) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      for (const f of row.guards) expect(existsSync(path.join(ROOT, f)), `${row.id}: ${f}`).toBe(true);
    }
  });

  it("the CI gate runs this file, the UI test and the game contract test, then the negative controls", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("node scripts/ci/verify-gate.mjs RULES-WO1 apps/studio/tests/unit/rules-wo1-static.test.ts apps/studio/tests/unit/rules-wo1-authoring-ui.test.tsx packages/prowess-game/src/rules-wo1-authoring.test.ts");
    expect(ci).toMatch(/PROWESS_EXPECT_CONTROLS=\d+ node scripts\/rules-wo1-negative-controls\.mjs/);
  });
});
