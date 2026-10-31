import { advanceCharacter } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { readStrictBody } from "../../../../../src/api/m2/index";

/**
 * POST /api/characters/:characterId/advance — Advance Character (§42, §76, §80): the expected lockVersion and the player's
 * choices only. The server derives the next Level, ranks, Character Die and every derived value, validates against the
 * Character's exact Release and commits exactly one Level atomically. Stale → 409; illegal → 422; incomplete / maximum → 409.
 */
export async function POST(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const body = await readStrictBody(request, ["expectedLockVersion", "choices"]);
    return apiSuccess(serializeForApi(await advanceCharacter(parseUuidParam(characterId, "characterId"), { expectedLockVersion: body.expectedLockVersion, choices: body.choices })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
