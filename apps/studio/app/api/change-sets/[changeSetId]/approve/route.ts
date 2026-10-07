import { approveChangeSet } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { requireNoBody } from "../../../../../src/api/m2/index";

/**
 * Named lifecycle command (§36).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — READY_FOR_REVIEW -> APPROVED (publishes nothing). No PATCH / generic status mutation exists. */
export async function POST(request: Request, { params }: { params: Promise<{ changeSetId: string }> }): Promise<Response> {
  try {
    const { changeSetId: changeSetIdRaw } = await params;
    const changeSetId = parseUuidParam(changeSetIdRaw, "changeSetId");
    await requireNoBody(request);
    return apiSuccess(serializeForApi(await approveChangeSet(changeSetId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
