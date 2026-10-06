import { createChangeSet, listChangeSets } from "@prowess/db";
import { CHANGE_SET_OPERATION_TYPES, CHANGE_SET_STATUSES } from "@prowess/model";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { PAGINATION_QUERY, objectArray, optString, optUuid, paginatedList, queryEnum, queryUuid, readStrictBody, reqEnum, reqString, strictQuery } from "../../../../../src/api/m2/index";

/**
 * ChangeSets (§32, §33).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — create a proposal. Always DRAFT: `status` is not an accepted field. */
export async function POST(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const body = await readStrictBody(request, ["canonDecisionId", "name", "description", "operations"]);
    const changeSet = await createChangeSet(rulesetId, {
      canonDecisionId: optUuid(body, "canonDecisionId"),
      name: reqString(body, "name"),
      description: optString(body, "description"),
      operations: objectArray(body, "operations", ["operationType", "targetEntityId", "fromEntityVersionId", "toEntityVersionId", "targetManifestId", "description"], (o, at) => ({
        operationType: reqEnum(o, "operationType", CHANGE_SET_OPERATION_TYPES, at),
        targetEntityId: optUuid(o, "targetEntityId", at),
        fromEntityVersionId: optUuid(o, "fromEntityVersionId", at),
        toEntityVersionId: optUuid(o, "toEntityVersionId", at),
        targetManifestId: optUuid(o, "targetManifestId", at),
        description: optString(o, "description", at),
      })),
    });
    return apiSuccess(serializeForApi(changeSet), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — headers (filters: canonDecisionId, status; paginated). */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["canonDecisionId", "status", ...PAGINATION_QUERY]);
    const changeSets = await listChangeSets(rulesetId, {
      canonDecisionId: queryUuid(searchParams, "canonDecisionId"),
      status: queryEnum(searchParams, "status", CHANGE_SET_STATUSES),
    });
    return paginatedList(changeSets, searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
