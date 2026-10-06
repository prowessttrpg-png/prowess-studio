import { getRulesetRelease } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * One release (§40).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — immutable release metadata plus its exact published composition. */
export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string }> }): Promise<Response> {
  try {
    const { releaseId: releaseIdRaw } = await params;
    const releaseId = parseUuidParam(releaseIdRaw, "releaseId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getRulesetRelease(releaseId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
