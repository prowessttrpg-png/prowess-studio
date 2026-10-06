import { getRuleConflict } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * One conflict (§28).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — the conflict and its ordered candidates. No winner is computed or inferred. */
export async function GET(request: Request, { params }: { params: Promise<{ conflictId: string }> }): Promise<Response> {
  try {
    const { conflictId: conflictIdRaw } = await params;
    const conflictId = parseUuidParam(conflictIdRaw, "conflictId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getRuleConflict(conflictId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
