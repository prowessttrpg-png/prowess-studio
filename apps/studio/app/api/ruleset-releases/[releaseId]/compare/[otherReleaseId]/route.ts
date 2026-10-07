import { compareRulesetReleases } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * Release diff (§44).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — composition-level diff (ADDED_ENTITY / REMOVED_ENTITY / CHANGED_VERSION + unchangedCount). Read-only. */
export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string; otherReleaseId: string }> }): Promise<Response> {
  try {
    const { releaseId: releaseIdRaw, otherReleaseId: otherReleaseIdRaw } = await params;
    const releaseId = parseUuidParam(releaseIdRaw, "releaseId");
    const otherReleaseId = parseUuidParam(otherReleaseIdRaw, "otherReleaseId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await compareRulesetReleases(releaseId, otherReleaseId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
