import { createRuleConflict, listRuleConflicts } from "@prowess/db";
import { RULE_CONFLICT_SEVERITIES, RULE_CONFLICT_STATUSES, RULE_CONFLICT_TYPES } from "@prowess/model";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { PAGINATION_QUERY, objectArray, optString, optUuid, paginatedList, queryEnum, queryUuid, readStrictBody, reqEnum, reqString, reqUuid, strictQuery } from "../../../../../src/api/m2/index";

/**
 * Rule conflicts (§25–§27).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — record a conflict. Always OPEN: `status` is not an accepted field. */
export async function POST(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const body = await readStrictBody(request, ["entityId", "conflictType", "severity", "title", "description", "candidates"]);
    const conflict = await createRuleConflict(rulesetId, {
      entityId: reqUuid(body, "entityId"),
      conflictType: reqEnum(body, "conflictType", RULE_CONFLICT_TYPES),
      severity: reqEnum(body, "severity", RULE_CONFLICT_SEVERITIES),
      title: reqString(body, "title"),
      description: optString(body, "description"),
      candidates: objectArray(body, "candidates", ["entityVersionId", "sourceReferenceId", "label", "positionSummary"], (c, at) => ({
        entityVersionId: reqUuid(c, "entityVersionId", at),
        sourceReferenceId: optUuid(c, "sourceReferenceId", at),
        label: optString(c, "label", at),
        positionSummary: optString(c, "positionSummary", at),
      })),
    });
    return apiSuccess(serializeForApi(conflict), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — headers (filters: entityId, status, severity, conflictType; paginated). No automatic detection. */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["entityId", "status", "severity", "conflictType", ...PAGINATION_QUERY]);
    const conflicts = await listRuleConflicts(rulesetId, {
      entityId: queryUuid(searchParams, "entityId"),
      status: queryEnum(searchParams, "status", RULE_CONFLICT_STATUSES),
      severity: queryEnum(searchParams, "severity", RULE_CONFLICT_SEVERITIES),
      conflictType: queryEnum(searchParams, "conflictType", RULE_CONFLICT_TYPES),
    });
    return paginatedList(conflicts, searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
