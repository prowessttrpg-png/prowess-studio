import { getRuleset } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { strictQuery } from "../../../../src/api/m2/index";

/**
 * One Ruleset (§11).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** GET /api/rulesets/:rulesetId — 404 RULESET.NOT_FOUND when absent. */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await getRuleset(rulesetId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
