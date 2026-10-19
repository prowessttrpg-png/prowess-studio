import { orchestrateRulesEvaluation, type EvaluationRun } from "@prowess/rules";
import {
  compileAbilityConstruction,
  readAbilityConstructionRun,
  type AbilityConstructionRunReading,
  type ProwessAbilityConstructionCompiledPlan,
} from "../construction/legality.js";
import {
  constructionFixture,
  constructionKeywordCatalog,
  type ConstructionFixture,
} from "./ability-construction-fixtures.js";

export interface ConstructionRunResult {
  readonly plan: ProwessAbilityConstructionCompiledPlan;
  readonly run: EvaluationRun;
  readonly reading: AbilityConstructionRunReading;
}

export function compileConstructionWith(
  subject: Record<string, unknown>,
  f: ConstructionFixture = constructionFixture(),
  keywords: unknown = constructionKeywordCatalog(),
) {
  return compileAbilityConstruction({ contractVersion: 1, subject, definitions: f.bundle, ruleset: f.ruleset, keywords });
}

export function evaluateConstruction(plan: ProwessAbilityConstructionCompiledPlan, f: ConstructionFixture = constructionFixture()): EvaluationRun {
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo5.test", contexts: { ruleset: f.ruleset }, plan: plan.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(`M4 run failed: ${JSON.stringify(response.errors)}`);
  return response.data;
}

export function runConstruction(subject: Record<string, unknown>, f: ConstructionFixture = constructionFixture()): ConstructionRunResult {
  const compiled = compileConstructionWith(subject, f);
  if (!compiled.ok) throw new Error(`compile failed: ${JSON.stringify(compiled.problems, null, 2)}`);
  const run = evaluateConstruction(compiled.value, f);
  const failed = run.steps.filter((s) => s.response === null || !s.response.success);
  if (failed.length > 0) throw new Error(`steps failed: ${JSON.stringify(failed.map((s) => [s.stepKey, s.executionStatus, s.response?.errors, s.blockedBy]), null, 2)}`);
  const reading = readAbilityConstructionRun(compiled.value, run);
  if (!reading.ok) throw new Error(`reading failed: ${JSON.stringify(reading.problems)}`);
  return { plan: compiled.value, run, reading: reading.value };
}
