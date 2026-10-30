import { compareReferenceReleases } from "@prowess/db";
import { apiSuccess, parsePaginationParams, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-reference/rulesets/:rulesetId/releases/:releaseId/compare/:otherReleaseId — Release Comparison
 * (PAS-10 M6-WO2): the M2 composition diff (ADDED_ENTITY / REMOVED_ENTITY / CHANGED_VERSION + unchanged count), one
 * page of entries with display identity, optionally one entry type. Both Releases must belong to the Ruleset. No
 * semantic diff. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string; releaseId: string; otherReleaseId: string }> }): Promise<Response> {
  try {
    const { rulesetId, releaseId, otherReleaseId } = await params;
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["page", "pageSize", "type"]);
    const { page, pageSize } = parsePaginationParams(searchParams);
    const result = await compareReferenceReleases(parseUuidParam(rulesetId, "rulesetId"), parseUuidParam(releaseId, "releaseId"), parseUuidParam(otherReleaseId, "otherReleaseId"), {
      page,
      pageSize,
      type: searchParams.get("type") ?? undefined,
    });
    return apiSuccess(serializeForApi(result));
  } catch (error) {
    return toErrorResponse(error);
  }
}
