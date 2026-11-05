import { finalizeCharacterSignatureManeuver } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/maneuvers/:maneuverId/finalize — appends the working draft as the next revision, atomically
 * against the Signature roster (PAS-10 M6-WO8 §13, §88–§89): refused (422 / 409) unless M5 reports it valid with a
 * slot available; the current revision then stays current.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string; maneuverId: string }> }): Promise<Response> {
  try {
    const { characterId, maneuverId } = await params;
    const body = await readStrictBody(request, ["expectedVersion"]);
    return apiSuccess(serializeForApi(await finalizeCharacterSignatureManeuver(parseUuidParam(characterId, "characterId"), parseUuidParam(maneuverId, "maneuverId"), body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
