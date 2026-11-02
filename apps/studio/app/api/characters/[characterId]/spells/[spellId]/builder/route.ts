import { getSignatureSpellBuilder } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/spells/:spellId/builder — the ONE Signature Spell Builder read (PAS-10 M6-WO7 §82,
 * §122): the Spell and its live M5 evaluation plus every component catalog of the Character's exact Release, with
 * eligibility and alignment hints. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string; spellId: string }> }): Promise<Response> {
  try {
    const { characterId, spellId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getSignatureSpellBuilder(parseUuidParam(characterId, "characterId"), parseUuidParam(spellId, "spellId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
