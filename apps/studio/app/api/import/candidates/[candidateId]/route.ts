import { getExtractionCandidate } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * One Extraction Candidate with its supporting anchors (WO2).
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

export async function GET(request: Request, { params }: { params: Promise<{ candidateId: string }> }): Promise<Response> {
  try {
    const { candidateId: raw } = await params;
    const candidateId = parseUuidParam(raw, "candidateId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getExtractionCandidate(candidateId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
