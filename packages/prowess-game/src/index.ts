/**
 * @prowess/game — the Prowess-specific pure domain layer (PAS-10 M5-WO1).
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

export { BUNDLE_ERROR_CODES, COMPILATION_ERROR_CODES, COMPOSITION_ERROR_CODES, DEFINITION_ERROR_CODES, MATERIALIZATION_ERROR_CODES } from "./definition/codes.js";
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
