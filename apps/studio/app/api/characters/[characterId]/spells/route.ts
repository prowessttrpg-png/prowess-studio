import { createCharacterSignatureSpell } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/spells — starts a Character-owned Signature Spell DRAFT with a name (PAS-10 M6-WO7
 * §12, §120). A draft uses no Signature slot; nothing is created in the Compendium.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["name"]);
    return apiSuccess(serializeForApi(await createCharacterSignatureSpell(parseUuidParam(characterId, "characterId"), body)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
