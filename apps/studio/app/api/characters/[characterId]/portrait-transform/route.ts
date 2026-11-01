import { updateCharacterPortraitFraming } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * PUT /api/characters/:characterId/portrait-transform — `{ expectedVersion, zoom, offsetX, offsetY }` (§12–§13). Saves
 * the nondestructive framing only; the stored source image is never cropped or re-encoded. Stale → 409.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["expectedVersion", "zoom", "offsetX", "offsetY"]);
    return apiSuccess(serializeForApi(await updateCharacterPortraitFraming(parseUuidParam(characterId, "characterId"), { expectedVersion: body.expectedVersion, zoom: body.zoom, offsetX: body.offsetX, offsetY: body.offsetY })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
