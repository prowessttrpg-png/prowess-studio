import { getCharacterPlayWorkspace } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/play — the Character Play Workspace (PAS-10 M6-WO10): resources, combat values, local
 * timing, the Action / Attack / Spell / Maneuver workspace with the engine's availability, Active Magic and recent events.
 * Read-only: nothing is created, refreshed, advanced or resolved by reading.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterPlayWorkspace(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
