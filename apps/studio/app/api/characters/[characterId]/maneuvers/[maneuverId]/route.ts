import { getCharacterSignatureManeuver } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/maneuvers/:maneuverId — one Signature Maneuver (PAS-10 M6-WO8 §96, §133): its current revision
 * and working draft, each re-evaluated by the M5 Maneuver engine against the Character's exact Release, and its full
 * append-only revision history. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string; maneuverId: string }> }): Promise<Response> {
  try {
    const { characterId, maneuverId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterSignatureManeuver(parseUuidParam(characterId, "characterId"), parseUuidParam(maneuverId, "maneuverId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
