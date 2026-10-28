// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "./fixtures/m6-wo1-catalog.json";

/**
 * M6-WO1 permanent architecture gate — Compendium Administration Foundation (PAS-10 M6-WO1 §76–79).
 *
 * Guards M6-I001 storage · M6-I002 no UI mechanics / no second catalog · M6-I003 server-side M5 validation · M6-I004
 * immutable history · M6-I005 M2-owned publication · M6-I006 exact references · M6-I007 side-effect-free validation and
 * preview · M6-I008 server-allocated revisions · M6-I009 approved Keyword vocabulary · M6-I010 no inferred kind.
 * Its negative / mutation controls are scripts/m6-wo1-negative-controls.mjs (shared CLOSEOUT-03 harness).
 */
const ROOT = path.resolve(process.cwd(), "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((e) => {
    const rel = `${dir}/${e}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
const code = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));

const ADMIN_UI = code("apps/studio/app/compendium/admin");
const ROUTES = walk("apps/studio/app/api/compendium-authoring").filter((f) => f.endsWith("route.ts"));
const AUTHORING_DB = code("packages/prowess-db/src/compendium-authoring");
const SERVICE = strip(read("packages/prowess-db/src/compendium-authoring/service.ts"));
const VALIDATION = strip(read("packages/prowess-db/src/compendium-authoring/validation.ts"));
const CATALOG_SRC = strip(read("packages/prowess-db/src/compendium-authoring/catalog.ts"));
const KIND_NAMES = (catalog.kinds as Array<{ definitionKind: string }>).map((k) => k.definitionKind);
const VOCABULARY_VALUES = Object.values(catalog.vocabularies as Record<string, string[]>).flat();
/** The body of one exported function (up to the next top-level `export`). */
const fn = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}(`) >= 0 ? src.indexOf(`export async function ${name}(`) : src.indexOf(`export function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end + 2);
};

describe("M6-WO1 gate — layering (§37–38, M6-I002)", () => {
  it("scans the real authoring surface", () => {
    expect(ADMIN_UI.length).toBeGreaterThanOrEqual(12);
    expect(ROUTES.length).toBe(10);
    expect(AUTHORING_DB.length).toBe(5);
  });

  it("the Compendium frontend never imports Prisma, @prowess/db, a repository or the M5 domain package", () => {
    for (const f of [...ADMIN_UI, ...code("apps/studio/app/compendium/_components"), ...code("apps/studio/app/compendium/_lib")]) {
      for (const [, spec] of read(f).matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
        expect(spec, `${f} imports ${spec}`).not.toMatch(/^(@prisma|prisma$|pg$|@prowess\/db|@prowess\/game)|generated\/prisma|repository|prowess-db|prowess-game/);
      }
    }
    expect(read("scripts/check-architecture.mjs")).toMatch(/name: "apps\/studio \(app\/compendium\/\)"[\s\S]*?"@prowess\/db"/);
    expect(JSON.parse(read("apps/studio/package.json")).dependencies).not.toHaveProperty("@prowess/game");
  });

  it("authoring routes are thin adapters over @prowess/db's public surface: shape only, central error mapping", () => {
    for (const f of ROUTES) {
      const src = strip(read(f));
      for (const [, spec] of src.matchAll(/from\s+"([^"]+)"/g)) expect(spec, `${f}: ${spec}`).toMatch(/^(@prowess\/db|(\.\.\/)+src\/api\/(index|m2\/index|compendium-authoring\/input))$/);
      expect(src, f).not.toMatch(/\b(prisma|validateStoredProwessDefinition|readStoredProwessDefinition|createProwessDefinitionEnvelope|PROWESS_DEFINITION_KINDS|createChangeSet|publishRulesetRelease|transitionEntityVersionStatus)\b/);
      expect([...src.matchAll(/catch \(error\)/g)].length, f).toBe([...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].length);
      expect(src, f).toMatch(/return toErrorResponse\(error\);/);
      expect(src, f).not.toMatch(/export async function (PATCH|DELETE)\b/);
    }
  });

  it("the route inventory equals the reviewed M6 route registry (the M5 freezes accept exactly these additions)", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>;
    expect(Object.keys(registry).filter((k) => k !== "$comment")).toEqual(["M6-WO1"]);
    expect([...(registry["M6-WO1"] as string[])].sort()).toEqual([...ROUTES].sort());
    for (const r of registry["M6-WO1"] as string[]) expect(r).toMatch(/^apps\/studio\/app\/api\/compendium-authoring\//);
  });
});

describe("M6-WO1 gate — one Definition catalog, no duplicated M5 validation, no UI mechanics (§8, §13–14, §40, §76)", () => {
  it("M6-I002 the authoring catalog is computed from PROWESS_DEFINITION_KINDS and names no kind itself", () => {
    expect(CATALOG_SRC).toMatch(/import \{[\s\S]*PROWESS_DEFINITION_KINDS[\s\S]*\} from "@prowess\/game";/);
    expect(CATALOG_SRC).toMatch(/PROWESS_DEFINITION_KIND_NAMES\.map\(kindRow\)/);
    for (const k of KIND_NAMES) expect(CATALOG_SRC, k).not.toContain(`"${k}"`);
  });

  it("M6-I002 no Studio source carries a Definition-kind table or M5 vocabulary values", () => {
    for (const f of [...ADMIN_UI, ...code("apps/studio/src")]) {
      const src = strip(read(f));
      const kinds = KIND_NAMES.filter((k) => src.includes(`"${k}"`));
      // descriptors.ts may select the AFFINITY version-1 PRESENTATION by kind name — the one sanctioned literal.
      expect(kinds, f).toEqual(f.endsWith("_lib/descriptors.ts") ? ["AFFINITY"] : []);
      const values = VOCABULARY_VALUES.filter((v) => new RegExp(`["'\`]${v}["'\`]`).test(src));
      expect(values, f).toEqual([]);
      expect(src, f).not.toMatch(/ABILITY_SLOT_KINDS|PROWESS_DEFINITION_STORAGE_KEY|compileProwessAbility|TARGETING_FORBIDDEN_KEYS/);
    }
  });

  it("M6-I003 no duplicate M5 validator: authoring validation delegates to validateStoredProwessDefinition and only classifies its codes", () => {
    expect(VALIDATION).toMatch(/validateStoredProwessDefinition\(\{ entityType, structuredData: \{ prowessDefinition: candidate \} \}\)/);
    expect(VALIDATION).toMatch(/HARD_DEFINITION_CODES: readonly string\[\] = \[\s*DEFINITION_ERROR_CODES\./);
    for (const f of [...AUTHORING_DB, ...ADMIN_UI]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/"PROWESS_DEFINITION\.\w+"|semanticShape\s*===|effectFamily\s*===|readDefinitionPayload|readEnvelope|forbiddenKeyPaths|prowess-game\/src/);
    }
  });

  it("M6-I003 Create and Save refuse unstorable candidates on the SERVER before any write", () => {
    for (const name of ["createAuthoredDefinition", "updateAuthoredDraftDefinition"]) {
      const body = fn(SERVICE, name);
      expect(body, name).toMatch(/await validateDefinitionCandidate\(/);
      expect(body, name).toMatch(/if \(validation\.refused\) throw refusal\(validation\);/);
    }
    const create = fn(SERVICE, "createAuthoredDefinition");
    expect(create.indexOf("throw refusal(validation)")).toBeLessThan(create.indexOf("await createEntity("));
  });

  it("the M5 package's approved public-surface addition is exported and used only through @prowess/db", () => {
    expect(read("packages/prowess-game/src/index.ts")).toMatch(/validateStoredProwessDefinition,/);
    const users = [...code("packages/prowess-db/src"), ...code("apps/studio/app"), ...code("apps/studio/src")].filter((f) => /validateStoredProwessDefinition/.test(strip(read(f))));
    expect(users.sort()).toEqual(["packages/prowess-db/src/compendium-authoring/service.ts", "packages/prowess-db/src/compendium-authoring/validation.ts"]);
  });
});

describe("M6-WO1 gate — lifecycle, history and identity (§7, §17–18, §43, §46, §67)", () => {
  it("M6-I004 Save edits only a DRAFT (M1 guard + optimistic updatedAt check) and never creates a revision", () => {
    const save = fn(SERVICE, "updateAuthoredDraftDefinition");
    expect(save).toMatch(/if \(!canMutateEntityVersionContent\(version\.status\)\)/);
    expect(save).toMatch(/COMPENDIUM_AUTHORING_ERROR_CODES\.STALE_REVISION/);
    expect(save).toMatch(/await updateDraftEntityVersion\(/);
    expect(save).not.toMatch(/createEntityVersion\(|transitionEntityVersionStatus\(/);
  });

  it("M6-I008 revisions are created DRAFT by the M1 allocator; no route accepts a revision number or status", () => {
    const revise = fn(SERVICE, "createAuthoredRevision");
    expect(revise).toMatch(/createEntityVersion\(entityId, \{[\s\S]*status: "DRAFT",[\s\S]*parentVersionId: base\.id/);
    expect(fn(SERVICE, "createAuthoredDefinition")).toMatch(/status: "DRAFT"/);
    for (const f of ROUTES) {
      for (const [, list] of strip(read(f)).matchAll(/readStrictBody\(request, \[([^\]]*)\]\)/g)) expect(list, f).not.toMatch(/"(revisionNumber|status|entityId|entityVersionId|parentVersionId|id)"/);
    }
  });

  it("M6-I010 the Definition kind is read only from stored structured data — never from names, text or EntityType", () => {
    const body = fn(SERVICE, "storedDefinitionKind");
    expect(body).toMatch(/structuredData\[STORAGE_FIELD\]/);
    expect(body).not.toMatch(/displayName|canonicalKey|rulesText|entityType|shortDescription/);
    expect(fn(SERVICE, "updateAuthoredDraftDefinition")).toMatch(/COMPENDIUM_AUTHORING_ERROR_CODES\.NOT_A_DEFINITION/);
    expect(fn(SERVICE, "updateAuthoredDraftDefinition")).toMatch(/COMPENDIUM_AUTHORING_ERROR_CODES\.DEFINITION_KIND_CHANGE/);
  });

  it("no latest / current selection and no deletion anywhere in authoring", () => {
    for (const f of [...AUTHORING_DB, ...ADMIN_UI, ...ROUTES]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/\b(get|select)Latest\w*\(|findFirst\(|currentVersion|activeVersion|deleteMany|prisma\.\w+\.delete\(|removeEntity\b|deleteEntity/);
    }
  });
});

describe("M6-WO1 gate — Ruleset / Canon boundary (§31–35, M6-I005)", () => {
  it("the only M2 call is createChangeSet with ONE exact PIN_ENTITY_VERSION proposal; nothing publishes or pins", () => {
    const propose = fn(SERVICE, "proposeDefinitionChangeSet");
    expect(propose).toMatch(/return createChangeSet\(input\.rulesetId, \{/);
    expect(propose).toMatch(/operationType: "PIN_ENTITY_VERSION"/);
    expect(propose).toMatch(/toEntityVersionId: version\.id/);
    for (const f of [...AUTHORING_DB, ...ADMIN_UI]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/publishRulesetRelease|createRulesetManifest|approveChangeSet|approveRuleset|\/releases\b/);
    }
    // No authoring code moves a revision into an authority-looking state.
    for (const f of AUTHORING_DB) expect(strip(read(f)), f).not.toMatch(/"(CANON|PLAYTEST|APPROVED)"/);
    for (const f of ADMIN_UI) expect(strip(read(f)), f).not.toMatch(/\{\s*status:\s*"(CANON|PLAYTEST|APPROVED|DEPRECATED|SUPERSEDED)"\s*\}/);
    expect([...SERVICE.matchAll(/transitionEntityVersionStatus\(/g)].length).toBe(1);
    expect(fn(SERVICE, "submitAuthoredRevisionForReview")).toMatch(/transitionEntityVersionStatus\(versionId, "IN_REVIEW"/);
  });

  it("the Ruleset hand-off context is explicit; the top-bar selector stays a viewing control over every page of Rulesets", () => {
    const workspace = strip(read("apps/studio/app/compendium/admin/_components/RevisionWorkspace.tsx"));
    expect(workspace).toMatch(/Ruleset \(explicit authoring context\)/);
    expect(workspace).not.toMatch(/usePathname|viewedRulesetId/);
    const shell = strip(read("apps/studio/app/components/AppShell.tsx"));
    expect(shell).toMatch(/listAllRulesets\(\)/);
    expect(shell).toMatch(/onChange=\{\(id\) => router\.push/);
    expect(strip(read("apps/studio/src/api-client/governance.ts"))).toMatch(/if \(pagination === null \|\| page >= pagination\.totalPages\) break;/);
  });
});

describe("M6-WO1 gate — exact references and side-effect-free preview (M6-I006, M6-I007)", () => {
  it("the reference picker hands back the exact reference object, never a display name", () => {
    const picker = strip(read("apps/studio/app/compendium/admin/_components/DefinitionReferencePicker.tsx"));
    expect(picker).toMatch(/onClick=\{\(\) => onSelect\(r\.ref\)\}/);
    expect(picker).not.toMatch(/onSelect\([^)]*displayName/);
    expect(VALIDATION).toMatch(/INVALID_DEFINITION_REFERENCE/);
    expect(VALIDATION).toMatch(/row\.entity\.canonicalKey !== ref\.canonicalKey/);
  });

  it("Preview and the validation panel import no mutation; validation storage adds no flag", () => {
    for (const f of ["DefinitionPreview.tsx", "ValidationPanel.tsx"]) {
      const src = strip(read(`apps/studio/app/compendium/admin/_components/${f}`));
      expect(src, f).not.toMatch(/import \{[^}]*\} from "\.\.\/_lib\/authoring-client"|saveDraft|createDefinition|createRevision|fetch\(/);
    }
    // No validity flag (§62): the schema is byte-identical to the certified baseline.
    const baseline = JSON.parse(read("docs/architecture/m6-wo1-baseline.json")) as { frozenFiles: Record<string, string> };
    expect(hash(readFileSync(path.join(ROOT, "packages/prowess-db/prisma/schema.prisma")))).toBe(baseline.frozenFiles["packages/prowess-db/prisma/schema.prisma"]);
  });

  it("M6-I009 payload Keywords are checked against the Keyword vocabulary; pickers offer only existing Keywords", () => {
    expect(VALIDATION).toMatch(/UNKNOWN_KEYWORD/);
    expect(VALIDATION).toMatch(/selectKeywordsByCanonicalKeys\(keys\)/);
    expect(strip(read("apps/studio/app/compendium/admin/_components/KeywordPicker.tsx"))).toMatch(/searchKeywords\(/);
    expect(strip(read("apps/studio/app/compendium/admin/_components/KeywordPicker.tsx"))).not.toMatch(/createKeyword|POST/);
  });

  it("§57 the Targeting descriptor has no Effect / outcome / resolution field", () => {
    const desc = read("apps/studio/app/compendium/admin/_lib/descriptors.ts");
    const targeting = desc.slice(desc.indexOf("  TARGETING: {"), desc.indexOf("  EFFECT: {"));
    expect(targeting).not.toMatch(/key: "(resolution|outcomes|effectFamily|damage|healing|save\w*)"/);
  });
});

describe("M6-WO1 gate — frozen M4 / M5 / schema (§80–81)", () => {
  const baseline = JSON.parse(read("docs/architecture/m6-wo1-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string>; approvedM5SurfaceChange: { files: Record<string, string>; addedExports: string[] } };

  it("M6-I001 no M4 source, no schema or migration, and no M5 mechanics file changed since the certified baseline", () => {
    expect(baseline.baseCommit).toBe("91658f717bc8c09e7e973175bb5370071d5442b3");
    for (const [f, h] of Object.entries(baseline.frozenFiles)) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
    const now = [...walk("packages/prowess-rules/src"), ...walk("packages/prowess-db/prisma"), ...walk("packages/prowess-game/src")].sort();
    expect(now).toEqual([...Object.keys(baseline.frozenFiles), ...Object.keys(baseline.approvedM5SurfaceChange.files), "packages/prowess-game/src/stored-definition-validation.test.ts"].sort());
  });

  it("the approved M5 surface change is exactly the reviewed addition", () => {
    expect(Object.keys(baseline.approvedM5SurfaceChange.files).sort()).toEqual(["packages/prowess-game/src/definition/envelope.ts", "packages/prowess-game/src/definition/storage.ts", "packages/prowess-game/src/index.ts"]);
    const index = read("packages/prowess-game/src/index.ts");
    for (const e of baseline.approvedM5SurfaceChange.addedExports) expect(index).toContain(e);
  });

  it("unresolved Structured Canon conflicts stay unresolved (M5-SC-042…053) and M5-SC-054 stays resolved (§55)", () => {
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    const section = (key: string) => register.split(/^### /m).find((s) => s.startsWith(key)) ?? "";
    for (let n = 42; n <= 53; n += 1) {
      const key = `M5-SC-0${n}`;
      if (section(key) !== "") expect(section(key), key).toContain("`UNRESOLVED`");
    }
    expect(section("M5-SC-054")).toContain("`RESOLVED_BY_DESIGNER`");
  });
});

describe("M6-WO1 gate — invariants, documentation and CI (§77, §79, §83)", () => {
  const inv = JSON.parse(read("docs/architecture/m6-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
  it("M6-I001–I010 are sequential, documented, and each guarded by executing files that cite it", () => {
    expect(inv.map((x) => x.id)).toEqual(Array.from({ length: 10 }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    for (const row of inv) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo1-static.test.ts");
      for (const g of row.guards) {
        expect(existsSync(path.join(ROOT, g)), g).toBe(true);
        if (/\.test\.tsx?$/.test(g)) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
    }
    expect(read("docs/architecture/m5-invariants.json")).not.toContain("M6-I");
  });

  it("the architecture document and the implementation report exist with their required sections", () => {
    const doc = read("docs/architecture/m6-compendium-administration.md");
    for (const h of ["Authoring Architecture", "Definition Storage", "Lifecycle", "Validation", "Compendium Routes", "M5 Bridge", "M2 Bridge", "Known Limitations"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h}$`, "m"));
    const report = read("docs/reports/m6-wo1-implementation-report.md");
    for (const h of ["Test Totals", "Architecture Gate", "Controls"]) expect(report, h).toMatch(new RegExp(`^## \\d+\\. ${h}`, "m"));
  });

  it("the M6-WO1 gate is a named step of the consolidated CI workflow with its exact control count", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/- name: M6-WO1 audit — Compendium Administration Foundation\n\s+run: \|\n[\s\S]*?node scripts\/ci\/verify-gate\.mjs M6-WO1 [^\n]*\n\s+PROWESS_EXPECT_CONTROLS=\d+ node scripts\/m6-wo1-negative-controls\.mjs/);
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { gates: Array<{ id: string; controls: { script: string; count: number } | null }> };
    const gate = gates.gates.find((g) => g.id === "M6-WO1");
    expect(gate?.controls?.script).toBe("scripts/m6-wo1-negative-controls.mjs");
    expect(existsSync(path.join(ROOT, ".github/workflows/m6-wo1.yml"))).toBe(false);
  });
});
