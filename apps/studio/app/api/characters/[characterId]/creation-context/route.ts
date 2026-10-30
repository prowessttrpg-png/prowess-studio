import { getCharacterCreationContext } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

/**
 * GET /api/characters/:characterId/creation-context — everything the wizard needs from the Character's exact Release
 * in one normalized read (§48): creation rule, Stat bounds, Character Die, Skill ranks, Derived Stats and the
 * Release-pinned Ancestries, Skills and Affinities with their exact references.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCharacterCreationContext(parseUuidParam(characterId, "characterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
