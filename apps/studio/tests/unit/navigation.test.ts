import { describe, expect, it } from "vitest";
import { isNavEntryActive, PRIMARY_NAVIGATION } from "../../src/navigation";

const EXPECTED_ENTRIES: Array<{ id: string; label: string; href: string }> = [
  { id: "dashboard", label: "Dashboard", href: "/" },
  { id: "compendium", label: "Compendium", href: "/compendium" },
  { id: "studio", label: "Studio", href: "/studio" },
  { id: "characters", label: "Characters", href: "/characters" },
  { id: "world", label: "World", href: "/world" },
  { id: "gm", label: "GM", href: "/gm" },
  { id: "publishing", label: "Publishing", href: "/publishing" },
  { id: "developer", label: "Developer", href: "/developer" },
];

describe("PRIMARY_NAVIGATION", () => {
  it("contains exactly the eight required primary entries, in order", () => {
    expect(PRIMARY_NAVIGATION.map(({ id, label, href }) => ({ id, label, href }))).toEqual(
      EXPECTED_ENTRIES,
    );
  });

  it("marks Dashboard, Compendium, and Developer as functional (not placeholders)", () => {
    for (const id of ["dashboard", "compendium", "developer"]) {
      const entry = PRIMARY_NAVIGATION.find((e) => e.id === id);
      expect(entry?.placeholder).toBeFalsy();
    }
  });

  it("marks Studio, Characters, World, GM, and Publishing as placeholders", () => {
    for (const id of ["studio", "characters", "world", "gm", "publishing"]) {
      const entry = PRIMARY_NAVIGATION.find((e) => e.id === id);
      expect(entry?.placeholder).toBe(true);
    }
  });

  it("records future nested subsections for Studio and Developer without rendering them yet", () => {
    const studio = PRIMARY_NAVIGATION.find((e) => e.id === "studio");
    expect(studio?.children?.map((c) => c.label)).toEqual([
      "Spells",
      "Maneuvers",
      "Equipment",
      "Summons",
      "Cards",
    ]);

    const developer = PRIMARY_NAVIGATION.find((e) => e.id === "developer");
    // M2-WO10: Rulesets added; Canon Manager now points into the same Ruleset workspace (one UI, two labels).
    expect(developer?.children?.find((c) => c.label === "Canon Manager")?.href).toBe("/developer/rulesets");
    expect(developer?.children?.map((c) => c.label)).toEqual([
      "Rulesets",
      "Rules Inspector",
      "Canon Manager",
      "Sources",
      "Tests",
    ]);
  });
});

describe("isNavEntryActive", () => {
  const dashboard = PRIMARY_NAVIGATION.find((e) => e.id === "dashboard")!;
  const compendium = PRIMARY_NAVIGATION.find((e) => e.id === "compendium")!;

  it("matches the Dashboard entry only at the exact root path", () => {
    expect(isNavEntryActive(dashboard, "/")).toBe(true);
    expect(isNavEntryActive(dashboard, "/compendium")).toBe(false);
  });

  it("matches a non-root entry at its own path and at sub-paths", () => {
    expect(isNavEntryActive(compendium, "/compendium")).toBe(true);
    expect(isNavEntryActive(compendium, "/compendium/spells/fireball")).toBe(true);
    expect(isNavEntryActive(compendium, "/studio")).toBe(false);
  });

  it("does not treat a different route that merely shares a prefix as active", () => {
    // "/compendiumfoo" is not a sub-path of "/compendium" — guards against
    // a naive startsWith() without the trailing slash.
    expect(isNavEntryActive(compendium, "/compendiumfoo")).toBe(false);
  });
});
