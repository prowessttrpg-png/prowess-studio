// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ENCOUNTER_ERROR_CODES } from "@prowess/model";
import { describe, expect, it } from "vitest";
import { statusForDomainErrorCode } from "../../src/api/errors";
import { PRIMARY_NAVIGATION } from "../../src/navigation";

/**
 * M7-WO1 gate — Encounter foundation and roster. Pins the boundaries this Work Order relies on:
 *   - exactly its registered schema (four models, one additive migration at its exact hash) and five routes;
 *   - memberships are references: no resource / combat column, and no encounter module writes a Character table;
 *   - the database guards (exact-Release trigger, composite keys, archived freeze, append-only history, no delete);
 *   - closed request contracts (strict bodies / queries) and an explicit HTTP status for every encounter error code;
 *   - the encounter UI is HTTP-only and has no combat control; encounters are workspace state, never pack content;
 *   - the invariants, CI gate and negative controls.
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
const MIGRATION = "packages/prowess-db/prisma/migrations/20261118010000_m7_wo1_encounter_foundation/migration.sql";
const ROUTES = [
  "apps/studio/app/api/encounters/[encounterId]/characters/route.ts",
  "apps/studio/app/api/encounters/[encounterId]/commands/route.ts",
  "apps/studio/app/api/encounters/[encounterId]/events/route.ts",
  "apps/studio/app/api/encounters/[encounterId]/route.ts",
  "apps/studio/app/api/encounters/route.ts",
];
const ENCOUNTER_DB = ["packages/prowess-db/src/encounter/repository.ts", "packages/prowess-db/src/encounter/service.ts", "packages/prowess-db/src/encounter/index.ts"];
const UI = walk("apps/studio/app/encounters").filter((f) => /\.tsx?$/.test(f));

describe("M7-WO1 gate — schema, migration and routes are exactly the registered additions", () => {
  it("registers four models, one migration and five routes under M7-WO1", () => {
    expect((JSON.parse(read("docs/architecture/m6-schema-changes.json")) as Record<string, unknown>)["M7-WO1"]).toEqual({ migrations: ["20261118010000_m7_wo1_encounter_foundation"], models: ["Encounter", "EncounterSide", "EncounterParticipant", "EncounterEvent"] });
    expect(((JSON.parse(read("docs/architecture/m6-api-routes.json")) as Record<string, string[]>)["M7-WO1"] ?? []).sort()).toEqual(ROUTES);
    expect(walk("apps/studio/app/api/encounters").filter((f) => f.endsWith("route.ts")).sort()).toEqual(ROUTES);
  });

  it("the migration is additive, pinned at its exact hash, and creates only the encounter tables", () => {
    expect(sha(MIGRATION)).toBe("23d45d84611c3d8e6b5baf79aa0584e809454e200407aa26d7b9ab73bfcde0d5");
    const sql = read(MIGRATION);
    expect([...sql.matchAll(/^CREATE TABLE "([a-z_]+)"/gm)].map((m) => m[1]).sort()).toEqual(["encounter_events", "encounter_participants", "encounter_sides", "encounters"]);
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im);
    expect(sql).not.toMatch(/ALTER TABLE "(?!encounter)[a-z_]+"/);
  });

  it("a membership is a reference: no resource, initiative or combat column exists on any encounter table", () => {
    const block = read("packages/prowess-db/prisma/schema.prisma").split("// >>> M7-WO1")[1]!.split("// <<< M7-WO1")[0]!;
    expect(strip(block)).not.toMatch(/\b(hp|mp|me|ap|currentHp|counterActions?|initiative|round|turn|phase|activeMagic|resource\w*|damage|condition\w*)\b\s+(Int|String|Json|Boolean)/i);
    const participant = strip(block).split("model EncounterParticipant {")[1]!.split("}")[0]!;
    expect([...participant.matchAll(/^\s{2}(\w+)\s+(String|DateTime|Int|Json)\??\s/gm)].map((m) => m[1]).sort()).toEqual(["characterId", "createdAt", "encounterId", "id", "rulesetReleaseId", "sideId"]);
  });

  it("the database guards exist: exact-Release trigger, composite keys, archived freeze, append-only history, no delete", () => {
    const sql = read(MIGRATION);
    for (const guard of [
      '"encounter_participants_release" BEFORE INSERT OR UPDATE ON "encounter_participants"',
      'FOREIGN KEY ("side_id", "encounter_id") REFERENCES "encounter_sides"("id", "encounter_id")',
      'FOREIGN KEY ("encounter_id", "ruleset_release_id") REFERENCES "encounters"("id", "ruleset_release_id")',
      '"encounters_guard" BEFORE UPDATE ON "encounters"',
      '"encounters_no_delete" BEFORE DELETE ON "encounters"',
      '"encounter_events_append_only" BEFORE UPDATE OR DELETE ON "encounter_events"',
      '"encounter_participants_roster_open" BEFORE INSERT OR UPDATE OR DELETE ON "encounter_participants"',
      '"encounter_sides_roster_open" BEFORE INSERT OR UPDATE OR DELETE ON "encounter_sides"',
      'CREATE UNIQUE INDEX "encounter_events_idempotency_key_key" ON "encounter_events"("idempotency_key")',
      'CREATE UNIQUE INDEX "encounter_participants_encounter_id_character_id_key"',
    ])
      expect(sql, guard).toContain(guard);
  });
});

describe("M7-WO1 gate — authority boundaries", () => {
  it("no encounter module writes a Character, sheet, play runtime or play event; reads are explicit selects", () => {
    for (const f of ENCOUNTER_DB) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/\b(prisma|tx)\.(character\w*)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/);
      expect(src, f).not.toMatch(/sheet-repository|writePlayState|commitPlayOperation|commitCharacterPlayOperation|\$executeRaw|\$queryRaw|characterPlay(Runtime|Event)\b/);
      // The ONE import from the play repository is its read of the stored runtime (WO10 stays the only play-table module).
      for (const m of src.matchAll(/import \{([^}]*)\} from "\.\.\/character\/play-repository\.js"/g)) expect(m[1]!.trim(), f).toBe("selectPlayRuntime");
    }
    const repo = strip(read("packages/prowess-db/src/encounter/repository.ts"));
    // The ONLY transaction writers are the encounter tables, and every command claims the version first.
    expect([...repo.matchAll(/tx\.(\w+)\.(create|update|updateMany|deleteMany|delete|upsert)\(/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i).sort()).toEqual(["encounter", "encounterEvent", "encounterParticipant", "encounterSide"]);
    expect(repo).toContain('where: { id: encounterId, lockVersion: expectedVersion, status: "PREPARATION" }');
    expect(repo.indexOf("tx.encounter.updateMany(")).toBeLessThan(repo.indexOf("switch (change.kind)"));
  });

  it("commands are closed, keys are required, and the Character is re-read on every add", () => {
    const service = strip(read("packages/prowess-db/src/encounter/service.ts"));
    expect(service).toContain('export const ENCOUNTER_COMMAND_KINDS = ["UPDATE_METADATA", "ADD_SIDE", "RENAME_SIDE", "REMOVE_SIDE", "ADD_PARTICIPANT", "MOVE_PARTICIPANT", "REMOVE_PARTICIPANT", "ARCHIVE"] as const;');
    expect(service).toContain("const character = await selectCharacterForRoster(command.characterId);");
    expect(service).toContain("if (character.rulesetReleaseId !== row.rulesetReleaseId) throw fail(E.CHARACTER_RELEASE_MISMATCH");
    expect(service).toContain("if (character.coreCreationCompletedAt === null) throw fail(E.CHARACTER_NOT_ELIGIBLE");
    expect(service).toContain("if (prior.encounterId !== eid || prior.requestHash !== requestHash) throw fail(E.IDEMPOTENCY_CONFLICT");
    expect(service).not.toMatch(/readiness\s*:\s*input|input\.readiness|body\.readiness/);
  });

  it("routes accept exactly their documented bodies and queries", () => {
    const src = (f: string) => read(`apps/studio/app/api/encounters/${f}`);
    expect(src("route.ts")).toContain('readStrictBody(request, ["name", "notes", "rulesetReleaseId", "idempotencyKey"])');
    expect(src("route.ts")).toContain('strictQuery(searchParams, ["page", "pageSize", "q", "status"])');
    expect(src("[encounterId]/route.ts")).toContain("strictQuery(new URL(request.url).searchParams, [])");
    expect(src("[encounterId]/commands/route.ts")).toContain('readStrictBody(request, ["command", "expectedVersion", "idempotencyKey"])');
    expect(src("[encounterId]/characters/route.ts")).toContain('strictQuery(searchParams, ["q"])');
    expect(src("[encounterId]/events/route.ts")).toContain('strictQuery(searchParams, ["before", "limit"])');
    for (const f of ROUTES) expect(read(f), f).not.toMatch(/export async function (PUT|PATCH|DELETE)/);
  });

  it("every encounter error code has an explicit HTTP status", () => {
    for (const code of Object.values(ENCOUNTER_ERROR_CODES)) expect(statusForDomainErrorCode(code), code).toBeTypeOf("number");
    expect(statusForDomainErrorCode(ENCOUNTER_ERROR_CODES.STALE_WRITE)).toBe(409);
    expect(statusForDomainErrorCode(ENCOUNTER_ERROR_CODES.SIDE_NOT_FOUND)).toBe(404);
    expect(statusForDomainErrorCode(ENCOUNTER_ERROR_CODES.INVALID_INPUT)).toBe(400);
  });

  it("the encounter UI is HTTP-only, computes nothing and offers no combat control", () => {
    expect(UI.length).toBeGreaterThan(4);
    for (const f of UI) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/from "@prowess\/(db|game|rules)"|generated\/prisma/);
      expect(src, f).not.toMatch(/\bfetch\(/);
      expect(src, f).not.toMatch(/<button[^>]*>\s*(Start|Begin) combat|Roll initiative/i);
      expect(src, f).not.toMatch(/readiness\s*=\s*\{|\.state\s*=\s*"PREPARED"/);
    }
    expect(PRIMARY_NAVIGATION.find((e) => e.id === "encounters")).toMatchObject({ href: "/encounters" });
    expect(read("scripts/check-architecture.mjs")).toContain('name: "apps/studio (app/encounters/)"');
  });

  it("encounters are workspace state: in the desktop backup (every table), never in a content pack", () => {
    for (const f of walk("packages/prowess-db/src/content-pack")) expect(strip(read(f)), f).not.toMatch(/encounter/i);
    // The desktop backup covers every public table the migrations create (stage-prototype derives the list from them).
    expect(read("scripts/distribution/stage-prototype.mjs")).toMatch(/for \(const \[, table\] of sql\.matchAll\(\/\^CREATE TABLE/);
  });
});

describe("M7-WO1 gate — invariants, CI gate and evidence", () => {
  it("M7-I001–I012 are declared, documented and name existing guards", () => {
    const rows = JSON.parse(read("docs/architecture/m7-invariants.json")) as Array<{ id: string; title: string; guards: string[] }>;
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 12 }, (_, i) => `M7-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m7-invariants.md");
    for (const row of rows) {
      expect(md).toContain(`### ${row.id} — ${row.title}`);
      for (const f of row.guards) expect(existsSync(path.join(ROOT, f)), `${row.id}: ${f}`).toBe(true);
    }
  });

  it("runs as a named CI gate with its negative controls and the restore proof", () => {
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { gates: Array<{ id: string; tests: string[]; controls: { script: string; count: number } | null }> };
    const gate = gates.gates.find((g) => g.id === "M7-WO1");
    expect(gate?.controls).toMatchObject({ script: "scripts/m7-wo1-negative-controls.mjs" });
    expect(gate?.tests).toEqual(expect.arrayContaining(["apps/studio/tests/unit/m7-wo1-static.test.ts", "apps/studio/tests/unit/m7-wo1-encounter-ui.test.tsx"]));
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain(`PROWESS_EXPECT_CONTROLS=${gate!.controls!.count} node scripts/m7-wo1-negative-controls.mjs`);
    expect(ci).toContain("scripts/distribution/verify-m7-wo1-encounter-restore.mjs");
  });
});
