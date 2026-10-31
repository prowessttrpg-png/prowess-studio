import { previewCharacterAdvancementFor } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../src/api/m2/index";

/** POST /api/characters/:characterId/advancement/preview — preview ONE Level with the player's choices (§39). Writes nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["choices"]);
    return apiSuccess(serializeForApi(await previewCharacterAdvancementFor(parseUuidParam(characterId, "characterId"), body.choices)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
