import { analyzeImportConflicts } from "@prowess/db";
import { parseUuidParam, toErrorResponse } from "../../../../../../src/api/index";
import { PAGINATION_QUERY, paginatedList, queryUuid, strictQuery } from "../../../../../../src/api/m2/index";

/**
 * Derived, read-only conflict signals (WO6) over one EXPLICIT MatchRun (required matchRunId — never a latest run).
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** GET — one signal per duplicate group; paginated. Never changes a status, never creates a RuleConflict. */
export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  try {
    const { batchId: raw } = await params;
    const batchId = parseUuidParam(raw, "batchId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["matchRunId", ...PAGINATION_QUERY]);
    return paginatedList(await analyzeImportConflicts(batchId, queryUuid(searchParams, "matchRunId", true) as string), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
