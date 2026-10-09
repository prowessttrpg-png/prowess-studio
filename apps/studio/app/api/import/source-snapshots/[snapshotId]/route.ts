import { getSourceSnapshot } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * One Source Snapshot (WO1).
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

export async function GET(request: Request, { params }: { params: Promise<{ snapshotId: string }> }): Promise<Response> {
  try {
    const { snapshotId: raw } = await params;
    const snapshotId = parseUuidParam(raw, "snapshotId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getSourceSnapshot(snapshotId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
