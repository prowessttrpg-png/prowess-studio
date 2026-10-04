import { removeKeywordFromEntity } from "@prowess/db";
import { apiSuccess, parseUuidParam, toErrorResponse } from "../../../../../../src/api/index";

/**
 * DELETE /api/entities/:entityId/keywords/:keywordId — remove an
 * Entity-level assignment (PAS-10 M1-WO8 §16). Idempotent — removing a
 * Keyword that isn't assigned succeeds silently (see
 * `removeKeywordFromEntity`'s own doc comment, M1-WO5).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ entityId: string; keywordId: string }> },
): Promise<Response> {
  try {
    const { entityId, keywordId } = await params;
    const entityIdValid = parseUuidParam(entityId, "entityId");
    const keywordIdValid = parseUuidParam(keywordId, "keywordId");
    await removeKeywordFromEntity(entityIdValid, keywordIdValid);
    return apiSuccess({ removed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
