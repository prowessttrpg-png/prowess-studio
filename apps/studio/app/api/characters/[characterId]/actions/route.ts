import { getCharacterActionDirectory } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/actions — the Character's Action Directory (PAS-10 M6-WO9): every ACTION Definition the
 * Character's exact Release pins, as General Action cards with their evaluated Action Improvements. A rules reference
 * only: nothing is created, unlocked, spent or persisted.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterActionDirectory(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
