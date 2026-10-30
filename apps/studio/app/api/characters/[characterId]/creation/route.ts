import { saveCharacterCreation } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * PUT /api/characters/:characterId/creation — Save & Continue (§66, §73): exact choices + expected lockVersion, one
 * transaction. The server validates against the Character's Release and decides ranks; Level and derived values are
 * never inputs. A stale version is 409; an illegal build is 422; a completed Character is 409 (frozen).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["expectedLockVersion", "candidate"]);
    return apiSuccess(serializeForApi(await saveCharacterCreation(parseUuidParam(characterId, "characterId"), { expectedLockVersion: body.expectedLockVersion, candidate: body.candidate })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
