import { listEncounterCandidates } from "@prowess/db";
import { ApiError, apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/encounters/:encounterId/characters?q= — Characters matching a name, each with the SERVER's decision whether
 * it may join this encounter (ELIGIBLE, ALREADY_MEMBER, NOT_COMPLETE, OTHER_RELEASE) and why (M7-WO1). Read-only; the
 * add command re-validates everything regardless of what this list showed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ encounterId: string }> }): Promise<Response> {
  try {
    const { encounterId } = await params;
    const searchParams = new URL(request.url).searchParams;
    strictQuery(searchParams, ["q"]);
    if (searchParams.getAll("q").length > 1) throw new ApiError("API.INVALID_QUERY", "q is accepted once", 400, "q");
    return apiSuccess(serializeForApi(await listEncounterCandidates(parseUuidParam(encounterId, "encounterId"), { search: searchParams.get("q") })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
