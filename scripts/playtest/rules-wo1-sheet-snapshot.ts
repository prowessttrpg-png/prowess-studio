import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { assertRunningAgainstTestDatabase, getCharacterSheet, prisma } from "../../packages/prowess-db/src/index";

/**
 * RULES-WO1 — the Character sheets a build computes for every Character in a workspace, written as JSON. The SAME file is
 * run by a previous build (on its own workspace) and by the candidate (on the workspace restored from the previous
 * build's backup) so the two can be compared. Read-only.
 */
const [output] = process.argv.slice(2);
assert(output, "Usage: rules-wo1-sheet-snapshot.ts <output.json>");
assertRunningAgainstTestDatabase(process.env.DATABASE_URL!);
const characters = await prisma.character.findMany({ where: { coreCreationCompletedAt: { not: null } }, orderBy: { id: "asc" }, select: { id: true } });
const sheets: Record<string, unknown> = {};
for (const { id } of characters) {
  const s = await getCharacterSheet(id);
  sheets[id] = JSON.parse(JSON.stringify({ identity: s.identity, release: s.release, mechanics: { stats: s.mechanics.stats, combat: s.mechanics.combat, carry: s.mechanics.carry } }));
}
await writeFile(output, JSON.stringify({ characters: characters.length, sheets }, null, 2));
console.log(JSON.stringify({ stage: "sheets", characters: characters.length }));
await prisma.$disconnect();
