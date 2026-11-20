import { previewReferenceDefinition } from "@prowess/db";
import { ApiError, apiSuccess, parseJsonBody, requireObjectBody, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/**
 * POST /api/compendium-rules/reference-preview — RULES-WO1 Phase C preview of a SAVED Armor, Summon engine or Mission rule
 * for sample inputs. Body: { entityVersionId, sample }. Reads one exact revision; nothing is written or published.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireObjectBody(await parseJsonBody(request));
    const unknown = Object.keys(body).filter((k) => !["entityVersionId", "sample"].includes(k));
    if (unknown.length > 0) throw new ApiError("API.INVALID_BODY", `Unknown field(s): ${unknown.join(", ")}`, 400);
    return apiSuccess(serializeForApi(await previewReferenceDefinition({ entityVersionId: body.entityVersionId, sample: body.sample ?? {} })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
