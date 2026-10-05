import { describe, expect, it } from "vitest";
import { RULESET_MANIFEST_ERROR_CODES } from "./errors.js";
import { RulesetManifestEntryId, RulesetManifestId } from "./ids.js";
import {
  MAX_RULESET_MANIFEST_ENTRIES,
  validateCreateRulesetManifestInput,
  type CreateRulesetManifestInput,
} from "./ruleset-manifest.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("manifest ids", () => {
  it("brand UUID strings without changing their runtime value", () => {
    expect(RulesetManifestId.of(A)).toBe(A);
    expect(RulesetManifestEntryId.of(B)).toBe(B);
  });
});

describe("validateCreateRulesetManifestInput", () => {
  it("accepts a normal manifest and an EMPTY one (an empty snapshot means: this Ruleset pins no content)", () => {
    expect(validateCreateRulesetManifestInput({ entries: [{ entityId: A, entityVersionId: V1 }, { entityId: B, entityVersionId: V2 }] })).toBeNull();
    expect(validateCreateRulesetManifestInput({ entries: [] })).toBeNull();
  });

  it.each([
    ["no entries property", {}],
    ["entries not an array", { entries: "nope" }],
    ["entries null", { entries: null }],
    ["entry not an object", { entries: [null] }],
    ["entry missing entityId", { entries: [{ entityVersionId: V1 }] }],
    ["entry missing entityVersionId", { entries: [{ entityId: A }] }],
    ["blank entityId", { entries: [{ entityId: "   ", entityVersionId: V1 }] }],
    ["non-string entityVersionId", { entries: [{ entityId: A, entityVersionId: 7 }] }],
  ])("rejects: %s", (_label, input) => {
    expect(validateCreateRulesetManifestInput(input as unknown as CreateRulesetManifestInput)?.kind).toBe("INVALID_INPUT");
  });

  it("rejects non-object input", () => {
    for (const input of [null, undefined, "x", 5]) {
      expect(validateCreateRulesetManifestInput(input as unknown as CreateRulesetManifestInput)?.kind).toBe("INVALID_INPUT");
    }
  });

  it("reports the same Entity twice as DUPLICATE_ENTITY — even with different versions, and case-insensitively", () => {
    expect(validateCreateRulesetManifestInput({ entries: [{ entityId: A, entityVersionId: V1 }, { entityId: A, entityVersionId: V2 }] })?.kind).toBe("DUPLICATE_ENTITY");
    expect(validateCreateRulesetManifestInput({ entries: [{ entityId: A.toUpperCase(), entityVersionId: V1 }, { entityId: ` ${A} `, entityVersionId: V2 }] })?.kind).toBe("DUPLICATE_ENTITY");
  });

  it("the same VERSION under two different Entities is not a duplicate here (the database/service decides whether it belongs)", () => {
    expect(validateCreateRulesetManifestInput({ entries: [{ entityId: A, entityVersionId: V1 }, { entityId: B, entityVersionId: V1 }] })).toBeNull();
  });

  it("reports shape problems before duplicates", () => {
    const problem = validateCreateRulesetManifestInput({ entries: [{ entityId: A, entityVersionId: V1 }, { entityId: A, entityVersionId: V2 }, { entityId: B } as never] });
    expect(problem?.kind).toBe("INVALID_INPUT");
  });

  it("is bounded", () => {
    const many = Array.from({ length: MAX_RULESET_MANIFEST_ENTRIES + 1 }, (_, i) => ({ entityId: `e${i}`, entityVersionId: V1 }));
    expect(validateCreateRulesetManifestInput({ entries: many })?.kind).toBe("INVALID_INPUT");
  });

  it("accepts an absent or null parentManifestId (no inheritance) and a non-blank one; rejects a blank or non-string one", () => {
    const entries: CreateRulesetManifestInput["entries"] = [];
    expect(validateCreateRulesetManifestInput({ entries })).toBeNull();
    expect(validateCreateRulesetManifestInput({ entries, parentManifestId: null })).toBeNull();
    expect(validateCreateRulesetManifestInput({ entries, parentManifestId: A })).toBeNull();
    expect(validateCreateRulesetManifestInput({ entries, parentManifestId: "   " })?.kind).toBe("INVALID_INPUT");
    expect(validateCreateRulesetManifestInput({ entries, parentManifestId: 7 as unknown as string })?.kind).toBe("INVALID_INPUT");
  });

  it("has no way to supply a manifest version or any selector: the input type carries only entries and an optional parent manifest", () => {
    const input: CreateRulesetManifestInput = { entries: [] };
    expect(Object.keys(input)).toEqual(["entries"]);
  });
});

describe("RULESET_MANIFEST_ERROR_CODES", () => {
  it("is the ten controlled codes, DOMAIN.REASON-shaped, in one namespace", () => {
    expect(RULESET_MANIFEST_ERROR_CODES).toEqual({
      NOT_FOUND: "RULESET_MANIFEST.NOT_FOUND",
      RULESET_NOT_FOUND: "RULESET_MANIFEST.RULESET_NOT_FOUND",
      INVALID_INPUT: "RULESET_MANIFEST.INVALID_INPUT",
      VERSION_CONFLICT: "RULESET_MANIFEST.VERSION_CONFLICT",
      ENTITY_NOT_FOUND: "RULESET_MANIFEST.ENTITY_NOT_FOUND",
      VERSION_NOT_FOUND: "RULESET_MANIFEST.VERSION_NOT_FOUND",
      VERSION_ENTITY_MISMATCH: "RULESET_MANIFEST.VERSION_ENTITY_MISMATCH",
      DUPLICATE_ENTITY: "RULESET_MANIFEST.DUPLICATE_ENTITY",
      INVALID_PARENT_MANIFEST: "RULESET_MANIFEST.INVALID_PARENT_MANIFEST",
      INHERITANCE_CYCLE: "RULESET_MANIFEST.INHERITANCE_CYCLE",
    });
    for (const code of Object.values(RULESET_MANIFEST_ERROR_CODES)) {
      expect(code).toMatch(/^[A-Z_]+\.[A-Z_]+$/);
      expect(code.startsWith("RULESET_MANIFEST.")).toBe(true);
    }
  });
});
