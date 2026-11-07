import { previewCharacterPlayOperation } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { readStrictBody } from "../../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/play/preview — `{ operation, expectedRuntimeVersion, expectedPlayStateVersion }`
 * (PAS-10 M6-WO10 §16). Evaluates the operation server-side and writes NOTHING; a preview never authorizes a commit.
 * Stale versions → 409; a malformed operation → 400.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["operation", "expectedRuntimeVersion", "expectedPlayStateVersion"]);
    return apiSuccess(serializeForApi(await previewCharacterPlayOperation(parseUuidParam(characterId, "characterId"), { operation: body.operation, expectedRuntimeVersion: body.expectedRuntimeVersion, expectedPlayStateVersion: body.expectedPlayStateVersion })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
