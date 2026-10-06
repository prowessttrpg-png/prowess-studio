import { createCanonPolicy, listCanonPolicies } from "@prowess/db";
import { SOURCE_AUTHORITY_STATUSES } from "@prowess/model";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { PAGINATION_QUERY, objectArray, optString, paginatedList, readStrictBody, reqEnum, reqString, reqUuid, strictQuery } from "../../../../../src/api/m2/index";

/**
 * Canon policies (§19, §20).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — create an immutable policy snapshot with its authority records; policyVersion is allocated, never accepted. */
export async function POST(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const body = await readStrictBody(request, ["name", "description", "authorities"]);
    const policy = await createCanonPolicy(rulesetId, {
      name: reqString(body, "name"),
      description: optString(body, "description"),
      authorities: objectArray(body, "authorities", ["sourceDocumentId", "scopeKey", "authorityStatus", "rationale"], (a, at) => ({
        sourceDocumentId: reqUuid(a, "sourceDocumentId", at),
        scopeKey: reqString(a, "scopeKey", at),
        authorityStatus: reqEnum(a, "authorityStatus", SOURCE_AUTHORITY_STATUSES, at),
        rationale: optString(a, "rationale", at),
      })),
    });
    return apiSuccess(serializeForApi(policy), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — headers, policyVersion ASC (paginated). */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList(await listCanonPolicies(rulesetId), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
