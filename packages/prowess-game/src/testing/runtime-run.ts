import { orchestrateRulesEvaluation, type EvaluationRun } from "@prowess/rules";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { buildRuntimeContexts, compileRuntime, type ProwessRuntimeCompiledPlan } from "../runtime/compile.js";
import type { ProwessRuntimeResources } from "../runtime/resources.js";
import { confirmActionPayment, readRuntimeRun, type ActionPaymentConfirmation, type RuntimeRunReading } from "../runtime/results.js";
import { coreBundle } from "./core-fixtures.js";

/**
 * Test-only runner for M5-WO3 runtime plans: compile with @prowess/game, evaluate with the frozen M4 orchestrator, read
 * results back by the plan's named outputs. Every number a test asserts was produced by M4.
 */
export interface RuntimeRunResult {
  readonly plan: ProwessRuntimeCompiledPlan;
  readonly run: EvaluationRun;
  readonly reading: RuntimeRunReading;
  readonly before: ProwessRuntimeResources;
  /** Final current value of a Resource after the plan (from M4's resulting snapshot). */
  readonly current: (resourceKey: string) => number | undefined;
  readonly reserved: (resourceKey: string) => number | undefined;
  readonly value: (stepKey: string) => unknown;
}

export interface RuntimeInputs {
  readonly character: unknown;
  readonly resources: unknown;
  readonly combat?: unknown;
}

export type Fixture = { readonly ruleset: unknown; readonly bundle: ProwessDefinitionBundle };

export const compileRuntimeWith = (subject: Record<string, unknown>, inputs: RuntimeInputs, fixture: Fixture = coreBundle()) =>
  compileRuntime({ contractVersion: 1, subject, definitions: fixture.bundle, ruleset: fixture.ruleset, character: inputs.character, resources: inputs.resources, ...(inputs.combat === undefined ? {} : { combat: inputs.combat }) });

export function evaluateRuntime(plan: ProwessRuntimeCompiledPlan, inputs: RuntimeInputs, fixture: Fixture = coreBundle()): { run: EvaluationRun; before: ProwessRuntimeResources } {
  const contexts = buildRuntimeContexts({ definitions: fixture.bundle, character: inputs.character, resources: inputs.resources, ...(inputs.combat === undefined ? {} : { combat: inputs.combat }) });
  if (!contexts.ok) throw new Error(`contexts failed: ${JSON.stringify(contexts.problems)}`);
  const response = orchestrateRulesEvaluation({ evaluationKey: "m5-wo3.test", contexts: { ruleset: fixture.ruleset, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: plan.evaluationPlan });
  if (!response.success || response.data === null) throw new Error(`M4 run failed: ${JSON.stringify(response.errors)}`);
  return { run: response.data, before: contexts.value.resources };
}

export function runRuntime(subject: Record<string, unknown>, inputs: RuntimeInputs, fixture: Fixture = coreBundle()): RuntimeRunResult {
  const plan = compileRuntimeWith(subject, inputs, fixture);
  if (!plan.ok) throw new Error(`compile failed: ${JSON.stringify(plan.problems)}`);
  const { run, before } = evaluateRuntime(plan.value, inputs, fixture);
  const reading = readRuntimeRun({ plan: plan.value, run, resources: before });
  if (!reading.ok) throw new Error(`reading failed: ${JSON.stringify(reading.problems)} ${JSON.stringify(run.steps.map((s) => [s.stepKey, s.executionStatus, s.response?.errors]))}`);
  const find = (key: string) => reading.value.resources.resources.find((s) => s.resourceKey === key);
  return {
    plan: plan.value,
    run,
    reading: reading.value,
    before,
    current: (key) => find(key)?.current,
    reserved: (key) => find(key)?.reservedCapacity,
    value: (stepKey) => {
      const step = run.steps.find((s) => s.stepKey === stepKey);
      const data = step?.response?.data as Record<string, unknown> | null | undefined;
      if (data === null || data === undefined) throw new Error(`step ${stepKey} has no data`);
      return "finalValue" in data ? data.finalValue : "satisfied" in data ? data.satisfied : data;
    },
  };
}

/** Phase 1 (payment) + confirmation of an action, the explicit two-phase workflow (§76). */
export function payForAction(subject: Record<string, unknown>, inputs: RuntimeInputs, fixture: Fixture = coreBundle()): { result: RuntimeRunResult; confirmation: ActionPaymentConfirmation } {
  const result = runRuntime({ kind: "ACTION_PAYMENT", subjectKey: "act", ...subject }, inputs, fixture);
  const confirmation = confirmActionPayment({ plan: result.plan, run: result.run, resources: result.before });
  if (!confirmation.ok) throw new Error(`confirmation failed: ${JSON.stringify(confirmation.problems)}`);
  return { result, confirmation: confirmation.value };
}

/** A neutral character for runtime tests: Level 1 (d4); Stats chosen per test. Test data only. */
export const runtimeCharacter = (stats: Partial<Record<"STR" | "AGI" | "CON" | "PER" | "RES" | "PRO", number>> = {}, extra: Record<string, unknown> = {}) => ({
  level: 1,
  characterDie: { dieKey: "D4" },
  stats: { STR: 3, AGI: 3, CON: 3, PER: 3, RES: 3, PRO: 3, ...stats },
  baseHp: 10,
  baseMp: 10,
  skillRanks: [],
  explicitBonuses: [],
  ...extra,
});

export const resources = (...entries: [string, number, number?][]) => ({
  resources: entries.map(([resourceKey, current, reservedCapacity]) => ({ resourceKey, current, ...(reservedCapacity === undefined ? {} : { reservedCapacity }) })),
});
