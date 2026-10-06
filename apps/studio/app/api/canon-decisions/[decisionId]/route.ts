import { getCanonDecision } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * One decision.
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — the immutable decision and its ordered selections. */
export async function GET(request: Request, { params }: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  try {
    const { decisionId: decisionIdRaw } = await params;
    const decisionId = parseUuidParam(decisionIdRaw, "decisionId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getCanonDecision(decisionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
