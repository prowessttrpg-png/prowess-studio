import { updateCharacterSignatureSpellDraft } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../../src/api/m2/index";

/**
 * PUT /api/characters/:characterId/spells/:spellId/draft — saves the working composition (PAS-10 M6-WO7 §12, §87): selections
 * and prose only, at any completeness; a stale version → 409. Cost, capacity and Signature availability are never
 * submitted — the server re-evaluates.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ characterId: string; spellId: string }> }): Promise<Response> {
  try {
    const { characterId, spellId } = await params;
    const body = await readStrictBody(request, ["expectedVersion", "draft"]);
    return apiSuccess(serializeForApi(await updateCharacterSignatureSpellDraft(parseUuidParam(characterId, "characterId"), parseUuidParam(spellId, "spellId"), body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
