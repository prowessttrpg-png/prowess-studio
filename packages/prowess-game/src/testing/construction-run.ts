import { orchestrateRulesEvaluation, type EvaluationRun } from "@prowess/rules";
import { compileAbilityConstruction, readAbilityConstructionRun, type AbilityConstructionResult, type ProwessConstructionCompiledPlan } from "../construction/legality.js";
import { constructionFixture, requestOf, type CharacterSpec, type ConstructionFixture, type RequestSpec } from "./construction-fixtures.js";

/**
 * Test-only runner for M5-WO5 construction plans: compile with @prowess/game, evaluate with the frozen M4 orchestrator,
 * read the run back. Every number and every comparison a test asserts was produced by M4.
 */
export interface ConstructionRunResult {
  readonly plan: ProwessConstructionCompiledPlan;
  readonly run: EvaluationRun;
  readonly result: AbilityConstructionResult;
}

export function runConstruction(composition: Record<string, unknown>, character: CharacterSpec = {}, spec: RequestSpec = {}, f: ConstructionFixture = constructionFixture()): ConstructionRunResult {
  const plan = compileAbilityConstruction(requestOf(f, composition, character, spec));
  if (!plan.ok) throw new Error(`compile failed: ${JSON.stringify(plan.problems, null, 2)}`);
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo5.test", contexts: { ruleset: f.ruleset }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(`M4 run failed: ${JSON.stringify(response.errors)}`);
  const run = response.data;
  const failed = run.steps.filter((s) => s.response === null || !s.response.success);
  if (failed.length > 0) throw new Error(`steps failed: ${JSON.stringify(failed.map((s) => [s.stepKey, s.executionStatus, s.response?.errors, s.blockedBy]), null, 2)}`);
  const result = readAbilityConstructionRun({ plan: plan.value, run });
  if (!result.ok) throw new Error(`reading failed: ${JSON.stringify(result.problems)}`);
  return { plan: plan.value, run, result: result.value };
}

/** The failing rule keys of a construction, in plan order (empty when VALID). */
export const failing = (r: ConstructionRunResult) => r.result.problems;
