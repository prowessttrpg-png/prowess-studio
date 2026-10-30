import { resolveLatestReferenceRelease } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { strictQuery } from "../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-reference/rulesets/:rulesetId/latest-release — the "View Latest Release" convenience (PAS-10
 * M6-WO2): resolves the highest-numbered Release (M2 query semantics) to an EXACT Release so the UI can navigate to a
 * durable, Release-pinned URL. `release` is null when the Ruleset has none — never a fallback. Nothing is stored.
 */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId } = await params;
    strictQuery(new URL(request.url).searchParams, []);
    return apiSuccess(serializeForApi(await resolveLatestReferenceRelease(parseUuidParam(rulesetId, "rulesetId"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
