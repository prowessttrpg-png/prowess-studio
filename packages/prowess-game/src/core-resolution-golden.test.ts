import { describe, expect, it } from "vitest";
import { evaluateRequirement } from "@prowess/rules";
import {
  CORE_ERROR_CODES as K,
  DEFINITION_ERROR_CODES as C,
  indexCoreDefinitions,
  legacyTermFor,
  rankAtLeastRequirement,
  rankFact,
  resolveCharacterDie,
  resolveRollMode,
} from "./index.js";
import { CORE_DEFINITIONS, coreBundle, coreRuleset } from "./testing/core-fixtures.js";
import { codes, compileWith, roll, runCore } from "./testing/core-run.js";
import { createProwessDefinitionBundle } from "./bundle/bundle.js";
import type { CharacterDieProgressionPayload } from "./definition/core-payload.js";

/**
 * M5-WO2 golden fixtures (§123–142). Every expected value is a Core Playtest V0.1 rule as amended by the designer rulings
 * of M5-WO2 (M5-SC-002 / 003 / 005 / 008 / 009 / 010) and is produced by the frozen M4 engine running a plan compiled
 * from the canonical content file — never by TypeScript arithmetic.
 *
 * Guards: M5-I041 Player Die legacy · M5-I042 progression is data · M5-I044 half die · M5-I047 rank order vs meaning ·
 * M5-I048 Skill bonuses · M5-I049 approach Stat · M5-I050 M4 arithmetic · M5-I051 Advantage · M5-I052 Disadvantage ·
 * M5-I053 natural preserved · M5-I054 Attack Roll · M5-I055 Accuracy · M5-I057 Dodge · M5-I058 threat ≠ hit ·
 * M5-I059 critical hit · M5-I060 Saving Throws · M5-I062 Character DC · M5-I063 HP · M5-I064 MP · M5-I065 racial base
 * values · M5-I066 Strength Armor · M5-I067 AP · M5-I068 Base Range · M5-I069 Mana Efficiency · M5-I070 Signature
 * capacity · M5-I071 automatic success · M5-I072 Stat Mastery · M5-I073 Movement deferred · M5-I074 derived via M4.
 */
type Stats = { STR: number; AGI: number; CON: number; PER: number; RES: number; PRO: number };
const DIE: Record<number, [string, number]> = { 1: ["D4", 4], 2: ["D4", 4], 3: ["D6", 6], 4: ["D6", 6], 5: ["D8", 8], 6: ["D8", 8], 7: ["D10", 10], 8: ["D10", 10], 9: ["D12", 12], 10: ["D12", 12] };
const character = (level: number, stats: Partial<Stats> = {}, extra: Record<string, unknown> = {}) => ({
  level,
  characterDie: { dieKey: DIE[level]?.[0] ?? "D4" },
  stats: { STR: 3, AGI: 3, CON: 3, PER: 3, RES: 3, PRO: 3, ...stats },
  baseHp: 8,
  baseMp: 6,
  skillRanks: [],
  explicitBonuses: [],
  ...extra,
});
const dieRoll = (level: number, mode: string, ...rolls: number[]) => roll(DIE[level]?.[0] ?? "", DIE[level]?.[1] ?? 0, mode, ...rolls);
const sheet = (c: unknown) => runCore({ kind: "DERIVED_STATISTICS", subjectKey: "sheet" }, c);
const progression = CORE_DEFINITIONS.find((d) => d.definitionKind === "CHARACTER_DIE_PROGRESSION")?.payload as unknown as CharacterDieProgressionPayload;
const L8 = 5; // a d8 character (Level 5)
const bonus = (bonusKey: string, appliesTo: string, value: number, category?: string) => ({ bonusKey, appliesTo, value, ...(category === undefined ? {} : { category }) });

describe("§123 CORE GOLDEN — Level / Character Die (M5-I042)", () => {
  it("L1 d4 · L2 d4 · L3 d6 · L5 d8 · L7 d10 · L9 d12 · L10 d12 — resolved from structured progression data", () => {
    const expected = [[1, "D4", 4, 1, 2], [2, "D4", 4, 1, 2], [3, "D6", 6, 3, 4], [4, "D6", 6, 3, 4], [5, "D8", 8, 5, 6], [6, "D8", 8, 5, 6], [7, "D10", 10, 7, 8], [8, "D10", 10, 7, 8], [9, "D12", 12, 9, 10], [10, "D12", 12, 9, 10]] as const;
    for (const [level, dieKey, faces, levelMinimum, levelMaximum] of expected) expect(resolveCharacterDie(progression, level)).toEqual({ dieKey, faces, levelMinimum, levelMaximum });
  });

  it("levels outside 1–10 are not Core Playtest levels (§23)", () => {
    for (const level of [0, 11, -1, 2.5, 100]) expect(resolveCharacterDie(progression, level), String(level)).toBeNull();
  });
});

describe("§124 CORE GOLDEN — Half Character Die is the static half-maximum face (M5-I044)", () => {
  it("d4 → 2 · d6 → 3 · d8 → 4 · d10 → 5 · d12 → 6, evaluated by M4 with no roll input", () => {
    for (const [level, half] of [[1, 2], [3, 3], [5, 4], [7, 5], [9, 6]] as const) {
      const r = sheet(character(level));
      expect(r.derived("HALF_CHARACTER_DIE"), String(level)).toBe(half);
      expect(r.plan.subject.mode).toBeNull();
    }
  });
});

describe("§125 CORE GOLDEN — HP / MP (M5-I063 / M5-I064 / M5-I065)", () => {
  it("Base HP 10 + CON 4 = 14; Base MP 4 + RES 2 = 6 — racial base values, never multipliers", () => {
    const r = sheet(character(1, { CON: 4, RES: 2 }, { baseHp: 10, baseMp: 4 }));
    expect([r.derived("MAXIMUM_HP"), r.derived("MAXIMUM_MP")]).toEqual([14, 6]);
    expect([10 * 4, 4 * 2]).not.toContain(r.derived("MAXIMUM_HP"));
  });
});

describe("§126 CORE GOLDEN — Dodge (M5-I057)", () => {
  it("d8, AGI 3, PER 6: Half d8 4 + AGI 3 + floor(6/3) 2 = 9 — the PER term is its own named statistic", () => {
    const r = sheet(character(L8, { AGI: 3, PER: 6 }));
    expect([r.derived("HALF_CHARACTER_DIE"), r.derived("DODGE_PERCEPTION_BONUS"), r.derived("DODGE")]).toEqual([4, 2, 9]);
  });

  it("other explicit Dodge bonuses are separate named terms (e.g. Partial Cover +2)", () => {
    expect(sheet(character(L8, { AGI: 3, PER: 6 }, { explicitBonuses: [bonus("partial_cover", "DODGE", 2, "COVER")] })).derived("DODGE")).toBe(11);
  });
});

describe("§127 CORE GOLDEN — Character DC (M5-I062)", () => {
  it("d8, PRO 4, RES 6, no other bonus: Half d8 4 + PRO 4 + floor(6/3) 2 = 10", () => {
    const r = sheet(character(L8, { PRO: 4, RES: 6 }));
    expect([r.derived("CHARACTER_DC_RESOLVE_BONUS"), r.derived("CHARACTER_DC")]).toEqual([2, 10]);
  });

  it("§109 explanation example: Half d8 4 + PRO 5 + Resolve +2 + other +1 = 12", () => {
    expect(sheet(character(L8, { PRO: 5, RES: 6 }, { explicitBonuses: [bonus("focus", "CHARACTER_DC", 1)] })).derived("CHARACTER_DC")).toBe(12);
  });

  it("Resolve DC bonus table: RES 1–2 → 0 · 3–5 → 1 · 6–8 → 2 · 9–10 → 3", () => {
    const res = (RES: number) => sheet(character(1, { RES })).derived("CHARACTER_DC_RESOLVE_BONUS");
    expect([1, 2, 3, 5, 6, 8, 9, 10].map(res)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe("§128 CORE GOLDEN — Accuracy (M5-I055)", () => {
  it("PRO 2 → 0 · 3 → 1 · 5 → 1 · 6 → 2 · 8 → 2 · 9 → 3 · 10 → 3", () => {
    const acc = (PRO: number) => sheet(character(1, { PRO })).derived("ACCURACY");
    expect([2, 3, 5, 6, 8, 9, 10].map(acc)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});

describe("§129–§130 CORE GOLDEN — Attack and Critical (M5-I054 / M5-I058 / M5-I059)", () => {
  const attacker = character(L8, { PER: 4, PRO: 6 }, { explicitBonuses: [bonus("weapon", "ATTACK_ROLL", 1, "EQUIPMENT")] });
  const attack = (natural: number, targetDodge: number, mode = "NORMAL", ...rest: number[]) =>
    runCore({ kind: "CORE_RESOLUTION", subjectKey: "strike", procedure: "ATTACK_ROLL", mode }, attacker, { roll: dieRoll(L8, mode, natural, ...rest), targetDodge });

  it("§129 d8 natural 5 + PER 4 + Accuracy 2 + other +1 = 12 against Dodge 11 → HIT", () => {
    const r = attack(5, 11);
    expect([r.natural, r.total, r.success]).toEqual([5, 12, true]);
    expect(r.value(r.plan.outputs.derived.ACCURACY ?? null)).toBe(2);
  });

  it("§130 d8 natural 8, Attack total 12, Dodge 11: Critical threat, hit, Critical Hit", () => {
    const strong = character(L8, { PER: 1, PRO: 2 }, { explicitBonuses: [bonus("weapon", "ATTACK_ROLL", 3)] });
    const r = runCore({ kind: "CORE_RESOLUTION", subjectKey: "crit", procedure: "ATTACK_ROLL", mode: "NORMAL" }, strong, { roll: dieRoll(L8, "NORMAL", 8), targetDodge: 11 });
    expect([r.natural, r.total, r.criticalThreat, r.success, r.criticalHit]).toEqual([8, 12, true, true, true]);
  });

  it("§130 control: d8 natural 8, total 10, Dodge 11: threat, MISS, no Critical Hit — a maximum natural never auto-hits", () => {
    const weak = character(L8, { PER: 1, PRO: 2 }, { explicitBonuses: [bonus("weapon", "ATTACK_ROLL", 1)] });
    const r = runCore({ kind: "CORE_RESOLUTION", subjectKey: "crit", procedure: "ATTACK_ROLL", mode: "NORMAL" }, weak, { roll: dieRoll(L8, "NORMAL", 8), targetDodge: 11 });
    expect([r.natural, r.total, r.criticalThreat, r.success, r.criticalHit]).toEqual([8, 10, true, false, false]);
  });

  it("critical damage is deferred: no damage step, no maximized dice", () => {
    const r = attack(8, 11);
    expect(r.plan.sourceMap.entries.filter((e) => /damage/i.test(e.role))).toEqual([]);
  });

  it("§70 criticals use the SELECTED natural only: Advantage d8 [8, 3] threatens; Disadvantage d8 [8, 3] does not", () => {
    expect(attack(8, 11, "ADVANTAGE", 3).criticalThreat).toBe(true);
    const dis = attack(8, 11, "DISADVANTAGE", 3);
    expect([dis.natural, dis.criticalThreat, dis.criticalHit]).toEqual([3, false, false]);
  });
});

describe("§131–§132 CORE GOLDEN — Advantage / Disadvantage (M5-I051 / M5-I052 / M5-I053)", () => {
  const c = character(L8, { PER: 4, PRO: 4 });
  const atk = (mode: string, ...rolls: number[]) => runCore({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode }, c, { roll: dieRoll(L8, mode, ...rolls), targetDodge: 9 });

  it("§131 d8 [3, 7] with Advantage: selected 7 + PER 4 + Accuracy 1 = 12", () => {
    const r = atk("ADVANTAGE", 3, 7);
    expect([r.natural, r.total]).toEqual([7, 12]);
  });

  it("§132 d8 [3, 7] with Disadvantage: selected 3 + PER 4 + Accuracy 1 = 8", () => {
    const r = atk("DISADVANTAGE", 3, 7);
    expect([r.natural, r.total]).toEqual([3, 8]);
  });

  it("roll order does not matter, and modifiers are added once after selection", () => {
    const withBonus = character(L8, { PER: 4, PRO: 4 }, { explicitBonuses: [bonus("aim", "ATTACK_ROLL", 2)] });
    for (const [mode, rolls, natural] of [["ADVANTAGE", [7, 3], 7], ["DISADVANTAGE", [7, 3], 3]] as const) {
      const r = runCore({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode }, withBonus, { roll: dieRoll(L8, mode, ...rolls), targetDodge: 9 });
      expect([r.natural, r.total]).toEqual([natural, natural + 4 + 1 + 2]);
    }
  });

  it("the natural-selection step reads only the natural rolls; bonuses enter only the total step", () => {
    const r = atk("ADVANTAGE", 3, 7);
    const natural = r.plan.evaluationPlan.steps.find((s) => s.stepKey === r.plan.outputs.natural);
    expect(natural?.input.program).toMatchObject({ expression: "max(r1, r2)" });
    expect(natural?.bindings.map((b) => b.target)).toEqual(["/variables/r1", "/variables/r2"]);
    const total = r.plan.evaluationPlan.steps.find((s) => s.stepKey === r.plan.outputs.total);
    expect(total?.bindings.filter((b) => b.source.kind === "STEP" && b.source.stepKey === r.plan.outputs.natural)).toHaveLength(1);
  });

  it("only NORMAL / ADVANTAGE / DISADVANTAGE exist; duplicate signals collapse; Advantage + Disadvantage fails closed", () => {
    expect(resolveRollMode({ advantage: [], disadvantage: [] })).toEqual({ ok: true, value: "NORMAL" });
    expect(resolveRollMode({ advantage: ["a", "b", "c"], disadvantage: [] })).toEqual({ ok: true, value: "ADVANTAGE" });
    expect(resolveRollMode({ advantage: [], disadvantage: ["x", "y"] })).toEqual({ ok: true, value: "DISADVANTAGE" });
    expect(codes(resolveRollMode({ advantage: ["a"], disadvantage: ["d"] }))).toEqual([K.ROLL_MODE_CONFLICT]);
    for (const mode of ["DOUBLE_ADVANTAGE", "TRIPLE_ADVANTAGE", "DOUBLE_DISADVANTAGE", "advantage"]) {
      expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "a", procedure: "ATTACK_ROLL", mode }, c)), mode).toEqual(["PROWESS_COMPILATION.INVALID_REQUEST"]);
    }
  });
});

describe("§133 CORE GOLDEN — Skill Ranks (M5-I047 / M5-I048 / M5-I049)", () => {
  const totalAt = (rankKey: string | null, stat = "PRO") => {
    const c = character(1, { PRO: 1, STR: 5 }, { skillRanks: rankKey === null ? [] : [{ skillKey: "skill.athletics", rankKey }] });
    return runCore({ kind: "CORE_RESOLUTION", subjectKey: "x", procedure: "SKILL_CHECK", mode: "NORMAL", stat, skillKey: "skill.athletics", attemptPermitted: true }, c, { roll: dieRoll(1, "NORMAL", 1), difficultyClass: 20 }).total;
  };

  it("UNTRAINED +0 · TRAINED +2 · EXPERT +4 · MASTER +6 (natural 1 + PRO 1 + bonus)", () => {
    expect([totalAt("UNTRAINED"), totalAt("TRAINED"), totalAt("EXPERT"), totalAt("MASTER")]).toEqual([2, 4, 6, 8]);
  });

  it("UNTRAINED is a rank with attemptAllowed false — explicit permission is required; an unlisted Skill is UNTRAINED, not absent", () => {
    expect(totalAt(null)).toBe(2);
    const c = character(1, {}, { skillRanks: [{ skillKey: "skill.arcana", rankKey: "UNTRAINED" }] });
    expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "x", procedure: "SKILL_CHECK", mode: "NORMAL", stat: "PRO", skillKey: "skill.arcana" }, c))).toEqual([K.ATTEMPT_REQUIRES_PERMISSION]);
  });

  it("the Stat is chosen by the approach: the same Athletics Skill with STR and with PRO", () => {
    expect([totalAt("TRAINED", "STR"), totalAt("TRAINED", "PRO")]).toEqual([8, 4]);
  });

  it("rank order is explicit ladder data and compiles to M4 RANK_AT_LEAST — independent of the bonus values", () => {
    const { bundle } = coreBundle();
    const core = indexCoreDefinitions(bundle);
    if (!core.ok) throw new Error("index");
    const ladder = core.value.skillLadder;
    expect(ladder.payload.ranks.map((r) => [r.rankKey, r.order])).toEqual([["UNTRAINED", 0], ["TRAINED", 1], ["EXPERT", 2], ["MASTER", 3]]);
    const requiresExpert = rankAtLeastRequirement(ladder, "skill.athletics", "EXPERT");
    if (!requiresExpert.ok) throw new Error("requirement");
    const satisfied = (held: string) => {
      const fact = rankFact(ladder, "skill.athletics", held);
      if (!fact.ok) throw new Error("fact");
      return evaluateRequirement(requiresExpert.value, { ranks: [fact.value] }).data?.satisfied;
    };
    // Alphabetical order would put EXPERT < MASTER < TRAINED < UNTRAINED; the ladder order is what decides.
    expect(["UNTRAINED", "TRAINED", "EXPERT", "MASTER"].map(satisfied)).toEqual([false, false, true, true]);
    expect(codes(rankAtLeastRequirement(ladder, "skill.athletics", "GRANDMASTER"))).toEqual([K.UNKNOWN_RANK]);
  });
});

describe("§134 CORE GOLDEN — Automatic Skill Success (M5-I071)", () => {
  it("Stat 3 + Expert 4 = 7 against DC 7 → automatic success, no Character Die result required", () => {
    const c = character(3, { RES: 3 }, { skillRanks: [{ skillKey: "skill.insight", rankKey: "EXPERT" }] });
    const r = runCore({ kind: "CORE_RESOLUTION", subjectKey: "auto", procedure: "SKILL_AUTOMATIC_SUCCESS", stat: "RES", skillKey: "skill.insight" }, c, { difficultyClass: 7 });
    expect([r.automaticTotal, r.automaticSuccess, r.natural, r.total]).toEqual([7, true, null, null]);
    expect(JSON.stringify(r.plan.evaluationPlan)).not.toContain("roll.r1");
  });

  it("a Skill Check plan exposes BOTH the automatic-success check and the rolled check; both run, nothing is skipped", () => {
    const c = character(3, { RES: 3 }, { skillRanks: [{ skillKey: "skill.insight", rankKey: "EXPERT" }] });
    const r = runCore({ kind: "CORE_RESOLUTION", subjectKey: "chk", procedure: "SKILL_CHECK", mode: "NORMAL", stat: "RES", skillKey: "skill.insight" }, c, { roll: dieRoll(3, "NORMAL", 2), difficultyClass: 8 });
    expect([r.automaticTotal, r.automaticSuccess, r.total, r.success]).toEqual([7, false, 9, true]);
    expect(r.run.steps.every((s) => s.executionStatus === "EXECUTED")).toBe(true);
  });
});

describe("§135 CORE GOLDEN — Saving Throw (M5-I060)", () => {
  it("d6 natural 4 + CON 5 + Save bonus 1 = 10", () => {
    const c = character(3, { CON: 5 }, { explicitBonuses: [bonus("ward", "SAVING_THROW", 1)] });
    expect(runCore({ kind: "CORE_RESOLUTION", subjectKey: "save.con", procedure: "SAVING_THROW", mode: "NORMAL", stat: "CON" }, c, { roll: dieRoll(3, "NORMAL", 4), difficultyClass: 10 }).total).toBe(10);
  });

  it("every one of the six Stats is a valid Save Stat; the Save Stat is always explicit", () => {
    const c = character(7, { STR: 1, AGI: 2, CON: 3, PER: 4, RES: 5, PRO: 6 });
    const totals = (["STR", "AGI", "CON", "PER", "RES", "PRO"] as const).map((stat) => runCore({ kind: "CORE_RESOLUTION", subjectKey: "s", procedure: "SAVING_THROW", mode: "NORMAL", stat }, c, { roll: dieRoll(7, "NORMAL", 4), difficultyClass: 9 }).total);
    expect(totals).toEqual([5, 6, 7, 8, 9, 10]);
    expect(codes(compileWith({ kind: "CORE_RESOLUTION", subjectKey: "s", procedure: "SAVING_THROW", mode: "NORMAL" }, c))).toEqual([K.INVALID_CORE_REQUEST]);
  });
});

describe("§136–§140 CORE GOLDEN — character statistics (M5-I066 / M5-I067 / M5-I068 / M5-I069 / M5-I070 / M5-I074)", () => {
  it("§136 Strength Armor: STR 2 → 0 · 3 → 1 · 6 → 2 · 9 → 3 · 10 → 3", () => {
    expect([2, 3, 6, 9, 10].map((STR) => sheet(character(1, { STR })).derived("STRENGTH_ARMOR"))).toEqual([0, 1, 2, 3, 3]);
  });

  it("§137 AP: AGI 2 → bonus 0, capacity 3; AGI 6 → bonus 2, capacity 5", () => {
    const ap = (AGI: number) => {
      const r = sheet(character(1, { AGI }));
      return [r.derived("AP_AGILITY_BONUS"), r.derived("BASE_AP_CAPACITY")];
    };
    expect([ap(2), ap(6)]).toEqual([[0, 3], [2, 5]]);
  });

  it("§138 Base Range: PER 4 → 60 ft (unit carried by the M4 Formula)", () => {
    const r = sheet(character(1, { PER: 4 }));
    expect(r.derived("BASE_RANGE")).toBe(60);
    const step = r.run.steps.find((s) => s.stepKey === r.plan.outputs.derived.BASE_RANGE);
    expect((step?.response?.data as { unit: string }).unit).toBe("ft");
  });

  it("§139 Mana Efficiency: PRO 5 → Base ME 5; no listed cost changes (ME is payment, not a discount)", () => {
    expect(sheet(character(1, { PRO: 5 })).derived("BASE_MANA_EFFICIENCY")).toBe(5);
    const me = CORE_DEFINITIONS.find((d) => d.canonicalKey === "core.derived.base_mana_efficiency");
    expect((me?.payload as { formula: { expression: string } }).formula.expression).toBe("pro");
    expect(JSON.stringify(CORE_DEFINITIONS)).not.toMatch(/listed|discount|cost/i);
  });

  it("§140 Signature capacity: PRO 4 → 4; Counter Action base capacity 1", () => {
    const r = sheet(character(1, { PRO: 4 }));
    expect([r.derived("SIGNATURE_ABILITY_SLOTS"), r.derived("COUNTER_ACTION_CAPACITY")]).toEqual([4, 1]);
  });

  it("M5-I074 every statistic is an M4 FORMULA step; no Resource transition is compiled", () => {
    const r = sheet(character(4));
    expect(new Set(r.plan.evaluationPlan.steps.map((s) => s.operation))).toEqual(new Set(["FORMULA"]));
  });
});

describe("§141 STAT MASTERY GOLDEN (M5-I072)", () => {
  const mastery = (level: number, STR: number, mode = "NORMAL", ...rolls: number[]) =>
    runCore({ kind: "CORE_RESOLUTION", subjectKey: "lift", procedure: "CORE_ROLL", mode, stat: "STR" }, character(level, { STR }), { roll: dieRoll(level, mode, ...(rolls.length > 0 ? rolls : [5])), difficultyClass: 12 });

  it("Level 10, STR 10, a STR roll → ADVANTAGE signal, not a numeric bonus", () => {
    const met = mastery(10, 10);
    expect(met.masterySignal).toEqual({ advantage: ["stat_mastery.str"], disadvantage: [] });
    expect(met.total).toBe(15);
  });

  it("Level 9 or STR 9 → no signal; the Stat stays 10 and the total is never raised", () => {
    expect(mastery(9, 10).masterySignal).toEqual({ advantage: [], disadvantage: [] });
    expect(mastery(10, 9).masterySignal).toEqual({ advantage: [], disadvantage: [] });
  });

  it("dynamic-signal limitation: the signal is resolved to a mode by resolveRollMode and the roll recompiled — no hidden branch", () => {
    const first = mastery(10, 10);
    expect(first.plan.subject.mode).toBe("NORMAL");
    const mode = resolveRollMode(first.masterySignal);
    expect(mode).toEqual({ ok: true, value: "ADVANTAGE" });
    expect(mastery(10, 10, "ADVANTAGE", 5, 11).natural).toBe(11);
  });
});

describe("§142 PLAYER DICE LEGACY GOLDEN (M5-I041)", () => {
  it("'1 Player Die' for a d10 character is one roll of the d10 Character Die — there is no Player Die progression", () => {
    expect(legacyTermFor("Player Die")).toEqual({ term: "Player Die", canonicalTerm: "Character Die" });
    expect(legacyTermFor("Player Dice")).toEqual({ term: "Player Dice", canonicalTerm: "Character Dice" });
    expect(resolveCharacterDie(progression, 7)).toEqual({ dieKey: "D10", faces: 10, levelMinimum: 7, levelMaximum: 8 });
    expect(CORE_DEFINITIONS.filter((d) => d.definitionKind === "CHARACTER_DIE_PROGRESSION")).toHaveLength(1);
    expect(JSON.stringify(CORE_DEFINITIONS)).not.toMatch(/player/i);
    const r = runCore({ kind: "CORE_RESOLUTION", subjectKey: "p", procedure: "CORE_ROLL", mode: "NORMAL", stat: "PER" }, character(7, { PER: 1 }), { roll: dieRoll(7, "NORMAL", 10), difficultyClass: 1 });
    expect(r.natural).toBe(10);
  });
});

describe("Movement is DEFERRED_PENDING_CANON (M5-SC-006 stays UNRESOLVED; M5-I073)", () => {
  it("no Movement Definition exists in canonical content and no plan computes Movement", () => {
    expect(CORE_DEFINITIONS.some((d) => /movement/i.test(JSON.stringify(d)))).toBe(false);
    expect(sheet(character(5)).plan.sourceMap.entries.some((e) => /movement/i.test(e.role))).toBe(false);
  });

  it("a DERIVED_STAT Definition for Movement is refused with DEFERRED_PENDING_CANON", () => {
    for (const statistic of ["MOVEMENT", "BASE_MOVEMENT", "MOVEMENT_SPEED"]) {
      const { ruleset, definitions } = coreRuleset({
        extra: [{ canonicalKey: "core.derived.movement", definitionKind: "DERIVED_STAT", payload: { statistic, formula: { expression: "5 * agi", rounding: "NONE", variables: [{ variable: "agi", source: { kind: "STAT", stat: "AGI" } }] }, bonusTarget: null, source: { locators: ["s23"], conflicts: ["M5-SC-006"] } } }],
      });
      expect(codes(createProwessDefinitionBundle({ ruleset, definitions })), statistic).toContain(C.DEFERRED_PENDING_CANON);
    }
  });
});

describe("golden values come from the exact bundle only", () => {
  it("a second Ruleset with revised content gives that Ruleset's values; the first is unchanged", () => {
    const revised = coreBundle({ rulesetId: "00000000-0000-4000-8000-000000007011", manifestId: "00000000-0000-4000-8000-000000007012", revise: { "core.derived.counter_action_capacity": { statistic: "COUNTER_ACTION_CAPACITY", formula: { expression: "2", rounding: "NONE", variables: [] }, bonusTarget: null, source: { locators: ["s47"], conflicts: [] } } } });
    const base = runCore({ kind: "DERIVED_STATISTICS", subjectKey: "s", statistics: ["COUNTER_ACTION_CAPACITY"] }, character(1));
    const other = runCore({ kind: "DERIVED_STATISTICS", subjectKey: "s", statistics: ["COUNTER_ACTION_CAPACITY"] }, character(1), {}, revised);
    expect([base.derived("COUNTER_ACTION_CAPACITY"), other.derived("COUNTER_ACTION_CAPACITY")]).toEqual([1, 2]);
  });
});
