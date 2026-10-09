import { getImportReviewSummary } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { queryUuid, strictQuery } from "../../../../../../src/api/m2/index";

/**
 * Derived review summary (WO6). potentialConflictCount only for an explicitly named matchRunId.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  try {
    const { batchId: raw } = await params;
    const batchId = parseUuidParam(raw, "batchId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["matchRunId"]);
    const matchRunId = queryUuid(searchParams, "matchRunId");
    return apiSuccess(serializeForApi(await getImportReviewSummary(batchId, matchRunId === undefined ? {} : { matchRunId })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
