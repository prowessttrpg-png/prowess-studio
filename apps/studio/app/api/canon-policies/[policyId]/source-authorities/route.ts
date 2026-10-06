import { getCanonPolicy } from "@prowess/db";
import { apiSuccess, parseUuidParam, toErrorResponse } from "../../../../../src/api/index";
import { PAGINATION_QUERY, paginatedList, strictQuery } from "../../../../../src/api/m2/index";

/**
 * Exact authority records (§23).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — the policy's exact persisted records, in the service's deterministic order (paginated). */
export async function GET(request: Request, { params }: { params: Promise<{ policyId: string }> }): Promise<Response> {
  try {
    const { policyId: policyIdRaw } = await params;
    const policyId = parseUuidParam(policyIdRaw, "policyId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList((await getCanonPolicy(policyId)).authorities, searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
