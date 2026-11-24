import {
  CALCULATED_VALUE_PLACEMENTS,
  CANON_STATUSES,
  VALUE_INPUT_KINDS,
  BENEFIT_AMOUNT_INPUT_KINDS,
  CONCENTRATION_CAPACITY_INPUT_KINDS,
  CONCENTRATION_UPKEEP_INPUT_KINDS,
  ARMOR_CATEGORIES,
  STEALTH_EFFECTS,
  CONDITION_DURATION_MODELS,
  CONDITION_ONGOING_TIMINGS,
  CONDITION_STACKING,
  SUMMON_ENGINES,
  SUMMON_SUSTAIN_MODES,
  SUMMON_COST_INPUT_KINDS,
  SUMMON_LIMIT_INPUT_KINDS,
  MISSION_RULE_SHAPES,
  REFERENCE_RULE_SHAPES,
  CLOCK_VISIBILITIES,
  METAMAGIC_FORMS,
  CONDITION_TRIGGERS,
  SUMMON_ACTION_MODELS,
  SUMMON_ACTION_TIMINGS,
  SUMMON_RESOURCE_OWNERS,
  SUMMON_RESTRICTION_KINDS,
  SUMMON_DISMISSALS,
  MAGE_ART_BENEFIT_KINDS,
  MAGE_ART_EXCEPTION_KINDS,
  WEAPON_MODIFICATION_CHANGE_KINDS,
  SKILL_BENEFIT_GROUP_MODES,
  MAGE_ART_SCALING_INPUT_KINDS,
  MAGE_ART_ACTIVE_EFFECT_WINDOWS,
  ACTION_COST_MODELS, ACTION_IMPROVEMENT_MODIFICATION_KINDS, ACTION_IMPROVEMENT_PREREQUISITE_KINDS, ACTION_TIMINGS, AFFINITY_ADVANCEMENT_ACTIONS,
  AFFINITY_PROGRESSION_MODES, AFFINITY_RANKS, AFFINITY_RANK_UP_TARGETS, AFFINITY_ROLES, COMBAT_TIMING_EVENTS, INITIATIVE_TIEBREAK_KINDS,
  PAYMENT_POLICIES, RESOURCE_EXPIRY_TARGETS, RESOURCE_MAXIMUM_SOURCES, RESOURCE_SPENDING, RESOURCE_USAGE_RESTRICTIONS, ROLL_MODES,
  ROLL_PROCEDURES, RUNTIME_RESOURCE_KEYS, VARIABLE_COST_DETERMINERS,
  SPELL_EFFECT_FAMILIES, EFFECT_SUBFAMILIES, EFFECT_RESOLUTION_POLICIES, EFFECT_ATTACK_TYPES, EFFECT_SAVE_SELECTION_POLICIES,
  EFFECT_PARAMETER_KINDS, EFFECT_LIMIT_KINDS, EFFECT_COST_KINDS, EFFECT_OUTCOME_KEYS, EFFECT_OUTCOME_OPERATIONS, TARGET_CATEGORIES,
  TRAIT_FAMILIES, TRAIT_MODIFICATIONS, CONSTRUCTION_PREREQUISITE_KINDS, STACK_LIMIT_KINDS, CONSTRUCTION_SKILL_TRACKS,
  MAGE_ART_IMMUNITY_KINDS, MAGE_ART_CALCULATION_KINDS, MAGE_ART_RANGE_TARGET_KINDS, CONDITION_OUTCOME_KINDS, CONDITION_PREVENTIONS, TARGETING_MEASURES,
  DELIVERY_FAMILIES, TARGET_CARDINALITY_KINDS, TARGETING_RANGE_MODELS, TARGETING_MEASURE_STATUSES, TARGETING_ORIGIN_MODES, AURA_SOURCES, TARGETING_PLACEMENT_MODELS, SIGHT_POLICIES, COVER_POLICIES, TARGETING_PARAMETER_KINDS, TARGETING_COST_KINDS, CONDITION_COST_MEANINGS, DURATION_CONCENTRATION_MODES, CONDITION_NUMERIC_FACTS, CONDITION_SET_FACTS, TARGETING_VARIABLE_SOURCES, COMPONENT_AVAILABILITIES, FOUNDATION_ACTION_CATEGORIES, EFFECT_FORMULA_SOURCE_KINDS, COMPARISON_TARGETS, CRITICAL_THREAT_RULES, CRITICAL_HIT_RULES, CRITICAL_DAMAGE_RULES, STAT_MASTERY_SIGNALS, AFFINITY_AUTHORITY_CAPACITY_SOURCES, CASTING_CONDITION_CAPACITY_SOURCES, CHAIN_BEHAVIORS, MARTIAL_SAVE_CONTROLS, ACTIVE_MAGIC_DISMISSAL, ACTIVE_MAGIC_DURATIONS, MANA_LOCK_AMOUNT_KINDS, IMPROVED_AP_COST_MODELS, ROLL_COMPARISON_OPERATORS, ROLL_MODE_VARIABLES, CONSTRUCTION_FORMULA_INPUTS, CONDITION_POLICY_FORMULA_INPUTS, CONDITION_POLICY, MANEUVER_COST_POLICY, ACTIVE_MAGIC_FORMULA_INPUTS, EFFECT_EXECUTION_POLICY, ACTIVE_MAGIC_POLICY,
} from "@prowess/game";
import { RESOURCE_CEILINGS, RESOURCE_KINDS, RESOURCE_OVERFLOW_POLICIES, RESOURCE_REFRESH_TARGETS } from "@prowess/rules";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABILITY_COMPONENT_CONTRACTS,
  COMPATIBILITY_RELATIONS,
  ANCESTRY_SKILL_SELECTION_KINDS,
  ANCESTRY_STAT_GRANT_KINDS,
  CANONICAL_AFFINITIES,
  COST_CURRENCIES,
  DURATION_CONCEPTS,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_KIND_NAMES,
  PROWESS_STATS,
  PROWESS_SYSTEM_FAMILIES,
  RESOLUTION_MODES,
  TARGETING_SEMANTIC_SHAPES,
  TRAIT_SCOPES,
  legacyTermFor,
  ATTACK_AREA_SHAPES,
  ATTACK_RESOLUTION_MODES,
  ATTACK_SCALINGS,
  ATTACK_TARGETING_MODES,
  DAMAGE_OUTCOMES,
  EQUIPMENT_MODIFIER_TARGETS,
  SAVING_THROW_DCS,
  TRAIT_PARAMETER_KINDS,
  TRAIT_USE_SITES,
  WEAPON_REQUIREMENT_KINDS,
  DAMAGE_TYPES,
  EQUIPMENT_ROLES,
  TRAIT_EXECUTION_STATUSES,
  WEAPON_CATEGORIES,
  WEAPON_HANDEDNESS,
  WEAPON_PROFILE_KINDS,
  WEAPON_SCALING_MODELS,
  BONUS_TARGETS,
  CORE_PROCEDURES,
  DERIVED_STATISTICS,
} from "@prowess/game";
import { authoringKind, getAuthoringCatalog } from "../../src/compendium-authoring/catalog.js";

/**
 * PAS-10 M6-WO1 §8 / §40 — the authoring catalog is a PROJECTION of the certified M5 registry, never a second list
 * (M6-I002). Every kind, every allowed EntityType, every schema version and every option vocabulary is checked against
 * @prowess/game itself, so a change to the M5 catalog flows into authoring with no second edit — and a divergent
 * hand-written copy would fail here.
 */
const catalog = getAuthoringCatalog();

describe("M6-WO1 authoring catalog (M6-I002 no second Definition catalog)", () => {
  it("lists exactly the M5 Definition kinds, in the M5 order", () => {
    expect(catalog.kinds.map((k) => k.definitionKind)).toEqual([...PROWESS_DEFINITION_KIND_NAMES]);
  });

  it.each(PROWESS_DEFINITION_KIND_NAMES.map((k) => [k]))("%s: family, branch, contract, EntityTypes and schema versions equal the M5 spec", (kind) => {
    const spec = PROWESS_DEFINITION_KINDS[kind];
    const row = catalog.kinds.find((k) => k.definitionKind === kind)!;
    expect(row).toEqual({
      definitionKind: kind,
      systemFamily: spec.family,
      branch: spec.branch,
      sharedContract: spec.contract,
      allowedEntityTypes: [...spec.entityTypes],
      supportedSchemaVersions: [...spec.schemaVersions].sort((a, b) => a - b),
      authoringSchemaVersion: spec.schemaVersions.length === 0 ? null : Math.max(...spec.schemaVersions),
      authorable: spec.schemaVersions.length > 0,
    });
    expect(authoringKind(kind)).toEqual(row);
  });

  it("reserved kinds (no payload contract yet) are known but not authorable — authoring fails closed (§55)", () => {
    const reserved = catalog.kinds.filter((k) => !k.authorable).map((k) => k.definitionKind);
    expect(reserved.length).toBeGreaterThan(0);
    for (const kind of reserved) expect(PROWESS_DEFINITION_KINDS[kind].schemaVersions).toEqual([]);
    // M6-WO6 activated WEAPON / EQUIPMENT_TRAIT and added ATTACK; ARMOR stays reserved.
    expect(reserved).toContain("SUMMON_ACTION_MODEL"); // RULES-WO1 Phase C activated ARMOR; SUMMON_ACTION_MODEL stays reserved
    expect(reserved).not.toContain("WEAPON");
  });

  it("unknown values are not kinds — nothing is guessed from a name", () => {
    for (const v of ["SPELL_FIREBALL", "spell_effect", "Spell Effect", "", null, 7]) expect(authoringKind(v)).toBeNull();
  });

  it("option vocabularies are the M5 constants verbatim", () => {
    expect(catalog.systemFamilies).toEqual([...PROWESS_SYSTEM_FAMILIES]);
    expect(catalog.vocabularies).toEqual({
      targetingSemanticShapes: [...TARGETING_SEMANTIC_SHAPES],
      resolutionModes: [...RESOLUTION_MODES],
      traitScopes: [...TRAIT_SCOPES],
      durationConcepts: [...DURATION_CONCEPTS],
      costCurrencies: [...COST_CURRENCIES],
      canonicalAffinities: [...CANONICAL_AFFINITIES],
      componentContracts: [...ABILITY_COMPONENT_CONTRACTS],
      compatibilityRelations: [...COMPATIBILITY_RELATIONS],
      // M6-WO3 character-facing vocabularies.
      prowessStats: [...PROWESS_STATS],
      ancestryStatGrantKinds: [...ANCESTRY_STAT_GRANT_KINDS],
      ancestrySkillSelectionKinds: [...ANCESTRY_SKILL_SELECTION_KINDS],
      // M6-WO6 EQUIPMENT-family vocabularies.
      weaponCategories: [...WEAPON_CATEGORIES],
      weaponHandedness: [...WEAPON_HANDEDNESS],
      weaponScalingModels: [...WEAPON_SCALING_MODELS],
      attackScalings: [...ATTACK_SCALINGS],
      weaponProfileKinds: [...WEAPON_PROFILE_KINDS],
      equipmentRoles: [...EQUIPMENT_ROLES],
      damageTypes: [...DAMAGE_TYPES],
      traitExecutionStatuses: [...TRAIT_EXECUTION_STATUSES],
      traitUseSites: [...TRAIT_USE_SITES],
      traitParameterKinds: [...TRAIT_PARAMETER_KINDS],
      attackTargetingModes: [...ATTACK_TARGETING_MODES],
      attackAreaShapes: [...ATTACK_AREA_SHAPES],
      attackResolutionModes: [...ATTACK_RESOLUTION_MODES],
      damageOutcomes: [...DAMAGE_OUTCOMES],
      savingThrowDcs: [...SAVING_THROW_DCS],
      equipmentModifierTargets: [...EQUIPMENT_MODIFIER_TARGETS],
      weaponRequirementKinds: [...WEAPON_REQUIREMENT_KINDS],
      // PRE-M7-WO1 core Formula grammar (the two mirrors are pinned against the M5 reader in pre-m7-wo1-catalog).
      derivedStatistics: [...DERIVED_STATISTICS],
      coreProcedures: [...CORE_PROCEDURES],
      bonusTargets: [...BONUS_TARGETS],
      formulaSourceKinds: ["STAT", "CHOSEN_STAT", "CHARACTER", "CHARACTER_DIE_FACES", "DERIVED", "NATURAL", "SKILL_RANK_BONUS", "EXPLICIT_BONUSES", "MOVEMENT_DISTANCE", "CREATURE_SIZE_BASE_MOVEMENT"],
      derivedFormulaSourceKinds: ["STAT", "CHARACTER", "CHARACTER_DIE_FACES", "DERIVED", "EXPLICIT_BONUSES", "CREATURE_SIZE_BASE_MOVEMENT"],
      characterFields: ["LEVEL", "BASE_HP", "BASE_MP"],
      formulaRoundings: ["NONE", "FLOOR", "CEIL"],
      creatureSizes: ["SMALL", "MEDIUM", "LARGE", "HUGE", "MASSIVE"],
      terrainKinds: ["NORMAL", "DIFFICULT"],
      weaknessSeverities: ["MINOR", "MODERATE", "MAJOR"],
      movementFormulaSourceKinds: ["MOVEMENT_DISTANCE"],
      rollFormulaSourceKinds: ["STAT", "CHOSEN_STAT", "CHARACTER", "CHARACTER_DIE_FACES", "DERIVED", "NATURAL", "SKILL_RANK_BONUS", "EXPLICIT_BONUSES", "CREATURE_SIZE_BASE_MOVEMENT"],
      initiativeFormulaSourceKinds: ["NATURAL", "STAT", "EXPLICIT_BONUSES"],
      movementGrantSourceKinds: ["DERIVED"],
      mageArtActiveEffectWindows: [...MAGE_ART_ACTIVE_EFFECT_WINDOWS],
      actionTimings: [...ACTION_TIMINGS],
      actionCostModels: [...ACTION_COST_MODELS],
      variableCostDeterminers: [...VARIABLE_COST_DETERMINERS],
      paymentPolicies: [...PAYMENT_POLICIES],
      combatTimingEvents: [...COMBAT_TIMING_EVENTS],
      runtimeResourceKeys: [...RUNTIME_RESOURCE_KEYS],
      resourceKinds: [...RESOURCE_KINDS],
      resourceMaximumSources: [...RESOURCE_MAXIMUM_SOURCES],
      resourceRefreshTargets: [...RESOURCE_REFRESH_TARGETS],
      resourceExpiryTargets: [...RESOURCE_EXPIRY_TARGETS],
      resourceSpending: [...RESOURCE_SPENDING],
      resourceCeilings: [...RESOURCE_CEILINGS],
      resourceOverflowPolicies: [...RESOURCE_OVERFLOW_POLICIES],
      resourceUsageRestrictions: [...RESOURCE_USAGE_RESTRICTIONS],
      rollModes: [...ROLL_MODES],
      rollProcedures: [...ROLL_PROCEDURES],
      initiativeTiebreakKinds: [...INITIATIVE_TIEBREAK_KINDS],
      affinityRanks: [...AFFINITY_RANKS],
      affinityProgressionModes: [...AFFINITY_PROGRESSION_MODES],
      affinityAdvancementActions: [...AFFINITY_ADVANCEMENT_ACTIONS],
      affinityRankUpTargets: [...AFFINITY_RANK_UP_TARGETS],
      affinityRoles: [...AFFINITY_ROLES],
      actionImprovementPrerequisites: [...ACTION_IMPROVEMENT_PREREQUISITE_KINDS],
      actionImprovementModifications: [...ACTION_IMPROVEMENT_MODIFICATION_KINDS],
      // RULES-WO1 authored values, Skill benefits and the Concentration rule.
      canonStatuses: [...CANON_STATUSES],
      calculatedValuePlacements: [...CALCULATED_VALUE_PLACEMENTS],
      valueInputKinds: [...VALUE_INPUT_KINDS],
      // The guided input list omits reading ANOTHER calculated value (no static list of values exists to pick from).
      valueBaseSourceKinds: [...BENEFIT_AMOUNT_INPUT_KINDS],
      benefitAmountSourceKinds: [...BENEFIT_AMOUNT_INPUT_KINDS],
      concentrationCapacitySourceKinds: [...CONCENTRATION_CAPACITY_INPUT_KINDS],
      concentrationUpkeepSourceKinds: [...CONCENTRATION_UPKEEP_INPUT_KINDS],
      armorCategories: [...ARMOR_CATEGORIES],
      stealthEffects: [...STEALTH_EFFECTS],
      conditionDurationModels: [...CONDITION_DURATION_MODELS],
      conditionOngoingTimings: [...CONDITION_ONGOING_TIMINGS],
      conditionStacking: [...CONDITION_STACKING],
      summonEngines: [...SUMMON_ENGINES],
      summonSustainModes: [...SUMMON_SUSTAIN_MODES],
      summonCostSourceKinds: [...SUMMON_COST_INPUT_KINDS],
      summonLimitSourceKinds: [...SUMMON_LIMIT_INPUT_KINDS],
      missionRuleShapes: [...MISSION_RULE_SHAPES],
      referenceRuleShapes: [...REFERENCE_RULE_SHAPES],
      clockVisibilities: [...CLOCK_VISIBILITIES],
      metamagicForms: [...METAMAGIC_FORMS],
      conditionTriggers: [...CONDITION_TRIGGERS],
      summonActionModels: [...SUMMON_ACTION_MODELS],
      summonActionTimings: [...SUMMON_ACTION_TIMINGS],
      summonResourceOwners: [...SUMMON_RESOURCE_OWNERS],
      summonRestrictionKinds: [...SUMMON_RESTRICTION_KINDS],
      summonDismissals: [...SUMMON_DISMISSALS],
      mageArtBenefitKinds: [...MAGE_ART_BENEFIT_KINDS],
      mageArtExceptionKinds: [...MAGE_ART_EXCEPTION_KINDS],
      weaponModificationChangeKinds: [...WEAPON_MODIFICATION_CHANGE_KINDS],
      prerequisiteGroupModes: [...SKILL_BENEFIT_GROUP_MODES],
      mageArtScalingSourceKinds: [...MAGE_ART_SCALING_INPUT_KINDS],
      // RULES-WO1 Phase F.
      spellEffectFamilies: [...SPELL_EFFECT_FAMILIES],
      effectSubfamilies: [...EFFECT_SUBFAMILIES],
      effectResolutionPolicies: [...EFFECT_RESOLUTION_POLICIES],
      effectAttackTypes: [...EFFECT_ATTACK_TYPES],
      effectSaveSelectionPolicies: [...EFFECT_SAVE_SELECTION_POLICIES],
      effectParameterKinds: [...EFFECT_PARAMETER_KINDS],
      effectLimitKinds: [...EFFECT_LIMIT_KINDS],
      effectCostKinds: [...EFFECT_COST_KINDS],
      effectOutcomeKeys: [...EFFECT_OUTCOME_KEYS],
      effectOutcomeOperations: [...EFFECT_OUTCOME_OPERATIONS],
      targetCategories: [...TARGET_CATEGORIES],
      traitFamilies: [...TRAIT_FAMILIES],
      traitModifications: [...TRAIT_MODIFICATIONS],
      constructionPrerequisiteKinds: [...CONSTRUCTION_PREREQUISITE_KINDS],
      stackLimitKinds: [...STACK_LIMIT_KINDS],
      constructionSkillTracks: [...CONSTRUCTION_SKILL_TRACKS],
      mageArtImmunityKinds: [...MAGE_ART_IMMUNITY_KINDS],
      mageArtCalculationKinds: [...MAGE_ART_CALCULATION_KINDS],
      mageArtRangeTargetKinds: [...MAGE_ART_RANGE_TARGET_KINDS],
      targetingMeasures: [...TARGETING_MEASURES],
      conditionOutcomeKinds: [...CONDITION_OUTCOME_KINDS],
      conditionPreventions: [...CONDITION_PREVENTIONS],
      deliveryFamilies: [...DELIVERY_FAMILIES],
      targetCardinalityKinds: [...TARGET_CARDINALITY_KINDS],
      targetingRangeModels: [...TARGETING_RANGE_MODELS],
      targetingMeasureStatuses: [...TARGETING_MEASURE_STATUSES],
      targetingOriginModes: [...TARGETING_ORIGIN_MODES],
      auraSources: [...AURA_SOURCES],
      targetingPlacementModels: [...TARGETING_PLACEMENT_MODELS],
      sightPolicies: [...SIGHT_POLICIES],
      coverPolicies: [...COVER_POLICIES],
      targetingParameterKinds: [...TARGETING_PARAMETER_KINDS],
      targetingCostKinds: [...TARGETING_COST_KINDS],
      conditionCostMeanings: [...CONDITION_COST_MEANINGS],
      durationConcentrationModes: [...DURATION_CONCENTRATION_MODES],
      conditionNumericFacts: [...CONDITION_NUMERIC_FACTS],
      conditionSetFacts: [...CONDITION_SET_FACTS],
      targetingVariableSources: [...TARGETING_VARIABLE_SOURCES],
      componentAvailability: [...COMPONENT_AVAILABILITIES],
      foundationActionCategories: [...FOUNDATION_ACTION_CATEGORIES],
      effectFormulaSourceKinds: [...EFFECT_FORMULA_SOURCE_KINDS],
      comparisonTargets: [...COMPARISON_TARGETS],
      criticalThreatRules: [...CRITICAL_THREAT_RULES],
      criticalHitRules: [...CRITICAL_HIT_RULES],
      criticalDamageRules: [...CRITICAL_DAMAGE_RULES],
      statMasterySignals: [...STAT_MASTERY_SIGNALS],
      affinityAuthorityCapacitySources: [...AFFINITY_AUTHORITY_CAPACITY_SOURCES],
      castingConditionCapacitySources: [...CASTING_CONDITION_CAPACITY_SOURCES],
      chainBehaviors: [...CHAIN_BEHAVIORS],
      martialSaveControls: [...MARTIAL_SAVE_CONTROLS],
      activeMagicDismissals: [...ACTIVE_MAGIC_DISMISSAL],
      activeMagicDurations: [...ACTIVE_MAGIC_DURATIONS],
      manaLockAmountKinds: [...MANA_LOCK_AMOUNT_KINDS],
      improvedApCostModels: [...IMPROVED_AP_COST_MODELS],
    });
  });

  it("RULES-WO1 Phase H: fixed Formula-input lists and the Core Playtest policy rulings come verbatim from @prowess/game", () => {
    const c = getAuthoringCatalog();
    expect(c.fixedLists["rollComparisonOperators"]).toEqual([...ROLL_COMPARISON_OPERATORS]);
    expect(c.fixedLists["naturalRolls:ADVANTAGE"]).toEqual([...ROLL_MODE_VARIABLES.ADVANTAGE]);
    expect(c.fixedLists["martialSaveRanks"]).toEqual(Object.keys(EFFECT_EXECUTION_POLICY.martialSaveControl));
    for (const [slot, vars] of Object.entries(CONSTRUCTION_FORMULA_INPUTS)) expect(c.fixedLists[`constructionInputs:${slot}`]).toEqual([...vars]);
    for (const [slot, vars] of Object.entries(CONDITION_POLICY_FORMULA_INPUTS)) expect(c.fixedLists[`conditionPolicyInputs:${slot}`]).toEqual([...vars]);
    for (const [slot, f] of Object.entries(MANEUVER_COST_POLICY.formulas)) expect(c.fixedLists[`maneuverCostInputs:${slot}`]).toEqual([...f.variables]);
    for (const [slot, vars] of Object.entries(ACTIVE_MAGIC_FORMULA_INPUTS)) expect(c.fixedLists[`activeMagicInputs:${slot}`]).toEqual([...vars]);
    expect(c.rulingDefaults).toEqual(JSON.parse(JSON.stringify({ conditionPolicy: CONDITION_POLICY, maneuverCostPolicy: MANEUVER_COST_POLICY, effectExecutionPolicy: EFFECT_EXECUTION_POLICY, activeMagicPolicy: ACTIVE_MAGIC_POLICY })));
  });

  it("legacy-term pairs are exactly those M5 provenance accepts (§68)", () => {
    expect(catalog.legacyTerms.length).toBeGreaterThan(0);
    for (const pair of catalog.legacyTerms) {
      const known = legacyTermFor(pair.legacyTerm);
      expect(known?.canonicalTerm, pair.legacyTerm).toBe(pair.canonicalTerm);
    }
    expect(catalog.legacyTerms).toContainEqual({ legacyTerm: "Emission", canonicalTerm: "Evocation" });
  });

  it("is plain JSON data (safe to serve over HTTP)", () => {
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });
});

/**
 * The Studio UI tests render the editor against this exact catalog (apps/studio cannot import the M5 domain package,
 * M5-I017), so the fixture is GENERATED from the live catalog and checked here for drift. Regenerate deliberately with
 * M6_WO1_WRITE_FIXTURE=1.
 */
describe("Studio UI catalog fixture", () => {
  const fixturePath = resolve(import.meta.dirname, "../../../../apps/studio/tests/unit/fixtures/m6-wo1-catalog.json");
  it("equals the live authoring catalog", () => {
    const live = `${JSON.stringify(getAuthoringCatalog(), null, 2)}\n`;
    if (process.env.M6_WO1_WRITE_FIXTURE === "1") writeFileSync(fixturePath, live);
    expect(readFileSync(fixturePath, "utf8")).toBe(live);
  });
});

describe("PRE-M7-WO1 Compendium Stat token mirror", () => {
  it("COMPENDIUM_STAT_TOKENS equals the engine's PROWESS_STATS", async () => {
    const { COMPENDIUM_STAT_TOKENS } = await import("@prowess/model");
    const { PROWESS_STATS } = await import("@prowess/game");
    expect([...COMPENDIUM_STAT_TOKENS]).toEqual([...PROWESS_STATS]);
  });
});
