// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M3-WO5 static audit — Formula, Requirement & Keyword Semantic Extraction. Implementation logic only (comments
 * stripped). Pins: no schema change; prowess.structural@1 unchanged; the semantic extractor is pure, emits only the
 * three allowed kinds, evaluates nothing, hardcodes no game rank / stat vocabulary, resolves nothing, creates nothing,
 * and adds no service, route or UI.
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (dir: string, out: string[] = []) => {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) {
      if (!["node_modules", "dist", ".next", "generated"].includes(e)) walk(f, out);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(f);
  }
  return out;
};
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const SEMANTIC_FILES = ["semantic-declarations.ts", "semantic-formula.ts", "semantic-foundation-v1.ts"].map((f) => path.join(ROOT, "packages", "prowess-import", "src", f));
const CODE = SEMANTIC_FILES.map((f) => strip(readFileSync(f, "utf8"))).join("\n");
/** Code with string and regex literals removed, so pattern vocabulary (e.g. "Requires") is not mistaken for logic. */
const LOGIC = CODE.replace(/\/(?:\\.|[^/\n\\])+\/[giuy]*/g, "/RE/").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`(?:\\.|[^`\\])*`/g, "``");

describe("M3-WO5 database / migration status", () => {
  it("adds no migration (the 21 approved migrations are the whole chain) and no schema change", () => {
    const dir = path.join(ROOT, "packages", "prowess-db", "prisma", "migrations");
    const names = readdirSync(dir).filter((e) => statSync(path.join(dir, e)).isDirectory()).sort();
    // WO5 itself appended nothing after WO4's migration (later Work Orders append their own, e.g. M3-WO6).
    expect(names.indexOf("20261014010000_add_import_entity_matching")).toBe(20);
    expect(names.slice(21)).toEqual(["20261015010000_add_import_decisions"]);
    expect(read("packages", "prowess-db", "prisma", "schema.prisma")).not.toMatch(/model (Semantic\w*|FormulaCandidate|RequirementCandidate|KeywordCandidate|SemanticImportBatch)/);
  });
});

describe("M3-WO5 prowess.structural@1 is unchanged", () => {
  it("structural-v1.ts is byte-identical to its approved M3-WO3 content", () => {
    expect(createHash("sha256").update(read("packages", "prowess-import", "src", "structural-v1.ts")).digest("hex")).toBe("db08a42acb9a444898f35deb67c3ff89ad896ea870ec7cbf9cc7cf68ff37f998");
  });
  it("the semantic extractor is a separate registration with its own exact key and version", () => {
    const v1 = read("packages", "prowess-import", "src", "semantic-foundation-v1.ts");
    expect(v1).toMatch(/SEMANTIC_FOUNDATION_EXTRACTOR_KEY = "prowess\.semantic-foundation"/);
    expect(v1).toMatch(/SEMANTIC_FOUNDATION_EXTRACTOR_VERSION = "1"/);
    expect(strip(read("packages", "prowess-import", "src", "registry.ts"))).toMatch(/OFFICIAL_EXTRACTORS = \[structuralExtractorV1, semanticFoundationExtractorV1\] as const/);
  });
});

describe("M3-WO5 semantic extractor purity and boundary", () => {
  it("imports only @prowess/model and sibling modules; no I/O, clock, randomness, locale, network or AI", () => {
    for (const f of SEMANTIC_FILES) {
      const src = strip(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\bfrom\s+"([^"]+)"/g)) expect(m[1], rel(f)).toMatch(/^(@prowess\/model|\.\/[\w-]+\.js)$/);
    }
    expect(CODE).not.toMatch(/toLocaleLowerCase|toLocaleUpperCase|localeCompare|Intl\.|Math\.random|Date\.now|new Date\(|\bfetch\(|https?:\/\/|"node:|prisma|@prowess\/db|"react|"next/i);
  });

  it("evaluates nothing: no eval, no Function constructor, no arithmetic over source numbers", () => {
    // Source numbers are never converted to JS numbers (no Number / parseFloat / parseInt) and nothing is executed. The
    // only Math call is Math.min over string INDICES when bounding a declaration's span.
    expect(CODE).not.toMatch(/\beval\s*\(|new Function|Function\s*\(|Number\(|parseFloat|parseInt|Math\.(floor|ceil|max|round|pow|trunc)\(/);
    for (const m of CODE.matchAll(/Math\.min\(([^)]*)\)/g)) expect(m[1]).toMatch(/^(end, nl|end, nextMarkerStart)$/);
  });

  it("emits only FORMULA / REQUIREMENT / KEYWORD, with no Entity identity or canonical key", () => {
    const v1 = strip(read("packages", "prowess-import", "src", "semantic-foundation-v1.ts"));
    expect([...new Set([...v1.matchAll(/kind: "(\w+)"/g)].map((m) => m[1]))].sort()).toEqual(["FORMULA", "KEYWORD", "REQUIREMENT"]);
    expect(v1).toMatch(/candidateKind: f\.kind,/);
    expect(v1).toMatch(/proposedEntityType: null,/);
    expect(v1).toMatch(/proposedCanonicalKey: null,/);
    expect(v1).not.toMatch(/"(ENTITY|ENTITY_FIELD|RELATIONSHIP|UNKNOWN|REFERENCE)"/);
  });

  it("hardcodes no game rank, stat, affinity or effect vocabulary and classifies nothing into domain types", () => {
    expect(CODE).not.toMatch(/\b(Trained|Expert|Master|Arcane Rank|Affinity|Martial|Emission|Evocation|Arcana|PER|PRO|CON|MP|AP|HP|Spell Effect|Spell Trait|Maneuver|Weapon|Summon|Damage|Healing|Concentration|Player Dice|Save)\b/);
    expect(LOGIC).not.toMatch(/SPELL_|MANEUVER_|WEAPON_|SUMMON_|statDefinition|resourceDefinition|minimumRank|affinity/i);
  });

  it("resolves nothing and creates nothing: no Entity, Keyword, definition, conflict, decision or release code", () => {
    for (const f of [...SEMANTIC_FILES, ...walk(path.join(ROOT, "packages", "prowess-db", "src", "extraction"))]) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/\b(createEntity|createEntityVersion|createEntityAlias|createKeywordDefinition|createKeyword|createRuleConflict|createCanonDecision|publishRulesetRelease|analyzeImportBatchMatches|findEntitiesByAlias|getLatest\w*)\b/);
      expect(src, rel(f)).not.toMatch(/authorityStatus|sourceAuthority|canonPolicy|comparisonManifest/i);
    }
  });
});

describe("M3-WO5 no new service, route or UI", () => {
  it("the @prowess/db public surface gains no semantic-specific service", () => {
    // Existing createImportBatch + extractImportBatch + getExtractionResult are sufficient (§87).
    expect(read("packages", "prowess-db", "src", "index.ts")).not.toMatch(/extractSemantic|SemanticBatch|semanticFoundation|semantic-foundation/i);
  });
  it("no route, page, component or client references semantic extraction", () => {
    for (const f of [...walk(path.join(ROOT, "apps", "studio", "app")).filter((f) => !rel(f).startsWith("apps/studio/app/developer/import/")) /* M3-WO8 Import Studio: audited by m3-import-ui-static */, ...walk(path.join(ROOT, "apps", "studio", "src", "api-client")).filter((f) => !rel(f).endsWith("src/api-client/import.ts")) /* M3-WO8 Import Studio client: audited by m3-import-ui-static */]) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/semantic-foundation|semanticFoundation|SemanticFinding/);
    }
  });
});

describe("M3-WO5 documentation", () => {
  it("documents the separate Batch, the explicit-only boundary, unresolved terms, no mechanics and the roadmap", () => {
    const doc = read("docs", "architecture", "m3-semantic-foundation-extraction.md");
    for (const phrase of ["prowess.semantic-foundation", "separate ImportBatch", "UNREVIEWED", "prowess.semantic.formula", "prowess.semantic.requirement", "prowess.semantic.keyword", "unresolved", "damage mechanics", "RequirementDefinition created"]) expect(doc).toContain(phrase);
    expect(doc).toMatch(/WO3[\s\S]*structural[\s\S]*WO4[\s\S]*WO5[\s\S]*WO6[\s\S]*WO7[\s\S]*WO8/);
  });
});
