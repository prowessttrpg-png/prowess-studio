import { listRulesetReleases, publishRulesetRelease } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { PAGINATION_QUERY, optString, optUuid, paginatedList, readStrictBody, reqString, reqUuid, strictQuery } from "../../../../../src/api/m2/index";

/**
 * Publication and releases (§37, §38).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — the ONLY route that publishes. releaseNumber, manifestHash, channel, publishedAt and the result manifest are generated, never accepted. */
export async function POST(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const body = await readStrictBody(request, ["baseManifestId", "canonPolicyId", "changeSetId", "versionLabel", "releaseNotes"]);
    const release = await publishRulesetRelease({
      rulesetId,
      baseManifestId: reqUuid(body, "baseManifestId"),
      canonPolicyId: reqUuid(body, "canonPolicyId"),
      changeSetId: optUuid(body, "changeSetId"),
      versionLabel: reqString(body, "versionLabel"),
      releaseNotes: optString(body, "releaseNotes"),
    });
    return apiSuccess(serializeForApi(release), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — headers, releaseNumber ASC (paginated). */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList(await listRulesetReleases(rulesetId), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
