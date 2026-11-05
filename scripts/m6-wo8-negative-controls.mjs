/** Permanent M6-WO8 mutation matrix (I099–I128). CLOSEOUT-03 supplies one green baseline per distinct guard,
 * behavioural failure checks, per-file byte restoration and a whole-working-tree restoration proof.
 * Mechanical mutations run the real M5/M4 tests. Persistence mutations exercise the real repository through its
 * transaction port; native PostgreSQL constraints/concurrency remain independently mandatory in CI. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(new URL("../apps/studio/package.json", import.meta.url))("typescript");
const options = { timeout: 300_000, ciEnv: false };
const args = ["--maxWorkers=1", "--no-file-parallelism", "--reporter=dot"];
const game = vitestGuard(root, "packages/prowess-game", ["src/character-signature-maneuver.test.ts", "src/m6-wo8-amendment.test.ts", ...args], options);
const focusedGame = pattern => vitestGuard(root, "packages/prowess-game", ["src/character-signature-maneuver.test.ts", "src/m6-wo8-amendment.test.ts", "-t", pattern.source, ...args], options);
const database = vitestGuard(root, "packages/prowess-db", ["--config", "vitest.unit.config.ts", "tests/unit/m6-wo8-lifecycle-contract.test.ts", "tests/unit/m6-wo8-sheet-projection.test.ts", ...args], options);
// Select the semantic contracts, not the historical source-integrity hashes. A cost mutation must fail its intended
// engine assertion, and an architecture mutation must fail its corresponding contract rather than an unrelated hash.
const architecture = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo8-static.test.ts", "-t", "D-", ...args], options);
const ui = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo8-maneuver-ui.test.tsx", ...args], options);

const G = "packages/prowess-game/src/", D = "packages/prowess-db/src/character/";
const ADAPTER = G + "character/signature-maneuver.ts", COST = G + "ability/maneuver-cost.ts", CONDITIONS = G + "ability/duration-conditions.ts";
const REPO = D + "signature-spell-repository.ts", SERVICE = D + "signature-maneuver-service.ts", PRESENTATION = D + "signature-maneuver-presentation.ts";
const BUILDER = "apps/studio/app/characters/_components/maneuvers/ManeuverBuilder.tsx";
const tokens = text => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text), result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) result.push([kind, kind === ts.SyntaxKind.StringLiteral ? scanner.getTokenValue() : scanner.getTokenText()]);
  return JSON.stringify(result);
};
const same = (node, text) => tokens(node.getText()) === tokens(text);
const walk = (node, predicate) => {
  const found = []; const visit = n => { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); }; visit(node); return found;
};
const one = (nodes, label) => { assert.equal(nodes.length, 1, `one uniquely scoped mutation site: ${label}`); return nodes[0]; };
const parse = (file, text) => {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(sf.parseDiagnostics.length, 0, `mutation must remain syntactically valid: ${file}`); return sf;
};
const scopeOf = (sf, scope) => scope === null ? sf : one(walk(sf, n => (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === scope), scope);
const replaceNode = (file, scope, before, after, predicate = () => true) => text => {
  const sf = parse(file, text), region = scopeOf(sf, scope);
  const node = one(walk(region, n => predicate(n) && same(n, before)), `${scope ?? file}: ${before}`);
  const changed = text.slice(0, node.getStart(sf)) + after + text.slice(node.getEnd()); parse(file, changed); return changed;
};
const initializer = (file, scope, name, after) => text => {
  const sf = parse(file, text), region = scopeOf(sf, scope);
  const declaration = one(walk(region, n => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name), `${scope}: ${name}`);
  assert.ok(declaration.initializer); const n = declaration.initializer;
  const changed = text.slice(0, n.getStart(sf)) + after + text.slice(n.getEnd()); parse(file, changed); return changed;
};
const chain = (...mutations) => text => mutations.reduce((value, mutate) => mutate(value), text);
const append = extra => text => `${text}\n${extra}\n`;
const propertyAncestor = (node, name) => { for (let n = node.parent; n; n = n.parent) if (ts.isPropertyAssignment(n) && n.name.getText() === name) return true; return false; };
const dropConstituent = text => {
  const sf = parse(COST, text), region = scopeOf(sf, "compileManeuverCostCore");
  const loop = one(walk(region, n => ts.isForOfStatement(n) && same(n.expression, "plan.actions") && walk(n.statement, q => ts.isPropertyAssignment(q) && same(q, 'source: "FOUNDATION"')).length > 0), "Foundation contribution loop");
  const n = loop.expression, changed = text.slice(0, n.getStart(sf)) + "plan.actions.slice(0, 1)" + text.slice(n.getEnd()); parse(COST, changed); return changed;
};
const addPriceColumn = text => {
  const pattern = /model\s+CharacterSignatureManeuverRevision\s*\{/g;
  assert.equal([...text.matchAll(pattern)].length, 1, "one Maneuver revision model");
  return text.replace(pattern, match => `${match}\n  finalApCost Int? @map("final_ap_cost")`);
};
const removeDeleteTrigger = text => {
  const pattern = /(CREATE\s+TRIGGER\s+"character_signature_maneuver_revisions_append_only"\s+BEFORE\s+UPDATE)\s+OR\s+DELETE(\s+ON)/g;
  assert.equal([...text.matchAll(pattern)].length, 1, "one append-only Maneuver trigger"); return text.replace(pattern, "$1$2");
};
// Per-control patterns name the intended failed test/contract; parse/load failures cannot satisfy the matrix.
const rows = [
  ["01 name match substitutes for exact Foundation pin", ADAPTER, replaceNode(ADAPTER, "evaluateCharacterSignatureManeuver", "findBundleDefinition(bundle, a.source.definition)", 'bundle.definitions.find(d => d.canonicalKey === (a.source as { definition: { canonicalKey: string } }).definition.canonicalKey) ?? null'), architecture, /D-I101 exact Release lookup/],
  ["02 WO6 binding bypassed with an unrelated Foundation", ADAPTER, replaceNode(ADAPTER, "evaluateCharacterSignatureManeuver", "bindWeaponAttackToManeuver({ index, attack, damageProfileKey: source.damageProfileKey, targeting })", '({ ok: true as const, value: { foundationPayload: bundle.definitions.find(d => d.definitionKind === "FOUNDATION")!.payload } })'), architecture, /D-I101 exact Release lookup/],
  ["03 Martial Action-block capacity ignored", ADAPTER, replaceNode(ADAPTER, "evaluateCharacterSignatureManeuver", "enforceActionBlockCapacity: true", "enforceActionBlockCapacity: false"), game, /enforces the actual Martial block limit/],
  ["04 Powerful Blow loses a constituent contribution", COST, dropConstituent, game, /sums every Powerful Blow constituent/],
  ["05 partial Powerful Blow Effect attachment accepted", G + "ability/compile.ts", initializer(G + "ability/compile.ts", "compileAuthoredAbilityCore", "exact", "true"), game, /rejects partial Powerful Blow attachment/],
  ["06 Action-specific Trait broadcasts to siblings", COST, replaceNode(COST, "compileManeuverCostCore", "actionKeys.includes(t.scope.componentKey)", "true"), game, /prices the required Master Move|same versioned M5 compiler/],
  ["07 protected Action AP floor removed", COST, replaceNode(COST, "compileManeuverCostCore", "protectedActionAp ?? attackFloor", "attackFloor"), game, /matches the approved exact cost example|preserves historical M5 costs/],
  ["08 Signature stage bypasses the post-Condition floor", COST, replaceNode(COST, "compileManeuverCostCore", 'bind("/request/targets/0/value", postConditionAp, "/data/finalTargets/0/value")', 'bind("/request/targets/0/value", conditionReduced, "/data/finalValue")'), game, /matches the approved exact cost example|Signature after the floor/],
  ["09 preparation AP charged as listed activation AP", COST, replaceNode(COST, "compileManeuverCostCore", "c.listedContributions", '[...c.listedContributions, ...(c.performance ? [{ ...c.listedContributions[0]!, currency: "AP" as const, modifier: "AP_COMMITMENT" as const, listedStep: c.performance.preparationApStepKey }] : [])]'), game, /Performance TRAINED|Performance EXPERT/],
  ["10 authored Performance rank overrides actual rank", CONDITIONS, chain(initializer(CONDITIONS, "compileDurationConditions", "rank", '(parameters[cr.performance.rankParameter] as string | undefined) ?? input.skillRanks?.find(q => q.skillKey === cr.performance!.skill.canonicalKey)?.rankKey'), replaceNode(CONDITIONS, "compileDurationConditions", "Object.hasOwn(parameters, cr.performance.rankParameter)", "false")), game, /rejects Untrained and authored Performance rank overrides/],
  ["11 obligatory Performance consumes ordinary capacity", CONDITIONS, replaceNode(CONDITIONS, "compileDurationConditions", "consumesSlot: cr.consumesSlot", "consumesSlot: true"), game, /Performance TRAINED|Performance EXPERT|Performance MASTER/],
  ["12 unfinished draft consumes an active slot", REPO, replaceNode(REPO, "insertSignatureSpellDraft", 'status: "DRAFT"', 'status: "ACTIVE"'), database, /creates a choices-only DRAFT/],
  ["13 invalid rebuild replaces the current revision", REPO, replaceNode(REPO, "finalizeSignatureSpell", "!decision.ok", "false"), database, /invalid rebuild cannot append/],
  ["14 shared Spell and Maneuver capacity bypassed", REPO, initializer(REPO, "finalizeSignatureSpell", "usedSlots", "0"), database, /OTHER ACTIVE roster|shared capacity exhaustion/],
  ["15 stale draft version accepted", REPO, replaceNode(REPO, "casAbility", "stored.lockVersion !== expected", "false"), database, /refuses stale draft and finalize versions/],
  ["16 derived AP persisted on immutable revisions", "packages/prowess-db/prisma/schema.prisma", addPriceColumn, architecture, /D-I099 I111 I119 persisted models/],
  ["17 authoritative AP calculated in React", BUILDER, append("export const localManeuverPrice = (baseApCost: number) => baseApCost - 1;"), architecture, /D-I116 I117 no Maneuver frontend/],
  ["18 unsupported Release draft finalized", SERVICE, replaceNode(SERVICE, "finalizeCharacterSignatureManeuver", "valid(result)", "true"), architecture, /D-I113 I115 I122 only server-valid/],
  ["19 historical revision delete protection removed", "packages/prowess-db/prisma/migrations/20261104010000_m6_wo8_signature_maneuvers/migration.sql", removeDeleteTrigger, architecture, /D-I099 I111 I119 persisted models/],
  ["20 retired Maneuver remains on the Sheet", PRESENTATION, replaceNode(PRESENTATION, "projectManeuverSheet", 'a.status === "ACTIVE" && a.current !== null', "a.current !== null"), database, /excludes drafts\/retired/],
  ["21 changed loadout ignored during finalization", REPO, replaceNode(REPO, "finalizeSignatureSpell", "(loadout?.lockVersion ?? 0) !== input.weaponLoadoutVersion", "false"), database, /refuses a changed WO6 loadout version/],
  ["22 changed Character Release ignored", REPO, replaceNode(REPO, "finalizeSignatureSpell", "locked[0]!.ruleset_release_id !== input.characterReleaseId", "false"), database, /refuses changed Character context/],
  ["23 draft CAS omits its expected version", REPO, replaceNode(REPO, "casAbility", "lockVersion: expected", "lockVersion: undefined"), database, /draft writes retain the expected version/],
  ["24 HTTP draft body admits a derived price", "apps/studio/app/api/characters/[characterId]/maneuvers/[maneuverId]/draft/route.ts", replaceNode("route.ts", "PUT", '["expectedVersion", "draft"]', '["expectedVersion", "draft", "finalApCost"]'), architecture, /D-I120 the eight APIs/],
  ["25 global Targeting replaces Action Selection", "apps/studio/app/characters/_lib/maneuver-format.ts", replaceNode("format.ts", "MANEUVER_STEPS", '"ACTION_SELECTION"', '"TARGETING"'), ui, /offers nine keyboard tabs, no global Targeting/],
  ["26 global minimum Effect requirement removed", ADAPTER, replaceNode(ADAPTER, "evaluateCharacterSignatureManeuver", "!draft.effects.length", "false"), architecture, /D-I103 I106 I121 the public construction contract/],
  ["27 builder owns live AP spending", BUILDER, append("export function spendAp(current: number) { return current - 1; }"), architecture, /D-I116 I117 no Maneuver frontend/],
  ["28 Maneuver storage writes canonical Releases", REPO, append('export const publishManeuver = () => prisma.rulesetRelease.update({ where: { id: "release" }, data: {} });'), architecture, /D-I099 I111 I119 persisted models/],
  ["29 Performance selected more than once", CONDITIONS, replaceNode(CONDITIONS, "compileDurationConditions", "conditions.some(c => c.performance)", "false"), game, /MP once across a Powerful Blow/],
  ["30 final AP minimum weakened to zero", COST, replaceNode(COST, "compileManeuverCostCore", 'modifier("maneuver.minimum_ap", FINAL_AP, "MAX", "maneuver.minimum_ap", 2, 0, policyRef, policy.minimumAp)', 'modifier("maneuver.minimum_ap", FINAL_AP, "MAX", "maneuver.minimum_ap", 2, 0, policyRef, 0)'), game, /clamps one-AP Signature activation/],
  ["31 MP minimum permits a negative result", COST, replaceNode(COST, "compileManeuverCostCore", 'modifier("maneuver.minimum_mp", FINAL_MP, "MAX", "maneuver.minimum_mp", 2, 0, policyRef, policy.minimumMp)', 'modifier("maneuver.minimum_mp", FINAL_MP, "MAX", "maneuver.minimum_mp", 2, 0, policyRef, -100)'), game, /clamps one-AP Signature activation/],
  ["32 existing three-AP Condition cap changed", G + "content/core-playtest-v0.1/duration-conditions.ts", replaceNode("conditions.ts", null, "maneuverApMaximum: 3", "maneuverApMaximum: 4"), game, /existing cap, final AP minimum/],
  ["33 invalid current revision displays a provisional AP price", PRESENTATION, replaceNode(PRESENTATION, "projectManeuverSheet", "e && valid(e)", "e", n => propertyAncestor(n, "finalApCost")), database, /hides stale\/provisional prices/],
  ["34 Maneuver finalization selects Spell history", D + "signature-maneuver-repository.ts", replaceNode("repository.ts", "finalizeSignatureManeuver", 'finalizeSignatureSpell(input, "MANEUVER")', 'finalizeSignatureSpell(input, "SPELL")'), database, /appends only Maneuver choices/],
  ["35 stale autosave evaluation overwrites newer local choices", BUILDER, replaceNode(BUILDER, "ManeuverBuilder", "!dirty.current", "true", n => ts.isIfStatement(n.parent) && n.parent.expression === n), ui, /never shows a saved evaluation as the cost of newer unsaved choices/],
  ["36 current revision evaluated across a different Release", SERVICE, replaceNode(SERVICE, "entryOf", "rev.characterReleaseId === ctx.c.rulesetReleaseId", "true"), architecture, /D-I113 I115 I122 only server-valid/],
];

runControls({
  root, title: "M6-WO8", controls: rows.map(([name, file, mutate, guard, intended]) => ({
    name, file, mutate, guard: guard === game ? focusedGame(intended) : guard,
    expect: new RegExp(`(?:AssertionError|expected|FAIL)[\\s\\S]*${intended.source}|${intended.source}[\\s\\S]*(?:AssertionError|expected|FAIL)`, "i"),
  })),
  caught: name => `Caught and restored: ${name}`,
  done: count => `All ${count} M6-WO8 controls caught and restored.`,
});
