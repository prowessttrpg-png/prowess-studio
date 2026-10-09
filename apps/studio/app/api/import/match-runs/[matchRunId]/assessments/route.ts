import { listCandidateMatchAssessments } from "@prowess/db";
import { parseUuidParam, toErrorResponse } from "../../../../../../src/api/index";
import { PAGINATION_QUERY, paginatedList, strictQuery } from "../../../../../../src/api/m2/index";

/**
 * A MatchRun's assessments in Candidate ordinal order (WO4), paginated.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** GET — paginated (Phase 1: the service's ordered result is paged in the adapter). */
export async function GET(request: Request, { params }: { params: Promise<{ matchRunId: string }> }): Promise<Response> {
  try {
    const { matchRunId: raw } = await params;
    const matchRunId = parseUuidParam(raw, "matchRunId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList(await listCandidateMatchAssessments(matchRunId), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
