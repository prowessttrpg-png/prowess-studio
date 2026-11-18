/** M7-WO1 mutation matrix (CLOSEOUT-03 harness). Each control mutates one uniquely anchored REAL source location; the
 * intended guard must fail for the named reason, and every file is restored byte-for-byte. Covers the exact-Release and
 * completion checks (01, 02), the version claim (03), the closed request body (04), the absence of combat (05), retry
 * identity in the UI (06), server-decided eligibility in the UI (07), the error mapping (08), the no-Character-write
 * boundary (09) and the reference-only membership schema (10). */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = { timeout: 600_000, ciEnv: false };
const gate = vitestGuard(root, "apps/studio", ["tests/unit/m7-wo1-static.test.ts", "--maxWorkers=1", "--reporter=dot"], options);
const ui = vitestGuard(root, "apps/studio", ["tests/unit/m7-wo1-encounter-ui.test.tsx", "--maxWorkers=1", "--reporter=dot"], options);

const SERVICE = "packages/prowess-db/src/encounter/service.ts";
const REPO = "packages/prowess-db/src/encounter/repository.ts";
const COMMANDS = "apps/studio/app/api/encounters/[encounterId]/commands/route.ts";
const WORKSPACE = "apps/studio/app/encounters/_components/EncounterWorkspace.tsx";
const ERRORS = "apps/studio/src/api/errors.ts";
const SCHEMA = "packages/prowess-db/prisma/schema.prisma";

const rows = [
  ["01 a Character on another Release may join", SERVICE, [["      if (character.rulesetReleaseId !== row.rulesetReleaseId) throw fail(E.CHARACTER_RELEASE_MISMATCH", "      if (false as boolean) throw fail(E.CHARACTER_RELEASE_MISMATCH"]], gate, /re-read on every add/],
  ["02 a DRAFT Character may join", SERVICE, [["      if (character.coreCreationCompletedAt === null) throw fail(E.CHARACTER_NOT_ELIGIBLE", "      if (character.coreCreationCompletedAt === undefined) throw fail(E.CHARACTER_NOT_ELIGIBLE"]], gate, /re-read on every add/],
  ["03 the version claim no longer requires a PREPARATION encounter", REPO, [['where: { id: encounterId, lockVersion: expectedVersion, status: "PREPARATION" }', "where: { id: encounterId, lockVersion: expectedVersion }"]], gate, /no encounter module writes a Character/],
  ["04 the command route accepts a derived readiness field", COMMANDS, [['readStrictBody(request, ["command", "expectedVersion", "idempotencyKey"])', 'readStrictBody(request, ["command", "expectedVersion", "idempotencyKey", "readiness"])']], gate, /accept exactly their documented bodies/],
  ["05 the workspace offers a combat control", WORKSPACE, [['<h2 id="encounter-readiness-heading">Readiness</h2>', '<h2 id="encounter-readiness-heading">Readiness</h2>\n        <button type="button">Start combat</button>']], gate, /no combat control/],
  ["06 a retry after a lost response uses a NEW key", WORKSPACE, [["if (pending.current?.signature !== signature) pending.current = { signature, key: newSubmissionKey() };", "pending.current = { signature, key: newSubmissionKey() };"]], ui, /SAME key/],
  ["07 the UI lets any Character be added, whatever the server decided", WORKSPACE, [['{c.eligibility === "ELIGIBLE" ? (', "{c.eligibility !== undefined ? ("]], ui, /server-eligible/],
  ["08 an encounter error code loses its HTTP status", ERRORS, [["  [ENCOUNTER_ERROR_CODES.SIDE_NOT_EMPTY]: 409,\n", ""]], gate, /explicit HTTP status/],
  ["09 an encounter command writes a Character row", REPO, [['        case "ARCHIVE":\n        case "NONE":\n          break;', '        case "ARCHIVE":\n        case "NONE":\n          await tx.character.updateMany({ where: { id: encounterId }, data: {} });\n          break;']], gate, /no encounter module writes a Character/],
  ["10 a membership stores a resource value", SCHEMA, [['  characterId String    @map("character_id") @db.Uuid\n  character   Character @relation(fields: [characterId], references: [id], onDelete: Restrict, onUpdate: Restrict)\n\n  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)\n\n  @@unique([encounterId, characterId]', '  characterId String    @map("character_id") @db.Uuid\n  character   Character @relation(fields: [characterId], references: [id], onDelete: Restrict, onUpdate: Restrict)\n  hp Int\n\n  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)\n\n  @@unique([encounterId, characterId]']], gate, /membership is a reference/],
];

runControls({
  root,
  title: "M7-WO1",
  controls: rows.map(([name, file, edits, guard, intended]) => ({
    name,
    file,
    mutate: applyEdits(name, edits),
    guard,
    expect: new RegExp(`(?:AssertionError|expected|FAIL)[\\s\\S]*${intended.source}|${intended.source}[\\s\\S]*(?:AssertionError|expected|FAIL)`, "i"),
  })),
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M7-WO1 controls caught and restored.`,
});
