import type { JsonObject } from "@prowess/model";
import type { EvaluationContextFamily, EvaluationOperation, EvaluationPlan } from "@prowess/rules";
import type { ProwessCompilationContractVersion } from "../contract-version.js";
import type { ProwessDefinitionBundle, ProwessRulesetProvenance } from "../bundle/bundle.js";
import type { AbilityComposition } from "../construction/composition.js";
import type { ProwessDefinitionRef } from "../definition/envelope.js";
import type { AbilityKind } from "../vocabulary/families.js";

/**
 * The Prowess → M4 compilation contract (PAS-10 M5-WO1 §93–109).
 *
 *   Exact Definitions + Composition (+ Actor / Build / Runtime)  →  @prowess/game compiler  →  M4 EvaluationPlan
 *
 * The compiler ASSEMBLES M4 operations; M4 EXECUTES them (§104, M5-I011–I012). It never computes a Formula result,
 * applies a Modifier, tests a Requirement, spends or reserves a Resource, produces a Validation outcome or generates
 * an Explanation (§107). It is pure: no database, SourceDocument, import system, Canon Manager, HTTP, filesystem or
 * latest / current lookup (§96).
 */

/** The explicitly discriminated thing being compiled (§94). Later WOs may add SUMMON, MAGE_ART … with their contracts. */
export type ProwessCompilationSubject =
  | { readonly kind: "SPELL"; readonly composition: AbilityComposition }
  | { readonly kind: "MANEUVER"; readonly composition: AbilityComposition };

export interface ProwessCompilationRequest {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: ProwessCompilationSubject;
  /** The exact Definitions — must be the bundle of exactly `ruleset`. */
  readonly definitions: ProwessDefinitionBundle;
  /** The exact M4 RulesetContext the plan will run under. */
  readonly ruleset: unknown;
  /** Optional M4 contexts; validated by M4's own constructors, never resolved or refreshed here. */
  readonly actor?: unknown;
  readonly build?: unknown;
  readonly runtime?: unknown;
}

/**
 * One compiled M4 step's domain origin (§99–101): the Composition component(s) and exact Definition version(s) that
 * caused it. This is Prowess → plan provenance; M4's own rule provenance and traces still describe evaluation.
 */
export interface ProwessSourceMapEntry {
  readonly stepKey: string;
  readonly order: number;
  readonly operation: EvaluationOperation;
  /** Why the step exists, as an exact label chosen by the component compiler (e.g. "listed-mp"). */
  readonly role: string;
  readonly componentKeys: readonly string[];
  readonly definitions: readonly ProwessDefinitionRef[];
}

export interface ProwessCompilationSourceMap {
  /** In execution order (order, then stepKey) — one entry per compiled step, no more, no less. */
  readonly entries: readonly ProwessSourceMapEntry[];
}

export interface ProwessCompiledPlan {
  readonly contractVersion: ProwessCompilationContractVersion;
  readonly subject: { readonly kind: AbilityKind; readonly compositionKey: string };
  readonly rulesetProvenance: ProwessRulesetProvenance;
  /** Executable output is an M4 EvaluationPlan — there is no second rules engine (§95). */
  readonly evaluationPlan: EvaluationPlan;
  readonly sourceMap: ProwessCompilationSourceMap;
}

/**
 * What a component compiler hands the assembler: an M4 operation with a plain-data input template, bindings and its
 * domain origin. `fragmentKey` is local to one compilation; the assembler derives the global, deterministic stepKey.
 */
export interface CompilationFragment {
  readonly fragmentKey: string;
  readonly order: number;
  readonly operation: EvaluationOperation;
  readonly input: JsonObject;
  readonly bindings: readonly CompilationFragmentBinding[];
  readonly role: string;
  readonly componentKeys: readonly string[];
  readonly definitions: readonly ProwessDefinitionRef[];
}

export interface CompilationFragmentBinding {
  readonly target: string;
  readonly source:
    | { readonly kind: "CONTEXT"; readonly context: EvaluationContextFamily; readonly pointer: string }
    | { readonly kind: "FRAGMENT"; readonly fragmentKey: string; readonly pointer: string };
}
