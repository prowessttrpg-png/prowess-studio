import { orchestrateRulesEvaluation, type EvaluationRun } from "@prowess/rules";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { buildCoreResolutionContexts, compileCoreResolution, type ProwessCoreCompiledPlan } from "../core/compile.js";
import type { ProwessOutcome } from "../internal/problems.js";
import { coreBundle } from "./core-fixtures.js";

/**
 * Test-only runner: compile with @prowess/game, evaluate with the frozen M4 orchestrator, and read results back by the
 * plan's named outputs. Every number a test asserts was produced by M4.
 */
export const codes = (o: ProwessOutcome<unknown>) => (o.ok ? [] : o.problems.map((p) => p.code));

export interface CoreRunResult {
  readonly plan: ProwessCoreCompiledPlan;
  readonly run: EvaluationRun;
  readonly value: (stepKey: string | null) => unknown;
  readonly natural: number | null;
  readonly total: number | null;
  readonly success: boolean | null;
  readonly criticalThreat: boolean | null;
  readonly criticalHit: boolean | null;
  readonly automaticTotal: number | null;
  readonly automaticSuccess: boolean | null;
  readonly masterySignal: { advantage: readonly string[]; disadvantage: readonly string[] } | null;
  readonly derived: (statistic: string) => number;
}

export function compileWith(subject: Record<string, unknown>, character: unknown, fixture = coreBundle()) {
  return compileCoreResolution({ contractVersion: 1, subject, definitions: fixture.bundle, ruleset: fixture.ruleset, character });
}

export function runCore(
  subject: Record<string, unknown>,
  character: unknown,
  runtime: { roll?: unknown; difficultyClass?: number; targetDodge?: number } = {},
  fixture: { ruleset: unknown; bundle: ProwessDefinitionBundle } = coreBundle(),
): CoreRunResult {
  const plan = compileCoreResolution({ contractVersion: 1, subject, definitions: fixture.bundle, ruleset: fixture.ruleset, character });
  if (!plan.ok) throw new Error(`compile failed: ${JSON.stringify(plan.problems)}`);
  const contexts = buildCoreResolutionContexts({ definitions: fixture.bundle, character, plan: plan.value, ...runtime });
  if (!contexts.ok) throw new Error(`contexts failed: ${JSON.stringify(contexts.problems)}`);
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo2.test", contexts: { ruleset: fixture.ruleset, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(`M4 run failed: ${JSON.stringify(response.errors)}`);
  const run = response.data;
  const value = (stepKey: string | null): unknown => {
    if (stepKey === null) return null;
    const step = run.steps.find((s) => s.stepKey === stepKey);
    if (step === undefined || step.executionStatus !== "EXECUTED") throw new Error(`step ${stepKey} did not execute: ${JSON.stringify(step)}`);
    const data = step.response?.data as Record<string, unknown> | null;
    if (data === null || data === undefined) throw new Error(`step ${stepKey} has no data: ${JSON.stringify(step.response?.errors)}`);
    if ("finalValue" in data) return data.finalValue;
    if ("satisfied" in data) return data.satisfied;
    return data;
  };
  const o = plan.value.outputs;
  const signal = o.statMasterySignal === null ? null : ((value(o.statMasterySignal) as { finalTargets: { advantage: string[]; disadvantage: string[] }[] }).finalTargets[0] ?? null);
  return {
    plan: plan.value,
    run,
    value,
    natural: value(o.natural) as number | null,
    total: value(o.total) as number | null,
    success: value(o.success) as boolean | null,
    criticalThreat: value(o.criticalThreat) as boolean | null,
    criticalHit: value(o.criticalHit) as boolean | null,
    automaticTotal: value(o.automaticTotal) as number | null,
    automaticSuccess: value(o.automaticSuccess) as boolean | null,
    masterySignal: signal === null ? null : { advantage: signal.advantage, disadvantage: signal.disadvantage },
    derived: (statistic: string) => value((o.derived as Record<string, string>)[statistic] ?? null) as number,
  };
}

export const roll = (dieKey: string, faces: number, mode: string, ...rolls: number[]) => ({ die: { dieKey, faces }, mode, rolls });
