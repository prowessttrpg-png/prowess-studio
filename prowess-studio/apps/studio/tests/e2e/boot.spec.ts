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

test.describe("M0-WO5 Studio Application Shell", () => {
  test("all eight primary navigation entries are present", async ({ page }) => {
    await page.goto("/");
    for (const id of [
      "dashboard",
      "compendium",
      "studio",
      "characters",
      "world",
      "gm",
      "publishing",
      "developer",
    ]) {
      await expect(page.getByTestId(`nav-link-${id}`)).toBeVisible();
    }
  });

  test("placeholder routes render through the same shared shell", async ({ page }) => {
    for (const [path, heading] of [
      ["/studio", "Studio"],
      ["/characters", "Characters"],
      ["/world", "World"],
      ["/gm", "GM"],
      ["/publishing", "Publishing"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId("prowess-brand")).toHaveText("PROWESS STUDIO");
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("top bar placeholders for Search, Ruleset, Create, and Account are present", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("topbar-search")).toBeVisible();
    await expect(page.getByTestId("topbar-ruleset")).toBeVisible();
    await expect(page.getByTestId("topbar-create")).toBeVisible();
    await expect(page.getByTestId("topbar-account")).toBeVisible();
  });

  test("clicking a nav link navigates and updates the active section — proving shared shell navigation works", async ({
    page,
  }) => {
    await page.goto("/");
    const dashboardLink = page.getByRole("link", { name: "Dashboard" });
    const compendiumLink = page.getByRole("link", { name: "Compendium" });
    await expect(dashboardLink).toHaveAttribute("aria-current", "page");

    await compendiumLink.click();
    await expect(page).toHaveURL(/\/compendium$/);
    await expect(page.getByRole("heading", { name: "Compendium" })).toBeVisible();
    await expect(compendiumLink).toHaveAttribute("aria-current", "page");
    await expect(dashboardLink).not.toHaveAttribute("aria-current", "page");
  });

  test("mobile viewport: the nav drawer is closed by default, and opens via an accessible toggle", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const toggle = page.getByRole("button", { name: /navigation menu/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Closed by default: primary nav links aren't visible at this width.
    await expect(page.getByRole("link", { name: "Compendium" })).not.toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "Compendium" })).toBeVisible();

    // Selecting a link closes the drawer again (mobile UX).
    await page.getByRole("link", { name: "Compendium" }).click();
    await expect(page).toHaveURL(/\/compendium$/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("desktop viewport: primary navigation is always visible without needing the toggle", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Compendium" })).toBeVisible();
  });
});
