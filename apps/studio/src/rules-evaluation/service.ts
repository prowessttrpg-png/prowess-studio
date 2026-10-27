import { resolveRulesetContextFromManifest, resolveRulesetContextFromRelease } from "@prowess/db";
import { orchestrateRulesEvaluation, type EvaluationRun, type RuleEngineResponse } from "@prowess/rules";
import { ApiError } from "../api/index";
import { reqString, reqUuid, strictObject } from "../api/m2/index";

/** The same 400 API.INVALID_BODY every strict-body route raises. */
const bodyError = (message: string, field?: string) => new ApiError("API.INVALID_BODY", message, 400, field);

/**
 * The Studio rules-evaluation application service (PAS-10 M4-WO10 §5, §8–10, §74–82).
 *
 * Its whole job:
 *  1. read the strict request shape (transport-level; anything malformed is a 400);
 *  2. resolve ONE exact RulesetContext from exactly one exact selector — a Manifest id or a Release id — through the
 *     approved M4-WO2 resolver (a Release's stored hash is verified FIRST; a tampered Release is refused before any
 *     orchestration). There is no "current", "latest", active or default Ruleset, and a network caller can never supply
 *     a resolved context, a manifest hash, a release number or a version label;
 *  3. hand that exact context, the caller's Actor / Build / Runtime contexts and plan to the PURE orchestrator.
 *
 * No game mechanics, no binding, no ordering, no database write, no persisted evaluation history. A well-shaped
 * request whose plan or rules are invalid still returns the orchestrator's RuleEngineResponse (HTTP 200).
 */
export type RulesetSelector = { readonly kind: "MANIFEST"; readonly manifestId: string } | { readonly kind: "RELEASE"; readonly releaseId: string };

export interface RulesEvaluationRequest {
  readonly ruleset: RulesetSelector;
  readonly evaluationKey: string;
  readonly actor: Record<string, unknown> | null;
  readonly build: Record<string, unknown> | null;
  readonly runtime: Record<string, unknown> | null;
  readonly plan: Record<string, unknown>;
}

/** The accepted top-level body fields. Anything else (latest, persist, commit, resolvedRuleset, status …) is a 400. */
export const RULES_EVALUATION_BODY_FIELDS = ["ruleset", "evaluationKey", "actor", "build", "runtime", "plan"] as const;

const jsonObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Exactly one exact selector: { kind: MANIFEST, manifestId } or { kind: RELEASE, releaseId } — nothing else. */
function readRulesetSelector(value: unknown): RulesetSelector {
  if (!jsonObject(value)) throw bodyError("ruleset must be { kind: MANIFEST, manifestId } or { kind: RELEASE, releaseId }", "ruleset");
  if (value.kind === "MANIFEST") return { kind: "MANIFEST", manifestId: reqUuid(strictObject(value, ["kind", "manifestId"], "ruleset"), "manifestId", "ruleset.") };
  if (value.kind === "RELEASE") return { kind: "RELEASE", releaseId: reqUuid(strictObject(value, ["kind", "releaseId"], "ruleset"), "releaseId", "ruleset.") };
  throw bodyError("ruleset.kind must be MANIFEST or RELEASE with that exact id (a ruleset id alone is not accepted)", "ruleset");
}

/** Transport-level shape only. Semantic validity of contexts and plan is the Rules Engine's job (HTTP 200). */
export function readRulesEvaluationRequest(body: Record<string, unknown>): RulesEvaluationRequest {
  const context = (key: "actor" | "build" | "runtime"): Record<string, unknown> | null => {
    const v = body[key];
    if (v === undefined || v === null) return null;
    if (!jsonObject(v)) throw bodyError(`${key} must be a JSON object or null`, key);
    return v;
  };
  if (!jsonObject(body.plan)) throw bodyError("plan must be a JSON object", "plan");
  return {
    ruleset: readRulesetSelector(body.ruleset),
    evaluationKey: reqString(body, "evaluationKey"),
    actor: context("actor"),
    build: context("build"),
    runtime: context("runtime"),
    plan: body.plan,
  };
}

/** Resolves the one exact RulesetContext, then runs the pure orchestrator. Read-only against persistence. */
export async function evaluateRules(request: RulesEvaluationRequest): Promise<RuleEngineResponse<EvaluationRun>> {
  const ruleset =
    request.ruleset.kind === "MANIFEST" ? await resolveRulesetContextFromManifest(request.ruleset.manifestId) : await resolveRulesetContextFromRelease(request.ruleset.releaseId);
  return orchestrateRulesEvaluation({
    evaluationKey: request.evaluationKey,
    contexts: { ruleset, actor: request.actor, build: request.build, runtime: request.runtime },
    plan: request.plan,
  });
}
