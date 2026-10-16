/**
 * The Prowess COMPILATION contract version (PAS-10 M5-WO1 §97–98).
 *
 * Versions the meaning of `ProwessCompilationRequest` → `ProwessCompiledPlan`: how an exact Composition and exact
 * Definitions are assembled into an M4 EvaluationPlan. It is NOT a Definition payload `schemaVersion`, NOT an
 * EntityVersion, NOT a Ruleset / Release version and NOT `RULES_ENGINE_CONTRACT_VERSION` (M4's own contract).
 *
 * A request names the version it expects; a compiler only accepts versions it implements. Changing compilation
 * semantics later requires a new version — historical content is never silently re-interpreted (§98, §129).
 */
export const PROWESS_COMPILATION_CONTRACT_VERSION = 1 as const;
export type ProwessCompilationContractVersion = typeof PROWESS_COMPILATION_CONTRACT_VERSION;
export const SUPPORTED_PROWESS_COMPILATION_CONTRACT_VERSIONS: readonly number[] = Object.freeze([PROWESS_COMPILATION_CONTRACT_VERSION]);
