import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect as baseExpect, test, type Browser, type Locator, type Page } from "@playwright/test";
import "./m6-wo8-fixture-loader";
import "./m6-wo11-fixture-loader";

/**
 * PRE-M7-WO1 C10–C14 — the Strength → Armor demonstration, entirely through the Studio UI against the production build
 * and PostgreSQL, in an ISOLATED test Ruleset prepared by the WO12 playtest command (test-only `test.m6wo12.<run>.*`
 * content; never the owner's catalog).
 *
 *   S01 Topics → Stats → STR → "What this affects" lists Armor (direct, floor(str / 3)) from the Release's rules.
 *   S02 A Character is created on Release 1; its sheet shows Armor = floor(STR / 3).
 *   S03 "Edit this rule" opens a Draft of the OWNING rule; the guided editor removes STR's contribution; Save Draft
 *       validates PASS; the preview shows Armor 1 → 0 for STR 3 without saving or publishing anything.
 *   S04 Review → ChangeSet → approval → Release 2 through the normal governed screens (no bypass).
 *   S05 Release 2's STR page no longer lists Armor; Release 1's still does (exact-Release reads).
 *   S06 A new Character on Release 2 has Armor 0; the Release 1 Character's sheet and stored row are unchanged.
 *
 * Evidence is written to test-results/pre-m7-wo1-evidence.json.
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
  const file = path.join(process.cwd(), "test-results", "pre-m7-wo1-evidence.json");
  mkdirSync(path.dirname(file), { recursive: true });
  let sha = process.env.GITHUB_SHA ?? "unknown";
  try {
    sha = process.env.GITHUB_SHA ?? execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* not a checkout */
  }
  writeFileSync(file, `${JSON.stringify({ gate: "PRE-M7-WO1", spec: "tests/e2e/pre-m7-wo1-strength-armor.spec.ts", sha, runId, steps: rows, writtenAt: new Date().toISOString() }, null, 2)}\n`);
  if (prep !== undefined && runId !== "" && process.env.PROWESS_PM7_KEEP_WORLD !== "1") await prep.cleanupPlaytestWorlds(runId);
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

test("PRE-M7-WO1 Strength → Armor: edit the owning rule, preview, publish R2; R1 Characters unchanged", async ({ browser }) => {
  test.setTimeout(900_000);
  runId = `pm7sa${Date.now().toString(36)}`;
  const w = await prep.preparePlaytestWorld(runId);
  const base1 = `/compendium/rulesets/${w.rulesetId}/releases/${w.release1.id}`;
  const { page, close } = await fresh(browser);

  // ---- S01 — topics → Stats → STR → "What this affects" (read-only). ----
  {
    const writes = writesOf(page);
    await page.goto("/compendium");
    await page.getByRole("navigation", { name: "Compendium sections" }).getByRole("link", { name: "Rules Reference" }).click();
    await page.getByRole("link", { name: w.rulesetName }).click();
    await page.goto(base1);
    await page.getByTestId("reference-sections-link").click();
    await expect(page.getByRole("heading", { level: 1, name: "Browse by topic" })).toBeVisible();
    await page.getByTestId("section-card-stats").getByRole("link", { name: "Stats" }).click();
    await expect(page.getByTestId("compendium-section")).toHaveAttribute("data-section", "stats");
    await page.getByTestId("stat-link-STR").click();
    const armor = page.getByTestId("impact-STRENGTH_ARMOR");
    await expect(armor).toHaveAttribute("data-direct", "true");
    await expect(armor).toContainText("floor(str / 3)");
    expect(writes).toEqual([]);
    pass("S01", "Stats → STR → What this affects lists Armor from the Release's rules", { release: w.release1.id, impact: "STRENGTH_ARMOR", formula: "floor(str / 3)", writes: 0 });
  }

  // ---- S02 — a Character on Release 1. ----
  const c1 = await createCharacter(page, w, w.release1.id, `Strong Ren ${runId}`);
  const str1 = await number(page.getByTestId("sheet-stat-STR"));
  const armor1 = await number(page.getByTestId("sheet-core-armor"));
  expect(armor1).toBe(Math.floor(str1 / 3));
  expect(armor1).toBeGreaterThan(0);
  const c1Fingerprint = await prep.fingerprint(c1, w.rulesetId);
  const c1Row = await db.prisma.character.findUniqueOrThrow({ where: { id: c1 } });
  pass("S02", "A Release 1 Character's Armor = floor(STR / 3)", { characterId: c1, str: str1, armor: armor1 });

  // ---- S03 — edit the owning rule; save the Draft; side-effect-free preview. ----
  let revisionId = "";
  let armorEntityId = "";
  {
    await page.goto(`${base1}/stats/STR`);
    // The Rules Reference stays read-only: "Edit this rule" opens the OWNING rule in Compendium Admin, carrying the
    // Release, the Stat and the revision that Release pins; the Draft is created there, by an explicit action.
    await page.getByTestId("impact-edit-STRENGTH_ARMOR").click();
    await expect(page.getByTestId("ws-from-release")).toContainText("Stats → STR");
    await page.getByLabel("Change summary (why this revision exists)").fill("Strength no longer adds Armor.");
    await page.getByRole("button", { name: "Create New Revision from Revision 1" }).click();
    await page.waitForURL(/\/compendium\/admin\/entities\/[0-9a-f-]+\/revisions\/[0-9a-f-]+\?release=/);
    const u = new URL(page.url());
    revisionId = u.pathname.split("/").at(-1)!;
    armorEntityId = u.pathname.split("/").at(-3)!;
    await expect(page.getByRole("heading", { level: 1, name: /— Revision 2$/ })).toBeVisible();
    await expect(page.getByTestId("revision-return")).toHaveAttribute("href", `${base1}/stats/STR`);
    await expect(page.getByTestId("formula-expression")).toHaveText("floor(str / 3)");
    await page.getByRole("button", { name: "Remove contribution 1 (floor(str / 3))" }).click();
    await expect(page.getByTestId("formula-expression")).toHaveText("0");
    await page.getByLabel("Change type").selectOption({ label: "Mechanical Change" });
    // Unsaved edits are flagged by the preview (it evaluates the SAVED Draft only).
    await expect(page.getByTestId("rule-preview-unsaved")).toBeVisible();
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(page.getByText("Draft saved — validation PASS.")).toBeVisible();
    await expect(page.getByTestId("rule-preview-unsaved")).toHaveCount(0);
    const releasesBefore = await db.prisma.rulesetRelease.count({ where: { rulesetId: w.rulesetId } });
    const preview = page.getByTestId("rule-preview");
    await preview.getByTestId("rule-preview-run").click();
    await expect(preview.getByTestId("rule-preview-summary")).toContainText("Strength Armor");
    const row = preview.getByTestId("rule-preview-row-STRENGTH_ARMOR");
    await expect(row).toHaveAttribute("data-changed", "true");
    await expect(row).toContainText("1 → 0"); // the "STR 3" example
    expect(await db.prisma.rulesetRelease.count({ where: { rulesetId: w.rulesetId } })).toBe(releasesBefore);
    expect(await prep.fingerprint(c1, w.rulesetId)).toBe(c1Fingerprint);
    const saved = await db.prisma.entityVersion.findUniqueOrThrow({ where: { id: revisionId } });
    expect(saved.status).toBe("DRAFT");
    pass("S03", "Edit the owning rule, save the Draft (PASS), preview Armor 1 → 0 with no publication", { entityId: armorEntityId, revisionId, expressionAfter: "0", preview: "STR 3: 1 → 0", releasesUnchanged: releasesBefore });
  }

  // ---- S04 — governed publication of Release 2. ----
  let release2Id = "";
  {
    const proposal = `No Strength Armor ${runId}`;
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
    const review = page.getByTestId("revision-review");
    await expect(review).toHaveAttribute("data-version", revisionId);
    await confirm(page, "Approve revision r2");
    await confirm(page, "Submit for Review");
    await confirm(page, "Approve");
    await page.getByTestId("change-set-commands").getByRole("link", { name: "Releases" }).click();
    const form = page.getByRole("form", { name: "Publish Release" });
    await form.getByLabel("Base Manifest").selectOption(await optionContaining(form.getByLabel("Base Manifest"), w.release1.manifestId.slice(0, 8)));
    await form.getByLabel("Canon Policy").selectOption(await optionContaining(form.getByLabel("Canon Policy"), w.policyId.slice(0, 8)));
    await form.getByLabel("Approved ChangeSet (optional)").selectOption(changeSetId);
    await form.getByLabel("Version label").fill("R2");
    await form.getByLabel("Release notes").fill("Strength no longer adds Armor.");
    await form.getByRole("button", { name: "Publish Release" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
    await page.waitForURL(/\/releases\/[0-9a-f-]+$/);
    release2Id = page.url().split("/").at(-1)!;
    const r2 = await db.prisma.rulesetRelease.findUniqueOrThrow({ where: { id: release2Id } });
    expect(r2.releaseNumber).toBe(2);
    const pinned = await db.prisma.rulesetManifestEntry.findFirstOrThrow({ where: { manifestId: r2.manifestId, entityId: armorEntityId } });
    expect(pinned.entityVersionId).toBe(revisionId);
    pass("S04", "Review → ChangeSet → approval → Release 2 (governed)", { changeSetId, release2Id, pinned: revisionId });
  }

  // ---- S05 — exact-Release reads: R2's STR page lacks Armor; R1's still lists it. ----
  {
    const writes = writesOf(page);
    await page.goto(`/compendium/rulesets/${w.rulesetId}/releases/${release2Id}/stats/STR`);
    await expect(page.getByTestId("stat-affects")).toBeVisible();
    await expect(page.getByTestId("impact-STRENGTH_ARMOR")).toHaveCount(0);
    await page.goto(`${base1}/stats/STR`);
    await expect(page.getByTestId("impact-STRENGTH_ARMOR")).toBeVisible();
    expect(writes).toEqual([]);
    pass("S05", "Release 2 STR page no longer lists Armor; Release 1 still does", { release2: release2Id, release1: w.release1.id });
  }
  await close();

  // ---- S06 — a new Release 2 Character; the Release 1 Character is unchanged. ----
  {
    const s = await fresh(browser);
    const c2 = await createCharacter(s.page, w, release2Id, `Strong Ren R2 ${runId}`);
    const str2 = await number(s.page.getByTestId("sheet-stat-STR"));
    expect(str2).toBe(str1);
    await expect(s.page.getByTestId("sheet-core-armor")).toContainText("0");
    expect(await number(s.page.getByTestId("sheet-core-armor"))).toBe(0);
    await s.page.goto(`/characters/${c1}`);
    await expect(s.page.getByTestId("sheet-core-armor")).toBeVisible({ timeout: 60_000 });
    expect(await number(s.page.getByTestId("sheet-core-armor"))).toBe(armor1);
    const after = await db.prisma.character.findUniqueOrThrow({ where: { id: c1 } });
    expect(after.rulesetReleaseId).toBe(w.release1.id);
    expect(after.updatedAt.toISOString()).toBe(c1Row.updatedAt.toISOString());
    expect(characterRows(await prep.fingerprint(c1, w.rulesetId))).toBe(characterRows(c1Fingerprint));
    await s.close();
    pass("S06", "New R2 Character has Armor 0; the R1 Character's sheet and row are unchanged", { r2Character: c2, r2Armor: 0, r1Character: c1, r1Armor: armor1, r1FingerprintUnchanged: true });
  }
});
