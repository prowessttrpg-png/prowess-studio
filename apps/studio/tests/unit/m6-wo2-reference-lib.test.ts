import { describe, expect, it } from "vitest";
import { CONTRACT_DESCRIPTORS, descriptorFor, presentationDescriptorFor } from "../../app/compendium/admin/_lib/descriptors";
import {
  comparisonHref,
  entryHref,
  isToken,
  libraryComparisonHref,
  readableKey,
  readableToken,
  releaseHref,
  releaseName,
} from "../../app/compendium/rulesets/_lib/reference-urls";
import { CATALOG } from "./m6-wo1-fixtures";

/**
 * PAS-10 M6-WO2 — Rules Reference presentation helpers (M6-I015, M6-I019). Presentation descriptors are the WO1
 * descriptors (one description per M5 shared contract, no second catalog); every Rules Reference URL carries the exact
 * Ruleset and Release.
 */
describe("M6-WO2 presentation descriptors (M6-I015)", () => {
  it("every Ability-component kind presents through its shared-contract descriptor — the SAME object the editor uses", () => {
    const components = CATALOG.kinds.filter((k) => k.sharedContract !== null);
    expect(components.length).toBeGreaterThanOrEqual(11);
    for (const k of components) {
      for (const v of k.supportedSchemaVersions) {
        const d = presentationDescriptorFor(k, v);
        expect(d, `${k.definitionKind} v${v}`).toBe(CONTRACT_DESCRIPTORS[k.sharedContract as string]);
        expect(d).toBe(descriptorFor(k, v));
      }
    }
  });

  it("Affinity has dedicated presentation for every supported version; kinds without a descriptor present generically", () => {
    const affinity = CATALOG.kinds.find((k) => k.definitionKind === "AFFINITY")!;
    for (const v of affinity.supportedSchemaVersions) expect(presentationDescriptorFor(affinity, v), `AFFINITY v${v}`).not.toBeNull();
    const generic = CATALOG.kinds.filter((k) => k.sharedContract === null && k.definitionKind !== "AFFINITY" && k.supportedSchemaVersions.length > 0);
    expect(generic.length).toBeGreaterThan(0);
    for (const k of generic) expect(presentationDescriptorFor(k, k.supportedSchemaVersions[0]!), k.definitionKind).toBeNull();
  });

  it("an unsupported or missing schema version is never given a dedicated presenter (historical content is not migrated on view)", () => {
    for (const k of CATALOG.kinds) {
      expect(presentationDescriptorFor(k, 999), k.definitionKind).toBeNull();
      expect(presentationDescriptorFor(k, null), k.definitionKind).toBeNull();
    }
  });
});

describe("M6-WO2 Rules Reference URLs and labels (M6-I019)", () => {
  it("every reference URL names the exact Ruleset and Release", () => {
    expect(releaseHref("r s", "rel/1")).toBe("/compendium/rulesets/r%20s/releases/rel%2F1");
    expect(entryHref("rs", "rel", "e1")).toBe("/compendium/rulesets/rs/releases/rel/entities/e1");
    expect(comparisonHref("rs", "a", "b")).toBe("/compendium/rulesets/rs/releases/a/compare/b");
    expect(libraryComparisonHref("e1", 1, 3)).toBe("/compendium/entities/e1?compareA=1&compareB=3");
  });

  it("names Releases by number and label; tokens read as words while the token itself is kept", () => {
    expect(releaseName({ releaseNumber: 4, versionLabel: "0.4.0" })).toBe("Release 4 — 0.4.0");
    expect([isToken("SAVING_THROW"), isToken("MP"), isToken("Force Push"), isToken("push")]).toEqual([true, true, false, false]);
    expect(readableToken("SAVING_THROW")).toBe("Saving Throw");
    expect(readableKey("costContributions")).toBe("Cost contributions");
  });
});
