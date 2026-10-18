import { describe, expect, it } from "vitest";
import { orchestrateRulesEvaluation } from "@prowess/rules";
import {
  BUNDLE_ERROR_CODES as B,
  COMPILATION_ERROR_CODES as X,
  CORE_ERROR_CODES as K,
  DEFINITION_ERROR_CODES as C,
  PROWESS_DEFINITION_KINDS,
  buildCoreResolutionContexts,
  compileCoreResolution,
  PROWESS_STATS,
  createProwessDefinitionBundle,
  createProwessDefinitionEnvelope,
  indexCoreDefinitions,
  resolveRollMode,
  validateCharacterCore,
  validateDieRollInput,
} from "./index.js";
import { CORE_CONTENT, CORE_DEFINITIONS, characterL3, coreBundle, coreRuleset } from "./testing/core-fixtures.js";
import { codes, compileWith, roll, runCore } from "./testing/core-run.js";

/**
 * M5-WO2 contracts: core Definition payloads, the role index, CharacterCore, die-roll input, the core compiler, its
 * source map and provenance, and the security / immutability / serialization / determinism guarantees.
 *
 * Guards: M5-I041 Player Die legacy · M5-I042 progression is data · M5-I043 runtime dice, no randomness · M5-I045 six
 * Stats · M5-I046 Stat bounds · M5-I047 rank order vs meaning · M5-I050 arithmetic in M4 (no hidden math) ·
 * M5-I056 Dodge canonical / Evasion legacy · M5-I061 Targeting never selects a Save · M5-I073 Movement deferred (SUPERSEDED by M5-I075 in M5-WO3 — no MOVEMENT core subject exists);
 * plus WO2 security, immutability, serialization, determinism, source-map and exact-Ruleset guarantees.
 */
const fixture = coreBundle();
const definitionsWith = (canonicalKey: string, payload: Record<string, unknown>) => {
  const { ruleset, definitions } = coreRuleset({ revise: { [canonicalKey]: payload } });
  return createProwessDefinitionBundle({ ruleset, definitions });
};
const payloadOf = (key: string) => JSON.parse(JSON.stringify(CORE_DEFINITIONS.find((d) => d.canonicalKey === key)?.payload)) as Record<string, unknown>;

describe("canonical core content", () => {
  it("is one versioned content document, every Definition valid under its v1 contract and pinned in one bundle", () => {
    expect(CORE_CONTENT.contentKey).toBe("prowess.core_playtest.v0_1.core_resolution");
    // WO2 shipped 30 core Definitions; M5-WO3 appended BASE_MOVEMENT, FINAL_MOVEMENT (renamed MOVEMENT by the post-WO3
    // amendment applied in M5-WO4) and INITIATIVE (33). The test
    // bundle also pins the 26 WO3 runtime Definitions (runtime-resources.json); WO2 identities are unchanged.
    expect(CORE_DEFINITIONS).toHaveLength(33);
    expect(fixture.bundle.definitions).toHaveLength(59);
    expect(new Set(CORE_DEFINITIONS.map((d) => d.canonicalKey)).size).toBe(33);
  });

  it("every Definition cites source sections, and the rulings it applies", () => {
    for (const d of CORE_DEFINITIONS) {
      const source = d.payload.source as { locators: string[]; conflicts: string[] };
      expect(source.locators.length, d.canonicalKey).toBeGreaterThan(0);
      for (const key of source.conflicts) expect(["M5-SC-002", "M5-SC-003", "M5-SC-004", "M5-SC-005", "M5-SC-006", "M5-SC-008", "M5-SC-009", "M5-SC-010", "M5-SC-032", "M5-SC-033"], d.canonicalKey).toContain(key);
    }
  });

  it("M5-I041 / M5-I056 canonical content uses Character Die and Dodge; the legacy names are refused as values", () => {
    const text = JSON.stringify(CORE_DEFINITIONS);
    expect(text).not.toMatch(/player[ _]?di(c)?e|evasion/i);
    for (const legacy of ["Player Die", "PLAYER_DICE", "Evasion", "EVASION"]) {
      const out = definitionsWith("core.character_die.progression", { ...payloadOf("core.character_die.progression"), dice: [{ dieKey: "D4", faces: 4 }, { dieKey: "D6", faces: 6 }, { dieKey: "D8", faces: 8 }, { dieKey: "D10", faces: 10 }, { dieKey: "D12", faces: 12 }], progression: (payloadOf("core.character_die.progression").progression as unknown[]).map((b, i) => (i === 0 ? { ...(b as object), dieKey: "D4" } : b)), levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], source: { locators: ["s16"], conflicts: [] } });
      expect(out.ok).toBe(true);
      const bad = definitionsWith("core.rank_ladder.skill", { ...payloadOf("core.rank_ladder.skill"), ladderKey: legacy.toUpperCase().replace(/ /g, "_") });
      expect(codes(bad), legacy).toContain(C.LEGACY_TERM_AS_CANONICAL);
    }
  });

  it("the WO2 kinds have v1 contracts; M5-WO3 activates Resource / Action; Skill / Ancestry stay reserved", () => {
    for (const kind of ["STAT", "CHARACTER_DIE_PROGRESSION", "RANK_LADDER", "SKILL_RANK", "DERIVED_STAT", "CORE_RESOLUTION", "RESOURCE", "ACTION"] as const) expect(PROWESS_DEFINITION_KINDS[kind].schemaVersions, kind).toEqual([1]);
    for (const kind of ["SKILL", "ANCESTRY"] as const) expect(PROWESS_DEFINITION_KINDS[kind].schemaVersions, kind).toEqual([]);
  });
});

describe("core payload contracts fail closed", () => {
  const rejects = (key: string, patch: Record<string, unknown>, code: string = C.INVALID_PAYLOAD) => expect(codes(definitionsWith(key, { ...payloadOf(key), ...patch })), JSON.stringify(patch)).toContain(code);

  it("STAT: known Stat, integer limits, minimum ≤ maximum", () => {
    rejects("core.stat.str", { stat: "LUCK" });
    rejects("core.stat.str", { stat: "str" });
    rejects("core.stat.str", { minimum: 11 });
    rejects("core.stat.str", { maximum: 9.5 });
  });

  it("CHARACTER_DIE_PROGRESSION: every level in exactly one band; bands name declared dice; levels strictly increasing", () => {
    const p = payloadOf("core.character_die.progression");
    rejects("core.character_die.progression", { progression: (p.progression as object[]).slice(1) });
    rejects("core.character_die.progression", { progression: [...(p.progression as object[]), { levelMinimum: 2, levelMaximum: 3, dieKey: "D6" }] });
    rejects("core.character_die.progression", { progression: [{ levelMinimum: 1, levelMaximum: 10, dieKey: "D20" }] });
    rejects("core.character_die.progression", { levels: [1, 3, 2, 4, 5, 6, 7, 8, 9, 10] });
    rejects("core.character_die.progression", { dice: [{ dieKey: "D4", faces: 1 }] });
  });

  it("RANK_LADDER: explicit, strictly increasing order; unique ranks", () => {
    rejects("core.rank_ladder.skill", { ranks: [{ rankKey: "UNTRAINED", order: 0 }, { rankKey: "TRAINED", order: 0 }] });
    rejects("core.rank_ladder.skill", { ranks: [{ rankKey: "UNTRAINED", order: 1 }, { rankKey: "UNTRAINED", order: 2 }] });
    rejects("core.rank_ladder.skill", { ranks: [{ rankKey: "UNTRAINED" }] });
  });

  it("SKILL_RANK: an explicit attempt policy, separate from the bonus; the entries must cover the ladder exactly", () => {
    rejects("core.skill_rank.bonuses", { entries: [{ rankKey: "TRAINED", bonus: 2, attemptAllowed: "FREELY" }] });
    rejects("core.skill_rank.bonuses", { entries: [{ rankKey: "TRAINED", bonus: 2 }] });
    const partial = definitionsWith("core.skill_rank.bonuses", { ...payloadOf("core.skill_rank.bonuses"), entries: [{ rankKey: "TRAINED", bonus: 2, attemptAllowed: true }] });
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(codes(indexCoreDefinitions(partial.value))).toEqual([K.INCONSISTENT_CORE_DEFINITIONS]);
  });

  it("DERIVED_STAT: a valid M4 program whose variables are exactly its declared sources", () => {
    const key = "core.derived.accuracy";
    const formula = payloadOf(key).formula as Record<string, unknown>;
    rejects(key, { formula: { ...formula, expression: "floor(pro / 3" } }, C.INVALID_FORMULA);
    rejects(key, { formula: { ...formula, expression: "floor(pro / 3) + agi" } }, C.INVALID_FORMULA);
    rejects(key, { formula: { ...formula, variables: [...(formula.variables as object[]), { variable: "agi", source: { kind: "STAT", stat: "AGI" } }] } }, C.INVALID_FORMULA);
    rejects(key, { formula: { ...formula, rounding: "ROUND" } });
    rejects(key, { formula: { ...formula, expression: "random(pro)" } }, C.INVALID_FORMULA);
    rejects(key, { formula: { ...formula, variables: [{ variable: "pro", source: { kind: "NATURAL" } }] } });
    rejects(key, { statistic: "EVASION" });
    rejects(key, { bonusTarget: "DODGE" });
  });

  it("CORE_RESOLUTION: natural selection reads exactly r1 (NORMAL) or r1, r2 (ADVANTAGE / DISADVANTAGE)", () => {
    const key = "core.resolution.attack_roll";
    const p = payloadOf(key);
    const sel = p.naturalSelection as Record<string, unknown>;
    rejects(key, { naturalSelection: { ...sel, NORMAL: { expression: "max(r1, r2)" } } }, C.INVALID_FORMULA);
    rejects(key, { naturalSelection: { ...sel, ADVANTAGE: { expression: "r1" } } }, C.INVALID_FORMULA);
    rejects(key, { naturalSelection: { NORMAL: sel.NORMAL, ADVANTAGE: sel.ADVANTAGE } });
    rejects(key, { naturalSelection: { ...sel, DOUBLE_ADVANTAGE: { expression: "max(r1, r2, r3)" } } });
    rejects(key, { comparison: { operator: ">", against: "TARGET_DODGE" } });
    rejects(key, { comparison: { operator: ">=", against: "TARGET_EVASION" } });
    rejects(key, { critical: { threat: "NATURAL_TWENTY", hit: "THREAT_AND_SUCCESS", damage: "DEFERRED" } });
    rejects(key, { critical: { threat: "NATURAL_EQUALS_DIE_FACES", hit: "THREAT_AND_SUCCESS", damage: "DOUBLE_DICE" } });
    rejects(key, { requiresSkill: true });
  });

  it("STAT_MASTERY grants a signal only — a numeric bonus is not representable", () => {
    const key = "core.resolution.stat_mastery";
    const m = payloadOf(key).mastery as Record<string, unknown>;
    rejects(key, { mastery: { ...m, signal: "BONUS" } });
    rejects(key, { mastery: { ...m, bonus: 2 } });
    rejects(key, { mastery: { ...m, signal: "DISADVANTAGE" } });
  });
});

describe("role index: exactly one Definition per core role", () => {
  it("a missing role fails closed", () => {
    for (const omit of ["core.stat.per", "core.character_die.progression", "core.rank_ladder.skill", "core.skill_rank.bonuses"]) {
      const { ruleset, definitions } = coreRuleset({ omit: [omit] });
      const bundle = createProwessDefinitionBundle({ ruleset, definitions });
      expect(bundle.ok && codes(indexCoreDefinitions(bundle.value)), omit).toEqual([K.MISSING_CORE_DEFINITION]);
    }
  });

  it("two Definitions claiming one role are ambiguous — never first-wins", () => {
    const { ruleset, definitions } = coreRuleset({ extra: [{ canonicalKey: "core.stat.per_alt", definitionKind: "STAT", payload: payloadOf("core.stat.per") }] });
    const bundle = createProwessDefinitionBundle({ ruleset, definitions });
    expect(bundle.ok && codes(indexCoreDefinitions(bundle.value))).toEqual([K.AMBIGUOUS_CORE_DEFINITION]);
  });

  it("a missing procedure or statistic fails the compilation that needs it, not others", () => {
    const partial = coreBundle({ omit: ["core.derived.accuracy"] });
    expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode: "NORMAL" }, characterL3(), partial))).toEqual([K.MISSING_CORE_DEFINITION]);
    expect(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "c", procedure: "CORE_ROLL", mode: "NORMAL", stat: "STR" }, characterL3(), partial).ok).toBe(true);
    const noAttack = coreBundle({ omit: ["core.resolution.attack_roll"] });
    expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode: "NORMAL" }, characterL3(), noAttack))).toEqual([K.MISSING_CORE_DEFINITION]);
  });

  it("a derived-statistic cycle is rejected by M4's dependency ordering", () => {
    const acc = payloadOf("core.derived.accuracy");
    const cyc = { ...acc, formula: { expression: "dodge", rounding: "NONE", variables: [{ variable: "dodge", source: { kind: "DERIVED", statistic: "DODGE" } }] } };
    const dodge = payloadOf("core.derived.dodge");
    const f = dodge.formula as { variables: object[]; expression: string };
    const { ruleset, definitions } = coreRuleset({ revise: { "core.derived.accuracy": cyc, "core.derived.dodge": { ...dodge, formula: { ...f, expression: `${f.expression} + acc`, variables: [...f.variables, { variable: "acc", source: { kind: "DERIVED", statistic: "ACCURACY" } }] } } } });
    const bundle = createProwessDefinitionBundle({ ruleset, definitions });
    expect(bundle.ok && codes(indexCoreDefinitions(bundle.value))).toContain(K.INCONSISTENT_CORE_DEFINITIONS);
  });
});

describe("CharacterCore", () => {
  const core = (() => {
    const out = indexCoreDefinitions(fixture.bundle);
    if (!out.ok) throw new Error("index");
    return out.value;
  })();
  const check = (patch: Record<string, unknown>) => codes(validateCharacterCore({ ...characterL3(), ...patch }, core));

  it("accepts a valid character and resolves its die", () => {
    const out = validateCharacterCore(characterL3(), core);
    expect(out.ok && out.value.resolvedDie).toEqual({ dieKey: "D6", faces: 6, levelMinimum: 3, levelMaximum: 4 });
  });

  it("every Stat 1–10 from the STAT Definitions; never clamped", () => {
    expect(check({ stats: { ...characterL3().stats, STR: 11 } })).toEqual([K.STAT_OUT_OF_RANGE]);
    expect(check({ stats: { ...characterL3().stats, AGI: 0 } })).toEqual([K.STAT_OUT_OF_RANGE]);
    expect(check({ stats: { ...characterL3().stats, PER: 4.5 } })).toEqual([K.INVALID_CHARACTER]);
    const five = Object.fromEntries(Object.entries(characterL3().stats).filter(([k]) => k !== "PRO"));
    expect(check({ stats: five })).toEqual([K.INVALID_CHARACTER]);
    expect(check({ stats: { ...characterL3().stats, LUCK: 3 } })).toEqual([K.INVALID_CHARACTER]);
  });

  it("levels 1–10 only; the stated Character Die must be the progression's die (never inferred or repaired)", () => {
    expect(check({ level: 11 })).toEqual([K.LEVEL_OUT_OF_RANGE]);
    expect(check({ level: 0 })).toEqual([K.LEVEL_OUT_OF_RANGE]);
    expect(check({ characterDie: { dieKey: "D8" } })).toEqual([K.CHARACTER_DIE_MISMATCH]);
    expect(check({ level: 5 })).toEqual([K.CHARACTER_DIE_MISMATCH]);
  });

  it("Skill ranks are ladder ranks; bonuses are uniquely keyed per target and stay named", () => {
    expect(check({ skillRanks: [{ skillKey: "skill.athletics", rankKey: "GRANDMASTER" }] })).toEqual([K.UNKNOWN_RANK]);
    expect(check({ skillRanks: [{ skillKey: "Athletics", rankKey: "TRAINED" }] })).toEqual([K.INVALID_CHARACTER]);
    const dup = { bonusKey: "cover", appliesTo: "DODGE", value: 2 };
    expect(check({ explicitBonuses: [dup, dup] })).toEqual([K.INVALID_CHARACTER]);
    expect(check({ explicitBonuses: [{ ...dup, appliesTo: "EVERYTHING" }] })).toEqual([K.INVALID_CHARACTER]);
    expect(check({ explicitBonuses: [dup, { ...dup, appliesTo: "CHARACTER_DC" }] })).toEqual([]);
  });

  it("unknown fields are refused (nothing hides in a CharacterCore)", () => {
    expect(check({ movement: 20 })).toEqual([K.INVALID_CHARACTER]);
  });
});

describe("M5-I043 dice are runtime input — never rolled here", () => {
  const d6 = { dieKey: "D6", faces: 6, levelMinimum: 3, levelMaximum: 4 };
  it("NORMAL takes exactly one roll, ADVANTAGE / DISADVANTAGE exactly two; each an integer 1…faces", () => {
    expect(validateDieRollInput(roll("D6", 6, "NORMAL", 6), d6).ok).toBe(true);
    expect(validateDieRollInput(roll("D6", 6, "ADVANTAGE", 1, 6), d6).ok).toBe(true);
    expect(codes(validateDieRollInput(roll("D6", 6, "NORMAL", 3, 4), d6))).toEqual([K.ROLL_COUNT_MISMATCH]);
    expect(codes(validateDieRollInput(roll("D6", 6, "ADVANTAGE", 3), d6))).toEqual([K.ROLL_COUNT_MISMATCH]);
    expect(codes(validateDieRollInput(roll("D6", 6, "DISADVANTAGE", 3, 4, 5), d6))).toEqual([K.ROLL_COUNT_MISMATCH]);
    for (const bad of [0, 7, -1, 2.5, Number.NaN]) expect(codes(validateDieRollInput(roll("D6", 6, "NORMAL", bad), d6)), String(bad)).toContain(bad !== bad ? C.NOT_PLAIN_DATA : K.ROLL_OUT_OF_RANGE);
    expect(codes(validateDieRollInput({ ...roll("D6", 6, "NORMAL", 3), rolls: ["3"] }, d6))).toEqual([K.ROLL_OUT_OF_RANGE]);
  });

  it("the roll must use the character's Character Die", () => {
    expect(codes(validateDieRollInput(roll("D8", 8, "NORMAL", 3), d6))).toEqual([K.DIE_MISMATCH]);
    expect(codes(validateDieRollInput(roll("D6", 8, "NORMAL", 3), d6))).toEqual([K.DIE_MISMATCH]);
  });

  it("a roll in a different mode than the compiled plan, or a missing roll, is refused", () => {
    const plan = compileWith({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode: "NORMAL" }, characterL3());
    if (!plan.ok) throw new Error("compile");
    expect(codes(buildCoreResolutionContexts({ definitions: fixture.bundle, character: characterL3(), plan: plan.value, roll: roll("D6", 6, "ADVANTAGE", 1, 6), targetDodge: 5 }))).toEqual([K.INVALID_ROLL_INPUT]);
    expect(codes(buildCoreResolutionContexts({ definitions: fixture.bundle, character: characterL3(), plan: plan.value, targetDodge: 5 }))).toEqual([K.INVALID_ROLL_INPUT]);
  });

  it("an ADVANTAGE plan run without the second natural blocks in M4 — nothing is defaulted", () => {
    const plan = compileWith({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode: "ADVANTAGE" }, characterL3());
    const normal = compileWith({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode: "NORMAL" }, characterL3());
    if (!plan.ok || !normal.ok) throw new Error("compile");
    const ctx = buildCoreResolutionContexts({ definitions: fixture.bundle, character: characterL3(), plan: normal.value, roll: roll("D6", 6, "NORMAL", 4), targetDodge: 5 });
    if (!ctx.ok) throw new Error("ctx");
    const run = orchestrateRulesEvaluation({ evaluationKey: "x", contexts: { ruleset: fixture.ruleset, actor: ctx.value.actor, runtime: ctx.value.runtime }, plan: plan.value.evaluationPlan });
    const natural = run.data?.steps.find((s) => s.stepKey === plan.value.outputs.natural);
    expect(natural?.executionStatus).toBe("BLOCKED");
  });

  it("resolveRollMode rejects malformed signal sets", () => {
    expect(codes(resolveRollMode({ advantage: "yes", disadvantage: [] }))).toEqual([K.INVALID_ROLL_INPUT]);
    expect(codes(resolveRollMode(null))).toEqual([K.INVALID_ROLL_INPUT]);
  });
});

describe("compileCoreResolution request contract", () => {
  const base = { kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode: "NORMAL" };
  it("fails closed on contract version, subject shape and procedure-specific fields", () => {
    expect(codes(compileCoreResolution({ contractVersion: 2, subject: base, definitions: fixture.bundle, ruleset: fixture.ruleset, character: characterL3() }))).toEqual([X.UNSUPPORTED_CONTRACT_VERSION]);
    const noMode = Object.fromEntries(Object.entries(base).filter(([k]) => k !== "mode"));
    expect(codes(compileWith(noMode, characterL3()))).toEqual([K.INVALID_CORE_REQUEST]);
    expect(codes(compileWith({ ...base, stat: "AGI" }, characterL3()))).toEqual([K.INVALID_CORE_REQUEST]);
    expect(codes(compileWith({ ...base, skillKey: "skill.athletics" }, characterL3()))).toEqual([K.INVALID_CORE_REQUEST]);
    expect(codes(compileWith({ ...base, procedure: "STAT_MASTERY" }, characterL3()))).toEqual([X.INVALID_REQUEST]);
    expect(codes(compileWith({ ...base, procedure: "SKILL_CHECK", stat: "STR" }, characterL3()))).toEqual([K.INVALID_CORE_REQUEST]);
    expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "SKILL_AUTOMATIC_SUCCESS", stat: "STR", skillKey: "skill.athletics", mode: "NORMAL" }, characterL3()))).toEqual([K.INVALID_CORE_REQUEST]);
    expect(codes(compileWith({ ...base, subjectKey: "a:b" }, characterL3()))).toEqual([X.INVALID_REQUEST]);
    expect(codes(compileWith({ kind: "MOVEMENT", subjectKey: "a" }, characterL3()))).toEqual([X.INVALID_REQUEST]);
  });

  it("the bundle must be exactly the request Ruleset's bundle; Definitions cannot be injected", () => {
    const other = coreBundle({ rulesetId: "00000000-0000-4000-8000-000000007011", manifestId: "00000000-0000-4000-8000-000000007012" });
    expect(codes(compileCoreResolution({ contractVersion: 1, subject: base, definitions: other.bundle, ruleset: fixture.ruleset, character: characterL3() }))).toContain(B.RULESET_MISMATCH);
    expect(codes(compileCoreResolution({ contractVersion: 1, subject: base, definitions: { ...fixture.bundle, rulesetProvenance: other.bundle.rulesetProvenance }, ruleset: fixture.ruleset, character: characterL3() }))).toEqual([X.BUNDLE_RULESET_MISMATCH]);
  });

  it("an invalid character is reported under /character", () => {
    const out = compileWith(base, { ...characterL3(), level: 12 });
    expect(!out.ok && out.problems.map((p) => [p.code, p.path])).toEqual([[K.LEVEL_OUT_OF_RANGE, "/character/level"]]);
  });
});

describe("source map and provenance", () => {
  const r = runCore({ kind: "CORE_RESOLUTION", subjectKey: "strike", procedure: "ATTACK_ROLL", mode: "ADVANTAGE" }, characterL3(), { roll: roll("D6", 6, "ADVANTAGE", 2, 5), targetDodge: 8 });

  it("one source-map entry per step, each citing exact bundle Definitions", () => {
    expect(r.plan.sourceMap.entries.map((e) => e.stepKey)).toEqual(r.plan.evaluationPlan.steps.map((s) => s.stepKey));
    const ids = new Set(fixture.bundle.definitions.map((d) => d.entityVersionId));
    for (const e of r.plan.sourceMap.entries) {
      expect(e.definitions.length, e.stepKey).toBeGreaterThan(0);
      for (const d of e.definitions) expect(ids.has(d.entityVersionId)).toBe(true);
    }
    const byRole = Object.fromEntries(r.plan.sourceMap.entries.map((e) => [e.role, e.definitions.map((d) => d.canonicalKey).sort()]));
    expect(byRole["roll-total:ATTACK_ROLL"]).toEqual(["core.derived.accuracy", "core.resolution.attack_roll", "core.stat.per"]);
    expect(byRole["critical-threat:natural-equals-die-faces"]).toEqual(["core.character_die.progression", "core.resolution.attack_roll"]);
    expect(byRole["stat-mastery-signal:PER"]).toEqual(["core.resolution.stat_mastery", "core.stat.per"]);
  });

  it("every M4 Formula program and Requirement carries the exact Definition's rule provenance", () => {
    for (const step of r.plan.evaluationPlan.steps.filter((s) => s.operation === "FORMULA")) {
      const prov = (step.input.program as { provenance: Record<string, string> }).provenance;
      expect(prov.rulesetId).toBe(fixture.ruleset.rulesetId);
      expect(fixture.bundle.definitions.some((d) => d.entityVersionId === prov.entityVersionId)).toBe(true);
    }
    const totalStep = r.run.steps.find((s) => s.stepKey === r.plan.outputs.total);
    expect(JSON.stringify(totalStep?.response)).toContain("core.resolution.attack_roll");
  });

  it("step keys are deterministic: prowess:CORE_RESOLUTION:<subjectKey>:<fragment>", () => {
    expect(r.plan.outputs.total).toBe("prowess:CORE_RESOLUTION:strike:total");
    expect(r.plan.evaluationPlan.primaryStepKey).toBe("prowess:CORE_RESOLUTION:strike:success");
  });
});

describe("M5-I050 no hidden math: the plan holds programs, never results", () => {
  it("no computed total, natural, Dodge or DC appears in the compiled plan", () => {
    const c = { ...characterL3(), stats: { STR: 7, AGI: 7, CON: 7, PER: 7, RES: 7, PRO: 7 } };
    const plan = compileWith({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode: "NORMAL" }, c);
    if (!plan.ok) throw new Error("compile");
    const numbers = JSON.stringify(plan.value.evaluationPlan).match(/:(-?\d+(\.\d+)?)[,}]/g) ?? [];
    // Only authored positions, bounds and placeholders: step orders, AST offsets, zero placeholders, Stat Mastery thresholds.
    expect(new Set(numbers.map((n) => n.slice(1, -1)))).toEqual(new Set(["-1", "0", "1010", "1030", "1040", "1050", "1000", "10"]));
  });
});

describe("determinism, immutability, security and serialization", () => {
  const subject = { kind: "CORE_RESOLUTION", subjectKey: "s", procedure: "SKILL_CHECK", mode: "DISADVANTAGE", stat: "STR", skillKey: "skill.athletics" };

  it("equal requests give deep-equal, deep-frozen, JSON-round-trippable plans; inputs are not mutated", () => {
    const character = characterL3();
    const before = JSON.stringify([character, fixture.bundle]);
    const a = compileWith(subject, character);
    const b = compileWith(JSON.parse(JSON.stringify(subject)) as Record<string, unknown>, JSON.parse(JSON.stringify(character)));
    expect(a).toEqual(b);
    expect(JSON.stringify([character, fixture.bundle])).toBe(before);
    if (!a.ok) throw new Error("compile");
    expect(Object.isFrozen(a.value) && Object.isFrozen(a.value.evaluationPlan.steps[0]) && Object.isFrozen(a.value.outputs)).toBe(true);
    expect(JSON.parse(JSON.stringify(a.value))).toEqual(a.value);
  });

  it("bundle definition order does not matter", () => {
    const { ruleset, definitions } = coreRuleset();
    const reversed = createProwessDefinitionBundle({ ruleset, definitions: [...definitions].reverse() });
    if (!reversed.ok) throw new Error("bundle");
    expect(compileWith(subject, characterL3(), { ruleset, bundle: reversed.value })).toEqual(compileWith(subject, characterL3()));
  });

  it("repeated M4 runs give identical results (no clock, no randomness)", () => {
    const run = () => runCore(subject, characterL3(), { roll: roll("D6", 6, "DISADVANTAGE", 5, 3), difficultyClass: 8 }).run;
    expect(run()).toEqual(run());
  });

  it("rejects getters, prototype pollution, cycles and non-finite numbers before reading anything", () => {
    const getter = { ...characterL3() };
    Object.defineProperty(getter, "level", { get: () => 3, enumerable: true });
    expect(codes(compileWith(subject, getter))).toContain(C.NOT_PLAIN_DATA);
    const polluted = JSON.parse(`{"kind":"CORE_RESOLUTION","subjectKey":"s","procedure":"CORE_ROLL","mode":"NORMAL","stat":"STR","__proto__":{"admin":true}}`);
    expect(codes(compileWith(polluted, characterL3()))).toContain(C.NOT_PLAIN_DATA);
    const cyclic: Record<string, unknown> = { ...characterL3() };
    cyclic.self = cyclic;
    expect(codes(compileWith(subject, cyclic))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(compileWith(subject, { ...characterL3(), baseHp: Number.POSITIVE_INFINITY }))).toContain(C.NOT_PLAIN_DATA);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("a hostile skillKey or bonusKey cannot address a prototype or escape its JSON Pointer", () => {
    expect(codes(compileWith({ ...subject, skillKey: "__proto__.x" }, characterL3()))).toEqual([X.INVALID_REQUEST]);
    expect(codes(compileWith(subject, { ...characterL3(), explicitBonuses: [{ bonusKey: "a/b~c", appliesTo: "SKILL_CHECK", value: 1 }] }))).toEqual([K.INVALID_CHARACTER]);
    expect(codes(compileWith(subject, { ...characterL3(), explicitBonuses: [{ bonusKey: "__proto__", appliesTo: "SKILL_CHECK", value: 1 }] }))).toEqual([K.INVALID_CHARACTER]);
  });
});

describe("M5-I045 / M5-I046 / M5-I061 Stat identities, bounds and Save selection", () => {
  it("M5-I045 exactly six canonical Ability Scores, each with one STAT Definition", () => {
    expect([...PROWESS_STATS]).toEqual(["STR", "AGI", "CON", "PER", "RES", "PRO"]);
    expect(CORE_DEFINITIONS.filter((d) => d.definitionKind === "STAT").map((d) => d.payload.stat)).toEqual(["STR", "AGI", "CON", "PER", "RES", "PRO"]);
  });

  it("M5-I046 every standard Stat is bounded 1–10 by content", () => {
    for (const d of CORE_DEFINITIONS.filter((x) => x.definitionKind === "STAT")) expect([d.payload.minimum, d.payload.maximum], d.canonicalKey).toEqual([1, 10]);
  });

  it("M5-I061 Targeting never selects a Saving Throw (M5-I022 carried forward)", () => {
    const out = createEnvelopeFor("SPELL_TARGETING", { semanticShape: "RADIUS", geometry: { radius: 2, saveStat: "AGI" } });
    expect(codes(out)).toContain(C.TARGETING_IMPLIES_OUTCOME);
  });

  it("functions and oversized / wrong-typed inputs are refused", () => {
    expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "s", procedure: "CORE_ROLL", mode: "NORMAL", stat: "STR" }, { ...characterL3(), level: () => 3 }))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "x".repeat(500), procedure: "CORE_ROLL", mode: "NORMAL", stat: "STR" }, characterL3()))).toEqual([X.INVALID_REQUEST]);
    expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "s", procedure: "CORE_ROLL", mode: "NORMAL", stat: "STR" }, { ...characterL3(), level: "3" }))).toEqual([K.INVALID_CHARACTER]);
    expect(codes(validateDieRollInput({ ...roll("D6", 6, "NORMAL", 3), extra: true }, { dieKey: "D6", faces: 6, levelMinimum: 3, levelMaximum: 4 }))).toEqual([K.INVALID_ROLL_INPUT]);
  });

  it("caller mutation after compile cannot change the compiled plan", () => {
    const character = characterL3();
    const plan = compileWith({ kind: "CORE_RESOLUTION", subjectKey: "s", procedure: "CORE_ROLL", mode: "NORMAL", stat: "STR" }, character);
    const snapshot = JSON.stringify(plan);
    character.stats.STR = 9;
    character.explicitBonuses.push({ bonusKey: "late", appliesTo: "CORE_ROLL", value: 5 });
    expect(JSON.stringify(plan)).toBe(snapshot);
    expect(Object.isFrozen(character)).toBe(false);
  });
});

function createEnvelopeFor(kind: "SPELL_TARGETING", payload: Record<string, unknown>) {
  return createProwessDefinitionEnvelope({
    schemaVersion: 1,
    systemFamily: "SPELL",
    definitionKind: kind,
    entityId: "00000000-0000-4000-8000-000000000001",
    entityVersionId: "00000000-0000-4000-8000-000000000002",
    canonicalKey: "spell.targeting.radius",
    payload,
    provenance: { rulesetId: "00000000-0000-4000-8000-000000000003", manifestId: "00000000-0000-4000-8000-000000000004", releaseId: null, sourceRulesetId: null, sourceManifestId: null, legacyTerms: [] },
  });
}
