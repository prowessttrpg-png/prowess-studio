import { removeEntityAlias } from "@prowess/db";
import { apiSuccess, parseUuidParam, toErrorResponse } from "../../../../src/api/index";

/** DELETE /api/entity-aliases/:aliasId (PAS-10 M1-WO8 §15). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ aliasId: string }> },
): Promise<Response> {
  try {
    const { aliasId } = await params;
    const id = parseUuidParam(aliasId, "aliasId");
    await removeEntityAlias(id);
    return apiSuccess({ removed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
