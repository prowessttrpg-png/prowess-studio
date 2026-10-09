import { listExtractionCandidates } from "@prowess/db";
import { parseUuidParam, toErrorResponse } from "../../../../../../src/api/index";
import { PAGINATION_QUERY, paginatedList, strictQuery } from "../../../../../../src/api/m2/index";

/**
 * A Batch's Candidates (WO2), ordinal order, paginated. No Candidate is created or updated over HTTP.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** GET — paginated (Phase 1: the service's ordered result is paged in the adapter). */
export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  try {
    const { batchId: raw } = await params;
    const batchId = parseUuidParam(raw, "batchId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList(await listExtractionCandidates(batchId), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
