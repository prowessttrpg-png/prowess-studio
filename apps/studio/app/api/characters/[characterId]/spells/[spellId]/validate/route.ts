import { validateCharacterSignatureSpell } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/spells/:spellId/validate — evaluates the working draft with the M5 Spell engine
 * (PAS-10 M6-WO7 §13, §69). Writes nothing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string; spellId: string }> }): Promise<Response> {
  try {
    const { characterId, spellId } = await params;
    const body = await readStrictBody(request, ["expectedVersion"]);
    return apiSuccess(serializeForApi(await validateCharacterSignatureSpell(parseUuidParam(characterId, "characterId"), parseUuidParam(spellId, "spellId"), body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
