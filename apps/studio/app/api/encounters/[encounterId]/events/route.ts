import { listEncounterEvents } from "@prowess/db";
import { DomainError, ENCOUNTER_ERROR_CODES } from "@prowess/model";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { strictQuery } from "../../../../../src/api/m2/index";

const wholeNumber = (raw: string | null, field: string): number | null => {
  if (raw === null) return null;
  if (!/^\d{1,9}$/.test(raw)) throw new DomainError(ENCOUNTER_ERROR_CODES.INVALID_INPUT, `${field} is a whole number`);
  return Number(raw);
};

/** GET /api/encounters/:encounterId/events?before=&limit= — the encounter's command history, newest first (M7-WO1). Read-only. */
export async function GET(request: Request, { params }: { params: Promise<{ encounterId: string }> }): Promise<Response> {
  try {
    const { encounterId } = await params;
    const searchParams = new URL(request.url).searchParams;
    strictQuery(searchParams, ["before", "limit"]);
    return apiSuccess(serializeForApi(await listEncounterEvents(parseUuidParam(encounterId, "encounterId"), { before: wholeNumber(searchParams.get("before"), "before"), limit: wholeNumber(searchParams.get("limit"), "limit") })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
