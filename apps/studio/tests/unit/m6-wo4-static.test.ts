// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { laterMigrations } from "./later-milestone-schema";

/**
 * M6-WO4 permanent architecture gate — Character Advancement, Access & Eligibility (PAS-10 M6-WO4 §127–§131).
 *
 * Guards M6-I031 exact Release · M6-I032 one Level at a time · M6-I033 entitlements are content · M6-I034 creation
 * immutable · M6-I035 append-only history · M6-I036 Stats derived · M6-I037 Skill ranks derived · M6-I038 Affinity
 * profile derived and M5-validated · M6-I039 derived values never persisted · M6-I040 M5 prerequisites reused ·
 * M6-I041 eligibility is not Ability legality · M6-I042 no Rules Text parsing · M6-I043 no automatic Release migration ·
 * M6-I044 the CharacterMechanicalProfile is the one bridge.
 * Its negative / mutation controls are scripts/m6-wo4-negative-controls.mjs (shared CLOSEOUT-03 harness).
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

const BASELINE = JSON.parse(read("docs/architecture/m6-wo4-baseline.json")) as { baseCommit: string; frozenFiles: Record<string, string> };
const SCHEMA_PATH = "packages/prowess-db/prisma/schema.prisma";
const SCHEMA = read(SCHEMA_PATH);
const WO4_BLOCK = SCHEMA.slice(SCHEMA.indexOf("// >>> M6-WO4"), SCHEMA.indexOf("// <<< M6-WO4")).replace(/^\s*\/\/.*$/gm, "");
const MIGRATION_NAME = "20261031010000_m6_wo4_character_advancement";
const MIGRATION = read(`packages/prowess-db/prisma/migrations/${MIGRATION_NAME}/migration.sql`);
const model = (name: string) => {
  const start = WO4_BLOCK.indexOf(`model ${name} {`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return WO4_BLOCK.slice(start, WO4_BLOCK.indexOf("\n}", start));
};
const GAME = "packages/prowess-game/src";
const ADVANCEMENT = strip(read(`${GAME}/character/advancement.ts`));
const ELIGIBILITY = strip(read(`${GAME}/character/eligibility.ts`));
const REQUIREMENTS = strip(read(`${GAME}/character/requirements.ts`));
const PAYLOAD = strip(read(`${GAME}/definition/advancement-payload.ts`));
const REPO = strip(read("packages/prowess-db/src/character/advancement-repository.ts"));
const SERVICE = strip(read("packages/prowess-db/src/character/advancement-service.ts"));
const PROGRESSION = strip(read("packages/prowess-db/src/character/progression.ts"));
const UI = code("apps/studio/app/characters");
const ROUTE_DIR = "apps/studio/app/api/characters/[characterId]";
const ROUTES = [`${ROUTE_DIR}/access/route.ts`, `${ROUTE_DIR}/advance/route.ts`, `${ROUTE_DIR}/advancement/preview/route.ts`, `${ROUTE_DIR}/advancement/route.ts`, `${ROUTE_DIR}/eligible-definitions/route.ts`];

describe("M6-WO4 gate — registered schema change and migration (§43–§48, §141)", () => {
  it("M6-I035 the registry entry is exactly the four advancement models and the one WO4 migration, after WO3", () => {
    const registry = JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>;
    expect(registry["M6-WO4"]).toEqual({ migrations: [MIGRATION_NAME], models: ["CharacterAdvancement", "CharacterAffinityAdvancementChoice", "CharacterSkillAdvancement", "CharacterStatAdvancement"] });
    const later = laterMigrations();
    expect(later.indexOf(MIGRATION_NAME)).toBe(later.indexOf("20261029010000_m6_wo3_character_foundation") + 1);
    expect([...WO4_BLOCK.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]).sort()).toEqual(["CharacterAdvancement", "CharacterAffinityAdvancementChoice", "CharacterSkillAdvancement", "CharacterStatAdvancement"]);
    expect(WO4_BLOCK).not.toMatch(/^enum /m);
    expect(SCHEMA.match(/\/\/ M6-WO4 back-relation/g)).toHaveLength(3);
  });

  it("M6-I034 removing exactly the marked WO4 additions restores the M6-WO3 schema; the WO3 migration is untouched", () => {
    expect(BASELINE.baseCommit).toBe("77f9430f68caf60babfb0c54496090d5ace11f86");
    const withoutWo4 = SCHEMA.replace(/^[^\n]*\/\/ M6-WO4 back-relation[^\n]*\n/gm, "").replace(/\n\/\/ >>> M6-WO4[^\n]*\n[\s\S]*?\/\/ <<< M6-WO4[^\n]*\n/, "");
    expect(hash(withoutWo4)).toBe(BASELINE.frozenFiles[SCHEMA_PATH]);
    const wo3 = "packages/prowess-db/prisma/migrations/20261029010000_m6_wo3_character_foundation/migration.sql";
    expect(hash(readFileSync(path.join(ROOT, wo3))), wo3).toBe(BASELINE.frozenFiles[wo3]);
  });

  it("M6-I039 advancement rows store CHOICES only — no rank, die, final Stat, derived value or Release", () => {
    expect(WO4_BLOCK).not.toMatch(/rankKey|fromRank|toRank|dieKey|faces|finalStat|statValue|maximum|minimum|maxHp|maxMp|derived|signature|rulesetRelease|rulesetId|canonicalKey|displayName/i);
    expect(model("CharacterStatAdvancement")).toMatch(/pointsSpent Int/);
    expect(model("CharacterSkillAdvancement")).toMatch(/action String/);
    expect(model("CharacterAffinityAdvancementChoice")).toMatch(/optionKey String/);
  });

  it("M6-I031 Skill and Affinity choices are composite (entityId, entityVersionId) foreign keys; every relation is RESTRICT", () => {
    expect(model("CharacterSkillAdvancement")).toMatch(/fields: \[skillEntityVersionId, skillEntityId\], references: \[id, entityId\]/);
    expect(model("CharacterAffinityAdvancementChoice")).toMatch(/fields: \[affinityEntityVersionId, affinityEntityId\], references: \[id, entityId\]/);
    expect(WO4_BLOCK.match(/onDelete: Restrict, onUpdate: Restrict/g)).toHaveLength(6);
    expect(MIGRATION).not.toMatch(/CASCADE|SET NULL/i);
    expect(MIGRATION.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)).toHaveLength(6);
  });

  it("M6-I032 the database allows exactly one Level per committed advancement", () => {
    expect(model("CharacterAdvancement")).toMatch(/@@unique\(\[characterId, toLevel\]/);
    expect(MIGRATION).toMatch(/CHECK \("from_level" >= 1 AND "to_level" = "from_level" \+ 1\)/);
    expect(MIGRATION).toMatch(/OR NEW\."level" IS DISTINCT FROM OLD\."level" \+ 1/);
    expect(MIGRATION).toMatch(/NOT EXISTS \(SELECT 1 FROM "character_advancements" a WHERE a\."character_id" = NEW\."id" AND a\."from_level" = OLD\."level" AND a\."to_level" = NEW\."level"\)/);
    expect(MIGRATION).toMatch(/OLD\."core_creation_completed_at" IS NULL\n\s+OR NEW\."level"/);
    expect(MIGRATION).toMatch(/CHARACTER_LEVEL_GUARD/);
    expect(MIGRATION).toMatch(/c\."level" = NEW\."from_level"/);
  });

  it("M6-I034 M6-I035 the WO3 Release / creation freeze is kept; committed history is append-only in the database", () => {
    expect(MIGRATION).toMatch(/CHARACTER_RELEASE_IMMUTABLE/);
    expect(MIGRATION).toMatch(/CHARACTER_CORE_FROZEN/);
    expect(MIGRATION).toMatch(/IF TG_OP <> 'INSERT' THEN\n\s+RAISE EXCEPTION 'CHARACTER_ADVANCEMENT_IMMUTABLE/);
    expect(MIGRATION).toMatch(/CREATE TRIGGER "character_advancements_guard" BEFORE INSERT OR UPDATE OR DELETE ON "character_advancements"/);
    for (const t of ["character_stat_advancements", "character_skill_advancements", "character_affinity_advancement_choices"]) expect(MIGRATION).toMatch(new RegExp(`CREATE TRIGGER "${t}_guard" BEFORE INSERT OR UPDATE OR DELETE ON "${t}"`));
    expect(MIGRATION).toMatch(/CHECK \("points_spent" > 0\)/);
  });
});

describe("M6-WO4 gate — persistence and service (§39–§42, §49–§50)", () => {
  it("M6-I035 the advancement repository only INSERTS history and moves the Level in ONE lockVersion compare-and-set transaction", () => {
    const writes = [...REPO.matchAll(/tx\.(\w+)\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(new Set(writes)).toEqual(new Set(["character.updateMany", "characterAdvancement.create", "characterStatAdvancement.createMany", "characterSkillAdvancement.create", "characterAffinityAdvancementChoice.create", "character.update"]));
    const commit = fn(REPO, "commitAdvancement");
    expect(commit).toMatch(/prisma\.\$transaction\(async \(tx\) =>/);
    expect(commit).toMatch(/where: \{ id, lockVersion: expected, coreCreationCompletedAt: \{ not: null \}, level: input\.fromLevel \}/);
    expect(commit).toMatch(/data: \{ lockVersion: next, updatedAt: new Date\(\) \}/);
    expect(commit.indexOf("updateMany")).toBeLessThan(commit.indexOf("characterAdvancement.create"));
    expect(commit.indexOf("characterAdvancement.create")).toBeLessThan(commit.indexOf("data: { level: input.toLevel }"));
    expect(commit).not.toMatch(/tx\.(characterStatAllocation|characterAncestryStatChoice|characterSkillRank)\b/); // the Level-1 creation rows are never touched
    expect(REPO).toMatch(/isolationLevel: "RepeatableRead"/);
  });

  it("M6-I031 M6-I043 every read and commit resolves the Character's OWN stored Release; nothing looks up latest", () => {
    expect(SERVICE).toMatch(/releaseRules\(c\.rulesetReleaseId\)/);
    expect(SERVICE).not.toMatch(/latest|findFirst|orderBy:\s*\{\s*releaseNumber|resolveLatest|current\w*Release|rulesetId:/i);
    const advance = fn(SERVICE, "advanceCharacter");
    expect(advance).toMatch(/verifyRulesetReleaseManifestHash\(c\.rulesetReleaseId\)/);
    expect(advance.indexOf("verifyRulesetReleaseManifestHash")).toBeLessThan(advance.indexOf("commitAdvancement"));
    expect(advance).toMatch(/if \(c\.lockVersion !== expected\) explain\(\{ outcome: "stale"/);
  });

  it("M6-I032 M6-I039 the server — never the caller — decides the Level, ranks, die and derived values", () => {
    const advance = fn(SERVICE, "advanceCharacter");
    expect(advance).toMatch(/fromLevel: preview\.fromLevel,\n\s+toLevel: record\.toLevel,/);
    expect(advance).not.toMatch(/input\.(level|toLevel|rank|derived)/);
    expect(SERVICE + PROGRESSION).not.toMatch(/\blevel\s*\+\s*1|evaluateModifiers|evaluateFormula|orchestrateRulesEvaluation|compileCoreResolution/);
    expect(PROGRESSION).toMatch(/buildCharacterMechanicalProfile\(/);
    expect(read("apps/studio/app/api/characters/[characterId]/advance/route.ts")).toMatch(/readStrictBody\(request, \["expectedLockVersion", "choices"\]\)/);
    expect(read("apps/studio/app/api/characters/[characterId]/advancement/preview/route.ts")).toMatch(/readStrictBody\(request, \["choices"\]\)/);
    expect(ADVANCEMENT).toMatch(/if \(!\["statAllocations", "skillAdvancements", "affinityChoice"\]\.includes\(k\)\) add\(E\.INVALID_CHOICES/);
    expect(SERVICE).not.toMatch(/prisma\.|\$executeRaw|\$queryRaw/);
  });

  it("M6-I044 one CharacterMechanicalProfile builder — the service and Studio never assemble a profile themselves", () => {
    expect([...ADVANCEMENT.matchAll(/export function buildCharacterMechanicalProfile\(/g)]).toHaveLength(1);
    const builders = [...code("packages/prowess-game/src"), ...code("packages/prowess-db/src"), ...code("packages/prowess-model/src"), ...code("apps/studio/app"), ...code("apps/studio/src")].filter((f) => /buildCharacterMechanicalProfile\(/.test(strip(read(f))));
    expect(builders.sort()).toEqual(["packages/prowess-db/src/character/progression.ts", "packages/prowess-game/src/character/advancement.ts"]);
    expect(ELIGIBILITY).toMatch(/profile: CharacterMechanicalProfile/);
    expect(ELIGIBILITY).not.toMatch(/validateCharacterCreation|statAllocations|history/);
  });
});

describe("M6-WO4 gate — @prowess/game advancement (§6–§38)", () => {
  it("M6-I033 entitlements are content: no hard-coded Level, cadence, die band or option in the advancement code", () => {
    for (const [f, src] of [["advancement.ts", ADVANCEMENT], ["eligibility.ts", ELIGIBILITY], ["advancement-payload.ts", PAYLOAD]] as const) {
      expect(src, f).not.toMatch(/\b(10|9|6|3)\b(?!\d)/);
      expect(src, f).not.toMatch(/"D(4|6|8|10|12)"|PRIMARY_EXPERT|GAIN_SECONDARY_TRAINED|UPGRADE_AFFINITY_RANK|PROMOTE_EXPERT_TO_MASTER|PRIMARY_TRAINED/);
      expect(src, f).not.toMatch(/MAX_LEVEL\s*=|MAXIMUM_LEVEL\s*=|LEVEL_CAP/);
    }
    expect(ADVANCEMENT).toMatch(/maximumLevel: c\.levels\.at\(-1\) as number/);
    expect(ADVANCEMENT).toMatch(/return c\.levels\.find\(\(l\) => level < l\) \?\? null;/);
    expect(ADVANCEMENT).toMatch(/if \(JSON\.stringify\(authored\) !== JSON\.stringify\(later\)\)/);
  });

  it("M6-I036 M6-I037 Stat totals go through M4 evaluateModifiers; Skill ranks step the exact ladder; comparisons through M4 Requirements", () => {
    expect(ADVANCEMENT).toMatch(/const response = evaluateModifiers\(\{/);
    expect(ADVANCEMENT).toMatch(/sourceType: "character\.level_advancement"/);
    expect(ADVANCEMENT).toMatch(/const next = at === undefined \? undefined : c\.ladder\.ranks\.find\(\(r\) => at\.order < r\.order\);/);
    expect(ADVANCEMENT).toMatch(/if \(owned !== undefined\) return fail\(E\.SKILL_ALREADY_TRAINED/);
    expect(ADVANCEMENT).toMatch(/if \(touched\.includes\(ref\.entityId\)\) return fail\(E\.DUPLICATE_SKILL_ADVANCEMENT/);
    expect(REQUIREMENTS).toMatch(/evaluateRequirement\(/);
    expect(REQUIREMENTS).toMatch(/kind: "RANK_AT_LEAST"/);
    expect(REQUIREMENTS).toMatch(/kind: "NUMERIC_COMPARE"/);
  });

  it("M6-I038 every profile's Affinity state is checked by the existing M5 validators", () => {
    expect(ADVANCEMENT).toMatch(/const profileOut = validateAffinityProfile\(affinityProfileOf\(state\), bundle, c\.affinity\);/);
    expect(ADVANCEMENT).toMatch(/const progressionOut = validateAffinityProgression\(\{ definitions: bundle, profile: affinityProfileOf\(state\), characterLevel: state\.level \}\);/);
    expect(ADVANCEMENT).toMatch(/if \(!progressionOut\.ok \|\| progressionOut\.value\.status !== "VALID"\)/);
    expect(ADVANCEMENT).toMatch(/option\.startingRank === null \|\| option\.conflictKey !== null\) fail\(E\.AFFINITY_OPTION_UNRESOLVED/);
  });

  it("M6-I034 creation is replayed from the WO3 validator and never rewritten; history replays exactly one Level per record", () => {
    expect(ADVANCEMENT).toMatch(/const created = validateCharacterCreation\(\{ bundle, ruleset, candidate: creation \}\);/);
    expect(ADVANCEMENT).toMatch(/if \(expected === null \|\| record\.toLevel !== expected\) \{\n\s+add\(E\.HISTORY_INVALID/);
    expect(ADVANCEMENT).toMatch(/if \(state\.level !== character\.level\) \{\n\s+add\(E\.HISTORY_INVALID/);
    expect(ADVANCEMENT).toMatch(/E\.CORE_CREATION_INCOMPLETE/);
  });

  it("M6-I031 selections are the exact pinned EntityVersion of the Character's Release (no canonical-key or latest substitution)", () => {
    expect(ADVANCEMENT).toMatch(/if \(envelope === null \|\| envelope\.entityVersionId !== sel\.entityVersionId\) \{\n\s+add\(E\.CROSS_RELEASE_SELECTION/);
    expect(ELIGIBILITY).toMatch(/if \(envelope === null \|\| envelope\.entityVersionId !== definition\.entityVersionId\) \{/);
    expect(ADVANCEMENT + ELIGIBILITY).not.toMatch(/canonicalKey\s*===\s*sel|latest|newest/i);
  });

  it("M6-I040 M6-I041 M6-I042 eligibility reuses M5's structured prerequisites only — no new kind, no unlock table, no Rules Text", () => {
    expect(ELIGIBILITY).toMatch(/const read = readComponentConstructionRules\(rules, \["payload", "rules"\], p\);/);
    expect(ELIGIBILITY).toMatch(/readonly kind: "SKILL_RANK_AT_LEAST" \| "AFFINITY_RANK_AT_LEAST";/);
    expect(ELIGIBILITY).toMatch(/kind: "ENTITY_OWNED"/);
    for (const src of [ADVANCEMENT, ELIGIBILITY, PAYLOAD, REQUIREMENTS, SERVICE]) {
      expect(src).not.toMatch(/rulesText|shortDescription|\.description\b|RegExp|\.match\(|\.includes\("(Arcana|Martial|requires)/);
      expect(src).not.toMatch(/unlock(Table|s?By|Map|List)|UNLOCKS|LEVEL_UNLOCK/i);
    }
    expect(ELIGIBILITY).not.toMatch(/compileAbility|validateAbility|signatureSlot|capacity\s*[-+<>]/);
    expect(ELIGIBILITY).toMatch(/status: EligibilityStatus = unresolved\.length > 0 \|\| requirements\.some\(\(r\) => r\.satisfied === null\) \? "UNRESOLVED"/);
  });

  it("CHARACTER_ADVANCEMENT_RULE v1 is an active CHARACTER kind with no compiler; the reader fails closed", () => {
    expect(read(`${GAME}/vocabulary/families.ts`)).toMatch(/CHARACTER_ADVANCEMENT_RULE: active\("CHARACTER"\),/);
    expect(read(`${GAME}/compilation/compile.ts`)).toMatch(/CHARACTER_ADVANCEMENT_RULE: null,/);
    expect(PAYLOAD).toMatch(/export const ADVANCEMENT_PAYLOAD_KINDS = Object\.freeze\(\["CHARACTER_ADVANCEMENT_RULE"\] as const\);/);
    expect(read(`${GAME}/testing/m6-wo4-registry-baseline.json`)).toMatch(/"baseCommit": "77f9430f68caf60babfb0c54496090d5ace11f86"/);
  });
});

describe("M6-WO4 gate — Studio presents, never decides (§68–§84)", () => {
  it("the Character frontend imports no database or rules package; only the API client fetches", () => {
    for (const f of UI) {
      const src = read(f);
      expect(src, f).not.toMatch(/from "(@prowess\/(db|game|rules)|@prisma\/client)[^"]*"/);
      if (!f.endsWith("_lib/character-client.ts")) expect(strip(src), f).not.toMatch(/\bfetch\(/);
    }
    for (const f of ["_components/AdvancementWizard.tsx", "_components/CharacterProgress.tsx", "[characterId]/advance/page.tsx"]) expect(UI).toContain(`apps/studio/app/characters/${f}`);
  });

  it("M6-I033 M6-I036 no cadence, die, option or Stat arithmetic in Studio — every number shown is the server's", () => {
    for (const f of UI) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/PRIMARY_EXPERT|GAIN_SECONDARY_TRAINED|UPGRADE_AFFINITY_RANK|PROMOTE_EXPERT_TO_MASTER|STAT_POINTS\s*=|LEVEL_TABLE|CADENCE/);
      expect(src, f).not.toMatch(/"D(4|6|8|10|12)"|faces:\s*\d/);
      expect(src, f).not.toMatch(/\.(final|baseline|ancestry|creation|advancement|statPoints|value)\s*[+*-]\s*[\w(]/);
      expect(src, f).not.toMatch(/\blevel\s*\+\s*1\b|toLevel\s*[:=]\s*[\w.]*level\s*\+/);
    }
    const wizard = strip(read("apps/studio/app/characters/_components/AdvancementWizard.tsx"));
    expect(wizard).toMatch(/Points Remaining: \{remaining \?\? "…"\} of \{next\.statPoints\}/);
    expect(wizard).toMatch(/const remaining = preview\?\.statPoints\?\.remaining \?\? null;/);
    expect(wizard).toMatch(/disabled=\{busy \|\| preview\?\.status !== "READY"\}/);
  });

  it("M6-I032 the client sends choices only: Advance Character is expectedLockVersion + choices", () => {
    const client = strip(read("apps/studio/app/characters/_lib/character-client.ts"));
    expect(client).toMatch(/advanceCharacter = async \(id: string, expectedLockVersion: number, choices: AdvancementChoicesDto\) => \(await request<CharacterDto>\("POST", `\/api\/characters\/\$\{enc\(id\)\}\/advance`, \{ expectedLockVersion, choices \}\)\)/);
    const dto = client.slice(client.indexOf("export interface AdvancementChoicesDto"), client.indexOf("}\n", client.indexOf("export interface AdvancementChoicesDto")));
    expect(dto).not.toMatch(/level|rank|die|derived|final/i);
  });

  it("M6-I034 the Level 1 creation record stays visible and unchanged after advancement", () => {
    const sheet = strip(read("apps/studio/app/characters/_components/CharacterSheetSummary.tsx"));
    expect(sheet).toMatch(/Level 1 creation record/);
    expect(sheet).toMatch(/<CharacterProgress character=\{c\} \/>/);
  });
});

describe("M6-WO4 gate — routes and API boundary (§79–§81)", () => {
  const methods = (f: string) => [...read(f).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
  it("the five routes are registered under M6-WO4 and export exactly their methods; no DELETE, no history edit", () => {
    const registry = JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, unknown>;
    expect(registry["M6-WO4"]).toEqual([...ROUTES].sort());
    const expected: Record<string, string[]> = { "access/route.ts": ["GET"], "advance/route.ts": ["POST"], "advancement/preview/route.ts": ["POST"], "advancement/route.ts": ["GET"], "eligible-definitions/route.ts": ["GET"] };
    for (const f of ROUTES) expect(methods(f), f).toEqual(expected[f.replace(`${ROUTE_DIR}/`, "")]);
    const all = walk("apps/studio/app/api/characters").filter((f) => f.endsWith("route.ts"));
    expect(all.filter((f) => /history|respec|migrat|level-up|levelup/i.test(f))).toEqual([]);
  });

  it("routes stay thin: one @prowess/db call each, no Prisma, no rules package", () => {
    for (const f of ROUTES) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/@prisma\/client|@prowess\/(game|rules)|prisma\./);
      expect(src, f).toMatch(/from "@prowess\/db"/);
    }
  });

  it("advancement error codes map to HTTP statuses (stale / incomplete / maximum 409, illegal 422)", () => {
    const errors = read("apps/studio/src/api/errors.ts");
    for (const [c, status] of [["CORE_CREATION_INCOMPLETE", 409], ["MAX_LEVEL", 409], ["INVALID_ADVANCEMENT", 422], ["ADVANCEMENT_INCOMPLETE", 409], ["ADVANCEMENT_NOT_CAPABLE", 409], ["STALE_WRITE", 409]] as const) {
      expect(errors, c).toMatch(new RegExp(`\\[CHARACTER_ERROR_CODES\\.${c}\\]:\\s*${status}`));
    }
  });
});

describe("M6-WO4 gate — approved M5 change, invariants, documentation and CI (§127–§140)", () => {
  it("M6-I040 the approved M5 change registry lists exactly the reviewed WO4 files and their current hashes", () => {
    const approved = JSON.parse(read("docs/architecture/m6-approved-m5-changes.json")) as Record<string, { changedFiles: Record<string, string>; addedFiles: Record<string, string> } | string>;
    const wo4 = approved["M6-WO4"] as { changedFiles: Record<string, string>; addedFiles: Record<string, string> };
    expect(Object.keys(wo4.changedFiles).sort()).toEqual([`${GAME}/compilation/compile.ts`, `${GAME}/definition/payload.ts`, `${GAME}/index.ts`, `${GAME}/m6-wo3-registry.test.ts`, `${GAME}/vocabulary/families.ts`]);
    expect(Object.keys(wo4.addedFiles).sort()).toEqual([
      `${GAME}/character-advancement.test.ts`,
      `${GAME}/character/advancement.ts`,
      `${GAME}/character/eligibility.ts`,
      `${GAME}/character/requirements.ts`,
      `${GAME}/definition/advancement-payload.ts`,
      `${GAME}/m6-wo4-registry.test.ts`,
      `${GAME}/testing/advancement-fixtures.ts`,
      `${GAME}/testing/m6-wo4-registry-baseline.json`,
    ]);
    for (const [f, h] of [...Object.entries(wo4.changedFiles), ...Object.entries(wo4.addedFiles)]) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  it("M4 source is untouched (frozen hashes since M6-WO2)", () => {
    const wo2 = JSON.parse(read("docs/architecture/m6-wo2-baseline.json")) as { frozenFiles: Record<string, string> };
    const m4 = Object.entries(wo2.frozenFiles).filter(([f]) => f.startsWith("packages/prowess-rules/src/"));
    expect(m4.length).toBeGreaterThan(20);
    for (const [f, h] of m4) expect(hash(readFileSync(path.join(ROOT, f))), f).toBe(h);
  });

  const inv = JSON.parse(read("docs/architecture/m6-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
  it("M6-I031–I044 follow M6-I001–I030, are documented, and each is guarded by executing files that cite it", () => {
    expect(inv.map((x) => x.id)).toEqual(Array.from({ length: 44 }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    for (const row of inv.slice(30, 44)) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo4-static.test.ts");
      expect(row.guards).toContain("scripts/m6-wo4-negative-controls.mjs");
      for (const g of row.guards) {
        expect(existsSync(path.join(ROOT, g)), g).toBe(true);
        if (/\.test\.tsx?$/.test(g)) expect(read(g), `${row.id} → ${g}`).toContain(row.id);
      }
    }
  });

  it("the architecture document and the implementation report exist with their required sections", () => {
    const doc = read("docs/architecture/m6-character-advancement-access.md");
    for (const h of ["Advancement Content", "Cross-Definition Coherence", "Advancement Records", "Derived Profile", "Affinity Progression", "Concurrency", "Access and Eligibility", "API", "UI", "Known Limitations"]) expect(doc, h).toMatch(new RegExp(`^## \\d+\\. ${h}$`, "m"));
    const report = read("docs/reports/m6-wo4-implementation-report.md");
    for (const h of ["Test Totals", "Architecture Gate", "Controls"]) expect(report, h).toMatch(new RegExp(`^## \\d+\\. ${h}`, "m"));
  });

  it("the M6-WO4 gate is a named step of the consolidated CI workflow with its exact control count; no m6-wo4.yml", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/- name: M6-WO4 — Character Advancement, Access & Eligibility\n\s+run: \|\n[\s\S]*?node scripts\/ci\/verify-gate\.mjs M6-WO4 [^\n]*\n\s+PROWESS_EXPECT_CONTROLS=\d+ node scripts\/m6-wo4-negative-controls\.mjs/);
    expect(existsSync(path.join(ROOT, ".github/workflows/m6-wo4.yml"))).toBe(false);
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { gates: Array<{ id: string; tests: string[]; controls: { script: string; count: number } | null }> };
    const gate = gates.gates.find((g) => g.id === "M6-WO4");
    expect(gate?.controls?.script).toBe("scripts/m6-wo4-negative-controls.mjs");
    expect(gate?.controls?.count).toBeGreaterThanOrEqual(28);
    const count = Number(/PROWESS_EXPECT_CONTROLS=(\d+) node scripts\/m6-wo4-negative-controls\.mjs/.exec(ci)?.[1]);
    expect(count).toBe(gate?.controls?.count);
    for (const t of gate?.tests ?? []) expect(existsSync(path.join(ROOT, t)), t).toBe(true);
  });
});
