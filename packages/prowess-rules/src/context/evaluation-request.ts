import type { JsonObject } from "@prowess/model";
import { RULES_ENGINE_CONTRACT_VERSION, type RulesEngineContractVersion } from "../contract-version.js";
import { InputProblems, readContextKey, readRecord } from "../internal/input-reader.js";
import { clonePlainData, inspectPlainData, isPlainObject, type PathSegment } from "../internal/plain-data.js";
import {
  readActorContext,
  readBuildContext,
  readRuntimeContext,
  type ActorContext,
  type BuildContext,
  type RuntimeContext,
} from "./evaluation-contexts.js";
import { readRulesetContext, type RulesetContext } from "./ruleset-context.js";
import { finishOutcome, type ContextOutcome } from "./shared.js";

/** The four approved context families (PAS-10 M4-WO1 §8). */
export const CONTEXT_FAMILIES = ["RULESET", "ACTOR", "BUILD", "RUNTIME"] as const;
export type ContextFamily = (typeof CONTEXT_FAMILIES)[number];

/**
 * A generic evaluation request (PAS-10 M4-WO1 §15).
 *
 *  - `kind`      generic context key naming the evaluation (e.g. `example.noop`); later Work Orders register their own
 *                kinds. No subsystem-specific union exists yet.
 *  - contexts    each family is either a normalized context or `null` (absent). Absence is always explicit `null` in a
 *                normalized request, never `undefined`; on input, an omitted family and `null` both mean absent (§56, §81)
 *  - `metadata`  caller-supplied DETERMINISTIC data (plain JSON). It is part of the evaluation input, so it must never
 *                hold a wall-clock time, a random id or anything else that varies between identical evaluations (§29)
 */
export interface EvaluationRequest {
  readonly contractVersion: RulesEngineContractVersion;
  readonly kind: string;
  readonly ruleset: RulesetContext | null;
  readonly actor: ActorContext | null;
  readonly build: BuildContext | null;
  readonly runtime: RuntimeContext | null;
  readonly metadata: JsonObject;
}

const REQUEST_FIELDS = ["contractVersion", "kind", "ruleset", "actor", "build", "runtime", "metadata"];

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

/** Internal: read a whole request (used by `createEvaluationRequest` and by `evaluate`). */
export function readEvaluationRequest(value: unknown, at: readonly PathSegment[], p: InputProblems): EvaluationRequest | null {
  const r = readRecord(value, at, p, REQUEST_FIELDS, ["kind"]);
  if (r === null) return null;
  if (r.contractVersion !== undefined && r.contractVersion !== RULES_ENGINE_CONTRACT_VERSION) {
    p.invalid([...at, "contractVersion"], `unsupported contract version (this engine implements ${RULES_ENGINE_CONTRACT_VERSION})`);
  }
  const kind = r.kind === undefined ? null : readContextKey(r.kind, [...at, "kind"], p);
  const ruleset = absent(r.ruleset) ? null : readRulesetContext(r.ruleset, [...at, "ruleset"], p);
  const actor = absent(r.actor) ? null : readActorContext(r.actor, [...at, "actor"], p);
  const build = absent(r.build) ? null : readBuildContext(r.build, [...at, "build"], p);
  const runtime = absent(r.runtime) ? null : readRuntimeContext(r.runtime, [...at, "runtime"], p);

  let metadata: JsonObject = {};
  if (r.metadata !== undefined) {
    if (!isPlainObject(r.metadata)) p.invalid([...at, "metadata"], "expected a plain JSON object");
    else {
      const problems = inspectPlainData(r.metadata, [...at, "metadata"]);
      for (const problem of problems) p.plainData(problem);
      if (problems.length === 0) metadata = clonePlainData(r.metadata) as JsonObject;
    }
  }
  if (kind === null) return null;
  return { contractVersion: RULES_ENGINE_CONTRACT_VERSION, kind, ruleset, actor, build, runtime, metadata };
}

/** Validates and normalizes a caller-supplied evaluation request, including every context it carries. */
export function createEvaluationRequest(input: unknown): ContextOutcome<EvaluationRequest> {
  const p = new InputProblems();
  const value = readEvaluationRequest(input, [], p);
  return finishOutcome(p, () => value as EvaluationRequest);
}

/** The context families a request actually supplies, in the canonical family order. */
export function suppliedContextFamilies(request: EvaluationRequest): ContextFamily[] {
  const present: Record<ContextFamily, boolean> = {
    RULESET: request.ruleset !== null,
    ACTOR: request.actor !== null,
    BUILD: request.build !== null,
    RUNTIME: request.runtime !== null,
  };
  return CONTEXT_FAMILIES.filter((family) => present[family]);
}
