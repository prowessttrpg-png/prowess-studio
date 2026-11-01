import { getCharacterAttacks } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/attacks — the Character Attack Library (PAS-10 M6-WO6 §79–§82, §146): Unarmed,
 * Main-hand, Off-hand and eligible Dual Wield Attacks with exact Weapon + Attack identity and a damage PREVIEW. Nothing
 * is rolled, spent or applied. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterAttacks(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
