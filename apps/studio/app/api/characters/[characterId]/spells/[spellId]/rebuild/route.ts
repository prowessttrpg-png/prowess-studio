import { rebuildCharacterSignatureSpell } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/spells/:spellId/rebuild — starts a rebuild of a finalized Spell (PAS-10 M6-WO7 §91):
 * the draft becomes a copy of the current revision, which stays current and usable.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string; spellId: string }> }): Promise<Response> {
  try {
    const { characterId, spellId } = await params;
    const body = await readStrictBody(request, ["expectedVersion"]);
    return apiSuccess(serializeForApi(await rebuildCharacterSignatureSpell(parseUuidParam(characterId, "characterId"), parseUuidParam(spellId, "spellId"), body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
