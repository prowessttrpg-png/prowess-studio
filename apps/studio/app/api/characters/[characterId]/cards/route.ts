import { getCharacterCardLibrary } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/cards — the Character Card Library (PAS-10 M6-WO9): Signature Spell and Maneuver cards
 * (current, draft, historical and retired revisions), the current loadout's Weapon and Attack cards, General Action cards
 * and the Mage Art domain status — each projected from the existing authorities for the Character's exact Release.
 * Read-only: nothing is persisted, priced by the client or executed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterCardLibrary(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
