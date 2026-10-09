import { completeImportReview } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { requireNoBody } from "../../../../../../src/api/m2/index";

/**
 * Explicit review-completion command (WO6). Not a status setter: COMPLETED only when every Candidate is APPROVED or REJECTED.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** POST — REVIEWING -> COMPLETED (review finished; nothing is published or materialized). Body: empty or {} only. */
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  try {
    const { batchId: raw } = await params;
    const batchId = parseUuidParam(raw, "batchId");
    await requireNoBody(request);
    return apiSuccess(serializeForApi(await completeImportReview(batchId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
