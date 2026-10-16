/**
 * M5-WO1 behavioural negative controls (PAS-10 M5-WO1 §214–230). Each control temporarily mutates REAL source on disk,
 * runs the guard that must catch it, requires that guard to FAIL for the right reason, and restores the file in a
 * `finally`. Every file is verified byte-identical afterwards and every guard is re-run green. Never commit a control.
 *
 * Run from the repository root after building workspace packages: node scripts/m5-wo1-negative-controls.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.join(root, file);
const vitest = (pkgDir, args) => () =>
  spawnSync(process.execPath, [path.join(root, pkgDir, "node_modules/vitest/vitest.mjs"), "run", ...args], { cwd: path.join(root, pkgDir), encoding: "utf8", timeout: 120_000, env: { ...process.env, CI: "1" } });
const game = (file, pattern) => vitest("packages/prowess-game", [file, "-t", pattern]);
const staticAudit = (target) => vitest("apps/studio", ["tests/unit/m5-wo1-static.test.ts", "-t", `${target} passes`]);
const architecture = () => spawnSync(process.execPath, [abs("scripts/check-architecture.mjs")], { cwd: root, encoding: "utf8", timeout: 60_000 });

const G = (f) => `packages/prowess-game/src/${f}`;
const append = (snippet) => [[null, `\n${snippet}\n`]];
const CONTRACT_IMPORT = ["import { ABILITY_KINDS, ABILITY_SLOT_KINDS,", "import { PROWESS_DEFINITION_KINDS, ABILITY_KINDS, ABILITY_SLOT_KINDS,"];
const CONTRACT_CHECK = ["if (ref.definitionKind !== required) {", "if (PROWESS_DEFINITION_KINDS[ref.definitionKind].contract !== PROWESS_DEFINITION_KINDS[required].contract) {"];

const controls = [
  { name: "§214 Prowess logic inside @prowess/rules", file: "packages/prowess-rules/src/orchestration/model.ts", edits: append('export const affinityBonus = (affinity: string) => (affinity === "Evocation" ? 1 : 0);'), guard: staticAudit("packages/prowess-rules/src/orchestration/model.ts") },
  { name: "§215 @prowess/db imported into @prowess/game", file: G("index.ts"), edits: append('export { prisma } from "@prowess/db";'), guard: architecture, expect: /@prowess\/game[\s\S]*imports forbidden "@prowess\/db"/ },
  { name: "§216 Definition resolved through newest / latest EntityVersion", file: G("bundle/bundle.ts"), edits: append("export const getLatestEntityVersion = (versions: readonly { revisionNumber: number }[]) => versions.at(-1);"), guard: staticAudit(G("bundle/bundle.ts")) },
  { name: "§217 compiled step identity from randomUUID", file: G("compilation/assemble.ts"), edits: [['return ["prowess", abilityKind, compositionKey, fragmentKey].join(":");', 'return ["prowess", abilityKind, compositionKey, fragmentKey, globalThis.crypto.randomUUID()].join(":");']], guard: game("src/compilation.test.ts", "deterministic step keys") },
  { name: "§218 Emission treated as canonical", file: G("vocabulary/terminology.ts"), edits: [['entry("Emission", "AFFINITY", L,', 'entry("Emission", "AFFINITY", C,']], guard: game("src/definition-envelope.test.ts", "rejects Emission as a canonical") },
  { name: "§219 historical source text rewritten Emission → Evocation", file: "packages/prowess-db/src/source-ingestion/docx/parse.ts", edits: [["        rawText: raw,\n", '        rawText: raw.replace(/Emission/g, "Evocation"),\n']], guard: vitest("packages/prowess-db", ["--config", "vitest.unit.config.ts", "tests/unit/m5-source-terminology.test.ts"]) },
  { name: "§220 SPELL_EFFECT accepted in a Maneuver by shared contract", file: G("construction/composition.ts"), edits: [CONTRACT_IMPORT, CONTRACT_CHECK], guard: game("src/ability-construction.test.ts", "SPELL_EFFECT in a Maneuver") },
  { name: "§221 SPELL_TRAIT accepted in a Maneuver by shared contract", file: G("construction/composition.ts"), edits: [CONTRACT_IMPORT, CONTRACT_CHECK], guard: game("src/ability-construction.test.ts", "SPELL_TRAIT in a Maneuver") },
  { name: "§222 Spell / Maneuver Radius treated as one Definition", file: G("definition/envelope.ts"), edits: [["  return (\n    a.entityId === b.entityId &&", '  return a.canonicalKey.split(".").pop() === b.canonicalKey.split(".").pop() || (\n    a.entityId === b.entityId &&']], guard: game("src/ability-construction.test.ts", "share semantic shape and geometry contract") },
  { name: "§223 Radius implies a Save", file: G("definition/payload.ts"), edits: [['  "save",\n  "saves",\n  "saveStat",\n', ""]], guard: game("src/ability-construction.test.ts", "cannot carry an Effect") },
  { name: "§224 Radius Targeting creates Damage", file: G("definition/payload.ts"), edits: [['  "damage",\n', ""]], guard: game("src/ability-construction.test.ts", "cannot carry an Effect") },
  { name: "§225 hidden Spell AP math in compilation code", file: G("compilation/compile.ts"), edits: append("export const spellAp = (listedMp: number, prowess: number) => Math.max(1, Math.floor(listedMp / prowess));"), guard: staticAudit(G("compilation/compile.ts")) },
  { name: "§226 hidden Maneuver final AP in compiler scaffolding", file: G("compilation/assemble.ts"), edits: append("export const maneuverFinalAp = (base: number, extra: number) => base + extra;"), guard: staticAudit(G("compilation/assemble.ts")) },
  { name: "§227 R1 Effect bundled with an unpinned R2 Trait", file: G("bundle/bundle.ts"), edits: [["if (pinned === null || pinned.entityVersionId !== envelope.entityVersionId) {", "if (pinned === null) {"]], guard: game("src/definition-bundle.test.ts", "never mixes Rulesets") },
  { name: "§228 Definition resolved by display name", file: G("bundle/bundle.ts"), edits: append("export const byDisplayName = (defs: readonly { displayName: string }[], n: string) => defs.find((d) => d.displayName === n);"), guard: staticAudit(G("bundle/bundle.ts")) },
  { name: "§229 MANEUVER inferred from a weapon field", file: G("construction/composition.ts"), edits: [['const abilityKind = own(input, "abilityKind");', 'const abilityKind = own(input, "abilityKind") ?? ("weapon" in input ? "MANEUVER" : "SPELL");']], guard: game("src/ability-construction.test.ts", "AbilityKind is explicit") },
  { name: "§230 Target Must Be Bloodied treated as applying Bloodied", file: G("definition/payload.ts"), edits: [["forbiddenKeyPaths(r, ABILITY_CONDITION_FORBIDDEN_KEYS, at)", "forbiddenKeyPaths(r, [], at)"]], guard: game("src/ability-construction.test.ts", "applies a status to the target") },
];

const originals = new Map();
const restore = () => {
  for (const [file, text] of originals) writeFileSync(abs(file), text);
};
try {
  for (const control of controls) {
    if (!originals.has(control.file)) originals.set(control.file, readFileSync(abs(control.file), "utf8"));
    const original = originals.get(control.file);
    const baseline = control.guard();
    assert.equal(baseline.status, 0, `baseline guard is not green for ${control.name}:\n${baseline.stdout}${baseline.stderr}`);

    let mutated = original;
    for (const [from, to] of control.edits) {
      if (from === null) mutated = `${mutated}${to}`;
      else {
        assert.equal(mutated.split(from).length, 2, `mutation anchor must occur exactly once (${control.name}): ${from}`);
        mutated = mutated.replace(from, to);
      }
    }
    assert.notEqual(mutated, original);
    writeFileSync(abs(control.file), mutated);
    try {
      const result = control.guard();
      assert.notEqual(result.status, 0, `control was NOT caught: ${control.name}`);
      assert.match(`${result.stdout}${result.stderr}`, control.expect ?? /AssertionError/, `control failed for infrastructure rather than behaviour: ${control.name}\n${result.stdout}${result.stderr}`);
    } finally {
      writeFileSync(abs(control.file), original);
    }
    assert.equal(control.guard().status, 0, `guard not green after restoring ${control.name}`);
    console.log(`Negative control caught: ${control.name}`);
  }
} finally {
  restore();
}
for (const [file, text] of originals) assert.equal(readFileSync(abs(file), "utf8"), text, `${file} was not restored byte-for-byte`);
console.log(`All ${controls.length} M5-WO1 negative controls caught; every mutated file restored byte-for-byte.`);
