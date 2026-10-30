// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectedFrozenHash, frozenFileContent, frozenSchemaText, notLaterFile } from "./later-milestone-schema";
import catalog from "./fixtures/m6-wo1-catalog.json";

/**
 * M6-WO2 permanent architecture gate — Compendium Rules Reference & Structured Browsing (PAS-10 M6-WO2).
 *
 * Guards M6-I011 Release-scoped membership · M6-I012 a pin is never substituted by a Latest Revision · M6-I013
 * historical reproducibility · M6-I014 server-side facets · M6-I015 presentation reuses the one descriptor set ·
 * M6-I016 exact references never rewritten · M6-I017 server-side verification and Latest Release by explicit query ·
 * M6-I018 composition comparison through M2 · M6-I019 exact Release context in every URL · M6-I020 read-only.
 * Its negative / mutation controls are scripts/m6-wo2-negative-controls.mjs (shared CLOSEOUT-03 harness).
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
const fn = (src: string, name: string) => {
  const start = src.search(new RegExp(`export (async )?function ${name}\\(`));
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end + 2);
};

const UI_DIR = "apps/studio/app/compendium/rulesets";
const UI = code(UI_DIR);
const ROUTES = walk("apps/studio/app/api/compendium-reference").filter((f) => f.endsWith("route.ts"));
const DB = code("packages/prowess-db/src/compendium-reference");
const SERVICE = strip(read("packages/prowess-db/src/compendium-reference/service.ts"));
const REPOSITORY = strip(read("packages/prowess-db/src/compendium-reference/repository.ts"));
const CLIENT = strip(read(`${UI_DIR}/_lib/reference-client.ts`));
const KIND_NAMES = (catalog.kinds as Array<{ definitionKind: string }>).map((k) => k.definitionKind);

describe("M6-WO2 gate — layering and read-only surface (M6-I020)", () => {
  it("scans the real Rules Reference surface", () => {
    expect(UI.length).toBeGreaterThanOrEqual(14);
    expect(ROUTES.length).toBe(6);
    expect(DB.length).toBe(3);
  });

  it("the Rules Reference UI never imports Prisma, @prowess/db, a repository, the M5 package or a mutating client", () => {
    for (const f of UI) {
      const src = read(f);
      for (const [, spec] of src.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
        expect(spec, `${f} imports ${spec}`).not.toMatch(/^(@prisma|prisma$|pg$|@prowess\/db|@prowess\/game|@prowess\/rules)|generated\/prisma|repository|prowess-db|prowess-game|authoring-client/);
      }
      // The one governance import is the paginated, read-only Ruleset list.
      for (const [, names] of src.matchAll(/import \{([^}]*)\} from "[./]*src\/api-client\/governance"/g)) expect((names ?? "").trim(), f).toBe("listAllRulesets");
      expect(strip(src), f).not.toMatch(/\bmethod:\s*"(POST|PUT|PATCH|DELETE)"|localStorage|sessionStorage|indexedDB/);
    }
  });

  it("the reference client issues GET requests only, to the read-only routes and the shared catalog / Keyword reads", () => {
    expect(CLIENT).toMatch(/await fetchJsonBody\(path\);/);
    expect(CLIENT).not.toMatch(/fetchJsonBody\(path,|method|body:/);
    for (const [, url] of CLIENT.matchAll(/`(\/api\/[^`$]+)/g)) expect(url).toMatch(/^\/api\/compendium-(reference\/rulesets\/|authoring\/(catalog|keywords))/);
  });

  it("routes are thin GET-only adapters over @prowess/db's compendium-reference reads, with central error mapping", () => {
    for (const f of ROUTES) {
      const src = strip(read(f));
      for (const [, spec] of src.matchAll(/from\s+"([^"]+)"/g)) expect(spec, `${f}: ${spec}`).toMatch(/^(@prowess\/db|(\.\.\/)+src\/api\/(index|m2\/index))$/);
      expect(src, f).toMatch(/import \{ (compareReferenceReleases|getReferenceEntry|getReferenceRelease|listReferenceEntries|listReferenceReleases|resolveLatestReferenceRelease) \} from "@prowess\/db";/);
      expect([...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]), f).toEqual(["GET"]);
      expect(src, f).toMatch(/catch \(error\) \{\s*return toErrorResponse\(error\);/);
      expect(src, f).toMatch(/strictQuery\(/);
      expect(src, f).not.toMatch(/\bprisma\b|readStrictBody/);
    }
  });

  it("the route inventory equals the reviewed M6-WO2 registry entry (the M5 freezes accept exactly these additions)", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>;
    // Later Work Orders append their own keys (each pinned by its own gate); M6-WO2's entry stays exactly these routes.
    expect(Object.keys(registry).filter((k) => k !== "$comment").slice(0, 2)).toEqual(["M6-WO1", "M6-WO2"]);
    expect([...(registry["M6-WO2"] as string[])].sort()).toEqual([...ROUTES].sort());
  });

  it("the reference read module writes nothing: no create / update / delete / raw execute / transaction / publication", () => {
    for (const f of DB) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction|\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|\w+\s+SET)\b|publishRulesetRelease|createChangeSet|createRulesetManifest|transitionEntityVersionStatus/);
    }
    expect(read("packages/prowess-db/src/compendium-reference/index.ts")).not.toMatch(/\b(create|update|set|delete|publish|approve)\w*,/);
  });
});

describe("M6-WO2 gate — Release-scoped membership, exact pins, no latest substitution (M6-I011, M6-I012, M6-I013)", () => {
  it("every pinned-entry query is keyed by the Release manifest and reads the EXACT pinned EntityVersion", () => {
    expect(REPOSITORY).toMatch(/JOIN entity_versions v ON v\.id = me\.entity_version_id AND v\.entity_id = me\.entity_id/);
    const queries = [...REPOSITORY.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)].map((m) => m[1] as string);
    expect(queries.length).toBe(5);
    for (const q of queries) expect(q).toMatch(/\$\{FROM\}/);
    expect(REPOSITORY).toMatch(/const and: Prisma\.Sql\[\] = \[Prisma\.sql`me\.manifest_id = \$\{manifestId\}::uuid`\];/);
    for (const name of ["selectPinnedEntriesForEntities", "selectPinnedEntriesReferencing", "selectPinnedEntriesSharingKeywords"]) expect(fn(REPOSITORY, name), name).toMatch(/me\.manifest_id = \$\{manifestId\}::uuid/);
    // No inheritance reconstruction: Release manifests are flattened; the reference never walks parents.
    expect(`${REPOSITORY}${SERVICE}`).not.toMatch(/parent_manifest_id|parentManifestId|getEffectiveManifestEntries|ruleset-inheritance/);
  });

  it("the entry is the manifest's pin; the latest revision is an indicator only and never selects content", () => {
    const entry = fn(SERVICE, "getReferenceEntry");
    expect(entry).toMatch(/const pin = isUuid\(id\) \? await selectManifestEntry\(release\.manifestId, id\) : null;/);
    expect(entry).toMatch(/selectEntityVersionById\(pin\.entityVersionId\)/);
    expect(entry).toMatch(/COMPENDIUM_REFERENCE_ERROR_CODES\.ENTITY_NOT_IN_RELEASE/);
    expect([...SERVICE.matchAll(/selectLatestRevisionNumber\(/g)]).toHaveLength(1);
    expect(entry).toMatch(/latestRevisionNumber,\n/);
    expect(`${SERVICE}${REPOSITORY}`).not.toMatch(/selectLatestVersionsByEntityIds|getLatestEntityVersion|listEntities\(|orderBy: \{ revisionNumber: "desc" \}/);
    expect(fn(REPOSITORY, "selectLatestRevisionNumber")).toMatch(/_max: \{ revisionNumber: true \}/);
  });

  it("membership never depends on re-validating content: the reference never calls M5 validation or materialization", () => {
    for (const f of DB) expect(strip(read(f)), f).not.toMatch(/validateStoredProwessDefinition|validateDefinitionCandidate|materializeProwess|@prowess\/game|@prowess\/rules/);
  });

  it("a Release outside the URL's Ruleset is refused — no other Release is used as a fallback", () => {
    const require = SERVICE.slice(SERVICE.indexOf("async function requireRelease("), SERVICE.indexOf("export function readDeclaredDefinition("));
    expect(require).toMatch(/if \(release\.rulesetId !== ruleset\.id\) \{\s*throw new DomainError\(COMPENDIUM_REFERENCE_ERROR_CODES\.RELEASE_NOT_IN_RULESET/);
    expect(require).not.toMatch(/Latest|findFirst/);
  });
});

describe("M6-WO2 gate — Latest Release, verification and comparison reuse M2 (M6-I017, M6-I018)", () => {
  it("getLatestRulesetRelease is called once, by the explicit Latest Release resolver, which returns an exact Release", () => {
    expect([...SERVICE.matchAll(/getLatestRulesetRelease\(/g)]).toHaveLength(1);
    expect(fn(SERVICE, "resolveLatestReferenceRelease")).toMatch(/const latest = await getLatestRulesetRelease\(ruleset\.id\);/);
    // No stored pointer: the schema is unchanged since the certified baseline (checked below) and no write exists.
    const controls = strip(read(`${UI_DIR}/_components/ReleaseControls.tsx`));
    expect(controls).toMatch(/onClick=\{async \(\) => \{[\s\S]*await resolveLatestRelease\(rulesetId\);[\s\S]*router\.push\(releaseHref\(rulesetId, release\.id\)\)/);
    for (const f of UI.filter((x) => !x.endsWith("ReleaseControls.tsx") && !x.endsWith("reference-client.ts"))) expect(strip(read(f)), f).not.toMatch(/resolveLatestRelease\(/);
  });

  it("manifest verification and comparison are the M2 services, unchanged; the UI never hashes", () => {
    expect(fn(SERVICE, "getReferenceRelease")).toMatch(/verifyRulesetReleaseManifestHash\(release\.id\)/);
    expect(fn(SERVICE, "compareReferenceReleases")).toMatch(/const diff = await compareRulesetReleases\(a\.id, b\.id\);/);
    for (const f of UI) expect(strip(read(f)), f).not.toMatch(/crypto|subtle\.digest|sha256|computeManifestHash/i);
  });
});

describe("M6-WO2 gate — presentation: one descriptor set, no mechanics, no inferred kind (M6-I015, M6-I016, M6-I019)", () => {
  it("presenters reuse the WO1 descriptors (presentationDescriptorFor) and name no Definition kind themselves", () => {
    const presenter = strip(read(`${UI_DIR}/_components/DefinitionPresenter.tsx`));
    expect(presenter).toMatch(/import \{ groupsOf, presentationDescriptorFor, type ContractDescriptor, type FieldDescriptor \} from "\.\.\/\.\.\/admin\/_lib\/descriptors";/);
    expect(read("apps/studio/app/compendium/admin/_lib/descriptors.ts")).toMatch(/const descriptor = descriptorFor\(kind, schemaVersion\);/);
    for (const f of UI) {
      const src = strip(read(f));
      expect(KIND_NAMES.filter((k) => src.includes(`"${k}"`)), f).toEqual([]);
      expect(src, f).not.toMatch(/ABILITY_SLOT_KINDS|PROWESS_DEFINITION_KINDS|compileProwessAbility|eval\(|new Function/);
    }
  });

  it("the Definition kind is read only from stored data; generic content gets none", () => {
    const declared = fn(SERVICE, "readDeclaredDefinition");
    expect(declared).not.toMatch(/displayName|canonicalKey|rulesText|entityType/);
    expect(fn(SERVICE, "getReferenceEntry")).toMatch(/readDeclaredDefinition\(pinnedRevision\.structuredData\.prowessDefinition\)/);
  });

  it("raw JSON appears only inside the Developer details disclosure", () => {
    for (const f of UI) {
      const src = strip(read(f));
      const uses = [...src.matchAll(/JSON\.stringify\(/g)].length;
      if (f.endsWith("DefinitionPresenter.tsx")) {
        expect(uses, f).toBe(1);
        expect(src).toMatch(/<summary>Developer details — stored structured data \(raw JSON\)<\/summary>\s*<pre>\{JSON\.stringify\(detail\.pinnedRevision\.structuredData, null, 2\)\}<\/pre>/);
      } else expect(uses, f).toBe(0);
    }
  });

  it("exact references are rendered as authored next to the pin; links keep the Release in the URL", () => {
    expect(fn(SERVICE, "getReferenceEntry")).toMatch(/authored: ref,/);
    expect(fn(SERVICE, "getReferenceEntry")).toMatch(/matchesPin: pinned !== null && pinned\.entityVersionId === normalizeId\(ref\.entityVersionId\)/);
    const view = strip(read(`${UI_DIR}/_components/EntryDetailView.tsx`));
    expect(view).toMatch(/Referenced Definition is not part of this Release\./);
    expect(view).toMatch(/Version mismatch: the authored reference names \{authored\}; this Release pins Revision \{r\.pinned\.revisionNumber\}\./);
    for (const f of UI) expect(strip(read(f)), f).not.toMatch(/href=\{?[`"]\/compendium\/rulesets/);
    expect(strip(read(`${UI_DIR}/_lib/reference-urls.ts`))).toMatch(/export const entryHref = \(rulesetId: string, releaseId: string, entityId: string\) => `\$\{releaseHref\(rulesetId, releaseId\)\}\/entities\/\$\{enc\(entityId\)\}`;/);
  });

  it("no authority-claiming terminology: Latest Release / Release N only", () => {
    for (const f of UI) expect(strip(read(f)), f).not.toMatch(/current release|current rule|current canon|active version|active release|canon version/i);
  });
});

describe("M6-WO2 gate — boundaries with M2 / M4 / M5 and the shell (§108)", () => {
  const baseline = JSON.parse(read("docs/architecture/m6-wo2-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string> };

  it("no schema, migration, M4 source or M5 source changed since the M6-WO2 base (no file added, removed or edited)", () => {
    expect(baseline.baseCommit).toBe("799f1b2dcb2939184d4c8703cb06b0678bfa5482");
    for (const [f, h] of Object.entries(baseline.frozenFiles)) expect(hash(frozenFileContent(f)), f).toBe(expectedFrozenHash(f, h)); // M6-WO3: registered later changes only
    const now = [...walk("packages/prowess-rules/src"), ...walk("packages/prowess-db/prisma"), ...walk("packages/prowess-game/src")].filter(notLaterFile).sort();
    expect(now).toEqual(Object.keys(baseline.frozenFiles).sort());
  });

  it("the M2 UI-boundary scans exclude exactly the read-only Rules Reference directory, documented", () => {
    for (const f of ["apps/studio/tests/unit/m2-ruleset-static.test.ts", "apps/studio/tests/unit/m2-ruleset-release-static.test.ts"]) {
      const src = read(f);
      expect([...src.matchAll(/"compendium", "rulesets"/g)], f).toHaveLength(1);
      expect(src, f).toMatch(/M6-WO2: the read-only Compendium Rules Reference/);
    }
  });

  it("the top-bar Ruleset selector stays a viewing control over every page of Rulesets", () => {
    const shell = strip(read("apps/studio/app/components/AppShell.tsx"));
    expect(shell).toMatch(/listAllRulesets\(\)/);
    expect(shell).not.toMatch(/compendium\/rulesets|releaseId/);
  });

  it("unresolved Structured Canon conflicts stay unresolved (M5-SC-042…053) and M5-SC-054 stays resolved", () => {
    const register = read("docs/architecture/m5-core-playtest-source-conflicts.md");
    const section = (k: string) => register.split(/^### /m).find((s) => s.startsWith(k)) ?? "";
    for (let n = 42; n <= 53; n += 1) if (section(`M5-SC-0${n}`) !== "") expect(section(`M5-SC-0${n}`)).toContain("`UNRESOLVED`");
    expect(section("M5-SC-054")).toContain("`RESOLVED_BY_DESIGNER`");
  });

  it("the /compendium landing offers Rules Reference, Entity Library and Compendium Admin", () => {
    const landing = read("apps/studio/app/compendium/page.tsx");
    expect(landing).toMatch(/href="\/compendium\/rulesets">Rules Reference<\/Link>/);
    expect(landing).toMatch(/href="#entity-library">Entity Library<\/a>/);
    expect(landing).toMatch(/href="\/compendium\/admin">Compendium Admin/);
  });
});

describe("M6-WO2 gate — invariants, documentation and CI", () => {
  const inv = JSON.parse(read("docs/architecture/m6-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
  it("M6-I011–I020 follow M6-I001–I010 (later Work Orders append after them), are documented, and each is guarded by executing files that cite it", () => {
    expect(inv.slice(0, 20).map((x) => x.id)).toEqual(Array.from({ length: 20 }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    for (const row of inv.slice(10, 20)) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo2-static.test.ts");
      for (const g of row.guards) {
        expect(existsSync(path.join(ROOT, g)), g).toBe(true);
        if (/\.test\.tsx?$/.test(g)) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
    }
  });

  it("the architecture document and the implementation report exist with their required sections", () => {
    const doc = read("docs/architecture/m6-compendium-rules-reference.md");
    for (const h of ["Rules Reference Architecture", "Release Scoping", "Routes", "Read API", "Structured Presentation", "References", "Comparison", "Boundaries", "Known Limitations"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h}$`, "m"));
    const report = read("docs/reports/m6-wo2-implementation-report.md");
    for (const h of ["Test Totals", "Architecture Gate", "Controls"]) expect(report, h).toMatch(new RegExp(`^## \\d+\\. ${h}`, "m"));
  });

  it("the M6-WO2 gate is a named step of the consolidated CI workflow with its exact control count", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/- name: M6-WO2 — Compendium Rules Reference & Structured Browsing\n\s+run: \|\n[\s\S]*?node scripts\/ci\/verify-gate\.mjs M6-WO2 [^\n]*\n\s+PROWESS_EXPECT_CONTROLS=\d+ node scripts\/m6-wo2-negative-controls\.mjs/);
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { gates: Array<{ id: string; controls: { script: string } | null }> };
    expect(gates.gates.find((g) => g.id === "M6-WO2")?.controls?.script).toBe("scripts/m6-wo2-negative-controls.mjs");
    expect(existsSync(path.join(ROOT, ".github/workflows/m6-wo2.yml"))).toBe(false);
  });
});
