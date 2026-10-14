import { apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { readStrictBody } from "../../../../src/api/m2/index";
import { evaluateRules, readRulesEvaluationRequest, RULES_EVALUATION_BODY_FIELDS } from "../../../../src/rules-evaluation/service";

/**
 * POST /api/rules/evaluate — the Rules Engine's one evaluation endpoint (PAS-10 M4-WO10 §72–90).
 * Thin HTTP adapter: strict body reading, one application-service call, serialization, central error mapping.
 * Stateless and read-only: nothing is persisted, committed or applied to any Character. Rule outcomes — an INVALID
 * child, satisfied:false, canPay:false, a PARTIAL run, an INVALID plan — are HTTP 200 RuleEngineResponses; only a
 * malformed request (400) or an addressed Manifest / Release that is missing (404) or fails integrity (409) is not.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readStrictBody(request, RULES_EVALUATION_BODY_FIELDS);
    return apiSuccess(serializeForApi(await evaluateRules(readRulesEvaluationRequest(body))), 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}
