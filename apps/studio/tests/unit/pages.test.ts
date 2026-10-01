import { describe, expect, it } from "vitest";
import DashboardPage from "../../app/page";
import CompendiumPage from "../../app/compendium/page";
import DeveloperPage from "../../app/developer/page";

/**
 * Lightweight module-level sanity check that the three M0-WO1 route modules
 * import cleanly and export a component. The full application boot
 * (dev server start + route rendering) is verified by the Playwright e2e
 * suite in tests/e2e/boot.spec.ts, which is the authoritative check for the
 * M0-WO1 "development server starts" / "routes render" acceptance criteria.
 */
describe("M0-WO1 route modules", () => {
  it("Dashboard page module exports a component", () => {
    expect(typeof DashboardPage).toBe("function");
  });

  it("Compendium page module exports a component", () => {
    expect(typeof CompendiumPage).toBe("function");
  });

  it("Developer page module exports a component", () => {
    expect(typeof DeveloperPage).toBe("function");
  });
});
