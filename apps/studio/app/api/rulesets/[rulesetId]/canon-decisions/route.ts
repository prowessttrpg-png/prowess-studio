import { listCanonDecisions } from "@prowess/db";
import { CANON_CONFLICT_DISPOSITIONS, CANON_DECISION_TYPES } from "@prowess/model";
import { apiSuccess, parseUuidParam, toErrorResponse } from "../../../../../src/api/index";
import { PAGINATION_QUERY, paginatedList, queryEnum, queryUuid, strictQuery } from "../../../../../src/api/m2/index";

/**
 * A Ruleset's decisions (§31).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — headers (filters: ruleConflictId, canonPolicyId, decisionType, conflictDisposition; paginated). */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["ruleConflictId", "canonPolicyId", "decisionType", "conflictDisposition", ...PAGINATION_QUERY]);
    const decisions = await listCanonDecisions(rulesetId, {
      ruleConflictId: queryUuid(searchParams, "ruleConflictId"),
      canonPolicyId: queryUuid(searchParams, "canonPolicyId"),
      decisionType: queryEnum(searchParams, "decisionType", CANON_DECISION_TYPES),
      conflictDisposition: queryEnum(searchParams, "conflictDisposition", CANON_CONFLICT_DISPOSITIONS),
    });
    return paginatedList(decisions, searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
