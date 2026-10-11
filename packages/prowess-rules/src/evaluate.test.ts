import { afterEach, describe, expect, it, vi } from "vitest";
import * as rules from "./index.js";
import { evaluate, numberValue, validationMessage, type EvaluationDefinition, type EvaluationRequest } from "./index.js";
import { assertDeterministic } from "./testing/determinism.js";
import { requestInput } from "./testing/fixtures.js";

/**
 * The generic evaluation boundary. Guards M4-I03 (Pure Deterministic Evaluation), M4-I05 (No Wall-Clock Dependency),
 * M4-I06 (No Randomness), M4-I07 (No Network Dependency), M4-I08 (Inputs Are Not Mutated), M4-I13 (Engine Does Not
 * Mutate Rules) and M4-I15 (Runtime Mutation Is Outside Pure Evaluation).
 *
 * The evaluators below are TEST evaluators: generic demonstrations of the contract, not Formula / Requirement /
 * Modifier evaluation (§78). They read neutral context slots only.
 */
const echoPower: EvaluationDefinition<{ power: number; rules: number }> = {
  kind: "example.noop",
  requires: ["ACTOR"],
  evaluate: (req) => {
    const power = req.actor?.stats["stat.power"] ?? 0;
    return {
      data: { power, rules: req.ruleset?.rules.length ?? 0 },
      messages: power > 3 ? [validationMessage({ severity: "INFO", category: "STRUCTURE", code: "EXAMPLE.NOTE", message: "note", details: { power } })] : [],
      trace: [{ key: "step.read", operation: "op.read", inputs: [{ name: "power", value: numberValue(power) }], output: numberValue(power) }],
    };
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("M4-I03 pure deterministic evaluation", () => {
  it("the same input yields a byte-identical response every time (the reusable determinism helper)", () => {
    const input = requestInput();
    const response = assertDeterministic(() => evaluate(echoPower, input), { inputs: [input], runs: 10 });
    expect(response).toMatchObject({ status: "SUCCESS", success: true, data: { power: 4, rules: 2 }, evaluationKind: "example.noop" });
    expect(response.info.map((m) => m.code)).toEqual(["EXAMPLE.NOTE"]);
  });

  it("a differently-ordered but equivalent input yields the same response", () => {
    const a = evaluate(echoPower, requestInput());
    const shuffled = requestInput();
    shuffled.ruleset.rules.reverse();
    shuffled.actor.keywords.reverse();
    shuffled.actor.stats = { "stat.focus": 2, "stat.power": 4 };
    expect(JSON.stringify(evaluate(echoPower, shuffled))).toBe(JSON.stringify(a));
  });

  it("results are immutable values: frozen, and repeated reads do not alter them", () => {
    const response = evaluate(echoPower, requestInput());
    const first = JSON.stringify(response);
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.data)).toBe(true);
    expect(Object.isFrozen(response.trace.steps[0]?.inputs)).toBe(true);
    for (let i = 0; i < 3; i += 1) void [response.data, response.errors, response.trace, response.ruleset];
    expect(JSON.stringify(response)).toBe(first);
    expect(() => {
      (response as { status: string }).status = "ERROR";
    }).toThrow(TypeError);
  });

  it("returned data is a detached copy, not an alias of evaluator or request state", () => {
    const shared = { n: 1 };
    const response = evaluate({ kind: "example.noop", evaluate: () => ({ data: shared }) }, requestInput());
    expect(response.data).toEqual({ n: 1 });
    expect(response.data).not.toBe(shared);
    expect(Object.isFrozen(shared)).toBe(false);
  });

  it("is fully serializable: JSON round-trips to an equal value", () => {
    const response = evaluate(echoPower, requestInput());
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });
});

describe("M4-I05 / M4-I06 / M4-I07 no clock, no randomness, no network", () => {
  it("evaluation never reads the clock, draws randomness or calls the network", () => {
    const forbidden = (name: string) => () => {
      throw new Error(`${name} must not be called during pure evaluation`);
    };
    const now = vi.spyOn(Date, "now").mockImplementation(forbidden("Date.now"));
    const random = vi.spyOn(Math, "random").mockImplementation(forbidden("Math.random"));
    const RealDate = Date;
    vi.stubGlobal(
      "Date",
      new Proxy(RealDate, {
        construct: forbidden("new Date()"),
        apply: forbidden("Date()"),
      }),
    );
    vi.stubGlobal("fetch", forbidden("fetch"));
    vi.stubGlobal("crypto", { randomUUID: forbidden("crypto.randomUUID"), getRandomValues: forbidden("crypto.getRandomValues") });
    vi.stubGlobal("performance", { now: forbidden("performance.now") });

    const response = evaluate(echoPower, requestInput());
    vi.unstubAllGlobals();
    expect(response.status).toBe("SUCCESS");
    expect(now).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it("the pure response carries no evaluatedAt or other timestamp (clock policy option A)", () => {
    const response = evaluate(echoPower, requestInput());
    expect(Object.keys(response).sort()).toEqual(["contractVersion", "data", "errors", "evaluationKind", "info", "ruleset", "status", "success", "trace", "warnings"]);
    expect(JSON.stringify(response)).not.toMatch(/evaluatedAt|timestamp|\d{4}-\d{2}-\d{2}T/);
  });
});

describe("M4-I08 / M4-I13 / M4-I15 inputs, rules and runtime state are never mutated", () => {
  it("the caller's input is untouched, even when the evaluator is hostile", () => {
    const input = requestInput();
    const before = JSON.stringify(input);
    const attempts: string[] = [];
    const hostile: EvaluationDefinition<null> = {
      kind: "example.noop",
      evaluate: (req) => {
        const tries: Array<[string, () => void]> = [
          ["rules", () => (req.ruleset?.rules as unknown[]).push({})],
          ["ruleVersion", () => ((req.ruleset?.rules[0] as { entityVersionId: string }).entityVersionId = "x")],
          ["manifestHash", () => ((req.ruleset as { manifestHash: string | null }).manifestHash = null)],
          ["actorStat", () => ((req.actor?.stats as Record<string, number>)["stat.power"] = 99)],
          ["runtimeResource", () => ((req.runtime?.resourceValues as Record<string, number>)["resource.primary"] = 0)],
          ["runtimeReserved", () => ((req.runtime?.reservedCapacity as Record<string, number>)["resource.primary"] = 0)],
          ["runtimeEffects", () => (req.runtime?.activeEffects as unknown[]).pop()],
          ["metadata", () => ((req.metadata as Record<string, unknown>).caller = "x")],
        ];
        for (const [name, attempt] of tries) {
          try {
            attempt();
          } catch (e) {
            if (e instanceof TypeError) attempts.push(name);
          }
        }
        return { data: null };
      },
    };
    expect(evaluate(hostile, input).status).toBe("SUCCESS");
    expect(attempts).toEqual(["rules", "ruleVersion", "manifestHash", "actorStat", "runtimeResource", "runtimeReserved", "runtimeEffects", "metadata"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("an evaluation computes a preview from runtime values; the runtime context it was given is unchanged afterwards", () => {
    const input = requestInput();
    const preview: EvaluationDefinition<{ remainingPreview: number }> = {
      kind: "example.noop",
      requires: ["RUNTIME"],
      evaluate: (req: EvaluationRequest) => ({ data: { remainingPreview: (req.runtime?.resourceValues["resource.primary"] ?? 0) - 3 } }),
    };
    const response = assertDeterministic(() => evaluate(preview, input), { inputs: [input] });
    expect(response.data).toEqual({ remainingPreview: 6 });
    expect(input.runtime.resourceValues["resource.primary"]).toBe(9);
  });

  it("nothing in the public surface commits, pays, spends or mutates runtime state", () => {
    const names = Object.keys(rules);
    expect(names.filter((n) => /commit|pay|spend|deduct|consume|apply|mutate|persist|save|latest|current|canon(?!ical)/i.test(n))).toEqual([]);
  });
});

describe("the boundary's own checks", () => {
  it("rejects a request of another kind, and missing required contexts, before the evaluator runs", () => {
    const spy = vi.fn(() => ({ data: 1 }));
    const r1 = evaluate({ kind: "example.other", evaluate: spy }, requestInput());
    expect(r1.errors.map((e) => [e.code, e.path])).toEqual([["RULE_ENGINE.INVALID_INPUT", "/kind"]]);
    const r2 = evaluate({ kind: "example.noop", requires: ["RULESET", "RUNTIME"], evaluate: spy }, { kind: "example.noop" });
    expect(r2.errors.map((e) => [e.code, e.path])).toEqual([
      ["RULE_ENGINE.MISSING_CONTEXT", "/ruleset"],
      ["RULE_ENGINE.MISSING_CONTEXT", "/runtime"],
    ]);
    const r3 = evaluate({ kind: "example.noop", evaluate: spy }, "not a request");
    expect([r3.status, r3.evaluationKind, r3.ruleset]).toEqual(["ERROR", null, null]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("optional contexts may be absent", () => {
    const r = evaluate({ kind: "example.noop", evaluate: (req) => ({ data: req.actor === null }) }, { kind: "example.noop" });
    expect([r.status, r.data, r.ruleset]).toEqual(["SUCCESS", true, null]);
  });

  it("rejects non-serializable or malformed evaluator output as INVARIANT_VIOLATION", () => {
    const outputs: unknown[] = [
      { data: new Map() },
      { data: { n: Number.NaN } },
      { data: () => 1 },
      {},
      { data: 1, extra: true },
      { data: 1, messages: [{ severity: "ERROR", category: "STRUCTURE", code: "bad", message: "x" }] },
      { data: 1, trace: [{ key: "Bad Key", operation: "op.x" }] },
      { data: 1, trace: "nope" },
    ];
    for (const output of outputs) {
      const r = evaluate({ kind: "example.noop", evaluate: () => output as never }, requestInput());
      expect(r.errors.map((e) => e.code), JSON.stringify(String(output))).toEqual(["RULE_ENGINE.INVARIANT_VIOLATION"]);
    }
  });

  it("an evaluation definition with a bad shape is an invariant violation", () => {
    expect(evaluate({ kind: "Bad", evaluate: () => ({ data: 1 }) }, requestInput()).errors[0]?.code).toBe("RULE_ENGINE.INVARIANT_VIOLATION");
    expect(evaluate({ kind: "example.noop", requires: ["MOOD" as never], evaluate: () => ({ data: 1 }) }, requestInput()).errors[0]?.code).toBe(
      "RULE_ENGINE.INVARIANT_VIOLATION",
    );
  });

  it("a non-engine exception is a defect: re-thrown unchanged, never disguised as a rule outcome", () => {
    const defect = new RangeError("boom");
    expect(() => evaluate({ kind: "example.noop", evaluate: () => { throw defect; } }, requestInput())).toThrow(defect);
  });
});

describe("the determinism helper catches what it claims to", () => {
  it("detects non-deterministic output", () => {
    let n = 0;
    expect(() => assertDeterministic(() => ({ n: (n += 1) }))).toThrow(/differs/);
  });
  it("detects input mutation (freezing disabled so the mutation lands)", () => {
    const input = { a: 1 };
    expect(() => assertDeterministic(() => ((input.a += 1), null), { inputs: [input], freezeInputs: false })).toThrow(/differs|mutated/);
  });
  it("turns mutation into a thrown error when inputs are frozen", () => {
    const input = { a: 1 };
    expect(() => assertDeterministic(() => ((input.a = 2), null), { inputs: [input] })).toThrow(TypeError);
  });
  it("detects non-plain output", () => {
    expect(() => assertDeterministic(() => new Set([1]))).toThrow(/plain data/);
  });
});
