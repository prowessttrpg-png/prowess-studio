import { getReferenceRelease } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-reference/rulesets/:rulesetId/releases/:releaseId — one Release's metadata (number, label,
 * channel, date, notes, composition size, manifest hash) and the server-side M2 manifest verification. The Release must
 * belong to the Ruleset in the URL. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string; releaseId: string }> }): Promise<Response> {
  try {
    const { rulesetId, releaseId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getReferenceRelease(parseUuidParam(rulesetId, "rulesetId"), parseUuidParam(releaseId, "releaseId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
