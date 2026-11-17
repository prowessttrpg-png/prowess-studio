import { getRuleUsage } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-rules/releases/:releaseId/entities/:entityId/usage — PRE-M7-WO1 "where used": what this exact
 * rule reads and which rules read it (directly or indirectly) in one exact Release. `null` when the Entity is not a
 * rule node of that Release. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string; entityId: string }> }): Promise<Response> {
  try {
    strictQuery(new URL(request.url).searchParams, []);
    const { releaseId, entityId } = await params;
    return apiSuccess(serializeForApi(await getRuleUsage(parseUuidParam(releaseId, "releaseId"), parseUuidParam(entityId, "entityId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
