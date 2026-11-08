import { listCharacterPlayEvents } from "@prowess/db";
import { CHARACTER_ERROR_CODES, DomainError } from "@prowess/model";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

const wholeNumber = (raw: string | null, field: string): number | null => {
  if (raw === null) return null;
  if (!/^\d{1,9}$/.test(raw)) throw new DomainError(CHARACTER_ERROR_CODES.INVALID_INPUT, `${field} is a whole number`);
  return Number(raw);
};

/**
 * GET /api/characters/:characterId/play/events?before=&limit= — the committed gameplay ledger, newest first (PAS-10
 * M6-WO10 §15). Records are returned exactly as committed; nothing is recalculated. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ characterId: string }> }): Promise<Response> {
  try {
    const { characterId } = await params;
    const searchParams = new URL(request.url).searchParams;
    strictQuery(searchParams, ["before", "limit"]);
    return apiSuccess(serializeForApi(await listCharacterPlayEvents(parseUuidParam(characterId, "characterId"), { before: wholeNumber(searchParams.get("before"), "before"), limit: wholeNumber(searchParams.get("limit"), "limit") })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
