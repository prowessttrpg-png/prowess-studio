import { updateCharacterWeaponLoadout } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * PUT /api/characters/:characterId/weapon-loadout — the Weapon loadout CHOICE (PAS-10 M6-WO6 §69–§76, §145): exact
 * Weapon pairs and the Versatile grip only. The server derives Power, damage, Attacks and shield bonuses. Stale → 409;
 * an illegal loadout (Release membership, hands, grip, requirements) → 422.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["expectedVersion", "mainHand", "mainHandGrip", "offHand"]);
    return apiSuccess(serializeForApi(await updateCharacterWeaponLoadout(parseUuidParam(characterId, "characterId"), { expectedVersion: body.expectedVersion, mainHand: body.mainHand ?? null, mainHandGrip: body.mainHandGrip ?? null, offHand: body.offHand ?? null })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
