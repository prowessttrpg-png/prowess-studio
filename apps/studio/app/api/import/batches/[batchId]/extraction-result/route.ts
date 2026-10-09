import { getExtractionResult } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * The committed extraction of a Batch (WO3). Read-only.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  try {
    const { batchId: raw } = await params;
    const batchId = parseUuidParam(raw, "batchId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getExtractionResult(batchId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
