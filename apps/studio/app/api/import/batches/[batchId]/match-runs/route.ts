import { analyzeImportBatchMatches, listImportMatchRuns } from "@prowess/db";
import { apiSuccess, parseUuidParam, serializeForApi, toErrorResponse } from "../../../../../../src/api/index";
import { PAGINATION_QUERY, paginatedList, readStrictBody, strictObject, strictQuery } from "../../../../../../src/api/m2/index";
import { definedOnly, optNumber, optStringOnly } from "../../../../../../src/api/import/index";

/**
 * Identity matching (WO4). The candidate set, catalog and comparison Manifest are derived by the service; only the existing matcher identity / config contract is accepted.
 * Thin HTTP adapter (PAS-10 M3-WO7): strict shape validation, one public @prowess/db service call, serialization, and
 * the central error mapping. No import-domain rule lives here.
 */

/** POST — analyse (or idempotently return) a MatchRun: 201 when created, 200 for an identical existing context. */
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  try {
    const { batchId: raw } = await params;
    const batchId = parseUuidParam(raw, "batchId");
    const body = await readStrictBody(request, ["matcherKey", "matcherVersion", "matcherConfig"]);
    const config = body.matcherConfig === undefined ? undefined : strictObject(body.matcherConfig, ["suggestionThreshold", "maxSuggestions"], "matcherConfig");
    const result = await analyzeImportBatchMatches(
      batchId,
      definedOnly({
        matcherKey: optStringOnly(body, "matcherKey"),
        matcherVersion: optStringOnly(body, "matcherVersion"),
        matcherConfig: config === undefined ? undefined : definedOnly({ suggestionThreshold: optNumber(config, "suggestionThreshold", "matcherConfig."), maxSuggestions: optNumber(config, "maxSuggestions", "matcherConfig.") }),
      }),
    );
    return apiSuccess(serializeForApi(result), result.created ? 201 : 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET — paginated (Phase 1: the service's ordered result is paged in the adapter). */
export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  try {
    const { batchId: raw } = await params;
    const batchId = parseUuidParam(raw, "batchId");
    const { searchParams } = new URL(request.url);
    strictQuery(searchParams, [...PAGINATION_QUERY]);
    return paginatedList(await listImportMatchRuns(batchId), searchParams);
  } catch (error) {
    return toErrorResponse(error);
  }
}
