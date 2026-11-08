import { orchestrateRulesEvaluation } from "@prowess/rules";
import type { ProwessDefinitionBundle } from "../bundle/bundle.js";
import { PROWESS_COMPILATION_CONTRACT_VERSION } from "../contract-version.js";
import { deepFreeze } from "../internal/plain-data.js";
import type { ProwessProblem } from "../internal/problems.js";
import { buildRuntimeContexts, compileRuntime, type ProwessRuntimeCompiledPlan } from "../runtime/compile.js";
import type { ProwessRuntimeResources } from "../runtime/resources.js";
import { confirmActionPayment, readRuntimeRun, type ActionPaymentConfirmation, type RuntimeRunReading } from "../runtime/results.js";
import type { CharacterMechanicalProfile } from "../character/advancement.js";

/**
 * PAS-10 M6-WO10 — the Play Workspace's ONLY route to Resource changes: the M5-WO3 runtime compiler, executed by the frozen
 * M4 orchestrator, read back by WO3 (`readRuntimeRun` / `confirmActionPayment`). Nothing here computes a game value: it
 * builds the WO3 request, runs the plan and copies the results. A plan that fails to compile or run is reported with the
 * engine's own problems — never repaired.
 */
export interface PlayEngineContext {
  readonly bundle: ProwessDefinitionBundle;
  readonly ruleset: unknown;
  /** The Character's WO2 CharacterCore (built from the ONE mechanical profile). */
  readonly character: unknown;
  readonly combat: { readonly round: number; readonly surprised: boolean } | null;
}

export interface PlayRun {
  readonly plan: ProwessRuntimeCompiledPlan;
  readonly reading: RuntimeRunReading;
  readonly before: ProwessRuntimeResources;
  /** The M4 EvaluationRun exactly as the orchestrator returned it. */
  readonly raw: unknown;
  readonly evaluation: { readonly subjectKey: string; readonly plan: unknown; readonly contexts: { readonly actor: unknown; readonly runtime: unknown } };
}

export type PlayRunOutcome = { readonly ok: true; readonly run: PlayRun } | { readonly ok: false; readonly problems: readonly ProwessProblem[] };

/** The WO2 CharacterCore of the profile — the same mapping the Character Sheet uses for its M4 resolutions (M6-WO5). */
export function characterCoreOf(profile: CharacterMechanicalProfile) {
  return deepFreeze({
    level: profile.level,
    characterDie: { dieKey: profile.characterDie.dieKey },
    stats: profile.constructionContext.stats,
    baseHp: profile.baseHp,
    baseMp: profile.baseMp,
    skillRanks: profile.constructionContext.skillRanks,
    explicitBonuses: profile.equipment?.explicitBonuses ?? [],
  });
}

/** Compiles one WO3 subject over `resources`, runs it on M4 and reads it back. */
export function runPlan(ctx: PlayEngineContext, subject: Record<string, unknown>, resources: ProwessRuntimeResources): PlayRunOutcome {
  const combat = ctx.combat === null ? {} : { combat: ctx.combat };
  const plan = compileRuntime({ contractVersion: PROWESS_COMPILATION_CONTRACT_VERSION, subject, definitions: ctx.bundle, ruleset: ctx.ruleset, character: ctx.character, resources, ...combat });
  if (!plan.ok) return { ok: false, problems: plan.problems };
  const contexts = buildRuntimeContexts({ definitions: ctx.bundle, character: ctx.character, resources, ...combat });
  if (!contexts.ok) return { ok: false, problems: contexts.problems };
  const response = orchestrateRulesEvaluation({ evaluationKey: `m6-wo10.${String(subject.subjectKey)}`, contexts: { ruleset: ctx.ruleset as never, actor: contexts.value.actor, runtime: contexts.value.runtime }, plan: plan.value.evaluationPlan });
  if (!response.success || response.data === null) return { ok: false, problems: (response.errors ?? []).map((e) => ({ code: String(e.code), path: "/run", message: String(e.message) })) };
  const reading = readRuntimeRun({ plan: plan.value, run: response.data, resources: contexts.value.resources });
  if (!reading.ok) return { ok: false, problems: reading.problems };
  return { ok: true, run: { plan: plan.value, reading: reading.value, before: contexts.value.resources, raw: response.data, evaluation: { subjectKey: String(subject.subjectKey), plan: plan.value.evaluationPlan, contexts: { actor: contexts.value.actor, runtime: contexts.value.runtime } } } };
}

/** Phase 1 of an action (ACTION_PAYMENT) + WO3's explicit confirmation. Only PAID carries a new state (M5-I110). */
export function payAction(ctx: PlayEngineContext, subject: Record<string, unknown>, resources: ProwessRuntimeResources): { readonly ok: true; readonly run: PlayRun; readonly confirmation: ActionPaymentConfirmation } | { readonly ok: false; readonly problems: readonly ProwessProblem[] } {
  const out = runPlan(ctx, { kind: "ACTION_PAYMENT", ...subject }, resources);
  if (!out.ok) return out;
  const confirmation = confirmActionPayment({ plan: out.run.plan, run: out.run.raw, resources: out.run.before });
  if (!confirmation.ok) return { ok: false, problems: confirmation.problems };
  return { ok: true, run: out.run, confirmation: confirmation.value };
}
