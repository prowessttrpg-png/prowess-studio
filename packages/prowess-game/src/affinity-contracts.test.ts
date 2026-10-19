import { describe, expect, it } from "vitest";
import { createProwessDefinitionEnvelope } from "./definition/envelope.js";
import { AFFINITY_ERROR_CODES as A, COMPILATION_ERROR_CODES as X, DEFINITION_ERROR_CODES as C } from "./definition/codes.js";
import { CANONICAL_AFFINITIES } from "./vocabulary/construction.js";
import { AFFINITY_RANKS } from "./vocabulary/affinity.js";
import { PROWESS_DEFINITION_KINDS } from "./vocabulary/families.js";
import { indexAffinityDefinitions } from "./affinity/definitions.js";
import { validateAffinityProfile, validateAffinityProgression } from "./affinity/profile.js";
import { readAffinityRun } from "./affinity/results.js";
import { codes } from "./testing/core-run.js";
import { abilityOf, AFFINITY_CONTENT, AFFINITY_DEFINITIONS, affinityFixture, keywordCatalog, profileOf, type ProfileEntry } from "./testing/affinity-fixtures.js";
import { compileAffinityWith, evaluateAffinity, runAffinity } from "./testing/affinity-run.js";

/**
 * M5-WO4 contracts (PAS-10 M5-WO4 §22–§60, §80–§85, §137–§170, §267–§281): canonical content, payload validation,
 * profile ownership, standard progression, compilation through M4 primitives only, provenance, plain-data safety,
 * immutability, serialization, determinism and isolation.
 * Guard index (docs/architecture/m5-invariants.json): M5-I114 · M5-I115 · M5-I116 · M5-I117 · M5-I118 · M5-I119 · M5-I120 · M5-I121 · M5-I123 · M5-I124 · M5-I125 · M5-I129 · M5-I131 · M5-I133 · M5-I134 · M5-I135 · M5-I137 · M5-I138 · M5-I140 · M5-I142 · M5-I143 · M5-I144 · M5-I145 · M5-I146 · M5-I148 · M5-I149 · M5-I150.
 */
const F = affinityFixture();
const evocation = (rank: string): ProfileEntry[] => [{ affinity: "affinity.evocation", rank, role: "PRIMARY" }];
const payloadOf = (key: string) => JSON.parse(JSON.stringify(AFFINITY_DEFINITIONS.find((d) => d.canonicalKey === key)?.payload)) as Record<string, unknown>;
const envelope = (definitionKind: string, payload: unknown, schemaVersion = 1) => ({
  schemaVersion,
  systemFamily: "AFFINITY",
  definitionKind,
  entityId: "00000000-0000-4000-8000-000000000001",
  entityVersionId: "00000000-0000-4000-8000-000000000002",
  canonicalKey: "affinity.test",
  payload,
  provenance: { rulesetId: "00000000-0000-4000-8000-000000000003", manifestId: "00000000-0000-4000-8000-000000000004", releaseId: null, sourceRulesetId: null, sourceManifestId: null, legacyTerms: [] },
});
const costSubject = (spec: Parameters<typeof abilityOf>[1] = {}, baseCost = 20) => ({ kind: "SPELL_AFFINITY_COST", subjectKey: "c", composition: abilityOf(F, spec), costTarget: "LISTED_MP_COST", baseCost });

describe("canonical Affinity content (§22–§28, §70–§75, §142–§147)", () => {
  it("M5-I114 exactly six canonical Affinities, one executable version-2 Definition each, keyed affinity.<name>", () => {
    expect(AFFINITY_CONTENT.contentKey).toBe("prowess.core_playtest.v0_1.affinity");
    const affinities = AFFINITY_DEFINITIONS.filter((d) => d.definitionKind === "AFFINITY");
    expect(affinities.map((d) => [d.canonicalKey, d.schemaVersion, d.payload.affinity])).toEqual(CANONICAL_AFFINITIES.map((a) => [`affinity.${a.toLowerCase()}`, 2, a]));
    const index = indexAffinityDefinitions(F.bundle);
    expect(index.ok && index.value.affinities.map((a) => a.affinity)).toEqual([...CANONICAL_AFFINITIES]);
  });

  it("M5-I115 Evocation is canonical; Emission appears nowhere as canonical structured content and is refused", () => {
    expect(JSON.stringify(AFFINITY_DEFINITIONS)).not.toMatch(/emission/i);
    expect(codes(createProwessDefinitionEnvelope(envelope("AFFINITY", { ...payloadOf("affinity.evocation"), affinity: "EMISSION" }, 2)))).toContain(C.LEGACY_TERM_AS_CANONICAL);
    expect(codes(createProwessDefinitionEnvelope(envelope("AFFINITY", { ...payloadOf("affinity.evocation"), identity: { text: "Projected force.", themes: ["Emission"] } }, 2)))).toContain(C.LEGACY_TERM_AS_CANONICAL);
  });

  it("the Strength / Weakness tables are structured data with exact percentages (§70–§75, §145)", () => {
    const table = Object.fromEntries(
      AFFINITY_DEFINITIONS.filter((d) => d.definitionKind === "AFFINITY").map((d) => [
        d.payload.affinity,
        { s: (d.payload.strengths as { strengthKey: string }[]).map((x) => x.strengthKey), w: (d.payload.weaknesses as { weaknessKey: string; activationPenaltyPercent: number }[]).map((x) => [x.weaknessKey, x.activationPenaltyPercent]) },
      ]),
    );
    expect(table).toEqual({
      EVOCATION: { s: ["DIRECT_DAMAGE", "AREA_EFFECT", "SUSTAINED_OR_CHANNELED_OUTPUT"], w: [["HEALING", 30], ["BUFF_OR_DEBUFF", 20], ["SUMMON_OR_CONSTRUCT", 20]] },
      CONJURATION: { s: ["SUMMONING", "UTILITY", "PERSISTENT_CREATION"], w: [["DAMAGE", 20], ["HEALING_OR_BUFF", 30], ["INSTANT_EFFECT", 20]] },
      TRANSMUTATION: { s: ["BUFF", "UTILITY", "ELEMENTAL_OR_TERRAIN_ALTERATION"], w: [["DIRECT_DAMAGE", 10], ["AOE_SCALING", 20], ["SUMMON", 30]] },
      DIVINATION: { s: ["DETECTION", "KNOWLEDGE", "PREDICTIVE_OR_REACTIVE_EFFECT"], w: [["DAMAGE", 30], ["HEALING", 30], ["PERSISTENT_EFFECT", 15]] },
      ENHANCEMENT: { s: ["BUFF", "HEALING", "RESISTANCE", "REINFORCEMENT", "RECOVERY"], w: [["CONTROL", 10], ["SUMMON", 20], ["DAMAGE", 30]] },
      MANIPULATION: { s: ["CONTROL", "ILLUSION", "REDIRECTION", "INTERFERENCE", "MIND_EFFECT"], w: [["PERSISTENT_EFFECT", 10], ["HEALING", 20], ["DAMAGE", 30]] },
    });
  });

  it("M5-I124 Divination Persistent Effects keeps exactly +15% with no severity label; group rules match ANY exact Keyword (§148)", () => {
    const divination = payloadOf("affinity.divination").weaknesses as { weaknessKey: string; activationPenaltyPercent: number; severity: string | null }[];
    expect(divination.find((w) => w.weaknessKey === "PERSISTENT_EFFECT")).toEqual({ weaknessKey: "PERSISTENT_EFFECT", matchAny: ["keyword.persistent_effect"], activationPenaltyPercent: 15, severity: null });
    const evocation = payloadOf("affinity.evocation").weaknesses as { weaknessKey: string; matchAny: string[] }[];
    expect(evocation.find((w) => w.weaknessKey === "BUFF_OR_DEBUFF")?.matchAny).toEqual(["keyword.buff", "keyword.debuff"]);
  });

  it("M5-I120 / M5-I121 / M5-I137 / M5-I138 the rank rule is data: explicit order, discount, Authority capacity (none at NONE)", () => {
    expect(payloadOf("affinity.rank_rule")).toEqual({
      ranks: [
        { rank: "NONE", order: 0, strengthDiscountPercent: 0, authority: null },
        { rank: "TRAINED", order: 1, strengthDiscountPercent: 10, authority: { effectCapacity: 1, traitCapacity: 1 } },
        { rank: "EXPERT", order: 2, strengthDiscountPercent: 20, authority: { effectCapacity: 2, traitCapacity: 2 } },
        { rank: "MASTER", order: 3, strengthDiscountPercent: 30, authority: { effectCapacity: 3, traitCapacity: 3 } },
      ],
      authorityMinimumRank: "TRAINED",
      source: { locators: ["s118", "s161", "s624", "s626", "s685"], conflicts: [] },
    });
    expect(AFFINITY_RANKS).toEqual(["NONE", "TRAINED", "EXPERT", "MASTER"]);
    expect(AFFINITY_RANKS as readonly string[]).not.toContain("UNTRAINED"); // NONE is not the Skill rank (§30)
  });

  it("§57 the Minor / Moderate / Major reference scale is structured content", () => {
    expect(payloadOf("affinity.weakness_severity").severities).toEqual([
      { severity: "MINOR", percent: 10 },
      { severity: "MODERATE", percent: 20 },
      { severity: "MAJOR", percent: 30 },
    ]);
  });

  it("M5-I151 (supersedes M5-I119) a new Level 9 Affinity starts at TRAINED by designer ruling M5-SC-035", () => {
    const levels = payloadOf("affinity.standard_progression").levels as { level: number; options: Record<string, unknown>[] }[];
    expect(levels.map((l) => l.level)).toEqual([1, 3, 6, 9]);
    expect(levels[3]?.options.find((o) => o.optionKey === "GAIN_NEW_AFFINITY")).toEqual({ optionKey: "GAIN_NEW_AFFINITY", action: "GAIN_AFFINITY", role: "SECONDARY", startingRank: "TRAINED", conflictKey: null });
    expect(AFFINITY_CONTENT.deferred).toEqual([]);
  });

  it("every Affinity rule Keyword is an exact canonical Keyword listed for the M1 Keyword catalog (§146), descriptive themes are not Keywords (§147)", () => {
    const listed = new Set(AFFINITY_CONTENT.keywords.map((k) => k.canonicalKey));
    for (const d of AFFINITY_DEFINITIONS.filter((x) => x.definitionKind === "AFFINITY")) {
      for (const rule of [...(d.payload.strengths as { matchAny: string[] }[]), ...(d.payload.weaknesses as { matchAny: string[] }[])]) for (const k of rule.matchAny) expect(listed.has(k), k).toBe(true);
      for (const theme of (d.payload.identity as { themes: string[] }).themes) expect(listed.has(`keyword.${theme.replace(/ /g, "_")}`) && !["healing", "control", "illusion", "interference", "redirection", "reinforcement", "recovery", "resistance", "knowledge"].includes(theme), theme).toBe(false);
    }
    expect(AFFINITY_CONTENT.keywords.every((k) => k.category === AFFINITY_CONTENT.keywordCategory.canonicalKey)).toBe(true);
  });

  it("the Affinity kinds are versioned GENERIC_RULE Definitions; AFFINITY supports payload v1 (WO1 identity) and v2 (WO4 rules)", () => {
    expect(PROWESS_DEFINITION_KINDS.AFFINITY.schemaVersions).toEqual([1, 2]);
    for (const k of ["AFFINITY_RANK_RULE", "AFFINITY_WEAKNESS_SEVERITY", "AFFINITY_PROGRESSION"] as const) expect(PROWESS_DEFINITION_KINDS[k]).toEqual({ family: "AFFINITY", branch: null, contract: null, entityTypes: ["GENERIC_RULE"], schemaVersions: [1] });
    expect(createProwessDefinitionEnvelope(envelope("AFFINITY", { affinity: "EVOCATION" }, 1)).ok).toBe(true);
    expect(codes(createProwessDefinitionEnvelope(envelope("AFFINITY", { affinity: "EVOCATION" }, 2)))).toContain(C.INVALID_PAYLOAD);
  });
});

describe("payload safety (§162–§164, §267)", () => {
  const weak = (activationPenaltyPercent: unknown) => envelope("AFFINITY", { ...payloadOf("affinity.evocation"), weaknesses: [{ weaknessKey: "HEALING", matchAny: ["keyword.healing"], activationPenaltyPercent, severity: null }] }, 2);
  it("percentages are finite and non-negative; 0 is legal and stays 0; above 100 is not arbitrarily refused", () => {
    for (const bad of [-1, "30", null]) expect(codes(createProwessDefinitionEnvelope(weak(bad))), String(bad)).toContain(C.INVALID_PAYLOAD);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) expect(codes(createProwessDefinitionEnvelope(weak(bad))), String(bad)).toContain(C.NOT_PLAIN_DATA);
    const zero = createProwessDefinitionEnvelope(weak(0));
    expect(zero.ok && (zero.value.payload.weaknesses as { activationPenaltyPercent: number }[])[0]?.activationPenaltyPercent).toBe(0);
    expect(createProwessDefinitionEnvelope(weak(150)).ok).toBe(true);
  });

  it("Keyword refs are exact canonical keys; duplicate rule keys, unknown ranks and duplicate rank orders fail closed", () => {
    expect(codes(createProwessDefinitionEnvelope(envelope("AFFINITY", { ...payloadOf("affinity.evocation"), strengths: [{ strengthKey: "DIRECT_DAMAGE", matchAny: ["Direct Damage"] }] }, 2)))).toContain(C.INVALID_PAYLOAD);
    expect(codes(createProwessDefinitionEnvelope(envelope("AFFINITY", { ...payloadOf("affinity.evocation"), strengths: [{ strengthKey: "A", matchAny: ["keyword.a"] }, { strengthKey: "A", matchAny: ["keyword.b"] }] }, 2)))).toContain(C.INVALID_PAYLOAD);
    const rule = payloadOf("affinity.rank_rule");
    const ranks = rule.ranks as Record<string, unknown>[];
    expect(codes(createProwessDefinitionEnvelope(envelope("AFFINITY_RANK_RULE", { ...rule, ranks: [...ranks.slice(0, 3), { ...ranks[3], rank: "GRANDMASTER" }] })))).toContain(C.INVALID_PAYLOAD);
    expect(codes(createProwessDefinitionEnvelope(envelope("AFFINITY_RANK_RULE", { ...rule, ranks: [...ranks.slice(0, 3), { ...ranks[3], order: 2 }] })))).toContain(C.INVALID_PAYLOAD);
    expect(codes(createProwessDefinitionEnvelope(envelope("AFFINITY_RANK_RULE", { ...rule, ranks: [{ ...ranks[0], authority: { effectCapacity: 1, traitCapacity: 1 } }, ...ranks.slice(1)] })))).toContain(C.INVALID_PAYLOAD);
  });

  it("an unresolved starting rank must cite its conflict; a guessed one with an open conflict is refused", () => {
    const prog = payloadOf("affinity.standard_progression");
    const levels = prog.levels as { options: Record<string, unknown>[] }[];
    const with9 = (option: Record<string, unknown>) => envelope("AFFINITY_PROGRESSION", { ...prog, levels: [...levels.slice(0, 3), { level: 9, mode: "CHOOSE_ONE", options: [option] }] });
    expect(codes(createProwessDefinitionEnvelope(with9({ optionKey: "GAIN_NEW_AFFINITY", action: "GAIN_AFFINITY", role: "SECONDARY", startingRank: null, conflictKey: null })))).toContain(C.DEFERRED_PENDING_CANON);
    expect(codes(createProwessDefinitionEnvelope(with9({ optionKey: "GAIN_NEW_AFFINITY", action: "GAIN_AFFINITY", role: "SECONDARY", startingRank: "TRAINED", conflictKey: "M5-SC-035" })))).toContain(C.INVALID_PAYLOAD);
  });
});

describe("CharacterAffinityProfile (§39–§46, §84–§85, §137–§138, §161, §268–§270)", () => {
  it("M5-I116 ownership and rank are separate; output is ordered PRIMARY first then canonical key, never by input order", () => {
    const a = validateAffinityProfile(profileOf(F, [{ affinity: "affinity.enhancement", rank: "TRAINED", role: "SECONDARY" }, { affinity: "affinity.evocation", rank: "NONE", role: "PRIMARY" }]), F.bundle);
    expect(a.ok && a.value.affinities.map((x) => [x.identity, x.rank, x.role])).toEqual([["EVOCATION", "NONE", "PRIMARY"], ["ENHANCEMENT", "TRAINED", "SECONDARY"]]);
  });

  it("§268–§269 an identical duplicate collapses; a conflicting duplicate fails closed (no value silently chosen)", () => {
    const one = { affinity: "affinity.evocation", rank: "TRAINED", role: "PRIMARY" };
    const same = validateAffinityProfile(profileOf(F, [one, one]), F.bundle);
    expect(same.ok && same.value.affinities).toHaveLength(1);
    expect(codes(validateAffinityProfile(profileOf(F, [one, { ...one, rank: "EXPERT" }]), F.bundle))).toContain(A.DUPLICATE_AFFINITY_OWNERSHIP);
  });

  it("exactly one PRIMARY; refs are exact executable Definitions of THIS Ruleset; never two versions of one Entity (§138)", () => {
    expect(codes(validateAffinityProfile(profileOf(F, [{ affinity: "affinity.evocation", rank: "TRAINED", role: "SECONDARY" }]), F.bundle))).toContain(A.INVALID_AFFINITY_PROFILE);
    const foreign = { affinities: [{ affinity: { ...F.ref("affinity.evocation"), entityVersionId: "00000000-0000-4000-8000-000000009999" }, rank: "TRAINED", role: "PRIMARY", acquisition: null }] };
    expect(codes(validateAffinityProfile(foreign, F.bundle))).toContain(A.AFFINITY_NOT_IN_RULESET);
    const mixed = { affinities: [profileOf(F, evocation("TRAINED")).affinities[0], { ...(foreign.affinities[0] as object), role: "SECONDARY" }] };
    expect(codes(validateAffinityProfile(mixed, F.bundle))).not.toEqual([]);
    const v1 = affinityFixture({ override: { "affinity.evocation": { schemaVersion: 1, payload: { affinity: "EVOCATION" } } } });
    expect(codes(validateAffinityProfile(profileOf(v1, evocation("TRAINED")), v1.bundle))).toContain(A.AFFINITY_NOT_EXECUTABLE);
  });

  it("§267 rejects getters, functions, cycles, unsafe prototype keys and unknown ranks", () => {
    const base = profileOf(F, evocation("TRAINED"));
    const getter = { affinities: [{ ...base.affinities[0], get rank() { return "MASTER"; } }] };
    const cyclic: Record<string, unknown> = { affinities: [] };
    (cyclic.affinities as unknown[]).push(cyclic);
    expect(codes(validateAffinityProfile(getter, F.bundle))).not.toEqual([]);
    expect(codes(validateAffinityProfile({ affinities: [{ ...base.affinities[0], rank: () => "MASTER" }] }, F.bundle))).not.toEqual([]);
    expect(codes(validateAffinityProfile(cyclic, F.bundle))).not.toEqual([]);
    expect(codes(validateAffinityProfile(JSON.parse(`{"affinities":[${JSON.stringify(base.affinities[0]).replace("{", '{"__proto__":{"rank":"MASTER"},')}]}`), F.bundle))).not.toEqual([]);
    expect(codes(validateAffinityProfile({ affinities: [{ ...base.affinities[0], rank: "UNTRAINED" }] }, F.bundle))).toContain(A.INVALID_AFFINITY_PROFILE);
  });

  it("§161 the validated profile is detached: mutating the caller's input later changes nothing", () => {
    const input = profileOf(F, evocation("TRAINED"));
    const out = validateAffinityProfile(input, F.bundle);
    (input.affinities[0] as Record<string, unknown>).rank = "MASTER";
    expect(out.ok && out.value.affinities[0]?.rank).toBe("TRAINED");
    expect(out.ok && Object.isFrozen(out.value)).toBe(true);
  });
});

describe("standard Affinity progression (§40–§52, §157–§160 — M5-I117, M5-I118, M5-I119)", () => {
  const check = (level: number, entries: ProfileEntry[], overrides?: unknown) => validateAffinityProgression({ definitions: F.bundle, profile: profileOf(F, entries), characterLevel: level, ...(overrides === undefined ? {} : { overrides }) });
  const status = (level: number, entries: ProfileEntry[]) => {
    const out = check(level, entries);
    return out.ok ? out.value.status : out.problems.map((p) => p.code).join();
  };
  const P = (rank: string, affinity = "affinity.evocation"): ProfileEntry => ({ affinity, rank, role: "PRIMARY" });
  const S = (rank: string, affinity = "affinity.enhancement"): ProfileEntry => ({ affinity, rank, role: "SECONDARY" });

  it("valid standard states", () => {
    expect(status(1, [P("NONE")])).toBe("VALID");
    expect(status(2, [P("NONE")])).toBe("VALID");
    expect(status(3, [P("TRAINED")])).toBe("VALID");
    expect(status(6, [P("EXPERT")])).toBe("VALID");
    expect(status(6, [P("TRAINED"), S("TRAINED")])).toBe("VALID");
    expect(status(9, [P("MASTER")])).toBe("VALID");
    expect(status(9, [P("EXPERT"), S("TRAINED")])).toBe("VALID");
    expect(status(9, [P("TRAINED"), S("EXPERT")])).toBe("VALID");
  });

  it("invalid states absent an explicit override", () => {
    expect(status(2, [P("MASTER")])).toBe("INVALID");
    expect(status(3, [P("TRAINED"), S("TRAINED")])).toBe("INVALID");
    expect(status(4, [P("EXPERT")])).toBe("INVALID");
    expect(status(6, [P("MASTER")])).toBe("INVALID");
    expect(status(1, [P("TRAINED")])).toBe("INVALID");
    expect(status(3, [P("NONE")])).toBe("INVALID"); // Level 3 makes the Primary Trained (§43)
  });

  it("M5-I151 / M5-SC-035 ruling: every Affinity ranks independently — the three standard Level 9 outcomes are VALID, a new Level 9 Affinity is TRAINED only", () => {
    expect(status(9, [P("MASTER")])).toBe("VALID"); // Trained → Expert → Master
    expect(status(9, [P("EXPERT"), S("TRAINED")])).toBe("VALID"); // Trained → Expert, plus another Trained
    expect(status(9, [P("TRAINED"), S("TRAINED"), S("TRAINED", "affinity.divination")])).toBe("VALID"); // three Affinities, all Trained
    for (const rank of ["NONE", "EXPERT", "MASTER"]) expect(status(9, [P("TRAINED"), S("TRAINED"), S(rank, "affinity.divination")]), rank).toBe("INVALID");
    expect(status(9, [P("EXPERT"), S("TRAINED"), S("TRAINED", "affinity.divination")])).toBe("INVALID"); // one Level 9 choice only
  });

  it("an option whose starting rank is unresolved content is still REQUIRES_CANON — never guessed (interpreter contract)", () => {
    const prog = payloadOf("affinity.standard_progression") as { levels: { level: number; options: Record<string, unknown>[] }[] };
    const levels = prog.levels.map((l) => (l.level !== 9 ? l : { ...l, options: l.options.map((o) => (o.optionKey === "GAIN_NEW_AFFINITY" ? { ...o, startingRank: null, conflictKey: "M5-SC-099" } : o)) }));
    const f = affinityFixture({ revise: { "affinity.standard_progression": { ...prog, levels, source: { locators: ["s161"], conflicts: ["M5-SC-099"] } } } });
    const out = validateAffinityProgression({ definitions: f.bundle, profile: profileOf(f, [P("TRAINED"), S("TRAINED"), S("MASTER", "affinity.divination")]), characterLevel: 9 });
    expect(out.ok && [out.value.status, out.value.unresolvedConflicts]).toEqual(["REQUIRES_CANON", ["M5-SC-099"]]);
  });

  it("§52 progression is never inferred from Level: the next Level's options are exposed structurally", () => {
    const out = check(8, [P("EXPERT")]);
    expect(out.ok && out.value.nextOptions?.level).toBe(9);
    expect(out.ok && out.value.nextOptions?.options.map((o) => [o.optionKey, "startingRank" in o ? o.startingRank : "-"])).toEqual([
      ["UPGRADE_AFFINITY_RANK", "-"],
      ["PROMOTE_EXPERT_TO_MASTER", "-"],
      ["GAIN_NEW_AFFINITY", "TRAINED"],
    ]);
  });

  it("§159 an explicit, provenance-backed override accepts a named entry outside standard progression", () => {
    const override = [{ overrideKey: "FEATURE_GRANT", affinity: F.ref("affinity.divination"), rank: "TRAINED", sourceKey: "feature.test_affinity_grant" }];
    expect(status(3, [P("TRAINED"), S("TRAINED", "affinity.divination")])).toBe("INVALID");
    const out = check(3, [P("TRAINED"), S("TRAINED", "affinity.divination")], override);
    expect(out.ok && [out.value.status, out.value.overridden.map((o) => o.sourceKey)]).toEqual(["VALID", ["feature.test_affinity_grant"]]);
    expect(codes(check(3, [P("TRAINED")], [{ ...override[0], sourceKey: "not a key" }]))).toContain(A.INVALID_PROGRESSION_REQUEST);
  });
});

describe("compilation contract (§80–§85, §122–§136, §154–§155, §169–§173, §276–§279)", () => {
  it("M5-I148 / M5-I149 / M5-I155 only M4 KEYWORD / REQUIREMENT / MODIFIER operations; percentages, MAX and comparisons are M4's", () => {
    const plan = compileAffinityWith(costSubject({ effects: ["directDamage", "healing"] }), { profile: evocation("EXPERT") });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect([...new Set(plan.value.evaluationPlan.steps.map((s) => s.operation))].sort()).toEqual(["KEYWORD", "MODIFIER", "REQUIREMENT"]);
    const modifierOps = plan.value.evaluationPlan.steps.flatMap((s) => (s.operation === "MODIFIER" ? ((s.input.request as { modifiers: { operation: string }[] }).modifiers.map((m) => m.operation)) : []));
    expect(modifierOps.sort()).toEqual(["ADD", "DIVIDE", "MAX", "MAX", "MAX", "MULTIPLY", "SUBTRACT"]);
    // M5-I155: the Weakness penalty operand is BOUND to M4's selected maximum, and the cost multiplier is BOUND to M4's
    // net percentage — the compiler never pre-computes either.
    const netStep = plan.value.evaluationPlan.steps.find((s) => s.stepKey === plan.value.outputs.cost?.netStepKey);
    expect(netStep?.bindings).toEqual(expect.arrayContaining([{ target: "/request/modifiers/1/operand", source: { kind: "STEP", stepKey: plan.value.outputs.weaknessSelection, pointer: "/data/finalTargets/0/value" } }]));
    const costStep = plan.value.evaluationPlan.steps.find((s) => s.stepKey === plan.value.outputs.cost?.stepKey);
    expect(costStep?.bindings).toEqual([{ target: "/request/modifiers/0/operand", source: { kind: "STEP", stepKey: plan.value.outputs.cost?.netStepKey, pointer: "/data/finalTargets/0/value" } }]);
    expect(JSON.stringify(plan.value)).not.toMatch(/"rounding"|"AP"|"ME"|ACTION_POINTS|mana_?efficiency/i);
  });

  it("§154 every compiled step maps back to the exact Affinity / rank-rule / contributing component Definitions", () => {
    const plan = compileAffinityWith(costSubject({ targeting: "radiusArea", effects: ["directDamage"], traits: [{ trait: "healingTrait", appliesTo: "effect1" }] }), { profile: evocation("EXPERT") });
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    const keys = (role: string) => plan.value.sourceMap.entries.filter((e) => e.role === role).flatMap((e) => e.definitions.map((d) => d.canonicalKey));
    expect(keys("ability-keywords")).toEqual(["spell.targeting.single", "spell.targeting.radius_area", "spell.effect.direct_damage", "spell.trait.healing_infusion", "spell.duration.instant"].filter((k) => k !== "spell.targeting.single"));
    expect(keys("spell-affinity-listed-mp")).toEqual(["affinity.evocation", "affinity.rank_rule"]);
    expect(plan.value.sourceMap.entries).toHaveLength(plan.value.evaluationPlan.steps.length);
    expect(plan.value.outputs.contributors.map((c) => [c.componentKey, c.contract, c.keywords])).toEqual([
      ["targeting", "TARGETING", ["keyword.area_effect"]],
      ["effect1", "EFFECT", ["keyword.direct_damage"]],
      ["trait1", "TRAIT", ["keyword.healing"]],
      ["duration", "DURATION", []],
    ]);
  });

  it("§277 exact Keyword contributions enter M4 Keyword Resolution with their sources; M4 orders contributors", () => {
    const r = runAffinity(costSubject({ effects: ["directDamage", "directDamage"] }), { profile: evocation("TRAINED") });
    const set = r.run.steps.find((s) => s.stepKey === r.plan.outputs.keywords)?.response?.data as { keywords: { keyword: { canonicalKey: string }; contributors: { source: { sourceType: string; sourceKey: string } }[] }[] };
    expect(set.keywords.map((k) => [k.keyword.canonicalKey, k.contributors.map((c) => `${c.source.sourceType}:${c.source.sourceKey}`)])).toEqual([["keyword.direct_damage", ["prowess.effect:effect1", "prowess.effect:effect2"]]]);
  });

  it("M5-I133 / M5-I135 a governing Affinity is explicit and must be the character's exact owned Version", () => {
    expect(codes(compileAffinityWith(costSubject({ affinity: null }), { profile: evocation("TRAINED") }))).toContain(A.GOVERNING_AFFINITY_REQUIRED);
    expect(codes(compileAffinityWith(costSubject({ affinity: "affinity.divination" }), { profile: evocation("MASTER") }))).toContain(A.GOVERNING_AFFINITY_NOT_OWNED);
  });

  it("M5-I134 a second owned Affinity never adds a discount: only the governing Affinity's rules compile", () => {
    const two: ProfileEntry[] = [{ affinity: "affinity.evocation", rank: "EXPERT", role: "PRIMARY" }, { affinity: "affinity.transmutation", rank: "TRAINED", role: "SECONDARY" }];
    const r = runAffinity(costSubject({ effects: ["buff"] }, 100), { profile: two });
    // Buff is a Transmutation Strength and an Evocation Weakness: under governing Evocation it is ONLY the Weakness.
    expect([r.reading.alignment?.alignment, r.reading.cost?.affinityAdjustedCost]).toEqual(["WEAKNESS", 120]);
    expect(r.plan.sourceMap.entries.flatMap((e) => e.definitions.map((d) => d.canonicalKey))).not.toContain("affinity.transmutation");
  });

  it("M5-I144 Spell MP Affinity economics are refused for a Maneuver; Maneuver alignment remains available", () => {
    expect(codes(compileAffinityWith({ ...costSubject(), composition: abilityOf(F, { kind: "MANEUVER" }) }, { profile: evocation("TRAINED") }))).toContain(A.SPELL_AFFINITY_COST_SPELL_ONLY);
    expect(compileAffinityWith({ kind: "AFFINITY_ALIGNMENT", subjectKey: "m", composition: abilityOf(F, { kind: "MANEUVER" }) }, { profile: evocation("TRAINED") }).ok).toBe(true);
  });

  it("§106 / §113 Authority is explicit; Arcane Authority capacity is out of WO4 scope", () => {
    const auth = (authority: Record<string, unknown> | null) => compileAffinityWith({ kind: "AFFINITY_AUTHORITY", subjectKey: "a", composition: abilityOf(F, { authority }) }, { profile: evocation("TRAINED") });
    expect(codes(auth(null))).toContain(A.AUTHORITY_REQUIRED);
    expect(codes(auth({ arcana: "authored" }))).toContain(A.AUTHORITY_REQUIRED);
    expect(codes(auth({ authority: "ARCANE_AUTHORITY" }))).toContain(A.ARCANE_AUTHORITY_NOT_IN_SCOPE);
  });

  it("§68 a Keyword with no exact M1 reference fails closed; catalogs with duplicate identities are refused", () => {
    expect(codes(compileAffinityWith(costSubject({ effects: ["lookalike"] }), { profile: evocation("TRAINED"), keywords: keywordCatalog([]) }))).toContain(A.UNKNOWN_KEYWORD);
    const catalog = keywordCatalog();
    expect(codes(compileAffinityWith(costSubject(), { profile: evocation("TRAINED"), keywords: [...catalog, { ...catalog[0], keywordId: "00000000-0000-4000-8000-000000009998" }] }))).toContain(A.INVALID_KEYWORD_CATALOG);
    expect(codes(compileAffinityWith(costSubject(), { profile: evocation("TRAINED"), keywords: [{ ...catalog[0], keywordId: "direct-damage" }] }))).toContain(A.INVALID_KEYWORD_CATALOG);
  });

  it("baseCost is finite and non-negative; the cost target is explicit", () => {
    for (const baseCost of [-1, "20"]) expect(codes(compileAffinityWith({ ...costSubject(), baseCost }, { profile: evocation("TRAINED") })), String(baseCost)).toContain(X.INVALID_REQUEST);
    expect(codes(compileAffinityWith({ ...costSubject(), baseCost: Number.NaN }, { profile: evocation("TRAINED") }))).toContain(C.NOT_PLAIN_DATA);
    expect(codes(compileAffinityWith({ ...costSubject(), costTarget: "AP" }, { profile: evocation("TRAINED") }))).toContain(X.INVALID_REQUEST);
  });

  it("§138 a bundle from another Ruleset is never mixed in", () => {
    const other = affinityFixture({ rulesetId: "00000000-0000-4000-8000-000000007599", manifestId: "00000000-0000-4000-8000-000000007598" });
    const plan = compileAffinityWith(costSubject(), { profile: evocation("TRAINED") }, { ...F, bundle: other.bundle });
    expect(plan.ok).toBe(false);
  });

  it("readAffinityRun refuses a run of a different plan", () => {
    const a = runAffinity(costSubject(), { profile: evocation("TRAINED") });
    const b = compileAffinityWith({ kind: "AFFINITY_ALIGNMENT", subjectKey: "x", composition: abilityOf(F) }, { profile: evocation("TRAINED") });
    if (!b.ok) throw new Error("compile");
    expect(codes(readAffinityRun({ plan: b.value, run: a.run }))).toContain(A.INCOMPLETE_RUN);
  });
});

describe("determinism, serialization, immutability, isolation (§161, §165–§168, §270–§275)", () => {
  it("M5-I150 equal requests give deep-equal plans, source maps, runs and readings; all JSON round-trip", () => {
    const one = runAffinity(costSubject({ effects: ["directDamage", "healing"] }, 100), { profile: evocation("EXPERT") });
    const two = runAffinity(costSubject({ effects: ["directDamage", "healing"] }, 100), { profile: evocation("EXPERT") });
    expect(two).toEqual(one);
    for (const v of [one.plan, one.reading, one.run]) expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it("compilation never mutates its inputs (profile, composition, catalog, bundle)", () => {
    const subject = costSubject({ effects: ["healing"] });
    const profile = profileOf(F, evocation("TRAINED"));
    const keywords = keywordCatalog();
    const snapshot = JSON.stringify([subject, profile, keywords, F.bundle]);
    const plan = compileAffinityWith(subject, { profile, keywords });
    expect(plan.ok).toBe(true);
    expect(JSON.stringify([subject, profile, keywords, F.bundle])).toBe(snapshot);
    expect(plan.ok && Object.isFrozen(plan.value.evaluationPlan)).toBe(true);
  });

  it("§168 interleaved evaluations under different Rulesets / profiles never cross-contaminate", () => {
    const f2 = affinityFixture({ rulesetId: "00000000-0000-4000-8000-000000007599", manifestId: "00000000-0000-4000-8000-000000007598", revise: { "affinity.evocation": { ...payloadOf("affinity.evocation"), weaknesses: [{ weaknessKey: "HEALING", matchAny: ["keyword.healing"], activationPenaltyPercent: 50, severity: null }] } } });
    const p1 = compileAffinityWith(costSubject({ effects: ["healing"] }, 100), { profile: evocation("TRAINED") });
    const p2 = compileAffinityWith({ ...costSubject({ effects: ["healing"] }, 100), composition: abilityOf(f2, { effects: ["healing"] }) }, { profile: profileOf(f2, evocation("TRAINED")) }, f2);
    if (!p1.ok || !p2.ok) throw new Error("compile");
    const r2 = evaluateAffinity(p2.value, f2);
    const r1 = evaluateAffinity(p1.value);
    const v = (plan: typeof p1.value, run: typeof r1) => {
      const out = readAffinityRun({ plan, run });
      return out.ok ? out.value.cost?.affinityAdjustedCost : null;
    };
    expect([v(p1.value, r1), v(p2.value, r2)]).toEqual([130, 150]);
  });
});
