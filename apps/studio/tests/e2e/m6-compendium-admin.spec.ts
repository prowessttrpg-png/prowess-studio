import { expect, test } from "@playwright/test";

/**
 * PAS-10 M6-WO1 §85 — UX acceptance: a designer uses Prowess Studio itself (no database or developer tooling) to open
 * Compendium Admin, choose New Definition and a Definition kind, enter identity and structured content, receive
 * validation feedback, save a Draft, edit and save it again, create a new revision, view Version History and return to
 * the standard Compendium browser. Fixture content is test-only (`test.e2e_m6.*`) and never game canon.
 */
test("a designer authors, validates, edits and revises a Definition entirely through Compendium Admin", async ({ page }) => {
  const tag = `${Date.now()}`;
  const displayName = `Force Push E2E ${tag}`;
  const canonicalKey = `test.e2e_m6.force_push_${tag}`;

  // Open Compendium Admin from the standard Compendium.
  await page.goto("/compendium");
  await page.getByRole("link", { name: /Compendium Admin/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compendium Admin" })).toBeVisible();

  // New Definition → kind → identity → structured content.
  await page.getByRole("link", { name: "New Definition" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New Definition" })).toBeVisible();
  await page.getByLabel("Definition family").selectOption("SPELL");
  await page.getByLabel("Definition kind").selectOption("SPELL_EFFECT");
  await expect(page.getByText(/Stored as Entity Type/)).toContainText("SPELL_EFFECT");
  await page.getByLabel("Display Name (required)").fill(displayName);
  await page.getByLabel("Canonical Key (required)").fill(canonicalKey);
  await page.getByLabel("Short description").fill("Pushes a creature away (E2E fixture).");

  // Validation feedback before anything is saved: an incomplete Definition fails with a usable path.
  await page.getByRole("button", { name: "Validate Definition" }).click();
  const validation = page.getByRole("region", { name: "Validation" });
  await expect(validation.getByRole("status")).toContainText("FAIL");
  await expect(validation).toContainText("payload.effectFamily");

  await page.getByLabel("Effect family (required)").fill("MOVEMENT");
  await page.getByLabel("This Effect has its own resolution").check();
  await page.getByLabel("Resolution mode").selectOption("SAVING_THROW");
  await page.getByRole("button", { name: "Add outcome" }).click();
  await page.getByLabel("Outcome key").fill("push");
  await page.getByRole("button", { name: "Validate Definition" }).click();
  await expect(validation.getByRole("status")).toContainText("PASS — SPELL_EFFECT satisfies its M5 structural contract.");

  // Save Draft (Revision 1) and land in its workspace.
  await page.getByRole("button", { name: "Create Definition as Draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${displayName} — Revision 1` })).toBeVisible();
  await expect(page.getByText("Definition created as Revision 1 (DRAFT).")).toBeVisible();
  await expect(page.getByTestId("version-status-badge").first()).toHaveText("Draft");

  // Edit the Draft: unsaved state, validation feedback for a bad token, then a clean save.
  await page.getByLabel(/^Display Name/).fill(`${displayName} (edited)`);
  await expect(page.locator(".prowess-authoring__save-state")).toHaveText("Unsaved changes");
  await page.getByLabel("Effect family (required)").fill("movement");
  await page.getByRole("button", { name: "Validate Definition" }).click();
  await expect(page.getByRole("region", { name: "Validation" }).getByRole("status")).toContainText("FAIL");
  await expect(page.getByLabel("Effect family (required)")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Effect family (required)").fill("MOVEMENT");
  await page.getByLabel(/^Change summary/).fill("Edited in Compendium Admin.");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Draft saved — validation PASS.")).toBeVisible();
  await expect(page.locator(".prowess-authoring__save-state")).toHaveText("Saved Draft");

  // Create a new revision from the Entity page.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: canonicalKey }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Revisions and history" })).toBeVisible();
  await page.getByLabel("Change summary (why this revision exists)").fill("Second pass.");
  await page.getByRole("button", { name: "Create New Revision from Revision 1" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${displayName} (edited) — Revision 2` })).toBeVisible();
  await expect(page.locator(".prowess-authoring__save-state")).toHaveText("Saved Draft");

  // Version History (the existing Compendium history), then back to standard browsing.
  await page.getByRole("link", { name: "View in Version History" }).click();
  await expect(page).toHaveURL(/\/compendium\/entities\/[0-9a-f-]+\?revision=2/);
  await expect(page.getByText(/Revision 1/).first()).toBeVisible();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Compendium" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compendium" })).toBeVisible();
  await page.getByLabel(/search/i).first().fill(displayName);
  await expect(page.getByTestId("entity-row").filter({ hasText: canonicalKey })).toBeVisible();
});
