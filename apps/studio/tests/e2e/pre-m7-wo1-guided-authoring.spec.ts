import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect as baseExpect, test, type Page } from "@playwright/test";

/**
 * PRE-M7-WO1 C04–C05 — guided authoring through the Studio UI against the production build and PostgreSQL. Fixture
 * content is test-only (`test.e2e_pm7.*`) and stays a Draft: nothing is published and no owner content is touched.
 *
 *   G01 A Mage Art is authored with guided controls (costs, maintenance, Active Effect window, a mode, source), validates
 *       PASS against the server's M5 contract, and is saved as a Draft that reopens with every value intact.
 *   G02 A reusable Spell Definition is started; "Create a new effect" opens New Definition with the kind preset, the new
 *       Effect is created as its own Draft, and the Studio returns to the Spell with its unsaved name kept and the new
 *       Effect's EXACT revision in the Effects slot. Nothing is saved automatically.
 */
const expect = baseExpect.configure({ timeout: 30_000 });
const SHOTS = path.join(process.cwd(), "test-results", "pre-m7-wo1-guided");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

async function startNew(page: Page, family: string, kind: string, name: string, key: string) {
  await page.goto("/compendium/admin/new");
  await expect(page.getByRole("heading", { level: 1, name: "New Definition" })).toBeVisible();
  await page.getByLabel("Definition family").selectOption(family);
  await page.getByLabel("Definition kind").selectOption(kind);
  await page.getByLabel("Display Name (required)").fill(name);
  await page.getByLabel("Canonical Key (required)").fill(key);
}

test("G01 a Mage Art is authored with guided controls, validates PASS and reopens intact", async ({ page }) => {
  const tag = `${Date.now()}`;
  await startNew(page, "MAGE_ART", "MAGE_ART", `Barrier E2E ${tag}`, `test.e2e_pm7.mage_art_${tag}`);
  await page.getByLabel("Short description").fill("A protective field (E2E fixture; reference only).");

  await page.getByLabel("Art key (required)").fill("BARRIER_E2E");
  const activation = page.getByRole("group", { name: /Activation cost/ });
  await activation.getByLabel("AP amount (required)").fill("1");
  await activation.getByLabel("MP amount (required)").fill("2");
  const maintenance = page.getByRole("group", { name: /Maintenance \(each turn\)/ });
  await maintenance.getByLabel("AP amount (required)").fill("0");
  await maintenance.getByLabel("MP amount (required)").fill("1");
  await page.getByRole("group", { name: /Counts as an Active Effect/ }).getByRole("combobox").selectOption({ index: 1 });

  await page.getByRole("button", { name: "Add mode" }).click();
  const mode = page.getByTestId("guided-list-item").first();
  await mode.getByLabel("Mode key (required)").fill("WARD");
  await mode.getByLabel("Name (required)").fill("Ward");
  await mode.getByLabel("Rules text (required)").fill("Uses the Art's own costs (E2E fixture).");
  // RULES-WO1: sections are normally chosen by title; the section keys are under "Section keys (advanced)".
  await page.getByText("Section keys (advanced)").click();
  await page.getByLabel(/Source sections/).fill("s1905, s1914");

  await page.getByRole("button", { name: "Validate Definition" }).click();
  const validation = page.getByRole("region", { name: "Validation" });
  await expect(validation.getByRole("status")).toContainText("PASS");
  await shot(page, "g01-mage-art-new");

  await page.getByRole("button", { name: "Create Definition as Draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Barrier E2E ${tag} — Revision 1` })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Art key (required)")).toHaveValue("BARRIER_E2E");
  await expect(page.getByRole("group", { name: /Activation cost/ }).getByLabel("MP amount (required)")).toHaveValue("2");
  await expect(page.getByTestId("guided-list-item").first().getByLabel("Mode key (required)")).toHaveValue("WARD");
  await expect(page.getByTestId("version-status-badge").first()).toHaveText("Draft");
  await shot(page, "g01-mage-art-draft");
});

test("G02 a reusable Spell creates a missing Effect as its own Draft and returns with the exact revision", async ({ page }) => {
  const tag = `${Date.now()}`;
  const spellName = `Gust E2E ${tag}`;
  await startNew(page, "SPELL", "SPELL_DEFINITION", spellName, `test.e2e_pm7.spell_${tag}`);
  await page.getByRole("button", { name: "Create Definition as Draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${spellName} — Revision 1` })).toBeVisible();
  const parentUrl = page.url();

  // Unsaved work on the parent, then create the missing component.
  await page.getByTestId("ability-description").fill("Unsaved description kept across the round trip.");
  await page.getByTestId("ability-create-effects").click();
  await expect(page.getByRole("heading", { level: 1, name: "New Definition" })).toBeVisible();
  await expect(page.getByLabel("Definition kind")).toHaveValue("SPELL_EFFECT");
  await expect(page.getByTestId("new-definition-child")).toBeVisible();
  await shot(page, "g02-child-new");

  await page.getByLabel("Display Name (required)").fill(`Gust Push E2E ${tag}`);
  await page.getByLabel("Canonical Key (required)").fill(`test.e2e_pm7.gust_push_${tag}`);
  await page.getByTestId("effect-family").selectOption({ label: "Utility" }); // RULES-WO1 Phase F guided Effect editor
  await page.getByRole("button", { name: "Create Definition as Draft" }).click();

  // Back on the parent: the unsaved description is restored and the new Effect fills the slot by exact revision.
  await expect(page).toHaveURL(new RegExp(`^${parentUrl.split("?")[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await expect(page.getByTestId("ability-description")).toHaveValue("Unsaved description kept across the round trip.");
  const effects = page.getByTestId("ability-slot-effects");
  await expect(effects).toContainText(`test.e2e_pm7.gust_push_${tag}`);
  await expect(page.locator(".prowess-authoring__save-state")).toHaveText("Unsaved changes");
  await shot(page, "g02-spell-returned");
});
