import { removeEntityRelationship } from "@prowess/db";
import { apiSuccess, parseUuidParam, toErrorResponse } from "../../../../src/api/index";

/** DELETE /api/relationships/:relationshipId (PAS-10 M1-WO8 §19). Removes only the relationship row. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ relationshipId: string }> },
): Promise<Response> {
  try {
    const { relationshipId } = await params;
    const id = parseUuidParam(relationshipId, "relationshipId");
    await removeEntityRelationship(id);
    return apiSuccess({ removed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
