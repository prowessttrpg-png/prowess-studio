/**
 * @prowess/game — the Prowess-specific pure domain layer (PAS-10 M5-WO1).
 *
 * M5-WO2 adds the first executable Prowess mechanics: core resolution (rolls, Advantage / Disadvantage, criticals),
 * the six Ability Scores, the Character Die progression, rank primitives and derived statistics — all compiled into
 * M4 FORMULA / REQUIREMENT / MODIFIER steps. See docs/architecture/m5-core-resolution-stats-dice-ranks.md.
 *
 * M5-WO3 adds runtime Resources (HP, MP, ME, AP, Counter Action, movement allowance), the action economy, Base
 * Movement, Initiative and roll-signal resolution — compiled into chains of M4 RESOURCE operations. See
 * docs/architecture/m5-runtime-resources-action-economy.md.
 *
 * M5-WO4 adds Affinity as executable structured content: the six canonical Affinities, Affinity Rank, ownership,
 * standard progression, exact Keyword alignment (Strength / Weakness), the reusable Spell MP Affinity modifier
 * fragment, Affinity Authority and Affinity access prerequisites — compiled into M4 KEYWORD / REQUIREMENT / MODIFIER
 * steps. See docs/architecture/m5-affinity-structured-rules.md.
 *
 * Owns Prowess Definition contracts, the shared modular Ability Construction grammar (Spell / Maneuver branches),
 * exact Definition bundles and the Prowess → M4 compilation contract. Depends on @prowess/model and @prowess/rules
 * only. It never re-implements the M4 engine: Prowess compiles INTO M4 EvaluationPlans. See
 * docs/architecture/m5-prowess-domain-compilation.md.
 *
 * Explicit public surface (no `export *`): internal readers and plain-data guards are not exported.
 */
export {
  PROWESS_COMPILATION_CONTRACT_VERSION,
  SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS,
  type ProwessCompilationContractVersion,
} from "./contract-version.js";
export type { ProwessOutcome, ProwessProblem } from "./internal/problems.js";

export {
  ABILITY_COMPONENT_CONTRACTS,
  ABILITY_KINDS,
  ABILITY_SLOT_KINDS,
  PROWESS_DEFINITION_KINDS,
  PROWESS_DEFINITION_KIND_NAMES,
  PROWESS_SYSTEM_FAMILIES,
  definitionKindSpec,
  isAbilityKind,
  isProwessDefinitionKind,
  isProwessSystemFamily,
  type AbilityComponentContract,
  type AbilityKind,
  type AbilitySlot,
  type DefinitionKindSpec,
  type ProwessDefinitionKind,
  type ProwessSystemFamily,
} from "./vocabulary/families.js";
export {
  CANONICAL_AFFINITIES,
  COST_CURRENCIES,
  DURATION_CONCEPTS,
  RESOLUTION_MODES,
  TARGETING_SEMANTIC_SHAPES,
  TRAIT_SCOPES,
  type CanonicalAffinity,
  type CostCurrency,
  type DurationConcept,
  type ResolutionMode,
  type TargetingSemanticShape,
  type TraitScope,
} from "./vocabulary/construction.js";
export {
  TERMINOLOGY_CATEGORIES,
  TERMINOLOGY_INVENTORY,
  TERMINOLOGY_STATUSES,
  legacyTermFor,
  type TerminologyCategory,
  type TerminologyEntry,
  type TerminologyStatus,
} from "./vocabulary/terminology.js";

export {
  AFFINITY_ERROR_CODES,
  BUNDLE_ERROR_CODES,
  CONSTRUCTION_ERROR_CODES,
  TARGETING_ERROR_CODES,
  COMPILATION_ERROR_CODES,
  COMPOSITION_ERROR_CODES,
  CORE_ERROR_CODES,
  DEFINITION_ERROR_CODES,
  MATERIALIZATION_ERROR_CODES,
  RUNTIME_ERROR_CODES,
} from "./definition/codes.js";
export {
  createProwessDefinitionEnvelope,
  definitionRefOf,
  isSameExactDefinition,
  type LegacyTermUse,
  type ProwessDefinitionEnvelope,
  type ProwessDefinitionProvenance,
  type ProwessDefinitionRef,
} from "./definition/envelope.js";
export {
  ABILITY_CONDITION_FORBIDDEN_KEYS,
  TARGETING_FORBIDDEN_KEYS,
  type AbilityConditionDefinitionPayload,
  type AffinityDefinitionPayload,
  type CompatibilityRule,
  type CostContribution,
  type DurationDefinitionPayload,
  type EffectDefinitionPayload,
  type TargetingDefinitionPayload,
  type TraitDefinitionPayload,
} from "./definition/payload.js";
export { PROWESS_DEFINITION_STORAGE_KEY, readStoredProwessDefinition, type StoredDefinitionReading } from "./definition/storage.js";

export {
  bundleMatchesRuleset,
  createProwessDefinitionBundle,
  findBundleDefinition,
  rulesetProvenanceOf,
  type ProwessDefinitionBundle,
  type ProwessRulesetProvenance,
} from "./bundle/bundle.js";

export {
  compositionComponents,
  validateAbilityComposition,
  type AbilityComposition,
  type AbilityCompositionBase,
  type ComponentUse,
  type ManeuverBranchData,
  type ManeuverComposition,
  type OrderedComponentUse,
  type SpellBranchData,
  type SpellComposition,
  type TraitUse,
} from "./construction/composition.js";
export { componentContractOf, implementSameContract, shareTargetingSemanticShape } from "./construction/contracts.js";

// ---- M5-WO2: core resolution, Ability Scores, Character Dice and rank primitives ------------------------------------
export {
  BONUS_TARGETS,
  CHARACTER_PROPERTY_KEYS,
  COMPARISON_STATE_KEYS,
  CORE_PROCEDURES,
  DEFERRED_STATISTICS,
  DERIVED_STATISTICS,
  INITIATIVE_TIEBREAK_KINDS,
  PROWESS_STATS,
  ROLL_MODES,
  ROLL_MODE_VARIABLES,
  ROLL_PROCEDURES,
  ROLL_STATE_KEYS,
  SKILL_RANK_LADDER_KEY,
  STAT_CONTEXT_KEYS,
  type BonusTarget,
  type CoreProcedure,
  type DerivedStatistic,
  type InitiativeTiebreakKind,
  type ProwessStat,
  type RollMode,
  type RollProcedure,
} from "./vocabulary/core.js";
export type {
  CharacterDieBand,
  CharacterDieProgressionPayload,
  CharacterDieSize,
  CoreDefinitionSource,
  CoreFormula,
  CoreResolutionPayload,
  CoreRollPayload,
  DerivedStatPayload,
  FormulaVariableDeclaration,
  FormulaVariableSource,
  InitiativePayload,
  InitiativeTiebreak,
  RankLadderPayload,
  SkillRankPayload,
  StatDefinitionPayload,
  StatMasteryPayload,
} from "./definition/core-payload.js";
export { indexCoreDefinitions, type CoreDefinitionIndex, type CoreEntry } from "./core/definitions.js";
export {
  bonusPropertyKey,
  buildCharacterActorContext,
  resolveCharacterDie,
  validateCharacterCore,
  type CharacterCore,
  type CharacterDie,
  type CharacterSkillRank,
  type ExplicitBonus,
  type ValidatedCharacterCore,
} from "./core/character.js";
export { rankAtLeastRequirement, rankFact } from "./core/ranks.js";
export { buildRollRuntimeContext, resolveRollMode, resolveRollSignals, validateDieRollInput, type ProwessDieRollInput, type RollSignalResolution } from "./core/dice.js";
export {
  CORE_SUBJECT_KINDS,
  buildCoreResolutionContexts,
  compileCoreResolution,
  type CoreCompilationRequest,
  type CoreCompilationSubject,
  type CoreCompiledOutputs,
  type CoreResolutionSubject,
  type CoreSubjectKind,
  type DerivedStatisticsSubject,
  type ProwessCoreCompiledPlan,
} from "./core/compile.js";

// ---- M5-WO3: runtime Resources, action economy, movement and roll-state resolution -----------------------------------
export {
  ACTION_COST_MODELS,
  ACTION_TIMINGS,
  COMBAT_ROUND_SEQUENCE,
  COMBAT_TIMING_EVENTS,
  CREATURE_SIZES,
  PAYMENT_POLICIES,
  RESOURCE_CONTEXT_KEYS,
  RESOURCE_EXPIRY_TARGETS,
  RESOURCE_MAXIMUM_SOURCES,
  RESOURCE_SPENDING,
  RESOURCE_TRANSITION_OPERATIONS,
  RESOURCE_USAGE_RESTRICTIONS,
  ROLL_SIGNAL_RULING,
  RUNTIME_RESOURCE_KEYS,
  RUNTIME_STATE_KEYS,
  SIDE_PHASE_ORDER_POLICY,
  TERRAIN_KINDS,
  VARIABLE_COST_DETERMINERS,
  type ActionCostModel,
  type ActionTiming,
  type CombatRoundStep,
  type CombatTimingEvent,
  type CreatureSize,
  type PaymentPolicy,
  type ResourceTransitionOperation,
  type RuntimeResourceKey,
  type TerrainKind,
} from "./vocabulary/runtime.js";
export type {
  ActionDefinitionPayload,
  ActionPointCost,
  ActionResourceCost,
  CreatureSizeDefinitionPayload,
  ResourceDefinitionPayload,
  ResourceExpiryRule,
  ResourceMaximum,
  ResourcePaymentEligibility,
  ResourceRefreshRule,
  ResourceRestoration,
  ResourceUsageRestrictionRule,
  TerrainDefinitionPayload,
} from "./definition/runtime-payload.js";
export { indexRuntimeDefinitions, type RuntimeDefinitionIndex } from "./runtime/definitions.js";
export {
  buildRuntimeContext,
  runtimeResourcesFromSnapshots,
  validateCombatTiming,
  validateRuntimeResources,
  type CombatTiming,
  type ProwessRuntimeResourceState,
  type ProwessRuntimeResources,
} from "./runtime/resources.js";
export {
  RUNTIME_SUBJECT_KINDS,
  buildRuntimeContexts,
  compileRuntime,
  type ActionFollowOnSubject,
  type ActionPaymentReceipt,
  type ActionPaymentSubject,
  type MagicalPaymentSubject,
  type MovementSubject,
  type ProwessRuntimeCompiledPlan,
  type ResourceStateSubject,
  type ResourceTimingSubject,
  type ResourceTransitionsSubject,
  type RuntimeCompilationRequest,
  type RuntimeCompilationSubject,
  type RuntimeCompiledOutputs,
  type RuntimeCompiledPayment,
  type RuntimeSubjectKind,
} from "./runtime/compile.js";
export {
  confirmActionPayment,
  readRuntimeRun,
  type ActionPaymentConfirmation,
  type RuntimePaymentReading,
  type RuntimeRunReading,
  type RuntimeTransitionReading,
} from "./runtime/results.js";
export {
  createSidePhase,
  resolveInitiativeOrder,
  validateActingSequence,
  type InitiativeDecision,
  type InitiativeRequest,
  type InitiativeResolution,
  type InitiativeSideInput,
  type SidePhase,
} from "./runtime/combat.js";

export {
  AFFINITY_ADVANCEMENT_ACTIONS,
  AFFINITY_ALIGNMENTS,
  AFFINITY_COST_TARGETS,
  AFFINITY_PROGRESSION_MODES,
  AFFINITY_RANKS,
  AFFINITY_RANK_UP_TARGETS,
  AFFINITY_ROLES,
  AFFINITY_SUBJECT_KINDS,
  AFFINITY_WEAKNESS_SEVERITIES,
  SPELL_CONSTRUCTION_AUTHORITIES,
  type AffinityAdvancementAction,
  type AffinityAlignment,
  type AffinityCostTarget,
  type AffinityProgressionMode,
  type AffinityRank,
  type AffinityRankUpTarget,
  type AffinityRole,
  type AffinitySubjectKind,
  type AffinityWeaknessSeverity,
  type SpellConstructionAuthority,
} from "./vocabulary/affinity.js";
export type {
  AffinityAdvancementOption,
  AffinityDefinitionV2Payload,
  AffinityProgressionLevel,
  AffinityProgressionPayload,
  AffinityRankEntry,
  AffinityRankRulePayload,
  AffinityStrengthRule,
  AffinityWeaknessRule,
  AffinityWeaknessSeverityPayload,
} from "./definition/affinity-payload.js";
export { indexAffinityDefinitions, type AffinityDefinitionIndex, type AffinityEntry, type AffinityKeywordReference } from "./affinity/definitions.js";
export {
  ownedAffinity,
  validateAffinityProfile,
  validateAffinityProgression,
  type AffinityProgressionResult,
  type AffinityProgressionStatus,
  type CharacterAffinityProfile,
  type OwnedAffinity,
} from "./affinity/profile.js";
export {
  compileAffinity,
  type AffinityAccessSubject,
  type AffinityAlignmentSubject,
  type AffinityAuthoritySubject,
  type AffinityCompilationRequest,
  type AffinityCompilationSubject,
  type AffinityCompiledOutputs,
  type AffinityCompiledRule,
  type AffinityCompiledWeakness,
  type AffinityKeywordContributor,
  type ProwessAffinityCompiledPlan,
  type SpellAffinityCostSubject,
} from "./affinity/compile.js";
export {
  readAffinityRun,
  type AffinityAccessReading,
  type AffinityAlignmentResult,
  type AffinityAuthorityReading,
  type AffinityCostReading,
  type AffinityCostStage,
  type AffinityKeywordSource,
  type AffinityMatchedKeyword,
  type AffinityRuleMatch,
  type AffinityRunReading,
  type AffinityWeaknessMatch,
} from "./affinity/results.js";

export { COMPONENT_COMPILERS, compileProwessAbility } from "./compilation/compile.js";
export { compiledStepKey } from "./compilation/assemble.js";
export type {
  CompilationFragment,
  CompilationFragmentBinding,
  ProwessCompilationRequest,
  ProwessCompilationSourceMap,
  ProwessCompilationSubject,
  ProwessCompiledPlan,
  ProwessSourceMapEntry,
} from "./compilation/model.js";

// ---- M5-WO5 shared Ability Construction legality ----
export {
  AFFINITY_AUTHORITY_CAPACITY_SOURCES,
  CASTING_CONDITION_CAPACITY_SOURCES,
  CONSTRUCTION_ACCESS_PATHS,
  CONSTRUCTION_PREREQUISITE_KINDS,
  CONSTRUCTION_RULE_FAMILIES,
  CONSTRUCTION_SKILL_TRACKS,
  SIGNATURE_SLOT_USES,
  STACK_LIMIT_KINDS,
  type ConstructionAccessPath,
  type ConstructionPrerequisiteKind,
  type ConstructionRuleFamily,
  type ConstructionSkillTrack,
  type SignatureSlotUse,
  type StackLimitKind,
} from "./vocabulary/ability-construction.js";
export {
  NO_COMPONENT_CONSTRUCTION_RULES,
  readComponentConstructionRules,
  type AbilityConstructionRulePayload,
  type ArcaneCapacityRow,
  type ComponentConstructionRules,
  type ConditionCapacityRow,
  type ConstructionPrerequisite,
  type MartialCapacityRow,
  type SignatureExemption,
  type StackLimit,
  type TraitExchangeRule,
} from "./definition/ability-construction-payload.js";
export type { FoundationDefinitionPayload } from "./definition/payload.js";
export {
  compileAbilityConstruction,
  evaluateAbilityConstruction,
  readAbilityConstructionRun,
  type AbilityConstructionCharacterContext,
  type AbilityConstructionRequest,
  type AbilityConstructionResult,
  type ConstructionCompiledOutputs,
  type ConstructionCompiledRule,
  type ConstructionRuleResult,
  type ProwessConstructionCompiledPlan,
  type SignatureCandidate,
} from "./construction/legality.js";

// ---- M5-WO6 Targeting framework, geometry, range & branch catalogs ----
export {
  AURA_SOURCES,
  BASE_TARGETING_SHAPES,
  COVER_POLICIES,
  DELIVERY_FAMILIES,
  HISTORICAL_ADD_ON_SHAPES,
  SIGHT_POLICIES,
  TARGET_CARDINALITY_KINDS,
  TARGET_CATEGORIES,
  TARGETING_ADD_ONS,
  TARGETING_COMPATIBILITY_STATUSES,
  TARGETING_COST_KINDS,
  TARGETING_MEASURES,
  TARGETING_MEASURE_STATUSES,
  TARGETING_ORIGIN_MODES,
  TARGETING_PARAMETER_KINDS,
  TARGETING_PLACEMENT_MODELS,
  TARGETING_RANGE_MODELS,
  TARGETING_VARIABLE_SOURCES,
  type AuraSource,
  type BaseTargetingShape,
  type CoverPolicy,
  type DeliveryFamily,
  type SightPolicy,
  type TargetCardinalityKind,
  type TargetCategory,
  type TargetingAddOn,
  type TargetingCompatibilityStatus,
  type TargetingCostKind,
  type TargetingMeasure,
  type TargetingMeasureStatus,
  type TargetingOriginMode,
  type TargetingParameterKind,
  type TargetingPlacementModel,
  type TargetingRangeModel,
  type TargetingVariableSource,
} from "./vocabulary/targeting.js";
export {
  readTargetingCosts,
  readTargetingRules,
  type TargetingCardinality,
  type TargetingCostRule,
  type TargetingFormula,
  type TargetingMeasureRule,
  type TargetingParameterRule,
  type TargetingRankTable,
  type TargetingRules,
  type TargetingVariableDeclaration,
} from "./definition/targeting-payload.js";
export {
  compileAbilityTargeting,
  evaluateAbilityTargeting,
  readAbilityTargetingRun,
  type AbilityTargetingCharacterContext,
  type AbilityTargetingRequest,
  type AbilityTargetingResult,
  type ProwessTargetingCompiledPlan,
  type TargetingCompiledMeasure,
  type TargetingCompiledOutputs,
  type TargetingCostReport,
  type TargetingParameterValue,
} from "./targeting/compile.js";


// ---- M5-WO7 Effect framework, resolution contracts & Effect Definitions ----
export {
  SPELL_EFFECT_FAMILIES, EFFECT_SUBFAMILIES, EFFECT_RESOLUTION_POLICIES, EFFECT_ATTACK_TYPES,
  EFFECT_SAVE_SELECTION_POLICIES, EFFECT_PARAMETER_KINDS, EFFECT_LIMIT_KINDS, EFFECT_VARIABLE_SOURCE_KINDS,
  EFFECT_COST_KINDS, EFFECT_OUTCOME_KEYS, EFFECT_OUTCOME_OPERATIONS, TARGETING_DELIVERY_CHECKS,
  EFFECT_DELIVERY_INTERACTIONS,
  type SpellEffectFamily, type EffectSubfamily, type EffectResolutionPolicy, type EffectAttackType,
  type EffectSaveSelectionPolicy, type EffectParameterKind, type EffectLimitKind, type EffectVariableSourceKind,
  type EffectCostKind, type EffectOutcomeKey, type EffectOutcomeOperation, type TargetingDeliveryCheck,
  type EffectDeliveryInteraction,
} from "./vocabulary/effect.js";
export { EFFECT_ERROR_CODES, isSpellEffectFamily, type EffectRules, type EffectParameterRule, type EffectFormula, type EffectSaveProfile, type EffectDurationPolicy, type EffectCostRule, type EffectOutcomeReading, type TargetingDeliveryRule } from "./definition/effect-payload.js";
export { compileEffectUse, validateEffectUse, readEffectRun, type EffectCharacterContext, type EffectUseRequest, type EffectUseResult, type EffectCompiledOutputs, type ProwessEffectCompiledPlan } from "./effect/compile.js";

// M5-WO8: typed Traits and exact authored Spell/Maneuver Definition compilation.
export { TRAIT_FAMILIES, TRAIT_MODIFICATIONS, TRAIT_ERROR_CODES, readTraitRules, readTraitCosts, type TraitRules, type TraitFamily, type TraitModification, type TraitSelectedModification } from "./definition/trait-payload.js";
export { AUTHORED_ABILITY_ERROR_CODES, validateAuthoredAbilityDefinition, serializeAuthoredAbilityDefinition, deserializeAuthoredAbilityDefinition, type SpellDefinitionPayload, type ManeuverDefinitionPayload, type AuthoredAbilityPayload, type AttackFoundationProfile, type ActionFoundationProfile, type FoundationProfile, isAttackFoundation } from "./definition/authored-ability-payload.js";
export { compileAbilityDefinition, readAbilityDefinitionRun, evaluateAbilityDefinition, type AbilityDefinitionRequest, type ProwessAbilityDefinitionCompiledPlan, type AuthoredAbilityResult, type CompiledTrait } from "./ability/compile.js";

// M5-WO9: typed Duration and construction Conditions, consumed through compileAbilityDefinition.
export { DURATION_CONDITION_ERRORS, readDurationRules, readDurationCosts, readConditionRules, readConditionContributions, type DurationRules, type ConditionRules, type RuntimeRequirement, type ConditionModifier, type ConditionContribution } from "./definition/duration-condition-payload.js";
export { type ConditionPolicy, type ConditionFormula } from "./definition/condition-policy.js";
export type { CompiledDurationConditions, DurationConditionResult } from "./ability/duration-conditions.js";

// M5-WO10: final Spell cost, percentage netting and AP derivation — composes with compileAbilityDefinition.
export { SPELL_COST_ERROR_CODES, compileSpellCost, readSpellCostRun, evaluateSpellCost, type ProwessSpellCostCompiledPlan, type SpellCostResult, type SpellCostContributionPlan, type SpellCostPercentPlan, type SpellCostSource, type SpellCostOperation } from "./ability/spell-cost.js";
export { SPELL_COST_POLICY } from "./content/core-playtest-v0.1/spell-cost.js";

// M5-WO11: final Maneuver cost, attack floors and Signature reduction — composes with compileAbilityDefinition.
export { MANEUVER_COST_ERROR_CODES, compileManeuverCost, readManeuverCostRun, evaluateManeuverCost, type ProwessManeuverCostCompiledPlan, type ManeuverCostResult, type ManeuverCostContributionPlan, type ManeuverCostOption, type ManeuverResolutionGroup, type ManeuverStructure, type ManeuverCostSource, type ManeuverCurrency } from "./ability/maneuver-cost.js";
export { MANEUVER_COST_POLICY, MANEUVER_COST_CONTENT } from "./content/core-playtest-v0.1/maneuver-cost.js";
export { type ManeuverCostPolicy } from "./definition/maneuver-cost-policy.js";
export { type EffectAffinityReduction } from "./definition/effect-payload.js";

// M5-WO12: Effect Chain execution and runtime resolution routing — composes with compileAbilityDefinition and WO2 cores.
export { EFFECT_EXECUTION_ERROR_CODES, compileAbilityExecution, executeAbilityResolution, type ProwessAbilityExecutionPlan, type AbilityExecutionResult, type ExecutionChainNode, type ExecutionGroup, type ExecutionEffect, type ExecutionInputRequest, type ExecutionInputKind, type ExecutionRequestKind, type ExecutionNodeStatus, type ExecutionTermination, type ExecutionResolution, type ResolvedOutcome, type SpellTargetTrace, type GroupTargetTrace, type CoreEvaluationRecord, type TriggerEvaluationRecord, type SaveFlow } from "./ability/effect-execution.js";
export { EFFECT_CHAIN_BEHAVIORS, EFFECT_CHAIN_FAILURE_POLICIES, readEffectChain, type EffectChainBehavior, type EffectChainNode, type EffectChainPayload } from "./definition/effect-chain-payload.js";
export { MARTIAL_SAVE_CONTROLS, type EffectExecutionPolicy, type MartialSaveControl } from "./definition/effect-execution-policy.js";
export { EFFECT_EXECUTION_POLICY, EFFECT_EXECUTION_CONTENT } from "./content/core-playtest-v0.1/effect-execution.js";
