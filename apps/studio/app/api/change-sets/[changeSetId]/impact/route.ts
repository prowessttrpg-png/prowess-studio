import { analyzeChangeSetImpact } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * Impact (§35).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — read-only, LIVE-derived impact report: repeated calls may differ when surrounding state changes. */
export async function GET(request: Request, { params }: { params: Promise<{ changeSetId: string }> }): Promise<Response> {
  try {
    const { changeSetId: changeSetIdRaw } = await params;
    const changeSetId = parseUuidParam(changeSetIdRaw, "changeSetId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await analyzeChangeSetImpact(changeSetId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
