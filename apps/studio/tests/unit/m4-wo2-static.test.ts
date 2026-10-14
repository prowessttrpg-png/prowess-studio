// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4-WO2 Exact Ruleset Resolver — static audit (PAS-10 M4-WO2 §31, §63–§68, §71–§73). Invariant ids refer to
 * docs/architecture/m4-rules-engine-core.md:
 * M4-I16 Exact Manifest Resolution · M4-I17 Exact Release Resolution · M4-I18 Effective Manifest Reuses M2 Inheritance
 * · M4-I19 Release Context Uses Frozen Composition · M4-I20 Release Integrity Verified Before Evaluation ·
 * M4-I22 Resolver Never Uses Implicit Latest · M4-I25 Ruleset Resolution Is Read-Only.
 *
 * The scanners are plain functions, proven by in-memory control snippets below — no broken file is ever committed.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const walk = (d: string, out: string[] = []) => {
  for (const e of readdirSync(d)) {
    if (["node_modules", "dist", ".next", "generated"].includes(e)) continue;
    const f = path.join(d, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const RESOLVER_DIR = path.join(ROOT, "packages", "prowess-db", "src", "ruleset-context");
const RESOLVER_FILES = walk(RESOLVER_DIR).filter((f) => f.endsWith(".ts"));
const SERVICE = read("packages", "prowess-db", "src", "ruleset-context", "service.ts");

/** Forbidden anywhere in the resolver implementation. */
const FORBIDDEN: Array<{ id: string; pattern: RegExp }> = [
  { id: "hidden-latest", pattern: /latest|newest|mostRecent|currentVersion|getCurrent\w*|findCurrent\w*|isCurrent\b|getActive\w*|resolveDefault\w*/i },
  { id: "descending-choice", pattern: /["']desc["']/ },
  { id: "persistence-write", pattern: /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$queryRaw|\$transaction|insert\w*\s*\(/ },
  { id: "local-inheritance", pattern: /parentManifestId|loadInheritanceChain|flattenInheritanceChain|resolveEffectiveEntityVersion|selectManifestEntries|selectManifestEntry\b|rulesetManifestEntry|prisma\.rulesetManifest|prisma\.rulesetRelease|selectManifestPins/ },
  { id: "local-hash", pattern: /computeManifestHash|canonicalManifestText|createHash|node:crypto|sha256|MANIFEST_HASH_FORMAT/i },
  { id: "canon-selection", pattern: /canonPolicy|CanonPolicy|CanonDecision|canonDecision|RuleConflict|ruleConflict|SourceAuthority|resolveSourceAuthority|GOVERNING/ },
  { id: "import-review", pattern: /ImportBatch|importBatch|ExtractionCandidate|extractionCandidate|ImportDecision|importDecision|ImportMatch|importMatch|MatchRun|import-review|import-batch|import-match/ },
  { id: "alias-or-display", pattern: /alias|displayName|display_name|structuredData|rulesText|shortDescription/i },
  { id: "formula", pattern: /formula|\bparse\w*\s*\(|\bevaluate\w*\s*\(|Math\.(round|floor|ceil|trunc)/i },
  { id: "game-vocabulary", pattern: /\b(spells?|mana|affinit(y|ies)|damage|weapons?|maneuvers?|characters?|summon\w*)\b|\b(AP|MP)\b/i },
  { id: "context-cast", pattern: /as\s+RulesetContext\b|(^|[=(,:\s])<RulesetContext>\s*[\w(]/m },
  { id: "clock-or-random", pattern: /Date\.now|new\s+Date\b|Math\.random|randomUUID/ },
  { id: "untyped-any", pattern: /:\s*any\b|\bas\s+any\b/ },
];
const audit = (source: string) => FORBIDDEN.filter((r) => r.pattern.test(strip(source))).map((r) => r.id);

/** The body of one exported function, for call-graph pinning. */
function body(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return strip(source.slice(start, nextExport === -1 ? undefined : nextExport));
}
const callIndex = (text: string, fn: string) => text.search(new RegExp(`\\b${fn}\\s*\\(`));

/** Call-graph rules for the two resolution modes. Returns violations. */
function auditModes(source: string): string[] {
  const v: string[] = [];
  const manifest = body(source, "resolveRulesetContextFromManifest");
  const release = body(source, "resolveRulesetContextFromRelease");
  if (callIndex(manifest, "getEffectiveManifestEntries") < 0) v.push("manifest-mode-must-use-M2-inheritance");
  if (/verifyRulesetReleaseManifestHash|getRulesetRelease/.test(manifest)) v.push("manifest-mode-must-not-use-release");
  const verify = callIndex(release, "verifyRulesetReleaseManifestHash");
  const get = callIndex(release, "getRulesetRelease");
  const build = callIndex(release, "buildRulesetContextFromComposition");
  if (verify < 0) v.push("release-mode-must-verify-integrity");
  if (get < 0) v.push("release-mode-must-use-frozen-composition");
  if (verify >= 0 && (get < verify || build < verify)) v.push("release-integrity-must-be-verified-first");
  if (!/\.valid\b/.test(release)) v.push("release-mode-must-check-verification-result");
  if (/getEffectiveManifestEntries|resolveRulesetContextFromManifest/.test(release)) v.push("release-mode-must-not-use-live-manifest");
  if (!/release\.composition/.test(release)) v.push("release-mode-must-read-release-composition");
  if (callIndex(manifest, "buildRulesetContextFromComposition") < 0 || build < 0) v.push("context-must-be-built-by-composition");
  return v;
}

describe("M4-WO2 static audit — scanner control tests (§72–73)", () => {
  it.each([
    ["const m = await getLatestRulesetManifest(rulesetId);", "hidden-latest"],
    ['const rows = await prisma.entity.findMany({ orderBy: { createdAt: "desc" } });', "descending-choice"],
    ['const v = await prisma.entityVersion.findMany({ orderBy: { revisionNumber: "desc" } });', "descending-choice"],
    ["await prisma.entity.update({ where: { id }, data: {} });", "persistence-write"],
    ["let id = manifest.parentManifestId; while (id) { id = (await selectRulesetManifestById(id))?.parentManifestId ?? null; }", "local-inheritance"],
    ["const pins = await selectManifestEntries(manifestId);", "local-inheritance"],
    ["const ok = computeManifestHash(pins) === release.manifestHash;", "local-hash"],
    ["const p = await getLatestCanonPolicy(rulesetId);", "canon-selection"],
    ["const d = await prisma.importDecision.findMany();", "import-review"],
    ["const e = await findEntitiesByAlias(name);", "alias-or-display"],
    ["const v = parseFormula(text);", "formula"],
    ['if (key === "spell.ap") return 4;', "game-vocabulary"],
    ["return raw as RulesetContext;", "context-cast"],
    ["const ctx = <RulesetContext>raw;", "context-cast"],
    ["const at = Date.now();", "clock-or-random"],
  ])("catches %s", (snippet, id) => expect(audit(snippet)).toContain(id));

  const good = `
export async function resolveRulesetContextFromManifest(id: string) {
  const effective = await getEffectiveManifestEntries(id);
  return buildRulesetContextFromComposition({ effective });
}
export async function resolveRulesetContextFromRelease(id: string) {
  const verification = await verifyRulesetReleaseManifestHash(id);
  if (!verification.valid) throw new Error();
  const release = await getRulesetRelease(id);
  return buildRulesetContextFromComposition({ pins: release.composition });
}
`;
  it("accepts the approved call graph, and a generic type argument is not a cast", () => {
    expect(auditModes(good)).toEqual([]);
    expect(audit("export async function f(): Promise<RulesetContext> { return build(); }")).toEqual([]);
  });
  it.each([
    ["release mode rebuilt from the live manifest", good.replace("pins: release.composition", "pins: await getEffectiveManifestEntries(release.manifestId)"), "release-mode-must-not-use-live-manifest"],
    ["integrity skipped", good.replace("const verification = await verifyRulesetReleaseManifestHash(id);\n  if (!verification.valid) throw new Error();\n", ""), "release-mode-must-verify-integrity"],
    ["integrity checked after reading", good.replace("const verification = await verifyRulesetReleaseManifestHash(id);\n  if (!verification.valid) throw new Error();\n  const release = await getRulesetRelease(id);", "const release = await getRulesetRelease(id);\n  const verification = await verifyRulesetReleaseManifestHash(id);\n  if (!verification.valid) throw new Error();"), "release-integrity-must-be-verified-first"],
    ["verification result ignored", good.replace("if (!verification.valid) throw new Error();", "void verification;"), "release-mode-must-check-verification-result"],
    ["manifest mode without M2 inheritance", good.replace("await getEffectiveManifestEntries(id)", "await myOwnTraversal(id)"), "manifest-mode-must-use-M2-inheritance"],
  ])("catches %s", (_label, source, id) => expect(auditModes(source)).toContain(id));
});

describe("M4-WO2 static audit — the resolver implementation", () => {
  it("covers the resolver module", () => {
    expect(RESOLVER_FILES.map(rel).sort()).toEqual(
      ["composition.ts", "index.ts", "repository.ts", "service.ts"].map((f) => `packages/prowess-db/src/ruleset-context/${f}`),
    );
  });

  it.each(RESOLVER_FILES.map((f) => [rel(f), f]))("%s has no hidden latest, write, local inheritance / hash, Canon, import, alias, formula or game logic (M4-I22 M4-I25)", (_n, f) => {
    expect(audit(readFileSync(f, "utf8"))).toEqual([]);
  });

  it("M4-I16 M4-I17 M4-I18 M4-I19 M4-I20: Manifest mode reuses M2 inheritance; Release mode verifies integrity first, then uses the frozen composition", () => {
    expect(auditModes(SERVICE)).toEqual([]);
    expect(strip(SERVICE)).toMatch(/import \{ getEffectiveManifestEntries \} from "\.\.\/ruleset-inheritance\/index\.js"/);
    expect(strip(SERVICE)).toMatch(/import \{ getRulesetRelease, verifyRulesetReleaseManifestHash \} from "\.\.\/ruleset-release\/index\.js"/);
  });

  it("the context is built only through the @prowess/rules constructor", () => {
    const composition = strip(read("packages", "prowess-db", "src", "ruleset-context", "composition.ts"));
    expect(composition).toMatch(/import \{ createRulesetContext, type RulesetContext \} from "@prowess\/rules"/);
    expect(composition).toMatch(/createRulesetContext\(/);
  });

  it("identity hydration is batched (no N+1), read-only, id-ordered, and touches only Entity / EntityVersion", () => {
    const repo = strip(read("packages", "prowess-db", "src", "ruleset-context", "repository.ts"));
    expect([...repo.matchAll(/prisma\.(\w+)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`)).toEqual(["entity.findMany", "entityVersion.findMany"]);
    expect(repo.match(/id: \{ in: /g)?.length).toBe(2);
    expect(repo.match(/orderBy: \{ id: "asc" \}/g)?.length).toBe(2);
  });
});

describe("M4-WO2 public surface and boundaries (§32, §63–64, §67)", () => {
  it("exports exactly the two exact-input resolvers", () => {
    expect(strip(read("packages", "prowess-db", "src", "ruleset-context", "index.ts")).trim()).toBe(
      'export { resolveRulesetContextFromManifest, resolveRulesetContextFromRelease } from "./service.js";',
    );
    expect(read("packages", "prowess-db", "src", "index.ts")).toContain(
      'export { resolveRulesetContextFromManifest, resolveRulesetContextFromRelease } from "./ruleset-context/index.js";',
    );
  });

  it("no Ruleset-id-only, current, active, default or latest context resolver exists anywhere", () => {
    const sources = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps"))].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !rel(f).includes("/tests/"));
    for (const f of sources) {
      expect(strip(readFileSync(f, "utf8")), rel(f)).not.toMatch(
        /function\s+(resolveRulesetContext|resolveCurrentRuleset\w*|getActiveRulesetContext|resolveDefaultRules|resolveLatestContext)\s*\(/,
      );
    }
  });

  it("@prowess/db may now use @prowess/rules; @prowess/rules still depends on @prowess/model only", () => {
    const db = JSON.parse(read("packages", "prowess-db", "package.json")) as { dependencies: Record<string, string> };
    expect(db.dependencies["@prowess/rules"]).toBe("workspace:*");
    const rules = JSON.parse(read("packages", "prowess-rules", "package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(rules.dependencies)).toEqual(["@prowess/model"]);
  });

  it("adds no schema, migration, persisted context table, route or UI (§58–62)", () => {
    const schema = read("packages", "prowess-db", "prisma", "schema.prisma");
    expect(schema).not.toMatch(/evaluation_rulesets|resolved_rulesets|ruleset_contexts|active_rules|current_rule_versions|model\s+(RulesetContext|ResolvedRuleset|ActiveRule)/);
    const migrations = readdirSync(path.join(ROOT, "packages", "prowess-db", "prisma", "migrations")).filter((e) => /^\d{14}_/.test(e));
    expect(migrations).toHaveLength(22);
    for (const f of walk(path.join(ROOT, "apps", "studio")).filter((file) => /\.(ts|tsx)$/.test(file) && !rel(file).includes("/tests/"))) {
      // M4-WO10: only its application service resolves a context (through this resolver) and calls @prowess/rules.
      if (rel(f) === "apps/studio/src/rules-evaluation/service.ts" || rel(f).startsWith("apps/studio/app/developer/rules/") || rel(f) === "apps/studio/src/api-client/rules.ts") continue;
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/resolveRulesetContextFrom|@prowess\/rules/);
    }
  });

  it("permanent CI runs this audit as a named gate", () => {
    expect(read(".github", "workflows", "ci.yml")).toContain("tests/unit/m4-wo2-static.test.ts");
  });
});

describe("M4 invariant catalog and coverage matrix (WO2 entries)", () => {
  const doc = read("docs", "architecture", "m4-rules-engine-core.md");
  const ids = Array.from({ length: 10 }, (_, i) => `M4-I${String(i + 16).padStart(2, "0")}`);
  const tests = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "apps", "studio", "tests"))].filter((f) => /\.test\.ts$/.test(f));

  it("names M4-I16 – M4-I25 and maps every one to an existing automated guard that cites it", () => {
    for (const id of ids) {
      expect(doc, id).toMatch(new RegExp(`\\*\\*${id}\\*\\*`));
      const row = doc.split("\n").find((l) => l.startsWith(`| ${id} `));
      expect(row, `coverage row for ${id}`).toBeDefined();
      const files = [...(row as string).matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1] as string);
      expect(files.length, id).toBeGreaterThan(0);
      for (const f of files) expect(tests.some((t) => t.endsWith(f)), `${id}: ${f} exists`).toBe(true);
      expect(files.some((f) => readFileSync(tests.find((t) => t.endsWith(f)) as string, "utf8").includes(id)), `${id} is cited by one of its guards`).toBe(true);
    }
  });
});
