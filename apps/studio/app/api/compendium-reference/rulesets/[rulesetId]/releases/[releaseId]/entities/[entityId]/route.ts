import { getReferenceEntry } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-reference/rulesets/:rulesetId/releases/:releaseId/entities/:entityId — one Entity AS THIS RELEASE
 * PINS IT (PAS-10 M6-WO2): the exact pinned revision, its stored Definition verbatim, exact references next to this
 * Release's pins, bounded related content and provenance. An Entity the Release does not pin is 404 — never a fallback.
 */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string; releaseId: string; entityId: string }> }): Promise<Response> {
  try {
    const { rulesetId, releaseId, entityId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getReferenceEntry(parseUuidParam(rulesetId, "rulesetId"), parseUuidParam(releaseId, "releaseId"), parseUuidParam(entityId, "entityId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
