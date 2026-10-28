import { validateStoredRevision } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";

/**
 * GET /api/compendium-authoring/entity-versions/:versionId/validation — validate the Definition STORED in one exact
 * revision (PAS-10 M6-WO1 §15, §62): on demand, read-only, never cached as a flag. Generic content is refused
 * (COMPENDIUM_AUTHORING.NOT_A_DEFINITION) rather than guessed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ versionId: string }> }): Promise<Response> {
  try {
    const { versionId } = await params;
    return apiSuccess(serializeForApi(await validateStoredRevision(parseUuidParam(versionId, "versionId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
