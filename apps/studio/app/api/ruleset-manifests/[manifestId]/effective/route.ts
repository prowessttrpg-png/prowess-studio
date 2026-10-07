import { getEffectiveManifestEntries } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * Effective composition (§17).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — derived effective composition with provenance (resolvedFromManifestId, resolutionDepth, EXPLICIT/INHERITED). Nothing persisted. */
export async function GET(request: Request, { params }: { params: Promise<{ manifestId: string }> }): Promise<Response> {
  try {
    const { manifestId: manifestIdRaw } = await params;
    const manifestId = parseUuidParam(manifestIdRaw, "manifestId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getEffectiveManifestEntries(manifestId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
