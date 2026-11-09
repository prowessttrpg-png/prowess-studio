import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect as baseExpect, test, type Browser, type Locator, type Page } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import "./m6-wo11-fixture-loader";

/**
 * PAS-10 M6-WO12 — the FIRST COMPLETE PLAYTEST VERTICAL SLICE, as one named, serial journey (V01–V12) through the real
 * Studio UI, the production build and PostgreSQL.
 *
 * The only preparation is the repeatable WO12 command's own function (`preparePlaytestWorld`): an isolated Ruleset with
 * Release 1 (test-only `test.m6wo12.<run>.*` content — never canon; see docs/architecture/m6-wo12-playtest-vertical-slice.md
 * for the governed-content boundary). EVERYTHING the journey proves is done by a person's clicks: the designer revision,
 * its review and approval, the ChangeSet, Release 2, the Character, the loadout, both Signature Abilities (built in the
 * real builders and finalized there), and every play operation. The journey never fulfils a route, never runs a fake
 * server, never writes a Character row directly and never substitutes a result. Reads used as EVIDENCE (row
 * fingerprints, the event ledger) go to PostgreSQL directly and are compared around read-only steps.
 *
 * The journey runs twice, each time in a newly prepared world with fresh browser contexts, and writes the V01–V12
 * evidence table for both runs to test-results/m6-wo12-evidence.json, which `scripts/ci/verify-browser-evidence.mjs`
 * checks in CI (absent, skipped, failing or wrong-commit evidence fails the gate).
 */
type Db = typeof import("@prowess/db");
interface World {
  readonly runId: string;
  readonly rulesetId: string;
  readonly rulesetName: string;
  readonly policyId: string;
  readonly release1: { readonly id: string; readonly manifestId: string; readonly releaseNumber: number };
  readonly revised: { readonly entityId: string; readonly canonicalKey: string; readonly baseVersionId: string; readonly baseDisplayName: string };
  readonly longBladeVersionId: string;
}
interface Prep {
  preparePlaytestWorld(runId: string): Promise<World>;
  fingerprint(characterId: string | null, rulesetId: string): Promise<string>;
  cleanupPlaytestWorlds(runId: string): Promise<number>;
}
type Row = { readonly id: string; readonly title: string; readonly status: "passed"; readonly evidence: Record<string, unknown> };
const runtimeImport = (specifier: string): Promise<unknown> => import(specifier);
/** The production build renders the larger Character projections in a few seconds; every expectation waits up to 30 s. */
const expect = baseExpect.configure({ timeout: 30_000 });

export const WO12_STEPS = [
  ["V01", "Compendium Admin revision → review → ChangeSet → approval → isolated Release 2"],
  ["V02", "Rules Reference: exact Release 2, pinned revision, structured reference"],
  ["V03", "Library: draft → partial save → reopen → complete → finalize"],
  ["V04", "Access, Signature capacity, advancement and a rejected prerequisite"],
  ["V05", "Loadout and the exact Weapon Attack"],
  ["V06", "Spell builder: Sustained Signature Spell finalized at the revised price"],
  ["V07", "Maneuver builder (real backend) on the exact Attack, finalized"],
  ["V08", "Sheet, Card Library and print views write nothing"],
  ["V09", "Rules Inspector evidence tied to Release 2 and an actual action's operands"],
  ["V10", "Play: combat, round, turn, preview vs commit, Move, movement, Attack, Spell, raw dice, NOT APPLIED"],
  ["V11", "Hold Active Magic mid-turn; resume twice in fresh contexts: identical, no writes"],
  ["V12", "Continue: Maneuver, maintenance, dismiss, end play; history reconciles"],
] as const;

let db: Db;
let prep: Prep;
let fingerprint: Prep["fingerprint"];
const evidence: Array<{ run: number; world: string; rows: Row[]; seconds: number }> = [];
const prepared: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  db = await import("@prowess/db");
  db.assertRunningAgainstTestDatabase(process.env.DATABASE_URL as string);
  prep = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo12-playtest")) as Prep;
  fingerprint = prep.fingerprint;
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  writeEvidence();
  // PROWESS_WO12_KEEP_WORLD=1 keeps the prepared worlds for inspection (the WO12 cleanup command removes them later).
  if (prep !== undefined && process.env.PROWESS_WO12_KEEP_WORLD !== "1") for (const runId of prepared) await prep.cleanupPlaytestWorlds(runId);
});

function commitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
function writeEvidence() {
  const file = process.env.PROWESS_WO12_EVIDENCE ?? path.join(process.cwd(), "test-results", "m6-wo12-evidence.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ gate: "M6-WO12", spec: "tests/e2e/m6-playtest.spec.ts", sha: commitSha(), steps: WO12_STEPS.map(([id, title]) => ({ id, title })), runs: evidence, writtenAt: new Date().toISOString() }, null, 2)}\n`);
}

/** Records every non-GET request a page sends (read-only steps must send none). */
function writesOf(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return writes;
}
async function fresh(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { page, close: () => context.close() };
}
async function optionContaining(select: Locator, text: string): Promise<string> {
  await expect(select.locator("option", { hasText: text }).first()).toBeAttached({ timeout: 30_000 });
  const opts = await select.locator("option").evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? "" })));
  const hit = opts.find((o) => o.text.includes(text));
  if (hit === undefined) throw new Error(`no option containing "${text}"`);
  return hit.value;
}
async function confirm(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button").filter({ hasNotText: "Cancel" }).last().click();
  await expect(dialog).toBeHidden();
}
const resource = (page: Page, key: string) => page.getByTestId(`play-resource-${key}`);
const versions = async (page: Page) => ({ runtime: Number(await page.getByTestId("play-workspace").getAttribute("data-runtime-version")), playState: Number(await page.getByTestId("play-workspace").getAttribute("data-play-state-version")) });
async function timing(page: Page, event: string) {
  const before = await page.getByTestId("play-workspace").getAttribute("data-runtime-version");
  await page.getByTestId(`play-timing-${event}`).click();
  await expect(page.getByTestId("play-workspace")).not.toHaveAttribute("data-runtime-version", before ?? "", { timeout: 30_000 });
}
async function committed(page: Page) {
  await expect(page.getByTestId("play-result").first()).toHaveAttribute("data-committed", "true", { timeout: 30_000 });
}
const spellOption = (page: Page, picker: string, name: string) => page.getByTestId(picker).getByTestId("spell-option").filter({ hasText: name });
async function spellStep(page: Page, key: string) {
  await page.getByTestId(`spell-step-${key}`).click();
  await expect(page.getByTestId(`spell-panel-${key}`)).toBeVisible();
}
async function ledger(characterId: string) {
  return db.prisma.characterPlayEvent.findMany({ where: { characterId }, orderBy: { sequence: "asc" }, select: { id: true, sequence: true, operationKind: true, idempotencyKey: true, runtimeVersion: true, rulesetReleaseId: true } });
}

/** One complete vertical slice in a newly prepared world. Returns the V01–V12 evidence rows. */
async function journey(browser: Browser, run: number): Promise<{ world: World; rows: Row[] }> {
  const runId = `e2e${Date.now().toString(36)}${run}`;
  prepared.push(runId);
  const w = await prep.preparePlaytestWorld(runId);
  const rows: Row[] = [];
  const pass = (id: string, evidenceFields: Record<string, unknown>) => {
    const title = WO12_STEPS.find(([k]) => k === id)![1];
    rows.push({ id, title, status: "passed", evidence: evidenceFields });
  };
  const revisedName = `Steady Ward Effect (playtest ${runId})`;
  const proposal = `Cheaper Steady Ward ${runId}`;
  const characterName = `Ilsa Venn ${runId}`;
  const spellName = `Steady Ward ${runId}`;
  const maneuverName = `Ward Strike ${runId}`;
  const { page, close } = await fresh(browser);
  page.setDefaultTimeout(30_000);

  // ---- V01 — the designer's revision through review, the ChangeSet, approval and an isolated Release 2. ----
  await page.goto("/compendium");
  await page.getByRole("link", { name: /Compendium Admin/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compendium Admin" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search name, alias" }).fill(w.revised.baseDisplayName);
  await page.getByRole("link", { name: w.revised.baseDisplayName }).first().waitFor();
  await page.goto(`/compendium/admin/entities/${w.revised.entityId}`); // the run's own Entity (every run shares the fixture's display name)
  await expect(page.getByRole("heading", { level: 2, name: "Revisions and history" })).toBeVisible();
  await page.getByLabel("Change summary (why this revision exists)").fill("Playtest: the ward costs 3 MP instead of 4.");
  await page.getByRole("button", { name: "Create New Revision from Revision 1" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /— Revision 2$/ })).toBeVisible();
  const revisionUrl = page.url();
  const revisionId = revisionUrl.split("/").at(-1)!;
  await page.getByLabel(/^Display Name/).fill(revisedName);
  const amount = page.getByRole("spinbutton", { name: "Cost contribution 1 data.amount" });
  await expect(amount).toHaveValue("4"); // the authored Release 1 price
  await amount.fill("3");
  await page.getByLabel("Change type").selectOption({ label: "Mechanical Change" });
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Draft saved — validation PASS.")).toBeVisible();
  const handoff = page.getByRole("region", { name: "Review and Canon hand-off" });
  await handoff.getByRole("button", { name: "Submit for review" }).click();
  await expect(handoff.getByRole("button", { name: "Return to Draft" })).toBeVisible();
  await handoff.getByRole("button", { name: "Choose a Ruleset…" }).click();
  const rulesetSelect = handoff.getByLabel("Ruleset (explicit authoring context)");
  await rulesetSelect.selectOption(await optionContaining(rulesetSelect, w.rulesetName));
  await handoff.getByLabel("Proposal name").fill(proposal);
  await handoff.getByRole("button", { name: "Create ChangeSet proposal" }).click();
  await expect(handoff.getByRole("status")).toContainText(`Proposal "${proposal}" created as a DRAFT ChangeSet.`);
  await handoff.getByRole("link", { name: "Open in Canon Manager" }).click();
  await page.waitForURL(/\/change-sets\/[0-9a-f-]+$/);
  const changeSetId = page.url().split("/").at(-1)!;
  // The reviewer approves the exact proposed revision (M6-WO12 gap fix), then the ChangeSet.
  const review = page.getByTestId("revision-review");
  await expect(review).toHaveAttribute("data-status", "IN_REVIEW");
  await expect(review).toHaveAttribute("data-version", revisionId);
  await confirm(page, "Approve revision r2");
  await expect(review).toHaveAttribute("data-status", "APPROVED");
  await confirm(page, "Submit for Review");
  await confirm(page, "Approve");
  await expect(page.getByTestId("change-set-commands")).toContainText("Approved — eligible for publication");
  await page.getByTestId("change-set-commands").getByRole("link", { name: "Releases" }).click();
  const form = page.getByRole("form", { name: "Publish Release" });
  await form.getByLabel("Base Manifest").selectOption(await optionContaining(form.getByLabel("Base Manifest"), w.release1.manifestId.slice(0, 8)));
  await form.getByLabel("Canon Policy").selectOption(await optionContaining(form.getByLabel("Canon Policy"), w.policyId.slice(0, 8)));
  await form.getByLabel("Approved ChangeSet (optional)").selectOption(changeSetId);
  await form.getByLabel("Version label").fill("R2");
  await form.getByLabel("Release notes").fill(`${revisedName} costs 3 MP.`);
  await form.getByRole("button", { name: "Publish Release" }).click();
  await expect(page.getByTestId("publish-summary")).toContainText(proposal);
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(/\/releases\/[0-9a-f-]+$/);
  const release2Id = page.url().split("/").at(-1)!;
  const r2 = await db.prisma.rulesetRelease.findUniqueOrThrow({ where: { id: release2Id } });
  expect(r2.rulesetId).toBe(w.rulesetId);
  expect(r2.releaseNumber).toBe(2);
  const pinned = await db.prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: r2.manifestId, entityId: w.revised.entityId } });
  expect(pinned.entityVersionId).toBe(revisionId);
  pass("V01", { revisionId, revisionNumber: 2, authoredMpBefore: 4, authoredMpAfter: 3, changeSetId, release2Id, release2Number: 2, release2Manifest: r2.manifestId, pinnedVersion: pinned.entityVersionId });

  // ---- V02 — Rules Reference: the exact Release 2, the pinned revision and a structured reference (read-only). ----
  {
    const before = await fingerprint(null, w.rulesetId);
    const writes = writesOf(page);
    await page.goto("/compendium");
    await page.getByRole("navigation", { name: "Compendium sections" }).getByRole("link", { name: "Rules Reference" }).click();
    await page.getByRole("link", { name: w.rulesetName }).click();
    await expect(page.getByTestId("reference-release-row")).toHaveCount(2);
    await page.getByRole("button", { name: "View Latest Release" }).click();
    await page.waitForURL(`**/compendium/rulesets/${w.rulesetId}/releases/${release2Id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Release 2 — R2" })).toBeVisible();
    await expect(page.getByTestId("reference-integrity")).toContainText("Manifest verified");
    await page.goto(`/compendium/rulesets/${w.rulesetId}/releases/${release2Id}/entities/${w.revised.entityId}`);
    await expect(page.getByTestId("reference-entry-header")).toContainText("Pinned Revision 2");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(revisedName);
    // A structured reference: the Long Blade Weapon's exact Attack references, followed inside the same Release.
    const blade = await db.prisma.entityVersion.findUniqueOrThrow({ where: { id: w.longBladeVersionId }, select: { entityId: true } });
    await page.goto(`/compendium/rulesets/${w.rulesetId}/releases/${release2Id}/entities/${blade.entityId}`);
    const refs = page.getByRole("list", { name: "Referenced Definitions" });
    await expect(refs).toContainText("matches this Release");
    await refs.getByRole("link").first().click();
    await page.waitForURL(`**/releases/${release2Id}/entities/**`);
    await expect(page.getByTestId("reference-entry-header")).toContainText("Pinned Revision 1");
    // Release 1 still pins Revision 1 of the revised Effect; the comparison names exactly one changed revision.
    await page.goto(`/compendium/rulesets/${w.rulesetId}/releases/${w.release1.id}/entities/${w.revised.entityId}`);
    await expect(page.getByTestId("reference-entry-header")).toContainText("Pinned Revision 1");
    await page.goto(`/compendium/rulesets/${w.rulesetId}/releases/${w.release1.id}`);
    await page.getByLabel("Compare with").selectOption(release2Id);
    await expect(page.getByTestId("reference-comparison-counts")).toContainText("1 changed revision");
    expect(writes).toEqual([]);
    expect(await fingerprint(null, w.rulesetId)).toBe(before);
    pass("V02", { release: release2Id, pinnedRevision: 2, release1PinnedRevision: 1, comparison: "1 changed revision", followedReferenceFrom: blade.entityId, writes: 0, fingerprintUnchanged: before });
  }

  // ---- V03 — the Library: a Draft on Release 2, a partial save, reopen in a fresh session, complete and finalize. ----
  let characterId = "";
  {
    await page.goto("/characters");
    await page.getByRole("link", { name: "New Character" }).click();
    await page.getByRole("combobox", { name: "Ruleset", exact: true }).selectOption({ label: w.rulesetName });
    await page.getByRole("combobox", { name: "Release", exact: true }).selectOption(release2Id);
    await expect(page.getByTestId("capability-ready")).toBeVisible();
    await page.getByLabel("Name (required)").fill(characterName);
    await page.getByRole("button", { name: "Create Character Draft" }).click();
    await page.waitForURL(/\/characters\/[0-9a-f-]+\/create$/);
    characterId = page.url().split("/").at(-2)!;
    await page.getByRole("button", { name: "2. Race / Ancestry" }).click();
    await page.getByTestId("ancestry-card").filter({ hasText: "Orcani (test)" }).getByRole("radio").check();
    await page.getByLabel("Stat choice 1 of 2").selectOption("AGI");
    await page.getByLabel("Stat choice 2 of 2").selectOption("PRO");
    await page.getByRole("button", { name: "Save & Continue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Stats" })).toBeVisible();
    await expect(page.getByTestId("wizard-save-state")).toHaveText("All changes saved.");
    await close();
  }
  const s2 = await fresh(browser);
  const p2 = s2.page;
  p2.setDefaultTimeout(30_000);
  {
    await p2.goto("/characters");
    await p2.getByTestId("library-search").fill(characterName);
    const row = p2.locator(`[data-testid="character-row"][data-character-id="${characterId}"]`);
    await expect(row).toContainText("Draft");
    await expect(row).toContainText("Release 2");
    await row.getByTestId("library-continue-creation").click();
    await p2.waitForURL(`**/characters/${characterId}/create`);
    await expect(p2.getByRole("heading", { level: 2, name: "Stats" })).toBeVisible();
    await expect(p2.getByTestId("points-remaining")).toHaveText("Points Remaining: 15 of 15");
    for (const [stat, n] of [["STR", 3], ["AGI", 3], ["CON", 3], ["PER", 2], ["RES", 2], ["PRO", 2]] as const) for (let i = 0; i < n; i += 1) await p2.getByRole("button", { name: `Add a point to ${stat}` }).click();
    await p2.getByRole("button", { name: "Save & Continue" }).click();
    await expect(p2.getByRole("heading", { level: 2, name: "Skills" })).toBeVisible();
    await p2.getByLabel("Race Skill 1").selectOption({ label: "Athletics (test)" });
    // The Release's construction rule names `skill.martial` / `skill.arcana` as the Martial and Arcane Authority Skills.
    await p2.getByLabel("Free Skill 1").selectOption({ label: "skill.martial" });
    await p2.getByLabel("Free Skill 2").selectOption({ label: "skill.arcana" });
    await p2.getByRole("button", { name: "Save & Continue" }).click();
    await expect(p2.getByRole("heading", { level: 2, name: "Primary Affinity" })).toBeVisible();
    await p2.getByTestId("affinity-card").filter({ hasText: "Evocation (test)" }).getByRole("radio").check();
    await p2.getByRole("button", { name: "Save & Continue" }).click();
    await expect(p2.getByTestId("check-ready")).toBeVisible();
    await p2.getByRole("button", { name: "Complete Core Creation" }).click();
    await p2.waitForURL(`**/characters/${characterId}`);
    const c = await db.prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(c.rulesetReleaseId).toBe(release2Id);
    expect(c.coreCreationCompletedAt).not.toBeNull();
    await expect(p2.getByTestId("character-sheet").or(p2.getByTestId("sheet-page-1")).first()).toBeVisible({ timeout: 60_000 });
    pass("V03", { characterId, release: c.rulesetReleaseId, status: "CORE_COMPLETE", completedAt: c.coreCreationCompletedAt, partialSaveThen: "Stats (15 of 15 points unspent after reopen)", completedIn: "a second, fresh browser context" });
  }

  // ---- V04 — access, Signature capacity and advancement; a prerequisite the Character does not meet is refused. ----
  {
    await p2.getByRole("tab", { name: "Advancement" }).click();
    await expect(p2.getByTestId("profile-level")).toHaveText("1 of 10", { timeout: 60_000 });
    await expect(p2.getByTestId("access-arcane")).toContainText("Trained");
    const arcaneAccess = (await p2.getByTestId("access-arcane").textContent())!.trim();
    await p2.getByRole("link", { name: "Advance Character" }).click();
    await expect(p2.getByTestId("advance-levels")).toHaveText("Level 1 → 2");
    await expect(p2.getByTestId("advance-release")).toContainText("Release 2");
    await p2.getByRole("button", { name: "Next", exact: true }).click();
    await p2.getByRole("button", { name: "Add a point to PER" }).click();
    await p2.getByRole("button", { name: "Next", exact: true }).click();
    await expect(p2.getByTestId("advance-ready")).toBeVisible();
    await p2.getByRole("button", { name: "Advance Character" }).click();
    await p2.getByRole("tab", { name: "Advancement" }).click();
    await expect(p2.getByTestId("profile-level")).toHaveText("2 of 10", { timeout: 60_000 });
    await expect(p2.getByTestId("history-level-2")).toContainText("+1 PER");
    await p2.goto(`/characters/${characterId}?view=abilities`);
    await expect(p2.getByTestId("abilities-signature-slots")).toContainText("Signature slots used: 0 /");
    const capacity = Number((await p2.getByTestId("abilities-signature-slots").textContent())!.match(/used: 0 \/ (\d+)/)![1]);
    pass("V04", { level: 2, arcaneAccess, signatureCapacity: capacity, advancementHistory: "+1 PER at Level 2" });
  }

  // ---- V05 — the loadout and the exact Weapon Attack. ----
  {
    await p2.goto(`/characters/${characterId}`);
    await expect(p2.getByTestId("sheet-page-1")).toBeVisible({ timeout: 60_000 });
    await p2.getByTestId("sheet-loadout-edit").click();
    await p2.getByTestId("sheet-loadout-main").selectOption({ label: "Long Blade" });
    await p2.getByTestId("sheet-loadout-grip").selectOption({ label: "One-handed" });
    await p2.getByTestId("sheet-loadout-save").click();
    await expect(p2.getByTestId("sheet-loadout-form")).toHaveCount(0);
    await expect(p2.getByTestId("sheet-main-hand")).toHaveAttribute("data-weapon", w.longBladeVersionId);
    const slash = p2.getByTestId("sheet-attacks-main_hand").getByTestId("sheet-attack-row").filter({ hasText: "Slash" });
    await expect(slash.getByTestId("sheet-attack-ap")).toHaveText("2");
    const loadout = await db.prisma.characterWeaponLoadout.findUniqueOrThrow({ where: { characterId } });
    pass("V05", { weaponVersion: w.longBladeVersionId, grip: "ONE_HANDED", attack: "Long Blade — Slash", attackAp: 2, damage: await slash.getByTestId("sheet-attack-damage").textContent(), loadoutVersion: (loadout as { lockVersion?: number }).lockVersion ?? null });
  }

  // ---- V06 — the Spell builder: a Sustained Signature Spell at Release 2's revised price, finalized. ----
  let spellId = "";
  {
    await p2.goto(`/characters/${characterId}?view=abilities`);
    await p2.getByTestId("abilities-new-spell").click();
    await p2.getByTestId("spell-new-name").fill(spellName);
    await p2.getByTestId("spell-new-start").click();
    await expect(p2.getByTestId("spell-builder")).toBeVisible();
    // A prerequisite the Character does not meet is locked with its reason (V04's rejected-prerequisite evidence).
    await spellStep(p2, "AUTHORITY");
    await p2.getByTestId("spell-authority-ARCANE_AUTHORITY").check();
    await spellStep(p2, "EFFECTS");
    await expect(spellOption(p2, "spell-effect-picker", "spell.effect.cleanse")).toContainText("Locked Requires Expert Arcane Authority Skill");
    await spellStep(p2, "TARGETING");
    await spellOption(p2, "spell-targeting-picker", "spell.targeting.self").getByRole("radio").check();
    await spellStep(p2, "EFFECTS");
    await spellOption(p2, "spell-effect-picker", revisedName).getByTestId("spell-option-add").click();
    await expect(p2.getByTestId("spell-effect")).toHaveCount(1);
    await spellStep(p2, "DURATION");
    await spellOption(p2, "spell-duration-picker", "spell.duration.sustained").getByRole("radio").check();
    await expect(p2.getByTestId("spell-save-state")).toHaveAttribute("data-save", "saved", { timeout: 20_000 });
    await expect(p2.getByTestId("spell-live").getByTestId("spell-state")).toHaveAttribute("data-state", "VALID");
    await expect(p2.getByTestId("spell-live").getByTestId("spell-final-mp")).toHaveText("3 MP"); // Release 2's authored price (Release 1: 4)
    const ap = (await p2.getByTestId("spell-live").getByTestId("spell-final-ap").textContent())!;
    await spellStep(p2, "FINALIZE");
    await p2.getByTestId("spell-finalize").click();
    await expect(p2.getByTestId("spell-detail")).toBeVisible();
    await expect(p2.getByTestId("spell-detail-status")).toHaveText("Active");
    await expect(p2.getByTestId("spell-detail-revision")).toHaveText("Revision 1");
    spellId = p2.url().split("/").at(-1)!.split("?")[0]!;
    const links = await p2.getByTestId("spell-component-link").evaluateAll((els) => els.map((e) => e.getAttribute("data-version")));
    expect(links).toContain(revisionId);
    expect(links).not.toContain(w.revised.baseVersionId);
    pass("V06", { spellId, revision: 1, finalMp: 3, finalAp: ap, duration: "spell.duration.sustained", effectVersion: revisionId, prerequisiteRefused: "spell.effect.cleanse — Requires Expert Arcane Authority Skill" });
  }

  // ---- V07 — the Maneuver builder on the real backend, linked to the exact equipped Attack. ----
  let maneuverId = "";
  let attackExpression = "";
  let inspectedPayment: { ME: number; MP: number };
  {
    await p2.goto(`/characters/${characterId}/maneuvers/new`);
    await p2.getByLabel("Maneuver name").fill(maneuverName);
    await p2.getByRole("button", { name: "Start building" }).click();
    await p2.getByRole("tab", { name: "Action Selection" }).click();
    await p2.getByRole("button", { name: "Add Long Blade · Long Blade — Slash · slashing", exact: true }).click();
    await p2.getByRole("tab", { name: "Effects", exact: true }).click();
    await p2.getByRole("button", { name: "Select test.wo8.effect.enhancement", exact: true }).click();
    await p2.getByLabel(/^Attach .* to$/).first().selectOption("action1");
    await p2.getByRole("tab", { name: "Duration", exact: true }).click();
    await p2.getByRole("button", { name: "Select maneuver.duration.instant", exact: true }).click();
    await p2.getByRole("button", { name: "Save now" }).click();
    await p2.getByRole("tab", { name: "Review", exact: true }).click();
    await expect(p2.getByRole("tabpanel")).toContainText("action1: Long Blade · Long Blade — Slash · slashing");
    await expect(p2.getByTestId("maneuver-cost-inspector")).toContainText("Final listed AP / MP");
    const cost = (await p2.getByTestId("maneuver-cost-inspector").innerText()).match(/Final listed AP \/ MP\s+(\d+) AP \/ (\d+) MP/)!;
    await p2.getByRole("tab", { name: "Finalize", exact: true }).click();
    await p2.getByRole("button", { name: "Finalize Maneuver", exact: true }).click();
    await expect(p2.getByTestId("maneuver-detail")).toBeVisible({ timeout: 60_000 });
    await expect(p2.getByTestId("maneuver-history-revision")).toContainText("Revision 1 (current)");
    maneuverId = p2.url().split("/").at(-1)!.split("?")[0]!;
    const row = await db.prisma.characterSignatureAbility.findUniqueOrThrow({ where: { id: maneuverId }, include: { currentManeuverRevision: true } });
    expect(row.characterId).toBe(characterId);
    expect(row.currentManeuverRevision?.characterReleaseId).toBe(release2Id);
    pass("V07", { maneuverId, revision: 1, finalAp: Number(cost[1]), finalMp: Number(cost[2]), action: "Long Blade — Slash (equipped exact Attack)", effect: "test.wo8.effect.enhancement", builder: "real backend (no route fulfilment)" });
  }

  // ---- V08 — Sheet, Card Library and print views: read-only. ----
  {
    const before = await fingerprint(characterId, w.rulesetId);
    const writes = writesOf(p2);
    await p2.goto(`/characters/${characterId}`);
    await expect(p2.getByTestId("sheet-main-hand")).toHaveAttribute("data-weapon", w.longBladeVersionId, { timeout: 60_000 });
    await expect(p2.getByTestId("sheet-spell-row").filter({ hasText: spellName })).toBeVisible();
    await expect(p2.getByTestId("sheet-maneuver-row").filter({ hasText: maneuverName })).toContainText("· r1");
    await p2.goto(`/characters/${characterId}/cards`);
    await expect(p2.getByText(spellName).first()).toBeVisible({ timeout: 60_000 });
    await p2.goto(`/characters/${characterId}/cards/print`);
    await expect(p2.getByTestId("print-card").first()).toBeVisible({ timeout: 60_000 });
    const cards = await p2.getByTestId("print-card").count();
    expect(writes).toEqual([]);
    expect(await fingerprint(characterId, w.rulesetId)).toBe(before);
    pass("V08", { views: ["Sheet", "Card Library", "Card print"], printCards: cards, writes: 0, fingerprintUnchanged: before });
  }

  // ---- V09 — the Rules Inspector evidence: Release 2 and the operands of the Attack and the Spell. ----
  {
    const before = await fingerprint(characterId, w.rulesetId);
    const writes = writesOf(p2);
    await p2.goto(`/characters/${characterId}`);
    // The test build starts at full capacity. Take the actual sheet capacities into the Lab.
    const capacity = async (key: string) => Number((await p2.getByTestId(`sheet-resource-max-${key}`).innerText()).replace("/", "").trim());
    const mana = { ME: await capacity("ME"), MP: await capacity("MP") };
    await p2.getByRole("tab", { name: "Attacks" }).click();
    // The Slash Attack's damage inspector: the exact Weapon / Attack revisions this Release pins and the server's steps.
    const slashRow = p2.getByTestId("character-view-attacks").locator("tr").filter({ hasText: "Slash" }).first();
    const inspector = slashRow.getByTestId("attack-inspector");
    await inspector.locator("summary").click();
    await expect(inspector).toContainText(w.longBladeVersionId.slice(0, 8));
    const steps = await inspector.getByTestId("attack-inspector-step").allTextContents();
    expect(steps.length).toBeGreaterThan(0);
    const power = (await inspector.getByTestId("attack-inspector-power").first().textContent())!;
    attackExpression = power.split("→").at(-1)!.trim();
    expect(attackExpression).toMatch(/^\d+d\d+/);
    // The Spell's cost inspector: every component link is an entry of Release 2 at the exact revision it pins.
    await p2.goto(`/characters/${characterId}/spells/${spellId}`);
    await p2.getByText("Inspect cost").first().click();
    const costRows = p2.getByTestId("spell-cost-inspector").first();
    await expect(costRows).toContainText(revisedName);
    await expect(costRows).toContainText("Final MP (rounded once)3 MP");
    const effectLink = costRows.getByTestId("spell-component-link").filter({ hasText: revisedName });
    await expect(effectLink).toHaveAttribute("data-version", revisionId);
    await expect(effectLink).toHaveAttribute("href", `/compendium/rulesets/${w.rulesetId}/releases/${release2Id}/entities/${w.revised.entityId}`);
    const listedMp = Number.parseInt(await p2.getByTestId("spell-final-mp").first().innerText(), 10);
    expect(listedMp).toBe(3);
    // In a separate tab, run the same ME-first payment on the pinned Release.
    const lab = await p2.context().newPage();
    await lab.goto("/developer/rules");
    await lab.getByRole("button", { name: "Release", exact: true }).click();
    const rulesets = lab.getByLabel("Ruleset", { exact: true });
    await expect.poll(() => rulesets.locator("option").count()).toBeGreaterThan(1);
    while (await rulesets.locator(`option[value="${w.rulesetId}"]`).count() === 0) {
      const count = await rulesets.locator("option").count();
      await lab.getByRole("button", { name: "Load more Rulesets" }).click();
      await expect.poll(() => rulesets.locator("option").count()).toBeGreaterThan(count);
    }
    await rulesets.selectOption(w.rulesetId);
    await lab.getByLabel("Exact Release", { exact: true }).selectOption(release2Id);
    const plan = { steps: [{ stepKey: "ward", order: 1, operation: "RESOURCE_PAYMENT_APPLY", input: {
      snapshot: { resources: Object.entries(mana).map(([resourceKey, maximum]) => ({
        resourceKey, kind: "POOL", minimum: 0, maximum, current: maximum, reservedCapacity: 0,
      })) },
      payment: { costKey: "MP", listedAmount: listedMp, sources: [{ resourceKey: "ME", order: 1 }, { resourceKey: "MP", order: 2 }] },
    } }] };
    await lab.getByText("Import plan JSON", { exact: true }).click();
    await lab.getByLabel("Plan JSON", { exact: true }).fill(JSON.stringify(plan));
    await lab.getByRole("button", { name: "Use plan JSON" }).click();
    await lab.getByRole("button", { name: "Run Evaluation" }).click();
    await lab.getByRole("list", { name: "Executed step timeline" }).getByRole("button", { name: /ward · RESOURCE_PAYMENT_APPLY/ }).click();
    const result = lab.getByTestId("resulting-resources");
    const remaining = async (key: string) => Number(await result.getByRole("row").filter({ has: lab.getByRole("cell", { name: key, exact: true }) }).getByRole("cell").last().innerText());
    inspectedPayment = { ME: await remaining("ME"), MP: await remaining("MP") };
    await lab.getByRole("tab", { name: "PROVENANCE", exact: true }).click();
    await expect(lab.getByRole("region", { name: "Selected step inspector" })).toContainText(release2Id);
    await lab.close();
    expect(writes).toEqual([]);
    expect(await fingerprint(characterId, w.rulesetId)).toBe(before);
    pass("V09", { rulesInspector: { release2Id, mana, listedMp, remaining: inspectedPayment }, attackInspector: { weaponVersion: w.longBladeVersionId, steps, power, expression: attackExpression }, spellCost: { effectVersion: revisionId, release: release2Id, finalMp: 3 }, writes: 0, fingerprintUnchanged: before });
  }
  await s2.close();

  // ---- V10 — play turns through the Play Workspace. ----
  const s3 = await fresh(browser);
  const play = s3.page;
  play.setDefaultTimeout(30_000);
  const v10: Record<string, unknown> = {};
  {
    await play.goto(`/characters/${characterId}/play`);
    await expect(play.getByTestId("play-workspace")).toBeVisible({ timeout: 60_000 });
    const apMax = Number((await resource(play, "AP").textContent())!.split("/")[1]!.trim());
    const mp0 = (await resource(play, "MP").textContent())!.trim();
    for (const e of ["BEGIN_COMBAT", "START_ROUND", "START_TURN"]) await timing(play, e);
    await expect(play.getByTestId("play-context")).toHaveAttribute("data-turn", "ACTIVE");
    // Preview vs commit: the preview spends nothing and advances no version.
    const v0 = await versions(play);
    await play.locator('[data-action="MOVE"] [data-testid="play-action-open"]').click();
    await play.getByTestId("play-preview").click();
    await expect(play.getByTestId("play-result")).toHaveAttribute("data-committed", "false");
    await expect(resource(play, "AP")).toHaveText(`${apMax} / ${apMax}`);
    expect(await versions(play)).toEqual(v0);
    await play.getByTestId("play-commit").click();
    await committed(play);
    await expect(resource(play, "AP")).toHaveText(`${apMax - 1} / ${apMax}`);
    const v1 = await versions(play);
    expect(v1.runtime).toBeGreaterThan(v0.runtime);
    // Movement: 5 ft of the granted allowance.
    await play.getByTestId("play-tab-movement").click();
    await play.getByTestId("play-movement-open").click();
    await play.getByTestId("play-segment-0-distance").fill("5");
    await play.getByTestId("play-segment-0-terrain").selectOption("NORMAL");
    await play.getByTestId("play-commit").click();
    await committed(play);
    await play.getByTestId("play-tab-movement").click();
    await expect(play.getByTestId("play-movement-segments")).toContainText("5 ft normal");
    // The equipped Weapon Attack with a raw physical roll and a GM-provided Dodge; damage is authorised, NOT applied.
    await play.getByTestId("play-tab-attacks").click();
    await play.getByTestId("play-attack").filter({ hasText: "Slash" }).first().getByTestId("play-attack-open").click();
    // The Character Die is a d4: the raw physical face is 3; the GM provides the target's Dodge.
    await play.getByTestId("play-attack-roll-face-0").fill("3");
    await play.getByTestId("play-attack-dodge").fill("3");
    await play.getByTestId("play-commit").click();
    await committed(play);
    await expect(play.getByTestId("play-result-check")).toContainText("natural 3");
    await expect(play.getByTestId("play-result-outcome")).toContainText("NOT APPLIED");
    // The same operands the Rules Inspector showed (V09): the authorised damage is the inspected expression.
    await expect(play.getByTestId("play-result-outcome")).toContainText(attackExpression);
    v10.attack = { rawFaces: [3], dodge: 3, check: await play.getByTestId("play-result-check").textContent(), outcome: await play.getByTestId("play-result-outcome").textContent() };
    await expect(resource(play, "AP")).toHaveText(`${apMax - 3} / ${apMax}`);
    for (const e of ["END_TURN", "END_ROUND", "START_ROUND", "START_TURN"]) await timing(play, e);
    await expect(resource(play, "AP")).toHaveText(`${apMax} / ${apMax}`);
    // The Sustained Signature Spell: cast for its exact price; it becomes Active Magic.
    const meBefore = (await resource(play, "ME").textContent())!.trim();
    const mpBefore = (await resource(play, "MP").textContent())!.trim();
    await play.getByTestId("play-tab-spells").click();
    await play.getByTestId("play-spell").filter({ hasText: spellName }).getByTestId("play-ability-open").click();
    await play.getByTestId("play-commit").click();
    await committed(play);
    await expect(play.getByTestId("play-result-outcomes").or(play.getByTestId("play-result-summary")).first()).toBeVisible();
    v10.spell = { meBefore, mpBefore, meAfter: (await resource(play, "ME").textContent())!.trim(), mpAfter: (await resource(play, "MP").textContent())!.trim(), result: await play.getByTestId("play-result-summary").textContent() };
    await play.getByTestId("play-tab-magic").click();
    await expect(play.getByTestId("play-effect")).toHaveAttribute("data-status", "ACTIVE");
    const events = await ledger(characterId);
    const castEvent = await db.prisma.characterPlayEvent.findUniqueOrThrow({ where: { id: events.at(-1)!.id } });
    expect(castEvent.operationKind).toBe("SPELL");
    expect(castEvent.rulesetReleaseId).toBe(release2Id);
    const castRecord = castEvent.record as unknown as { resourcesAfter: { resourceKey: string; current: number }[] };
    for (const key of ["ME", "MP"] as const) {
      expect(castRecord.resourcesAfter.find(r => r.resourceKey === key)?.current).toBe(inspectedPayment[key]);
    }
    v10.inspectorPaymentMatch = { eventId: castEvent.id, ...inspectedPayment };
    v10.mp0 = mp0;
    v10.apMax = apMax;
    v10.eventIds = events.map((e) => e.id);
    v10.versions = await versions(play);
    pass("V10", v10);
  }

  // ---- V11 — hold mid-turn (Active Magic held), close; resume twice in fresh contexts: identical, no writes. ----
  {
    await expect(play.getByTestId("play-context")).toHaveAttribute("data-turn", "ACTIVE");
    await s3.close();
    const before = await fingerprint(characterId, w.rulesetId);
    const seen: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { page: r, close: done } = await fresh(browser);
      const writes = writesOf(r);
      await r.goto("/characters");
      await r.getByTestId("library-search").fill(characterName);
      await r.locator(`[data-testid="character-row"][data-character-id="${characterId}"]`).getByTestId("library-resume-play").click();
      await r.waitForURL(`**/characters/${characterId}/play`);
      const ws = r.getByTestId("play-workspace");
      await expect(ws).toBeVisible({ timeout: 60_000 });
      await expect(r.getByTestId("play-context")).toHaveAttribute("data-turn", "ACTIVE");
      await r.getByTestId("play-tab-magic").click();
      await expect(r.getByTestId("play-effect")).toHaveAttribute("data-status", "ACTIVE");
      seen.push(JSON.stringify({ versions: await versions(r), ap: await resource(r, "AP").textContent(), mp: await resource(r, "MP").textContent(), me: await resource(r, "ME").textContent(), movement: await resource(r, "MOVEMENT_ALLOWANCE").textContent(), events: await r.getByTestId("play-event").allTextContents(), magic: await r.getByTestId("play-effect").allTextContents() }));
      expect(writes).toEqual([]);
      await done();
    }
    expect(seen[1]).toBe(seen[0]);
    expect(await fingerprint(characterId, w.rulesetId)).toBe(before);
    pass("V11", { resumedState: JSON.parse(seen[0]!) as unknown, identicalAcrossTwoResumes: true, writes: 0, fingerprintUnchanged: before });
  }

  // ---- V12 — continue: the Maneuver, maintenance, dismissal, end of play; the history reconciles. ----
  {
    const { page: c, close: done } = await fresh(browser);
    c.setDefaultTimeout(30_000);
    await c.goto(`/characters/${characterId}/play`);
    await expect(c.getByTestId("play-workspace")).toBeVisible({ timeout: 60_000 });
    const out: Record<string, unknown> = {};
    // The Signature Maneuver (its exact Attack): the engine asks for its Attack Roll; it is answered with raw dice.
    await expect(c.getByTestId("play-context")).toHaveAttribute("data-turn", "ACTIVE");
    const before = { ap: (await resource(c, "AP").textContent())!.trim(), mp: (await resource(c, "MP").textContent())!.trim(), me: (await resource(c, "ME").textContent())!.trim() };
    await c.getByTestId("play-tab-maneuvers").click();
    await c.getByTestId("play-maneuver").filter({ hasText: maneuverName }).getByTestId("play-ability-open").click();
    await c.getByTestId("play-commit").click();
    const pending = c.getByTestId("play-pending").first();
    await expect(pending).toHaveAttribute("data-kind", "ATTACK_ROLL");
    await expect(c.getByTestId("play-result").first()).toHaveAttribute("data-committed", "false"); // nothing paid while input is missing
    expect((await resource(c, "AP").textContent())!.trim()).toBe(before.ap);
    const req = (await pending.getAttribute("data-request"))!.replace(/[^A-Za-z0-9]/g, "_");
    await c.getByTestId(`play-pending-${req}-roll-face-0`).fill("3");
    await c.getByTestId(`play-pending-${req}-dodge`).fill("3");
    await c.getByTestId("play-commit").click();
    await committed(c);
    out.maneuver = { before, after: { ap: (await resource(c, "AP").textContent())!.trim(), mp: (await resource(c, "MP").textContent())!.trim(), me: (await resource(c, "ME").textContent())!.trim() }, rawFaces: [3], dodge: 3, summary: await c.getByTestId("play-result-summary").first().textContent() };
    await expect(c.getByTestId("play-result-summary").first()).toContainText(`${maneuverName} used`);
    // End the turn and the round; the next round's maintenance pays the Sustain upkeep; then the ward is dismissed.
    for (const e of ["END_TURN", "END_ROUND", "START_ROUND", "START_TURN"]) await timing(c, e);
    await c.getByTestId("play-tab-magic").click();
    await expect(c.getByTestId("play-magic-maintain")).toBeEnabled();
    await c.getByTestId("play-magic-maintain").click();
    await committed(c);
    await expect(c.getByTestId("play-log")).toContainText("maintenance: applied");
    await c.getByTestId("play-tab-magic").click();
    await c.getByTestId("play-effect-dismiss").click();
    await expect(c.getByTestId("play-log")).toContainText("dismiss: applied");
    await c.getByTestId("play-tab-magic").click();
    await expect(c.getByTestId("play-effect")).toHaveAttribute("data-status", "ENDED");
    for (const e of ["END_TURN", "END_ROUND", "END_COMBAT"]) await timing(c, e);
    await expect(c.getByTestId("play-timing-BEGIN_COMBAT")).toBeEnabled();
    out.endPhase = await c.getByTestId("play-context").getAttribute("data-phase");
    await expect(c.getByTestId("play-reconciliation")).toHaveCount(0);
    const uiEvents = await c.getByTestId("play-event").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-sequence"))));
    const dbEvents = await ledger(characterId);
    expect(uiEvents.sort((a, b) => a - b)).toEqual(dbEvents.map((e) => e.sequence));
    expect(dbEvents.map((e) => e.sequence)).toEqual(dbEvents.map((_e, i) => i + 1));
    const runtime = await db.prisma.characterPlayRuntime.findUniqueOrThrow({ where: { characterId } });
    out.events = dbEvents.length;
    out.eventIds = dbEvents.map((e) => e.id);
    out.finalVersions = await versions(c);
    out.runtimeLockVersion = runtime.lockVersion;
    out.allEventsOnRelease2 = dbEvents.every((e) => e.rulesetReleaseId === release2Id);
    expect(out.allEventsOnRelease2).toBe(true);
    expect((out.finalVersions as { runtime: number }).runtime).toBe(dbEvents.at(-1)!.runtimeVersion);
    await done();
    pass("V12", out);
  }
  return { world: w, rows };
}

test("M6-WO12 playtest vertical slice — run 1 (newly prepared world)", async ({ browser }) => {
  test.setTimeout(1_200_000);
  const started = Date.now();
  const { world, rows } = await journey(browser, 1);
  expect(rows.map((r) => r.id)).toEqual(WO12_STEPS.map(([id]) => id));
  evidence.push({ run: 1, world: world.runId, rows, seconds: Math.round((Date.now() - started) / 1000) });
});

test("M6-WO12 playtest vertical slice — run 2 (second newly prepared world, fresh contexts)", async ({ browser }) => {
  test.setTimeout(1_200_000);
  const started = Date.now();
  const { world, rows } = await journey(browser, 2);
  expect(rows.map((r) => r.id)).toEqual(WO12_STEPS.map(([id]) => id));
  evidence.push({ run: 2, world: world.runId, rows, seconds: Math.round((Date.now() - started) / 1000) });
});
