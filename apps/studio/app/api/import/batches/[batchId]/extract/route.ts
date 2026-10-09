import { extractImportBatch } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { requireNoBody } from "../../../../../../src/api/m2/index";

/**
 * Explicit extraction command (WO3). Extractor identity and scope are frozen in the Batch; none is accepted here.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** POST — run the Batch's exact registered extractor (CREATED -> READY_FOR_REVIEW, or the idempotent committed result). Body: empty or {} only. */
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  try {
    const { batchId: raw } = await params;
    const batchId = parseUuidParam(raw, "batchId");
    await requireNoBody(request);
    return apiSuccess(serializeForApi(await extractImportBatch(batchId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
