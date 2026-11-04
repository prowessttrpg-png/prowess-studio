import { getSignatureManeuverBuilder } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/maneuvers/:maneuverId/builder — the ONE Signature Maneuver Builder read (PAS-10 M6-WO8 §82,
 * §122): the Maneuver and its live M5 evaluation plus every component catalog of the Character's exact Release, with
 * eligibility and alignment hints. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string; maneuverId: string }> }): Promise<Response> {
  try {
    const { characterId, maneuverId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getSignatureManeuverBuilder(parseUuidParam(characterId, "characterId"), parseUuidParam(maneuverId, "maneuverId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
