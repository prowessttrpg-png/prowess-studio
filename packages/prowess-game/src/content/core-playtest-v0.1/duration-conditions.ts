import constructionContent from "./ability-construction.json" with { type: "json" };
/** WO9 listed components. Authority identity: docs/import-reports/m3-wo9-core-playtest-v0.1.md.
 * Section locators are from the permanent M3 DOCX parser. No final Ability price is supplied. */
export const CONDITION_POLICY = {
  spellMpPercentMaximum: 30, maneuverApMaximum: 3,
  formulas: {
    scale: { expression: "units * rate", variables: ["units", "rate"] },
    sum: { expression: "left + right", variables: ["left", "right"] },
    cap: { expression: "min(listed, maximum)", variables: ["listed", "maximum"] },
    excess: { expression: "listed - effective", variables: ["listed", "effective"] },
    increment: { expression: "value - minimum - floor((value - minimum) / increment) * increment", variables: ["value", "minimum", "increment"] },
  },
} as const;
const all = { kind: "NUMERIC_COMPARE", factKey: "mechanic.present", operator: "==", expected: 1 };
const runtime = (requirementKey: string, factKey: string, parameters: string[] = [], expected = 1) => [{ requirementKey, requirement: { kind: "NUMERIC_COMPARE", factKey, operator: ">=", expected }, parameters }];
const common = (extra: object) => ({ keywords: [], parameters: {}, compatibility: [], costContributions: [], rules: {}, ...extra });
const duration = (branch: "SPELL" | "MANEUVER", mode: string, deferred = false) => ({
  canonicalKey: `${branch.toLowerCase()}.duration.${mode.toLowerCase()}`, definitionKind: branch === "SPELL" ? "SPELL_DURATION" : "MANEUVER_DURATION",
  payload: common({ durationConcept: mode, rules: { duration: { branch, availability: deferred ? "DEFERRED" : "EXECUTABLE", deferralKey: deferred ? "M5-SC-045" : null, requirements: all, costStatus: "UNLISTED", futureRuntime: { sustain: mode === "SUSTAINED", manaLock: mode === "MANA_LOCK", concentration: mode === "SUSTAINED" ? "WO13" : "NONE", "persists": mode !== "INSTANT" } } } }), sourceSections: ["s657", ...(branch === "MANEUVER" ? ["s2068"] : [])],
});
const cost = (key: string, modifier: string, amount: number, extra: object = {}) => ({ contributionKey: key, currency: modifier === "MP_PERCENT_REDUCTION" || modifier === "MP_REDUCTION" ? "MP" : "AP", data: { kind: "FIXED", amount, modifier, ...extra } });
const condition = (branch: "SPELL" | "MANEUVER", key: string, restrictionKey: string, sections: string[], costs: object[], extra: object = {}, deferred: string | null = null) => ({
  canonicalKey: `${branch === "SPELL" ? "spell.casting_condition" : "maneuver.condition"}.${key}`, definitionKind: branch === "SPELL" ? "SPELL_CASTING_CONDITION" : "MANEUVER_CONDITION",
  payload: common({ restriction: { restrictionKey, data: {} }, tradeoff: {}, costContributions: costs, rules: { construction: { stacking: { stackable: false } }, condition: {
    branch, availability: deferred ? "DEFERRED" : "EXECUTABLE", deferralKey: deferred,
    parameters: [], applicability: all, runtimeRequirements: runtime(restrictionKey, `runtime.${key}`), dependencies: [], consumesSlot: true, slotExemption: null, choice: { kind: "ALL" }, incompatibleRestrictions: [], ...extra,
  } } }), sourceSections: sections,
});
const choice = { parameters: [{ parameter: "benefit", kind: "TOKEN", allowed: ["AP", "MP"], default: null }], choice: { kind: "CHOOSE_ONE", parameter: "benefit" } };
const creature = { kind: "SET_CONTAINS", factKey: "mechanic.targets", member: "CREATURE" };
export const DURATION_CONDITION_CONTENT = {
  sourceIdentityReport: "docs/import-reports/m3-wo9-core-playtest-v0.1.md", rulings: ["M5-SC-012", "M5-SC-021", "M5-SC-025", "M5-SC-028"],
  // An explicitly authored new version of the same permanent Definition; all WO5 capacities remain inherited.
  constructionRule: { ...constructionContent.definitions[0]!, payload: { ...constructionContent.definitions[0]!.payload, conditionPolicy: CONDITION_POLICY } },
  definitions: [
    ...["INSTANT", "ROUNDS", "COMBAT", "SCENE", "MISSION", "SUSTAINED", "MANA_LOCK", "PERMANENT_BY_SPECIAL_RULE"].map(mode => duration("SPELL", mode, mode === "PERMANENT_BY_SPECIAL_RULE")),
    ...["INSTANT", "UNTIL_NEXT_TURN", "ROUNDS"].map(mode => duration("MANEUVER", mode)),
    condition("SPELL", "verbal", "VERBAL", ["s672"], [cost("verbal.mp", "MP_PERCENT_REDUCTION", 10)], { runtimeRequirements: runtime("VOCALIZATION", "runtime.canVocalize") }),
    condition("SPELL", "somatic", "SOMATIC", ["s673"], [cost("somatic.ap", "AP_REDUCTION", 1)], { runtimeRequirements: runtime("PHYSICAL_MOVEMENT", "runtime.canPerformSomatic") }),
    condition("SPELL", "material", "MATERIAL", ["s674"], [], {}, "M5-SC-044"),
    condition("SPELL", "immobile", "IMMOBILE", ["s675"], [cost("immobile.mp", "MP_PERCENT_REDUCTION", 10)]),
    condition("SPELL", "anchored", "ANCHORED", ["s675"], [cost("anchored.mp", "MP_PERCENT_REDUCTION", 15)]),
    condition("SPELL", "charge", "CHARGE", ["s675"], [
      { contributionKey: "charge.mp", currency: "MP", data: { kind: "PER_UNIT", parameter: "extraAp", amount: 10, includedUnits: 0, modifier: "MP_PERCENT_REDUCTION" } },
      { contributionKey: "charge.ap", currency: "AP", data: { kind: "PER_UNIT", parameter: "extraAp", amount: 1, includedUnits: 0, modifier: "AP_COMMITMENT" } },
    ], { parameters: [{ parameter: "extraAp", kind: "COUNT", minimum: 1, maximum: null, increment: 1, default: null }], runtimeRequirements: runtime("EXTRA_AP_COMMITMENT", "runtime.canCommitExtraAp", ["extraAp"]) }),
    condition("SPELL", "limited_use", "LIMITED_USE", ["s675"], [{ contributionKey: "limited_use.mp", currency: "MP", data: { kind: "PER_SELECTION", parameter: "period", amounts: { SCENE: 10, COMBAT: 20, MISSION: 30 }, modifier: "MP_PERCENT_REDUCTION" } }], { parameters: [{ parameter: "period", kind: "TOKEN", allowed: ["SCENE", "COMBAT", "MISSION"], default: null }], runtimeRequirements: runtime("USAGE_LIMIT", "runtime.useAvailable", ["period"]) }),
    ...["delayed", "environmental", "risk", "focus"].map(key => condition("SPELL", key, key.toUpperCase(), ["s675"], [], {}, "M5-SC-044")),
    condition("MANEUVER", "stationary", "STATIONARY", ["s2020", "s2099"], [cost("stationary.ap", "AP_REDUCTION", 1)], { incompatibleRestrictions: ["MUST_MOVE_FIRST"] }),
    condition("MANEUVER", "must_move_first", "MUST_MOVE_FIRST", ["s2020", "s2099"], [cost("must_move_first.ap", "AP_REDUCTION", 1)], { incompatibleRestrictions: ["STATIONARY", "CANNOT_MOVE_THIS_TURN"], runtimeRequirements: runtime("MOVE_TEN_FEET_FIRST", "runtime.feetMovedBefore", [], 10) }),
    condition("MANEUVER", "cannot_move_this_turn", "CANNOT_MOVE_THIS_TURN", ["s2020", "s2099"], [], {}, "M5-SC-043"),
    ...["no_counter_action", "cannot_crit"].map(key => condition("MANEUVER", key, key.toUpperCase(), ["s2020", "s2094"], [cost(`${key}.ap`, "AP_REDUCTION", 1, { option: "AP" }), cost(`${key}.mp`, "MP_REDUCTION", 3, { option: "MP" })], choice)),
    condition("MANEUVER", "target_flanked", "TARGET_FLANKED", ["s2020", "s2102"], [cost("target_flanked.ap", "AP_REDUCTION", 1)], { applicability: creature }),
    condition("MANEUVER", "target_unaware", "TARGET_UNAWARE", ["s2020", "s2102"], [cost("target_unaware.ap", "AP_REDUCTION", 2)], { applicability: creature }),
    condition("MANEUVER", "target_bloodied", "TARGET_BLOODIED", ["s2020", "s2102"], [cost("target_bloodied.ap", "AP_REDUCTION", 1)], { applicability: creature }),
    ...["weapon_lock", "environmental_lock", "once_per_mission"].map(key => condition("MANEUVER", key, key.toUpperCase(), ["s2020", "s2094"], [], {}, "M5-SC-044")),
  ],
};
