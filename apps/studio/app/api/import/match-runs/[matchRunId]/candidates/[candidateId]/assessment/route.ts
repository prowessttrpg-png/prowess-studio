import { getCandidateMatchAssessment } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../../src/api/m2/index";

/**
 * One Candidate's assessment in one exact MatchRun (WO4).
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

export async function GET(request: Request, { params }: { params: Promise<{ matchRunId: string; candidateId: string }> }): Promise<Response> {
  try {
    const { matchRunId: rawRun, candidateId: rawCandidate } = await params;
    const matchRunId = parseUuidParam(rawRun, "matchRunId");
    const candidateId = parseUuidParam(rawCandidate, "candidateId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCandidateMatchAssessment(matchRunId, candidateId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
