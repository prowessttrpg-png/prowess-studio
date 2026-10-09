import { listImportDecisionsForCandidate, reviewImportCandidate } from "@prowess/db";
import { IMPORT_DECISION_TYPES, IMPORT_MATCH_DECISION_BASES } from "@prowess/model";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { PAGINATION_QUERY, optString, optUuid, paginatedList, readStrictBody, reqEnum, reqString, strictQuery } from "../../../../../../src/api/m2/index";

/**
 * Import review decisions (WO6): the ONE explicit command that changes a Candidate's status, and the Candidate's history. Server-controlled fields (statuses, sequence, fingerprints, set hash) are not accepted.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** POST — record a decision: 201 when appended, 200 for an exact retry of the Candidate's last decision. */
export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }): Promise<Response> {
  try {
    const { candidateId: raw } = await params;
    const candidateId = parseUuidParam(raw, "candidateId");
    const body = await readStrictBody(request, ["candidateFingerprint", "decisionType", "matchBasis", "targetEntityId", "matchRunId", "matchAssessmentId", "duplicateGroupId", "comparisonEntityVersionId", "rationale"]);
    const result = await reviewImportCandidate({
      extractionCandidateId: candidateId,
      candidateFingerprint: reqString(body, "candidateFingerprint"),
      decisionType: reqEnum(body, "decisionType", IMPORT_DECISION_TYPES) as (typeof IMPORT_DECISION_TYPES)[number],
      matchBasis: body.matchBasis === undefined || body.matchBasis === null ? (body.matchBasis as null | undefined) : (reqEnum(body, "matchBasis", IMPORT_MATCH_DECISION_BASES) as (typeof IMPORT_MATCH_DECISION_BASES)[number]),
      targetEntityId: optUuid(body, "targetEntityId"),
      matchRunId: optUuid(body, "matchRunId"),
      matchAssessmentId: optUuid(body, "matchAssessmentId"),
      duplicateGroupId: optUuid(body, "duplicateGroupId"),
      comparisonEntityVersionId: optUuid(body, "comparisonEntityVersionId"),
      rationale: optString(body, "rationale"),
    });
    return apiSuccess(serializeForApi(result), result.created ? 201 : 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — paginated (Phase 1: the service's ordered result is paged in the adapter). */
export async function GET(request: Request, { params }: { params: Promise<{ candidateId: string }> }): Promise<Response> {
  try {
    const { candidateId: raw } = await params;
    const candidateId = parseUuidParam(raw, "candidateId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList(await listImportDecisionsForCandidate(candidateId), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
