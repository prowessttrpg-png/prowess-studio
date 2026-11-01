import { getReferenceAttackLibrary } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-reference/rulesets/:rulesetId/releases/:releaseId/attacks — the EXACT Release's Weapon & Attack
 * Library (PAS-10 M6-WO6 §89–§91, §94): pinned revisions only, checked by the Prowess domain package; never a latest revision.
 */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string; releaseId: string }> }): Promise<Response> {
  try {
    const { rulesetId, releaseId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getReferenceAttackLibrary(parseUuidParam(rulesetId, "rulesetId"), parseUuidParam(releaseId, "releaseId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
