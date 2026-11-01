import { updateCharacterPlayState } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * PUT /api/characters/:characterId/play-state — `{ expectedVersion, resources: { RESOURCE_KEY: current } }` (§85–§87).
 * Only CURRENT values: maximums, the Character Die, Skill scores and every derived value are the server's. Out-of-range
 * → 422 (never clamped); stale → 409.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["expectedVersion", "resources"]);
    return apiSuccess(serializeForApi(await updateCharacterPlayState(parseUuidParam(characterId, "characterId"), { expectedVersion: body.expectedVersion, resources: body.resources })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
