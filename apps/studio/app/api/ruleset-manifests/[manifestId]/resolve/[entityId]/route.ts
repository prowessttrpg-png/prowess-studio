import { resolveEffectiveEntityVersion } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * Resolve one Entity (§18).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — `{ resolution }`; `resolution: null` (200) when the manifest exists but nothing in its chain pins the Entity. */
export async function GET(request: Request, { params }: { params: Promise<{ manifestId: string; entityId: string }> }): Promise<Response> {
  try {
    const { manifestId: manifestIdRaw, entityId: entityIdRaw } = await params;
    const manifestId = parseUuidParam(manifestIdRaw, "manifestId");
    const entityId = parseUuidParam(entityIdRaw, "entityId");
    strictQuery(new URL(request.url).searchParams, []);
    const resolution = await resolveEffectiveEntityVersion(manifestId, entityId);
    return apiSuccess({ resolution: serializeForApi(resolution) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
