import type { EvaluationRun, RuleEngineResponse } from "@prowess/rules";
import type { RulesEvaluationRequest, RulesetSelector } from "../rules-evaluation/service";
import { apiPost } from "./http";

/** WO10 transport types only. No server module or engine function runs in the browser. */
export type { RulesEvaluationRequest, RulesetSelector };
export type RulesEvaluationResponse = RuleEngineResponse<EvaluationRun>;

/** One endpoint; exact response data, including INVALID child results, is preserved. */
export const runRulesEvaluation = (request: RulesEvaluationRequest): Promise<RulesEvaluationResponse> =>
  apiPost<RulesEvaluationResponse>("/api/rules/evaluate", request);
