import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import "./m6-wo11-fixture-loader";

/**
 * M7-WO1 E03, E10, E14 — encounter preparation entirely through the Studio UI against the production build and
 * PostgreSQL, in ISOLATED test Rulesets prepared by the WO12 playtest fixture (`test.m6wo12.<run>.*`, never the owner's
 * catalog). Desktop (1280 px) and 390 px.
 *
 *   B01 Encounters → New encounter → name + exact Release → workspace (empty-roster readiness, no combat control).
 *   B02 Two sides; two completed Characters added from search; a DRAFT and an other-Release Character are explained,
 *       not offered; readiness PREPARED; the standalone-combat warning is shown.
 *   B03 Reload: the encounter reopens intact; the list finds it.
 *   B04 Usable error states: an occupied side cannot be removed; a stale tab is refused, reloaded and explained.
 *   B05 Archive: a read-only historical view with its history.
 *   B06 390 px: the workspace and list have no horizontal overflow.
 * Evidence (steps, screenshots) is written to test-results/m7-wo1-evidence.json and test-results/m7-wo1/.
 */
type Db = typeof import("@prowess/db");
type Fixture = {
  preparePlaytestRelease(runId: string): Promise<{ summary: { rulesetName: string; rulesetId: string; release1: { id: string; releaseNumber: number } }; world: { release: { id: string }; pins: Map<string, unknown> } }>;
  cleanupPlaytestWorlds(runId: string): Promise<number>;
};
type CharacterFixture = { workedChoices(pins: Map<string, unknown>): unknown };
const runtimeImport = (specifier: string): Promise<unknown> => import(specifier);
const expect = baseExpect.configure({ timeout: 30_000 });
const SHOTS = path.join(process.cwd(), "test-results", "m7-wo1");

let db: Db;
let fx: Fixture;
const runA = `m7a${Date.now().toString(36)}`;
const runB = `m7b${Date.now().toString(36)}`;
let rulesetName = "";
let releaseLabel = "";
const ids: Record<string, string> = {};
const rows: Array<{ id: string; title: string; evidence: Record<string, unknown> }> = [];
let encounterUrl = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  test.setTimeout(600_000);
  mkdirSync(SHOTS, { recursive: true });
  db = await import("@prowess/db");
  db.assertRunningAgainstTestDatabase(process.env.DATABASE_URL as string);
  fx = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo12-playtest")) as Fixture;
  const chars = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo3-character-release")) as CharacterFixture;
  const a = await fx.preparePlaytestRelease(runA);
  const b = await fx.preparePlaytestRelease(runB);
  rulesetName = a.summary.rulesetName;
  releaseLabel = `Release ${a.summary.release1.releaseNumber}`;
  const complete = async (world: typeof a.world, name: string) => {
    const c = await db.createCharacter({ name, rulesetReleaseId: world.release.id });
    const saved = await db.saveCharacterCreation(c.id, { expectedLockVersion: c.lockVersion, candidate: chars.workedChoices(world.pins) as never });
    return (await db.finalizeCharacterCoreCreation(c.id, { expectedLockVersion: saved.lockVersion })).id;
  };
  ids.alpha = await complete(a.world, `Alpha ${runA}`);
  ids.beta = await complete(a.world, `Beta ${runA}`);
  ids.draft = (await db.createCharacter({ name: `Draft ${runA}`, rulesetReleaseId: a.world.release.id })).id;
  ids.other = await complete(b.world, `Other ${runA}`);
  const v = (await db.getCharacterPlayWorkspace(ids.beta)).versions;
  await db.commitCharacterPlayOperation(ids.beta, { operation: { kind: "TIMING", event: "BEGIN_COMBAT" }, idempotencyKey: randomUUID(), expectedRuntimeVersion: v.runtimeVersion, expectedPlayStateVersion: v.playStateVersion });
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  let sha = process.env.GITHUB_SHA ?? "unknown";
  try {
    sha = process.env.GITHUB_SHA ?? execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* not a checkout */
  }
  writeFileSync(path.join(process.cwd(), "test-results", "m7-wo1-evidence.json"), `${JSON.stringify({ gate: "M7-WO1", spec: "tests/e2e/m7-wo1-encounters.spec.ts", sha, runs: [runA, runB], steps: rows, writtenAt: new Date().toISOString() }, null, 2)}\n`);
  if (fx !== undefined && process.env.PROWESS_M7_KEEP_WORLD !== "1") {
    await fx.cleanupPlaytestWorlds(runA);
    await fx.cleanupPlaytestWorlds(runB);
  }
});
const pass = (id: string, title: string, evidence: Record<string, unknown>) => rows.push({ id, title, evidence });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function addCharacter(page: Page, name: string, side: string) {
  await page.getByLabel("Search Characters by name").fill(name);
  await page.getByLabel("Add to side").selectOption({ label: side });
  await page.getByRole("button", { name: `Add ${name}` }).click();
  await expect(page.getByTestId("encounter-notice-ok")).toContainText(`${name} added.`);
}

test("B01–B03 create an encounter on an exact Release, prepare its roster, reopen it intact", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("link", { name: "Encounters", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Encounters" })).toBeVisible();
  await page.getByRole("link", { name: "New encounter" }).click();
  await page.getByRole("button", { name: "Create encounter" }).click();
  await expect(page.getByTestId("new-encounter-field-error")).toHaveText("Give the encounter a name.");
  await page.getByLabel("Name (required)").fill(`Bridge Ambush ${runA}`);
  await page.getByRole("combobox", { name: "Ruleset", exact: true }).selectOption({ label: rulesetName });
  await page.getByRole("button", { name: "Create encounter" }).click();
  await expect(page.getByTestId("new-encounter-field-error")).toHaveText("Choose the exact Release this encounter uses.");
  const release = page.getByRole("combobox", { name: "Release (required)" });
  await release.selectOption({ index: 1 });
  await shot(page, "b01-new-encounter");
  await page.getByRole("button", { name: "Create encounter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Bridge Ambush ${runA}` })).toBeVisible();
  encounterUrl = page.url();
  await expect(page.getByTestId("encounter-release")).toContainText(`${rulesetName} · ${releaseLabel}`);
  await expect(page.getByTestId("encounter-readiness")).toContainText("The roster is empty");
  await expect(page.getByTestId("combat-unavailable")).toContainText("not available yet");
  await expect(page.getByRole("button", { name: /start combat/i })).toHaveCount(0);
  pass("B01", "encounter created on an exact Release; empty-roster readiness; no combat control", { url: encounterUrl });

  for (const side of ["Heroes", "Raiders"]) {
    await page.getByLabel("New side name").fill(side);
    await page.getByRole("button", { name: "Add side" }).click();
    await expect(page.getByTestId("encounter-notice-ok")).toContainText(`Side “${side}” added.`);
  }
  await addCharacter(page, `Alpha ${runA}`, "Heroes");
  await addCharacter(page, `Beta ${runA}`, "Raiders");
  // Ineligible Characters are explained, never offered.
  await page.getByLabel("Search Characters by name").fill(runA);
  const draft = page.getByTestId("encounter-candidate").filter({ hasText: `Draft ${runA}` });
  await expect(draft).toContainText("Core creation is not complete yet.");
  await expect(draft.getByRole("button")).toHaveCount(0);
  const other = page.getByTestId("encounter-candidate").filter({ hasText: `Other ${runA}` });
  await expect(other).toContainText("Different Release");
  await expect(other).toContainText("Prepare an encounter on the Character's Release instead.");
  await expect(other.getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("readiness-state")).toContainText("Prepared");
  await expect(page.getByTestId("encounter-readiness")).toContainText(`Beta ${runA} is in standalone combat`);
  await shot(page, "b02-prepared-desktop");
  pass("B02", "two sides, two completed Characters; DRAFT and other-Release explained, not offered; PREPARED", { sides: 2, participants: 2 });

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `Bridge Ambush ${runA}` })).toBeVisible();
  await expect(page.getByTestId("encounter-side")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Side Heroes", exact: true })).toContainText(`Alpha ${runA}`);
  await expect(page.getByRole("region", { name: "Side Raiders", exact: true })).toContainText(`Beta ${runA}`);
  await page.goto("/encounters");
  await page.getByLabel("Search by name").fill(runA);
  await expect(page.getByTestId("encounter-row").filter({ hasText: `Bridge Ambush ${runA}` })).toContainText("2 sides · 2 participants");
  await shot(page, "b03-list");
  pass("B03", "reload and list reopen the encounter intact", {});
});

test("B04 usable error states: occupied side, stale tab", async ({ browser }) => {
  test.setTimeout(180_000);
  const one = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const two = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await one.goto(encounterUrl);
  await two.goto(encounterUrl);
  await expect(one.getByRole("button", { name: "Remove side “Heroes”" })).toBeDisabled();
  await expect(one.getByText("Move or remove its participants before removing this side.").first()).toBeVisible();
  // Tab two changes the encounter; tab one's next command is stale → refused, reloaded and explained.
  await two.getByLabel("New side name").fill("Reinforcements");
  await two.getByRole("button", { name: "Add side" }).click();
  await expect(two.getByTestId("encounter-notice-ok")).toBeVisible();
  await one.getByLabel("New side name").fill("Scouts");
  await one.getByRole("button", { name: "Add side" }).click();
  await expect(one.getByTestId("encounter-notice-stale")).toContainText("reloaded with the latest saved state");
  await expect(one.getByRole("region", { name: "Side Reinforcements", exact: true })).toBeVisible();
  await expect(one.getByRole("region", { name: "Side Scouts", exact: true })).toHaveCount(0);
  await shot(one, "b04-stale-refused");
  pass("B04", "occupied side not removable; stale tab refused, reloaded, explained", {});
  await one.close();
  await two.close();
});

test("B05 archive: a read-only historical view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(encounterUrl);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Archive encounter" }).click();
  await expect(page.getByTestId("encounter-status")).toHaveText("Archived — read-only");
  await expect(page.getByRole("button", { name: /Add side|Remove|Move|Rename|Archive encounter/ })).toHaveCount(0);
  await expect(page.getByTestId("encounter-history")).toContainText("archived (read-only)");
  await expect(page.getByTestId("encounter-history")).toContainText(`Alpha ${runA} added to “Heroes”.`);
  await shot(page, "b05-archived");
  pass("B05", "archived encounter is read-only and keeps its history", {});
});

test("B06 390 px: the list and the workspace fit the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/encounters");
  await expect(page.getByRole("heading", { level: 1, name: "Encounters" })).toBeVisible();
  const list = await overflow(page);
  await shot(page, "b06-list-390");
  await page.goto(encounterUrl);
  await expect(page.getByTestId("encounter-workspace")).toBeVisible();
  const workspace = await overflow(page);
  await shot(page, "b06-workspace-390");
  // An EDITABLE workspace (every roster control present) at 390 px, prepared through the service.
  const created = await db.createEncounter({ name: `Narrow ${runA}`, rulesetReleaseId: (await db.getCharacterPlayWorkspace(ids.alpha!)).release.id, idempotencyKey: randomUUID() });
  const side = (await db.commandEncounter(created.encounter.id, { command: { kind: "ADD_SIDE", name: "Vanguard" }, expectedVersion: 1, idempotencyKey: randomUUID() })).encounter.sides[0]!;
  await db.commandEncounter(created.encounter.id, { command: { kind: "ADD_PARTICIPANT", characterId: ids.alpha, sideId: side.id }, expectedVersion: 2, idempotencyKey: randomUUID() });
  await page.goto(`/encounters/${created.encounter.id}`);
  await expect(page.getByRole("button", { name: `Move Alpha ${runA}`, exact: true })).toBeVisible();
  const editable = await overflow(page);
  await shot(page, "b06-editable-390");
  await page.goto("/encounters/new");
  const form = await overflow(page);
  expect([list, workspace, editable, form]).toEqual([0, 0, 0, 0]);
  pass("B06", "390 px without horizontal overflow", { list, workspace, editable, form });
});
