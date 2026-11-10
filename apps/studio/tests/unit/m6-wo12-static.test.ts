import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { namedFunction, parseSource, syntaxIs } from "./m6-wo8-audit-helpers";

/**
 * PAS-10 M6-WO12 — First Complete Vertical Slice: the permanent architecture gate (invariants M6-I180 – M6-I189).
 * Every test names the invariants it protects (prefix "W12-"); scripts/m6-wo12-negative-controls.mjs mutates the real
 * sources these assertions read and requires the named test to fail. Behaviour is proven by the DB suite
 * (m6-wo12-vertical-slice.test.ts), the review UI and browser-evidence suites and the two Playwright specs whose evidence the
 * e2e job verifies; this file pins the structure those suites rely on.
 */
const ROOT = path.resolve(process.cwd(), "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const src = (f: string) => parseSource(f, read(f));
const JOURNEY = "apps/studio/tests/e2e/m6-playtest.spec.ts";
const FAILURES = "apps/studio/tests/e2e/m6-playtest-failures.spec.ts";
const PREP = "scripts/playtest/wo12-world.ts";
const PREP_FIXTURE = "packages/prowess-db/tests/fixtures/m6-wo12-playtest.ts";
const REVIEW = "apps/studio/app/developer/rulesets/_components/revision-review.tsx";
const REVIEW_CLIENT = "apps/studio/src/api-client/review.ts";
const CHANGESET_PAGE = "apps/studio/app/developer/rulesets/[rulesetId]/change-sets/[changeSetId]/page.tsx";
const GOVERNANCE = "apps/studio/src/api-client/governance.ts";
const PLAY_UI = "apps/studio/app/characters/_components/play/PlayWorkspace.tsx";
const PLAY = "packages/prowess-db/src/character/play-service.ts";
const SHEET = "packages/prowess-db/src/character/sheet-service.ts";
const ADVANCEMENT = "packages/prowess-db/src/character/advancement-service.ts";
const OPS = "packages/prowess-game/src/play/operations.ts";
const VERIFY = "scripts/ci/verify-browser-evidence.mjs";
const CI = ".github/workflows/ci.yml";
const PW = "apps/studio/playwright.config.ts";
// The journey specs are read verbatim (their URL globs contain "/**", which a comment stripper would misread).
const WRITE_CALL = /\b(?:prisma\.\w+\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)|\$executeRaw\w*|commit\w*|write\w*|insert\w*)\s*\(/;

describe("M6-WO12 permanent playtest vertical-slice contracts", () => {
  it("W12-I186 the primary journey is one named serial spec through the real UI: no route fulfilment, fake server, direct Character write, pre-finalized build or substituted result", () => {
    const j = read(JOURNEY);
    expect(j).toContain('test.describe.configure({ mode: "serial" });');
    for (const forbidden of [/\.route\(/, /\.fulfill\(/, /FakePlayServer|m6-wo10-play-world|m6-wo8-ui-api|maneuverUiApi/, /\bdb\.(?:create|update|save|finalize|commit|advance|retire|preview)\w*\(/, /\bprisma\.\w+\.(?:create|update|upsert|delete)\w*\(/, /\brequest\.(?:post|put|patch|delete)\(/, /seedCharacterRelease|martialCharacter|publishNextRelease|spellDraft|maneuverDraft/])
      expect(j, String(forbidden)).not.toMatch(forbidden);
    // The only preparation is the WO12 command's own function; everything else is a person's click.
    expect(j).toContain('prep.preparePlaytestWorld(runId)');
    // Both Signature Abilities are built and finalized in the real builders.
    for (const step of ['await p2.getByTestId("spell-finalize").click();', 'await p2.getByRole("button", { name: "Finalize Maneuver", exact: true }).click();', 'await p2.getByRole("button", { name: "Add Long Blade · Long Blade — Slash · slashing", exact: true }).click();', 'await spellOption(p2, "spell-effect-picker", revisedName).getByTestId("spell-option-add").click();'])
      expect(j, step).toContain(step);
    // The designer revision, the reviewer approval and Release 2 happen in Studio.
    for (const step of ['await amount.fill("3");', 'await confirm(page, "Approve revision r2");', 'await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();'])
      expect(j, step).toContain(step);
  });

  it("W12-I186 two full runs in separately prepared worlds, the V01–V12 evidence table, and fingerprints around every read-only step", () => {
    const j = read(JOURNEY);
    expect(j).toContain('test("M6-WO12 playtest vertical slice — run 1 (newly prepared world)"');
    expect(j).toContain('test("M6-WO12 playtest vertical slice — run 2 (second newly prepared world, fresh contexts)"');
    expect(j.match(/await journey\(browser, 1\);/g)).toHaveLength(1);
    expect(j.match(/await journey\(browser, 2\);/g)).toHaveLength(1);
    expect(j).toContain("const runId = `e2e${Date.now().toString(36)}${run}`;");
    for (let i = 1; i <= 12; i += 1) expect(j, `V${String(i).padStart(2, "0")}`).toContain(`pass("V${String(i).padStart(2, "0")}"`);
    // V02, V08, V09 and V11 are read-only: a fingerprint before, the same fingerprint after, and no write request.
    for (const v of ["V02", "V08", "V09", "V11"]) {
      const block = j.slice(j.indexOf(`// ---- ${v} `), j.indexOf(`pass("${v}"`));
      expect(block, v).toMatch(/const before = await fingerprint\(/);
      expect(block, v).toMatch(/expect\(await fingerprint\([^)]*\)\)\.toBe\(before\);/);
      expect(block, v).toMatch(/expect\(writes\)\.toEqual\(\[\]\);/);
    }
    expect(j).toContain('writeFileSync(file, `${JSON.stringify({ gate: "M6-WO12", spec: "tests/e2e/m6-playtest.spec.ts", sha: commitSha(),');
  });

  it("W12-I188 failure cases are a separate spec covering a newer Release, ability lifecycles, rolls, resources, timing, a lost response and two tabs", () => {
    const f = read(FAILURES);
    for (const title of ["F1 a newer Release exists", "F2 draft, invalid and retired Signature Abilities cannot be cast", "F3 wrong timing, an invalid raw roll, a missing roll and insufficient resources", "F4 a lost commit response", "F5 two tabs"])
      expect(f, title).toContain(`test("${title}`);
    // The one intercepted response still reaches the real server first.
    expect(f.match(/\.route\(/g)).toHaveLength(1);
    expect(f).toContain("await route.fetch();");
    expect(f).not.toMatch(/\.fulfill\(/);
  });

  it("W12-I180 the preparation command is guarded, run-scoped, repeatable and seeds only the Release 1 background", () => {
    const cli = strip(read(PREP));
    expect(cli.indexOf("db.assertRunningAgainstTestDatabase(url);")).toBeGreaterThan(-1);
    expect(cli.indexOf("db.assertRunningAgainstTestDatabase(url);")).toBeLessThan(cli.indexOf('await import("../../packages/prowess-db/tests/fixtures/m6-wo12-playtest")'));
    expect(cli).toContain("if (applied !== migrations) {");
    const fx = src(PREP_FIXTURE);
    const prepare = namedFunction(fx, "preparePlaytestRelease").getText();
    expect(prepare).toContain("await cleanupCharacterWorlds(`${prefix}.`);");
    expect(prepare.indexOf("await cleanupCharacterWorlds(`${prefix}.`);")).toBeLessThan(prepare.indexOf("await seedCharacterRelease("));
    expect(prepare).not.toMatch(/createCharacter|createChangeSet|publishRulesetRelease|publishNextRelease|SignatureSpell|SignatureManeuver|commitCharacterPlay/);
    const cleanup = namedFunction(fx, "cleanupPlaytestWorlds").getText();
    expect(cleanup).toContain("const prefix = `${runPrefix(assertRunId(runId))}.`;");
    expect(cli.indexOf('if (command === "cleanup" && (!arg || process.argv.length !== 4)) usage(2);')).toBeGreaterThanOrEqual(0);
    expect(read(PREP_FIXTURE)).toContain('export const PLAYTEST_PREFIX = "test.m6wo12";');
  });

  it("W12-I181 a reviewer approves only an IN_REVIEW proposed revision, through the existing lifecycle endpoint, and publishes nothing", () => {
    const client = strip(read(REVIEW_CLIENT));
    expect(client).toContain('export const approveReviewedRevision = (id: string) => apiPost<EntityVersionDto>(`/api/entity-versions/${encodeURIComponent(id)}/status`, { status: "APPROVED" });');
    expect(client.match(/apiPost/g)).toHaveLength(2); // the import and the one command
    const ui = strip(read(REVIEW));
    expect(ui).toContain('{version.status === "IN_REVIEW" ? (');
    expect(ui).toContain("await approveReviewedRevision(version.id);");
    expect(ui).not.toMatch(/publishRelease|publishRulesetRelease|approveChangeSet|submitChangeSet|fetch\(/);
    expect(strip(read(CHANGESET_PAGE))).toContain('{o.toEntityVersionId && c.status !== "REJECTED" ? <RevisionReview versionId={o.toEntityVersionId} /> : null}');
    // The M2 named-command list stays exactly as audited.
    expect(strip(read(GOVERNANCE))).not.toMatch(/approveReviewedRevision|entity-versions\/\$\{[^}]*\}\/status/);
  });

  it("W12-I182 a Character's rules, abilities and play always come from its own pinned Release", () => {
    expect(namedFunction(src(ADVANCEMENT), "loadCompleted").getText()).toContain("const { bundle, ruleset } = await releaseRules(c.rulesetReleaseId);");
    const load = namedFunction(src(PLAY), "load").getText();
    expect(load).toContain("releaseId: c.rulesetReleaseId,\n    characterName: c.name,");
    expect(load).toContain("releaseId: c.rulesetReleaseId,\n  };");
    expect(load).not.toMatch(/releaseNumber|orderBy|latest/i);
  });

  it("W12-I183 play refuses a substituted ability revision or a revision pinned to another Release", () => {
    const ops = read(OPS);
    expect(ops).toContain('if (source.revisionNumber !== revisionNumber) return { error: { ...refuse(R.REVISION_CHANGED,');
    expect(ops).toContain('if (source.revisionReleaseId !== ctx.releaseId) return { error: refuse(R.RELEASE_MISMATCH,');
    expect(ops).toContain("if (found.revisionNumber !== op.revisionNumber) return refuse(R.REVISION_CHANGED,");
    expect(ops).toContain("if (found.revisionReleaseId !== ctx.releaseId) return refuse(R.RELEASE_MISMATCH,");
  });

  it("W12-I184 an unknown commit outcome keeps its request key and says the retry is safe; the server replays before it loads anything", () => {
    const ui = strip(read(PLAY_UI));
    expect(ui).toContain('import { isUnknownOutcome } from "../../_lib/creation-save";');
    expect(ui).toContain("} else if (e instanceof CharacterApiError && !isUnknownOutcome(e)) setNotice(`${e.message} (${e.code})`);");
    expect(ui).toContain('else setNotice("The request did not complete (network). Nothing is shown as spent; submit again to retry safely with the same request key.");');
    const failure = ui.slice(ui.indexOf("const failure = useCallback("), ui.indexOf("const submitter: Submitter"));
    expect(failure.match(/pendingKey\.current = null;/g)).toHaveLength(1); // only a stale refusal discards the key
    const commit = namedFunction(src(PLAY), "commitCharacterPlayOperation").getText();
    expect(commit.indexOf("if ((await selectPlayEventByKey(characterId, key)) !== null) return replay();")).toBeGreaterThan(-1);
    expect(commit.indexOf("if ((await selectPlayEventByKey(characterId, key)) !== null) return replay();")).toBeLessThan(commit.indexOf("const l = await load(characterId);"));
    expect(commit).toContain('if (result.outcome === "duplicate") return replay();');
  });

  it("W12-I185 resuming is a read: the Play Workspace, the Sheet and the play load write nothing", () => {
    const play = src(PLAY);
    expect(syntaxIs(namedFunction(play, "getCharacterPlayWorkspace").body!, "{ const l = await load(characterId); return viewOf(l, l.stored, l.versions); }")).toBe(true);
    expect(strip(namedFunction(play, "load").getText())).not.toMatch(WRITE_CALL);
    expect(strip(namedFunction(play, "viewOf").getText())).not.toMatch(WRITE_CALL);
    expect(strip(namedFunction(src(SHEET), "getCharacterSheet").getText())).not.toMatch(WRITE_CALL);
  });

  it("W12-I187 the e2e job verifies this commit's browser evidence after Playwright, on the one production build", () => {
    const ci = read(CI);
    const e2e = ci.slice(ci.indexOf("\n  e2e:\n"), ci.indexOf("\n  # ---- Tier summaries"));
    const tests = e2e.indexOf("      - name: End-to-end tests (Playwright)");
    const verify = e2e.indexOf("      - name: M6-WO12 browser evidence (vertical slice journey)");
    expect(tests).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(tests);
    expect(e2e.slice(verify)).toContain("run: node scripts/ci/verify-browser-evidence.mjs M6-WO12");
    expect(e2e.match(/run: pnpm build\b/g)).toHaveLength(1);
    expect(e2e).toContain('PROWESS_E2E_PREBUILT: "1"');
    const pw = strip(read(PW));
    expect(pw).toContain('reporter: [["list"], ["json", { outputFile: "playwright-report/results.json" }]],');
    const gates = JSON.parse(read("scripts/ci/gates.json")) as { checks: Array<{ id: string; job: string; command: string }> };
    expect(gates.checks).toContainEqual({ id: "M6-WO12-BROWSER-EVIDENCE", job: "e2e", kind: "e2e", command: "node scripts/ci/verify-browser-evidence.mjs M6-WO12" });
    const v = strip(read(VERIFY));
    expect(v).toContain('specs: ["tests/e2e/m6-playtest.spec.ts", "tests/e2e/m6-playtest-failures.spec.ts"],');
    expect(v).toContain('if (evidence.sha !== sha) problems.push(');
  });

  it("W12-I189 the governed-content boundary: test-only content, an isolated Release, no canon change, honestly labelled", () => {
    const fx = strip(read(PREP_FIXTURE));
    expect(fx).not.toMatch(/core-playtest-v0\.1\/(?!affinity)|publishCanon|CANON/);
    const note = read("docs/architecture/m6-wo12-playtest-vertical-slice.md");
    expect(note).toContain("playtest verified on an isolated Release");
    expect(note).toContain("Missing governed content");
    expect(note).toContain("m6-wo8-governed-content-candidate.md");
  });

  it("W12-I180–I189 every declared invariant names existing permanent guards, this gate and the mutation inventory", () => {
    const invariants = JSON.parse(read("docs/architecture/m6-invariants.json")) as { id: string; title: string; guards: string[] }[];
    const expected = Array.from({ length: 10 }, (_, i) => `M6-I${String(i + 180).padStart(3, "0")}`);
    const rows = invariants.filter((x) => expected.includes(x.id));
    expect(rows.map((x) => x.id)).toEqual(expected);
    expect(invariants.map((x) => x.id)).toEqual(Array.from({ length: invariants.length }, (_, i) => `M6-I${String(i + 1).padStart(3, "0")}`));
    const md = read("docs/architecture/m6-invariants.md");
    expect(md).toContain("## M6-WO12 — First Complete Playtest Vertical Slice (M6-I180 – M6-I189)");
    for (const row of rows) {
      expect(row.guards).toContain("apps/studio/tests/unit/m6-wo12-static.test.ts");
      if (row.id !== "M6-I188" && row.id !== "M6-I189") expect(row.guards).toContain("scripts/m6-wo12-negative-controls.mjs");
      for (const f of row.guards) expect(existsSync(path.join(ROOT, f)), `${row.id}: ${f}`).toBe(true);
      expect(md).toContain(`### ${row.id} — ${row.title}`);
    }
  });
});
