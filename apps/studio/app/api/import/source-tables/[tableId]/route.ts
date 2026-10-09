import { getSourceTable } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * One Source Table (WO1).
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

export async function GET(request: Request, { params }: { params: Promise<{ tableId: string }> }): Promise<Response> {
  try {
    const { tableId: raw } = await params;
    const tableId = parseUuidParam(raw, "tableId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getSourceTable(tableId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
