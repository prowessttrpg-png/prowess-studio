import { getImportMatchRun } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * One MatchRun with its derived summary (WO4).
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

export async function GET(request: Request, { params }: { params: Promise<{ matchRunId: string }> }): Promise<Response> {
  try {
    const { matchRunId: raw } = await params;
    const matchRunId = parseUuidParam(raw, "matchRunId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getImportMatchRun(matchRunId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
