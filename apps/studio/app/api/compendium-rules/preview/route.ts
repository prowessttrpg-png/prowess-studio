import { previewRuleCandidate } from "@prowess/db";
import { ApiError, apiSuccess, parseJsonBody, requireObjectBody, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/**
 * POST /api/compendium-rules/preview — PRE-M7-WO1 side-effect-free rule preview. Body:
 *   { releaseId, drafts: [EntityVersion id …], examples: [{ label, level, stats: { STR … }, baseHp, baseMp } …] }
 * Evaluates every derived statistic for each example in the published Release and in a CANDIDATE that substitutes the
 * named Draft revisions for their Entities' pins — the same compiler and M4 orchestration the Character profile uses.
 * POST only because the request carries a body; nothing is written, created or published.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const unknown = Object.keys(body).filter((k) => !["releaseId", "drafts", "examples"].includes(k));
    if (unknown.length > 0) throw new ApiError("API.INVALID_BODY", `Unknown field(s): ${unknown.join(", ")}`, 400);
    return apiSuccess(serializeForApi(await previewRuleCandidate({ releaseId: body.releaseId, drafts: body.drafts ?? [], examples: body.examples })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
