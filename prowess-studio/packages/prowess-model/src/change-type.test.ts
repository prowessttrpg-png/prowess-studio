import { describe, expect, it } from "vitest";
import { CHANGE_TYPES, isChangeType } from "./change-type.js";

describe("ChangeType", () => {
  it.each(CHANGE_TYPES)("accepts %s as a valid ChangeType", (value) => {
    expect(isChangeType(value)).toBe(true);
  });

  it.each(["NOT_A_CHANGE_TYPE", "editorial", "", "Mechanical_Patch"])(
    "rejects %s",
    (value) => {
      expect(isChangeType(value)).toBe(false);
    },
  );
});
