import { getEntityById } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";

/**
 * GET /api/entities/:entityId — stable Entity identity only (PAS-10
 * M1-WO8 §9). Related Versions/aliases/Keywords/relationships/Sources
 * each have their own dedicated endpoint rather than one large combined
 * payload.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const entity = await getEntityById(id);
    return apiSuccess(serializeForApi(entity));
  } catch (error) {
    return toErrorResponse(error);
  }
}
