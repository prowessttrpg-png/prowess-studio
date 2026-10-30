import { validateCharacterCandidate } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/** POST /api/characters/:characterId/validate — Check Character (§67): validate an UNSAVED candidate. Writes nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["candidate"]);
    return apiSuccess(serializeForApi(await validateCharacterCandidate(parseUuidParam(characterId, "characterId"), body.candidate)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
