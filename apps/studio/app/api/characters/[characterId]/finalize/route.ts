import { finalizeCharacterCoreCreation } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/finalize — Complete Core Creation (§68): M2 manifest verification, a READY build,
 * the expected lockVersion; records completion atomically. No game choice changes; mechanics then freeze.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["expectedLockVersion"]);
    return apiSuccess(serializeForApi(await finalizeCharacterCoreCreation(parseUuidParam(characterId, "characterId"), { expectedLockVersion: body.expectedLockVersion })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
