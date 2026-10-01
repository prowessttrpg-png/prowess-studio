import { describe, expect, it } from "vitest";
import * as ProwessModel from "./index.js";

describe("@prowess/model — shared model import", () => {
  it("can be imported and exposes a package version", () => {
    expect(ProwessModel.PROWESS_MODEL_PACKAGE_VERSION).toBe("0.1.0");
  });

  it("exposes the controlled Entity type set", () => {
    expect(ProwessModel.ENTITY_TYPES).toContain("SPELL_EFFECT");
    expect(ProwessModel.isEntityType("SPELL_EFFECT")).toBe(true);
    expect(ProwessModel.isEntityType("NOT_A_TYPE")).toBe(false);
  });

  it("exposes the controlled EntityVersion status set", () => {
    expect(ProwessModel.ENTITY_VERSION_STATUSES).toContain("CANON");
    expect(ProwessModel.isEntityVersionStatus("CANON")).toBe(true);
  });

  it("exposes the controlled relationship type set", () => {
    expect(ProwessModel.RELATIONSHIP_TYPES).toContain("REQUIRES");
    expect(ProwessModel.isRelationshipType("REQUIRES")).toBe(true);
  });

  it("brands identifiers without changing their runtime representation", () => {
    const id = ProwessModel.EntityId.of("11111111-1111-1111-1111-111111111111");
    expect(id).toBe("11111111-1111-1111-1111-111111111111");
  });
});
