import { expect, test } from "@playwright/test";

test.describe("M0-WO1 application boot", () => {
  test("root route renders the shell and Dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("prowess-brand")).toHaveText("PROWESS STUDIO");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("compendium route renders", async ({ page }) => {
    await page.goto("/compendium");
    await expect(page.getByRole("heading", { name: "Compendium" })).toBeVisible();
  });

  test("developer route renders", async ({ page }) => {
    await page.goto("/developer");
    await expect(page.getByRole("heading", { name: "Developer" })).toBeVisible();
  });

  test("primary navigation links to all three routes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-link-dashboard")).toBeVisible();
    await expect(page.getByTestId("nav-link-compendium")).toBeVisible();
    await expect(page.getByTestId("nav-link-developer")).toBeVisible();
  });
});
