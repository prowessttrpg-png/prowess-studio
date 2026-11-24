import { previewAuthoredRules } from "@prowess/db";
import { ApiError, apiSuccess, parseJsonBody, requireObjectBody, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/**
 * POST /api/compendium-rules/authored-preview — RULES-WO1 side-effect-free preview of authored rules (calculated values,
 * Skill benefits, the Concentration rule). Body: { releaseId, drafts: [EntityVersion id …], sample: { level, stats,
 * skillRanks, effects } }. Evaluates the published Release and an in-memory candidate in which the named Drafts replace
 * their pins or are added as new rules. POST only because the request carries a body; nothing is written or published.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const unknown = Object.keys(body).filter((k) => !["releaseId", "drafts", "sample"].includes(k));
    if (unknown.length > 0) throw new ApiError("API.INVALID_BODY", `Unknown field(s): ${unknown.join(", ")}`, 400);
    return apiSuccess(serializeForApi(await previewAuthoredRules({ releaseId: body.releaseId, drafts: body.drafts ?? [], sample: body.sample })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
