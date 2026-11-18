import {
  ABILITY_COMPONENT_CONTRACTS,
  ANCESTRY_SKILL_SELECTION_KINDS,
  ANCESTRY_STAT_GRANT_KINDS,
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
  CANONICAL_AFFINITIES,
  COST_CURRENCIES,
  DURATION_CONCEPTS,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_KIND_NAMES,
  PROWESS_STATS,
  PROWESS_SYSTEM_FAMILIES,
  RESOLUTION_MODES,
  TARGETING_SEMANTIC_SHAPES,
  TERMINOLOGY_INVENTORY,
  TRAIT_SCOPES,
  isProwessDefinitionKind,
  type ProwessDefinitionKind,
  BONUS_TARGETS,
  CORE_PROCEDURES,
  DERIVED_STATISTICS,
  AFFINITY_WEAKNESS_SEVERITIES,
  CREATURE_SIZES,
  TERRAIN_KINDS,
  ACTION_COST_MODELS,
  ACTION_IMPROVEMENT_MODIFICATION_KINDS,
  ACTION_IMPROVEMENT_PREREQUISITE_KINDS,
  ACTION_TIMINGS,
  AFFINITY_ADVANCEMENT_ACTIONS,
  AFFINITY_PROGRESSION_MODES,
  AFFINITY_RANKS,
  AFFINITY_RANK_UP_TARGETS,
  AFFINITY_ROLES,
  COMBAT_TIMING_EVENTS,
  INITIATIVE_TIEBREAK_KINDS,
  PAYMENT_POLICIES,
  RESOURCE_EXPIRY_TARGETS,
  RESOURCE_MAXIMUM_SOURCES,
  RESOURCE_SPENDING,
  RESOURCE_USAGE_RESTRICTIONS,
  ROLL_MODES,
  ROLL_PROCEDURES,
  RUNTIME_RESOURCE_KEYS,
  VARIABLE_COST_DETERMINERS,
} from "@prowess/game";
import { FORMULA_ROUNDING_MODES, RESOURCE_CEILINGS, RESOURCE_KINDS, RESOURCE_OVERFLOW_POLICIES, RESOURCE_REFRESH_TARGETS } from "@prowess/rules";
import { CHARACTER_FIELD_TOKENS, DERIVED_FORMULA_SOURCE_KINDS, FORMULA_SOURCE_KINDS } from "../compendium-rules/formula-vocabulary.js";

export { CHARACTER_FIELD_TOKENS, DERIVED_FORMULA_SOURCE_KINDS, FORMULA_SOURCE_KINDS };

/**
 * The Compendium authoring catalog (PAS-10 M6-WO1 §8, §40) — a read-only PROJECTION of the certified M5 Definition
 * registry, never a second list. Every row is computed from `PROWESS_DEFINITION_KINDS`; every option list is an M5
 * vocabulary constant passed through unchanged. Nothing here decides legality: the M5 contract does, at validation.
 *
 * A kind is AUTHORABLE exactly when M5 supports at least one payload schema version for it. A kind with
 * `schemaVersions: []` is known but RESERVED — its payload contract belongs to a later Work Order — so authoring
 * fails closed for it (§55) instead of guessing a shape.
 */
export interface AuthoringDefinitionKind {
  readonly definitionKind: ProwessDefinitionKind;
  readonly systemFamily: string;
  readonly branch: string | null;
  readonly sharedContract: string | null;
  readonly allowedEntityTypes: readonly string[];
  readonly supportedSchemaVersions: readonly number[];
  /** The highest supported payload version — what a NEW Definition of this kind is authored at. Null when reserved. */
  readonly authoringSchemaVersion: number | null;
  readonly authorable: boolean;
}

export interface AuthoringCatalog {
  readonly kinds: readonly AuthoringDefinitionKind[];
  readonly systemFamilies: readonly string[];
  /** M5 vocabularies the authoring descriptors render as option lists — values verbatim from @prowess/game. */
  readonly vocabularies: Readonly<Record<string, readonly string[]>>;
  /** Inventoried LEGACY → CANONICAL terminology pairs: the only legacy terms provenance may record (§68). */
  readonly legacyTerms: readonly { readonly legacyTerm: string; readonly canonicalTerm: string }[];
}

function kindRow(kind: ProwessDefinitionKind): AuthoringDefinitionKind {
  const spec = PROWESS_DEFINITION_KINDS[kind];
  const versions = [...spec.schemaVersions].sort((a, b) => a - b);
  return {
    definitionKind: kind,
    systemFamily: spec.family,
    branch: spec.branch,
    sharedContract: spec.contract,
    allowedEntityTypes: [...spec.entityTypes],
    supportedSchemaVersions: versions,
    authoringSchemaVersion: versions.length === 0 ? null : (versions[versions.length - 1] as number),
    authorable: versions.length > 0,
  };
}

export function getAuthoringCatalog(): AuthoringCatalog {
  return {
    kinds: PROWESS_DEFINITION_KIND_NAMES.map(kindRow),
    systemFamilies: [...PROWESS_SYSTEM_FAMILIES],
    vocabularies: {
      targetingSemanticShapes: [...TARGETING_SEMANTIC_SHAPES],
      resolutionModes: [...RESOLUTION_MODES],
      traitScopes: [...TRAIT_SCOPES],
      durationConcepts: [...DURATION_CONCEPTS],
      costCurrencies: [...COST_CURRENCIES],
      canonicalAffinities: [...CANONICAL_AFFINITIES],
      componentContracts: [...ABILITY_COMPONENT_CONTRACTS],
      // M6-WO3: the character-facing contracts (ANCESTRY / CHARACTER_CREATION_RULE) — Stat tokens and grant grammar.
      prowessStats: [...PROWESS_STATS],
      ancestryStatGrantKinds: [...ANCESTRY_STAT_GRANT_KINDS],
      ancestrySkillSelectionKinds: [...ANCESTRY_SKILL_SELECTION_KINDS],
      // M6-WO6: the EQUIPMENT-family contracts (WEAPON / ATTACK / EQUIPMENT_TRAIT) — closed grammar tokens only.
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
      // PRE-M7-WO1: the core Formula grammar the guided rule editor renders (DERIVED_STAT / CORE_RESOLUTION). The
      // statistic / procedure / bonus-target lists are the M5 constants; the source kinds and Character fields mirror
      // the M5 Formula reader (not exported by @prowess/game) and are pinned by a test that feeds each value through
      // that reader, so the mirror cannot drift silently.
      derivedStatistics: [...DERIVED_STATISTICS],
      coreProcedures: [...CORE_PROCEDURES],
      bonusTargets: [...BONUS_TARGETS],
      formulaSourceKinds: [...FORMULA_SOURCE_KINDS],
      derivedFormulaSourceKinds: [...DERIVED_FORMULA_SOURCE_KINDS],
      characterFields: [...CHARACTER_FIELD_TOKENS],
      formulaRoundings: [...FORMULA_ROUNDING_MODES],
      // PRE-M7-WO1 guided editors for the runtime / progression kinds.
      creatureSizes: [...CREATURE_SIZES],
      terrainKinds: [...TERRAIN_KINDS],
      weaknessSeverities: [...AFFINITY_WEAKNESS_SEVERITIES],
      movementFormulaSourceKinds: ["MOVEMENT_DISTANCE"],
      // PRE-M7-WO1 guided editors for actions, resources, core procedures, Affinity rules and action improvements.
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
    },
    legacyTerms: TERMINOLOGY_INVENTORY.filter((t) => t.status === "LEGACY" && t.canonicalTerm !== null)
      .map((t) => ({ legacyTerm: t.term, canonicalTerm: t.canonicalTerm as string }))
      .sort((a, b) => (a.legacyTerm < b.legacyTerm ? -1 : a.legacyTerm > b.legacyTerm ? 1 : 0)),
  };
}

/** The catalog row of a kind, or null when the value is not an M5 Definition kind at all. */
export function authoringKind(kind: unknown): AuthoringDefinitionKind | null {
  return isProwessDefinitionKind(kind) ? kindRow(kind) : null;
}
