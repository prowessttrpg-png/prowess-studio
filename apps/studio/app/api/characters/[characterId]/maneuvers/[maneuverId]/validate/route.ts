import { validateCharacterSignatureManeuver } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/maneuvers/:maneuverId/validate — evaluates the working draft with the M5 Maneuver engine
 * (PAS-10 M6-WO8 §13, §69). Writes nothing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string; maneuverId: string }> }): Promise<Response> {
  try {
    const { characterId, maneuverId } = await params;
    const body = await readStrictBody(request, ["expectedVersion"]);
    return apiSuccess(serializeForApi(await validateCharacterSignatureManeuver(parseUuidParam(characterId, "characterId"), parseUuidParam(maneuverId, "maneuverId"), body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
