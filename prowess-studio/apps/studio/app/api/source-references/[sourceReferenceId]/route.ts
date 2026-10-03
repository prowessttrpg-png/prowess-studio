import { removeSourceReference } from "@prowess/db";
import { apiSuccess, parseUuidParam, toErrorResponse } from "../../../../src/api/index";

/** DELETE /api/source-references/:sourceReferenceId (PAS-10 M1-WO8 §22). Removes only the reference row. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sourceReferenceId: string }> },
): Promise<Response> {
  try {
    const { sourceReferenceId } = await params;
    const id = parseUuidParam(sourceReferenceId, "sourceReferenceId");
    await removeSourceReference(id);
    return apiSuccess({ removed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
