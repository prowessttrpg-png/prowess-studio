// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectedFrozenHash, frozenSchemaText, laterMigrations } from "./later-milestone-schema";

/**
 * M6-WO3 permanent architecture gate — Character Domain Model & Character Creation (PAS-10 M6-WO3 §107).
 *
 * Guards M6-I021 exact immutable Release pin · M6-I022 Release isolation · M6-I023 derived state recalculated, never
 * stored · M6-I024 Characters are player state, not Entity records · M6-I025 finalization freeze · M6-I026 atomic
 * optimistic concurrency · M6-I027 options from published Release content · M6-I028 Level 1, server-owned · M6-I029
 * M4 / M5 own every calculation · M6-I030 no automatic Release migration.
 * Its negative / mutation controls are scripts/m6-wo3-negative-controls.mjs (shared CLOSEOUT-03 harness).
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

const UI = code("apps/studio/app/characters");
// Routes registered by LATER Work Orders under the same folders (M6-WO4 advancement / access) are their gates' concern.
const LATER_ROUTES = Object.entries(JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>)
  .filter(([k, v]) => /^M\d+-WO\d+$/.test(k) && !["M6-WO1", "M6-WO2", "M6-WO3"].includes(k) && Array.isArray(v))
  .flatMap(([, v]) => v as string[]);
const ROUTES = [...walk("apps/studio/app/api/characters"), ...walk("apps/studio/app/api/character-creation")].filter((f) => f.endsWith("route.ts") && !LATER_ROUTES.includes(f));
const SERVICE = strip(read("packages/prowess-db/src/character/service.ts"));
const REPOSITORY = strip(read("packages/prowess-db/src/character/repository.ts"));
const CREATION = strip(read("packages/prowess-game/src/character/creation.ts"));
const SCHEMA = read("packages/prowess-db/prisma/schema.prisma");
const WO3_BLOCK = SCHEMA.slice(SCHEMA.indexOf("// >>> M6-WO3"), SCHEMA.indexOf("// <<< M6-WO3")).replace(/^\s*\/\/.*$/gm, ""); // declarations only
const MIGRATION_NAME = "20261029010000_m6_wo3_character_foundation";
const MIGRATION = read(`packages/prowess-db/prisma/migrations/${MIGRATION_NAME}/migration.sql`);
const model = (name: string) => {
  const start = WO3_BLOCK.indexOf(`model ${name} {`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return WO3_BLOCK.slice(start, WO3_BLOCK.indexOf("\n}", start));
};

describe("M6-WO3 gate — registered schema change and migration (§28–§35, §87–§88)", () => {
  it("M6-I024 the schema registry entry is exactly the four Character models and the one WO3 migration", () => {
    const registry = JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>;
    expect(registry["M6-WO3"]).toEqual({ migrations: [MIGRATION_NAME], models: ["Character", "CharacterAncestryStatChoice", "CharacterSkillRank", "CharacterStatAllocation"] });
    expect(laterMigrations()[0]).toBe(MIGRATION_NAME); // later registered Work Orders append after it
    const models = [...WO3_BLOCK.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]).sort();
    expect(models).toEqual(["Character", "CharacterAncestryStatChoice", "CharacterSkillRank", "CharacterStatAllocation"]);
    // Every other schema line is unchanged since M6-WO2: removing exactly the marked WO3 additions restores the
    // certified M6-WO2 schema hash.
    const wo2 = JSON.parse(read("docs/architecture/m6-wo2-baseline.json")) as { frozenFiles: Record<string, string> };
    expect(hash(frozenSchemaText())).toBe(wo2.frozenFiles["packages/prowess-db/prisma/schema.prisma"]);
    expect(SCHEMA.match(/\/\/ M6-WO3 back-relation/g)).toHaveLength(4);
    expect(WO3_BLOCK).not.toMatch(/^enum /m);
  });

  it("M6-I021 the Character pins an exact RulesetRelease (RESTRICT) — never a Ruleset id, channel, label or latest pointer", () => {
    const c = model("Character");
    expect(c).toMatch(/rulesetReleaseId\s+String\s+@map\("ruleset_release_id"\)/);
    expect(c).toMatch(/rulesetRelease\s+RulesetRelease\s+@relation\(fields: \[rulesetReleaseId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/);
    expect(c).not.toMatch(/\brulesetId\b|\bchannel\b|versionLabel|latest|current\w*Release/i);
    expect(MIGRATION).toMatch(/CHARACTER_RELEASE_IMMUTABLE/);
    expect(MIGRATION).not.toMatch(/CASCADE|SET NULL/i);
    expect(MIGRATION.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it("M6-I022 exact Ancestry / Affinity / Skill references are composite (entityId, entityVersionId) foreign keys", () => {
    expect(model("Character")).toMatch(/fields: \[ancestryEntityVersionId, ancestryEntityId\], references: \[id, entityId\]/);
    expect(model("Character")).toMatch(/fields: \[primaryAffinityEntityVersionId, primaryAffinityEntityId\], references: \[id, entityId\]/);
    expect(model("CharacterSkillRank")).toMatch(/fields: \[skillEntityVersionId, skillEntityId\], references: \[id, entityId\]/);
    expect(model("CharacterSkillRank")).toMatch(/@@unique\(\[characterId, skillEntityId\]/);
    expect(WO3_BLOCK).not.toMatch(/canonicalKey|displayName/);
  });

  it("M6-I023 no derived statistic, current resource, inventory or ability is persisted", () => {
    expect(WO3_BLOCK).not.toMatch(/maxHp|maximumHp|maxMp|maximumMp|dodge|movement|actionPoints|characterDc|signature\w*|currentHp|currentMp|finalStat|statValue|inventory|equipment|weapon|spell|maneuver|abilit/i);
    expect(model("CharacterStatAllocation")).toMatch(/pointsSpent\s+Int/);
    expect(model("CharacterAncestryStatChoice")).not.toMatch(/amount/);
    // sourceKind is an extensible token (String), not a Prisma enum.
    expect(model("CharacterSkillRank")).toMatch(/sourceKind\s+String\s/);
  });

  it("M6-I025 M6-I026 the database itself freezes completed Characters and protects lockVersion", () => {
    expect(model("Character")).toMatch(/lockVersion Int @default\(1\) @map\("lock_version"\)/);
    expect(MIGRATION).toMatch(/CHARACTER_CORE_FROZEN/);
    for (const t of ["character_stat_allocations", "character_ancestry_stat_choices", "character_skill_ranks"]) expect(MIGRATION).toMatch(new RegExp(`CREATE TRIGGER "${t}_guard"`));
    expect(MIGRATION).toMatch(/"lock_version" >= 1/);
  });

  it("M6-I025 the service refuses mechanical writes to a completed Character; only the profile write allows it", () => {
    const save = fn(SERVICE, "saveCharacterCreation");
    expect(save).toMatch(/if \(c\.coreCreationCompletedAt !== null\) explain\(\{ outcome: "frozen" \}, id\);/);
    expect(save.indexOf("frozen")).toBeLessThan(save.indexOf("replaceCreationInputs"));
    expect(REPOSITORY).toMatch(/where: \{ id, lockVersion: expected, \.\.\.\(allowFrozen \? \{\} : \{ coreCreationCompletedAt: null \}\) \}/);
    expect(fn(REPOSITORY, "replaceCreationInputs")).toMatch(/claim\(tx, id, expected, false,/);
    expect(fn(REPOSITORY, "markCoreCreationComplete")).toMatch(/claim\(tx, id, expected, false,/);
    const profile = fn(REPOSITORY, "updateProfile");
    expect(profile).toMatch(/claim\(tx, id, expected, true, \{ name: input\.name, concept: input\.concept \}\)/);
  });
});

describe("M6-WO3 gate — Characters are not Compendium content (§28, M6-I024)", () => {
  it("the Character repository writes only Character tables; the service never writes Entities, Canon or Releases", () => {
    const writes = [...REPOSITORY.matchAll(/(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/g)].map((m) => m[1]);
    expect(new Set(writes)).toEqual(new Set(["character", "characterStatAllocation", "characterAncestryStatChoice", "characterSkillRank"]));
    expect(SERVICE).not.toMatch(/prisma\.|\$executeRaw|\$queryRaw/);
    expect(SERVICE + REPOSITORY).not.toMatch(/createEntity|createEntityVersion|publishRulesetRelease|createChangeSet|transitionEntityVersionStatus|createRulesetManifest/);
  });
});

describe("M6-WO3 gate — Release resolution (§4–§9, §47, M6-I021 M6-I022 M6-I030)", () => {
  it("every Character read and write resolves the Character's OWN stored Release; nothing looks up a latest Release", () => {
    expect(SERVICE).toMatch(/materializeProwessDefinitionsFromRelease\(releaseId\)/);
    expect(SERVICE).not.toMatch(/latest|findFirst|orderBy:\s*\{\s*releaseNumber|resolveLatest|current\w*Release/i);
    for (const name of ["validateCharacterCandidate", "saveCharacterCreation", "finalizeCharacterCoreCreation"]) expect(fn(SERVICE, name), name).toMatch(/c\.rulesetReleaseId/);
  });

  it("finalization verifies the Release Manifest through M2 before recording completion (§7, M6-I025)", () => {
    const fin = fn(SERVICE, "finalizeCharacterCoreCreation");
    expect(fin).toMatch(/verifyRulesetReleaseManifestHash\(c\.rulesetReleaseId\)/);
    expect(fin.indexOf("verifyRulesetReleaseManifestHash")).toBeLessThan(fin.indexOf("markCoreCreationComplete"));
    expect(fin).toMatch(/RELEASE_INTEGRITY_FAILED/);
    expect(fin).toMatch(/status !== "READY"|CREATION_INCOMPLETE/);
  });

  it("the pure validator refuses any selection the Release does not pin, by exact (entityId, entityVersionId)", () => {
    expect(CREATION).toMatch(/NOT_IN_RELEASE/);
    expect(CREATION).toMatch(/entityVersionId/);
    expect(CREATION).not.toMatch(/canonicalKey\s*===|\.canonicalKey\s*==/);
  });
});

describe("M6-WO3 gate — Level, concurrency and transactions (§22, §40–§41, §72–§73)", () => {
  it("M6-I028 create and save accept no Level, rank or derived value; the server sets Level from the Release rule", () => {
    expect(read("apps/studio/app/api/characters/route.ts")).toMatch(/readStrictBody\(request, \["name", "concept", "rulesetReleaseId"\]\)/);
    expect(read("apps/studio/app/api/characters/[characterId]/creation/route.ts")).toMatch(/readStrictBody\(request, \["expectedLockVersion", "candidate"\]\)/);
    expect(fn(SERVICE, "createCharacter")).toMatch(/level: [^,\n]*startingLevel/);
    expect(SERVICE).toMatch(/const allowed = \["ancestry", "ancestryStatChoices", "statAllocations", "skills", "primaryAffinity"\]/);
    const client = strip(read("apps/studio/app/characters/_lib/character-client.ts"));
    expect(client).toMatch(/createCharacter = async \(body: \{ name: string; concept: string \| null; rulesetReleaseId: string \}\)/);
    const candidate = client.slice(client.indexOf("export interface CandidateDto"), client.indexOf("}\n", client.indexOf("export interface CandidateDto")));
    expect(candidate).not.toMatch(/level|rank|maximum|derived/i);
  });

  it("M6-I026 every mutable write is a lockVersion compare-and-set; a creation save replaces children in one transaction", () => {
    expect(REPOSITORY).toMatch(/updateMany\(\{\s*where: \{ id, lockVersion: expected/);
    expect(REPOSITORY).toMatch(/const next = expected \+ 1;/);
    expect(REPOSITORY).toMatch(/lockVersion: next/);
    expect(REPOSITORY).toMatch(/\$transaction/);
    expect(REPOSITORY).not.toMatch(/updatedAt\s*:\s*expected|updatedAt: \{ equals/);
    const replace = fn(REPOSITORY, "replaceCreationInputs");
    expect(replace).toMatch(/inTransaction/);
    expect(replace.indexOf("claim(")).toBeLessThan(replace.indexOf("deleteMany"));
  });
});

describe("M6-WO3 gate — Studio presents, never decides (§52, §60, §65, §70, §82, M6-I027 M6-I029)", () => {
  it("the Character frontend imports no database, Prisma, @prowess/game or @prowess/rules; only the API client fetches", () => {
    expect(UI.length).toBeGreaterThanOrEqual(10);
    for (const f of UI) {
      const src = read(f);
      expect(src, f).not.toMatch(/from "(@prowess\/(db|game|rules)|@prisma\/client)[^"]*"/);
      if (!f.endsWith("_lib/character-client.ts")) expect(strip(src), f).not.toMatch(/\bfetch\(/);
    }
    expect(read("scripts/check-architecture.mjs")).toMatch(/apps\/studio \(app\/characters\/\)/);
  });

  it("no hard-coded Race / Skill / Affinity catalog, budget, bound or die in Studio", () => {
    for (const f of UI) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/\b(RACES|ANCESTRIES|SKILLS|AFFINITIES|STAT_BUDGET|POINT_BUDGET|STAT_MAX)\s*=/);
      expect(src, f).not.toMatch(/Orcani|Athletics|Survival|Stealth|Arcana|Perception|Performance|Evocation|Abjuration|Necromancy/);
      expect(src, f).not.toMatch(/\b15\b|\b10\b|"d4"|'d4'|faces:\s*4/);
    }
    // The six Stat identities shown come from the Release context, not a Studio list.
    for (const f of UI) expect(strip(read(f)), f).not.toMatch(/\["STR",\s*"AGI"/);
  });

  it("no derived formula exists in Studio or the database services — derived values come from @prowess/game", () => {
    for (const f of [...UI, "packages/prowess-db/src/character/service.ts", "packages/prowess-db/src/character/repository.ts"]) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/\b(baseHp|baseMp|CON|RES|PRO|con|res|pro)\b\s*[+*]\s*\w|\w\s*[+*]\s*\b(baseHp|baseMp)\b/);
      expect(src, f).not.toMatch(/evaluateModifiers|evaluateFormula|orchestrateRulesEvaluation|compileCoreResolution/);
    }
    expect(SERVICE).toMatch(/validateCharacterCreation\(/);
    expect(CREATION).toMatch(/orchestrateRulesEvaluation|buildCoreResolutionContexts/);
    expect(CREATION).toMatch(/evaluateModifiers/);
  });

  it("every option and Review rule links to its exact Release Rules Reference URL (§49, §102)", () => {
    const review = strip(read("apps/studio/app/characters/_components/CharacterReview.tsx"));
    expect(review).toMatch(/entryHref\(release\.rulesetId, release\.id, refDto\.entityId\)/);
    const wizard = strip(read("apps/studio/app/characters/_components/CharacterWizard.tsx"));
    expect(wizard.match(/<RuleLink release=\{release\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(wizard).toMatch(/context\.ancestries\.map/);
    expect(wizard).toMatch(/context\.skills/);
    expect(wizard).toMatch(/context\.affinities/);
  });

  it("WO3 builds no equipment, ability, advancement or job-class feature (§75–§80, §115)", () => {
    const all = [...UI, ...ROUTES].map((f) => strip(read(f))).join("\n");
    // Advancement, Level-up and secondary Affinities arrived with M6-WO4 (its own gate); WO3 still builds no equipment,
    // ability records, respec or job class.
    expect(all).not.toMatch(/inventory|addWeapon|equipItem|createSpell|createManeuver|respec|jobClass/i);
    expect(ROUTES.map((f) => f.replace("apps/studio/app/api/", "")).sort()).toEqual([
      "character-creation/releases/[releaseId]/capability/route.ts",
      "characters/[characterId]/creation-context/route.ts",
      "characters/[characterId]/creation/route.ts",
      "characters/[characterId]/finalize/route.ts",
      "characters/[characterId]/profile/route.ts",
      "characters/[characterId]/route.ts",
      "characters/[characterId]/validate/route.ts",
      "characters/route.ts",
    ]);
  });
});

describe("M6-WO3 gate — routes and API boundary (§70–§71)", () => {
  const methods = (f: string) => [...read(f).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
  it("routes are registered under M6-WO3 and export exactly their methods; no DELETE", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>;
    expect(registry["M6-WO3"]).toEqual([...ROUTES].sort());
    const expected: Record<string, string[]> = {
      "characters/route.ts": ["GET", "POST"],
      "characters/[characterId]/route.ts": ["GET"],
      "characters/[characterId]/profile/route.ts": ["PUT"],
      "characters/[characterId]/creation-context/route.ts": ["GET"],
      "characters/[characterId]/validate/route.ts": ["POST"],
      "characters/[characterId]/creation/route.ts": ["PUT"],
      "characters/[characterId]/finalize/route.ts": ["POST"],
      "character-creation/releases/[releaseId]/capability/route.ts": ["GET"],
    };
    for (const f of ROUTES) expect(methods(f), f).toEqual(expected[f.replace("apps/studio/app/api/", "")]);
  });

  it("routes stay thin: one @prowess/db call each, no Prisma, no rules package", () => {
    for (const f of ROUTES) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/@prisma\/client|@prowess\/(game|rules)|prisma\./);
      expect(src, f).toMatch(/from "@prowess\/db"/);
    }
  });

  it("Character error codes map to HTTP statuses (stale / frozen 409, illegal 422)", () => {
    const errors = read("apps/studio/src/api/errors.ts");
    for (const [code, status] of [["STALE_WRITE", 409], ["CORE_FROZEN", 409], ["INVALID_CREATION", 422], ["CREATION_INCOMPLETE", 409], ["RELEASE_NOT_CAPABLE", 409], ["RELEASE_INTEGRITY_FAILED", 409], ["NOT_FOUND", 404], ["INVALID_INPUT", 400]] as const) {
      expect(errors, code).toMatch(new RegExp(`CHARACTER_ERROR_CODES\\.${code}\\]?:?\\s*${status}|\\[CHARACTER_ERROR_CODES\\.${code}\\]:\\s*${status}`));
    }
  });
});

describe("M6-WO3 gate — approved M5 change, invariants, documentation and CI (§84, §108, §111, §114)", () => {
  it("M6-I029 the approved M5 change registry lists exactly the reviewed files and their current hashes", () => {
    const approved = JSON.parse(read("docs/architecture/m6-approved-m5-changes.json")) as Record<string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> } | string>;
    const wo3 = approved["M6-WO3"] as { changedFiles: Record<string, string>; addedFiles: Record<string, string> };
    expect(Object.keys(wo3.changedFiles).sort()).toEqual([
      "packages/prowess-game/src/compilation/compile.ts",
      "packages/prowess-game/src/core-contracts.test.ts",
      "packages/prowess-game/src/definition/payload.ts",
      "packages/prowess-game/src/index.ts",
      "packages/prowess-game/src/vocabulary/families.ts",
    ]);
    expect(Object.keys(wo3.addedFiles).sort()).toEqual([
      "packages/prowess-game/src/character-creation.test.ts",
      "packages/prowess-game/src/character/creation.ts",
      "packages/prowess-game/src/definition/character-payload.ts",
      "packages/prowess-game/src/m6-wo3-registry.test.ts",
      "packages/prowess-game/src/testing/character-fixtures.ts",
      "packages/prowess-game/src/testing/m6-wo3-registry-baseline.json",
      "packages/prowess-game/src/vocabulary/character.ts",
    ]);
    // Later Work Orders may change these files again only through their own registered entry (expectedFrozenHash).
    for (const [f, h] of [...Object.entries(wo3.changedFiles), ...Object.entries(wo3.addedFiles)]) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(expectedFrozenHash(f, h));
    // The changed M5 files gain only additive WO3 lines (no existing kind, reader or compiler is rewritten).
    const families = read("packages/prowess-game/src/vocabulary/families.ts");
    expect(families).toMatch(/ANCESTRY: active\("ANCESTRY"\),\n\s+SKILL: active\("SKILL"\),/);
    expect(families).toMatch(/CHARACTER_CREATION_RULE: active\("CHARACTER"\),/);
    expect(read("packages/prowess-game/src/compilation/compile.ts")).toMatch(/CHARACTER_CREATION_RULE: null,/);
    expect(read("packages/prowess-game/src/testing/m6-wo3-registry-baseline.json")).toMatch(/"baseCommit": "89b0834020dcdc6f8ffc9a1483eeb871b5625077"/);
  });

  it("M4 source is untouched since M6-WO2 (frozen hashes)", () => {
    const wo2 = JSON.parse(read("docs/architecture/m6-wo2-baseline.json")) as { frozenFiles: Record<string, string> };
    const m4 = Object.entries(wo2.frozenFiles).filter(([f]) => f.startsWith("packages/prowess-rules/src/"));
    expect(m4.length).toBeGreaterThan(20);
    for (const [f, h] of m4) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  const inv = JSON.parse(read("docs/architecture/m6-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
  it("M6-I021–I030 follow M6-I001–I020, are documented, and each is guarded by executing files that cite it", () => {
    expect(inv.slice(0, 30).map((x) => x.id)).toEqual(Array.from({ length: 30 }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    for (const row of inv.slice(20, 30)) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo3-static.test.ts");
      expect(row.guards).toContain("scripts/m6-wo3-negative-controls.mjs");
      for (const g of row.guards) {
        expect(existsSync(path.join(ROOT, g)), g).toBe(true);
        if (/\.test\.tsx?$/.test(g)) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
    }
  });

  it("the architecture document and the implementation report exist with their required sections", () => {
    const doc = read("docs/architecture/m6-character-domain.md");
    for (const h of ["Character Schema", "Exact Release Pin", "Creation Content Contracts", "Creation Validator", "Derived Preview", "Concurrency", "API", "UI Wizard", "Known Limitations"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h}$`, "m"));
    const report = read("docs/reports/m6-wo3-implementation-report.md");
    for (const h of ["Test Totals", "Architecture Gate", "Controls"]) expect(report, h).toMatch(new RegExp(`^## \\d+\\. ${h}`, "m"));
  });

  it("the M6-WO3 gate is a named step of the consolidated CI workflow with its exact control count; no m6-wo3.yml", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/- name: M6-WO3 — Character Domain Model & Character Creation\n\s+run: \|\n[\s\S]*?node scripts\/ci\/verify-gate\.mjs M6-WO3 [^\n]*\n\s+PROWESS_EXPECT_CONTROLS=\d+ node scripts\/m6-wo3-negative-controls\.mjs/);
    expect(existsSync(path.join(ROOT, ".github/workflows/m6-wo3.yml"))).toBe(false);
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { gates: Array<{ id: string; tests: string[]; controls: { script: string; count: number } | null }> };
    const gate = gates.gates.find((g) => g.id === "M6-WO3");
    expect(gate?.controls?.script).toBe("scripts/m6-wo3-negative-controls.mjs");
    expect(gate?.controls?.count).toBeGreaterThanOrEqual(24);
    const count = Number(/PROWESS_EXPECT_CONTROLS=(\d+) node scripts\/m6-wo3-negative-controls\.mjs/.exec(ci)?.[1]);
    expect(count).toBe(gate?.controls?.count);
    for (const t of gate?.tests ?? []) expect(existsSync(path.join(ROOT, t)), t).toBe(true);
  });
});
