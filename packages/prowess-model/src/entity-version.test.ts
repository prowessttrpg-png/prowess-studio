import { describe, expect, it } from "vitest";
import { isValidDisplayName } from "./entity-version.js";
import { EntityVersionId } from "./ids.js";

describe("isValidDisplayName", () => {
  it.each(["Test Rule", "Direct Damage", "a", "  padded but non-empty  "])(
    "accepts %j",
    (value) => {
      expect(isValidDisplayName(value)).toBe(true);
    },
  );

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    [undefined, "undefined"],
    [null, "null"],
    [42, "a number"],
  ] as Array<[unknown, string]>)("rejects %j (%s)", (value) => {
    expect(isValidDisplayName(value)).toBe(false);
  });
});

describe("EntityVersionId", () => {
  it("brands a UUID string without changing its runtime representation", () => {
    const id = EntityVersionId.of("22222222-2222-2222-2222-222222222222");
    expect(id).toBe("22222222-2222-2222-2222-222222222222");
  });
});
