import { getCharacterWeapons } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/weapons — the Character's Weapon loadout and every Weapon its exact Release offers
 * (PAS-10 M6-WO6 §68–§77, §144), with requirement checks and the Weapon / Attack Library capability. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterWeapons(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
