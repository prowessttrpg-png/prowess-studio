import { getRulesetManifest } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * Exact manifest (§15).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — the exact historical manifest and its OWN explicit entries (never flattened). */
export async function GET(request: Request, { params }: { params: Promise<{ manifestId: string }> }): Promise<Response> {
  try {
    const { manifestId: manifestIdRaw } = await params;
    const manifestId = parseUuidParam(manifestIdRaw, "manifestId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getRulesetManifest(manifestId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
