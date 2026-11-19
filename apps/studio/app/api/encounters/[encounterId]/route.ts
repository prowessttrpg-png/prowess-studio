import { getEncounter } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * GET /api/encounters/:encounterId — one encounter (M7-WO1): name, notes, exact Release, sides, memberships with each
 * Character's name / Level / status, the server-derived readiness summary and recent history. Read-only: reading never
 * changes the encounter or any Character.
 */
export async function GET(request: Request, { params }: { params: Promise<{ encounterId: string }> }): Promise<Response> {
  try {
    const { encounterId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getEncounter(parseUuidParam(encounterId, "encounterId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
