import { getCharacterSignatureSpell } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/spells/:spellId — one Signature Spell (PAS-10 M6-WO7 §96, §133): its current revision
 * and working draft, each re-evaluated by the M5 Spell engine against the Character's exact Release, and its full
 * append-only revision history. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string; spellId: string }> }): Promise<Response> {
  try {
    const { characterId, spellId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterSignatureSpell(parseUuidParam(characterId, "characterId"), parseUuidParam(spellId, "spellId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
