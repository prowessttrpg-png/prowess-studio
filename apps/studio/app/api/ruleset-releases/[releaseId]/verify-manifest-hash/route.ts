import { verifyRulesetReleaseManifestHash } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * Hash verification (§43).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — `{ valid, storedHash, computedHash }`; 200 even when valid=false (the RESULT of verifying). Read-only. */
export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string }> }): Promise<Response> {
  try {
    const { releaseId: releaseIdRaw } = await params;
    const releaseId = parseUuidParam(releaseIdRaw, "releaseId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await verifyRulesetReleaseManifestHash(releaseId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
