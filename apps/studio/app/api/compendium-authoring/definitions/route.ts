import { createAuthoredDefinition, listAuthoringDefinitions } from "@prowess/db";
import { apiSuccess, apiSuccessList, parsePaginationParams, serializeForApi, toErrorResponse } from "../../../../src/api/index";
import { optString, readStrictBody, reqString, strictQuery } from "../../../../src/api/m2/index";
import { definitionField, optSources, optUuidArray } from "../../../../src/api/compendium-authoring/input";

/**
 * GET /api/compendium-authoring/definitions — the authoring list (PAS-10 M6-WO1 §60–61): the existing M1 Entity query
 * (search / EntityType / latest-revision status / canonical key) plus, per row, the Definition kind the latest revision
 * declares and its structural M5 check. `latestRevision` is the highest revision — never Current / Active / Canon.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["page", "pageSize", "search", "status", "entityType", "canonicalKey"]);
    const { page, pageSize } = parsePaginationParams(searchParams);
    const result = await listAuthoringDefinitions({
      page,
      pageSize,
      search: searchParams.get("search") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      entityType: searchParams.get("entityType") ?? undefined,
      canonicalKey: searchParams.get("canonicalKey") ?? undefined,
    });
    return apiSuccessList(serializeForApi(result.items) as unknown[], result.page, result.pageSize, result.total);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/compendium-authoring/definitions — Create Definition (PAS-10 M6-WO1 §10): Entity + Revision 1 as DRAFT +
 * optional Keywords and provenance. No status, revision number or identity is accepted from the caller.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readStrictBody(request, [
      "definitionKind",
      "entityType",
      "canonicalKey",
      "displayName",
      "shortDescription",
      "rulesText",
      "changeType",
      "changeSummary",
      "prowessDefinition",
      "entityKeywordIds",
      "versionKeywordIds",
      "sources",
    ]);
    const result = await createAuthoredDefinition({
      definitionKind: reqString(body, "definitionKind"),
      entityType: optString(body, "entityType"),
      canonicalKey: reqString(body, "canonicalKey"),
      displayName: reqString(body, "displayName"),
      shortDescription: optString(body, "shortDescription"),
      rulesText: optString(body, "rulesText"),
      changeType: optString(body, "changeType"),
      changeSummary: optString(body, "changeSummary"),
      prowessDefinition: definitionField(body),
      entityKeywordIds: optUuidArray(body, "entityKeywordIds"),
      versionKeywordIds: optUuidArray(body, "versionKeywordIds"),
      sources: optSources(body, "sources"),
    });
    return apiSuccess(serializeForApi(result), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
