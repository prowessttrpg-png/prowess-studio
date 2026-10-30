import { updateCharacterProfile } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/** PUT /api/characters/:characterId/profile — name / concept only (§39), at the expected lockVersion, in any state. */
export async function PUT(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["expectedLockVersion", "name", "concept"]);
    return apiSuccess(serializeForApi(await updateCharacterProfile(parseUuidParam(characterId, "characterId"), { expectedLockVersion: body.expectedLockVersion, name: body.name, concept: body.concept })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
