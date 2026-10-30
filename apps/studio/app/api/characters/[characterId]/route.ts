import { getCharacter } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId — the Character as stored (exact choices) and resolved against ITS Release
 * (validation, exact provenance, M5 / M4 derived preview). Read-only: derived values are recalculated, never stored.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacter(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
