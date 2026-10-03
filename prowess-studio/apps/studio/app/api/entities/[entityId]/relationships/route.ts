import { getIncomingRelationships, getOutgoingRelationships } from "@prowess/db";
import {
  apiSuccess,
  parseUuidParam,
  serializeForApi,
  toErrorResponse,
} from "../../../../../src/api/index";

/**
 * GET /api/entities/:entityId/relationships — outgoing and incoming
 * returned as distinct collections (PAS-10 M1-WO8 §19–20). Never merged:
 * a relationship where this Entity is the source is never presented as
 * though it were also incoming, and vice versa. Each item pairs the
 * relationship with its counterpart Entity's stable identity — never an
 * invented display name from a presumed current Version.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<Response> {
  try {
    const { entityId } = await params;
    const id = parseUuidParam(entityId, "entityId");
    const [outgoing, incoming] = await Promise.all([
      getOutgoingRelationships(id),
      getIncomingRelationships(id),
    ]);
    return apiSuccess({
      outgoing: serializeForApi(outgoing),
      incoming: serializeForApi(incoming),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
