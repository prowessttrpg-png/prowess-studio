/** Permanent M6-WO12 mutation matrix (M6-I180 – M6-I189). CLOSEOUT-03 harness: one green baseline per distinct guard,
 * each control mutates one uniquely anchored REAL source location, the intended guard must fail for the named
 * behavioural / architectural reason, and every file — and the whole working tree — is restored byte-for-byte.
 * Studio mutations run the review UI suite or the browser-evidence suite; journey, database, game and CI mutations run
 * the WO12 static gate (their native behaviour — the pinned Release, the exact revision, the idempotent retry and the
 * write-free resume — stays independently mandatory in m6-wo12-vertical-slice.test.ts and the two Playwright specs whose
 * evidence the e2e job verifies). Includes the five regressions named by the Work Order: switching to the latest
 * Release (07, 08), substituting an ability revision (09, 10), skipping the real builder (02, 03), double-charging on
 * retry (11, 13) and writing during resume (14, 15). */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, runControls, vitestGuard } from "./lib/control-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = ["--maxWorkers=1", "--no-file-parallelism", "--reporter=dot"];
const options = { timeout: 600_000, ciEnv: false };
const architecture = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo12-static.test.ts", "-t", "W12-", ...args], options);
const review = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo12-review-ui.test.tsx", "-t", "W12-REVIEW", ...args], options);
const evidence = vitestGuard(root, "apps/studio", ["tests/unit/m6-wo12-browser-evidence.test.ts", "-t", "W12-EVIDENCE", ...args], options);

const JOURNEY = "apps/studio/tests/e2e/m6-playtest.spec.ts", PREP = "scripts/playtest/wo12-world.ts";
const ADVANCEMENT = "packages/prowess-db/src/character/advancement-service.ts", PLAY = "packages/prowess-db/src/character/play-service.ts";
const SHEET = "packages/prowess-db/src/character/sheet-service.ts", OPS = "packages/prowess-game/src/play/operations.ts";
const PLAY_UI = "apps/studio/app/characters/_components/play/PlayWorkspace.tsx";
const REVIEW = "apps/studio/app/developer/rulesets/_components/revision-review.tsx", REVIEW_CLIENT = "apps/studio/src/api-client/review.ts";
const GOVERNANCE = "apps/studio/src/api-client/governance.ts", VERIFY = "scripts/ci/verify-browser-evidence.mjs";
const CI = ".github/workflows/ci.yml", PW = "apps/studio/playwright.config.ts";
const UNKNOWN = 'else setNotice("The request did not complete (network). Nothing is shown as spent; submit again to retry safely with the same request key.");';
const VERIFY_STEP = "      # M6-WO12: absent, skipped, failing or wrong-commit browser evidence of the journey fails this job (and so Tier 2). It reads\n      # the Playwright JSON report and the journey's V01–V12 evidence of the run above; nothing is built or run again.\n      - name: M6-WO12 browser evidence (vertical slice journey)\n        if: ${{ !cancelled() }}\n        run: node scripts/ci/verify-browser-evidence.mjs M6-WO12\n";

// [name, file, edits, guard, intended test / contract pattern]
const rows = [
  // ---- the primary journey stays genuine (M6-I186) --------------------------------------------------------------------
  ["01 the journey fulfils an API route", JOURNEY, [["  const { page, close } = await fresh(browser);\n  page.setDefaultTimeout(30_000);", "  const { page, close } = await fresh(browser);\n  await page.route(\"**/api/characters/**\", (r) => r.fulfill({ json: { data: {} } }));\n  page.setDefaultTimeout(30_000);"]], architecture, /W12-I186/],
  ["02 the Spell is finalized in the database instead of the real builder", JOURNEY, [['    await p2.getByTestId("spell-finalize").click();', '    await db.finalizeCharacterSignatureSpell(characterId, p2.url().split("/").at(-1)!, { expectedVersion: 1 });']], architecture, /W12-I186/],
  ["03 the Maneuver builder's finalize is replaced by an API call", JOURNEY, [['    await p2.getByRole("button", { name: "Finalize Maneuver", exact: true }).click();', "    await p2.request.post(`/api/characters/${characterId}/maneuvers/finalize`, { data: { expectedVersion: 1 } });"]], architecture, /W12-I186/],
  ["04 the journey writes a Character row directly", JOURNEY, [['    characterId = page.url().split("/").at(-2)!;', '    characterId = page.url().split("/").at(-2)!;\n    await db.prisma.character.update({ where: { id: characterId }, data: { level: 1 } });']], architecture, /W12-I186/],
  ["05 the second full run is dropped", JOURNEY, [["  const { world, rows } = await journey(browser, 2);", "  const { world, rows } = await journey(browser, 1);"]], architecture, /W12-I186/],
  ["06 a read-only step loses its fingerprint comparison", JOURNEY, [['    expect(await fingerprint(characterId, w.rulesetId)).toBe(before);\n    pass("V08"', '    pass("V08"']], architecture, /W12-I186/],
  // ---- the pinned Release (M6-I182) -----------------------------------------------------------------------------------
  ["07 the Character's rules come from the latest Release", ADVANCEMENT, [["  const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);\n  const progression = progressionOf(", "  const { bundle, ruleset } = await releaseRules((await latestReleaseOf(c.rulesetReleaseId)) ?? c.rulesetReleaseId);\n  const progression = progressionOf("]], architecture, /W12-I182/],
  ["08 play evaluates against another Release", PLAY, [["    releaseId: c.rulesetReleaseId,\n    characterName: c.name,", "    releaseId: (await latestReleaseOf(c.rulesetReleaseId)) ?? c.rulesetReleaseId,\n    characterName: c.name,"]], architecture, /W12-I182/],
  // ---- the exact ability revision (M6-I183) ---------------------------------------------------------------------------
  ["09 a substituted Spell revision is accepted", OPS, [["  if (source.revisionNumber !== revisionNumber) return", "  if (false as boolean && source.revisionNumber !== revisionNumber) return"]], architecture, /W12-I183/],
  ["10 a Maneuver revision pinned to another Release is accepted", OPS, [["  if (found.revisionReleaseId !== ctx.releaseId) return refuse(R.RELEASE_MISMATCH,", "  if (false as boolean) return refuse(R.RELEASE_MISMATCH,"]], architecture, /W12-I183/],
  // ---- no double charge on retry (M6-I184) ----------------------------------------------------------------------------
  ["11 the server charges a retried request again", PLAY, [["  if ((await selectPlayEventByKey(characterId, key)) !== null) return replay();\n", ""]], architecture, /W12-I184/],
  ["12 an unknown outcome is reported as a plain failure", PLAY_UI, [["} else if (e instanceof CharacterApiError && !isUnknownOutcome(e)) setNotice(", "} else if (e instanceof CharacterApiError) setNotice("]], architecture, /W12-I184/],
  ["13 an unknown outcome discards the request key (a retry would pay twice)", PLAY_UI, [[`      ${UNKNOWN}`, `      else {\n        pendingKey.current = null;\n        ${UNKNOWN.slice(5)}\n      }`]], architecture, /W12-I184/],
  // ---- resume is a read (M6-I185) -------------------------------------------------------------------------------------
  ["14 resuming the Play Workspace writes", PLAY, [["  const l = await load(characterId);\n  return viewOf(l, l.stored, l.versions);", "  const l = await load(characterId);\n  await writePlayStateWithin(l.ctx.characterId, l.versions.playStateVersion);\n  return viewOf(l, l.stored, l.versions);"]], architecture, /W12-I185/],
  ["15 opening the Sheet writes", SHEET, [["  const state = await selectSheetState(c.id);\n  const library = buildCharacterAttackLibrary({ bundle, characterProfile: equipped.base, loadout: equipped.choice });", "  const state = await selectSheetState(c.id);\n  await prisma.characterSheetNotes.upsert({ where: { characterId: c.id }, create: { characterId: c.id, notes: \"\" }, update: {} });\n  const library = buildCharacterAttackLibrary({ bundle, characterProfile: equipped.base, loadout: equipped.choice });"]], architecture, /W12-I185/],
  // ---- reviewer approval (M6-I181) ------------------------------------------------------------------------------------
  ["16 approval is offered for a Draft revision", REVIEW, [['{version.status === "IN_REVIEW" ? (', '{version.status === "IN_REVIEW" || version.status === "DRAFT" ? (']], review, /W12-REVIEW/],
  ["17 approval is sent twice", REVIEW, [["              await approveReviewedRevision(version.id);", "              await approveReviewedRevision(version.id);\n              await approveReviewedRevision(version.id);"]], review, /W12-REVIEW/],
  ["18 the approval command sends another lifecycle status", REVIEW_CLIENT, [['{ status: "APPROVED" });', '{ status: "IN_REVIEW" });']], architecture, /W12-I181/],
  ["19 the approval moves into the audited governance command list", GOVERNANCE, [[null, "\nexport const approveReviewedRevision = (id: string) => apiPost<EntityVersionDto>(`/api/entity-versions/${enc(id)}/status`, { status: \"APPROVED\" });\n"]], architecture, /W12-I181/],
  // ---- the browser evidence gate (M6-I187) ----------------------------------------------------------------------------
  ["20 a skipped browser test passes the gate", VERIFY, [['if (t.status === "skipped" || t.results.length === 0 || t.results.every((r) => r === "skipped")) problems.push(', "if (false) problems.push("]], evidence, /W12-EVIDENCE/],
  ["21 evidence from another commit passes the gate", VERIFY, [["    if (evidence.sha !== sha) problems.push(", "    if (false) problems.push("]], evidence, /W12-EVIDENCE/],
  ["22 a single journey run passes the gate", VERIFY, [["    if (runs.length !== gate.runs) problems.push(", "    if (runs.length < 1) problems.push("]], evidence, /W12-EVIDENCE/],
  ["23 the e2e job no longer verifies the browser evidence", CI, [[VERIFY_STEP, ""]], architecture, /W12-I187/],
  ["24 Playwright stops writing its JSON report", PW, [['reporter: [["list"], ["json", { outputFile: "playwright-report/results.json" }]],', 'reporter: "list",']], architecture, /W12-I187/],
  // ---- the preparation command (M6-I180) ------------------------------------------------------------------------------
  ["25 the preparation skips the test-database guard", PREP, [["try {\n  db.assertRunningAgainstTestDatabase(url);\n} catch (e) {", "try {\n  void url;\n} catch (e) {"]], architecture, /W12-I180/],
];

runControls({
  root,
  title: "M6-WO12",
  controls: rows.map(([name, file, edits, guard, intended]) => ({
    name,
    file,
    mutate: applyEdits(name, edits),
    guard,
    expect: new RegExp(`(?:AssertionError|expected|FAIL)[\\s\\S]*${intended.source}|${intended.source}[\\s\\S]*(?:AssertionError|expected|FAIL)`, "i"),
  })),
  caught: (name) => `Caught and restored: ${name}`,
  done: (count) => `All ${count} M6-WO12 controls caught and restored.`,
});
