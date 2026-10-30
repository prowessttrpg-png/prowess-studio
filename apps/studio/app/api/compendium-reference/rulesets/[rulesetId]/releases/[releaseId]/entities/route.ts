import { listReferenceEntries } from "@prowess/db";
import { apiSuccessList, parsePaginationParams, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../../../src/api/index";
import { strictQuery } from "../../../../../../../../src/api/m2/index";

/**
 * GET /api/compendium-reference/rulesets/:rulesetId/releases/:releaseId/entities — the Release's pinned entries
 * (PAS-10 M6-WO2): server-side facets (search, kind, family, branch, entityType, keywordId) and paging, ordered by
 * display name, canonical key, Entity id. Each card is computed from the EXACT pinned revision. Read-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ rulesetId: string; releaseId: string }> }): Promise<Response> {
  try {
    const { rulesetId, releaseId } = await params;
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, ["page", "pageSize", "search", "kind", "family", "branch", "entityType", "keywordId"]);
    const { page, pageSize } = parsePaginationParams(searchParams);
    const opt = (k: string) => searchParams.get(k) ?? undefined;
    const result = await listReferenceEntries(parseUuidParam(rulesetId, "rulesetId"), parseUuidParam(releaseId, "releaseId"), {
      page,
      pageSize,
      search: opt("search"),
      kind: opt("kind"),
      family: opt("family"),
      branch: opt("branch"),
      entityType: opt("entityType"),
      keywordId: opt("keywordId"),
    });
    return apiSuccessList(serializeForApi(result.items) as unknown[], result.page, result.pageSize, result.total);
  } catch (error) {
    return toErrorResponse(error);
  }
}
