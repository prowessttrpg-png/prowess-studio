import { changeKeywordPresentation } from "@prowess/db";
import { ApiError, apiSuccess, parseJsonBody, parseUuidParam, requireObjectBody, serializeForApi, toErrorResponse } from "../../../../../src/api/index";

/**
 * PATCH /api/keywords/:keywordId/presentation — RULES-WO1 (R09) safe Keyword editing. Body:
 * { expected: { name, description, deprecated }, name, description, deprecated }. Changes ONLY how the Keyword reads;
 * its canonical key (its meaning to every Definition, Affinity, assignment and content pack) and its category are never
 * changed. A Keyword changed since the editor loaded it is refused (409, KEYWORD.STALE_EDIT) and nothing is written.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ keywordId: string }> }): Promise<Response> {
  try {
    const { keywordId } = await params;
    const id = parseUuidParam(keywordId, "keywordId");
    const body = requireObjectBody(await parseJsonBody(request));
    const unknown = Object.keys(body).filter((k) => !["expected", "name", "description", "deprecated"].includes(k));
    if (unknown.length > 0) throw new ApiError("API.INVALID_BODY", `Unknown field(s): ${unknown.join(", ")} (only the name, description and deprecated flag can be edited)`, 400);
    return apiSuccess(serializeForApi(await changeKeywordPresentation(id, body as never)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
