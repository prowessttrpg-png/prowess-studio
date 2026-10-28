import { createAuthoredRevision } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { optString, readStrictBody, reqUuid } from "../../../../../../src/api/m2/index";

/**
 * POST /api/compendium-authoring/entities/:entityId/revisions — Create New Revision (PAS-10 M6-WO1 §18): a new DRAFT of
 * the same Entity whose content is copied from the named base revision. The revision number is allocated by the
 * server; no revision number, status or content is accepted from the caller. The base revision is never changed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ entityId: string }> }): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const body = await readStrictBody(request, ["baseVersionId", "changeType", "changeSummary"]);
    const version = await createAuthoredRevision(id, {
      baseVersionId: reqUuid(body, "baseVersionId"),
      changeType: optString(body, "changeType"),
      changeSummary: optString(body, "changeSummary"),
    });
    return apiSuccess(serializeForApi(version), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
