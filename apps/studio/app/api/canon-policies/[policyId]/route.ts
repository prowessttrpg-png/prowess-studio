import { getCanonPolicy } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * Exact policy (§21).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — the exact policy snapshot and its source-authority records. */
export async function GET(request: Request, { params }: { params: Promise<{ policyId: string }> }): Promise<Response> {
  try {
    const { policyId: policyIdRaw } = await params;
    const policyId = parseUuidParam(policyIdRaw, "policyId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCanonPolicy(policyId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
