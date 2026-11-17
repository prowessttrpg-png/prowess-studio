import { getStatImpacts } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-rules/releases/:releaseId/stats/:stat — PRE-M7-WO1 "What this Stat affects": the Stat's exact
 * Definition and every rule in this exact Release that reads it, directly or through derived statistics, with the
 * owning revision, the authored expression and any open Draft of that owner. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string; stat: string }> }): Promise<Response> {
  try {
    strictQuery(new URL(request.url).searchParams, []);
    const { releaseId, stat } = await params;
    return apiSuccess(serializeForApi(await getStatImpacts(parseUuidParam(releaseId, "releaseId"), stat)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
