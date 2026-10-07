import { createRuleset, listRulesets } from "@prowess/db";
import { RULESET_CHANNELS, RULESET_STATUSES } from "@prowess/model";
import { apiSuccess, serializeForApi, toErrorResponse } from "../../../src/api/index";
import { PAGINATION_QUERY, optString, optUuid, paginatedList, queryEnum, readStrictBody, reqEnum, reqString, strictQuery } from "../../../src/api/m2/index";

/**
 * Rulesets (PAS-10 M2-WO9 §8–§10).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST /api/rulesets — create. Always DRAFT: `status` is not an accepted field. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readStrictBody(request, ["canonicalKey", "name", "description", "channel", "versionLabel", "parentRulesetId"]);
    const ruleset = await createRuleset({
      canonicalKey: reqString(body, "canonicalKey"),
      name: reqString(body, "name"),
      description: optString(body, "description"),
      channel: reqEnum(body, "channel", RULESET_CHANNELS),
      versionLabel: optString(body, "versionLabel"),
      parentRulesetId: optUuid(body, "parentRulesetId"),
    });
    return apiSuccess(serializeForApi(ruleset), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET /api/rulesets — list (filters: status, channel; paginated). */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["status", "channel", ...PAGINATION_QUERY]);
    const rulesets = await listRulesets({ status: queryEnum(searchParams, "status", RULESET_STATUSES), channel: queryEnum(searchParams, "channel", RULESET_CHANNELS) });
    return paginatedList(rulesets, searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
