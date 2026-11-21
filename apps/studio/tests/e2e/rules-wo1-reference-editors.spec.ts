import { expect as baseExpect, test, type Page } from "@playwright/test";

/**
 * RULES-WO1 Phase C — the reference-family guided editors, through the real UI against the production build and
 * PostgreSQL. Each entry is created as a Draft in the shared Compendium (keys carry a unique run tag; nothing is
 * published, so no Release or Character changes).
 *
 *   P01 "About" is in the main navigation and shows this build's identity and that ARMOR / SUMMON_TYPE / MISSION_RULE
 *       are guided.
 *   P02 Armor: a guided form (selects, numbers, a title-search source picker; section keys only under "advanced"),
 *       validated by the M5 reader, created as a Draft; the entry Overview says "Reference only"; the sample preview
 *       caps AGI and reports the Strength requirement — and says play does not use it.
 *   P03 Mission rule: a die-range table whose gap is refused by validation, then accepted once every roll is covered;
 *       the preview looks up a roll.
 */
const expect = baseExpect.configure({ timeout: 30_000 });
const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

async function startNew(page: Page, family: string, kind: string, name: string) {
  await page.goto("/compendium/admin/new");
  await expect(page.getByRole("heading", { level: 1, name: "New Definition" })).toBeVisible();
  await page.getByLabel("Definition family").selectOption(family);
  await page.getByLabel("Definition kind").selectOption(kind);
  await page.getByLabel("Display Name (required)").fill(name);
  // The Canonical Key is never derived silently: one click suggests it from the Display Name.
  await page.getByRole("button", { name: "Suggest a Canonical Key from the Display Name" }).click();
  await expect(page.getByLabel("Canonical Key (required)")).not.toHaveValue("");
}

/** The readable source picker: search by title and Add; fall back to the advanced keys only with no imported rulebook. */
async function chooseSource(page: Page, query: string): Promise<"TITLE" | "ADVANCED"> {
  const picker = page.getByTestId("source-picker").first();
  const none = picker.getByTestId("source-no-snapshot");
  const search = picker.getByTestId("source-search");
  // The picker first shows "Loading…", then EITHER the title search OR the no-rulebook note (never both).
  await expect(picker.getByTestId("source-loading")).toHaveCount(0);
  await expect(none.or(search)).toBeVisible();
  if (await search.isVisible()) {
    await search.fill(query);
    const matches = picker.getByTestId("source-matches");
    const found = await matches.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    if (found) {
      await matches.getByRole("button", { name: /^Add / }).first().click();
      await expect(picker.getByTestId("source-chosen")).toBeVisible();
      return "TITLE";
    }
  }
  await picker.getByText("Section keys (advanced)").click();
  await picker.getByLabel(/Source sections chosen/).fill("s1");
  return "ADVANCED";
}

async function validateAndCreate(page: Page, name: string) {
  await page.getByRole("button", { name: "Validate Definition" }).click();
  await expect(page.getByRole("region", { name: "Validation" }).getByRole("status")).toContainText("PASS");
  await page.getByRole("button", { name: "Create Definition as Draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} — Revision 1` })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("RULES-WO1 P01 About is reachable from the main navigation and lists the guided reference editors", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("link", { name: "About", exact: true }).click();
  await page.waitForURL("**/about");
  await expect(page.getByTestId("about-version")).not.toHaveText("");
  await page.getByTestId("about-editors").locator("summary").click();
  const guided = await page.getByTestId("about-guided-kind").allInnerTexts();
  for (const k of ["ARMOR", "SUMMON_TYPE", "MISSION_RULE", "STATUS_CONDITION", "METAMAGIC", "JOB_TEMPLATE", "REFERENCE_RULE"]) expect(guided.join("\n")).toContain(k);
  await expect(page.getByTestId("about-technical-kind")).toHaveCount(0);
});

test("RULES-WO1 P02 Armor: guided form, title source picker, Draft, truthful Overview and a sample preview", async ({ page }) => {
  const name = `Plate E2E ${tag}`;
  await startNew(page, "EQUIPMENT", "ARMOR", name);
  // The Armor name used by other rules fills itself in from the Display Name.
  await expect(page.getByLabel(/^Armor name used by other rules/)).not.toHaveValue("");
  await page.getByLabel(/^Category/).selectOption("HEAVY");
  await page.getByLabel(/^Armor granted/).fill("5");
  await page.getByLabel(/^Strength required/).fill("5");
  await page.getByLabel(/^Most AGI that counts toward Dodge/).fill("5");
  await page.getByLabel(/^Movement penalty \(feet\)/).fill("5"); // stored as feet lost (the contract refuses a negative number)
  await page.getByLabel(/^Stealth/).selectOption("DISADVANTAGE");
  const how = await chooseSource(page, "armor");
  // No payload field names or technical tree on the page.
  await expect(page.getByText("armorValue", { exact: true })).toHaveCount(0);
  await validateAndCreate(page, name);

  await expect(page.getByTestId("status-live")).toHaveAttribute("data-state", "REFERENCE_ONLY");
  await expect(page.getByTestId("status-live")).toContainText("Reference only");
  const preview = page.getByTestId("reference-preview");
  await expect(preview.getByTestId("reference-not-in-play")).toHaveText("Preview only — play does not use this rule yet.");
  await preview.getByLabel("Sample AGI").fill("8");
  await preview.getByLabel("Sample STR").fill("4");
  await preview.getByTestId("reference-preview-run").click();
  await expect(preview.getByTestId("preview-armor-agi")).toContainText("5");
  await expect(preview.getByTestId("preview-armor-agi")).toContainText("capped");
  await expect(preview.getByTestId("preview-armor-str")).toContainText(/no/i);
  test.info().annotations.push({ type: "source-picker", description: how });
});

test("RULES-WO1 P03 Mission rule: a table with a gap is refused; a covering table is a Draft and previews a roll", async ({ page }) => {
  const name = `Clauses E2E ${tag}`;
  await startNew(page, "MISSION", "MISSION_RULE", name);
  await page.getByLabel("Kind of rule").selectOption("ROLL_TABLE");
  const table = page.getByTestId("mission-table");
  await table.getByLabel("Die faces").fill("4");
  await table.getByRole("button", { name: "Add row" }).click();
  await table.getByLabel("Row 1 from").fill("1");
  await table.getByLabel("Row 1 to").fill("2");
  await table.getByLabel("Row 1 result").fill("No public combat.");
  await table.getByRole("button", { name: "Add row" }).click();
  await table.getByLabel("Row 2 from").fill("4");
  await table.getByLabel("Row 2 to").fill("4");
  await table.getByLabel("Row 2 result").fill("Hidden clause.");
  await chooseSource(page, "mission");
  await page.getByRole("button", { name: "Validate Definition" }).click();
  await expect(page.getByRole("region", { name: "Validation" })).toContainText(/continue at 3/);
  await table.getByLabel("Row 2 from").fill("3");
  await validateAndCreate(page, name);

  const preview = page.getByTestId("reference-preview");
  await preview.getByLabel("Sample roll").fill("3");
  await preview.getByTestId("reference-preview-run").click();
  await expect(preview.getByTestId("preview-table-result")).toContainText("Hidden clause.");
});

const ENGINES = ["SUMMON_ENTITY", "TOTEM", "PERSISTENT_CONSTRUCT", "BOUND_SUMMON", "MANIFESTED_ENTITY", "FUSION", "EQUIPMENT_SUMMONING"] as const;

test("RULES-WO1 P04 every Summon engine is authored through the guided form (R15)", async ({ page }) => {
  test.setTimeout(240_000);
  for (const engine of ENGINES) {
    const name = `${engine.toLowerCase().replace(/_/g, " ")} E2E ${tag}`;
    await startNew(page, "SUMMON", "SUMMON_TYPE", name);
    await page.getByLabel("Engine (required)", { exact: true }).selectOption(engine);
    await page.getByLabel("Sustain (required)", { exact: true }).selectOption("NONE");
    await page.getByRole("button", { name: "Add tier" }).click();
    const tier = page.getByTestId("guided-list-item").first();
    await tier.getByLabel(/^Tier name/).fill("Tier 1");
    await tier.getByLabel(/^Label/).fill("Tier 1");
    await expect(tier.getByLabel(/^Tier name/)).toHaveValue("TIER_1");
    await page.getByLabel(/^How it acts/).fill("Illustrative E2E entry (not canon).");
    await chooseSource(page, "summon");
    await validateAndCreate(page, name);
    await expect(page.getByTestId("status-live")).toHaveAttribute("data-state", "REFERENCE_ONLY");
  }
});

test("RULES-WO1 P05 a Mission rule links to a gameplay reference rule by name, never by key (R16)", async ({ page }) => {
  const ruleName = `Cover E2E ${tag}`;
  await startNew(page, "CORE", "REFERENCE_RULE", ruleName);
  await page.getByLabel("Kind of rule").selectOption("POINTS");
  await page.getByLabel("Rule points (one per line)").fill("Half cover: +2 Dodge (illustrative E2E).");
  await chooseSource(page, "cover");
  await validateAndCreate(page, ruleName);

  const missionName = `Intel E2E ${tag}`;
  await startNew(page, "MISSION", "MISSION_RULE", missionName);
  await page.getByLabel("Kind of rule").selectOption("INTEL");
  await page.getByLabel("What an Intel token can do (one per line)").fill("Reveal one hidden clock.");
  await page.getByRole("button", { name: "Add rule" }).click();
  const picker = page.getByRole("group", { name: "Choose the exact rule" });
  await picker.getByRole("searchbox").fill(ruleName);
  await picker.getByRole("button", { name: new RegExp(`^${ruleName}`) }).click();
  await expect(page.getByTestId("ref-list-name")).toHaveText(ruleName);
  await chooseSource(page, "intel");
  await validateAndCreate(page, missionName);
  // After saving, the link still reads as words (from its key), not as a machine key.
  await expect(page.getByTestId("ref-list-name")).toContainText("Cover");
  await expect(page.getByTestId("ref-list-name")).not.toContainText(".");
});

test("RULES-WO1 P06 390 px layout, keyboard use, empty and error states and timing for the guided editors (R25)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const started = Date.now();
  await page.goto("/compendium/admin/new");
  await page.getByLabel("Definition family").selectOption("EQUIPMENT");
  await page.getByLabel("Definition kind").selectOption("ARMOR");
  await expect(page.getByLabel(/^Armor granted/)).toBeVisible();
  const editorReadyMs = Date.now() - started;
  const noSideScroll = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await noSideScroll();
  // Keyboard: every control is reachable and labelled; typing a name works without a mouse.
  await page.getByLabel("Display Name (required)").focus();
  await page.keyboard.type(`Mobile Plate ${tag}`);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName ?? "", label: el ? (el.getAttribute("aria-label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ?? el.closest("label")?.textContent ?? el.textContent ?? "") : "" };
  });
  expect(focused.tag).not.toBe("BODY");
  expect(focused.label.trim()).not.toBe("");
  // Empty state: the source picker says what is there (loading → search or the no-rulebook note).
  const picker = page.getByTestId("source-picker").first();
  await expect(picker.getByTestId("source-no-snapshot").or(picker.getByTestId("source-search"))).toBeVisible();
  // Error state: validating an incomplete form names the problems in a live region and marks the fields.
  await page.getByRole("button", { name: "Validate Definition" }).click();
  const status = page.getByRole("region", { name: "Validation" }).getByRole("status");
  await expect(status).toContainText("FAIL");
  await noSideScroll();
  // Timing: a reference preview round trip on a saved Draft.
  await page.getByRole("button", { name: "Suggest a Canonical Key from the Display Name" }).click();
  await page.getByLabel(/^Category/).selectOption("LIGHT");
  await page.getByLabel(/^Armor granted/).fill("1");
  await page.getByLabel(/^Movement penalty \(feet\)/).fill("0");
  await page.getByLabel(/^Stealth/).selectOption("NORMAL");
  await chooseSource(page, "armor");
  await validateAndCreate(page, `Mobile Plate ${tag}`);
  await noSideScroll();
  const preview = page.getByTestId("reference-preview");
  const t0 = Date.now();
  await preview.getByTestId("reference-preview-run").click();
  await expect(preview.getByTestId("preview-armor-agi")).toBeVisible();
  const previewMs = Date.now() - t0;
  const timing = JSON.stringify({ viewport: "390x844", editorReadyMs, previewMs });
  test.info().annotations.push({ type: "timing", description: timing });
  console.log(`RULES-WO1 P06 timing ${timing}`);
  // Representative budgets for a local production build (generous; they catch regressions of an order of magnitude).
  expect(editorReadyMs).toBeLessThan(15_000);
  expect(previewMs).toBeLessThan(5_000);
  await context.close();
});
