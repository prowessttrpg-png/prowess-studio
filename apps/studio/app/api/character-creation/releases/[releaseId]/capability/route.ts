import { getReleaseCharacterCreationCapability } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * GET /api/character-creation/releases/:releaseId/capability — whether one exact Release can build a Character (§8):
 * READY or MISSING_REQUIRED_CONTENT with every missing requirement. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string }> }): Promise<Response> {
  try {
    const { releaseId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getReleaseCharacterCreationCapability(parseUuidParam(releaseId, "releaseId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
