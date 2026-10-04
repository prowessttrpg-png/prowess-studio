import { describe, expect, it } from "vitest";
import {
  isKeywordAssignmentSource,
  KEYWORD_ASSIGNMENT_SOURCES,
} from "./keyword-assignment-source.js";

describe("KeywordAssignmentSource", () => {
  it.each(KEYWORD_ASSIGNMENT_SOURCES)("accepts %s as a valid source", (value) => {
    expect(isKeywordAssignmentSource(value)).toBe(true);
  });

  it.each(["authored", "", "MANUAL", "DERIVED"])("rejects %s", (value) => {
    expect(isKeywordAssignmentSource(value)).toBe(false);
  });

  it("includes exactly AUTHORED, INHERITED, and CALCULATED — no more, no fewer", () => {
    expect([...KEYWORD_ASSIGNMENT_SOURCES].sort()).toEqual(
      ["AUTHORED", "CALCULATED", "INHERITED"].sort(),
    );
  });
});
