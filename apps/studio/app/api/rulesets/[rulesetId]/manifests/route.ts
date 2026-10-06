import { createRulesetManifest, listRulesetManifests } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../src/api/index";
import { PAGINATION_QUERY, objectArray, optUuid, paginatedList, readStrictBody, reqUuid, strictQuery } from "../../../../../src/api/m2/index";

/**
 * Ruleset manifests (§13, §14).
 * Thin HTTP adapter (PAS-10 M2-WO9): shape validation, one @prowess/db service call, serialization,
 * and the central error mapping. No business rule lives here.
 */

/** POST — create an immutable manifest snapshot; manifestVersion is allocated, never accepted. */
export async function POST(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const body = await readStrictBody(request, ["parentManifestId", "entries"]);
    const manifest = await createRulesetManifest(rulesetId, {
      parentManifestId: optUuid(body, "parentManifestId"),
      entries: objectArray(body, "entries", ["entityId", "entityVersionId"], (e, at) => ({ entityId: reqUuid(e, "entityId", at), entityVersionId: reqUuid(e, "entityVersionId", at) })),
    });
    return apiSuccess(serializeForApi(manifest), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — headers, manifestVersion ASC (paginated). */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string }> }): Promise<Response> {
  try {
    const { rulesetId: rulesetIdRaw } = await params;
    const rulesetId = parseUuidParam(rulesetIdRaw, "rulesetId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList(await listRulesetManifests(rulesetId), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
