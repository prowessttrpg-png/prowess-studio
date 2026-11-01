import { updateCharacterSheetNotes } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * PUT /api/characters/:characterId/notes — the player-written sheet text (§82–§84): Company / PAC, Action Notes,
 * Character Notes and freeform possessions. Stored and shown as written; never read as mechanics. Stale → 409.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["expectedVersion", "companyPac", "actionNotes", "characterNotes", "possessions"]);
    return apiSuccess(
      serializeForApi(await updateCharacterSheetNotes(parseUuidParam(characterId, "characterId"), { expectedVersion: body.expectedVersion, companyPac: body.companyPac, actionNotes: body.actionNotes, characterNotes: body.characterNotes, possessions: body.possessions })),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
