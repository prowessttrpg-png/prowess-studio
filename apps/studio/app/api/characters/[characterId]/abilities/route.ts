import { getCharacterAbilities } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/abilities — the Character's Signature Abilities (PAS-10 M6-WO7 §20, §93): Signature
 * Spells (drafts, active, retired) each re-evaluated by the M5 Spell engine against the Character's exact Release, and
 * the shared Signature capacity. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterAbilities(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
