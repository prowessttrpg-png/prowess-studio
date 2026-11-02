import { describe, expect, it } from "vitest";
import world from "./testing/m6-wo7-spell-world.json";
import { signatureSpellWorldContent } from "./testing/signature-spell-fixtures.js";

/**
 * PAS-10 M6-WO7: the serialized Signature Spell test world (read by the DB / API / Playwright suites) is exactly the
 * fixture's content (M6-I078: exact components). Regenerate: write `signatureSpellWorldContent()` as 2-space JSON.
 */
describe("M6-WO7 test-world content", () => {
  it("m6-wo7-spell-world.json equals the generated fixture content", { timeout: 60_000 }, () => {
    expect(world).toEqual(JSON.parse(JSON.stringify(signatureSpellWorldContent())));
  });
});
