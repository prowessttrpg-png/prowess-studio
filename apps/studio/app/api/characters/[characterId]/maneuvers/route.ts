import { createCharacterSignatureManeuver } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/maneuvers — starts a Character-owned Signature Maneuver DRAFT with a name (PAS-10 M6-WO8
 * §12, §120). A draft uses no Signature slot; nothing is created in the Compendium.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["name"]);
    return apiSuccess(serializeForApi(await createCharacterSignatureManeuver(parseUuidParam(characterId, "characterId"), body)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
