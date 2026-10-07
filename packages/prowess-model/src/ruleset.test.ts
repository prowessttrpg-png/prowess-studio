import { describe, expect, it } from "vitest";
import { isValidCanonicalKey } from "./canonical-key.js";
import { RULESET_ERROR_CODES } from "./errors.js";
import { RulesetId } from "./ids.js";
import {
  MAX_RULESET_NAME_LENGTH,
  MAX_RULESET_VERSION_LABEL_LENGTH,
  validateCreateRulesetInput,
  type CreateRulesetInput,
} from "./ruleset.js";

const valid: CreateRulesetInput = {
  canonicalKey: "test.ruleset.core",
  name: "Test Core Ruleset",
  channel: "CORE_PLAYTEST",
};

describe("RulesetId", () => {
  it("brands a UUID string without changing its runtime value", () => {
    expect(RulesetId.of("11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("validateCreateRulesetInput", () => {
  it("accepts the minimal input and a fully-specified one", () => {
    expect(validateCreateRulesetInput(valid)).toBeNull();
    expect(
      validateCreateRulesetInput({
        ...valid,
        description: "A description",
        versionLabel: "Core Playtest 2026.10",
        parentRulesetId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBeNull();
  });

  it("reuses the project's single canonical-key grammar — no second one", () => {
    for (const key of ["test.ruleset.core", "test.ruleset.experimental", "a.b", "x.y_1.z2"]) {
      expect(isValidCanonicalKey(key)).toBe(true);
      expect(validateCreateRulesetInput({ ...valid, canonicalKey: key })).toBeNull();
    }
    for (const key of ["Test.Ruleset", "single", "test..empty", "test.ruleset-core", "", " test.x "]) {
      expect(isValidCanonicalKey(key)).toBe(false);
      expect(validateCreateRulesetInput({ ...valid, canonicalKey: key })?.field, key).toBe("canonicalKey");
    }
  });

  it.each([["", "empty"], ["   ", "whitespace only"], ["\t\n", "tabs/newlines"]])("rejects a blank name (%j: %s)", (name) => {
    expect(validateCreateRulesetInput({ ...valid, name })?.field).toBe("name");
  });

  it("limits the name length, measured after trimming", () => {
    expect(validateCreateRulesetInput({ ...valid, name: "x".repeat(MAX_RULESET_NAME_LENGTH) })).toBeNull();
    expect(validateCreateRulesetInput({ ...valid, name: `  ${"x".repeat(MAX_RULESET_NAME_LENGTH)}  ` })).toBeNull();
    expect(validateCreateRulesetInput({ ...valid, name: "x".repeat(MAX_RULESET_NAME_LENGTH + 1) })?.field).toBe("name");
  });

  it.each(["BETA", "core_playtest", "", "PUBLISHED"])("rejects an unknown channel %j", (channel) => {
    expect(validateCreateRulesetInput({ ...valid, channel })?.field).toBe("channel");
  });

  it("rejects a blank or over-long versionLabel but accepts absence and null", () => {
    expect(validateCreateRulesetInput({ ...valid, versionLabel: "   " })?.field).toBe("versionLabel");
    expect(validateCreateRulesetInput({ ...valid, versionLabel: "v".repeat(MAX_RULESET_VERSION_LABEL_LENGTH + 1) })?.field).toBe("versionLabel");
    expect(validateCreateRulesetInput({ ...valid, versionLabel: null })).toBeNull();
    expect(validateCreateRulesetInput({ ...valid, versionLabel: undefined })).toBeNull();
  });

  it("does not interpret a version label (no semver parsing): any non-blank text is accepted", () => {
    for (const label of ["0.1", "1.0", "Core Playtest 2026.10", "not-a-version", "v?"]) {
      expect(validateCreateRulesetInput({ ...valid, versionLabel: label }), label).toBeNull();
    }
  });

  it("rejects wrongly-typed optional fields", () => {
    expect(validateCreateRulesetInput({ ...valid, description: 5 as unknown as string })?.field).toBe("description");
    expect(validateCreateRulesetInput({ ...valid, parentRulesetId: 5 as unknown as string })?.field).toBe("parentRulesetId");
    expect(validateCreateRulesetInput({ ...valid, name: undefined as unknown as string })?.field).toBe("name");
  });

  it("reports the FIRST problem (canonical key before name before channel)", () => {
    expect(validateCreateRulesetInput({ canonicalKey: "BAD", name: "", channel: "NOPE" })?.field).toBe("canonicalKey");
    expect(validateCreateRulesetInput({ canonicalKey: "a.b", name: "", channel: "NOPE" })?.field).toBe("name");
  });
});

describe("RULESET_ERROR_CODES", () => {
  it("is the five controlled codes, DOMAIN.REASON-shaped", () => {
    expect(RULESET_ERROR_CODES).toEqual({
      NOT_FOUND: "RULESET.NOT_FOUND",
      CANONICAL_KEY_CONFLICT: "RULESET.CANONICAL_KEY_CONFLICT",
      INVALID_INPUT: "RULESET.INVALID_INPUT",
      INVALID_PARENT: "RULESET.INVALID_PARENT",
      PARENT_CYCLE: "RULESET.PARENT_CYCLE",
      INVALID_STATUS_TRANSITION: "RULESET.INVALID_STATUS_TRANSITION", // M2-WO8 review lifecycle
    });
    for (const code of Object.values(RULESET_ERROR_CODES)) expect(code).toMatch(/^[A-Z_]+\.[A-Z_]+$/);
  });
});
