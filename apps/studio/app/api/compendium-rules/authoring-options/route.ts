import { listAuthoringOptions } from "@prowess/db";
import { ApiError, apiSuccess, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/**
 * GET /api/compendium-rules/authoring-options?list=skillRanks|calculatedValues — RULES-WO1 readable choices for fields
 * that name other content by its token (a Skill rank, a calculated value). Read-only.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const unknown = [...params.keys()].filter((k) => k !== "list");
    if (unknown.length > 0) throw new ApiError("API.INVALID_QUERY", `Unknown parameter(s): ${unknown.join(", ")}`, 400);
    return apiSuccess(serializeForApi(await listAuthoringOptions(params.get("list"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
