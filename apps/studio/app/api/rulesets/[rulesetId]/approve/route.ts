import { approveRuleset } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { requireNoBody } from "../../../../../src/api/m2/index";

/**
 * Named lifecycle command (§12).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — IN_REVIEW -> APPROVED. Publishes nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    await requireNoBody(request);
    return apiSuccess(serializeForApi(await approveRuleset(rulesetId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
