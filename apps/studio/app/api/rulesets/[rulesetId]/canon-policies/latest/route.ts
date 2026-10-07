import { getLatestCanonPolicy } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * Latest policy (§22).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET — HIGHEST policyVersion only (never current, active or effective); `data: null` when none. */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getLatestCanonPolicy(rulesetId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
