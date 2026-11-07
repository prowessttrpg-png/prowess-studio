/** Permanent M6-WO10 mutation matrix (M6-I151 – M6-I172). CLOSEOUT-03 harness: one green baseline per distinct guard,
 * each control mutates one uniquely anchored REAL source location, the intended guard must fail for the named
 * behavioural / architectural reason, and every file — and the whole working tree — is restored byte-for-byte.
 * Domain mutations run the real M5 / M4-backed play tests; Studio mutations run the Play UI and the WO10 static gate.
 * Native PostgreSQL behaviour (atomicity, append-only ledger, idempotency, compare-and-set) stays independently
 * mandatory in the DB / API suites registered with the gate. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = ["--maxWorkers=1", "--no-file-parallelism", "--reporter=dot"];
const options = { timeout: 900_000, ciEnv: false };
const game = (pattern) => vitestGuard(root, "packages/prowess-game", ["src/play-workspace.test.ts", "-t", pattern.source, ...args], options);
const architecture = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo10-static.test.ts", "-t", "W10-", ...args], options);
const ui = (pattern) => vitestGuard(root, "apps/studio", ["tests/unit/m6-wo10-play-ui.test.tsx", "-t", pattern.source, ...args], options);

const G = "packages/prowess-game/src/", PLAY = G + "play/", OPS = PLAY + "operations.ts", ENGINE = PLAY + "engine.ts", ABIL = PLAY + "abilities.ts";
const SERVICE = "packages/prowess-db/src/character/play-service.ts", REPO = "packages/prowess-db/src/character/play-repository.ts";
const MIGRATION = "packages/prowess-db/prisma/migrations/20261108010000_m6_wo10_character_play_workspace/migration.sql";
const UI = "apps/studio/app/characters/_components/play/", SHEET = "apps/studio/app/characters/_components/sheet/SheetPanels.tsx";

// [name, file, edits, guard, intended test / contract pattern]
const rows = [
  // ---- the one resource authority ------------------------------------------------------------------------------------------
  ["01 Action payment state taken without WO3 confirmation", ENGINE, [["const confirmation = confirmActionPayment({ plan: out.run.plan, run: out.run.raw, resources: out.run.before });", "const confirmation = { ok: true as const, value: { status: \"PAID\", resources: out.run.reading.resources } } as unknown as ReturnType<typeof confirmActionPayment>;"]], architecture, /W10-I151/],
  ["02 sheet current replaced by the derived maximum", OPS, [["const current = onSheet?.current ?? sheet?.maximum ?? null;", "const current = sheet?.maximum ?? onSheet?.current ?? null;"]], game(/FIXED payment is confirmed before any follow-on/), /FIXED payment is confirmed before any follow-on/],
  ["03 unchanged sheet Resources rewritten on commit", SERVICE, [["sheetKeys.has(r.resourceKey) && before.get(r.resourceKey) !== r.current", "sheetKeys.has(r.resourceKey)"]], architecture, /W10-I151/],
  ["04 a second round step computed outside the ordinal", G + "internal/round.ts", [["return previous === null ? 1 : previous + 1;", "return previous === null ? 1 : previous + 2;"]], architecture, /W10-I151 I171/],
  // ---- provenance ------------------------------------------------------------------------------------------------------------
  ["05 runtime attributed to the wrong Release", OPS, [["    releaseId: ctx.releaseId,\n    rulesetProvenance: ctx.bundle.rulesetProvenance,", "    releaseId: ctx.characterId,\n    rulesetProvenance: ctx.bundle.rulesetProvenance,"]], game(/initializes from the sheet's derived values with exact Character and Release provenance/), /initializes from the sheet's derived values/],
  ["06 another Release's Maneuver revision re-evaluated", OPS, [["if (found.revisionReleaseId !== ctx.releaseId) return refuse(R.RELEASE_MISMATCH", "if (found.revisionReleaseId === \"\" && ctx.releaseId === \"\") return refuse(R.RELEASE_MISMATCH"]], architecture, /W10-I152/],
  ["07 a stale Spell revision accepted as current", OPS, [["if (source.revisionNumber !== revisionNumber) return { error:", "if (source.revisionNumber < 0) return { error:"]], game(/exact revision identity/), /exact revision identity/],
  ["08 another Character's stored play state read", PLAY + "state.ts", [["if (value.characterId !== expected.characterId) return", "if (value.characterId === null) return"]], architecture, /W10-I152/],
  ["09 runtime compare-and-set ignores the Release", REPO, [["where: { characterId, lockVersion: input.expectedRuntimeVersion, rulesetReleaseId: input.rulesetReleaseId }", "where: { characterId, lockVersion: input.expectedRuntimeVersion }"]], architecture, /W10-I152/],
  // ---- closed contract, preview / commit -------------------------------------------------------------------------------------
  ["10 unknown operation kinds accepted", OPS, [["    default:\n      return bad(\"unknown operation kind\");", "    default:\n      return { ok: true, value: clonePlainData(value) as unknown as PlayOperation };"]], architecture, /W10-I153/],
  ["11 a client-supplied derived cost accepted", OPS, [["closed(value, [\"kind\", \"actionKey\", \"chosenCost\", \"trigger\"], [\"kind\", \"actionKey\"])", "closed(value, [\"kind\", \"actionKey\", \"chosenCost\", \"trigger\", \"apCost\"], [\"kind\", \"actionKey\"])"]], game(/the operation contract is closed/), /the operation contract is closed/],
  ["12 preview evaluates a stale state", SERVICE, [["  const l = await load(characterId);\n  staleIf(l, expected);\n  return { versions: l.versions, outcome: evaluatePlayOperation(l.ctx, l.stored, operation) };", "  const l = await load(characterId);\n  return { versions: l.versions, outcome: evaluatePlayOperation(l.ctx, l.stored, operation) };"]], architecture, /W10-I154/],
  ["13 a non-committable outcome written", SERVICE, [["if (outcome.status !== \"COMMITTABLE\" || outcome.runtimeAfter === null || outcome.resourcesAfter === null) return { committed: false", "if (outcome.runtimeAfter === null || outcome.resourcesAfter === null) return { committed: false"]], architecture, /W10-I154/],
  // ---- atomicity and the ledger ----------------------------------------------------------------------------------------------
  ["14 event written outside the transaction", REPO, [["const event = await tx.characterPlayEvent.create({", "const event = await prisma.characterPlayEvent.create({"]], architecture, /W10-I155/],
  ["15 a second module writes the play tables", "packages/prowess-db/src/character/sheet-repository.ts", [[null, "\nexport const playEventsTable = \"character_play_events\";\n"]], architecture, /W10-I155/],
  ["16 ledger rows become updatable", MIGRATION, [["BEFORE UPDATE OR DELETE ON \"character_play_events\"", "BEFORE DELETE ON \"character_play_events\""]], architecture, /W10-I169/],
  ["17 the repository can purge history", REPO, [[null, "\nexport const purgePlayEvents = (characterId: string) => prisma.characterPlayEvent.deleteMany({ where: { characterId } });\n"]], architecture, /W10-I169/],
  // ---- idempotency and concurrency -------------------------------------------------------------------------------------------
  ["18 idempotency key not validated", SERVICE, [["if (typeof input.idempotencyKey !== \"string\" || !UUID.test(input.idempotencyKey)) throw", "if (typeof input.idempotencyKey !== \"string\") throw"]], architecture, /W10-I156/],
  ["19 reused key with another operation replayed", SERVICE, [["if (prior.requestHash !== requestHash) throw", "if (prior.requestHash === \"\") throw"]], architecture, /W10-I156/],
  ["20 a retry gets a fresh idempotency key", UI + "PlayWorkspace.tsx", [["if (pendingKey.current === null || pendingKey.current.body !== body) pendingKey.current = { key: newKey(), body };", "pendingKey.current = { key: newKey(), body };"]], ui(/reuses the same idempotency key/), /reuses the same idempotency key/],
  ["21 runtime version not compared", SERVICE, [["expected.runtimeVersion !== l.versions.runtimeVersion || ", ""]], architecture, /W10-I157/],
  ["22 runtime compare-and-set miss ignored", REPO, [["if (claimed.count !== 1) throw new Abort({ outcome: \"stale\", which: \"RUNTIME\" });", "void claimed;"]], architecture, /W10-I157/],
  ["23 a stale submission keeps its key", UI + "PlayWorkspace.tsx", [["Nothing was applied; the latest state is loaded — review and submit again.\");\n        pendingKey.current = null;", "Nothing was applied; the latest state is loaded — review and submit again.\");"]], architecture, /W10-I157/],
  // ---- payment ---------------------------------------------------------------------------------------------------------------
  ["24 a Spell paid before its inputs are complete", OPS, [["if (executed.value.status === \"PENDING_INPUT\") {\n    return { ...refuse(R.PENDING_INPUT, `${String(executed.value.pendingInputs.length)} input(s) needed before the Spell resolves", "if (executed.value.status === (\"NEVER\" as never)) {\n    return { ...refuse(R.PENDING_INPUT, `${String(executed.value.pendingInputs.length)} input(s) needed before the Spell resolves"]], game(/a Spell with missing inputs pays nothing/), /a Spell with missing inputs pays nothing/],
  ["25 an unconfirmed Action payment accepted", OPS, [["  if (paid.confirmation.status !== \"PAID\") return { ...paymentRefusal(paid.confirmation), source };\n", ""]], architecture, /W10-I158/],
  ["26 a Weapon Attack charged its AP twice", OPS, [["return { ap: { kind: \"SPEND\", amount: ap, sourceKey: a.attack.canonicalKey }", "return { ap: { kind: \"SPEND\", amount: ap + ap, sourceKey: a.attack.canonicalKey }"]], game(/a Weapon Attack pays its OWN authored AP once/), /a Weapon Attack pays its OWN authored AP once/],
  ["27 Attack MP treated as ME-eligible", OPS, [["mp: mp > 0 ? { amount: mp, meEligible: false, sourceKey: a.attack.canonicalKey } : null", "mp: mp > 0 ? { amount: mp, meEligible: true, sourceKey: a.attack.canonicalKey } : null"]], architecture, /W10-I158 I159/],
  ["28 Spell casting MP denied Mana Efficiency", OPS, [["mp: { amount: costs.finalMpCost, meEligible: SPELL_CASTING_ME_ELIGIBLE, sourceKey: label }", "mp: { amount: costs.finalMpCost, meEligible: false, sourceKey: label }"]], architecture, /W10-I158 I159/],
  ["29 a standalone Saving Throw Attack executed", OPS, [["if (attack.resolution.mode === \"SAVING_THROW\") return { supported: false", "if (attack.resolution.mode === (\"NONE\" as never)) return { supported: false"]], architecture, /W10-I158 I159/],
  // ---- timing ----------------------------------------------------------------------------------------------------------------
  ["30 a second turn in one round refreshes AP twice", OPS, [[": c.turn === \"ENDED\" ? \"this Character has already taken its turn this round (AP would refresh twice)\" : null", ": null"]], game(/duplicate or out-of-sequence timing events are refused/), /duplicate or out-of-sequence timing events are refused/],
  ["31 the turn start runs the round's timing", OPS, [["const out = timed(\"START_OF_TURN\", c.round);", "const out = timed(\"START_OF_ROUND\", c.round);"]], game(/START_OF_ROUND refreshes ME and Counter Actions/), /START_OF_ROUND refreshes ME and Counter Actions/],
  // ---- cost models and Counter Actions ---------------------------------------------------------------------------------------
  ["32 a VARIABLE cost priced as a FIXED zero", OPS, [["  if (cost.model === \"VARIABLE\") {\n    return cost.determinedBy === \"SPELL\"", "  if (cost.model === (\"VARIABLE_X\" as never)) {\n    return cost.determinedBy === \"SPELL\""]], game(/VARIABLE costs are never priced as zero/), /VARIABLE costs are never priced as zero/],
  ["33 conflicting improvements resolved by picking one", OPS, [["if (overrides.length > 1) return refuse(R.IMPROVEMENT_CONFLICT", "if (overrides.length > 9) return refuse(R.IMPROVEMENT_CONFLICT"]], architecture, /W10-I161 I163/],
  ["34 a conditional improvement applied unconditionally", OPS, [["m.support === \"APPLIED\" && m.condition === null && m.actionPointCost !== null", "m.support === \"APPLIED\" && m.actionPointCost !== null"]], architecture, /W10-I161 I163/],
  ["35 a reaction used without a declared trigger", OPS, [["if (action.payload.requiresTrigger && op.trigger === undefined) return", "if (action.payload.requiresTrigger && op.trigger === null) return"]], game(/Counter Actions: outside the own turn/), /Counter Actions: outside the own turn/],
  ["36 a reaction used on the own turn", OPS, [["if (window === \"OWN_TURN\") return refuse(R.WRONG_TIMING_WINDOW, \"this reaction is used outside the Character's own turn\"", "if (window === (\"NONE\" as never)) return refuse(R.WRONG_TIMING_WINDOW, \"this reaction is used outside the Character's own turn\""]], game(/Counter Actions: outside the own turn/), /Counter Actions: outside the own turn/],
  // ---- movement ----------------------------------------------------------------------------------------------------------------
  ["37 movement spent outside the own turn", OPS, [["if (windowOf(runtime) !== \"OWN_TURN\") return refuse(R.WRONG_TIMING_WINDOW, \"movement is spent", "if (windowOf(runtime) === (\"NONE\" as never)) return refuse(R.WRONG_TIMING_WINDOW, \"movement is spent"]], architecture, /W10-I162/],
  ["38 the turn's movement record carried into the next turn", OPS, [["next = { ...next, combat: { ...c, turn: \"ACTIVE\" }, movement: { grants: [], segments: [] } };", "next = { ...next, combat: { ...c, turn: \"ACTIVE\" } };"]], architecture, /W10-I162/],
  // ---- rolls and Saves ---------------------------------------------------------------------------------------------------------
  ["39 Saving Throw Stats left to Studio", ABIL, [["defenderStats: request.kind === \"SAVING_THROW\" ? [...PROWESS_STATS] : null", "defenderStats: null"]], architecture, /W10-I164/],
  ["40 a GM-provided DC recorded as the Character DC", ABIL, [["source: input.difficultyClass === undefined ? \"CHARACTER_DC\" : \"PLAYER_GM_PROVIDED\"", "source: \"CHARACTER_DC\""]], architecture, /W10-I164/],
  ["41 modulo-biased digital dice", UI + "play-dice.ts", [["if (v < limit) out.push((v % faces) + 1);", "out.push((v % faces) + 1);"]], architecture, /W10-I164/],
  // ---- Spell / Maneuver separation, Active Magic ---------------------------------------------------------------------------------
  ["42 Maneuver groups collapsed into one resolution", OPS, [["executeCompiled(e.compiled, op.targets, op.groupTargets, built.value.inputs)", "executeCompiled(e.compiled, op.targets, null, built.value.inputs)"]], architecture, /W10-I165/],
  ["43 Active Magic run without the Character Spell adapter", OPS, [["state: runtime.activeMagic, event }, characterSpellAdapter(ctx));", "state: runtime.activeMagic, event }, null);"]], game(/a Sustained Signature Spell activates once/), /a Sustained Signature Spell activates once/],
  ["44 a persistent Spell never becomes Active Magic", OPS, [["duration.mode !== \"INSTANT\" && duration.futureRuntime.persists) {", "duration.mode !== \"INSTANT\" && duration.futureRuntime.persists && duration.mode === (\"NONE\" as never)) {"]], game(/a Sustained Signature Spell activates once/), /a Sustained Signature Spell activates once/],
  // ---- no target application, manual adjustments ---------------------------------------------------------------------------------
  ["45 authorised damage shown as applied", UI + "ActionDetailPanel.tsx", [["— NOT APPLIED (roll and apply with the GM).", "— applied."]], architecture, /W10-I167/],
  ["46 a manual adjustment classified as rules-executed", OPS, [["return accept(\"MANUAL_ADJUSTMENT\", `Manual adjustment:", "return accept(\"RULES_EXECUTED\", `Manual adjustment:"]], game(/a manual adjustment is validated against the sheet bounds/), /a manual adjustment is validated against the sheet bounds/],
  ["47 manual adjustment bounds bypassed", OPS, [["const issues = validateSheetPlayState({ resources: ctx.mechanics.resources, values: { [op.resourceKey]: op.after } });", "const issues: { readonly message: string }[] = [];"]], game(/a manual adjustment is validated against the sheet bounds/), /a manual adjustment is validated against the sheet bounds/],
  // ---- Sheet / Card compatibility, Studio, approved M5 adapters ------------------------------------------------------------------
  ["48 the Play link printed on the paper Sheet", SHEET, [["          ·{\" \"}\n          <a href={`/characters/${encodeURIComponent(sheet.identity.id)}/play`} data-testid=\"sheet-play-link\">\n            Play Workspace\n          </a>\n", ""], ["      <WeaponAttackRows sheet={sheet} printRows={PRINT_ATTACK_ROWS} />\n", "      <a href={`/characters/${encodeURIComponent(sheet.identity.id)}/play`} data-testid=\"sheet-play-link\">Play Workspace</a>\n      <WeaponAttackRows sheet={sheet} printRows={PRINT_ATTACK_ROWS} />\n"]], architecture, /W10-I170/],
  ["49 the card drawer gains a play submission", UI + "PlayWorkspace.tsx", [["              <h2>Card</h2>", "              <h2>Card</h2>\n              <button type=\"button\" onClick={() => void submitter.commit({ kind: \"NOTE\", text: \"card\" } as never)}>Use</button>"]], architecture, /W10-I170/],
  ["50 Studio recomputes a remaining resource", UI + "PlayPanels.tsx", [[null, "\nexport const remaining = (r: { current: number; reservedCapacity: number }) => r.current - r.reservedCapacity;\n"]], architecture, /W10-I172/],
  ["51 the canonical Active Magic entry point gains an adapter", G + "ability/active-magic.ts", [["  return transitionActiveMagicWith(request, null);", "  return transitionActiveMagicWith(request, { handles: () => false } as never);"]], architecture, /W10-I171/],
  ["52 an invalid Maneuver plan captured for execution", G + "character/signature-maneuver.ts", [["if (execution.ok && capture !== undefined && cost.value.valid) capture(execution.value);", "if (execution.ok && capture !== undefined) capture(execution.value);"]], architecture, /W10-I171/],
];

runControls({
  root,
  title: "M6-WO10",
  controls: rows.map(([name, file, edits, guard, intended]) => ({
    name,
    file,
    mutate: applyEdits(name, edits),
    guard,
    expect: new RegExp(`(?:AssertionError|expected|FAIL)[\\s\\S]*${intended.source}|${intended.source}[\\s\\S]*(?:AssertionError|expected|FAIL)`, "i"),
  })),
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO10 controls caught and restored.`,
});
