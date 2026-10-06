import { createCanonDecision, listCanonDecisionsForConflict } from "@prowess/db";
import { CANON_CONFLICT_DISPOSITIONS, CANON_DECISION_TYPES } from "@prowess/model";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { PAGINATION_QUERY, optUuid, paginatedList, readStrictBody, reqEnum, reqString, reqUuid, strictQuery, uuidArray } from "../../../../../src/api/m2/index";

/**
 * Canon decisions on a conflict (§29, §30).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — the ONLY way a conflict leaves OPEN/UNDER_REVIEW (atomically, inside the service). The Ruleset is derived from the conflict. */
export async function POST(request: Request, { params }: { params: Promise<{ conflictId: string }> }): Promise<Response> {
  try {
    const { conflictId: conflictIdRaw } = await params;
    const conflictId = parseUuidParam(conflictIdRaw, "conflictId");
    const body = await readStrictBody(request, ["canonPolicyId", "decisionType", "conflictDisposition", "selectedCandidateIds", "resultEntityVersionId", "rationale"]);
    const decision = await createCanonDecision(conflictId, {
      canonPolicyId: reqUuid(body, "canonPolicyId"),
      decisionType: reqEnum(body, "decisionType", CANON_DECISION_TYPES),
      conflictDisposition: reqEnum(body, "conflictDisposition", CANON_CONFLICT_DISPOSITIONS),
      selectedCandidateIds: uuidArray(body, "selectedCandidateIds"),
      resultEntityVersionId: optUuid(body, "resultEntityVersionId"),
      rationale: reqString(body, "rationale"),
    });
    return apiSuccess(serializeForApi(decision), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — the conflict's decisions (paginated). */
export async function GET(request: Request, { params }: { params: Promise<{ conflictId: string }> }): Promise<Response> {
  try {
    const { conflictId: conflictIdRaw } = await params;
    const conflictId = parseUuidParam(conflictIdRaw, "conflictId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList(await listCanonDecisionsForConflict(conflictId), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
