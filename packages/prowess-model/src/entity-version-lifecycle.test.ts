import { describe, expect, it } from "vitest";
import {
  canMutateEntityVersionContent,
  ENTITY_VERSION_TRANSITIONS,
  isValidEntityVersionTransition,
} from "./entity-version-lifecycle.js";
import { ENTITY_VERSION_STATUSES } from "./status.js";

describe("isValidEntityVersionTransition — valid transitions", () => {
  it.each([
    ["DRAFT", "IN_REVIEW"],
    ["IN_REVIEW", "DRAFT"],
    ["IN_REVIEW", "APPROVED"],
    ["APPROVED", "PLAYTEST"],
    ["PLAYTEST", "CANON"],
    ["CANON", "SUPERSEDED"],
    ["CANON", "DEPRECATED"],
    ["SUPERSEDED", "ARCHIVED"],
    ["DEPRECATED", "ARCHIVED"],
  ] as const)("%s -> %s is valid", (from, to) => {
    expect(isValidEntityVersionTransition(from, to)).toBe(true);
  });
});

describe("isValidEntityVersionTransition — invalid transitions", () => {
  it.each([
    ["DRAFT", "CANON"],
    ["CANON", "DRAFT"],
    ["ARCHIVED", "DRAFT"],
    ["SUPERSEDED", "CANON"],
  ] as const)("%s -> %s is invalid", (from, to) => {
    expect(isValidEntityVersionTransition(from, to)).toBe(false);
  });

  it("ARCHIVED is terminal — no outgoing transitions at all", () => {
    for (const to of ENTITY_VERSION_STATUSES) {
      expect(isValidEntityVersionTransition("ARCHIVED", to)).toBe(false);
    }
  });

  it("a status transitioning to itself is not implicitly valid", () => {
    for (const status of ENTITY_VERSION_STATUSES) {
      expect(isValidEntityVersionTransition(status, status)).toBe(false);
    }
  });
});

describe("ENTITY_VERSION_TRANSITIONS completeness", () => {
  it("has an entry for every EntityVersionStatus value — none accidentally omitted", () => {
    for (const status of ENTITY_VERSION_STATUSES) {
      expect(ENTITY_VERSION_TRANSITIONS).toHaveProperty(status);
      expect(Array.isArray(ENTITY_VERSION_TRANSITIONS[status])).toBe(true);
    }
  });

  it("every transition target is itself a recognized status", () => {
    for (const status of ENTITY_VERSION_STATUSES) {
      for (const target of ENTITY_VERSION_TRANSITIONS[status]) {
        expect(ENTITY_VERSION_STATUSES).toContain(target);
      }
    }
  });
});

describe("canMutateEntityVersionContent", () => {
  it("is true only for DRAFT", () => {
    expect(canMutateEntityVersionContent("DRAFT")).toBe(true);
  });

  it.each(
    ENTITY_VERSION_STATUSES.filter((s) => s !== "DRAFT"),
  )("is false for %s", (status) => {
    expect(canMutateEntityVersionContent(status)).toBe(false);
  });
});
