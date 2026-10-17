/**
 * @prowess/game — the Prowess-specific pure domain layer (PAS-10 M5-WO1).
 *
 * M5-WO2 adds the first executable Prowess mechanics: core resolution (rolls, Advantage / Disadvantage, criticals),
 * the six Ability Scores, the Character Die progression, rank primitives and derived statistics — all compiled into
 * M4 FORMULA / REQUIREMENT / MODIFIER steps. See docs/architecture/m5-core-resolution-stats-dice-ranks.md.
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

export { BUNDLE_ERROR_CODES, COMPILATION_ERROR_CODES, COMPOSITION_ERROR_CODES, CORE_ERROR_CODES, DEFINITION_ERROR_CODES, MATERIALIZATION_ERROR_CODES } from "./definition/codes.js";
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
export { buildRollRuntimeContext, resolveRollMode, validateDieRollInput, type ProwessDieRollInput } from "./core/dice.js";
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
