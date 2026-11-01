import { getCharacterSheet } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/sheet — the whole Digital Character Sheet in ONE read (PAS-10 M6-WO5 §79): identity,
 * portrait framing, the mechanical sheet from the CharacterMechanicalProfile, current resources, notes and the
 * equipment / granted-effects boundaries. Read-only (it never creates play state).
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterSheet(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
