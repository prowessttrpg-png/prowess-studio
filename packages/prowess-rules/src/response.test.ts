import * as model from "@prowess/model";
import { DomainError } from "@prowess/model";
import { describe, expect, it } from "vitest";
import {
  RULE_ENGINE_ERROR_CODES,
  RULE_ENGINE_RESPONSE_STATUSES,
  RulesEngineError,
  VALIDATION_CATEGORIES,
  VALIDATION_SEVERITIES,
  deriveResponseStatus,
  evaluate,
  isRuleEngineErrorCode,
  isRulesEngineError,
  isValidValidationCode,
  validationMessage,
  type RuleMessage,
  type ValidationMessageInput,
} from "./index.js";
import { requestInput } from "./testing/fixtures.js";

/** M4-WO1 response / message / error contracts. Guards M4-I09 (Structured Validation Messages). */
const msg = (severity: ValidationMessageInput["severity"], code = "EXAMPLE.CHECK") =>
  validationMessage({ severity, category: "STRUCTURE", code, message: `${severity} example` });

const respond = (messages: ValidationMessageInput[], data: unknown = { value: 1 }) =>
  evaluate({ kind: "example.noop", evaluate: () => ({ data, messages: messages.map(validationMessage) }) }, requestInput());

describe("approved vocabularies", () => {
  it("fixes the severity, category and status vocabularies", () => {
    expect([...VALIDATION_SEVERITIES]).toEqual(["ERROR", "WARNING", "INFO"]);
    expect([...VALIDATION_CATEGORIES]).toEqual(["STRUCTURE", "COMPATIBILITY", "REQUIREMENT", "PARAMETER", "CAPACITY", "RESOURCE", "FORMULA", "RULESET", "RUNTIME"]);
    expect([...RULE_ENGINE_RESPONSE_STATUSES]).toEqual(["SUCCESS", "VALID_WITH_WARNINGS", "INVALID", "ERROR"]);
  });

  it("engine error codes are well-formed, minimal, and collide with no @prowess/model DomainError code", () => {
    const codes = Object.values(RULE_ENGINE_ERROR_CODES);
    expect(codes.sort()).toEqual(["RULE_ENGINE.INVALID_INPUT", "RULE_ENGINE.INVARIANT_VIOLATION", "RULE_ENGINE.MISSING_CONTEXT", "RULE_ENGINE.NON_FINITE_NUMBER"]);
    for (const code of codes) expect(code).toMatch(/^[A-Z_]+\.[A-Z_]+$/);
    const modelCodes = Object.entries(model)
      .filter(([k]) => k.endsWith("_ERROR_CODES"))
      .flatMap(([, v]) => Object.values(v as Record<string, string>));
    expect(modelCodes.length).toBeGreaterThan(100);
    for (const code of codes) expect(modelCodes).not.toContain(code);
    expect(isRuleEngineErrorCode("RULE_ENGINE.INVALID_INPUT")).toBe(true);
    expect(isRuleEngineErrorCode("ENTITY.NOT_FOUND")).toBe(false);
  });
});

describe("M4-I09 structured validation messages", () => {
  it("carries severity, category, code, message, path, provenance and structured details", () => {
    const m = validationMessage({
      severity: "WARNING",
      category: "PARAMETER",
      code: "EXAMPLE.PARAMETER.HIGH",
      message: "Parameter is high.",
      path: "/build/parameters/param.size",
      provenance: { entityId: "40000000-0000-4000-8000-00000000000A", entityVersionId: null, canonicalKey: "rule.example", rulesetId: null, manifestId: null } as never,
      details: { limit: 3, actual: 5 },
    });
    expect(m).toEqual({
      kind: "VALIDATION",
      severity: "WARNING",
      category: "PARAMETER",
      code: "EXAMPLE.PARAMETER.HIGH",
      message: "Parameter is high.",
      path: "/build/parameters/param.size",
      provenance: { entityId: "40000000-0000-4000-8000-00000000000a", entityVersionId: null, canonicalKey: "rule.example", rulesetId: null, manifestId: null },
      details: { actual: 5, limit: 3 },
    });
    expect(Object.isFrozen(m)).toBe(true);
  });

  it("codes must be namespaced upper case, and the RULE_ENGINE namespace is reserved for engine errors", () => {
    expect(isValidValidationCode("REQUIREMENT.NOT_MET")).toBe(true);
    for (const bad of ["NOT_NAMESPACED", "lower.case", "RULE_ENGINE.INVALID_INPUT", "A..B", ""]) expect(isValidValidationCode(bad), bad).toBe(false);
  });

  it("a malformed message is an engine defect (INVARIANT_VIOLATION), never a rule outcome", () => {
    for (const bad of [
      { severity: "FATAL", category: "STRUCTURE", code: "EXAMPLE.X", message: "m" },
      { severity: "ERROR", category: "MAGIC", code: "EXAMPLE.X", message: "m" },
      { severity: "ERROR", category: "STRUCTURE", code: "RULE_ENGINE.X", message: "m" },
      { severity: "ERROR", category: "STRUCTURE", code: "EXAMPLE.X", message: "m", details: { n: Number.NaN } },
      { severity: "ERROR", category: "STRUCTURE", code: "EXAMPLE.X", message: "m", path: "no-leading-slash" },
    ]) {
      expect(() => validationMessage(bad as ValidationMessageInput)).toThrow(RulesEngineError);
      try {
        validationMessage(bad as ValidationMessageInput);
      } catch (e) {
        expect((e as RulesEngineError).code).toBe("RULE_ENGINE.INVARIANT_VIOLATION");
      }
    }
  });

  it("clients rely on code / category / severity / details: rewording the prose changes nothing else", () => {
    const strip = (r: ReturnType<typeof respond>) => JSON.stringify(r.warnings.map((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== "message"))));
    const a = respond([{ severity: "WARNING", category: "CAPACITY", code: "EXAMPLE.OVER", message: "Over capacity.", details: { over: 2 } }]);
    const b = respond([{ severity: "WARNING", category: "CAPACITY", code: "EXAMPLE.OVER", message: "Wholly different words.", details: { over: 2 } }]);
    expect(strip(a)).toBe(strip(b));
  });
});

describe("status derivation and success semantics", () => {
  it("SUCCESS with no messages or only INFO; data present", () => {
    for (const r of [respond([]), respond([msg("INFO")])]) {
      expect([r.status, r.success, r.data]).toEqual(["SUCCESS", true, { value: 1 }]);
    }
  });

  it("VALID_WITH_WARNINGS is still a success with data", () => {
    const r = respond([msg("INFO"), msg("WARNING")]);
    expect([r.status, r.success, r.data]).toEqual(["VALID_WITH_WARNINGS", true, { value: 1 }]);
  });

  it("a blocking VALIDATION error is INVALID: no success, no data, but no engine error either", () => {
    const r = respond([msg("WARNING"), msg("ERROR", "REQUIREMENT.NOT_MET")]);
    expect([r.status, r.success, r.data]).toEqual(["INVALID", false, null]);
    expect(r.errors.map((e) => e.kind)).toEqual(["VALIDATION"]);
  });

  it("an ENGINE error is ERROR and is a different kind of message from a validation error", () => {
    const r = evaluate({ kind: "example.noop", requires: ["BUILD"], evaluate: () => ({ data: 1 }) }, { kind: "example.noop" });
    expect([r.status, r.success, r.data]).toEqual(["ERROR", false, null]);
    expect(r.errors).toEqual([
      {
        kind: "ENGINE",
        ordinal: 0,
        severity: "ERROR",
        code: "RULE_ENGINE.MISSING_CONTEXT",
        message: "the BUILD context is required",
        path: "/build",
        details: { family: "BUILD" },
      },
    ]);
  });

  it("an engine error outranks any validation outcome", () => {
    const messages: RuleMessage[] = [
      { kind: "VALIDATION", ordinal: 0, severity: "ERROR", category: "STRUCTURE", code: "EXAMPLE.X", message: "", path: null, provenance: null, details: null },
      { kind: "ENGINE", ordinal: 1, severity: "ERROR", code: "RULE_ENGINE.INVALID_INPUT", message: "", path: null, details: null },
    ];
    expect(deriveResponseStatus(messages)).toBe("ERROR");
    expect(deriveResponseStatus(messages.slice(0, 1))).toBe("INVALID");
    expect(deriveResponseStatus([])).toBe("SUCCESS");
  });
});

describe("deterministic message ordering", () => {
  it("ordinals follow emission order, are unique across errors / warnings / info, and each list is in ordinal order", () => {
    const r = respond([msg("INFO", "EXAMPLE.A"), msg("ERROR", "EXAMPLE.B"), msg("WARNING", "EXAMPLE.C"), msg("ERROR", "EXAMPLE.D"), msg("INFO", "EXAMPLE.E")]);
    expect(r.errors.map((m) => [m.ordinal, m.code])).toEqual([[1, "EXAMPLE.B"], [3, "EXAMPLE.D"]]);
    expect(r.warnings.map((m) => [m.ordinal, m.code])).toEqual([[2, "EXAMPLE.C"]]);
    expect(r.info.map((m) => [m.ordinal, m.code])).toEqual([[0, "EXAMPLE.A"], [4, "EXAMPLE.E"]]);
  });

  it("several engine errors from one request are numbered in input walk order", () => {
    const r = evaluate({ kind: "example.noop", evaluate: () => ({ data: 1 }) }, { kind: "example.noop", actor: { stats: { "stat.b": Number.NaN, "stat.a": "x" } } });
    expect(r.errors.map((e) => [e.ordinal, e.code, e.path])).toEqual([
      [0, "RULE_ENGINE.INVALID_INPUT", "/actor/stats/stat.a"],
      [1, "RULE_ENGINE.NON_FINITE_NUMBER", "/actor/stats/stat.b"],
    ]);
  });
});

describe("error serialization (§79)", () => {
  it("RulesEngineError is a DomainError, but its result form has no stack, cause or function", () => {
    const error = new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVALID_INPUT, "bad", { path: "/x", details: { n: 1 } });
    expect(error).toBeInstanceOf(DomainError);
    expect(isRulesEngineError(error)).toBe(true);
    expect(error.code).toBe("RULE_ENGINE.INVALID_INPUT");
    const r = evaluate({ kind: "example.noop", evaluate: () => { throw error; } }, requestInput());
    const json = JSON.stringify(r);
    expect(r.errors).toEqual([{ kind: "ENGINE", ordinal: 0, severity: "ERROR", code: "RULE_ENGINE.INVALID_INPUT", message: "bad", path: "/x", details: { n: 1 } }]);
    expect(json).not.toMatch(/stack|at Object|\.ts:\d+|cause/);
    expect(JSON.parse(json)).toEqual(r);
  });

  it("drops non-serializable error details rather than leaking them", () => {
    const error = new RulesEngineError(RULE_ENGINE_ERROR_CODES.INVALID_INPUT, "bad", { details: { when: new Date(0) } as never });
    expect(error.details).toBeNull();
  });
});
