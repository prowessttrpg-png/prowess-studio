import { resolveSourceAuthority } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { queryString, queryUuid, strictQuery } from "../../../../../../src/api/m2/index";

/**
 * Authority resolution (§24).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET ?sourceDocumentId&scopeKey — EXACT / GLOBAL_FALLBACK / UNRESOLVED (all 200). Read-only. */
export async function GET(request: Request, { params }: { params: Promise<{ policyId: string }> }): Promise<Response> {
  try {
    const { policyId: policyIdRaw } = await params;
    const policyId = parseUuidParam(policyIdRaw, "policyId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["sourceDocumentId", "scopeKey"]);
    const resolution = await resolveSourceAuthority(policyId, queryUuid(searchParams, "sourceDocumentId", true) as string, queryString(searchParams, "scopeKey"));
    return apiSuccess(serializeForApi(resolution));
  } catch (error) {
    return toErrorResponse(error);
  }
}
