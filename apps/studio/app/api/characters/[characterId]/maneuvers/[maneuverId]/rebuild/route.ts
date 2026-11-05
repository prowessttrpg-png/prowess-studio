import { rebuildCharacterSignatureManeuver } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/maneuvers/:maneuverId/rebuild — starts a rebuild of a finalized Maneuver (PAS-10 M6-WO8 §91):
 * the draft becomes a copy of the current revision, which stays current and usable.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string; maneuverId: string }> }): Promise<Response> {
  try {
    const { characterId, maneuverId } = await params;
    const body = await readStrictBody(request, ["expectedVersion"]);
    return apiSuccess(serializeForApi(await rebuildCharacterSignatureManeuver(parseUuidParam(characterId, "characterId"), parseUuidParam(maneuverId, "maneuverId"), body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
