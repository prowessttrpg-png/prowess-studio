import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect as baseExpect, test, type Browser, type Locator, type Page } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import "./m6-wo11-fixture-loader";

/**
 * RULES-WO1 — a NEW game value from a Stat, entirely through the Studio UI against the production build and PostgreSQL,
 * in an ISOLATED test Ruleset (the WO12 playtest world; never the owner's catalog). The value is a labelled TEST-ONLY
 * placeholder ("Carry Capacity = STR lb"): the rulebook states no Carry formula and none is invented as canon.
 *
 *   V01 About this build shows the version and the editors this build guides.
 *   V02 Stats → STR → "Create a new value from STR" opens a guided calculated-value editor that already reads STR;
 *       no technical tree, no payload keys. It is created as a Draft.
 *   V03 The Draft's preview shows the value for a sample Character (STR 6 → 6 lb, "Test only — not canon") without
 *       publishing anything; the published side has no such value.
 *   V04 Review → ChangeSet → approval → Release 2 through the normal governed screens.
 *   V05 A new Release 2 Character's sheet shows Max Load = STR lb labelled "Test value — not canon"; Release 2's STR page
 *       lists the value; a Release 1 Character's sheet and row are unchanged.
 */
type Db = typeof import("@prowess/db");
interface World {
  readonly runId: string;
  readonly rulesetId: string;
  readonly rulesetName: string;
  readonly policyId: string;
  readonly release1: { readonly id: string; readonly manifestId: string; readonly releaseNumber: number };
}
interface Prep {
  preparePlaytestWorld(runId: string): Promise<World>;
  fingerprint(characterId: string | null, rulesetId: string): Promise<string>;
  cleanupPlaytestWorlds(runId: string): Promise<number>;
}
const runtimeImport = (specifier: string): Promise<unknown> => import(specifier);
const expect = baseExpect.configure({ timeout: 30_000 });

let db: Db;
let prep: Prep;
const rows: Array<{ id: string; title: string; evidence: Record<string, unknown> }> = [];
let runId = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  db = await import("@prowess/db");
  db.assertRunningAgainstTestDatabase(process.env.DATABASE_URL as string);
  prep = (await runtimeImport("../../../../packages/prowess-db/tests/fixtures/m6-wo12-playtest")) as Prep;
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  const file = path.join(process.cwd(), "test-results", "rules-wo1-evidence.json");
  mkdirSync(path.dirname(file), { recursive: true });
  let sha = process.env.GITHUB_SHA ?? "unknown";
  try {
    sha = process.env.GITHUB_SHA ?? execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* not a checkout */
  }
  writeFileSync(file, `${JSON.stringify({ gate: "RULES-WO1", spec: "tests/e2e/rules-wo1-authored-values.spec.ts", sha, runId, steps: rows, writtenAt: new Date().toISOString() }, null, 2)}\n`);
  if (prep !== undefined && runId !== "" && process.env.PROWESS_RW1_KEEP_WORLD !== "1") await prep.cleanupPlaytestWorlds(runId);
});

const pass = (id: string, title: string, evidence: Record<string, unknown>) => rows.push({ id, title, evidence });

async function optionContaining(select: Locator, text: string): Promise<string> {
  await expect(select.locator("option", { hasText: text }).first()).toBeAttached();
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
function writesOf(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return writes;
}
/** Only the Character's own rows (the Ruleset rows legitimately gain Release 2). */
const characterRows = (fp: string) => fp.split("\n").filter((l) => !/^(ruleset|releases|manifests|pins|changeSets|versions):/.test(l)).join("\n");
const number = async (l: Locator) => Number(((await l.innerText()).match(/-?\d+/) ?? ["NaN"])[0]);

/** Core creation through the real wizard (the same choices as the WO12 journey). Returns the Character id. */
async function createCharacter(page: Page, w: World, releaseId: string, name: string): Promise<string> {
  await page.goto("/characters");
  await page.getByRole("link", { name: "New Character" }).click();
  await page.getByRole("combobox", { name: "Ruleset", exact: true }).selectOption({ label: w.rulesetName });
  await page.getByRole("combobox", { name: "Release", exact: true }).selectOption(releaseId);
  await expect(page.getByTestId("capability-ready")).toBeVisible();
  await page.getByLabel("Name (required)").fill(name);
  await page.getByRole("button", { name: "Create Character Draft" }).click();
  await page.waitForURL(/\/characters\/[0-9a-f-]+\/create$/);
  const id = page.url().split("/").at(-2)!;
  await page.getByRole("button", { name: "2. Race / Ancestry" }).click();
  await page.getByTestId("ancestry-card").filter({ hasText: "Orcani (test)" }).getByRole("radio").check();
  await page.getByLabel("Stat choice 1 of 2").selectOption("AGI");
  await page.getByLabel("Stat choice 2 of 2").selectOption("PRO");
  await page.getByRole("button", { name: "Save & Continue" }).click();
  await expect(page.getByTestId("points-remaining")).toHaveText("Points Remaining: 15 of 15");
  for (const [stat, n] of [["STR", 3], ["AGI", 3], ["CON", 3], ["PER", 2], ["RES", 2], ["PRO", 2]] as const) for (let i = 0; i < n; i += 1) await page.getByRole("button", { name: `Add a point to ${stat}` }).click();
  await page.getByRole("button", { name: "Save & Continue" }).click();
  await page.getByLabel("Race Skill 1").selectOption({ label: "Athletics (test)" });
  await page.getByLabel("Free Skill 1").selectOption({ label: "skill.martial" });
  await page.getByLabel("Free Skill 2").selectOption({ label: "skill.arcana" });
  await page.getByRole("button", { name: "Save & Continue" }).click();
  await page.getByTestId("affinity-card").filter({ hasText: "Evocation (test)" }).getByRole("radio").check();
  await page.getByRole("button", { name: "Save & Continue" }).click();
  await expect(page.getByTestId("check-ready")).toBeVisible();
  await page.getByRole("button", { name: "Complete Core Creation" }).click();
  await page.waitForURL(`**/characters/${id}`);
  await expect(page.getByTestId("sheet-core-armor")).toBeVisible({ timeout: 60_000 });
  return id;
}

async function fresh(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { page, close: () => context.close() };
}


test("RULES-WO1 a new value from STR: guided create, preview, publish R2; the sheet shows it labelled; R1 unchanged", async ({ browser }) => {
  test.setTimeout(900_000);
  runId = `rw1v${Date.now().toString(36)}`;
  const w = await prep.preparePlaytestWorld(runId);
  const base1 = `/compendium/rulesets/${w.rulesetId}/releases/${w.release1.id}`;
  const { page, close } = await fresh(browser);
  const shots = path.join(process.cwd(), "test-results", "rules-wo1");
  mkdirSync(shots, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });

  // ---- V01 — About this build. ----
  await page.goto("/about");
  await expect(page.getByTestId("about-version")).toHaveText("0.1.3");
  await expect(page.getByTestId("about-editor-counts")).toContainText("guided editor");
  await page.getByTestId("about-editors").locator("summary").click();
  await expect(page.getByTestId("about-guided-kind").filter({ hasText: /^STAT$/ })).toHaveCount(1);
  await expect(page.getByTestId("about-guided-kind").filter({ hasText: /^CALCULATED_VALUE$/ })).toHaveCount(1);
  await shot("v01-about");
  pass("V01", "About this build shows the version and the guided editors", { version: "0.1.3" });

  // A Release 1 Character before any change.
  const c1 = await createCharacter(page, w, w.release1.id, `Packer ${runId}`);
  const str1 = await number(page.getByTestId("sheet-stat-STR"));
  await expect(page.getByTestId("sheet-carry-max")).toContainText("—");
  const c1Fingerprint = await prep.fingerprint(c1, w.rulesetId);

  // ---- V02 — create the value from the Stat page. ----
  const name = `Carry Capacity ${runId}`;
  await page.goto(`${base1}/stats/STR`);
  await page.getByTestId("stat-new-value").click();
  await expect(page.getByRole("heading", { level: 1, name: "New Definition" })).toBeVisible();
  await expect(page.getByLabel("Definition kind")).toHaveValue("CALCULATED_VALUE");
  await expect(page.getByText(/no dedicated authoring descriptor/)).toHaveCount(0);
  await page.getByLabel("Display Name (required)").fill(name);
  await page.getByLabel("Canonical Key (required)").fill(`test.m6wo12.${runId}.value.carry_capacity`);
  await page.getByLabel(/^Value name used by other rules/).fill("CARRY_CAPACITY");
  await page.getByLabel(/^Unit/).fill("lb");
  await page.getByLabel(/^Shown on the Character sheet as/).selectOption("CARRY_MAXIMUM_LOAD");
  await page.getByLabel(/^Where this rule comes from/).selectOption("TEST_ONLY");
  await page.getByLabel(/^Why it is not canonical/).fill("Test-only placeholder: the rulebook states no Carry Capacity formula.");
  await expect(page.getByLabel("The rule states a base calculation")).toBeChecked();
  await page.getByLabel("Rounding of the result").first().selectOption("NONE");
  await page.getByRole("button", { name: "Validate Definition" }).click();
  await expect(page.getByRole("region", { name: "Validation" }).getByRole("status")).toContainText("PASS");
  await shot("v02-new-value");
  await page.getByRole("button", { name: "Create Definition as Draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} — Revision 1` })).toBeVisible();
  const u = new URL(page.url());
  const revisionId = u.pathname.split("/").at(-1)!;
  const entityId = u.pathname.split("/").at(-3)!;
  expect(u.searchParams.get("release")).toBe(w.release1.id);
  pass("V02", "A guided calculated value created from STR as a Draft", { entityId, revisionId });

  // ---- V03 — preview (nothing published). ----
  {
    const releasesBefore = await db.prisma.rulesetRelease.count({ where: { rulesetId: w.rulesetId } });
    const preview = page.getByTestId("authored-rule-preview");
    await expect(preview.getByLabel("Sample STR")).toHaveValue("6");
    await preview.getByTestId("authored-preview-run").click();
    const row = preview.getByTestId("authored-value-CARRY_CAPACITY").first();
    await expect(row.getByTestId("authored-value-result")).toHaveText("6 lb");
    await expect(row.getByTestId("canon-badge")).toHaveText("Test only — not canon");
    await shot("v03-preview");
    expect(await db.prisma.rulesetRelease.count({ where: { rulesetId: w.rulesetId } })).toBe(releasesBefore);
    pass("V03", "The Draft previews STR 6 → 6 lb (test only) with nothing published", { releasesUnchanged: releasesBefore });
  }

  // ---- V04 — governed publication of Release 2. ----
  let release2Id = "";
  {
    const proposal = `Carry Capacity ${runId}`;
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
    await confirm(page, "Approve revision r1");
    await confirm(page, "Submit for Review");
    await confirm(page, "Approve");
    await page.getByTestId("change-set-commands").getByRole("link", { name: "Releases" }).click();
    const form = page.getByRole("form", { name: "Publish Release" });
    await form.getByLabel("Base Manifest").selectOption(await optionContaining(form.getByLabel("Base Manifest"), w.release1.manifestId.slice(0, 8)));
    await form.getByLabel("Canon Policy").selectOption(await optionContaining(form.getByLabel("Canon Policy"), w.policyId.slice(0, 8)));
    await form.getByLabel("Approved ChangeSet (optional)").selectOption(changeSetId);
    await form.getByLabel("Version label").fill("R2");
    await form.getByLabel("Release notes").fill("Adds a test-only Carry Capacity.");
    await form.getByRole("button", { name: "Publish Release" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
    await page.waitForURL(/\/releases\/[0-9a-f-]+$/);
    release2Id = page.url().split("/").at(-1)!;
    pass("V04", "Review → ChangeSet → approval → Release 2", { changeSetId, release2Id });
  }
  await close();

  // ---- V05 — the Release 2 sheet shows it labelled; Release 1 unchanged. ----
  {
    const s = await fresh(browser);
    const c2 = await createCharacter(s.page, w, release2Id, `Packer R2 ${runId}`);
    await expect(s.page.getByTestId("sheet-carry-max")).toHaveText(`${str1} lb`);
    await expect(s.page.getByTestId("sheet-carry-canon")).toContainText("Test value — not canon");
    await s.page.screenshot({ path: path.join(shots, "v05-sheet-r2.png"), fullPage: true });
    await s.page.goto(`/compendium/rulesets/${w.rulesetId}/releases/${release2Id}/stats/STR`);
    await expect(s.page.getByTestId("stat-affects")).toContainText(name);
    await s.page.goto(`/characters/${c1}`);
    await expect(s.page.getByTestId("sheet-carry-max")).toBeVisible({ timeout: 60_000 });
    await expect(s.page.getByTestId("sheet-carry-max")).toContainText("—");
    expect(characterRows(await prep.fingerprint(c1, w.rulesetId))).toBe(characterRows(c1Fingerprint));
    await s.close();
    pass("V05", "R2 sheet Max Load = STR lb (test value); R2 STR page lists it; R1 Character unchanged", { r2Character: c2, maxLoad: `${str1} lb`, r1Character: c1 });
  }
});
