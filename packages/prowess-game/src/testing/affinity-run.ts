import { orchestrateRulesEvaluation, type EvaluationRun } from "@prowess/rules";
import { compileAffinity, type ProwessAffinityCompiledPlan } from "../affinity/compile.js";
import { readAffinityRun, type AffinityRunReading } from "../affinity/results.js";
import { affinityFixture, keywordCatalog, profileOf, type AffinityFixture, type ProfileEntry } from "./affinity-fixtures.js";

/**
 * Test-only runner for M5-WO4 Affinity plans: compile with @prowess/game, evaluate with the frozen M4 orchestrator, read
 * results back by the plan's named outputs. Every number a test asserts was produced by M4.
 */
export interface AffinityRunResult {
  readonly plan: ProwessAffinityCompiledPlan;
  readonly run: EvaluationRun;
  readonly reading: AffinityRunReading;
}

export interface AffinityInputs {
  readonly profile: readonly ProfileEntry[] | { affinities: Record<string, unknown>[] };
  readonly keywords?: unknown;
}

export function compileAffinityWith(subject: Record<string, unknown>, inputs: AffinityInputs, f: AffinityFixture = affinityFixture()) {
  const profile = Array.isArray(inputs.profile) ? profileOf(f, inputs.profile) : inputs.profile;
  return compileAffinity({ contractVersion: 1, subject, definitions: f.bundle, ruleset: f.ruleset, profile, keywords: inputs.keywords ?? keywordCatalog() });
}

export function evaluateAffinity(plan: ProwessAffinityCompiledPlan, f: AffinityFixture = affinityFixture()): EvaluationRun {
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo4.test", contexts: { ruleset: f.ruleset }, plan: plan.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(`M4 run failed: ${JSON.stringify(response.errors)}`);
  return response.data;
}

export function runAffinity(subject: Record<string, unknown>, inputs: AffinityInputs, f: AffinityFixture = affinityFixture()): AffinityRunResult {
  const plan = compileAffinityWith(subject, inputs, f);
  if (!plan.ok) throw new Error(`compile failed: ${JSON.stringify(plan.problems, null, 2)}`);
  const run = evaluateAffinity(plan.value, f);
  const failed = run.steps.filter((s) => s.response === null || !s.response.success);
  if (failed.length > 0) throw new Error(`steps failed: ${JSON.stringify(failed.map((s) => [s.stepKey, s.executionStatus, s.response?.errors, s.blockedBy]), null, 2)}`);
  const reading = readAffinityRun({ plan: plan.value, run });
  if (!reading.ok) throw new Error(`reading failed: ${JSON.stringify(reading.problems)}`);
  return { plan: plan.value, run, reading: reading.value };
}
