import { expect, it } from "vitest";
import { signatureManeuverWorldContent } from "./testing/signature-maneuver-fixtures.js";
import world from "./testing/m6-wo8-maneuver-world.json";
/** The serialized isolated test Release must equal its source. Regenerate as 2-space JSON outside this pure package. */
it("keeps the DB/API/E2E test Release equal to exact domain fixture content", { timeout: 60_000 }, () => {
  expect(world).toEqual(JSON.parse(JSON.stringify(signatureManeuverWorldContent())));
});
