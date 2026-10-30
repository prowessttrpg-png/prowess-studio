import { listReferenceReleases } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-reference/rulesets/:rulesetId/releases — Rules Reference Release History (PAS-10 M6-WO2): the
 * Ruleset and its Releases (number, version label, channel, published date), release_number ascending. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await listReferenceReleases(parseUuidParam(rulesetId, "rulesetId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
