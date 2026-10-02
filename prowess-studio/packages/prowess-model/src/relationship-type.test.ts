import { describe, expect, it } from "vitest";
import { isRelationshipType, RELATIONSHIP_TYPES } from "./relationship-type.js";

describe("RelationshipType", () => {
  it.each(RELATIONSHIP_TYPES)("accepts %s as a valid RelationshipType", (value) => {
    expect(isRelationshipType(value)).toBe(true);
  });

  it.each(["requires", "", "DEPENDS_ON", "RELATES_TO"])("rejects %s", (value) => {
    expect(isRelationshipType(value)).toBe(false);
  });

  it("includes at least the Phase 1 vocabulary required by PAS-10 M1-WO6 §3", () => {
    const required = [
      "REQUIRES",
      "MODIFIES",
      "USES",
      "COMPATIBLE_WITH",
      "INCOMPATIBLE_WITH",
      "PART_OF",
      "BELONGS_TO",
      "SEE_ALSO",
    ];
    for (const type of required) {
      expect(RELATIONSHIP_TYPES).toContain(type);
    }
  });
});
