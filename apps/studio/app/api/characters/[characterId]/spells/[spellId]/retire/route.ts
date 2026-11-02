import { retireCharacterSignatureSpell } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/spells/:spellId/retire — retires the Spell (PAS-10 M6-WO7 §90): its Signature slot is
 * released; every revision stays.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string; spellId: string }> }): Promise<Response> {
  try {
    const { characterId, spellId } = await params;
    const body = await readStrictBody(request, ["expectedVersion"]);
    return apiSuccess(serializeForApi(await retireCharacterSignatureSpell(parseUuidParam(characterId, "characterId"), parseUuidParam(spellId, "spellId"), body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
