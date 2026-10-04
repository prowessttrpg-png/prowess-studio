import { describe, expect, it } from "vitest";
import DashboardPage from "../../app/page";
import CompendiumPage from "../../app/compendium/page";
import StudioPage from "../../app/studio/page";
import CharactersPage from "../../app/characters/page";
import WorldPage from "../../app/world/page";
import GmPage from "../../app/gm/page";
import PublishingPage from "../../app/publishing/page";
import DeveloperPage from "../../app/developer/page";

/**
 * Lightweight module-level sanity check that every primary-nav route
 * module imports cleanly and exports a component. The full application
 * boot (dev/production server start + actual rendering) is verified by
 * the Playwright e2e suite in tests/e2e/boot.spec.ts.
 */
describe("Primary navigation route modules", () => {
  it.each([
    ["Dashboard", DashboardPage],
    ["Compendium", CompendiumPage],
    ["Studio", StudioPage],
    ["Characters", CharactersPage],
    ["World", WorldPage],
    ["GM", GmPage],
    ["Publishing", PublishingPage],
    ["Developer", DeveloperPage],
  ])("%s page module exports a component", (_label, PageComponent) => {
    expect(typeof PageComponent).toBe("function");
  });
});
