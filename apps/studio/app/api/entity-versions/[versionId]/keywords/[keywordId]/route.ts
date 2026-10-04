import { removeKeywordFromEntityVersion } from "@prowess/db";
import { apiSuccess, parseUuidParam, toErrorResponse } from "../../../../../../src/api/index";

/**
 * DELETE /api/entity-versions/:versionId/keywords/:keywordId (PAS-10
 * M1-WO8 §17). Protected by the same atomic DRAFT guard as assignment —
 * removal from a non-DRAFT Version is rejected with
 * `ENTITY_VERSION.IMMUTABLE`, not silently allowed.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; keywordId: string }> },
): Promise<Response> {
  try {
    const { versionId, keywordId } = await params;
    const versionIdValid = parseUuidParam(versionId, "versionId");
    const keywordIdValid = parseUuidParam(keywordId, "keywordId");
    await removeKeywordFromEntityVersion(versionIdValid, keywordIdValid);
    return apiSuccess({ removed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
