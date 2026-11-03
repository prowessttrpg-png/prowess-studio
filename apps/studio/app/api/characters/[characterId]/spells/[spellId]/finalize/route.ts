import { finalizeCharacterSignatureSpell } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/spells/:spellId/finalize — appends the working draft as the next revision, atomically
 * against the Signature roster (PAS-10 M6-WO7 §13, §88–§89): refused (422 / 409) unless M5 reports it valid with a
 * slot available; the current revision then stays current.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string; spellId: string }> }): Promise<Response> {
  try {
    const { characterId, spellId } = await params;
    const body = await readStrictBody(request, ["expectedVersion"]);
    return apiSuccess(serializeForApi(await finalizeCharacterSignatureSpell(parseUuidParam(characterId, "characterId"), parseUuidParam(spellId, "spellId"), body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
