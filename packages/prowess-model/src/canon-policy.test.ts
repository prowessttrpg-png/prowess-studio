import { describe, expect, it } from "vitest";
import { CANON_POLICY_ERROR_CODES, SOURCE_AUTHORITY_ERROR_CODES } from "./errors.js";
import { CanonPolicyId, SourceAuthorityRecordId } from "./ids.js";
import {
  MAX_AUTHORITY_RATIONALE_LENGTH,
  MAX_CANON_POLICY_AUTHORITIES,
  MAX_CANON_POLICY_NAME_LENGTH,
  validateCreateCanonPolicyInput,
  type CreateCanonPolicyInput,
} from "./canon-policy.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ok = { name: "Policy", authorities: [{ sourceDocumentId: A, scopeKey: "global", authorityStatus: "CURRENT_PRIMARY" }] };

describe("ids", () => {
  it("brand UUID strings without changing their runtime value", () => {
    expect(CanonPolicyId.of(A)).toBe(A);
    expect(SourceAuthorityRecordId.of(B)).toBe(B);
  });
});

describe("validateCreateCanonPolicyInput", () => {
  it("accepts a normal policy and an EMPTY one (an empty snapshot declares no authority)", () => {
    expect(validateCreateCanonPolicyInput(ok)).toBeNull();
    expect(validateCreateCanonPolicyInput({ name: "Empty", authorities: [] })).toBeNull();
  });

  it("accepts the same SourceDocument in different scopes, with every vocabulary status and an optional rationale", () => {
    expect(
      validateCreateCanonPolicyInput({
        name: "Scoped",
        description: "d",
        authorities: [
          { sourceDocumentId: A, scopeKey: "global", authorityStatus: "CURRENT_PRIMARY" },
          { sourceDocumentId: A, scopeKey: "entity_type.spell_effect", authorityStatus: "GOVERNING", rationale: "Errata supersedes" },
          { sourceDocumentId: B, scopeKey: "global", authorityStatus: "UNRESOLVED", rationale: null },
        ],
      }),
    ).toBeNull();
  });

  it.each([
    ["blank name", { ...ok, name: "   " }],
    ["missing name", { authorities: [] }],
    ["non-string description", { ...ok, description: 5 }],
    ["authorities not an array", { name: "x", authorities: "nope" }],
    ["authorities missing", { name: "x" }],
    ["authority not an object", { name: "x", authorities: [null] }],
    ["blank sourceDocumentId", { name: "x", authorities: [{ sourceDocumentId: " ", scopeKey: "global", authorityStatus: "GOVERNING" }] }],
    ["unrecognized status", { name: "x", authorities: [{ sourceDocumentId: A, scopeKey: "global", authorityStatus: "BOGUS" }] }],
    ["status missing", { name: "x", authorities: [{ sourceDocumentId: A, scopeKey: "global" }] }],
    ["non-string rationale", { name: "x", authorities: [{ sourceDocumentId: A, scopeKey: "global", authorityStatus: "GOVERNING", rationale: 3 }] }],
  ])("rejects: %s", (_label, input) => {
    expect(validateCreateCanonPolicyInput(input as unknown as CreateCanonPolicyInput)?.kind).toBe("INVALID_INPUT");
  });

  it.each(["Global", "page.12", "has space", "", "entity-type.x"])("rejects the scope %j as INVALID_SCOPE", (scopeKey) => {
    expect(
      validateCreateCanonPolicyInput({ name: "x", authorities: [{ sourceDocumentId: A, scopeKey, authorityStatus: "GOVERNING" }] })?.kind,
    ).toBe("INVALID_SCOPE");
    expect(
      validateCreateCanonPolicyInput({ name: "x", authorities: [{ sourceDocumentId: A, authorityStatus: "GOVERNING" } as never] })?.kind,
    ).toBe("INVALID_SCOPE"); // a missing scope key is an invalid scope
  });

  it("limits name and rationale lengths", () => {
    expect(validateCreateCanonPolicyInput({ name: "x".repeat(MAX_CANON_POLICY_NAME_LENGTH), authorities: [] })).toBeNull();
    expect(validateCreateCanonPolicyInput({ name: "x".repeat(MAX_CANON_POLICY_NAME_LENGTH + 1), authorities: [] })?.kind).toBe("INVALID_INPUT");
    const withRationale = (r: string) => ({ name: "x", authorities: [{ sourceDocumentId: A, scopeKey: "global", authorityStatus: "GOVERNING", rationale: r }] });
    expect(validateCreateCanonPolicyInput(withRationale("r".repeat(MAX_AUTHORITY_RATIONALE_LENGTH)))).toBeNull();
    expect(validateCreateCanonPolicyInput(withRationale("r".repeat(MAX_AUTHORITY_RATIONALE_LENGTH + 1)))?.kind).toBe("INVALID_INPUT");
  });

  it("reports the same SourceDocument + scope twice as DUPLICATE_SOURCE_SCOPE, case-insensitively on the id, whatever the statuses", () => {
    const dup = (a: string, b: string) => ({
      name: "x",
      authorities: [
        { sourceDocumentId: a, scopeKey: "global", authorityStatus: "GOVERNING" },
        { sourceDocumentId: b, scopeKey: "global", authorityStatus: "SUPERSEDED" },
      ],
    });
    expect(validateCreateCanonPolicyInput(dup(A, A))?.kind).toBe("DUPLICATE_SOURCE_SCOPE");
    expect(validateCreateCanonPolicyInput(dup(A.toUpperCase(), ` ${A} `))?.kind).toBe("DUPLICATE_SOURCE_SCOPE");
    expect(validateCreateCanonPolicyInput(dup(A, B))).toBeNull(); // different documents: fine
  });

  it("reports shape/scope/status problems before duplicates", () => {
    const problem = validateCreateCanonPolicyInput({
      name: "x",
      authorities: [
        { sourceDocumentId: A, scopeKey: "global", authorityStatus: "GOVERNING" },
        { sourceDocumentId: A, scopeKey: "global", authorityStatus: "GOVERNING" },
        { sourceDocumentId: B, scopeKey: "Bad Scope", authorityStatus: "GOVERNING" },
      ],
    });
    expect(problem?.kind).toBe("INVALID_SCOPE");
  });

  it("is bounded", () => {
    const many = Array.from({ length: MAX_CANON_POLICY_AUTHORITIES + 1 }, (_, i) => ({ sourceDocumentId: `s${i}`, scopeKey: "global", authorityStatus: "GOVERNING" }));
    expect(validateCreateCanonPolicyInput({ name: "x", authorities: many })?.kind).toBe("INVALID_INPUT");
  });

  it("carries no way to supply a policy version, and none to select content: the input has only name, description, authorities", () => {
    const input: CreateCanonPolicyInput = { name: "x", authorities: [] };
    expect(Object.keys(input).sort()).toEqual(["authorities", "name"]);
  });
});

describe("controlled error vocabularies", () => {
  it("CANON_POLICY_ERROR_CODES is the four codes, DOMAIN.REASON-shaped", () => {
    expect(CANON_POLICY_ERROR_CODES).toEqual({
      NOT_FOUND: "CANON_POLICY.NOT_FOUND",
      RULESET_NOT_FOUND: "CANON_POLICY.RULESET_NOT_FOUND",
      INVALID_INPUT: "CANON_POLICY.INVALID_INPUT",
      VERSION_CONFLICT: "CANON_POLICY.VERSION_CONFLICT",
    });
  });

  it("SOURCE_AUTHORITY_ERROR_CODES is the three codes, DOMAIN.REASON-shaped", () => {
    expect(SOURCE_AUTHORITY_ERROR_CODES).toEqual({
      SOURCE_NOT_FOUND: "SOURCE_AUTHORITY.SOURCE_NOT_FOUND",
      INVALID_SCOPE: "SOURCE_AUTHORITY.INVALID_SCOPE",
      DUPLICATE_SOURCE_SCOPE: "SOURCE_AUTHORITY.DUPLICATE_SOURCE_SCOPE",
    });
    for (const code of [...Object.values(CANON_POLICY_ERROR_CODES), ...Object.values(SOURCE_AUTHORITY_ERROR_CODES)]) {
      expect(code).toMatch(/^[A-Z_]+\.[A-Z_]+$/);
    }
  });
});
